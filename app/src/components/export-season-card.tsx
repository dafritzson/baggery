import { Platform } from 'react-native';

import { type SeasonRecord, exportSeason } from '@core/season-import.ts';

import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { ThemedText } from '@/components/themed-text';
import { type SeasonData, useSeason } from '@/lib/season';
import { ownerName } from '@/lib/teams';

/** The season picked in the top bar, in the shape exportSeason takes. */
function seasonRecord(data: SeasonData): SeasonRecord {
  return {
    year: data.season.year,
    teams: [...data.teams]
      .sort((a, b) => a.slot - b.slot)
      .map((t) => {
        const manager = ownerName(data, t) ?? t.name ?? `Team ${t.slot}`;
        // Past seasons' teams are named after their manager: no separate team name.
        return { id: t.id, manager, name: t.name && t.name !== manager ? t.name : null, eliminatedAfterRound: t.eliminated_after_round };
      }),
    drafts: data.drafts.map((d) => ({
      number: d.number,
      locksAt: d.locks_at,
      pickOrder: d.pick_order,
      actions: data.actions
        .filter((a) => a.draft_id === d.id)
        .sort((a, b) => a.action_number - b.action_number)
        .map((a) => ({ teamId: a.fantasy_team_id, type: a.type, add: a.add_player_id, drop: a.drop_player_id })),
    })),
    players: [...data.players.values()].map((p) => ({
      id: p.id,
      fullName: p.full_name,
      teamId: data.poolByPlayer.get(p.id)?.mlb_team_id ?? 0,
    })),
    mlbTeams: [...data.mlbTeams.values()].map((t) => ({
      id: t.id,
      name: t.name,
      abbreviation: t.abbreviation,
      league: t.league,
      eliminated: t.eliminated,
    })),
  };
}

/** Saves a text file in the browser. */
function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Saves the picked season's own data as baggery-<year>-exported-<date>.json (dated, so exports
 * never share a name; the browser keeps both anyway): the managers, every draft's order
 * and picks, and who went out when (core exportSeason). MLB's games and stats aren't in it; they
 * can always be loaded again. A finished season's file imports again (Settings → Past seasons).
 */
export function ExportSeasonCard() {
  const { data } = useSeason();
  if (!data) return null;
  const year = data.season.year;
  return (
    <Card title={`Export · ${year}`}>
      <ThemedText type="small" themeColor="textSecondary">
        Save {year}&apos;s drafts as a file: every manager&apos;s picks in order, and who went out when. That&apos;s all the
        league puts in; MLB&apos;s stats can always be loaded again.
      </ThemedText>
      {Platform.OS === 'web' ? (
        <Button
          label={`Export ${year}`}
          variant="secondary"
          onPress={() =>
            download(
              `baggery-${year}-exported-${new Date().toISOString().slice(0, 10)}.json`,
              `${JSON.stringify(exportSeason(seasonRecord(data)), null, 2)}\n`,
            )
          }
        />
      ) : (
        <ThemedText themeColor="textSecondary">Export from the web app.</ThemedText>
      )}
    </Card>
  );
}
