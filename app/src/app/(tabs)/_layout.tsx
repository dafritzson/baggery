import { Tabs } from 'expo-router';
import { useRef } from 'react';

import { AppHeader, UnderAppHeader } from '@/components/app-header';
import { BagCelebrations } from '@/components/bag-celebration';
import { TabBar, TabBarContext, type TabBarProps, TabScreen } from '@/components/section-nav';
import { ThemedView } from '@/components/themed-view';
import { useAuth } from '@/lib/auth';
import { useNotificationTaps } from '@/lib/notification-taps';
import { PlayerProvider } from '@/lib/player';
import { ScoresProvider } from '@/lib/scores';
import { SeasonProvider } from '@/lib/season';

/**
 * The signed-in app: the header over a tab navigator, with a tab for each section in the tab bar
 * (Draft and Almanac each a stack, for the pages opened from them), and Home, Settings and Rules, which
 * have no button in the bar. Like a phone app's tabs, each one is only mounted when first opened
 * and then kept (TabScreen), so switching back to it is immediate and finds it as it was left.
 */
export default function TabsLayout() {
  const { session } = useAuth();
  const tabBarRef = useRef<TabBarProps | null>(null);
  useNotificationTaps();
  return (
    // Remount for a different user, so season data is loaded for the right one.
    <SeasonProvider key={session?.user.id}>
      <ScoresProvider>
        <PlayerProvider>
          <TabBarContext value={tabBarRef}>
            <ThemedView style={{ flex: 1 }}>
              <AppHeader />
              <UnderAppHeader value>
                <Tabs
                  backBehavior="fullHistory"
                  screenOptions={{ headerShown: false }}
                  screenLayout={({ children }) => <TabScreen>{children}</TabScreen>}
                  tabBar={(props) => <TabBar {...props} />}>
                  <Tabs.Screen name="index" options={{ title: 'Baggery' }} />
                  <Tabs.Screen name="draft" />
                  <Tabs.Screen name="standings" options={{ title: 'Standings · Baggery' }} />
                  <Tabs.Screen name="games" options={{ title: 'Games · Baggery' }} />
                  <Tabs.Screen name="research" options={{ title: 'Research · Baggery' }} />
                  <Tabs.Screen name="almanac" />
                  <Tabs.Screen name="settings" options={{ title: 'Settings · Baggery' }} />
                  <Tabs.Screen name="rules" options={{ title: 'Rules · Baggery' }} />
                </Tabs>
              </UnderAppHeader>
              <BagCelebrations />
            </ThemedView>
          </TabBarContext>
        </PlayerProvider>
      </ScoresProvider>
    </SeasonProvider>
  );
}
