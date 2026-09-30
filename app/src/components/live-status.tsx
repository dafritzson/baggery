import { StyleSheet, View } from 'react-native';

import type { LiveState } from '@core/live.ts';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { inningLabel } from '@/lib/game-labels';

/** Between halves ("Mid 7", "End 7") there's no count, outs or runners to show. */
export function betweenInnings(live: LiveState): boolean {
  return live.inningState === 'Middle' || live.inningState === 'End';
}

/** Runners on base as a little diamond: filled squares for occupied bases. `large` for the desktop box score. */
export function Diamond({ bases, large }: { bases: [boolean, boolean, boolean]; large?: boolean }) {
  const theme = useTheme();
  const s = large ? big : small;
  const base = (on: boolean, position: object) => (
    <View
      style={[
        s.base,
        position,
        on ? { backgroundColor: theme.text, borderColor: theme.text } : { borderColor: theme.textSecondary },
      ]}
    />
  );
  return (
    <View style={s.diamond} accessibilityLabel={`Runners: ${['first', 'second', 'third'].filter((_, i) => bases[i]).join(', ') || 'none'}`}>
      {base(bases[1], s.second)}
      {base(bases[2], s.third)}
      {base(bases[0], s.first)}
    </View>
  );
}

function Outs({ outs, large }: { outs: number; large?: boolean }) {
  const theme = useTheme();
  return (
    <View style={styles.outs} accessibilityLabel={`${outs} out`}>
      {[0, 1, 2].map((i) => (
        <View
          key={i}
          style={[large ? styles.outLarge : styles.out, { borderColor: theme.textSecondary }, i < outs && { backgroundColor: theme.textSecondary }]}
        />
      ))}
    </View>
  );
}

/** A live game's inning, runners, count and outs in a row, as on the Games cards. */
export function LiveStatus({ live }: { live: LiveState }) {
  const theme = useTheme();
  return (
    <View style={styles.row}>
      <ThemedText type="smallBold" style={{ color: theme.danger }}>{inningLabel(live)}</ThemedText>
      {!betweenInnings(live) && (
        <>
          <Diamond bases={live.bases} />
          <ThemedText type="small" style={styles.count}>{`${live.balls}-${live.strikes}`}</ThemedText>
          <Outs outs={live.outs} />
        </>
      )}
    </View>
  );
}

/** The same, stacked and bigger: inning over the diamond over the count and outs (desktop box score). */
export function LiveStatusStack({ live }: { live: LiveState }) {
  const theme = useTheme();
  return (
    <View style={styles.stack}>
      <ThemedText type="smallBold" style={[styles.big, { color: theme.danger }]}>{inningLabel(live)}</ThemedText>
      {!betweenInnings(live) && (
        <>
          <Diamond bases={live.bases} large />
          <View style={styles.row}>
            <ThemedText type="smallBold" style={[styles.big, styles.count]}>{`${live.balls}-${live.strikes}`}</ThemedText>
            <Outs outs={live.outs} large />
          </View>
        </>
      )}
    </View>
  );
}

const small = StyleSheet.create({
  diamond: { width: 26, height: 19 },
  base: { position: 'absolute', width: 7, height: 7, borderWidth: 1.5, transform: [{ rotate: '45deg' }] },
  second: { left: 9.5, top: 1.5 },
  third: { left: 2, top: 9 },
  first: { left: 17, top: 9 },
});

const big = StyleSheet.create({
  diamond: { width: 40, height: 29 },
  base: { position: 'absolute', width: 11, height: 11, borderWidth: 2, transform: [{ rotate: '45deg' }] },
  second: { left: 14.5, top: 2.5 },
  third: { left: 3, top: 14.5 },
  first: { left: 26, top: 14.5 },
});

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  stack: { alignItems: 'center', gap: Spacing.one },
  big: { fontSize: 15, lineHeight: 20 },
  count: { fontVariant: ['tabular-nums'] },
  outs: { flexDirection: 'row', gap: 3 },
  out: { width: 6, height: 6, borderRadius: 3, borderWidth: 1 },
  outLarge: { width: 8, height: 8, borderRadius: 4, borderWidth: 1 },
});
