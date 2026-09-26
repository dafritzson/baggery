import { Image } from 'expo-image';
import { router, usePathname } from 'expo-router';
import { createContext, useState } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Circle, Defs, Ellipse, LinearGradient, Path, Stop } from 'react-native-svg';
import * as DropdownMenu from 'zeego/dropdown-menu';

import { OwnerBadge } from '@/components/owner-badge';
import { HeaderTabs } from '@/components/section-nav';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Radius, Spacing, WideContentWidth } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useLayout } from '@/hooks/use-layout';
import { useTheme } from '@/hooks/use-theme';
import { signOut, useAuth } from '@/lib/auth';
import { setColorSchemeChoice } from '@/lib/color-scheme';
import { useSeason } from '@/lib/season';
import { teamName } from '@/lib/teams';
import { appEnv } from '@/lib/supabase';

/** True under the app header, which already handles the top safe area. */
export const UnderAppHeader = createContext(false);

/**
 * The header on every signed-in screen: home (a home plate), season year and account.
 * On desktops the section tabs sit here too; phones get them in a bottom bar (section-nav).
 */
export function AppHeader() {
  const theme = useTheme();
  // Lines up with wide screens' content (Screen width="wide").
  const layout = useLayout();
  const maxWidth = layout === 'wide' ? WideContentWidth : MaxContentWidth;
  return (
    <ThemedView style={[styles.bar, { borderBottomColor: theme.border }]}>
      <SafeAreaView edges={['top', 'left', 'right']}>
        <View style={[styles.row, { maxWidth }]}>
          <HomeButton />
          {layout === 'wide' && <HeaderTabs />}
          <View style={{ flex: 1 }} />
          {appEnv !== 'production' && <EnvBadge />}
          <YearPicker />
          <ThemeToggle />
          <AccountButton />
        </View>
      </SafeAreaView>
    </ThemedView>
  );
}

/** Home plate icon; goes to the home page for the season being viewed. */
function HomeButton() {
  const { requestedYear } = useSeason();
  return (
    <Pressable
      onPress={() => router.navigate(requestedYear ? { pathname: '/', params: { year: requestedYear } } : '/')}
      hitSlop={8}
      accessibilityRole="link"
      accessibilityLabel="Home"
      style={({ pressed }) => [styles.home, pressed && { opacity: 0.6 }]}>
      <HomePlate />
    </Pressable>
  );
}

/**
 * A home plate seen from slightly above and behind the catcher: flat edge toward the pitcher,
 * point toward the viewer. The top is tilted (foreshortened), and the two edges that meet at
 * the point show the plate's thickness. Fixed colors: a plate is white in any theme.
 */
function HomePlate() {
  const outline = { stroke: '#3a3d42', strokeWidth: 0.75, strokeLinejoin: 'round' as const };
  return (
    <Svg width={32} height={28} viewBox="0 0 28 24.5">
      <Defs>
        <LinearGradient id="plate-top" x1="0" y1="0" x2="0.35" y2="1">
          <Stop offset="0" stopColor="#ffffff" />
          <Stop offset="1" stopColor="#dfe2e7" />
        </LinearGradient>
      </Defs>
      {/* Shadow on the dirt. */}
      <Ellipse cx={14} cy={21} rx={11.5} ry={2.2} fill="#000000" opacity={0.16} />
      {/* Thickness under the two front edges; the right face is in shade. */}
      <Path d="M4 10 L14 17 L14 19.5 L4 12.5 Z" fill="#b8bcc3" {...outline} />
      <Path d="M24 10 L14 17 L14 19.5 L24 12.5 Z" fill="#9da2aa" {...outline} />
      {/* Top face. */}
      <Path d="M4 3 H24 V10 L14 17 L4 10 Z" fill="url(#plate-top)" {...outline} />
    </Svg>
  );
}

function YearPicker() {
  const theme = useTheme();
  const pathname = usePathname();
  const { data, years, requestedYear } = useSeason();
  const year = data?.season.year ?? requestedYear;

  function pick(y: number) {
    if (y === year) return;
    // A draft belongs to one season, so switching years from a draft room goes to that season's drafts.
    if (pathname.startsWith('/draft/')) router.replace({ pathname: '/draft', params: { year: y } });
    else router.setParams({ year: y });
  }

  if (!year) return null;
  // With one season there's nothing to pick: plain text, no menu.
  if (years.length <= 1) {
    return (
      <View style={styles.year}>
        <ThemedText type="smallBold" themeColor="textSecondary">{year}</ThemedText>
      </View>
    );
  }
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger className="menu-trigger menu-trigger-chip" aria-label={`Season ${year}, change season`}>
        <View style={[styles.year, { backgroundColor: theme.backgroundElement, boxShadow: theme.raised }]}>
          <ThemedText type="smallBold" themeColor="textSecondary">{year} ▾</ThemedText>
        </View>
      </DropdownMenu.Trigger>
      <DropdownMenu.Content className="menu-content menu-content-narrow" align="end" sideOffset={6} collisionPadding={8}>
        <DropdownMenu.Label className="menu-label menu-label-heading">Season</DropdownMenu.Label>
        {years.map((y) => (
          <DropdownMenu.CheckboxItem
            key={String(y)}
            className="menu-item"
            value={y === year ? 'on' : 'off'}
            onValueChange={() => pick(y)}>
            <DropdownMenu.ItemTitle>{String(y)}</DropdownMenu.ItemTitle>
            <DropdownMenu.ItemIndicator className="menu-check">✓</DropdownMenu.ItemIndicator>
          </DropdownMenu.CheckboxItem>
        ))}
      </DropdownMenu.Content>
    </DropdownMenu.Root>
  );
}

