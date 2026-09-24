import { PlayersList } from '@/components/players-list';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { useSeason } from '@/lib/season';

/** The draft room's player list, to browse and open player stats any time. */
export default function ResearchScreen() {
  const { data, loading } = useSeason();
  return (
    <Screen width="wide">
      {loading && <ThemedText themeColor="textSecondary">Loading…</ThemedText>}
      {!loading && !data && <ThemedText>No season set up yet.</ThemedText>}
      {data && <PlayersList data={data} />}
    </Screen>
  );
}
