import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { View } from 'react-native';

import { StatusBarBackdrop } from '@/components/status-bar-backdrop';
import { ThemedView } from '@/components/themed-view';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { AuthProvider, useAuth } from '@/lib/auth';

export default function RootLayout() {
  const colorScheme = useColorScheme();
  return (
    <AuthProvider>
      <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
        <View style={{ flex: 1 }}>
          <RootStack />
          <StatusBarBackdrop />
        </View>
      </ThemeProvider>
    </AuthProvider>
  );
}

/** Signed in, the app is its tabs ((tabs)/_layout.tsx); signed out, the sign-in page. */
function RootStack() {
  const { session, loading } = useAuth();
  if (loading) return <ThemedView style={{ flex: 1 }} />;
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Protected guard={!!session}>
        <Stack.Screen name="(tabs)" />
      </Stack.Protected>
      <Stack.Protected guard={!session}>
        <Stack.Screen name="sign-in" options={{ title: 'Sign in · Baggery' }} />
      </Stack.Protected>
      <Stack.Screen name="privacy" options={{ title: 'Privacy · Baggery' }} />
    </Stack>
  );
}
