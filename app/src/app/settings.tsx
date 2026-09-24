import { router } from 'expo-router';
import { useState } from 'react';

import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { Screen } from '@/components/screen';
import { TeamNameField } from '@/components/team-name-sheet';
import { ThemedText } from '@/components/themed-text';
import { useSeason } from '@/lib/season';
import { supabase } from '@/lib/supabase';
import { suggestTeamName } from '@/lib/teams';

/** Your settings for the season being viewed. More sections will join the team name. */
export default function SettingsScreen() {
  const { data, loading, refetch } = useSeason();
  const [saved, setSaved] = useState(false);

  if (loading) return <Screen><ThemedText themeColor="textSecondary">Loading…</ThemedText></Screen>;
  const team = data?.myTeam;

  async function rename(name: string) {
    setSaved(false);
    const { error } = await supabase.rpc('rename_team', { p_team_id: team!.id, p_name: name });
    if (error) return error.message;
    setSaved(true);
    refetch();
    return null;
  }

  return (
    <Screen>
      <ThemedText type="subtitle">Settings</ThemedText>
      <Card title={data ? `Team name · ${data.season.year}` : 'Team name'}>
        {data && team ? (
          <>
            <TeamNameField
              key={team.id}
              saveLabel="Save"
              initialName={team.name ?? suggestTeamName(data)}
              suggest={() => suggestTeamName(data)}
              onSave={rename}
            />
            {saved && <ThemedText type="small" themeColor="success">Saved.</ThemedText>}
          </>
        ) : (
          <>
            <ThemedText themeColor="textSecondary">You haven&apos;t claimed a spot this season yet.</ThemedText>
            <Button label="Claim a spot" variant="secondary" onPress={() => router.navigate('/')} />
          </>
        )}
      </Card>
    </Screen>
  );
}
