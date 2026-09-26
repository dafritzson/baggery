// End-to-end draft against a local Supabase: real auth, RLS, Edge Functions and the MLB API.
// Run with `npm run test:int` (resets the local database first).

import { execSync } from 'node:child_process';

import { type SupabaseClient, createClient } from '@supabase/supabase-js';
import { beforeAll, describe, expect, it } from 'vitest';

const status = JSON.parse(execSync('npx supabase status -o json', { encoding: 'utf8' }));
const url: string = status.API_URL;
const publishableKey: string = status.PUBLISHABLE_KEY;
const admin = createClient(url, status.SECRET_KEY, { auth: { persistSession: false } });

const SEASON_ID = '7ba99e70-0000-4000-8000-000000002026';
// Daniel claims first, so he becomes the commissioner of the new league.
const MANAGERS = ['Daniel', 'Alex', 'Curtis', 'Darren', 'James', 'Kyle', 'Mookie'];
// 2026 playoff-ish field, passed explicitly so the test doesn't depend on who has clinched today.
const TEAM_IDS = [139, 147, 111, 114, 117, 145, 144, 158, 119, 143, 112, 135];

const clients = new Map<string, SupabaseClient>();
const teamIdByManager = new Map<string, string>();
const managerByTeamId = new Map<string, string>();
let draftId: string;

async function signIn(name: string): Promise<SupabaseClient> {
  const email = `${name.toLowerCase()}@example.com`;
  await admin.auth.admin.createUser({ email, password: 'password123', email_confirm: true, user_metadata: { full_name: name } });
  const client = createClient(url, publishableKey, { auth: { persistSession: false } });
  const { error } = await client.auth.signInWithPassword({ email, password: 'password123' });
  if (error) throw error;
  return client;
}

async function call(manager: string, fn: string, body: object): Promise<{ ok?: boolean; error?: string }> {
  const { data, error } = await clients.get(manager)!.functions.invoke(fn, { body });
  if (error && 'context' in error) return (error.context as Response).json();
  if (error) throw error;
  return data;
}

async function onTheClock(): Promise<string> {
  const { data: draft } = await admin.from('drafts').select('pick_order, status').eq('id', draftId).single();
  const { count } = await admin.from('draft_actions').select('*', { count: 'exact', head: true }).eq('draft_id', draftId);
  const order: string[] = draft!.pick_order;
  const n = order.length;
  const round = Math.floor(count! / n);
  const i = count! % n;
  return managerByTeamId.get(round % 2 === 0 ? order[i] : order[n - 1 - i])!;
}

async function bestAvailable(): Promise<number> {
  const { data: taken } = await admin.from('roster_spells').select('mlb_player_id').eq('season_id', SEASON_ID);
  const takenIds = new Set(taken!.map((t) => t.mlb_player_id));
  const { data: pool } = await admin
    .from('season_player_pool')
    .select('mlb_player_id, regular_season_tb')
    .eq('season_id', SEASON_ID)
    .order('regular_season_tb', { ascending: false });
  return pool!.find((p) => !takenIds.has(p.mlb_player_id))!.mlb_player_id;
}

beforeAll(async () => {
  for (const m of MANAGERS) clients.set(m, await signIn(m));
  // Manager i claims spot i + 1.
  const { data: spots } = await admin.from('fantasy_teams').select('id').eq('season_id', SEASON_ID).order('slot');
  expect(spots).toHaveLength(MANAGERS.length);
  MANAGERS.forEach((m, i) => {
    teamIdByManager.set(m, spots![i].id);
    managerByTeamId.set(spots![i].id, m);
  });
  const { data: draft } = await admin.from('drafts').select('id').eq('season_id', SEASON_ID).eq('number', 1).single();
  draftId = draft!.id;
});

