import { LuckiestGuy_400Regular, useFonts } from '@expo-google-fonts/luckiest-guy';
import { Link } from 'expo-router';
import { useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { GAME_FONT } from '@/components/bag-game';
import { Ballpark } from '@/components/ballpark';
import { Button } from '@/components/button';
import { GoogleSignInButton } from '@/components/google-sign-in-button';
import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { signInWithGoogleRedirect } from '@/lib/auth';
import { fieldView, isNight } from '@/lib/bag-game';
import { appEnv, supabase } from '@/lib/supabase';

/** Sign in: the name up in the sky over Home's ballpark, and the sign-in card down on the field. */
export default function SignInScreen() {
  const theme = useTheme();
  const { top, bottom } = useSafeAreaInsets();
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const [night] = useState(() => isNight(new Date()));
  const [fontsLoaded, fontError] = useFonts({ LuckiestGuy_400Regular });
  const [fallbackError, setFallbackError] = useState<string | null>(null);
  const view = size && fieldView(size.width, size.height);

  return (
    <View
      style={[styles.screen, { backgroundColor: night ? '#040A1C' : '#3F9FE0' }]}
      onLayout={(e) => setSize({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height })}>
      {view && <Ballpark view={view} night={night} />}
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingTop: top + Spacing.three, paddingBottom: bottom + Spacing.four }]}
        keyboardShouldPersistTaps="handled">
        <View style={[styles.hero, view && { minHeight: view.horizon - top }]}>
          {(fontsLoaded || fontError) && <Text style={styles.wordmark}>BAGGERY</Text>}
          <Text style={styles.tagline}>Let’s get some bags.</Text>
        </View>
        <View style={[styles.card, { backgroundColor: theme.backgroundElement, boxShadow: theme.floating }]}>
          <GoogleSignInButton />
          {Platform.OS === 'web' && (
            <Pressable onPress={async () => setFallbackError(await signInWithGoogleRedirect())} hitSlop={8}>
              <ThemedText type="small" themeColor="textSecondary" style={styles.fallback}>
                Trouble signing in? <ThemedText type="small" themeColor="textSecondary" style={styles.underline}>Try another way</ThemedText>
              </ThemedText>
            </Pressable>
          )}
          {fallbackError && <ThemedText themeColor="danger">{fallbackError}</ThemedText>}
          {appEnv === 'local' && <DevSignIn />}
        </View>
        <Link href="/privacy" style={styles.privacy}>
          <Text style={styles.privacyText}>Privacy</Text>
        </Link>
      </ScrollView>
    </View>
  );
}

// Text over the sky and field is always light: the ballpark looks the same in either theme.
const shadow = { textShadowColor: 'rgba(0, 0, 0, 0.45)', textShadowOffset: { width: 0, height: 2 }, textShadowRadius: 6 };

const styles = StyleSheet.create({
  screen: { flex: 1, overflow: 'hidden' },
  scroll: { flexGrow: 1, alignItems: 'center', paddingHorizontal: Spacing.three, gap: Spacing.four },
  hero: { alignItems: 'center', justifyContent: 'center', gap: Spacing.two, width: '100%' },
  wordmark: { fontFamily: GAME_FONT, fontSize: 64, lineHeight: 72, color: '#FFD84D', ...shadow },
  tagline: { color: '#FFFFFF', fontSize: 17, fontWeight: 600, textAlign: 'center', ...shadow },
  card: {
    width: '100%',
    maxWidth: 400,
    marginTop: 'auto',
    padding: Spacing.four,
    borderRadius: Radius.lg,
    gap: Spacing.three,
  },
  fallback: { textAlign: 'center' },
  underline: { textDecorationLine: 'underline' },
  privacy: { alignSelf: 'center' },
  privacyText: { color: '#FFFFFF', fontSize: 14, fontWeight: 600, ...shadow },
  dev: { gap: Spacing.two, marginTop: Spacing.two },
  input: { minHeight: 44, borderWidth: 1, borderRadius: Radius.md, paddingHorizontal: Spacing.three, fontSize: 16 },
});

/** Local development only: sign in as a seeded test manager (e.g. kyle@example.com). */
function DevSignIn() {
  const theme = useTheme();
  const [email, setEmail] = useState('daniel@example.com');
  const [error, setError] = useState<string | null>(null);
  return (
    <View style={styles.dev}>
      <ThemedText type="smallBold" themeColor="textSecondary">Local dev sign-in</ThemedText>
      <TextInput
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        style={[styles.input, { color: theme.text, borderColor: theme.border, boxShadow: theme.sunken }]}
      />
      <Button
        label="Sign in as test user"
        variant="secondary"
        onPress={async () => {
          const { error } = await supabase.auth.signInWithPassword({ email, password: 'password123' });
          setError(error?.message ?? null);
        }}
      />
      {error && <ThemedText themeColor="danger">{error}</ThemedText>}
    </View>
  );
}
