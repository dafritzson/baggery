import type { ReactNode } from 'react';
import { type StyleProp, StyleSheet, View, type ViewStyle } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Radius } from '@/constants/theme';
import { FillSurface, useOnFill, useTheme } from '@/hooks/use-theme';

/** Whose hitter a row is: yours, another manager's, or nobody's. */
export type Bagger = 'mine' | 'other' | null;

/**
 * A hitter's row on the Games tab. Yours are dark green; another manager's are dark blue where
 * nothing else says whose he is (`other`); the hitter at bat, if drafted, gets a ring in the same
 * color that pulses (global.css). Text inside turns light on its own (FillSurface).
 */
export function HitterRow({
  bagger,
  atBat,
  style,
  children,
}: {
  bagger: Bagger;
  atBat?: boolean;
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
}) {
  const theme = useTheme();
  const fill = bagger === 'mine' ? 'mineFill' : bagger === 'other' ? 'otherFill' : null;
  const radius = StyleSheet.flatten(style)?.borderRadius ?? Radius.md;
  return (
    <View style={[style, fill && { backgroundColor: theme[fill], borderRadius: radius }]}>
      <FillSurface fill={fill}>{children}</FillSurface>
      {atBat && fill && (
        <View
          pointerEvents="none"
          style={[StyleSheet.absoluteFill, styles.ring, { borderRadius: radius, borderColor: bagger === 'mine' ? theme.mineRing : theme.otherRing }]}
          // dataSet isn't in React Native's types; react-native-web turns it into data-* attributes.
          {...({ dataSet: { atBatRing: '' } } as object)}
        />
      )}
    </View>
  );
}

/** "AB", "OD", "IH" beside a hitter's name in a box score. */
export function UpTag({ label }: { label: string }) {
  const theme = useTheme();
  const onFill = useOnFill();
  const atBat = label === 'AB';
  // On a fill: white, in the fill's color. On the page: red for the batter, gray for the next two.
  const [background, color] = onFill
    ? [theme.onFill, theme.accentText]
    : atBat
      ? [theme.danger, '#ffffff']
      : [theme.backgroundSelected, theme.textSecondary];
  return (
    <View style={[styles.tag, { backgroundColor: background }]}>
      <ThemedText style={[styles.tagText, { color }]}>{label}</ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  ring: { borderWidth: 2 },
  tag: { paddingHorizontal: 4, borderRadius: Radius.sm },
  tagText: { fontSize: 9, lineHeight: 13, fontWeight: 800, letterSpacing: 0.4 },
});
