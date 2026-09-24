-- A claimed team always has a stored name. Teams claimed before team names existed had none, so
-- the app showed a new random name on every page load. They get a fixed "<adjective> Baggers"
-- name now (the manager can rename it any time), and a claimed team can no longer be unnamed.

with adjectives(adjective) as (
  select unnest(array[
    'Notorious', 'Blue', 'Mighty', 'Rowdy', 'Golden', 'Sneaky', 'Electric', 'Dusty', 'Clutch', 'Lucky',
    'Fearless', 'Crafty', 'Scrappy', 'Grand', 'Salty', 'Swift', 'Loud', 'Hungry', 'Rally', 'Bold',
    'Cosmic', 'Wild', 'Smooth', 'Gritty', 'Heavy', 'Silent', 'Crimson', 'Jolly', 'Frosty', 'Big',
    'Legendary', 'Humble', 'Midnight', 'Thunder', 'Fancy', 'Dapper', 'Spicy', 'Rusty', 'Nimble', 'Sultry'
  ])
),
-- Shuffled, skipping any name a team already uses.
free as (
  select adjective || ' Baggers' as name, row_number() over (order by random()) as n
  from adjectives
  where not exists (select 1 from public.fantasy_teams t where lower(t.name) = lower(adjective || ' Baggers'))
),
unnamed as (
  select id, row_number() over (partition by season_id order by slot) as n
  from public.fantasy_teams
  where user_id is not null and name is null
)
update public.fantasy_teams t
set name = free.name
from unnamed join free using (n)
where t.id = unnamed.id;

alter table public.fantasy_teams
  add constraint fantasy_teams_claimed_named check (user_id is null or name is not null);
