import { router, useLocalSearchParams } from 'expo-router';
import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import type { TeamSeason } from '@core/almanac.ts';

import { AboveAverageChart, managerColor } from '@/components/almanac-charts';
import { Card } from '@/components/card';
import { FinishChart } from '@/components/duel';
import { ordinal } from '@/components/manager-link';
import { Screen } from '@/components/screen';
import { StatTable } from '@/components/stat-table';
import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { type AlmanacData, managerSlug, useAlmanac } from '@/lib/almanac';

/** One manager's career: every season's finish and bags, their best players, and their redrafts. */
export default function ManagerScreen() {
  const { manager } = useLocalSearchParams<{ manager: string }>();
  const { data, error } = useAlmanac();
  const theme = useTheme();
  const key = data && [...data.managers].find(([k, name]) => k === manager || managerSlug(name) === manager)?.[0];

  return (
    <Screen>
      <ThemedText type="small" style={{ color: theme.accent }} onPress={() => (router.canGoBack() ? router.back() : router.replace('/almanac'))}>
        ‹ Almanac
      </ThemedText>
      {error && <ThemedText themeColor="danger">{error}</ThemedText>}
      {!data && !error && <ThemedText themeColor="textSecondary">Loading every season…</ThemedText>}
      {data && !key && <ThemedText>No manager called {manager}.</ThemedText>}
      {data && key && <Career data={data} managerKey={key} />}
    </Screen>
  );
}

function Line({ children, right }: { children: ReactNode; right: string }) {
  return (
    <View style={styles.line}>
      <ThemedText type="small" style={styles.lineText}>{children}</ThemedText>
      <ThemedText type="smallBold">{right}</ThemedText>
    </View>
  );
}

const signed = (n: number) => {
  const r = Math.round(n);
  return `${r > 0 ? '+' : r < 0 ? '−' : '±'}${Math.abs(r)}`;
};