/** Moon in light mode, sun in dark: switches to the other, and remembers it in this browser. */
function ThemeToggle() {
  const theme = useTheme();
  const dark = useColorScheme() === 'dark';
  const color = theme.textSecondary;
  return (
    <Pressable
      onPress={() => setColorSchemeChoice(dark ? 'light' : 'dark')}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={dark ? 'Switch to light mode' : 'Switch to dark mode'}
      style={({ pressed }) => [styles.toggle, pressed && { backgroundColor: theme.backgroundElement }]}>
      <Svg width={20} height={20} viewBox="0 0 24 24">
        {dark ? (
          <>
            <Circle cx={12} cy={12} r={4.5} fill={color} />
            <Path
              d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8"
              stroke={color}
              strokeWidth={2}
              strokeLinecap="round"
            />
          </>
        ) : (
          <Path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z" fill={color} />
        )}
      </Svg>
    </Pressable>
  );
}

function EnvBadge() {
  const theme = useTheme();
  return (
    <View style={[styles.badge, { backgroundColor: theme.danger }]}>
      <ThemedText type="smallBold" style={[styles.badgeText, { color: theme.accentText }]}>{appEnv.toUpperCase()}</ThemedText>
    </View>
  );
}

function AccountButton() {
  const theme = useTheme();
  const { session } = useAuth();
  const { data, requestedYear } = useSeason();
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const user = session?.user;
  const meta = user?.user_metadata ?? {};
  // The same photo as everywhere else in the app (uploaded in Settings, else Google's).
  const avatarUrl: string | undefined = (user && data?.photos.get(user.id)) ?? meta.avatar_url ?? meta.picture;
  // "Daniel Fritzson" → "DF"; without a name, the email's first letter.
  const fullName: string | undefined = meta.full_name ?? meta.name;
  const initials = fullName
    ? fullName
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((part) => part[0]!.toUpperCase())
        .join('')
    : (user?.email?.[0] ?? '?').toUpperCase();

  const myTeam = data?.myTeam;
  const avatar =
    avatarUrl && failedUrl !== avatarUrl ? (
      <Image source={avatarUrl} style={styles.avatar} onError={() => setFailedUrl(avatarUrl)} />
    ) : myTeam && user ? (
      // No photo: the same colored initial the Standings show for your team.
      <OwnerBadge teamId={myTeam.id} owner={data?.owners.get(user.id) ?? fullName ?? user.email ?? '?'} size={32} />
    ) : (
      <View style={[styles.avatar, { backgroundColor: theme.accent }]}>
        <ThemedText type="smallBold" style={{ color: theme.accentText }}>{initials}</ThemedText>
      </View>
    );

  // Zeego: native menus on iOS/Android, Radix on web (styled by the .menu-* classes in global.css).
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger className="menu-trigger" aria-label="Account">
        {avatar}
      </DropdownMenu.Trigger>
      <DropdownMenu.Content className="menu-content" align="end" sideOffset={6} collisionPadding={8}>
        <DropdownMenu.Label className="menu-label">
          {[fullName, user?.email, data?.myTeam && `Team: ${teamName(data.myTeam)}`].filter(Boolean).join('\n')}
        </DropdownMenu.Label>
        <DropdownMenu.Separator className="menu-separator" />
        <DropdownMenu.Item
          key="settings"
          className="menu-item"
          onSelect={() => router.push(requestedYear ? { pathname: '/settings', params: { year: requestedYear } } : '/settings')}>
          <DropdownMenu.ItemTitle>Settings</DropdownMenu.ItemTitle>
        </DropdownMenu.Item>
        <DropdownMenu.Item
          key="sign-out"
          className="menu-item menu-item-danger"
          // iOS-only prop; on web Zeego would pass it to the DOM (it's styled by .menu-item-danger there).
          destructive={Platform.OS !== 'web' || undefined}
          onSelect={signOut}>
          <DropdownMenu.ItemTitle>Sign out</DropdownMenu.ItemTitle>
        </DropdownMenu.Item>
      </DropdownMenu.Content>
    </DropdownMenu.Root>
  );
}

const styles = StyleSheet.create({
  bar: { borderBottomWidth: StyleSheet.hairlineWidth },
  row: {
    width: '100%',
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    minHeight: 52,
  },
  home: { marginLeft: -Spacing.one, padding: Spacing.one },
  year: { paddingHorizontal: Spacing.two, paddingVertical: Spacing.half, borderRadius: Radius.md },
  badge: { paddingHorizontal: Spacing.two, paddingVertical: Spacing.half, borderRadius: Radius.sm },
  badgeText: { fontSize: 12, lineHeight: 16 },
  toggle: { width: 32, height: 32, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  avatar: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
});
