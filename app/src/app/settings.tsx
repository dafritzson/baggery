import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { ImportSeasonCard } from '@/components/import-season-card';
import { OwnerBadge } from '@/components/owner-badge';
import { Screen } from '@/components/screen';
import { TeamNameField } from '@/components/team-name-sheet';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { MAX_PHOTO_BYTES, removePhoto, uploadPhoto } from '@/lib/avatars';
import { useAuth } from '@/lib/auth';
import { useSeason } from '@/lib/season';
import { supabase } from '@/lib/supabase';
import { suggestTeamName, teamName } from '@/lib/teams';

/** Your settings: your photo, your team name for the season being viewed, and (commissioner) past seasons. */
export default function SettingsScreen() {
  const { data, loading, refetch } = useSeason();
  const [saved, setSaved] = useState(false);

  if (loading) return <Screen><ThemedText themeColor="textSecondary">Loading…</ThemedText></Screen>;
  const team = data?.myTeam;

  async function rename(name: string) {
    // No team this season (a past one, say): nothing to rename. Checked here rather than with
    // `team!`, which the React Compiler reads while rendering, crashing the screen.
    if (!team) return 'You have no team this season.';
    setSaved(false);
    const { error } = await supabase.rpc('rename_team', { p_team_id: team.id, p_name: name });
    if (error) return error.message;
    setSaved(true);
    refetch();
    return null;
  }

  return (
    <Screen>
      <ThemedText type="subtitle">Settings</ThemedText>
      <PhotoCard />
      <Card title={data ? `Team name · ${data.season.year}` : 'Team name'}>
        {data && team ? (
          <>
            <TeamNameField
              key={team.id}
              saveLabel="Save"
              initialName={teamName(team)}
              suggest={() => suggestTeamName(data)}
              onSave={rename}
            />
            {saved && <ThemedText type="small" themeColor="success">Saved.</ThemedText>}
          </>
        ) : data?.season.status === 'complete' ? (
          <ThemedText themeColor="textSecondary">You didn&apos;t have a team in {data.season.year}.</ThemedText>
        ) : (
          <>
            <ThemedText themeColor="textSecondary">You haven&apos;t claimed a spot this season yet.</ThemedText>
            <Button label="Claim a spot" variant="secondary" onPress={() => router.navigate('/draft')} />
          </>
        )}
      </Card>
      <ImportSeasonCard />
    </Screen>
  );
}

/**
 * Your photo, shown next to your team in the Standings and in the top bar. Uploading replaces
 * your Google photo; removing the upload goes back to it (or to your colored initial).
 */
function PhotoCard() {
  const { session } = useAuth();
  const { data, refetch } = useSeason();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const userId = session?.user.id;
  if (!userId) return null;
  const photo = data?.photos.get(userId) ?? null;
  // An uploaded photo is served from the avatars bucket; a Google one from Google.
  const uploaded = !!photo && photo.includes('/storage/v1/object/public/avatars/');
  const name = data?.owners.get(userId) ?? session.user.email ?? '?';

  async function run(action: () => Promise<string | null>, done: string) {
    setBusy(true);
    setMessage(null);
    const error = await action();
    setBusy(false);
    setMessage(error ? { text: error, error: true } : { text: done, error: false });
    if (!error) refetch();
  }

  return (
    <Card title="Photo">
      <View style={styles.photoRow}>
        {photo ? (
          <Image source={photo} style={styles.photo} accessibilityLabel="Your photo" />
        ) : (
          <OwnerBadge teamId={data?.myTeam?.id ?? userId} owner={name} size={72} />
        )}
        <View style={styles.photoActions}>
          <Button label={busy ? 'Saving…' : 'Upload photo'} onPress={() => run(() => uploadPhoto(userId), 'Photo saved.')} disabled={busy} />
          {uploaded && (
            <Button
              label="Remove uploaded photo"
              variant="secondary"
              onPress={() => run(() => removePhoto(userId), 'Removed. Your Google photo (or initial) is back.')}
              disabled={busy}
            />
          )}
        </View>
      </View>
      <ThemedText type="small" themeColor="textSecondary">
        JPG, PNG or WebP, up to {MAX_PHOTO_BYTES / 1024 / 1024} MB. It&apos;s cropped to a square. Everyone in the league sees it next to your team.
      </ThemedText>
      {message && (
        <ThemedText type="small" themeColor={message.error ? 'danger' : 'success'}>{message.text}</ThemedText>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  photoRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  photo: { width: 72, height: 72, borderRadius: 36 },
  photoActions: { flex: 1, gap: Spacing.two, alignItems: 'flex-start' },
});
