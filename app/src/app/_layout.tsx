import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { View } from 'react-native';

import { AppHeader, UnderAppHeader } from '@/components/app-header';
import { BottomTabBar } from '@/components/section-nav';
import { StatusBarBackdrop } from '@/components/status-bar-backdrop';
import { ThemedView } from '@/components/themed-view';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useLayout } from '@/hooks/use-layout';
import { AuthProvider, useAuth } from '@/lib/auth';
import { PlayerProvider } from '@/lib/player';
import { SeasonProvider } from '@/lib/season';

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

function RootStack() {
  const { session, loading } = useAuth();
  const layout = useLayout();
  if (loading) return <ThemedView style={{ flex: 1 }} />;
  const stack = (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Protected guard={!!session}>
        <Stack.Screen name="index" options={{ title: 'Baggery' }} />
        <Stack.Screen name="draft/index" options={{ title: 'Drafts · Baggery' }} />
        <Stack.Screen name="draft/[id]" options={{ title: 'Draft room · Baggery' }} />
        <Stack.Screen name="standings" options={{ title: 'Standings · Baggery' }} />
        <Stack.Screen name="games" options={{ title: 'Games · Baggery' }} />
        <Stack.Screen name="research" options={{ title: 'Research · Baggery' }} />
        <Stack.Screen name="settings" options={{ title: 'Settings · Baggery' }} />
      </Stack.Protected>
      <Stack.Protected guard={!session}>
        <Stack.Screen name="sign-in" options={{ title: 'Sign in · Baggery' }} />
      </Stack.Protected>
      <Stack.Screen name="privacy" options={{ title: 'Privacy · Baggery' }} />
    </Stack>
  );
  if (!session) return stack;
  // Remount on sign-in/out so season data is loaded for the right user.
  return (
    <SeasonProvider key={session.user.id}>
      <PlayerProvider>
        <ThemedView style={{ flex: 1 }}>
          <AppHeader />
          <UnderAppHeader value>{stack}</UnderAppHeader>
          {layout === 'compact' && <BottomTabBar />}
        </ThemedView>
      </PlayerProvider>
    </SeasonProvider>
  );
}
