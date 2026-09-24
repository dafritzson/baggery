import { type ReactNode, use } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { UnderAppHeader } from '@/components/app-header';
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
}: {
  children: ReactNode;
  onRefresh?: () => void;
  refreshing?: boolean;
  /** Pinned above the scroll area. */
  header?: ReactNode;
  /** 'wide' for screens with a desktop layout; 'narrow' keeps one reading-width column. */
  width?: 'narrow' | 'wide';
}) {
  const underHeader = use(UnderAppHeader);
  const layout = useLayout();
  const maxWidth = width === 'wide' && layout === 'wide' ? WideContentWidth : MaxContentWidth;
  return (
    <ThemedView style={styles.fill}>
      <SafeAreaView style={styles.fill} edges={underHeader ? ['left', 'right'] : ['top', 'left', 'right']}>
        {header && <View style={[styles.header, { maxWidth }]}>{header}</View>}
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          refreshControl={onRefresh ? <RefreshControl refreshing={refreshing} onRefresh={onRefresh} /> : undefined}>
          <View style={[styles.content, { maxWidth }]}>{children}</View>
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
    paddingBottom: Spacing.six,
    gap: Spacing.three,
  },
});
