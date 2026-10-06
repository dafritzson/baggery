import { LinearGradient } from 'expo-linear-gradient';
import { router, type Tabs, useIsFocused, usePathname } from 'expo-router';
import { SymbolView, type SymbolViewProps } from '@/components/symbol';
import { type ComponentProps, type ReactNode, type RefObject, createContext, use, useEffect, useLayoutEffect, useState } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { Colors, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useLayout } from '@/hooks/use-layout';
import { useTheme } from '@/hooks/use-theme';
import { liquidBackdrop } from '@/lib/liquid-lens';
import { useSeason } from '@/lib/season';

/** What the tab navigator ((tabs)/_layout.tsx) hands its tab bar: its state, and its navigation. */
export type TabBarProps = Parameters<NonNullable<ComponentProps<typeof Tabs>['tabBar']>>[0];

type TabRoute = TabBarProps['state']['routes'][number];

type SectionRoute = 'draft' | 'standings' | 'games' | 'research' | 'almanac';

interface Section {
  label: string;
  /** The section's tab in the tab navigator. */
  route: SectionRoute;
  /** Its own page: pages opened from it (a draft room) are under this path too. */
  path: string;
  /** Whether it's a stack, which pages open on top of (Draft, Almanac). */
  stack?: boolean;
  /** Icon in the phone tab bar. */
  icon: SymbolViewProps['name'];
}

/** The app's top-level sections: tabs in the header on desktops, a bottom tab bar on phones. */
const SECTIONS: Section[] = [
  {
    label: 'Draft',
    route: 'draft',
    path: '/draft',
    stack: true,
    icon: { ios: 'list.number', android: 'format_list_numbered', web: 'format_list_numbered' },
  },
  {
    label: 'Standings',
    route: 'standings',
    path: '/standings',
    icon: { ios: 'trophy', android: 'leaderboard', web: 'leaderboard' },
  },
  {
    label: 'Games',
    route: 'games',
    path: '/games',
    icon: { ios: 'baseball', android: 'sports_baseball', web: 'sports_baseball' },
  },
  {
    label: 'Research',
    route: 'research',
    path: '/research',
    icon: { ios: 'chart.line.uptrend.xyaxis', android: 'query_stats', web: 'query_stats' },
  },
  {
    label: 'Almanac',
    route: 'almanac',
    path: '/almanac',
    stack: true,
    icon: { ios: 'book.closed', android: 'menu_book', web: 'menu_book' },
  },
];

/**
 * The tab navigator's latest tab bar props, kept by TabBar for the header's tabs (desktop), which
 * sit outside the navigator.
 */
export const TabBarContext = createContext<RefObject<TabBarProps | null>>({ current: null });

/** The season a tab is showing: the year in the URL of the page it's on, if any. */
function seasonShown(route: TabRoute): number | undefined {
  let params: Record<string, unknown> = {};
  for (let r: TabRoute | undefined = route; r; r = r.state?.routes[r.state.index ?? r.state.routes.length - 1] as TabRoute) {
    params = { ...params, ...r.params };
  }
  return Number(params.year) || undefined;
}

/** `params` with the season set to `year` (none: the latest). */
function withYear(params: object | undefined, year: number | undefined): Record<string, unknown> {
  const next: Record<string, unknown> = { ...params };
  delete next.year;
  return year ? { ...next, year: String(year) } : next;
}

// What each tab does when its button is tapped while it's on show (see useTabRetap).
const retaps = new Map<SectionRoute, Set<() => void>>();

/** Calls `onRetap` whenever the section's tab button is tapped while the section is already on show. */
export function useTabRetap(route: SectionRoute, onRetap: () => void) {
  useEffect(() => {
    const listeners = retaps.get(route) ?? new Set();
    retaps.set(route, listeners);
    listeners.add(onRetap);
    return () => {
      listeners.delete(onRetap);
    };
  }, [route, onRetap]);
}

/**
 * Shows section `s` the way a phone's tab bar does: the page its tab was left on, just as it was
 * left (scrolled, filtered, on the day picked), in the season being viewed. The tab that's already
 * on show goes back to its own page instead (from a draft room, say), or up to the top of it.
 */
function switchTab({ state, navigation }: TabBarProps, s: Section, year: number | undefined) {
  const route = state.routes.find((r) => r.name === s.route);
  if (!route) return;
  // A stack's state here can be the partial one it was opened with from a link, without a key until
  // it's first changed.
  const nested = route.state;
  const stackKey = s.stack ? nested?.key : undefined;
  const shown = nested?.routes[nested.index ?? nested.routes.length - 1];
  // The tab's own page, for this season (the one under what's on top, if it's there).
  const ownParams = withYear(nested?.routes.find((r) => r.name === 'index')?.params, year);
  if (state.routes[state.index].key === route.key) {
    retaps.get(s.route)?.forEach((f) => f());
    // Tapped again: from a page opened on top of the tab's own, back to it (the router finds the
    // stack even from a link); on its own page, up to the top (Screen's useScrollToTop).
    if (s.stack && shown && shown.name !== 'index') router.dismissTo({ pathname: s.path as never, params: ownParams as never });
    else navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
  } else if (seasonShown(route) === year) {
    // Keeps its params, and anything opened on top.
    navigation.navigate({ name: route.name, params: undefined, merge: true });
  } else if (!s.stack) {
    navigation.navigate({ name: route.name, params: withYear(route.params, year) });
  } else if (stackKey) {
    // A page opened on top belongs to the season it was opened in (a draft room).
    navigation.dispatch({ type: 'POP_TO', payload: { name: 'index', params: ownParams }, target: stackKey });
    navigation.navigate({ name: route.name, params: undefined, merge: true });
  } else {
    navigation.navigate({ name: route.name, params: { screen: 'index', params: withYear(undefined, year) } });
  }
}

