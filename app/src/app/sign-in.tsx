import { Link } from 'expo-router';
import { useState } from 'react';
import { Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { Button } from '@/components/button';
import { GoogleSignInButton } from '@/components/google-sign-in-button';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { signInWithGoogleRedirect } from '@/lib/auth';
import { appEnv, supabase } from '@/lib/supabase';

export default function SignInScreen() {
  const [fallbackError, setFallbackError] = useState<string | null>(null);
  return (
    <Screen>
      <View style={styles.hero}>
        <ThemedText type="title">Baggery</ThemedText>
        <ThemedText themeColor="textSecondary">Postseason fantasy baseball. Get some bags.</ThemedText>
      </View>
      <GoogleSignInButton />
      {Platform.OS === 'web' && (
        <Pressable onPress={async () => setFallbackError(await signInWithGoogleRedirect())} hitSlop={8}>
          <ThemedText type="small" themeColor="textSecondary">
            Button not working? Try the other Google sign-in.
          </ThemedText>
        </Pressable>
      )}
      {fallbackError && <ThemedText themeColor="danger">{fallbackError}</ThemedText>}
      {appEnv === 'local' && <DevSignIn />}
      <Link href="/privacy">
        <ThemedText type="small" themeColor="textSecondary">Privacy</ThemedText>
      </Link>
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { paddingTop: Spacing.six, paddingBottom: Spacing.four, gap: Spacing.two },
  dev: { gap: Spacing.two, marginTop: Spacing.four },
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
