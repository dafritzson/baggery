import { StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { snakeSlots } from '@core/draft.ts';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { appEnv, supabaseUrl } from '@/lib/supabase';
import { MaxContentWidth, Spacing } from '@/constants/theme';

// Placeholder home screen until Phase 1. Proves the shared core and config are wired up.
export default function HomeScreen() {
  const preview = snakeSlots(['1', '2', '3'], 2).join(' ');
  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ThemedText type="title">Baggery</ThemedText>
        <ThemedText themeColor="textSecondary">get some bags</ThemedText>
        <ThemedView type="backgroundElement" style={styles.card}>
          <ThemedText type="small">Environment: {appEnv}</ThemedText>
          <ThemedText type="small">Supabase: {supabaseUrl}</ThemedText>
          <ThemedText type="small">Snake order: {preview}</ThemedText>
        </ThemedView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'center',
  },
  safeArea: {
    flex: 1,
    maxWidth: MaxContentWidth,
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.five,
    gap: Spacing.two,
  },
  card: {
    marginTop: Spacing.three,
    padding: Spacing.three,
    borderRadius: Spacing.three,
    gap: Spacing.one,
  },
});
