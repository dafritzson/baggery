import type { SeasonData } from '@/lib/season';

export function formatLockTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  });
}

/** A player's headshot from MLB's image CDN (a generic silhouette if they have none), `width` pixels wide. */
export function headshotUrl(playerId: number, width = 213): string {
  return `https://img.mlbstatic.com/mlb-photos/image/upload/d_people:generic:headshot:67:current.png/w_${width},q_auto:best/v1/people/${playerId}/headshot/67/current`;
}

export function mlbTeamAbbr(data: SeasonData, playerId: number): string {
  const entry = data.poolByPlayer.get(playerId);
  return (entry && data.mlbTeams.get(entry.mlb_team_id)?.abbreviation) ?? '';
}

/** "Aaron Judge · RF · NYY" */
export function playerLine(data: SeasonData, playerId: number): string {
  const player = data.players.get(playerId);
  if (!player) return `Player ${playerId}`;
  return [player.full_name, player.primary_position, mlbTeamAbbr(data, playerId)].filter(Boolean).join(' · ');
}

export function playerName(data: SeasonData, playerId: number): string {
  return data.players.get(playerId)?.full_name ?? `Player ${playerId}`;
}

/** "2026-09-20" → "9/20" */
export function shortDate(date: string): string {
  const [, m, d] = date.split('-');
  return `${Number(m)}/${Number(d)}`;
}
