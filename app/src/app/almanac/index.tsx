import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import type { ManagerCareer } from '@core/almanac.ts';
import { SERIES } from '@core/scoreboard.ts';

import { LeaderBars, Leaderboard, Pennant, ScoutingGrid, managerColor } from '@/components/almanac-charts';
import { Card } from '@/components/card';
import { MomentCard } from '@/components/duel';
import { HeadToHead } from '@/components/head-to-head';
import { Screen } from '@/components/screen';
import { StatTable } from '@/components/stat-table';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { openManager, ordinal } from '@/components/manager-link';
import { type AlmanacData, useAlmanac } from '@/lib/almanac';
import { SCOUTING_STATS } from '@/lib/scouting';

type View_ = 'league' | 'managers' | 'h2h';
const VIEWS: View_[] = ['league', 'managers', 'h2h'];

/**
 * Every finished season at once: the league's record book, every manager's career, and any two
 * managers compared. /almanac?view=h2h&a=daniel&b=darren opens on a head-to-head.
 */
export default function AlmanacScreen() {
  const params = useLocalSearchParams<{ view?: string; a?: string; b?: string }>();
  const { data, error } = useAlmanac();
  const [view, setView] = useState<View_>(VIEWS.find((v) => v === params.view) ?? 'league');
  return (
    <Screen>
      <Segmented value={view} onChange={setView} />
      {error && <ThemedText themeColor="danger">{error}</ThemedText>}
      {!data && !error && <ThemedText themeColor="textSecondary">Loading every season…</ThemedText>}
      {data && !data.almanac.champions.length && (
        <ThemedText themeColor="textSecondary">The Almanac fills in once a season is finished.</ThemedText>
      )}
      {data && data.almanac.champions.length > 0 && view === 'league' && <League data={data} />}
      {data && data.almanac.champions.length > 0 && view === 'managers' && <Managers data={data} />}
      {data && data.almanac.champions.length > 0 && view === 'h2h' && <HeadToHead data={data} a={params.a} b={params.b} />}
    </Screen>
  );
}

const seriesGame = (gameType: string, n: number | null) => `${SERIES.find((s) => s.gameType === gameType)?.label ?? gameType}${n ?? ''}`;