describe('season setup', () => {
  it('creates a profile from the Google-style name', async () => {
    const { data } = await clients.get('Kyle')!.from('profiles').select('display_name');
    expect(data!.map((p) => p.display_name)).toContain('Kyle');
  });

  it('makes the first manager to claim a spot the commissioner', async () => {
    const { error } = await clients.get('Daniel')!.rpc('claim_team', { p_team_id: teamIdByManager.get('Daniel'), p_name: 'Daniel Bags' });
    expect(error).toBeNull();
    const { data } = await admin.from('league_members').select('role, user_id');
    expect(data).toHaveLength(1);
    expect(data![0].role).toBe('commissioner');
  });

  it('rejects a team name that is taken (ignoring case), empty or too long', async () => {
    const kyle = clients.get('Kyle')!;
    const spot = teamIdByManager.get('Kyle');
    expect((await kyle.rpc('claim_team', { p_team_id: spot, p_name: '  daniel   BAGS ' })).error?.message).toMatch(/taken/);
    expect((await kyle.rpc('claim_team', { p_team_id: spot, p_name: '   ' })).error?.message).toMatch(/Enter a team name/);
    expect((await kyle.rpc('claim_team', { p_team_id: spot, p_name: 'x'.repeat(31) })).error?.message).toMatch(/30 characters/);
  });

  it('lets each manager claim exactly one spot and name it', async () => {
    for (const m of MANAGERS.slice(1)) {
      const { error } = await clients.get(m)!.rpc('claim_team', { p_team_id: teamIdByManager.get(m), p_name: `  ${m}   Bags ` });
      expect(error).toBeNull();
    }
    const { data: kyle } = await admin.from('fantasy_teams').select('name').eq('id', teamIdByManager.get('Kyle')).single();
    expect(kyle!.name).toBe('Kyle Bags');
    const { error } = await clients.get('Kyle')!.rpc('claim_team', { p_team_id: teamIdByManager.get('Alex'), p_name: 'Two Teams' });
    expect(error?.message).toMatch(/already/);
    const { data: members } = await admin.from('league_members').select('role');
    expect(members!.filter((m) => m.role === 'commissioner')).toHaveLength(1);
    expect(members).toHaveLength(MANAGERS.length);
  });

  it('lets managers rename their own team, and only the commissioner rename others', async () => {
    const kyle = clients.get('Kyle')!;
    expect((await kyle.rpc('rename_team', { p_team_id: teamIdByManager.get('Kyle'), p_name: 'Big Bags' })).error).toBeNull();
    expect((await kyle.rpc('rename_team', { p_team_id: teamIdByManager.get('Alex'), p_name: 'Hacked' })).error?.message).toMatch(
      /your own team/,
    );
    expect((await kyle.rpc('rename_team', { p_team_id: teamIdByManager.get('Kyle'), p_name: 'Alex Bags' })).error?.message).toMatch(/taken/);
    const daniel = clients.get('Daniel')!;
    expect((await daniel.rpc('rename_team', { p_team_id: teamIdByManager.get('Kyle'), p_name: 'Kyle Bags' })).error).toBeNull();
  });

  it('never leaves a claimed team without a stored name', async () => {
    const { error } = await admin.from('fantasy_teams').update({ name: null }).eq('id', teamIdByManager.get('Kyle'));
    expect(error?.message).toMatch(/fantasy_teams_claimed_named/);
  });

  it('only lets the commissioner sync the pool', async () => {
    expect((await call('Kyle', 'sync-pool', { seasonId: SEASON_ID })).error).toMatch(/commissioner/);
    const result = await call('Daniel', 'sync-pool', { seasonId: SEASON_ID, teamIds: TEAM_IDS });
    expect(result.ok).toBe(true);
    const { count } = await admin.from('season_player_pool').select('*', { count: 'exact', head: true });
    expect(count).toBeGreaterThan(100);
  });
});

