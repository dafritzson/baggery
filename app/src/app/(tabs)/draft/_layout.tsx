import { Stack } from 'expo-router';

/** The Draft tab: the season's drafts, and a draft room opened on top of them. */
export default function DraftLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" options={{ title: 'Drafts · Baggery' }} />
      <Stack.Screen name="[id]" options={{ title: 'Draft room · Baggery' }} />
    </Stack>
  );
}
