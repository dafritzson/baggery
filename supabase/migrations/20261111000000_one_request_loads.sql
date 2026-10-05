-- The app's two big loads, the season (lib/season.ts) and its scores (lib/scores.ts), each in one
-- request instead of 9 and 4. Same rows and columns as the separate queries, with the same row
-- level security (security invoker): each request writes ~3 KB of Supabase logs (log ingestion
-- is metered), the browser sends a CORS preflight before most, and the app reloads both after
-- every reconnect (a phone unlocking), ~200 times a day on production. One request also loads
-- faster than the old chains of round trips.

-- The season for p_year (the latest when null or missing), every season's year, and everything
-- the app keeps about the season: what fetchSeason used to load from nine queries.
create function public.season_load(p_year int default null) returns json
language sql stable security invoker set search_path = ''
as $$
  with seasons as (
    select id, year, status, league_id, survivors_after_round, imported_at, manual_rounds
    from public.seasons
  ),
  season as (
    select * from seasons
    order by (year = p_year) is true desc, year desc
    limit 1
  )
  select json_build_object(
    'seasons', coalesce((select json_agg(s order by s.year desc) from seasons s), '[]'),
    'season', (select row_to_json(s) from season s),
    'teams', coalesce((
      select json_agg(t order by t.slot) from public.fantasy_teams t where t.season_id = (select id from season)
    ), '[]'),
    'drafts', coalesce((
      select json_agg(d order by d.number) from public.drafts d where d.season_id = (select id from season)
    ), '[]'),
    'spells', coalesce((
      select json_agg(r) from public.roster_spells r where r.season_id = (select id from season)
    ), '[]'),
    'pool', coalesce((
      select json_agg(json_build_object(
        'mlb_player_id', p.mlb_player_id, 'mlb_team_id', p.mlb_team_id,
        'regular_season_tb', p.regular_season_tb, 'plate_appearances', p.plate_appearances,
        'at_bats', p.at_bats, 'games_played', p.games_played, 'hits', p.hits, 'doubles', p.doubles,
        'triples', p.triples, 'home_runs', p.home_runs, 'runs', p.runs, 'rbi', p.rbi,
        'walks', p.walks, 'strikeouts', p.strikeouts, 'hit_by_pitch', p.hit_by_pitch,
        'sac_flies', p.sac_flies, 'slg', p.slg, 'ops_plus', p.ops_plus,
        'on_postseason_roster', p.on_postseason_roster, 'injured_list', p.injured_list,
        'injury', p.injury, 'injury_return', p.injury_return,
        'player', (
          select json_build_object('id', m.id, 'full_name', m.full_name, 'primary_position', m.primary_position)
          from public.mlb_players m where m.id = p.mlb_player_id
        )
      ))
      from public.season_player_pool p where p.season_id = (select id from season)
    ), '[]'),
    'mlb_teams', coalesce((
      select json_agg(json_build_object(
        'eliminated', st.eliminated, 'wins', st.wins, 'has_bye', st.has_bye, 'seed', st.seed,
        'team', (
          select json_build_object('id', m.id, 'name', m.name, 'league', m.league, 'abbreviation', m.abbreviation)
          from public.mlb_teams m where m.id = st.mlb_team_id
        )
      ))
      from public.season_mlb_teams st where st.season_id = (select id from season)
    ), '[]'),
    'members', coalesce((
      select json_agg(json_build_object('user_id', l.user_id, 'role', l.role))
      from public.league_members l where l.league_id = (select league_id from season)
    ), '[]'),
    'profiles', coalesce((
      select json_agg(json_build_object(
        'id', p.id, 'display_name', p.display_name, 'avatar_path', p.avatar_path,
        'google_avatar_url', p.google_avatar_url
      ))
      from public.profiles p
    ), '[]'),
    'actions', coalesce((
      select json_agg(a order by a.action_number) from public.draft_actions a
      where a.draft_id in (select d.id from public.drafts d where d.season_id = (select id from season))
    ), '[]')
  );
$$;

-- A season's postseason games, the given players' TB and hits in them, and live games' batting
-- lines for everyone: what useLiveScores used to load from four queries.
create function public.scores_load(p_year int, p_players int[]) returns json
language sql stable security invoker set search_path = ''
as $$
  with games as (
    select game_pk, game_type, series_game_number, start_time, start_time_tbd, official_date, status,
      detailed_state, home_team_id, away_team_id, home_score, away_score, live, games_in_series,
      final_seen_at
    from public.mlb_games where season_year = p_year
  )
  select json_build_object(
    'games', coalesce((select json_agg(g) from games g), '[]'),
    'stats', coalesce((
      select json_agg(json_build_object(
        'game_pk', s.game_pk, 'mlb_player_id', s.mlb_player_id, 'tb', s.tb, 'ab', s.ab, 'h', s.h,
        'bb', s.bb, 'hbp', s.hbp, 'sf', s.sf, 'hr', s.hr, 'r', s.r, 'rbi', s.rbi
      ))
      from public.player_game_stats s
      where s.game_pk in (select game_pk from games) and s.mlb_player_id = any(p_players)
    ), '[]'),
    'hits', coalesce((
      select json_agg(json_build_object(
        'play_id', h.play_id, 'game_pk', h.game_pk, 'mlb_player_id', h.mlb_player_id,
        'event', h.event, 'ended_at', h.ended_at, 'has_video', h.has_video
      ))
      from public.mlb_hits h
      where h.game_pk in (select game_pk from games) and h.mlb_player_id = any(p_players)
    ), '[]'),
    'lines', coalesce((
      select json_agg(json_build_object(
        'game_pk', s.game_pk, 'mlb_player_id', s.mlb_player_id, 'ab', s.ab, 'h', s.h,
        'doubles', s.doubles, 'triples', s.triples, 'hr', s.hr, 'bb', s.bb,
        'batting_order', s.batting_order
      ))
      from public.player_game_stats s
      where s.game_pk in (select game_pk from games where status = 'Live')
    ), '[]')
  );
$$;
