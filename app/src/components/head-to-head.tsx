import { memo, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { type HeadToHead as Duel_, type TeamSeason, headToHead } from '@core/almanac.ts';

import { Card } from '@/components/card';
import { FinishChart, MomentCard, RadarChart, RoundBarsChart, SplitBar, TapeRow, YearLineChart, useDuelColors } from '@/components/duel';
import { ordinal } from '@/components/manager-link';
import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { type AlmanacData, managerSlug } from '@/lib/almanac';
import { RADAR_AXES, SCOUTING_STATS, radarValues } from '@/lib/scouting';

/**
 * Two managers, compared: the Almanac's Head-to-head tab. `a` and `b` are the managers first
 * shown, as URL slugs (/almanac?view=h2h&a=daniel&b=darren); the first two when unset.
 */
export function HeadToHead({ data, a, b }: { data: AlmanacData; a?: string; b?: string }) {
  const careers = data.almanac.careers;
  // Picking is kept in the screen, not the URL: a URL change re-renders every screen in the app.
  const [picked, setPicked] = useState(() => {
    const slug = (key: string) => (key.includes(':') ? key : managerSlug(data.managers.get(key) ?? key));
    const find = (s?: string) => careers.find((c) => slug(c.key) === s)?.key;
    const aKey = find(a) ?? careers[0]?.key;
    return { a: aKey, b: find(b) ?? careers.find((c) => c.key !== aKey)?.key };
  });
  const h = useMemo(
    () => (picked.a && picked.b ? headToHead(data.almanac, picked.a, picked.b) : null),
    [data, picked.a, picked.b],
  );
  // Picking the other side's manager swaps them.
  const choose = (side: 'a' | 'b', key: string) =>
    setPicked((p) => (key === p[side === 'a' ? 'b' : 'a'] ? { a: p.b, b: p.a } : { ...p, [side]: key }));

  if (!picked.a || !picked.b) {
    return <ThemedText themeColor="textSecondary">Head-to-head needs two managers with a finished season.</ThemedText>;
  }
  return (
    <>
      <Picker data={data} side="a" selected={picked.a} onChoose={(k) => choose('a', k)} />
      <Picker data={data} side="b" selected={picked.b} onChoose={(k) => choose('b', k)} />
      {h && <Duel h={h} data={data} />}
    </>
  );
}

function Picker({ data, side, selected, onChoose }: { data: AlmanacData; side: 'a' | 'b'; selected: string; onChoose: (key: string) => void }) {
  const colors = useDuelColors();
  const theme = useTheme();
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
      {data.almanac.careers.map((c) => {
        const on = c.key === selected;
        return (
          <Pressable
            key={c.key}
            onPress={() => onChoose(c.key)}
            style={[styles.chip, { backgroundColor: on ? colors[side] : theme.backgroundElement, borderColor: on ? colors[side] : theme.border }]}>
            <ThemedText type="smallBold" style={{ color: on ? '#fff' : theme.text }}>{c.name}</ThemedText>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

type Measure = 'perRound' | 'vsAverage';

/** A season's bags per round played, and how far above that round's average they were, on average. */
const perRound = (t: TeamSeason) => t.bags / Math.max(t.rounds.length, 1);
const vsAverage = (t: TeamSeason) => t.rounds.reduce((sum, r) => sum + r.tb - r.average, 0) / Math.max(t.rounds.length, 1);

/** Everything below the pickers; memoized, so it only redraws when the matchup changes. */
const Duel = memo(function Duel({ h, data }: { h: Duel_; data: AlmanacData }) {
  const colors = useDuelColors();
  const theme = useTheme();
  const [measure, setMeasure] = useState<Measure>('perRound');
  const player = (id: number) => data.players.get(id) ?? `Player ${id}`;
  const { a, b } = h;
  const all = data.almanac.teamSeasons;
  const seasonsOf = (key: string) => all.filter((t) => t.managerKey === key);
  const sa = seasonsOf(a.key);
  const sb = seasonsOf(b.key);
  const years = [...new Set([...sa, ...sb].map((t) => t.year))].sort();
  const teams = Math.max(...all.map((t) => t.place));

  const value = measure === 'perRound' ? perRound : vsAverage;
  const byYear = (list: TeamSeason[], f: (t: TeamSeason) => number) => new Map(list.map((t) => [t.year, f(t)]));
  // The league's bags per round each year (its average against itself is always zero).
  const league = new Map(
    years.map((yr) => {
      const rows = all.filter((t) => t.year === yr);
      return [yr, measure === 'perRound' ? rows.reduce((sum, t) => sum + perRound(t), 0) / rows.length : 0];
    }),
  );
  const roundBags = (list: TeamSeason[]) => new Map(list.map((t) => [t.year, new Map(t.rounds.map((r) => [r.round as number, r.tb]))]));
  const places = { a: byYear(sa, (t) => t.place), b: byYear(sb, (t) => t.place) };

  const bestRound = (list: TeamSeason[]) =>
    list.flatMap((t) => t.rounds.map((r) => ({ year: t.year, ...r }))).sort((x, y) => y.tb - x.tb)[0];
  const bestSeason = (list: TeamSeason[]) => [...list].sort((x, y) => x.place - y.place || vsAverage(y) - vsAverage(x))[0];
  const scoutA = data.scouting.find((x) => x.key === a.key);
  const scoutB = data.scouting.find((x) => x.key === b.key);
  const sides = [
    { career: a, color: colors.a, seasons: sa },
    { career: b, color: colors.b, seasons: sb },
  ];

  return (
    <>
      {/* The two managers side by side: trophies and the numbers that matter most. */}
      <View style={styles.hero}>
        {sides.map(({ career, color }) => (
          <View key={career.key} style={[styles.heroCard, { backgroundColor: color, boxShadow: `0 8px 22px ${color}55` }]}>
            <View style={styles.heroTop}>
              <View style={styles.heroInitial}>
                <ThemedText style={[styles.heroInitialText, { color }]}>{career.name[0]}</ThemedText>
              </View>
              <ThemedText style={styles.heroName} numberOfLines={1}>{career.name}</ThemedText>
            </View>
            <ThemedText style={styles.heroTrophies}>{career.titles ? '🏆'.repeat(career.titles) : 'No titles yet'}</ThemedText>
            {(data.badges.get(career.key) ?? []).map((badge) => (
              <View key={badge.name} style={styles.badge}>
                <ThemedText style={styles.badgeText} numberOfLines={1}>{badge.emoji} {badge.name}</ThemedText>
              </View>
            ))}
            {[
              [career.bagsPerRound.toFixed(1), 'bags a round'],
              [career.averageFinish.toFixed(1), 'average finish'],
              [`${career.seasons}`, career.seasons === 1 ? 'season' : 'seasons'],
            ].map(([v, label]) => (
              <View key={label} style={styles.heroStat}>
                <ThemedText style={styles.heroStatValue}>{v}</ThemedText>
                <ThemedText style={styles.heroStatLabel}>{label}</ThemedText>
              </View>
            ))}
          </View>
        ))}
      </View>

      {scoutA && scoutB && (
        <>
          <Card title="Scouting report">
            <ThemedText type="small" themeColor="textSecondary">
              Six skills, each scaled from the league&apos;s worst (center) to its best (edge).
            </ThemedText>
            <RadarChart
              axes={RADAR_AXES.map((x) => x.label)}
              shapes={[
                { key: 'a', color: colors.a, values: radarValues(data.scouting, scoutA) },
                { key: 'b', color: colors.b, values: radarValues(data.scouting, scoutB) },
              ]}
            />
            <Legend colors={colors} a={a.name} b={b.name} />
          </Card>
          {(['Drafting', 'Redrafting', 'Style', 'Clutch'] as const).map((group) => (
            <Card key={group} title={group}>
              {SCOUTING_STATS.filter((st) => st.group === group).map((st) => {
                const [va, vb] = [st.value(scoutA), st.value(scoutB)];
                return va === null || vb === null ? null : (
                  <TapeRow key={st.key} label={st.label} a={va} b={vb} format={st.format} lowerWins={st.lowerWins} neutral={st.neutral} help={st.help} />
                );
              })}
            </Card>
          ))}
        </>
      )}

      <Card title="Bags per round by year">
        <View style={styles.toggle}>
          {([
            ['perRound', 'Bags per round'],
            ['vsAverage', 'vs league average'],
          ] as [Measure, string][]).map(([key, label]) => (
            <Pressable
              key={key}
              onPress={() => setMeasure(key)}
              style={[styles.toggleItem, { backgroundColor: measure === key ? theme.accent : theme.background }]}>
              <ThemedText type="smallBold" style={{ color: measure === key ? '#fff' : theme.textSecondary }}>{label}</ThemedText>
            </Pressable>
          ))}
        </View>
        <YearLineChart
          years={years}
          series={[
            { key: 'a', color: colors.a, values: byYear(sa, value) },
            { key: 'b', color: colors.b, values: byYear(sb, value) },
          ]}
          baseline={league}
          format={(n) => (measure === 'vsAverage' && n > 0 ? `+${n.toFixed(0)}` : n.toFixed(0))}
        />
        <Legend colors={colors} a={a.name} b={b.name} league />
        <ThemedText type="small" themeColor="textSecondary">
          {measure === 'perRound'
            ? 'Round 1 covers the Wild Card and Division Series, so an early exit can still post a big number. "vs league average" evens that out.'
            : 'How many bags above or below that round\'s average, per round played. Zero is an average manager.'}
        </ThemedText>
      </Card>

      <View style={styles.moments}>
        {sides.map(({ career, color, seasons }) => {
          const r = bestRound(seasons);
          return r ? (
            <MomentCard key={`r${career.key}`} emoji="🔥" title={`${career.name}'s best round`} color={color} headline={`${r.tb} bags`} detail={`${r.year} round ${r.round}`} />
          ) : null;
        })}
        {sides.map(({ career, color, seasons }) => {
          const t = bestSeason(seasons);
          return t ? (
            <MomentCard
              key={`s${career.key}`}
              emoji={t.place === 1 ? '🏆' : '⭐'}
              title={`${career.name}'s best season`}
              color={color}
              headline={`${t.year}`}
              detail={`${ordinal(t.place)} place, ${perRound(t).toFixed(1)} bags a round`}
            />
          ) : null;
        })}
      </View>

      <Card title="Round by round">
        <ThemedText type="small" themeColor="textSecondary">Each year&apos;s rounds 1, 2 and 3, left to right. No bar: already out.</ThemedText>
        <RoundBarsChart years={years} a={roundBags(sa)} b={roundBags(sb)} colors={colors} />
        <Legend colors={colors} a={a.name} b={b.name} />
      </Card>

      <Card title="Results">
        <TapeRow label="Titles" a={a.titles} b={b.titles} />
        <TapeRow label="Runner-ups" a={a.runnerUps} b={b.runnerUps} />
        <TapeRow label="Average finish" a={a.averageFinish} b={b.averageFinish} lowerWins format={(n) => n.toFixed(1)} />
        <TapeRow label="Best finish" a={a.bestFinish} b={b.bestFinish} lowerWins format={ordinal} />
        <TapeRow label="Cuts made" a={a.roundsSurvived} b={b.roundsSurvived} />
        <TapeRow label="Bags a round" a={a.bagsPerRound} b={b.bagsPerRound} format={(n) => n.toFixed(1)} />
        <TapeRow label="Career bags" a={a.bags} b={b.bags} />
      </Card>

      <Card title="Finish by year">
        <FinishChart years={years} places={places} teams={teams} />
        <Legend colors={colors} a={a.name} b={b.name} />
      </Card>

      {h.sharedPlayers.length > 0 && (
        <Card title="Players they’ve both had">
          {h.sharedPlayers.slice(0, 8).map((p) => (
            <View key={p.playerId} style={styles.shared}>
              <View style={styles.sharedLine}>
                <ThemedText type="small" style={{ flex: 1 }}>{player(p.playerId)}</ThemedText>
                <ThemedText type="smallBold" style={{ color: colors.a }}>{p.a}</ThemedText>
                <ThemedText type="small" themeColor="textSecondary"> · </ThemedText>
                <ThemedText type="smallBold" style={{ color: colors.b }}>{p.b}</ThemedText>
              </View>
              <SplitBar a={p.a} b={p.b} height={5} />
            </View>
          ))}
        </Card>
      )}
    </>
  );
});

function Legend({ colors, a, b, league = false }: { colors: { a: string; b: string }; a: string; b: string; league?: boolean }) {
  const theme = useTheme();
  const item = (color: string, label: string, dashed = false) => (
    <View style={styles.legendItem}>
      <View style={[styles.legendSwatch, { backgroundColor: dashed ? 'transparent' : color, borderColor: color, borderStyle: dashed ? 'dashed' : 'solid' }]} />
      <ThemedText type="small" themeColor="textSecondary">{label}</ThemedText>
    </View>
  );
  return (
    <View style={styles.legend}>
      {item(colors.a, a)}
      {item(colors.b, b)}
      {league && item(theme.textSecondary, 'League', true)}
    </View>
  );
}

const styles = StyleSheet.create({
  chips: { gap: Spacing.two, paddingVertical: Spacing.half },
  chip: { paddingHorizontal: Spacing.three, paddingVertical: Spacing.one + 2, borderRadius: 999, borderWidth: 1 },
  hero: { flexDirection: 'row', gap: Spacing.two },
  heroCard: { flex: 1, borderRadius: Radius.lg, padding: Spacing.three, gap: Spacing.two },
  heroTop: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  heroInitial: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  heroInitialText: { fontSize: 20, lineHeight: 26, fontWeight: '800' },
  heroName: { flex: 1, color: '#fff', fontSize: 20, lineHeight: 26, fontWeight: '800' },
  heroTrophies: { color: '#fff', fontSize: 16, lineHeight: 22 },
  heroStat: { backgroundColor: 'rgba(0,0,0,0.18)', borderRadius: Radius.md, paddingVertical: Spacing.one, paddingHorizontal: Spacing.two },
  heroStatValue: { color: '#fff', fontSize: 20, lineHeight: 24, fontWeight: '800' },
  heroStatLabel: { color: '#fff', fontSize: 11, opacity: 0.85 },
  badge: { backgroundColor: 'rgba(255,255,255,0.22)', borderRadius: 999, paddingHorizontal: Spacing.two, paddingVertical: 2, alignSelf: 'flex-start', maxWidth: '100%' },
  badgeText: { color: '#fff', fontSize: 11, lineHeight: 16, fontWeight: '700' },
  toggle: { flexDirection: 'row', gap: Spacing.two },
  toggleItem: { paddingHorizontal: Spacing.three, paddingVertical: Spacing.one + 2, borderRadius: 999 },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.three, justifyContent: 'center' },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one },
  legendSwatch: { width: 14, height: 4, borderRadius: 2, borderWidth: 1.5 },
  moments: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  shared: { gap: 3 },
  sharedLine: { flexDirection: 'row', alignItems: 'baseline' },
});
