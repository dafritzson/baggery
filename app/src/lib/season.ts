import { createContext, createElement, type ReactNode, use, useCallback, useEffect, useRef, useState } from 'react';

import type { DraftAction } from '@core/draft.ts';

import { useAuth } from '@/lib/auth';
import { supabase } from '@/lib/supabase';

export interface Team {
  id: string;
  manager_name: string;
  name: string | null;
  user_id: string | null;
  autodraft: boolean;
  eliminated_after_round: number | null;
}

export interface Draft {
  id: string;
  number: number;
  kind: 'initial' | 'redraft';
  status: 'scheduled' | 'live' | 'complete';
  fantasy_round: number;
  pick_order: string[];
  rounds: number;
  locks_at: string | null;
}

export interface DraftActionRow {
  draft_id: string;
  action_number: number;
  fantasy_team_id: string;
  type: 'pick' | 'yield';
  add_player_id: number | null;
  drop_player_id: number | null;
  is_auto: boolean;
  created_at: string;
}

export interface Spell {
  fantasy_team_id: string;
  mlb_player_id: number;
  from_at: string;
  to_at: string | null;
  dropped_by_draft_id: string | null;
}

export interface Player {
  id: number;
  full_name: string;
  primary_position: string | null;
}

export interface PoolEntry {
  mlb_player_id: number;
  mlb_team_id: number;
  regular_season_tb: number;
  plate_appearances: number;
  /** Null with no at-bats. */
  slg: number | null;
  ops_plus: number | null;
  on_postseason_roster: boolean;
}

export interface MlbTeam {
  id: number;
  name: string;
  abbreviation: string;
  eliminated: boolean;
  wins: number | null;
  has_bye: boolean;
}

export interface SeasonData {
  season: { id: string; year: number; status: string; commissioner_team_id: string | null };
  teams: Team[];
  drafts: Draft[];
  actions: DraftActionRow[];
  spells: Spell[];
  pool: PoolEntry[];
  players: Map<number, Player>;
  mlbTeams: Map<number, MlbTeam>;
  /** Pool entry for a player, which also gives their MLB team. */
  poolByPlayer: Map<number, PoolEntry>;
  myTeam: Team | null;
  isCommissioner: boolean;
}

const LIVE_TABLES = [
  'drafts',
  'draft_actions',
  'roster_spells',
  'fantasy_teams',
  'season_player_pool',
] as const;

async function fetchSeason(userId: string | undefined): Promise<SeasonData | null> {
  const { data: season } = await supabase
    .from('seasons')
    .select('id, year, status, commissioner_team_id')
    .order('year', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!season) return null;

  const [teams, drafts, spells, pool, seasonTeams] = await Promise.all([
    supabase.from('fantasy_teams').select('*').eq('season_id', season.id).order('manager_name'),
    supabase.from('drafts').select('*').eq('season_id', season.id).order('number'),
    supabase.from('roster_spells').select('*').eq('season_id', season.id),
    supabase
      .from('season_player_pool')
      .select(
        'mlb_player_id, mlb_team_id, regular_season_tb, plate_appearances, slg, ops_plus, on_postseason_roster, player:mlb_players(id, full_name, primary_position)',
      )
      .eq('season_id', season.id),
    supabase
      .from('season_mlb_teams')
      .select('eliminated, wins, has_bye, team:mlb_teams(id, name, abbreviation)')
      .eq('season_id', season.id),
  ]);
  const draftIds = (drafts.data ?? []).map((d) => d.id);
  const { data: actions } = await supabase
    .from('draft_actions')
    .select('*')
    .in('draft_id', draftIds)
    .order('action_number');

  const players = new Map<number, Player>();
  const poolRows: PoolEntry[] = [];
  for (const row of pool.data ?? []) {
    const player = row.player as unknown as Player;
    players.set(player.id, player);
    poolRows.push({
      mlb_player_id: row.mlb_player_id,
      mlb_team_id: row.mlb_team_id,
      regular_season_tb: row.regular_season_tb,
      plate_appearances: row.plate_appearances,
      // Postgres numeric arrives as a string.
      slg: row.slg === null ? null : Number(row.slg),
      ops_plus: row.ops_plus,
      on_postseason_roster: row.on_postseason_roster,
    });
  }
  const mlbTeams = new Map<number, MlbTeam>();
  for (const row of seasonTeams.data ?? []) {
    const team = row.team as unknown as Pick<MlbTeam, 'id' | 'name' | 'abbreviation'>;
    mlbTeams.set(team.id, { ...team, eliminated: row.eliminated, wins: row.wins, has_bye: row.has_bye });
  }

  const teamRows = (teams.data ?? []) as Team[];
  const myTeam = teamRows.find((t) => t.user_id === userId) ?? null;
  return {
    season,
    teams: teamRows,
    drafts: (drafts.data ?? []) as Draft[],
    actions: (actions ?? []) as DraftActionRow[],
    spells: (spells.data ?? []) as Spell[],
    pool: poolRows,
    players,
    mlbTeams,
    poolByPlayer: new Map(poolRows.map((p) => [p.mlb_player_id, p])),
    myTeam,
    isCommissioner: !!myTeam && myTeam.id === season.commissioner_team_id,
  };
}