function League({ data }: { data: AlmanacData }) {
  const a = data.almanac;
  const player = (id: number) => data.players.get(id) ?? `Player ${id}`;
  const moves = [...a.redrafts].sort((x, y) => y.addedTb - y.droppedTb - (x.addedTb - x.droppedTb)).slice(0, 6);
  const who = (key: string) => ({ name: data.managers.get(key) ?? '?', color: managerColor(data, key) });
  return (
    <>
      <Card title="Champions">
        <View style={styles.pennants}>
          {/* Oldest first, so the years read left to right, top to bottom. */}
          {[...a.champions].sort((x, y) => x.year - y.year).map((c) => (
            <Pennant
              key={c.year}
              year={c.year}
              name={data.managers.get(c.champion.managerKey) ?? '?'}
              bags={c.champion.rounds.at(-1)?.tb ?? 0}
              color={managerColor(data, c.champion.managerKey)}
              onPress={() => openManager(data, c.champion.managerKey)}
            />
          ))}
        </View>
      </Card>

      <Card title="Most titles">
        <LeaderBars
          rows={a.careers
            .filter((c) => c.titles > 0)
            .map((c) => ({ key: c.key, name: c.name, value: c.titles, color: managerColor(data, c.key), onPress: () => openManager(data, c.key) }))}
          format={(n) => '🏆'.repeat(n)}
        />
      </Card>

      <Card title="Career bags">
        <LeaderBars
          rows={[...a.careers]
            .sort((x, y) => y.bags - x.bags)
            .map((c) => ({
              key: c.key,
              name: c.name,
              value: c.bags,
              color: managerColor(data, c.key),
              onPress: () => openManager(data, c.key),
            }))}
        />
      </Card>

      {/* The record book's headliners, as big cards in the record holder's color. */}
      <View style={styles.records}>
        {(() => {
          const round = ([1, 2, 3] as const).map((r) => a.bestRounds[r][0]).filter(Boolean).sort((x, y) => y.tb - x.tb)[0];
          const game = a.bestPlayerGames[0];
          const season = a.bestPlayerSeasons[0];
          const cut = a.closestCuts[0];
          const move = moves[0];
          return (
            <>
              {round && (
                <MomentCard emoji="🔥" title="Best round ever" color={managerColor(data, round.managerKey)} headline={`${round.tb} bags`}
                  detail={`${data.managers.get(round.managerKey)}, ${round.year} round ${round.round}`} />
              )}
              {game && (
                <MomentCard emoji="💣" title="Biggest single game" color={managerColor(data, game.managerKey)} headline={`${game.tb} bags`}
                  detail={`${player(game.playerId)}, ${game.year} ${seriesGame(game.gameType, game.seriesGameNumber)} for ${data.managers.get(game.managerKey)}`} />
              )}
              {season && (
                <MomentCard emoji="⭐" title="Best player season" color={managerColor(data, season.managerKey)} headline={`${season.tb} bags`}
                  detail={`${player(season.playerId)}, ${season.year} for ${data.managers.get(season.managerKey)}`} />
              )}
              {cut && (
                <MomentCard emoji="✂️" title="Closest cut" color={managerColor(data, cut.out.managerKey)} headline={cut.margin === 0 ? 'Tiebreak' : `By ${cut.margin}`}
                  detail={`${cut.year} round ${cut.round}: ${data.managers.get(cut.through.managerKey)} ${cut.through.tb}, ${data.managers.get(cut.out.managerKey)} ${cut.out.tb}`} />
              )}
              {move && (
                <MomentCard emoji="🔁" title="Best redraft" color={managerColor(data, move.managerKey)} headline={`+${move.addedTb - move.droppedTb}`}
                  detail={`${data.managers.get(move.managerKey)} took ${player(move.add)} for ${player(move.drop)}, ${move.year}`} />
              )}
            </>
          );
        })()}
      </View>

      <Card title="Best rounds">
        <Leaderboard
          rows={([1, 2, 3] as const)
            .flatMap((r) => a.bestRounds[r])
            .sort((x, y) => y.tb - x.tb)
            .slice(0, 8)
            .map((r, i) => ({
              key: `${i}`,
              title: `Round ${r.round}, ${r.year}`,
              tags: [],
              manager: who(r.managerKey),
              label: `${r.tb} bags`,
              onPress: () => openManager(data, r.managerKey),
            }))}
        />
      </Card>

      <Card title="Biggest single games">
        <Leaderboard
          rows={a.bestPlayerGames.slice(0, 8).map((g, i) => ({
            key: `${i}`,
            title: player(g.playerId),
            tags: [`${g.year} ${seriesGame(g.gameType, g.seriesGameNumber)}`],
            manager: who(g.managerKey),
            label: `${g.tb} bags`,
          }))}
        />
      </Card>

      <Card title="Best player seasons">
        <ThemedText type="small" themeColor="textSecondary">Most bags one player scored for one team in a postseason.</ThemedText>
        <Leaderboard
          rows={a.bestPlayerSeasons.slice(0, 8).map((p, i) => ({
            key: `${i}`,
            title: player(p.playerId),
            tags: [`${p.year}`],
            manager: who(p.managerKey),
            label: `${p.tb} bags`,
          }))}
        />
      </Card>

      <Card title="Closest cuts">
        <ThemedText type="small" themeColor="textSecondary">The last team through against the first team out.</ThemedText>
        <Leaderboard
          rows={a.closestCuts.slice(0, 6).map((c, i) => ({
            key: `${i}`,
            title: `${data.managers.get(c.through.managerKey)} ${c.through.tb}, ${data.managers.get(c.out.managerKey)} ${c.out.tb}`,
            tags: [`${c.year}`, `Round ${c.round}`, `${data.managers.get(c.out.managerKey)} out`],
            manager: who(c.through.managerKey),
            label: c.margin === 0 ? 'Tiebreak' : `By ${c.margin}`,
          }))}
        />
      </Card>

      <Card title="Best redrafts">
        <ThemedText type="small" themeColor="textSecondary">
          Bags the added player scored for the team, minus what the dropped player scored the rest of the way.
        </ThemedText>
        <Leaderboard
          rows={moves.map((m, i) => ({
            key: `${i}`,
            title: `${player(m.add)} for ${player(m.drop)}`,
            tags: [`${m.year} Draft ${m.draftNumber}`, `${m.addedTb} vs ${m.droppedTb}`],
            manager: who(m.managerKey),
            label: `+${m.addedTb - m.droppedTb}`,
          }))}
        />
      </Card>
    </>
  );
}

