import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import type { FantasyRound } from '@core/types.ts';

import { Button } from '@/components/button';
import { Sheet } from '@/components/sheet';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

const SERIES: Record<FantasyRound, string> = {
  1: 'Wild Card and Division Series',
  2: 'Championship Series',
  3: 'World Series',
};

/** The ? beside a round's standings: opens how that round and its cut work. */
export function RoundRulesButton({ onPress }: { onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel="How this round works" hitSlop={10} onPress={onPress}>
      {({ pressed }) => (
        <View style={[styles.help, { backgroundColor: theme.accent, opacity: pressed ? 0.6 : 1 }]}>
          <ThemedText style={[styles.helpText, { color: theme.accentText }]}>?</ThemedText>
        </View>
      )}
    </Pressable>
  );
}

/**
 * How a round works, from Standings: which games count, who goes through, where the ghost team
 * stands, and the tiebreakers, with a link to the whole Rules page.
 */
export function RoundRulesSheet({
  round,
  visible,
  ranked,
  survivors,
  ghost,
  onClose,
}: {
  round: FantasyRound;
  visible: boolean;
  /** How many teams are ranked for the cut (the ghost team only in round 3). */
  ranked: number;
  survivors: number;
  /** Whether the ghost team plays this round. */
  ghost: boolean;
  onClose: () => void;
}) {
  const out = Math.max(ranked - survivors, 0);
  const lines = [
    `Bags from ${SERIES[round]} games only.`,
    round === 3
      ? 'The top team wins it all.'
      : `The top ${survivors} go ${round === 2 ? 'to the World Series' : 'through'}. The bottom ${out} are out.`,
    ...(ghost && round === 2
      ? [`The Ghost plays too, but it's never cut and takes nobody's spot. If it finishes in the top ${survivors}, still only the bottom ${out} managers go.`]
      : ghost && round === 3
        ? ['The Ghost is ranked with the finalists. If it finishes first, its managers share the title.']
        : []),
    'Teams tied on bags are ranked by these tiebreakers, in order: team slugging percentage, team on-base percentage, home runs, runs, then RBIs. Teams still tied after all five settle it with a drink-off.',
  ];
  return (
    <Sheet visible={visible} title={`How round ${round} works`} onClose={onClose}>
      {lines.map((line) => (
        <ThemedText key={line} type="small">{line}</ThemedText>
      ))}
      <View style={styles.actions}>
        <Button
          label="All the rules"
          onPress={() => {
            onClose();
            router.navigate({ pathname: '/rules', params: { section: 'rounds' } });
          }}
        />
        <Button label="Close" variant="secondary" onPress={onClose} />
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  help: { width: 18, height: 18, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  helpText: { fontSize: 12, lineHeight: 16, fontWeight: 700 },
  actions: { gap: Spacing.two, marginTop: Spacing.two },
});
