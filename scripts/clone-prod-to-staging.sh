#!/usr/bin/env bash
# Replaces staging's league and MLB data with a copy of production's, so staging can be tested
# against the real season. Run it from a terminal; it asks for both database passwords (Dashboard
# → Project Settings → Database) and saves neither. Needs Docker (it runs pg_dump and psql there).
#
# What it copies: every table in `public` and `private`, except
#   - public.push_subscriptions: prod's are friends' real phones; staging keeps its own.
#   - private.push_keys, private.poller: staging's own push keys and poll state.
#   - private.push_queue, private.bag_alerts, private.score_changes: alert queues, left empty.
# Sign-ins aren't copied. Prod users are matched to staging users by email; teams and managers of
# prod users with no staging account show as unclaimed. Staging users with no prod profile keep
# theirs. Triggers are off while loading, so no alerts are queued. It all runs in one transaction:
# if any step fails, staging is left as it was.
#
# Locally (for testing the script): SOURCE_URL=... TARGET_URL=... scripts/clone-prod-to-staging.sh
set -euo pipefail

PROD_REF=xjbwsveifxhtdkpmnckr     # baggery-prod, us-east-2
STAGING_REF=fysycochmsjicjephrid  # baggery-staging, us-west-2
IMAGE=postgres:17

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT   # the dump holds prod's data and emails; don't leave it around

pg() { docker run --rm -i -v "$work:/work" -e PGPASSWORD "$IMAGE" "$@"; }

# Free-plan direct connections are IPv6-only, which Docker on a Mac can't reach, so this goes
# through the session pooler. Its host is aws-0-<region> or aws-1-<region>, depending on the project.
pooler_url() { # ref region
  local host
  for host in "aws-0-$2.pooler.supabase.com" "aws-1-$2.pooler.supabase.com"; do
    local url="postgresql://postgres.$1@$host:5432/postgres"
    if pg psql "$url" -Atqc 'select 1' >/dev/null 2>&1; then echo "$url"; return; fi
  done
  echo "Couldn't connect to $1. Check the password." >&2
  exit 1
}

if [[ -n "${SOURCE_URL:-}" && -n "${TARGET_URL:-}" ]]; then
  src=$SOURCE_URL; dst=$TARGET_URL; src_pw=; dst_pw=
else
  read -rsp "Prod database password: " src_pw; echo
  read -rsp "Staging database password: " dst_pw; echo
  export PGPASSWORD=$src_pw; src=$(pooler_url "$PROD_REF" us-east-2)
  export PGPASSWORD=$dst_pw; dst=$(pooler_url "$STAGING_REF" us-west-2)
fi

echo "Dumping prod..."
export PGPASSWORD=$src_pw
pg pg_dump "$src" --data-only --schema=public --schema=private --no-owner --no-privileges \
  --exclude-table-data=public.push_subscriptions \
  --exclude-table-data=private.push_keys --exclude-table-data=private.poller \
  --exclude-table-data=private.push_queue --exclude-table-data=private.bag_alerts \
  --exclude-table-data=private.score_changes \
  -f /work/data.sql
pg psql "$src" -v ON_ERROR_STOP=1 -Atqc \
  "\\copy (select id, email from auth.users where email is not null) to '/work/prod_users.csv' csv"

cat > "$work/load.sql" <<'SQL'
set session_replication_role = replica;  -- no triggers (alerts, league log) while loading

create temp table prod_users (id uuid primary key, email text not null);
\copy pg_temp.prod_users from '/work/prod_users.csv' csv
create temp table user_map as
  select p.id as prod_id, s.id as staging_id
  from pg_temp.prod_users p join auth.users s on lower(s.email) = lower(p.email);
create temp table old_profiles as select * from public.profiles;

do $$
declare
  tables text;
begin
  select string_agg(format('%I.%I', schemaname, tablename), ', ') into tables
  from pg_tables
  where schemaname in ('public', 'private')
    and format('%s.%s', schemaname, tablename) not in
      ('public.push_subscriptions', 'private.push_keys', 'private.poller');
  execute 'truncate ' || tables;
end $$;

\o /dev/null
\i /work/data.sql
\o
set search_path = public;

-- Rows owned by a user: re-key to the staging user, or drop if there isn't one.
delete from profiles t where not exists (select 1 from pg_temp.user_map m where m.prod_id = t.id);
-- Uploaded photos live in prod's storage, under the prod user's id; the Google photo still shows.
update profiles t set id = m.staging_id, avatar_path = null from pg_temp.user_map m where t.id = m.prod_id;
insert into profiles select o.* from pg_temp.old_profiles o
  where exists (select 1 from auth.users u where u.id = o.id)
    and not exists (select 1 from profiles p where p.id = o.id);

delete from league_members t where not exists (select 1 from pg_temp.user_map m where m.prod_id = t.user_id);
update league_members t set user_id = m.staging_id from pg_temp.user_map m where t.user_id = m.prod_id;
delete from bag_game_bests t where not exists (select 1 from pg_temp.user_map m where m.prod_id = t.user_id);
update bag_game_bests t set user_id = m.staging_id from pg_temp.user_map m where t.user_id = m.prod_id;

-- Rows that only point at a user: re-point, or clear.
update fantasy_teams t set user_id = (select staging_id from pg_temp.user_map where prod_id = t.user_id) where user_id is not null;
update league_managers t set user_id = (select staging_id from pg_temp.user_map where prod_id = t.user_id) where user_id is not null;
update league_log t set user_id = (select staging_id from pg_temp.user_map where prod_id = t.user_id) where user_id is not null;
update draft_actions t set made_by = (select staging_id from pg_temp.user_map where prod_id = t.made_by) where made_by is not null;

-- Every user reference must now be a staging user (foreign keys weren't checked while loading).
do $$
declare
  bad bigint;
begin
  select count(*) into bad from (
    select id as u from profiles union all
    select user_id from league_members union all
    select user_id from bag_game_bests union all
    select user_id from fantasy_teams union all
    select user_id from league_managers union all
    select user_id from league_log union all
    select made_by from draft_actions
  ) r where u is not null and not exists (select 1 from auth.users a where a.id = r.u);
  if bad > 0 then raise exception '% rows still point at prod users', bad; end if;
end $$;

select format('Linked %s prod users to staging accounts: %s', count(*), string_agg(u.email, ', ' order by u.email))
  from pg_temp.user_map m join auth.users u on u.id = m.staging_id;
SQL

echo "Loading into staging..."
export PGPASSWORD=$dst_pw
pg psql "$dst" -v ON_ERROR_STOP=1 --single-transaction -Atq -f /work/load.sql
echo "Done. Staging now has prod's data."