describe('draft 1', () => {
  it('starts with a random order of all 7 teams', async () => {
    expect((await call('Kyle', 'draft', { draftId, action: 'start' })).error).toMatch(/commissioner/);
    expect((await call('Daniel', 'draft', { draftId, action: 'start' })).ok).toBe(true);
    const { data } = await admin.from('drafts').select('pick_order, status').eq('id', draftId).single();
    expect(data!.status).toBe('live');
    expect([...data!.pick_order].sort()).toEqual([...teamIdByManager.values()].sort());
  });

  it('rejects out-of-turn picks and accepts the right manager', async () => {
    const up = await onTheClock();
    const other = MANAGERS.find((m) => m !== up && m !== 'Daniel')!;
    const player = await bestAvailable();
    expect((await call(other, 'draft', { draftId, action: 'pick', addPlayerId: player })).error).toMatch(/not your turn/);
    expect((await call(up, 'draft', { draftId, action: 'pick', addPlayerId: player })).ok).toBe(true);
  });

  it('rejects a player who is already taken', async () => {
    const { data } = await admin.from('roster_spells').select('mlb_player_id').limit(1).single();
    const up = await onTheClock();
    expect((await call(up, 'draft', { draftId, action: 'pick', addPlayerId: data!.mlb_player_id })).error).toMatch(/already been drafted/);
  });

  it('lets the commissioner undo the last pick', async () => {
    expect((await call('Daniel', 'draft', { draftId, action: 'undo' })).ok).toBe(true);
    const { count } = await admin.from('roster_spells').select('*', { count: 'exact', head: true });
    expect(count).toBe(0);
  });

  it("only lets a manager flip their own team's autodraft, and picks at once when they're on the clock", async () => {
    const up = await onTheClock();
    const upTeam = teamIdByManager.get(up)!;
    const other = MANAGERS.find((m) => m !== up && m !== 'Daniel')!;
    expect((await call(other, 'draft', { draftId, action: 'set-autodraft', teamId: upTeam, autodraft: true })).error).toMatch(/commissioner/);

    const count = async () => (await admin.from('draft_actions').select('*', { count: 'exact', head: true }).eq('draft_id', draftId)).count!;
    const before = await count();
    expect((await call(up, 'draft', { draftId, action: 'set-autodraft', teamId: upTeam, autodraft: true })).ok).toBe(true);
    expect(await count()).toBeGreaterThan(before);
    const { data: team } = await admin.from('fantasy_teams').select('autodraft').eq('id', upTeam).single();
    expect(team!.autodraft).toBe(true);

    // Switching off never picks.
    const after = await count();
    expect((await call(up, 'draft', { draftId, action: 'set-autodraft', teamId: upTeam, autodraft: false })).ok).toBe(true);
    expect(await count()).toBe(after);
  });

  it('autodrafts for absent managers and finishes with 4 players each', async () => {
    // Mookie is away: autodraft picks for them whenever they're up.
    expect((await call('Mookie', 'draft', { draftId, action: 'set-autodraft', teamId: teamIdByManager.get('Mookie'), autodraft: true })).ok).toBe(true);

    for (let i = 0; i < 40; i++) {
      const { data } = await admin.from('drafts').select('status').eq('id', draftId).single();
      if (data!.status === 'complete') break;
      const up = await onTheClock();
      expect(up).not.toBe('Mookie');
      const result = await call(up, 'draft', { draftId, action: 'pick', addPlayerId: await bestAvailable() });
      expect(result.ok).toBe(true);
    }

    const { data: draft } = await admin.from('drafts').select('status').eq('id', draftId).single();
    expect(draft!.status).toBe('complete');
    const { data: spells } = await admin.from('roster_spells').select('fantasy_team_id');
    expect(spells).toHaveLength(28);
    for (const teamId of teamIdByManager.values()) {
      expect(spells!.filter((s) => s.fantasy_team_id === teamId)).toHaveLength(4);
    }
    // All of Mookie's picks were made for them (the test above adds an auto pick of its own).
    const { count: autoPicks } = await admin
      .from('draft_actions')
      .select('*', { count: 'exact', head: true })
      .eq('is_auto', true)
      .eq('fantasy_team_id', teamIdByManager.get('Mookie')!);
    expect(autoPicks).toBe(4);
  });
});

