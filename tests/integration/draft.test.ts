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
const MANAGERS = ['Alex', 'Curtis', 'Daniel', 'Darren', 'James', 'Kyle', 'Mookie'];
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
  const { data: teams } = await admin.from('fantasy_teams').select('id, manager_name').eq('season_id', SEASON_ID);
  for (const t of teams!) {
    teamIdByManager.set(t.manager_name, t.id);
    managerByTeamId.set(t.id, t.manager_name);
  }
  const { data: draft } = await admin.from('drafts').select('id').eq('season_id', SEASON_ID).eq('number', 1).single();
  draftId = draft!.id;
});

describe('season setup', () => {
  it('creates a profile from the Google-style name', async () => {
    const { data } = await clients.get('Kyle')!.from('profiles').select('display_name');
    expect(data!.map((p) => p.display_name)).toContain('Kyle');
  });

  it('lets each manager claim exactly one team', async () => {
    for (const m of MANAGERS) {
      const { error } = await clients.get(m)!.rpc('claim_team', { p_team_id: teamIdByManager.get(m) });
      expect(error).toBeNull();
    }
    const { error } = await clients.get('Kyle')!.rpc('claim_team', { p_team_id: teamIdByManager.get('Alex') });
    expect(error?.message).toMatch(/already/);
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
