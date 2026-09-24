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
    const { count: autoPicks } = await admin.from('draft_actions').select('*', { count: 'exact', head: true }).eq('is_auto', true);
    expect(autoPicks).toBe(4);
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