describe('profile photos', () => {
  // A 1x1 PNG.
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64');
  const idOf = async (name: string) => (await clients.get(name)!.auth.getUser()).data.user!.id;

  it('keeps the Google photo from sign-in', async () => {
    const email = 'photo@example.com';
    const picture = 'https://lh3.googleusercontent.com/a/example';
    const { data } = await admin.auth.admin.createUser({ email, email_confirm: true, user_metadata: { full_name: 'Pat Photo', avatar_url: picture } });
    const { data: profile } = await admin.from('profiles').select('google_avatar_url').eq('id', data.user!.id).single();
    expect(profile!.google_avatar_url).toBe(picture);

    // A later sign-in with a new Google photo follows along.
    await admin.auth.admin.updateUserById(data.user!.id, { user_metadata: { avatar_url: `${picture}2` } });
    const { data: after } = await admin.from('profiles').select('google_avatar_url').eq('id', data.user!.id).single();
    expect(after!.google_avatar_url).toBe(`${picture}2`);
    await admin.auth.admin.deleteUser(data.user!.id);
  });

  it('lets people upload to their own folder only, and point their profile only at it', async () => {
    const kyle = clients.get('Kyle')!;
    const kyleId = await idOf('Kyle');
    const alexId = await idOf('Alex');
    const bucket = kyle.storage.from('avatars');

    expect((await bucket.upload(`${kyleId}/1.png`, png, { contentType: 'image/png' })).error).toBeNull();
    expect((await bucket.upload(`${alexId}/1.png`, png, { contentType: 'image/png' })).error).not.toBeNull();
    // Anyone can see it through the bucket's public URL.
    expect((await fetch(bucket.getPublicUrl(`${kyleId}/1.png`).data.publicUrl)).status).toBe(200);

    expect((await kyle.from('profiles').update({ avatar_path: `${kyleId}/1.png` }).eq('id', kyleId)).error).toBeNull();
    expect((await kyle.from('profiles').update({ avatar_path: `${alexId}/1.png` }).eq('id', kyleId)).error).not.toBeNull();
    expect((await kyle.from('profiles').update({ avatar_path: 'https://example.com/x.png' }).eq('id', kyleId)).error).not.toBeNull();

    // Removing the upload: clear the path, delete the file.
    expect((await kyle.from('profiles').update({ avatar_path: null }).eq('id', kyleId)).error).toBeNull();
    expect((await bucket.remove([`${kyleId}/1.png`])).error).toBeNull();
    expect((await admin.storage.from('avatars').list(kyleId)).data).toHaveLength(0);
  });
});

describe('player stats', () => {
  it("returns a hitter's season, game log and past seasons from the MLB API", async () => {
    const { data, error } = await clients.get('Kyle')!.functions.invoke('player-stats', { body: { playerId: 592450, season: 2025 } });
    expect(error).toBeNull();
    expect(data.person).toMatchObject({ id: 592450, name: 'Aaron Judge' });
    expect(data.season.pa).toBeGreaterThan(400);
    expect(data.games.length).toBeGreaterThan(100);
    expect(data.games[0].date > data.games.at(-1).date).toBe(true);
    expect(data.games[0].opponent).toMatch(/^[A-Z]{2,3}$/);
    expect(data.years[0].season).toBe(2024);
  });

  it('needs a signed-in user', async () => {
    const anon = createClient(url, publishableKey, { auth: { persistSession: false } });
    const { error } = await anon.functions.invoke('player-stats', { body: { playerId: 592450, season: 2025 } });
    expect(error).not.toBeNull();
  });
});

