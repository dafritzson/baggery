import { type Href, router, usePathname } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useSeason } from '@/lib/season';

interface Section {
  label: string;
  href: Href;
  /** Whether this section owns the current path. */
  matches: (pathname: string) => boolean;
}

/** The app's top-level sections: tabs in the header on desktops, a bottom tab bar on phones. */
const SECTIONS: Section[] = [
  { label: 'Draft', href: '/', matches: (p) => p === '/' || p.startsWith('/draft') },
  { label: 'Live', href: '/live', matches: (p) => p.startsWith('/live') },
  { label: 'Research', href: '/research', matches: (p) => p.startsWith('/research') },
];

function useSections() {
  const pathname = usePathname();
  const { requestedYear } = useSeason();
  const active = SECTIONS.find((s) => s.matches(pathname));
  // Keep the season being viewed when switching sections.
  const go = (s: Section) =>
    router.navigate(requestedYear && typeof s.href === 'string' ? { pathname: s.href as never, params: { year: requestedYear } } : s.href);
  return { sections: SECTIONS.length > 1 ? SECTIONS : [], active, go };
}

/** Desktop: section tabs inline in the app header. */
export function HeaderTabs() {
  const theme = useTheme();
  const { sections, active, go } = useSections();
  if (!sections.length) return null;
  return (
    <View style={styles.headerTabs} accessibilityRole="tablist">
      {sections.map((s) => {
        const selected = s === active;
        return (
          <Pressable
            key={s.label}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            onPress={() => go(s)}
            style={[styles.headerTab, selected && { borderBottomColor: theme.text }]}>
            <ThemedText type="smallBold" themeColor={selected ? 'text' : 'textSecondary'}>{s.label}</ThemedText>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Phone: section tabs in a bar along the bottom of the screen. */
export function BottomTabBar() {
  const theme = useTheme();
  const { sections, active, go } = useSections();
  if (!sections.length) return null;
  return (
    <ThemedView style={[styles.bottomBar, { borderTopColor: theme.border }]}>
      <SafeAreaView edges={['bottom', 'left', 'right']} style={styles.bottomRow} accessibilityRole="tablist">
        {sections.map((s) => {
          const selected = s === active;
          return (
            <Pressable
              key={s.label}
              accessibilityRole="tab"
              accessibilityState={{ selected }}
              onPress={() => go(s)}
              style={styles.bottomTab}>
              <View style={[styles.bottomIndicator, selected && { backgroundColor: theme.accent }]} />
              <ThemedText type="smallBold" themeColor={selected ? 'text' : 'textSecondary'}>{s.label}</ThemedText>
            </Pressable>
          );
        })}
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  headerTabs: { flexDirection: 'row', alignSelf: 'stretch', gap: Spacing.three, marginLeft: Spacing.three },
  headerTab: { justifyContent: 'center', borderBottomWidth: 2, borderBottomColor: 'transparent' },
  bottomBar: { borderTopWidth: StyleSheet.hairlineWidth },
  bottomRow: { flexDirection: 'row' },
  bottomTab: { flex: 1, alignItems: 'center', gap: Spacing.one, paddingBottom: Spacing.two },
  bottomIndicator: { width: 32, height: 3, borderBottomLeftRadius: 3, borderBottomRightRadius: 3 },
});