interface SeasonState {
  data: SeasonData | null;
  loading: boolean;
  refetch: () => Promise<void>;
}

const SeasonContext = createContext<SeasonState>({ data: null, loading: true, refetch: async () => {} });

/** Loads the current season once for the whole app and keeps it live. */
export function SeasonProvider({ children }: { children: ReactNode }) {
  return createElement(SeasonContext, { value: useLiveSeason() }, children);
}

export function useSeason(): SeasonState {
  return use(SeasonContext);
}

/** The current season, kept live: any change to drafts or rosters triggers a refetch. */
function useLiveSeason(): SeasonState {
  const { session } = useAuth();
  const userId = session?.user.id;
  const [data, setData] = useState<SeasonData | null>(null);
  const [loading, setLoading] = useState(true);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refetch = useCallback(async () => {
    const next = await fetchSeason(userId);
    setData(next);
    setLoading(false);
  }, [userId]);

  useEffect(() => {
    const scheduleRefetch = (delay = 150) => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(refetch, delay);
    };
    scheduleRefetch(0);
    // Unique topic: supabase.channel() reuses a same-named channel, which may still be subscribed.
    let channel = supabase.channel(`season-${Date.now()}-${Math.random()}`);
    for (const table of LIVE_TABLES) {
      channel = channel.on('postgres_changes', { event: '*', schema: 'public', table }, () => scheduleRefetch());
    }
    channel.subscribe();
    return () => {
      if (timer.current) clearTimeout(timer.current);
      supabase.removeChannel(channel);
    };
  }, [refetch]);

  return { data, loading, refetch };
}

/** Converts stored actions for one draft into the shared core's format. */
export function coreActions(actions: DraftActionRow[], draftId: string): DraftAction[] {
  return actions
    .filter((a) => a.draft_id === draftId)
    .map((a) =>
      a.type === 'yield'
        ? { type: 'yield', teamId: a.fantasy_team_id }
        : {
            type: 'pick',
            teamId: a.fantasy_team_id,
            addPlayerId: a.add_player_id!,
            dropPlayerId: a.drop_player_id ?? undefined,
          },
    );
}

/** Each team's current players (not dropped). */
export function currentRosters(data: SeasonData): Map<string, number[]> {
  const rosters = new Map<string, number[]>(data.teams.map((t) => [t.id, []]));
  for (const s of data.spells) {
    if (s.dropped_by_draft_id === null) rosters.get(s.fantasy_team_id)?.push(s.mlb_player_id);
  }
  return rosters;
}

export function teamLabel(team: Team | undefined): string {
  if (!team) return '—';
  return team.name ? `${team.name} (${team.manager_name})` : team.manager_name;
}