describe('live stats poller', () => {
  let season2025: string;

  beforeAll(async () => {
    const { data: s } = await admin.from('seasons').select('league_id').eq('id', SEASON_ID).single();
    const { data, error } = await admin.from('seasons').insert({ league_id: s!.league_id, year: 2025, status: 'complete' }).select('id').single();
    if (error) throw error;
    season2025 = data.id;
  });

  it('only lets the commissioner reload a postseason', async () => {
    expect((await call('Kyle', 'poll-games', { seasonId: season2025 })).error).toMatch(/commissioner/);
    const anon = createClient(url, publishableKey, { auth: { persistSession: false } });
    expect((await anon.functions.invoke('poll-games', { body: { seasonId: season2025 } })).error).not.toBeNull();
    const cron = await fetch(`${url}/functions/v1/poll-games`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-poller-secret': 'guess' },
      body: '{}',
    });
    expect(cron.status).toBe(403);
  });

  it("loads the 2025 postseason's games and box scores", async () => {
    const result = (await call('Daniel', 'poll-games', { seasonId: season2025 })) as { games?: number; battingLines?: number };
    expect(result.games).toBeGreaterThan(30);
    expect(result.battingLines).toBeGreaterThan(500);

    // The World Series went 7 games, numbered 1 to 7.
    const { data: ws } = await admin
      .from('mlb_games')
      .select('game_pk, status, series_game_number, games_in_series, final_seen_at')
      .eq('season_year', 2025)
      .eq('game_type', 'W')
      .order('series_game_number');
    expect(ws!.map((g) => g.series_game_number)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(ws!.every((g) => g.status === 'Final' && g.games_in_series === 7 && g.final_seen_at)).toBe(true);

    // Each game keeps its final linescore: Game 3 went 18 innings.
    const { data: game3 } = await admin.from('mlb_games').select('live').eq('game_pk', ws![2].game_pk).single();
    expect(game3!.live).toMatchObject({ inning: 18 });
    expect(ws!.every((g) => g.status === 'Final')).toBe(true);

    // Freddie Freeman's walk-off home run in the 18th inning of Game 3.
    const { data: freeman } = await admin
      .from('player_game_stats')
      .select('hr, tb, ab')
      .eq('game_pk', ws![2].game_pk)
      .eq('mlb_player_id', 518692)
      .single();
    expect(freeman!.hr).toBeGreaterThanOrEqual(1);
    expect(freeman!.tb).toBeGreaterThanOrEqual(4);

    // Wild Card series are best of 3.
    const { data: wc } = await admin.from('mlb_games').select('series_game_number, games_in_series').eq('season_year', 2025).eq('game_type', 'F');
    expect(wc!.length).toBeGreaterThanOrEqual(8);
    expect(wc!.every((g) => g.games_in_series === 3 && g.series_game_number! <= 3)).toBe(true);
  });

  it("broadcasts a poll's changes to open apps in one message", async () => {
    const kyle = clients.get('Kyle')!;
    const received: { games?: { game_pk: number; detailed_state: string }[]; reload?: boolean }[] = [];
    const channel = kyle.channel('scores', { config: { private: true } }).on('broadcast', { event: 'changes' }, ({ payload }) => received.push(payload));
    await new Promise<void>((resolve) => channel.subscribe((s) => s === 'SUBSCRIBED' && resolve()));

    // Knock one game's row out of date, then reload: the poll puts it back and broadcasts that.
    const { data: game } = await admin.from('mlb_games').select('game_pk').eq('season_year', 2025).eq('game_type', 'W').eq('series_game_number', 7).single();
    expect((await admin.from('mlb_games').update({ detailed_state: 'Stale' }).eq('game_pk', game!.game_pk)).error).toBeNull();
    expect((await call('Daniel', 'poll-games', { seasonId: season2025 })).error).toBeUndefined();

    for (let i = 0; i < 50 && !received.some((m) => m.games?.some((g) => g.game_pk === game!.game_pk)); i++) {
      await new Promise((r) => setTimeout(r, 100));
    }
    kyle.removeChannel(channel);
    const message = received.find((m) => m.games?.some((g) => g.game_pk === game!.game_pk));
    if (!message) {
      // What the database sent, and any send error it logged, to make a failure explain itself.
      const db = 'supabase_db_baggery';
      const sent = execSync(`docker exec ${db} psql -U postgres -tAc "select topic, event, private, left(payload::text, 120) from realtime.messages order by inserted_at desc limit 5"`, { encoding: 'utf8' });
      const logs = execSync(`docker logs ${db} 2>&1 | grep -i 'scores broadcast' | tail -3 || true`, { encoding: 'utf8' });
      console.log({ received, sent, logs });
    }
    expect(message?.games?.find((g) => g.game_pk === game!.game_pk)?.detailed_state).toBe('Final');
  });

  it('is readable by signed-in users', async () => {
    const { count } = await clients.get('Kyle')!.from('player_game_stats').select('*', { count: 'exact', head: true });
    expect(count).toBeGreaterThan(500);
  });

  it('points the cron job at itself on setup', async () => {
    const res = await fetch(`${url}/functions/v1/poll-games`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ setup: true }),
    });
    expect(await res.json()).toEqual({ ok: true });
  });
});

