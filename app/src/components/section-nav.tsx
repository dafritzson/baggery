import { type Href, router, usePathname } from 'expo-router';
import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTheme } from '@/hooks/use-theme';
import { useSeason } from '@/lib/season';

interface Section {
  label: string;
  href: Href;
  /** Icon in the phone tab bar. */
  icon: SymbolViewProps['name'];
  /** Whether this section owns the current path. */
  matches: (pathname: string) => boolean;
}

/** The app's top-level sections: tabs in the header on desktops, a bottom tab bar on phones. */
const SECTIONS: Section[] = [
  {
    label: 'Draft',
    href: '/',
    icon: { ios: 'list.number', android: 'format_list_numbered', web: 'format_list_numbered' },
    matches: (p) => p === '/' || p.startsWith('/draft'),
  },
  {
    label: 'Standings',
    href: '/standings',
    icon: { ios: 'trophy', android: 'leaderboard', web: 'leaderboard' },
    matches: (p) => p.startsWith('/standings'),
  },
  {
    label: 'Games',
    href: '/games',
    icon: { ios: 'baseball', android: 'sports_baseball', web: 'sports_baseball' },
    matches: (p) => p.startsWith('/games'),
  },
  {
    label: 'Research',
    href: '/research',
    icon: { ios: 'chart.line.uptrend.xyaxis', android: 'query_stats', web: 'query_stats' },
    matches: (p) => p.startsWith('/research'),
  },
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

/** Room the phone tab bar takes at the bottom of the screen, above the safe area. */
export const BOTTOM_TAB_BAR_SPACE = 96;

/**
 * Phone: a floating bar of section buttons (icon and label) over the bottom of the screen.
 * Content scrolls behind it, blurred through the bar's frosted glass.
 */
export function BottomTabBar() {
  const theme = useTheme();
  const dark = useColorScheme() === 'dark';
  const { sections, active, go } = useSections();
  if (!sections.length) return null;
  return (
    <SafeAreaView edges={['bottom', 'left', 'right']} style={styles.bottomBar} pointerEvents="box-none">
      <View
        accessibilityRole="tablist"
        style={[
          styles.bottomPill,
          {
            backgroundColor: dark ? 'rgba(28, 29, 32, 0.62)' : 'rgba(255, 255, 255, 0.62)',
            borderColor: dark ? 'rgba(255, 255, 255, 0.12)' : 'rgba(0, 0, 0, 0.08)',
            boxShadow: dark
              ? '0 8px 24px rgba(0, 0, 0, 0.5), inset 0 1px 0 rgba(255, 255, 255, 0.08)'
              : '0 8px 24px rgba(0, 0, 0, 0.14), inset 0 1px 0 rgba(255, 255, 255, 0.8)',
          },
          glass,
        ]}>
        {sections.map((s) => {
          const selected = s === active;
          const color = selected ? theme.accent : theme.textSecondary;
          return (
            <Pressable
              key={s.label}
              accessibilityRole="tab"
              accessibilityState={{ selected }}
              accessibilityLabel={s.label}
              onPress={() => go(s)}
              style={[styles.bottomTab, selected && { backgroundColor: dark ? 'rgba(91, 141, 239, 0.18)' : 'rgba(11, 61, 145, 0.10)' }]}>
              <SymbolView name={s.icon} size={22} tintColor={color} />
              <ThemedText type="smallBold" style={[styles.bottomLabel, { color }]}>{s.label}</ThemedText>
            </Pressable>
          );
        })}
      </View>
    </SafeAreaView>
  );
}

// Frosted glass on web (react-native-web passes backdrop-filter through, with the -webkit- prefix).
const glass = Platform.OS === 'web' ? ({ backdropFilter: 'blur(20px) saturate(180%)' } as object) : null;

const styles = StyleSheet.create({
  headerTabs: { flexDirection: 'row', alignSelf: 'stretch', gap: Spacing.three, marginLeft: Spacing.three },
  headerTab: { justifyContent: 'center', borderBottomWidth: 2, borderBottomColor: 'transparent' },
  bottomBar: { position: 'absolute', left: 0, right: 0, bottom: 0, alignItems: 'center', paddingBottom: Spacing.three },
  bottomPill: {
    flexDirection: 'row',
    gap: Spacing.one,
    padding: Spacing.one,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  bottomTab: {
    alignItems: 'center',
    gap: Spacing.half,
    minWidth: 76,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    borderRadius: 999,
  },
  bottomLabel: { fontSize: 11, lineHeight: 14 },
});
