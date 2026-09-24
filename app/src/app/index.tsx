import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { Screen } from '@/components/screen';
import { Sheet } from '@/components/sheet';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { formatLockTime, playerLine } from '@/lib/format';
import { type Draft, type SeasonData, type Team, currentRosters, useSeason } from '@/lib/season';
import { callFunction, supabase } from '@/lib/supabase';

const DRAFT_NAMES: Record<number, string> = {
  1: 'Draft 1 · before the Wild Card',
  2: 'Draft 2 · before the Division Series',
  3: 'Draft 3 · before the Championship Series',
  4: 'Draft 4 · before the World Series',
};

export default function HomeScreen() {
  const { data, loading, refetch, requestedYear } = useSeason();

  return (
    <Screen onRefresh={refetch} refreshing={false}>
      {loading && <ThemedText themeColor="textSecondary">Loading…</ThemedText>}
      {!loading && !data && (
        <ThemedText>{requestedYear ? `There's no ${requestedYear} season.` : 'No season set up yet.'}</ThemedText>
      )}
      {data && (
        <>
          {!data.myTeam && <ClaimTeam data={data} onClaimed={refetch} />}
          <DraftsCard data={data} />
          <TeamsCard data={data} />
          {data.isCommissioner && <CommissionerCard data={data} />}
        </>
      )}
    </Screen>
  );
}

function ClaimTeam({ data, onClaimed }: { data: SeasonData; onClaimed: () => void }) {
  const [choice, setChoice] = useState<Team | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const open = data.teams.filter((t) => !t.user_id);

  async function claim() {
    if (!choice) return;
    setSaving(true);
    const { error } = await supabase.rpc('claim_team', { p_team_id: choice.id });
    setSaving(false);
    if (error) return setError(error.message);
    setChoice(null);
    onClaimed();
  }

  return (
    <Card title="Which manager are you?">
      {open.length === 0 ? (
        <ThemedText>Every team is claimed. Ask the commissioner to add you.</ThemedText>
      ) : (
        <View style={styles.chips}>
          {open.map((t) => (
            <Button key={t.id} label={t.manager_name} variant="secondary" compact onPress={() => setChoice(t)} />
          ))}
        </View>
      )}
      <Sheet visible={!!choice} title={`You're ${choice?.manager_name}?`} onClose={() => setChoice(null)}>
        <ThemedText themeColor="textSecondary">
          This links your Google account to {choice?.manager_name}&apos;s team. Only the commissioner can change it later.
        </ThemedText>
        {error && <ThemedText themeColor="danger">{error}</ThemedText>}
        <Button label={`Yes, I'm ${choice?.manager_name}`} onPress={claim} loading={saving} />
        <Button label="Cancel" variant="secondary" onPress={() => setChoice(null)} />
      </Sheet>
    </Card>
  );
}

function draftStatus(draft: Draft): string {
  if (draft.status === 'live') return 'Live now';
  if (draft.status === 'complete') return 'Complete';
  return draft.locks_at ? `Picks lock ${formatLockTime(draft.locks_at)}` : 'Not started';
}

function DraftsCard({ data }: { data: SeasonData }) {
  const current = data.drafts.find((d) => d.status !== 'complete');
  const done = data.drafts.filter((d) => d.status === 'complete');
  return (
    <Card title="Drafts">
      {current && (
        <View style={styles.draftRow}>
          <ThemedText type="smallBold">{DRAFT_NAMES[current.number]}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">{draftStatus(current)}</ThemedText>
          <Button
            label={current.status === 'live' ? 'Enter the draft room' : 'Open the draft room'}
            onPress={() => router.push({ pathname: '/draft/[id]', params: { id: current.id, year: data.season.year } })}
          />
        </View>
      )}
      {done.map((d) => (
        <Pressable key={d.id} onPress={() => router.push({ pathname: '/draft/[id]', params: { id: d.id, year: data.season.year } })}>
          <ThemedText type="small" themeColor="textSecondary">{DRAFT_NAMES[d.number]} · Complete ›</ThemedText>
        </Pressable>
      ))}
    </Card>
  );
}

function TeamsCard({ data }: { data: SeasonData }) {
  const rosters = currentRosters(data);
  return (
    <Card title="Teams">
      {data.teams.map((team) => {
        const roster = rosters.get(team.id) ?? [];
        return (
          <View key={team.id} style={styles.team}>
            <ThemedText type="smallBold">
              {team.manager_name}
              {team.id === data.myTeam?.id ? ' (you)' : ''}
              {team.id === data.season.commissioner_team_id ? ' · commish' : ''}
              {!team.user_id ? ' · not signed up' : ''}
            </ThemedText>
            {roster.length === 0 ? (
              <ThemedText type="small" themeColor="textSecondary">No players yet</ThemedText>
            ) : (
              roster.map((id) => (
                <ThemedText key={id} type="small">{playerLine(data, id)}</ThemedText>
              ))
            )}
          </View>
        );
      })}
    </Card>
  );
}

function CommissionerCard({ data }: { data: SeasonData }) {
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [profiles, setProfiles] = useState<Map<string, string>>(new Map());
  const eligible = data.pool.filter((p) => p.on_postseason_roster).length;

  useEffect(() => {
    supabase
      .from('profiles')
      .select('id, display_name')
      .then(({ data: rows }) => setProfiles(new Map((rows ?? []).map((r) => [r.id, r.display_name]))));
  }, [data.teams]);

  async function sync() {
    setSyncing(true);
    const error = await callFunction('sync-pool', { seasonId: data.season.id });
    setSyncing(false);
    setMessage(error ?? 'Player pool updated.');
  }

  async function unassign(team: Team) {
    const { error } = await supabase.rpc('assign_team', { p_team_id: team.id, p_user_id: null });
    setMessage(error ? error.message : `${team.manager_name} is unclaimed again.`);
  }

  return (
    <Card title="Commissioner">
      <ThemedText type="small">
        Player pool: {eligible} hitters from {data.mlbTeams.size} MLB teams.
      </ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        Pulls every hitter on the active roster of each team that has clinched, plus the Wild Card start time.
      </ThemedText>
      <Button label="Sync player pool from MLB" onPress={sync} loading={syncing} />
      {message && <ThemedText type="small">{message}</ThemedText>}
      <ThemedText type="smallBold" style={{ marginTop: Spacing.two }}>Who claimed which team</ThemedText>
      {data.teams.map((t) => (
        <View key={t.id} style={styles.assignRow}>
          <ThemedText type="small" style={{ flex: 1 }}>
            {t.manager_name}: {t.user_id ? profiles.get(t.user_id) ?? 'signed up' : '—'}
          </ThemedText>
          {t.user_id && t.id !== data.myTeam?.id && (
            <Button label="Unassign" variant="secondary" compact onPress={() => unassign(t)} />
          )}
        </View>
      ))}
    </Card>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  draftRow: { gap: Spacing.two },
  team: { gap: Spacing.half, paddingVertical: Spacing.one },
  assignRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, minHeight: 36 },
});
