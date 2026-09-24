import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { PlayerName } from '@/components/player-name';
import { Columns } from '@/components/columns';
import { Screen } from '@/components/screen';
import { TeamNameSheet } from '@/components/team-name-sheet';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useLayout } from '@/hooks/use-layout';
import { useTheme } from '@/hooks/use-theme';
import { formatLockTime, playerLine } from '@/lib/format';
import { type Draft, type SeasonData, type Team, currentRosters, useSeason } from '@/lib/season';
import { callFunction, supabase } from '@/lib/supabase';
import { ownerName, suggestTeamName, teamName } from '@/lib/teams';

const DRAFT_NAMES: Record<number, string> = {
  1: 'Draft 1 · before the Wild Card',
  2: 'Draft 2 · before the Division Series',
  3: 'Draft 3 · before the Championship Series',
  4: 'Draft 4 · before the World Series',
};

export default function HomeScreen() {
  const { data, loading, refetch, requestedYear } = useSeason();
  const wide = useLayout() === 'wide';

  return (
    <Screen width="wide" onRefresh={refetch} refreshing={false}>
      {loading && <ThemedText themeColor="textSecondary">Loading…</ThemedText>}
      {!loading && !data && (
        <ThemedText>{requestedYear ? `There's no ${requestedYear} season.` : 'No season set up yet.'}</ThemedText>
      )}
      {data && !data.myTeam && <ClaimTeam data={data} onClaimed={refetch} />}
      {data &&
        (wide ? (
          <Columns
            main={
              <>
                <DraftsCard data={data} />
                {data.isCommissioner && <CommissionerCard data={data} />}
              </>
            }
            side={<TeamsCard data={data} />}
            sideWidth={380}
          />
        ) : (
          <>
            <DraftsCard data={data} />
            <TeamsCard data={data} />
            {data.isCommissioner && <CommissionerCard data={data} />}
          </>
        ))}
    </Screen>
  );
}

function ClaimTeam({ data, onClaimed }: { data: SeasonData; onClaimed: () => void }) {
  const [choice, setChoice] = useState<Team | null>(null);
  const open = data.teams.filter((t) => !t.user_id);

  async function claim(teamId: string, name: string) {
    const { error } = await supabase.rpc('claim_team', { p_team_id: teamId, p_name: name });
    if (error) return error.message;
    setChoice(null);
    onClaimed();
    return null;
  }

  return (
    <Card title="Claim your spot">
      {open.length === 0 ? (
        <ThemedText>Every spot is claimed. Ask the commissioner to free one up.</ThemedText>
      ) : (
        <>
          <ThemedText type="small" themeColor="textSecondary">Pick an open spot, then name your team.</ThemedText>
          <View style={styles.chips}>
            {open.map((t) => (
              <Button key={t.id} label={teamName(t)} variant="secondary" compact onPress={() => setChoice(t)} />
            ))}
          </View>
        </>
      )}
      {choice && (
        <TeamNameSheet
          key={choice.id}
          visible
          title="Name your team"
          description="This spot becomes yours. You can rename your team any time."
          saveLabel="Claim this spot"
          initialName={teamName(choice)}
          suggest={() => suggestTeamName(data)}
          onSave={(name) => claim(choice.id, name)}
          onClose={() => setChoice(null)}
        />
      )}
    </Card>
  );
}

/** The commissioner renaming another manager's team (your own is in Settings). */
function RenameTeam({ data, team, onClose }: { data: SeasonData; team: Team; onClose: () => void }) {
  async function rename(name: string) {
    const { error } = await supabase.rpc('rename_team', { p_team_id: team.id, p_name: name });
    if (error) return error.message;
    onClose();
    return null;
  }
  return (
    <TeamNameSheet
      key={team.id}
      visible
      title="Rename team"
      saveLabel="Save"
      initialName={teamName(team)}
      suggest={() => suggestTeamName(data)}
      onSave={rename}
      onClose={onClose}
    />
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
  const theme = useTheme();
  const rosters = currentRosters(data);
  const [renaming, setRenaming] = useState<Team | null>(null);
  return (
    <Card title="Teams">
      {data.teams.map((team) => {
        const roster = rosters.get(team.id) ?? [];
        const owner = ownerName(data, team);
        const mine = team.id === data.myTeam?.id;
        const canRename = data.isCommissioner && !mine && !!team.user_id;
        return (
          <View key={team.id} style={styles.team}>
            <View style={styles.teamHeader}>
              <ThemedText type="smallBold" style={{ flexShrink: 1 }}>
                {teamName(team)}{' '}
                <ThemedText type="small" themeColor="textSecondary">
                  {owner ?? 'open spot'}
                  {mine ? ' · you' : ''}
                  {team.user_id && data.commissionerIds.has(team.user_id) ? ' · commish' : ''}
                </ThemedText>
              </ThemedText>
              {canRename && (
                <Pressable onPress={() => setRenaming(team)} hitSlop={8} accessibilityLabel={`Rename ${teamName(team)}`}>
                  <ThemedText type="small" style={{ color: theme.accent }}>Rename</ThemedText>
                </Pressable>
              )}
            </View>
            {roster.length === 0 ? (
              <ThemedText type="small" themeColor="textSecondary">No players yet</ThemedText>
            ) : (
              roster.map((id) => (
                <PlayerName key={id} playerId={id}>{playerLine(data, id)}</PlayerName>
              ))
            )}
          </View>
        );
      })}
      {renaming && <RenameTeam data={data} team={renaming} onClose={() => setRenaming(null)} />}
    </Card>
  );
}

function CommissionerCard({ data }: { data: SeasonData }) {
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const eligible = data.pool.filter((p) => p.on_postseason_roster).length;

  async function sync() {
    setSyncing(true);
    const error = await callFunction('sync-pool', { seasonId: data.season.id });
    setSyncing(false);
    setMessage(error ?? 'Player pool updated.');
  }

  async function unassign(team: Team) {
    const { error } = await supabase.rpc('assign_team', { p_team_id: team.id, p_user_id: null });
    setMessage(error ? error.message : `${teamName(team)} is an open spot again.`);
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
      <ThemedText type="smallBold" style={{ marginTop: Spacing.two }}>Who claimed which spot</ThemedText>
      {data.teams.map((t) => (
        <View key={t.id} style={styles.assignRow}>
          <ThemedText type="small" style={{ flex: 1 }}>
            {t.slot}. {teamName(t)}: {t.user_id ? ownerName(data, t) ?? 'signed up' : '—'}
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
  teamHeader: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, justifyContent: 'space-between' },
  assignRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, minHeight: 36 },
});
