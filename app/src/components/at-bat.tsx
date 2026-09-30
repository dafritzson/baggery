import type { ReactNode } from 'react';
import { type StyleProp, StyleSheet, View, type ViewStyle } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Colors, Radius } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { FillSurface, useOnFill, useTheme } from '@/hooks/use-theme';

/** Whose hitter a row is: yours, another manager's, or nobody's. */
export type Bagger = 'mine' | 'other' | null;

/**
 * A hitter's row on the Games tab. Yours are dark green; another manager's are dark blue where
 * nothing else says whose he is (`other`); the hitter at bat, if drafted, gets a ring in the same
 * color that pulses (global.css). With `ringUndrafted` (box scores), an undrafted hitter at bat
 * gets a pulsing blue ring with no fill. Text inside turns light on its own (FillSurface).
 */
export function HitterRow({
  bagger,
  atBat,
  ringUndrafted,
  style,
  children,
}: {
  bagger: Bagger;
  atBat?: boolean;
  ringUndrafted?: boolean;
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
}) {
  const theme = useTheme();
  const fill = bagger === 'mine' ? 'mineFill' : bagger === 'other' ? 'otherFill' : null;
  const radius = StyleSheet.flatten(style)?.borderRadius ?? Radius.md;
  const ring = !!atBat && (!!fill || !!ringUndrafted);
  return (
    <View style={[style, (fill || ring) && { borderRadius: radius }, fill && { backgroundColor: theme[fill] }]}>
      <FillSurface fill={fill}>{children}</FillSurface>
      {ring && (
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
  const scheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  const atBat = label === 'AB';
  // The batter: red everywhere, fill or not. The next two: gray on the page, white in the fill's
  // color on a fill. (On a fill the theme's danger is a pale red, so AB takes the page's.)
  const [background, color] = atBat
    ? [Colors[scheme].danger, '#ffffff']
    : onFill
      ? [theme.onFill, theme.accentText]
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
