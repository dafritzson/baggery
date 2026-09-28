// The league log (see the league_log migration). Written in the same transaction as the action it
// records, with names as they are at the time.

import type { Tx, sql } from './db.ts';

/** Logs an action taken with commissioner powers. */
export async function logCommissioner(
  tx: Tx | typeof sql,
  entry: { seasonId: string; userId: string; action: string; summary: string; details?: Record<string, unknown> },
): Promise<void> {
  await tx`
    insert into league_log (league_id, season_id, user_id, action, summary, details, commissioner)
    select league_id, id, ${entry.userId}, ${entry.action}, ${entry.summary}, ${tx.json(JSON.parse(JSON.stringify(entry.details ?? {})))}, true
    from seasons where id = ${entry.seasonId}`;
}

/** A team as the log names it: its name, else whose it is. */
export async function teamLabel(tx: Tx, teamId: string): Promise<string> {
  const [row] = await tx`select private.team_label(${teamId}) as label`;
  return (row?.label as string | null) ?? 'a team';
}

export async function playerName(tx: Tx, playerId: number): Promise<string> {
  const [row] = await tx`select full_name from mlb_players where id = ${playerId}`;
  return (row?.full_name as string | undefined) ?? `player ${playerId}`;
}
