import { Stack } from 'expo-router';

/** The Almanac tab: the record book, and a manager's page opened on top of it. */
export default function AlmanacLayout() {
  return (
    <Stack screenOptions={{ headerShown: false, title: 'Almanac · Baggery' }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="[manager]" />
      <Stack.Screen name="h2h" />
    </Stack>
  );
}
