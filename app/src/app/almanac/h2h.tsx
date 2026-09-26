import { router, useLocalSearchParams } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { type HeadToHead, headToHead } from '@core/almanac.ts';

import { Card } from '@/components/card';
import { FinishChart, MomentCard, Monogram, RoundDuels, SplitBar, TapeRow, useDuelColors } from '@/components/duel';
import { ordinal } from '@/components/manager-link';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { type AlmanacData, managerSlug, useAlmanac } from '@/lib/almanac';

/** Two managers, compared: /almanac/h2h?a=daniel&b=darren. */
export default function HeadToHeadScreen() {
  const params = useLocalSearchParams<{ a?: string; b?: string }>();
  const { data, error } = useAlmanac();
  const theme = useTheme();

  // Managers with a finished season, by slug; the first two by default.
  const careers = data?.almanac.careers ?? [];
  const slug = (key: string) => (key.includes(':') ? key : managerSlug(data!.managers.get(key) ?? key));
  const find = (s?: string) => careers.find((c) => slug(c.key) === s)?.key;
  const aKey = find(params.a) ?? careers[0]?.key;
  const bKey = find(params.b) ?? careers.find((c) => c.key !== aKey)?.key;
  const h = data && aKey && bKey ? headToHead(data.almanac, aKey, bKey) : null;
  const choose = (side: 'a' | 'b', key: string) => {
    const other = side === 'a' ? bKey : aKey;
    // Picking the other side's manager swaps them.
    const next = key === other ? { a: slug(bKey!), b: slug(aKey!) } : { a: slug(side === 'a' ? key : aKey!), b: slug(side === 'b' ? key : bKey!) };
    router.setParams(next);
  };

  return (
    <Screen>
      <ThemedText type="small" style={{ color: theme.accent }} onPress={() => (router.canGoBack() ? router.back() : router.replace('/almanac'))}>
        ‹ Almanac
      </ThemedText>
      <ThemedText type="subtitle">Head-to-head</ThemedText>
      {error && <ThemedText themeColor="danger">{error}</ThemedText>}
      {!data && !error && <ThemedText themeColor="textSecondary">Loading every season…</ThemedText>}
      {data && aKey && bKey && (
        <>
          <Picker data={data} side="a" selected={aKey} onChoose={(k) => choose('a', k)} />
          <Picker data={data} side="b" selected={bKey} onChoose={(k) => choose('b', k)} />
        </>
      )}
      {h && data && <Duel h={h} data={data} />}
    </Screen>
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

function Duel({ h, data }: { h: HeadToHead; data: AlmanacData }) {
  const colors = useDuelColors();
  const player = (id: number) => data.players.get(id) ?? `Player ${id}`;
  const { a, b } = h;
  const r = h.record.rounds;
  const s = h.record.seasons;
  const leader = r.a === r.b ? null : r.a > r.b ? a : b;

  // Every year either played, and each one's finish.
  const places = {
    a: new Map(data.almanac.teamSeasons.filter((t) => t.managerKey === a.key).map((t) => [t.year, t.place])),
    b: new Map(data.almanac.teamSeasons.filter((t) => t.managerKey === b.key).map((t) => [t.year, t.place])),
  };
  const years = [...new Set([...places.a.keys(), ...places.b.keys()])].sort();
  const teams = Math.max(...data.almanac.teamSeasons.map((t) => t.place));

  const blowout = [...h.rounds].sort((x, y) => Math.abs(y.a - y.b) - Math.abs(x.a - x.b))[0];
  const closest = [...h.rounds].sort((x, y) => Math.abs(x.a - x.b) - Math.abs(y.a - y.b))[0];
  const gap = [...h.seasons].sort((x, y) => Math.abs(y.a.place - y.b.place) - Math.abs(x.a.place - x.b.place))[0];
  const sideOf = (w: 'a' | 'b' | null) => (w === 'a' ? a : w === 'b' ? b : null);
  const theme = useTheme();
  // Ties are neither side's color.
  const colorOf = (w: 'a' | 'b' | null) => (w === 'a' ? colors.a : w === 'b' ? colors.b : theme.textSecondary);

  return (
    <>
      {/* The banner: both managers and their record in rounds played against each other. */}
      <ThemedView type="backgroundElement" style={styles.hero}>
        <View style={styles.heroSides}>
          <View style={styles.heroSide}>
            <Monogram name={a.name} color={colors.a} />
            <ThemedText type="smallBold">{a.name}</ThemedText>
          </View>
          <View style={styles.heroScore}>
            <ThemedText style={styles.bigScore}>
              <ThemedText style={[styles.bigScore, { color: colors.a }]}>{r.a}</ThemedText>
              <ThemedText style={styles.bigScore}> – </ThemedText>
              <ThemedText style={[styles.bigScore, { color: colors.b }]}>{r.b}</ThemedText>
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              rounds won{r.ties ? ` · ${r.ties} tied` : ''}
            </ThemedText>
          </View>
          <View style={styles.heroSide}>
            <Monogram name={b.name} color={colors.b} />
            <ThemedText type="smallBold">{b.name}</ThemedText>
          </View>
        </View>
        <SplitBar a={r.a} b={r.b} height={12} />
        <ThemedText type="small" themeColor="textSecondary" style={styles.center}>
          {h.rounds.length
            ? leader
              ? `${leader.name} has outscored ${leader === a ? b.name : a.name} in ${Math.max(r.a, r.b)} of ${h.rounds.length} rounds they both played.`
              : `Dead even across ${h.rounds.length} rounds.`
            : 'They’ve never been in the same round.'}{' '}
          {h.seasons.length ? `Finished ahead: ${a.name} ${s.a}, ${b.name} ${s.b}.` : ''}
        </ThemedText>
      </ThemedView>

      {h.rounds.length > 0 && (
        <View style={styles.moments}>
          <MomentCard
            emoji="💥"
            title="Biggest blowout"
            color={colorOf(blowout.winner)}
            headline={`+${Math.abs(blowout.a - blowout.b)}`}
            detail={`${sideOf(blowout.winner)?.name ?? 'Tie'}, ${blowout.year} round ${blowout.round} (${blowout.a}–${blowout.b})`}
          />
          <MomentCard
            emoji="😬"
            title="Closest call"
            color={colorOf(closest.winner)}
            headline={closest.a === closest.b ? 'Tied' : `by ${Math.abs(closest.a - closest.b)}`}
            detail={`${closest.year} round ${closest.round}: ${closest.a}–${closest.b}`}
          />
          {gap && (
            <MomentCard
              emoji={gap.winner ? '🏔️' : '🤝'}
              title="Widest gap"
              color={colorOf(gap.winner)}
              headline={`${ordinal(gap.a.place)} vs ${ordinal(gap.b.place)}`}
              detail={`${gap.year}: ${sideOf(gap.winner)?.name ?? 'Nobody'} finished ${Math.abs(gap.a.place - gap.b.place)} ${Math.abs(gap.a.place - gap.b.place) === 1 ? 'spot' : 'spots'} higher`}
            />
          )}
        </View>
      )}

      <Card title="Tale of the tape">
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
      </Card>

      {h.rounds.length > 0 && (
        <Card title="Round by round">
          <ThemedText type="small" themeColor="textSecondary">Each round they both played; the bar leans to the winner, as long as the margin.</ThemedText>
          <RoundDuels rounds={h.rounds} />
        </Card>
      )}

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
}

const styles = StyleSheet.create({
  chips: { gap: Spacing.two, paddingVertical: Spacing.half },
  chip: { paddingHorizontal: Spacing.three, paddingVertical: Spacing.one + 2, borderRadius: 999, borderWidth: 1 },
  hero: { padding: Spacing.three, borderRadius: Radius.lg, gap: Spacing.three },
  heroSides: { flexDirection: 'row', alignItems: 'center' },
  heroSide: { alignItems: 'center', gap: Spacing.one, width: 90 },
  heroScore: { flex: 1, alignItems: 'center' },
  bigScore: { fontSize: 44, lineHeight: 52, fontWeight: '800' },
  center: { textAlign: 'center' },
  moments: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  shared: { gap: 3 },
  sharedLine: { flexDirection: 'row', alignItems: 'baseline' },
});
