import { Image } from 'expo-image';
import { router, usePathname } from 'expo-router';
import { createContext, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/button';
import { Sheet } from '@/components/sheet';
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
 * The header on every signed-in screen: app name, season year and account.
 * Section tabs (draft, live scores, research) will go in a row below this one.
 */
export function AppHeader() {
  const theme = useTheme();
  return (
    <ThemedView style={[styles.bar, { borderBottomColor: theme.border }]}>
      <SafeAreaView edges={['top', 'left', 'right']}>
        <View style={styles.row}>
          <ThemedText type="smallBold" style={styles.title}>Baggery</ThemedText>
          <YearPicker />
          <View style={{ flex: 1 }} />
          {appEnv !== 'production' && <EnvBadge />}
          <AccountButton />
        </View>
      </SafeAreaView>
    </ThemedView>
  );
}

function YearPicker() {
  const theme = useTheme();
  const pathname = usePathname();
  const { data, years, requestedYear } = useSeason();
  const [open, setOpen] = useState(false);
  const year = data?.season.year ?? requestedYear;
  const canPick = years.length > 1;

  function pick(y: number) {
    setOpen(false);
    // A draft belongs to one season, so switching years from a draft room goes home.
    if (pathname.startsWith('/draft')) router.replace({ pathname: '/', params: { year: y } });
    else router.setParams({ year: y });
  }

  if (!year) return null;
  return (
    <>
      <Pressable
        disabled={!canPick}
        onPress={() => setOpen(true)}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={`Season ${year}${canPick ? ', change season' : ''}`}
        style={[styles.year, canPick && { backgroundColor: theme.backgroundElement }]}>
        <ThemedText type="smallBold" themeColor="textSecondary">
          {year}{canPick ? ' ▾' : ''}
        </ThemedText>
      </Pressable>
      <Sheet visible={open} title="Season" onClose={() => setOpen(false)}>
        {years.map((y) => (
          <Button key={y} label={String(y)} variant={y === year ? 'primary' : 'secondary'} onPress={() => pick(y)} />
        ))}
      </Sheet>
    </>
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
  const [open, setOpen] = useState(false);
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

  return (
    <>
      <Pressable onPress={() => setOpen(true)} hitSlop={8} accessibilityRole="button" accessibilityLabel="Account">
        {avatarUrl && !imageFailed ? (
          <Image source={avatarUrl} style={styles.avatar} onError={() => setImageFailed(true)} />
        ) : (
          <View style={[styles.avatar, { backgroundColor: theme.accent }]}>
            <ThemedText type="smallBold" style={{ color: theme.accentText }}>{initials}</ThemedText>
          </View>
        )}
      </Pressable>
      <Sheet visible={open} title="Account" onClose={() => setOpen(false)}>
        <ThemedText>{user?.email}</ThemedText>
        {data?.myTeam && (
          <ThemedText themeColor="textSecondary">Manager: {data.myTeam.manager_name}</ThemedText>
        )}
        <Button label="Sign out" variant="danger" onPress={signOut} />
        <Button label="Cancel" variant="secondary" onPress={() => setOpen(false)} />
      </Sheet>
    </>
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
  title: { fontSize: 18, lineHeight: 24 },
  year: { paddingHorizontal: Spacing.two, paddingVertical: Spacing.half, borderRadius: Spacing.two },
  badge: { paddingHorizontal: Spacing.two, paddingVertical: Spacing.half, borderRadius: Spacing.one },
  badgeText: { fontSize: 12, lineHeight: 16 },
  avatar: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
});
