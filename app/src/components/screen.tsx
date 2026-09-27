import { useScrollToTop } from 'expo-router';
import { type ReactNode, use, useRef } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { UnderAppHeader } from '@/components/app-header';
import { BOTTOM_TAB_BAR_SPACE } from '@/components/section-nav';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing, WideContentWidth } from '@/constants/theme';
import { useLayout } from '@/hooks/use-layout';

/** Scrollable, centered page with a max width so it reads well on phones and desktops. */
export function Screen({
  children,
  onRefresh,
  refreshing = false,
  header,
  width = 'narrow',
  tight = false,
}: {
  children: ReactNode;
  onRefresh?: () => void;
  refreshing?: boolean;
  /** Pinned above the scroll area. */
  header?: ReactNode;
  /** 'wide' for screens with a desktop layout; 'narrow' keeps one reading-width column. */
  width?: 'narrow' | 'wide';
  /** Phones: narrower side margins, for screens that need the width (Research's table). */
  tight?: boolean;
}) {
  const underHeader = use(UnderAppHeader);
  const layout = useLayout();
  const maxWidth = width === 'wide' && layout === 'wide' ? WideContentWidth : MaxContentWidth;
  const { bottom } = useSafeAreaInsets();
  // Phones: the tab bar floats over the bottom, so the end of the page can scroll clear of it.
  const paddingBottom = underHeader && layout === 'compact' ? BOTTOM_TAB_BAR_SPACE + bottom : Spacing.six;
  const gutter = tight && layout === 'compact' ? { paddingHorizontal: Spacing.two, paddingTop: Spacing.two } : null;
  // Tapping the tab that's already on show scrolls back up, like a phone app's tab bar.
  const scroll = useRef<ScrollView>(null);
  useScrollToTop(scroll);
  return (
    <ThemedView style={styles.fill}>
      <SafeAreaView style={styles.fill} edges={underHeader ? ['left', 'right'] : ['top', 'left', 'right']}>
        {header && <View style={[styles.header, { maxWidth }, gutter && { paddingHorizontal: Spacing.two }]}>{header}</View>}
        <ScrollView
          ref={scroll}
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          refreshControl={onRefresh ? <RefreshControl refreshing={refreshing} onRefresh={onRefresh} /> : undefined}>
          <View style={[styles.content, { maxWidth, paddingBottom }, gutter]}>{children}</View>
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  header: {
    width: '100%',
    alignSelf: 'center',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  scroll: { flexGrow: 1, alignItems: 'center' },
  content: {
    width: '100%',
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.three,
    gap: Spacing.three,
  },
});
