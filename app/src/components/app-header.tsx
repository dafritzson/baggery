import { Image } from 'expo-image';
import { router, usePathname } from 'expo-router';
import { createContext, useState } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Defs, Ellipse, LinearGradient, Path, Stop } from 'react-native-svg';
import * as DropdownMenu from 'zeego/dropdown-menu';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { signOut, useAuth } from '@/lib/auth';
import { useSeason } from '@/lib/season';
import { appEnv } from '@/lib/supabase';

/** True under the app header, which already handles the top safe area. */
export const UnderAppHeader = createContext(false);

/**
 * The header on every signed-in screen: home (a home plate), season year and account.
 * Section tabs (draft, live scores, research) will go in a row below this one.
 */
export function AppHeader() {
  const theme = useTheme();
  return (
    <ThemedView style={[styles.bar, { borderBottomColor: theme.border }]}>
      <SafeAreaView edges={['top', 'left', 'right']}>
        <View style={styles.row}>
          <HomeButton />
          <View style={{ flex: 1 }} />
          {appEnv !== 'production' && <EnvBadge />}
          <YearPicker />
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
    // A draft belongs to one season, so switching years from a draft room goes home.
    if (pathname.startsWith('/draft')) router.replace({ pathname: '/', params: { year: y } });
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
        <View style={[styles.year, { backgroundColor: theme.backgroundElement }]}>
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
  const { data } = useSeason();
  const [imageFailed, setImageFailed] = useState(false);
  const user = session?.user;
  const meta = user?.user_metadata ?? {};
  const avatarUrl: string | undefined = meta.avatar_url ?? meta.picture;
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

  const avatar =
    avatarUrl && !imageFailed ? (
      <Image source={avatarUrl} style={styles.avatar} onError={() => setImageFailed(true)} />
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
          {[fullName, user?.email, data?.myTeam && `Manager: ${data.myTeam.manager_name}`].filter(Boolean).join('\n')}
        </DropdownMenu.Label>
        <DropdownMenu.Separator className="menu-separator" />
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
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    minHeight: 52,
  },
  home: { marginLeft: -Spacing.one, padding: Spacing.one },
  year: { paddingHorizontal: Spacing.two, paddingVertical: Spacing.half, borderRadius: Spacing.two },
  badge: { paddingHorizontal: Spacing.two, paddingVertical: Spacing.half, borderRadius: Spacing.one },
  badgeText: { fontSize: 12, lineHeight: 16 },
  avatar: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
});