/**
 * The sections, the one on show, and `go`, which the tab buttons call on press. Nothing may change
 * the page on press-in: iPhone Safari takes a tap that does, before the finger lifts, for a hover
 * and doesn't click (drawing a tab on press-in made the first tap on each tab do nothing).
 */
function useSections() {
  const pathname = usePathname();
  const { requestedYear } = useSeason();
  const tabBarRef = use(TabBarContext);
  const active = SECTIONS.find((s) => pathname.startsWith(s.path));
  const go = (s: Section) => {
    if (tabBarRef.current) switchTab(tabBarRef.current, s, requestedYear);
    else router.navigate({ pathname: s.path as never, params: requestedYear ? { year: requestedYear } : {} });
  };
  return { sections: SECTIONS, active, go };
}

/**
 * The tab navigator's tab bar: the floating one on phones. Desktops have their tabs in the header
 * instead, which switch tabs through this too.
 */
export function TabBar(props: TabBarProps) {
  const tabBarRef = use(TabBarContext);
  const compact = useLayout() === 'compact';
  useLayoutEffect(() => {
    tabBarRef.current = props;
  });
  return compact ? <BottomTabBar /> : null;
}

/**
 * A tab's page. Once opened it stays mounted, under the tab on show, so going back to it is
 * immediate and finds it as it was left. It isn't hidden, just covered: Safari lays out a hidden
 * page again when it's shown, whichever way it was hidden (global.css). Marked while covered, so
 * its animations pause.
 */
export function TabScreen({ children }: { children: ReactNode }) {
  const focused = useIsFocused();
  return (
    <View style={styles.tabScreen} {...(focused ? null : ({ dataSet: { tabHidden: '' } } as object))}>
      {children}
    </View>
  );
}

/** Desktop: section tabs inline in the app header. */
export function HeaderTabs() {
  const theme = useTheme();
  const { sections, active, go } = useSections();
  return (
    <View style={styles.headerTabs} accessibilityRole="tablist">
      {sections.map((s) => {
        const selected = s === active;
        return (
          <Pressable
            key={s.label}
            accessibilityRole="tab"
            aria-selected={selected}
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
export const BOTTOM_TAB_BAR_SPACE = 88;

/**
 * Phone: a floating "liquid glass" pill of section buttons (icon and label) over the bottom of the
 * screen. Content scrolls behind it: clear, saturated glass with a bright rim and a sheen, and in
 * Chromium a lens that bends what's behind the edges. The selected tab is a glass bubble that
 * springs over to whichever tab you pick: on web a CSS transition of its transform (global.css),
 * which the browser runs off the main thread, so it keeps moving while the new tab draws.
 */
function BottomTabBar() {
  const dark = useColorScheme() === 'dark';
  const pathname = usePathname();
  const { sections, active, go } = useSections();
  // Readable over whatever's behind it: the theme's glass over plain pages, a darker glass with
  // white labels over artwork (Home's ballpark), in either theme.
  const look = OVER_ARTWORK(pathname) ? LOOKS.overArtwork : dark ? LOOKS.dark : LOOKS.light;
  // Where each tab sits in the bar, for the bubble to slide to.
  const [frames, setFrames] = useState<Record<string, { x: number; width: number }>>({});
  const target = active && frames[active.label];

  return (
    <SafeAreaView
      edges={['bottom', 'left', 'right']}
      style={styles.bottomBar}
      pointerEvents="box-none"
      // Its pill is its own layer while the Games tab zooms (global.css), so the page doesn't cover it.
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
          <View
            pointerEvents="none"
            style={[
              styles.bubble,
              {
                width: target.width,
                transform: [{ translateX: target.x }],
                backgroundColor: look.bubble,
                boxShadow: look.bubbleRim,
              },
            ]}
            {...({ dataSet: { tabBubble: '' } } as object)}
          />
        )}
        {sections.map((s) => {
          const selected = s === active;
          const color = selected ? look.selected : look.label;
          return (
            <Pressable
              key={s.label}
              accessibilityRole="tab"
              aria-selected={selected}
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
  tabScreen: { flex: 1 },
  headerTabs: { flexDirection: 'row', alignSelf: 'stretch', gap: Spacing.three, marginLeft: Spacing.three },
  headerTab: { justifyContent: 'center', borderBottomWidth: 2, borderBottomColor: 'transparent' },
  // Kept inside the screen's side margins: with five sections, the tabs shrink to fit a phone.
  bottomBar: { position: 'absolute', left: 0, right: 0, bottom: 0, alignItems: 'center', paddingBottom: Spacing.two, paddingHorizontal: Spacing.two },
  bottomPill: {
    flexDirection: 'row',
    maxWidth: '100%',
    gap: Spacing.one,
    padding: 5,
    borderRadius: 999,
  },
  round: { borderRadius: 999 },
  // Placed by its transform, which slides.
  bubble: { position: 'absolute', top: 5, bottom: 5, left: 0, borderRadius: 999 },
  bottomTab: {
    alignItems: 'center',
    gap: Spacing.half,
    flexShrink: 1,
    minWidth: 64,
    paddingVertical: Spacing.two,
    paddingHorizontal: 6,
    borderRadius: 999,
  },
  bottomLabel: { fontSize: 11, lineHeight: 14 },
});