function Career({ data, managerKey }: { data: AlmanacData; managerKey: string }) {
  const theme = useTheme();
  const a = data.almanac;
  const slugOf = (key: string) => (key.includes(':') ? key : managerSlug(data.managers.get(key) ?? key));
  const color = managerColor(data, managerKey);
  const career = a.careers.find((c) => c.key === managerKey);
  const name = data.managers.get(managerKey) ?? '?';
  const player = (id: number) => data.players.get(id) ?? `Player ${id}`;
  if (!career) {
    return (
      <>
        <ThemedText type="subtitle">{name}</ThemedText>
        <ThemedText themeColor="textSecondary">No finished seasons yet.</ThemedText>
      </>
    );
  }
  const seasons = a.teamSeasons.filter((t) => t.managerKey === managerKey).sort((x, y) => y.year - x.year);
  const players = (a.playersByManager.get(managerKey) ?? []).slice(0, 10);
  const moves = a.redrafts.filter((m) => m.managerKey === managerKey);
  const net = moves.reduce((sum, m) => sum + m.addedTb - m.droppedTb, 0);
  const byGain = [...moves].sort((x, y) => y.addedTb - y.droppedTb - (x.addedTb - x.droppedTb));
  const round = (t: TeamSeason, r: number) => t.rounds.find((x) => x.round === r);
  const roundCell = (t: TeamSeason, r: number) => {
    const x = round(t, r);
    return x ? `${x.tb} (${signed(x.tb - x.average)})` : '—';
  };

  return (
    <>
      {/* A trading card: their color, initial, trophies and headline numbers. */}
      <View style={[styles.hero, { backgroundColor: color, boxShadow: `0 10px 28px ${color}55` }]}>
        <View style={styles.heroTop}>
          <View style={styles.heroInitial}>
            <ThemedText style={[styles.heroInitialText, { color }]}>{name[0]}</ThemedText>
          </View>
          <View style={{ flex: 1 }}>
            <ThemedText style={styles.heroName}>{name}</ThemedText>
            <ThemedText style={styles.heroTrophies}>
              {career.titles ? '🏆'.repeat(career.titles) : `Best finish: ${ordinal(career.bestFinish)}`}
            </ThemedText>
          </View>
        </View>
        <View style={styles.heroStats}>
          {[
            [String(career.seasons), career.seasons === 1 ? 'season' : 'seasons'],
            [career.averageFinish.toFixed(1), 'avg finish'],
            [String(career.roundsSurvived), 'cuts made'],
            [career.bagsPerRound.toFixed(1), 'bags a round'],
          ].map(([value, label]) => (
            <View key={label} style={styles.heroStat}>
              <ThemedText style={styles.heroStatValue}>{value}</ThemedText>
              <ThemedText style={styles.heroStatLabel}>{label}</ThemedText>
            </View>
          ))}
        </View>
      </View>

      <View style={styles.compare}>
        <ThemedText type="small" themeColor="textSecondary">Compare with</ThemedText>
        {a.careers
          .filter((c) => c.key !== managerKey)
          .map((c) => (
            <ThemedText
              key={c.key}
              type="smallBold"
              style={{ color: theme.accent }}
              onPress={() => router.push({ pathname: '/almanac/h2h', params: { a: slugOf(managerKey), b: slugOf(c.key) } })}>
              {c.name}
            </ThemedText>
          ))}
      </View>

      <Card title="Career arc">
        <ThemedText type="small" themeColor="textSecondary">Where {name} finished each year.</ThemedText>
        <FinishChart
          years={[...seasons].map((t) => t.year).sort()}
          places={{ a: new Map(seasons.map((t) => [t.year, t.place])), b: new Map() }}
          teams={Math.max(...a.teamSeasons.map((t) => t.place))}
          color={color}
        />
      </Card>

      <Card title="Bags vs the league">
        <ThemedText type="small" themeColor="textSecondary">
          Every round {name} played: above the line when they beat that round&apos;s average, below when they didn&apos;t.
        </ThemedText>
        <AboveAverageChart seasons={seasons} />
      </Card>

      <Card title="Season by season">
        <ThemedText type="small" themeColor="textSecondary">Each round&apos;s bags, and how far above or below that round&apos;s average.</ThemedText>
        <StatTable<TeamSeason>
          rows={seasons}
          rowKey={(t) => t.teamId}
          labelHeader="Year"
          labelWidth={84}
          label={(t) => <ThemedText type="smallBold" numberOfLines={1}>{t.year}{t.place === 1 ? ' 🏆' : ''}</ThemedText>}
          onPressRow={(t) => router.push({ pathname: '/standings', params: { year: t.year } })}
          columns={[
            { key: 'place', label: 'Finish', value: (t) => t.place, format: (t) => ordinal(t.place), ascending: true, width: 60 },
            { key: 'r1', label: 'Round 1', value: (t) => round(t, 1)?.tb ?? -1, format: (t) => roundCell(t, 1), width: 84 },
            { key: 'r2', label: 'Round 2', value: (t) => round(t, 2)?.tb ?? -1, format: (t) => roundCell(t, 2), width: 84 },
            { key: 'r3', label: 'Round 3', value: (t) => round(t, 3)?.tb ?? -1, format: (t) => roundCell(t, 3), width: 84 },
            { key: 'bags', label: 'Bags', value: (t) => t.bags, width: 56 },
          ]}
        />
      </Card>

      <Card title="Top players">
        {players.map((p) => (
          <View key={p.playerId} style={{ gap: 3 }}>
            <Line right={`${p.tb} bags`}>
              {player(p.playerId)}
              <ThemedText type="small" themeColor="textSecondary"> {p.years.join(', ')}</ThemedText>
            </Line>
            <View style={[styles.track, { backgroundColor: theme.background }]}>
              <View style={[styles.fill, { width: `${(p.tb / players[0].tb) * 100}%`, backgroundColor: color }]} />
            </View>
          </View>
        ))}
      </Card>

      {moves.length > 0 && (
        <Card title="Redrafts">
          <ThemedText type="small" themeColor="textSecondary">
            {moves.length} {moves.length === 1 ? 'swap' : 'swaps'}, {signed(net)} bags overall: what the added players scored for {name},
            against what the dropped ones scored the rest of the way.
          </ThemedText>
          {[...byGain.slice(0, 3), ...(byGain.length > 6 ? byGain.slice(-3) : byGain.slice(3))].map((m, i) => (
            <Line key={i} right={signed(m.addedTb - m.droppedTb)}>
              {player(m.add)} ({m.addedTb}) for {player(m.drop)} ({m.droppedTb})
              <ThemedText type="small" themeColor="textSecondary"> {m.year} Draft {m.draftNumber}</ThemedText>
            </Line>
          ))}
        </Card>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  line: { flexDirection: 'row', alignItems: 'baseline', gap: Spacing.two },
  lineText: { flex: 1 },
  compare: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two, alignItems: 'baseline' },
  hero: { borderRadius: Radius.lg, padding: Spacing.three, gap: Spacing.three },
  heroTop: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  heroInitial: { width: 64, height: 64, borderRadius: 32, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  heroInitialText: { fontSize: 32, lineHeight: 40, fontWeight: '800' },
  heroName: { color: '#fff', fontSize: 30, lineHeight: 36, fontWeight: '800' },
  heroTrophies: { color: '#fff', fontSize: 20, lineHeight: 26 },
  heroStats: { flexDirection: 'row', gap: Spacing.two },
  heroStat: { flex: 1, backgroundColor: 'rgba(0,0,0,0.18)', borderRadius: Radius.md, paddingVertical: Spacing.two, alignItems: 'center' },
  heroStatValue: { color: '#fff', fontSize: 20, lineHeight: 24, fontWeight: '800' },
  heroStatLabel: { color: '#fff', fontSize: 11, opacity: 0.85 },
  track: { height: 6, borderRadius: 3, overflow: 'hidden' },
  fill: { height: 6, borderRadius: 3 },
});
