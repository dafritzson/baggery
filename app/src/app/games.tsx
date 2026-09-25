import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';

/** Today's MLB postseason games, with the fantasy players in each. Placeholder for now. */
export default function GamesScreen() {
  return (
    <Screen width="wide">
      <ThemedText type="subtitle">Games</ThemedText>
      <ThemedText themeColor="textSecondary">Coming soon.</ThemedText>
    </Screen>
  );
}
