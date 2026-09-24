import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';

/** Live scoring during the postseason. Placeholder for now. */
export default function LiveScreen() {
  return (
    <Screen width="wide">
      <ThemedText type="subtitle">Live</ThemedText>
      <ThemedText themeColor="textSecondary">Coming soon.</ThemedText>
    </Screen>
  );
}
