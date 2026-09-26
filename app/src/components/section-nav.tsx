import { LinearGradient } from 'expo-linear-gradient';
import { type Href, router, usePathname } from 'expo-router';
import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import { useEffect, useRef, useState } from 'react';
import { Animated, Platform, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { Colors, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTheme } from '@/hooks/use-theme';
import { liquidBackdrop } from '@/lib/liquid-lens';
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
    href: '/draft',
    icon: { ios: 'list.number', android: 'format_list_numbered', web: 'format_list_numbered' },
    matches: (p) => p.startsWith('/draft'),
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
  {
    label: 'Almanac',
    href: '/almanac',
    icon: { ios: 'book.closed', android: 'menu_book', web: 'menu_book' },
    matches: (p) => p.startsWith('/almanac'),
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
 * Phone: a floating "liquid glass" pill of section buttons (icon and label) over the bottom of the
 * screen. Content scrolls behind it: clear, saturated glass with a bright rim and a sheen, and in
 * Chromium a lens that bends what's behind the edges. The selected tab is a glass bubble that
 * springs over to whichever tab you pick.
 */
export function BottomTabBar() {
  const dark = useColorScheme() === 'dark';
  const pathname = usePathname();
  const { sections, active, go } = useSections();
  // Readable over whatever's behind it: the theme's glass over plain pages, a darker glass with
  // white labels over artwork (Home's ballpark), in either theme.
  const look = OVER_ARTWORK(pathname) ? LOOKS.overArtwork : dark ? LOOKS.dark : LOOKS.light;
  // Where each tab sits in the bar, for the bubble to slide to.
  const [frames, setFrames] = useState<Record<string, { x: number; width: number }>>({});
  const [bubbleX] = useState(() => new Animated.Value(0));
  const [bubbleWidth] = useState(() => new Animated.Value(0));
  const placed = useRef(false);
  const target = active && frames[active.label];

  useEffect(() => {
    if (!target) return;
    if (!placed.current) {
      // First time: put it straight there rather than sliding in from the left.
      bubbleX.setValue(target.x);
      bubbleWidth.setValue(target.width);
      placed.current = true;
      return;
    }
    const spring = { speed: 14, bounciness: 7, useNativeDriver: false };
    Animated.parallel([
      Animated.spring(bubbleX, { toValue: target.x, ...spring }),
      Animated.spring(bubbleWidth, { toValue: target.width, ...spring }),
    ]).start();
  }, [target, bubbleX, bubbleWidth]);

  if (!sections.length) return null;
  return (
    <SafeAreaView
      edges={['bottom', 'left', 'right']}
      style={styles.bottomBar}
      pointerEvents="box-none"
      // Its own layer while the Games tab zooms (global.css), so the page doesn't cover it.
      {...({ dataSet: { tabBar: '' } } as object)}>
      <View
        accessibilityRole="tablist"
        style={[
          styles.bottomPill,
          { backgroundColor: look.fill, boxShadow: look.rim },
          look.backdrop,
        ]}>
        {/* Light across the top of the glass. */}
        <LinearGradient
          colors={[look.sheen, 'rgba(255, 255, 255, 0)']}
          locations={[0, 0.6]}
          style={[StyleSheet.absoluteFill, styles.round]}
          pointerEvents="none"
        />
        {target && (
          <Animated.View
            pointerEvents="none"
            style={[
              styles.bubble,
              {
                left: bubbleX,
                width: bubbleWidth,
                backgroundColor: look.bubble,
                boxShadow: look.bubbleRim,
              },
            ]}
          />
        )}
        {sections.map((s) => {
          const selected = s === active;
          const color = selected ? look.selected : look.label;
          return (
            <Pressable
              key={s.label}
              accessibilityRole="tab"
              accessibilityState={{ selected }}
              accessibilityLabel={s.label}
              onPress={() => go(s)}
              onLayout={(e) => {
                const { x, width } = e.nativeEvent.layout;
                setFrames((f) => (f[s.label]?.x === x && f[s.label]?.width === width ? f : { ...f, [s.label]: { x, width } }));
              }}
              style={styles.bottomTab}>
              <SymbolView name={s.icon} size={22} tintColor={color} />
              <ThemedText type="smallBold" style={[styles.bottomLabel, { color }]}>{s.label}</ThemedText>
            </Pressable>
          );
        })}
      </View>
    </SafeAreaView>
  );
}

/**
 * Pages whose background is artwork rather than a plain page color, so the bar can't count on the
 * theme's background behind it. See docs/PLAN.md, "iOS app notes": on iOS, real Liquid Glass
 * adapts to what's behind it by itself.
 */
const OVER_ARTWORK = (pathname: string) => pathname === '/';

// Web: clear glass that blurs a little and brings out the colors behind it. In Chromium the lens
// bends what's behind the rim, so the blur stays light enough to see it (react-native-web passes
// backdrop-filter through, with the -webkit- prefix).
const backdrop = (withLens: string, withoutLens: string) =>
  Platform.OS === 'web' ? ({ backdropFilter: liquidBackdrop(withLens, withoutLens) } as object) : null;

/** The bar's glass: fill, rim (brightest at the top, where the light hits), sheen, bubble and labels. */
const LOOKS = {
  light: {
    fill: 'rgba(255, 255, 255, 0.18)',
    rim: 'inset 0 1px 0.5px rgba(255, 255, 255, 0.95), inset 0 -1px 0.5px rgba(255, 255, 255, 0.5), inset 0 0 0 1px rgba(255, 255, 255, 0.55), 0 10px 30px rgba(16, 24, 40, 0.18)',
    sheen: 'rgba(255, 255, 255, 0.55)',
    bubble: 'rgba(255, 255, 255, 0.55)',
    bubbleRim: 'inset 0 1px 0 rgba(255, 255, 255, 1), inset 0 0 0 1px rgba(255, 255, 255, 0.8), 0 2px 8px rgba(16, 24, 40, 0.12)',
    label: Colors.light.textSecondary,
    selected: Colors.light.accent,
    backdrop: backdrop('blur(3px) saturate(220%) brightness(1.06)', 'blur(8px) saturate(220%) brightness(1.06)'),
  },
  dark: {
    fill: 'rgba(255, 255, 255, 0.07)',
    rim: 'inset 0 1px 0.5px rgba(255, 255, 255, 0.35), inset 0 -1px 0.5px rgba(255, 255, 255, 0.12), inset 0 0 0 1px rgba(255, 255, 255, 0.14), 0 10px 30px rgba(0, 0, 0, 0.55)',
    sheen: 'rgba(255, 255, 255, 0.14)',
    bubble: 'rgba(255, 255, 255, 0.13)',
    bubbleRim: 'inset 0 1px 0 rgba(255, 255, 255, 0.3), inset 0 0 0 1px rgba(255, 255, 255, 0.12)',
    label: Colors.dark.textSecondary,
    selected: Colors.dark.accent,
    backdrop: backdrop('blur(3px) saturate(220%) brightness(1.06)', 'blur(8px) saturate(220%) brightness(1.06)'),
  },
  // Over busy, colorful artwork: a smoky glass that darkens and calms what's behind it, with white
  // labels, so they stand out on grass, dirt or sky alike.
  overArtwork: {
    fill: 'rgba(12, 18, 30, 0.46)',
    rim: 'inset 0 1px 0.5px rgba(255, 255, 255, 0.45), inset 0 -1px 0.5px rgba(255, 255, 255, 0.15), inset 0 0 0 1px rgba(255, 255, 255, 0.18), 0 10px 30px rgba(0, 0, 0, 0.35)',
    sheen: 'rgba(255, 255, 255, 0.16)',
    bubble: 'rgba(255, 255, 255, 0.24)',
    bubbleRim: 'inset 0 1px 0 rgba(255, 255, 255, 0.5), inset 0 0 0 1px rgba(255, 255, 255, 0.2)',
    label: 'rgba(255, 255, 255, 0.82)',
    selected: '#FFFFFF',
    backdrop: backdrop('blur(10px) saturate(140%) brightness(0.85)', 'blur(14px) saturate(140%) brightness(0.85)'),
  },
};

const styles = StyleSheet.create({
  headerTabs: { flexDirection: 'row', alignSelf: 'stretch', gap: Spacing.three, marginLeft: Spacing.three },
  headerTab: { justifyContent: 'center', borderBottomWidth: 2, borderBottomColor: 'transparent' },
  bottomBar: { position: 'absolute', left: 0, right: 0, bottom: 0, alignItems: 'center', paddingBottom: Spacing.three },
  bottomPill: {
    flexDirection: 'row',
    gap: Spacing.one,
    padding: 5,
    borderRadius: 999,
  },
  round: { borderRadius: 999 },
  bubble: { position: 'absolute', top: 5, bottom: 5, borderRadius: 999 },
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
