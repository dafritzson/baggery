import { router } from 'expo-router';
import { type ReactNode, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import type { ManagerCareer } from '@core/almanac.ts';
import { SERIES } from '@core/scoreboard.ts';

import { LeaderBars, Pennant, RivalryGrid, managerColor } from '@/components/almanac-charts';
import { Card } from '@/components/card';
import { MomentCard } from '@/components/duel';
import { Screen } from '@/components/screen';
import { StatTable } from '@/components/stat-table';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { ManagerLink, openManager, ordinal } from '@/components/manager-link';
import { type AlmanacData, managerSlug, useAlmanac } from '@/lib/almanac';

type View_ = 'league' | 'managers';

/** Every finished season at once: the league's record book, and every manager's career. */
export default function AlmanacScreen() {
  const { data, error } = useAlmanac();
  const [view, setView] = useState<View_>('league');
  return (
    <Screen>
      <ThemedText type="subtitle">Almanac</ThemedText>
      <Segmented value={view} onChange={setView} />
      {error && <ThemedText themeColor="danger">{error}</ThemedText>}
      {!data && !error && <ThemedText themeColor="textSecondary">Loading every season…</ThemedText>}
      {data && !data.almanac.champions.length && (
        <ThemedText themeColor="textSecondary">The Almanac fills in once a season is finished.</ThemedText>
      )}
      {data && data.almanac.champions.length > 0 && (view === 'league' ? <League data={data} /> : <Managers data={data} />)}
    </Screen>
  );
}

const seriesGame = (gameType: string, n: number | null) => `${SERIES.find((s) => s.gameType === gameType)?.label ?? gameType}${n ?? ''}`;

function Line({ children, right }: { children: ReactNode; right: string }) {
  return (
    <View style={styles.line}>
      <ThemedText type="small" style={styles.lineText}>{children}</ThemedText>
      <ThemedText type="smallBold">{right}</ThemedText>
    </View>
  );
}

function League({ data }: { data: AlmanacData }) {
  const a = data.almanac;
  const name = (key: string) => <ManagerLink data={data} managerKey={key} />;
  const player = (id: number) => data.players.get(id) ?? `Player ${id}`;
  const moves = [...a.redrafts].sort((x, y) => y.addedTb - y.droppedTb - (x.addedTb - x.droppedTb)).slice(0, 5);
  return (
    <>
      <Card title="Champions">
        <View style={styles.pennants}>
          {a.champions.map((c) => (
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
        {([1, 2, 3] as const).map((round) =>
          a.bestRounds[round].slice(0, 3).map((r, i) => (
            <Line key={`${round}-${i}`} right={`${r.tb} bags`}>
              <ThemedText type="small" themeColor="textSecondary">Round {round} · {r.year} · </ThemedText>
              {name(r.managerKey)}
            </Line>
          )),
        )}
      </Card>

      <Card title="Biggest single games">
        {a.bestPlayerGames.slice(0, 5).map((g, i) => (
          <Line key={i} right={`${g.tb} bags`}>
            <ThemedText type="small">{player(g.playerId)} </ThemedText>
            <ThemedText type="small" themeColor="textSecondary">{g.year} {seriesGame(g.gameType, g.seriesGameNumber)} · </ThemedText>
            {name(g.managerKey)}
          </Line>
        ))}
      </Card>

      <Card title="Best player seasons">
        {a.bestPlayerSeasons.slice(0, 5).map((p, i) => (
          <Line key={i} right={`${p.tb} bags`}>
            <ThemedText type="small">{player(p.playerId)} </ThemedText>
            <ThemedText type="small" themeColor="textSecondary">{p.year} · </ThemedText>
            {name(p.managerKey)}
          </Line>
        ))}
      </Card>

      <Card title="Closest cuts">
        {a.closestCuts.slice(0, 5).map((c, i) => (
          <Line key={i} right={c.margin === 0 ? 'tiebreak' : `by ${c.margin}`}>
            <ThemedText type="small" themeColor="textSecondary">{c.year} round {c.round} · </ThemedText>
            {name(c.through.managerKey)}
            <ThemedText type="small" themeColor="textSecondary"> {c.through.tb} over </ThemedText>
            {name(c.out.managerKey)}
            <ThemedText type="small" themeColor="textSecondary"> {c.out.tb}</ThemedText>
          </Line>
        ))}
      </Card>

      <Card title="Best redrafts">
        <ThemedText type="small" themeColor="textSecondary">
          Bags the added player scored for the team, against what the dropped player scored the rest of the way.
        </ThemedText>
        {moves.map((m, i) => (
          <Line key={i} right={`${m.addedTb - m.droppedTb >= 0 ? '+' : ''}${m.addedTb - m.droppedTb}`}>
            <ThemedText type="small">{player(m.add)} ({m.addedTb}) for {player(m.drop)} ({m.droppedTb}) </ThemedText>
            <ThemedText type="small" themeColor="textSecondary">{m.year} Draft {m.draftNumber} · </ThemedText>
            {name(m.managerKey)}
          </Line>
        ))}
      </Card>
    </>
  );
}

function Managers({ data }: { data: AlmanacData }) {
  const theme = useTheme();
  const slug = (key: string) => (key.includes(':') ? key : managerSlug(data.managers.get(key) ?? key));
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
    <Card title="Rivalries">
      <ThemedText type="small" themeColor="textSecondary">
        Rounds won by the row&apos;s manager against the column&apos;s, in rounds they both played. Green: they usually win it. Tap one to see it.
      </ThemedText>
      <RivalryGrid data={data} onPick={(a, b) => router.push({ pathname: '/almanac/h2h', params: { a: slug(a), b: slug(b) } })} />
    </Card>
    </>
  );
}

function Segmented({ value, onChange }: { value: View_; onChange: (v: View_) => void }) {
  const theme = useTheme();
  const tabs: [View_ | 'h2h', string][] = [
    ['league', 'League'],
    ['managers', 'Managers'],
    ['h2h', 'Head-to-head'],
  ];
  return (
    <ThemedView type="backgroundElement" elevation="sunken" style={styles.segmented}>
      {tabs.map(([key, label]) => (
        <Pressable
          key={key}
          onPress={() => (key === 'h2h' ? router.push('/almanac/h2h') : onChange(key))}
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