describe('almanac', () => {
  const FREEMAN = 518692;
  let leagueId: string;
  let ana: string;

  // A finished 2025 for the league (its box scores came in above), as if imported from the old
  // sheets: Ana wins with Freddie Freeman, Ben goes out after round 2 and Cal after round 1.
  beforeAll(async () => {
    const { data: season } = await admin.from('seasons').select('id, league_id').eq('year', 2025).single();
    leagueId = season!.league_id;
    // An imported season's teams keep the manager they're given (see team_managers.sql).
    expect((await admin.from('seasons').update({ imported_at: new Date().toISOString() }).eq('id', season!.id)).error).toBeNull();
    const { data: managers, error } = await admin
      .from('league_managers')
      .insert(['Ana', 'Ben', 'Cal'].map((name) => ({ league_id: leagueId, name })))
      .select('id, name');
    if (error) throw error;
    const id = (name: string) => managers!.find((m) => m.name === name)!.id;
    ana = id('Ana');
    const { data: teams, error: teamError } = await admin
      .from('fantasy_teams')
      .insert([
        { season_id: season!.id, slot: 1, manager_id: ana, eliminated_after_round: null },
        { season_id: season!.id, slot: 2, manager_id: id('Ben'), eliminated_after_round: 2 },
        { season_id: season!.id, slot: 3, manager_id: id('Cal'), eliminated_after_round: 1 },
      ])
      .select('id, slot');
    if (teamError) throw teamError;
    const { data: others } = await admin.from('player_game_stats').select('mlb_player_id').neq('mlb_player_id', FREEMAN).gt('tb', 0).limit(50);
    const [ben, cal] = [...new Set(others!.map((o) => o.mlb_player_id))];
    const team = (slot: number) => teams!.find((t) => t.slot === slot)!.id;
    const { error: spellError } = await admin.from('roster_spells').insert(
      [[1, FREEMAN], [2, ben], [3, cal]].map(([slot, player]) => ({
        season_id: season!.id, fantasy_team_id: team(slot), mlb_player_id: player, from_at: '2025-09-01T00:00:00Z',
      })),
    );
    if (spellError) throw spellError;
  });

  it('needs a signed-in user and a league', async () => {
    const anon = createClient(url, publishableKey, { auth: { persistSession: false } });
    expect((await anon.functions.invoke('almanac', { body: { leagueId } })).error).not.toBeNull();
    expect((await call('Kyle', 'almanac', {})).error).toMatch(/leagueId/);
  });

  it('builds the Almanac from every finished season in one request', async () => {
    const { data, error } = await clients.get('Kyle')!.functions.invoke('almanac', { body: { leagueId } });
    expect(error).toBeNull();
    const managers = new Map<string, string>(data.managers);
    const players = new Map<number, string>(data.players);
    expect(data.almanac.champions.map((c: { year: number }) => c.year)).toEqual([2025]);
    expect(data.almanac.champions[0].champion.managerKey).toBe(ana);
    expect(managers.get(ana)).toBe('Ana');
    expect(data.almanac.careers.map((c: { name: string }) => c.name).sort()).toEqual(['Ana', 'Ben', 'Cal']);
    // Freeman's postseason counts for Ana, under his name.
    expect(players.get(FREEMAN)).toMatch(/Freeman/);
    const freeman = data.almanac.bestPlayerSeasons.find((p: { playerId: number }) => p.playerId === FREEMAN);
    expect(freeman).toMatchObject({ managerKey: ana, year: 2025 });
    expect(freeman.tb).toBeGreaterThan(10);
    expect(new Map(data.almanac.playersByManager).get(ana)).toEqual([expect.objectContaining({ playerId: FREEMAN, years: [2025] })]);
    expect(data.scouting).toHaveLength(3);
  });
});