function Managers({ data }: { data: AlmanacData }) {
  const theme = useTheme();
  return (
    <>
    <StatTable<ManagerCareer>
      rows={data.almanac.careers}
      rowKey={(c) => c.key}
      labelHeader="Manager"
      label={(c) => <ThemedText type="smallBold" style={{ color: theme.accent }} numberOfLines={1}>{c.name}</ThemedText>}
      onPressRow={(c) => openManager(data, c.key)}
      columns={[
        { key: 'titles', label: 'Titles', value: (c) => c.titles },
        { key: 'runnerUps', label: '2nd', value: (c) => c.runnerUps, width: 48 },
        { key: 'seasons', label: 'Seasons', value: (c) => c.seasons, width: 84 },
        { key: 'avg', label: 'Avg fin', value: (c) => c.averageFinish, format: (c) => c.averageFinish.toFixed(1), ascending: true, width: 72 },
        { key: 'best', label: 'Best', value: (c) => c.bestFinish, format: (c) => ordinal(c.bestFinish), ascending: true, width: 56 },
        { key: 'cuts', label: 'Cuts', value: (c) => c.roundsSurvived, width: 56 },
        { key: 'bags', label: 'Bags', value: (c) => c.bags, width: 60 },
        { key: 'perRound', label: 'Bags/rd', value: (c) => c.bagsPerRound, format: (c) => c.bagsPerRound.toFixed(1), width: 72 },
      ]}
    />
    <Card title="Scouting grid">
      <ThemedText type="small" themeColor="textSecondary">
        Every manager&apos;s skills side by side: greener is better than the rest of the league, redder is worse. Faded: fewer than 3 seasons, too few to read much into. Tap a manager to see their scouting report.
      </ThemedText>
      <ScoutingGrid data={data} stats={SCOUTING_STATS.filter((st) => !st.neutral)} onPick={(key) => openManager(data, key)} />
    </Card>
    </>
  );
}

function Segmented({ value, onChange }: { value: View_; onChange: (v: View_) => void }) {
  const theme = useTheme();
  const tabs: [View_, string][] = [
    ['league', 'League'],
    ['managers', 'Managers'],
    ['h2h', 'Head-to-head'],
  ];
  return (
    <ThemedView type="backgroundElement" elevation="sunken" style={styles.segmented}>
      {tabs.map(([key, label]) => (
        <Pressable
          key={key}
          onPress={() => onChange(key)}
          style={[styles.segment, value === key && { backgroundColor: theme.segment, boxShadow: theme.raised }]}>
          <ThemedText type="smallBold" themeColor={value === key ? 'text' : 'textSecondary'}>{label}</ThemedText>
        </Pressable>
      ))}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  line: { flexDirection: 'row', alignItems: 'baseline', gap: Spacing.two },
  records: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  pennants: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two, justifyContent: 'center' },
  lineText: { flex: 1 },
  segmented: { flexDirection: 'row', padding: Spacing.half, borderRadius: Radius.lg },
  segment: { flex: 1, alignItems: 'center', paddingVertical: Spacing.two, borderRadius: Radius.md },
});
