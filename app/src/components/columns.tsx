import type { ReactNode } from 'react';
import { Platform, StyleSheet, View, type ViewStyle } from 'react-native';

import { Spacing } from '@/constants/theme';

// Web only: the sidebar stays in view while the main column scrolls.
const sticky = Platform.OS === 'web' ? ({ position: 'sticky', top: Spacing.three } as unknown as ViewStyle) : null;

/** Main column plus a fixed-width sidebar, side by side. For wide layouts (see useLayout). */
export function Columns({ main, side, sideWidth = 320 }: { main: ReactNode; side: ReactNode; sideWidth?: number }) {
  return (
    <View style={styles.row}>
      <View style={styles.main}>{main}</View>
      <View style={[styles.side, { width: sideWidth }, sticky]}>{side}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.four },
  // minWidth 0 lets wide children (the player table) shrink and scroll instead of overflowing.
  main: { flex: 1, minWidth: 0, gap: Spacing.three },
  side: { gap: Spacing.three },
});
