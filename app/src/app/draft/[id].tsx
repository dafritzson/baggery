import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, TextInput, View } from 'react-native';

import { type DraftConfig, type Turn, nextTurn } from '@core/draft.ts';

import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { type PlayerRow, PlayerTable } from '@/components/player-table';
import { Screen } from '@/components/screen';
import { Sheet } from '@/components/sheet';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { formatLockTime, playerLine, playerName } from '@/lib/format';
import { type Draft, type SeasonData, coreActions, currentRosters, useSeason } from '@/lib/season';
import { callFunction } from '@/lib/supabase';

type Tab = 'players' | 'board' | 'rosters';

export default function DraftRoomScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data, loading, refetch } = useSeason();
  const draft = data?.drafts.find((d) => d.id === id);

  if (loading) return <Screen><ThemedText themeColor="textSecondary">Loading…</ThemedText></Screen>;
  if (!data || !draft) {
    return (
      <Screen>
        <ThemedText>Draft not found.</ThemedText>
        <Button label="Home" variant="secondary" onPress={() => router.replace('/')} />
      </Screen>
    );
  }
  return <DraftRoom data={data} draft={draft} refetch={refetch} />;
}

function DraftRoom({ data, draft, refetch }: { data: SeasonData; draft: Draft; refetch: () => void }) {
  const [tab, setTab] = useState<Tab>('players');
  const [selected, setSelected] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const config: DraftConfig = { kind: draft.kind, order: draft.pick_order, rounds: draft.rounds };
  const actions = coreActions(data.actions, draft.id);
  const turn = draft.status === 'live' ? nextTurn(config, actions) : null;
  const teamsById = new Map(data.teams.map((t) => [t.id, t]));
  const myTeam = data.myTeam;
  const myTurn = !!turn && turn.teamId === myTeam?.id;
  const canAct = !!turn && (myTurn || data.isCommissioner);

  async function run(body: object) {
    setError(null);
    const message = await callFunction('draft', { draftId: draft.id, ...body });
    if (message) setError(message);
    refetch();
    return message;
  }

  return (
    <Screen
      header={
        <View style={styles.topBar}>
          <Pressable onPress={() => router.replace('/')} hitSlop={12}>
            <ThemedText type="small" themeColor="textSecondary">‹ Home</ThemedText>
          </Pressable>
          <ThemedText type="smallBold">Draft {draft.number}</ThemedText>
        </View>
      }>
      <OnTheClock data={data} draft={draft} turn={turn} myTurn={myTurn} actionCount={actions.length} />
      {error && <ThemedText themeColor="danger">{error}</ThemedText>}
      {data.isCommissioner && <CommissionerControls data={data} draft={draft} turn={turn} run={run} />}

      {myTurn && draft.kind === 'redraft' && (
        <Button label="I'm done: yield my remaining picks" variant="secondary" onPress={() => run({ action: 'yield' })} />
      )}
      {myTeam && draft.status !== 'complete' && (
        <View style={styles.switchRow}>
          <ThemedText type="small" style={{ flex: 1 }}>Autodraft for me (most regular-season TB)</ThemedText>
          <Switch
            value={myTeam.autodraft}
            onValueChange={(v) => {
              run({ action: 'set-autodraft', teamId: myTeam.id, autodraft: v });
            }}
          />
        </View>
      )}

      <Segmented value={tab} onChange={setTab} />
      {tab === 'players' && (
        <PlayersList data={data} canAct={canAct} onSelect={setSelected} />
      )}
      {tab === 'board' && <Board data={data} draft={draft} config={config} />}
      {tab === 'rosters' && <Rosters data={data} draft={draft} />}

      <PickSheet
        data={data}
        draft={draft}
        playerId={selected}
        onBehalfOf={turn && !myTurn ? teamsById.get(turn.teamId)?.manager_name : undefined}
        dropOptions={turn ? currentRosters(data).get(turn.teamId) ?? [] : []}
        onClose={() => setSelected(null)}
        onConfirm={async (dropPlayerId) => {
          const failed = await run({ action: 'pick', addPlayerId: selected, dropPlayerId });
          if (!failed) setSelected(null);
          return failed;
        }}
      />
    </Screen>
  );
}

function OnTheClock({
  data,
  draft,
  turn,
  myTurn,
  actionCount,
}: {
  data: SeasonData;
  draft: Draft;
  turn: Turn | null;
  myTurn: boolean;
  actionCount: number;
}) {
  const theme = useTheme();
  const team = turn ? data.teams.find((t) => t.id === turn.teamId) : undefined;
  const last = data.actions.filter((a) => a.draft_id === draft.id).at(-1);
  const lastTeam = last && data.teams.find((t) => t.id === last.fantasy_team_id);

  let headline: string;
  let detail: string | null = null;
  if (draft.status === 'scheduled') {
    headline = 'Waiting for the commissioner to start the draft';
    detail = draft.locks_at ? `Picks lock ${formatLockTime(draft.locks_at)}` : null;
  } else if (draft.status === 'complete' || !turn) {
    headline = 'Draft complete';
  } else {
    headline = myTurn ? "You're on the clock!" : `${team?.manager_name} is on the clock`;
    detail = `Round ${turn.round} · Pick ${(turn.slot % draft.pick_order.length) + 1} · #${actionCount + 1} overall`;
  }

  return (
    <ThemedView
      type={myTurn ? undefined : 'backgroundElement'}
      style={[styles.clock, myTurn && { backgroundColor: theme.highlight, borderColor: theme.danger, borderWidth: 2 }]}>
      <ThemedText type="subtitle" style={styles.clockHeadline}>{headline}</ThemedText>
      {detail && <ThemedText type="small" themeColor="textSecondary">{detail}</ThemedText>}
      {last && lastTeam && (
        <ThemedText type="small">
          Last: {lastTeam.manager_name}{' '}
          {last.type === 'yield'
            ? 'yielded'
            : `took ${playerLine(data, last.add_player_id!)}${last.drop_player_id ? `, dropped ${playerName(data, last.drop_player_id)}` : ''}`}
          {last.is_auto ? ' (auto)' : ''}
        </ThemedText>
      )}
    </ThemedView>
  );
}

function Segmented({ value, onChange }: { value: Tab; onChange: (t: Tab) => void }) {
  const theme = useTheme();
  const tabs: [Tab, string][] = [
    ['players', 'Players'],
    ['board', 'Board'],
    ['rosters', 'Rosters'],
  ];
  return (
    <ThemedView type="backgroundElement" style={styles.segmented}>
      {tabs.map(([key, label]) => (
        <Pressable
          key={key}
          onPress={() => onChange(key)}
          style={[styles.segment, value === key && { backgroundColor: theme.background }]}>
          <ThemedText type="smallBold" themeColor={value === key ? 'text' : 'textSecondary'}>{label}</ThemedText>
        </Pressable>
      ))}
    </ThemedView>
  );
}

function PlayersList({ data, canAct, onSelect }: { data: SeasonData; canAct: boolean; onSelect: (id: number) => void }) {
  const theme = useTheme();
  const [query, setQuery] = useState('');
  const [teamFilter, setTeamFilter] = useState<number | null>(null);

  const taken = useMemo(() => new Set(data.spells.map((s) => s.mlb_player_id)), [data.spells]);
  const available = useMemo(
    () =>
      data.pool
        .filter((p) => p.on_postseason_roster && !taken.has(p.mlb_player_id) && !data.mlbTeams.get(p.mlb_team_id)?.eliminated)
        .map((p): PlayerRow & { mlbTeamId: number } => {
          const team = data.mlbTeams.get(p.mlb_team_id);
          return {
            id: p.mlb_player_id,
            mlbTeamId: p.mlb_team_id,
            name: data.players.get(p.mlb_player_id)?.full_name ?? `Player ${p.mlb_player_id}`,
            team: team?.abbreviation ?? '',
            wins: team?.wins ?? null,
            bye: team?.has_bye ?? false,
            pa: p.plate_appearances,
            slg: p.slg,
            opsPlus: p.ops_plus,
            tb: p.regular_season_tb,
          };
        }),
    [data.pool, data.mlbTeams, data.players, taken],
  );
  const q = query.trim().toLowerCase();
  const shown = available.filter(
    (p) => (teamFilter === null || p.mlbTeamId === teamFilter) && (!q || p.name.toLowerCase().includes(q)),
  );
  const mlbTeams = [...data.mlbTeams.values()].filter((t) => !t.eliminated).sort((a, b) => a.abbreviation.localeCompare(b.abbreviation));

  return (
    <View style={{ gap: Spacing.two }}>
      <TextInput
        value={query}
        onChangeText={setQuery}
        placeholder="Search players"
        placeholderTextColor={theme.textSecondary}
        autoCorrect={false}
        style={[styles.search, { color: theme.text, backgroundColor: theme.backgroundElement, borderColor: theme.border }]}
      />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
        <Chip label="All" active={teamFilter === null} onPress={() => setTeamFilter(null)} />
        {mlbTeams.map((t) => (
          <Chip key={t.id} label={t.abbreviation} active={teamFilter === t.id} onPress={() => setTeamFilter(teamFilter === t.id ? null : t.id)} />
        ))}
      </ScrollView>
      {data.pool.length === 0 && (
        <ThemedText themeColor="textSecondary">The player pool is empty. The commissioner needs to sync it from MLB.</ThemedText>
      )}
      {shown.length > 0 && <PlayerTable rows={shown} canSelect={canAct} onSelect={onSelect} />}
      {shown.length === 0 && data.pool.length > 0 && (
        <ThemedText type="small" themeColor="textSecondary">No matching players.</ThemedText>
      )}
    </View>
  );
}

function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={[styles.chip, { backgroundColor: active ? theme.accent : theme.backgroundElement }]}>
      <ThemedText type="smallBold" style={{ color: active ? theme.accentText : theme.text }}>{label}</ThemedText>
    </Pressable>
  );
}

function Board({ data, draft, config }: { data: SeasonData; draft: Draft; config: DraftConfig }) {
  const theme = useTheme();
  const actions = coreActions(data.actions, draft.id);
  // Replay the draft to find which snake slot each action filled.
  const bySlot = new Map<number, (typeof actions)[number]>();
  actions.forEach((a, i) => {
    const t = nextTurn(config, actions.slice(0, i));
    if (t) bySlot.set(t.slot, a);
  });
  const current = draft.status === 'live' ? nextTurn(config, actions) : null;
  const n = draft.pick_order.length;

  if (n === 0) return <ThemedText themeColor="textSecondary">The order is set when the draft starts.</ThemedText>;

  return (
    <ScrollView horizontal>
      <View>
        <View style={styles.boardRow}>
          {draft.pick_order.map((teamId) => (
            <View key={teamId} style={styles.boardCell}>
              <ThemedText type="smallBold" numberOfLines={1}>
                {data.teams.find((t) => t.id === teamId)?.manager_name}
              </ThemedText>
            </View>
          ))}
        </View>
        {Array.from({ length: draft.rounds }, (_, round) => (
          <View key={round} style={styles.boardRow}>
            {draft.pick_order.map((teamId, col) => {
              // Snake: odd rounds run right to left.
              const slot = round * n + (round % 2 === 0 ? col : n - 1 - col);
              const action = bySlot.get(slot);
              const isCurrent = current?.slot === slot;
              return (
                <ThemedView
                  key={teamId}
                  type="backgroundElement"
                  style={[styles.boardCell, styles.boardPick, isCurrent && { borderColor: theme.danger, borderWidth: 2 }]}>
                  <ThemedText type="small" themeColor="textSecondary">{round + 1}.{col + 1}</ThemedText>
                  <ThemedText type="small" numberOfLines={2}>
                    {action ? (action.type === 'yield' ? 'Yielded' : playerName(data, action.addPlayerId)) : isCurrent ? 'On the clock' : ''}
                  </ThemedText>
                </ThemedView>
              );
            })}
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

function Rosters({ data, draft }: { data: SeasonData; draft: Draft }) {
  const rosters = currentRosters(data);
  const order = draft.pick_order.length ? draft.pick_order : data.teams.map((t) => t.id);
  return (
    <View style={{ gap: Spacing.two }}>
      {order.map((teamId) => {
        const team = data.teams.find((t) => t.id === teamId);
        const roster = rosters.get(teamId) ?? [];
        return (
          <Card key={teamId} title={`${team?.manager_name}${team?.id === data.myTeam?.id ? ' (you)' : ''} · ${roster.length}/4`}>
            {roster.length === 0 && <ThemedText type="small" themeColor="textSecondary">No players yet</ThemedText>}
            {roster.map((id) => (
              <ThemedText key={id} type="small">{playerLine(data, id)}</ThemedText>
            ))}
          </Card>
        );
      })}
    </View>
  );
}

function PickSheet({
  data,
  draft,
  playerId,
  onBehalfOf,
  dropOptions,
  onClose,
  onConfirm,
}: {
  data: SeasonData;
  draft: Draft;
  playerId: number | null;
  onBehalfOf?: string;
  dropOptions: number[];
  onClose: () => void;
  onConfirm: (dropPlayerId?: number) => Promise<string | null>;
}) {
  const theme = useTheme();
  const [drop, setDrop] = useState<number | undefined>();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const needsDrop = draft.kind === 'redraft';

  async function confirm() {
    setSaving(true);
    setError(await onConfirm(drop));
    setSaving(false);
    setDrop(undefined);
  }

  function close() {
    setError(null);
    setDrop(undefined);
    onClose();
  }

  return (
    <Sheet visible={playerId !== null} title={playerId ? `Draft ${playerName(data, playerId)}?` : ''} onClose={close}>
      {playerId && <ThemedText themeColor="textSecondary">{playerLine(data, playerId)}</ThemedText>}
      {onBehalfOf && <ThemedText type="smallBold">Picking for {onBehalfOf} (commissioner)</ThemedText>}
      {needsDrop && (
        <View style={{ gap: Spacing.one }}>
          <ThemedText type="smallBold">Drop which player?</ThemedText>
          {dropOptions.map((id) => (
            <Pressable
              key={id}
              onPress={() => setDrop(id)}
              style={[styles.dropRow, { borderColor: drop === id ? theme.accent : theme.border }]}>
              <ThemedText type="small">{playerLine(data, id)}</ThemedText>
            </Pressable>
          ))}
        </View>
      )}
      {error && <ThemedText themeColor="danger">{error}</ThemedText>}
      <Button label="Draft" onPress={confirm} loading={saving} disabled={needsDrop && drop === undefined} />
      <Button label="Cancel" variant="secondary" onPress={close} />
    </Sheet>
  );
}

function CommissionerControls({
  data,
  draft,
  turn,
  run,
}: {
  data: SeasonData;
  draft: Draft;
  turn: Turn | null;
  run: (body: object) => Promise<string | null>;
}) {
  const [confirming, setConfirming] = useState<'start' | 'undo' | null>(null);
  const [busy, setBusy] = useState(false);
  const [showAutodraft, setShowAutodraft] = useState(false);
  const onClock = turn && data.teams.find((t) => t.id === turn.teamId);
  const hasActions = data.actions.some((a) => a.draft_id === draft.id);

  async function act(body: object) {
    setBusy(true);
    await run(body);
    setBusy(false);
    setConfirming(null);
  }

  return (
    <Card title="Commissioner">
      {draft.status === 'scheduled' && (
        <Button label="Start the draft (randomizes the order)" onPress={() => setConfirming('start')} />
      )}
      <View style={styles.buttonRow}>
        {draft.status === 'live' && onClock && (
          <View style={{ flex: 1 }}>
            <Button
              label={`Autopick for ${onClock.manager_name}`}
              variant="secondary"
              compact
              loading={busy}
              onPress={() => act({ action: 'autopick' })}
            />
          </View>
        )}
        {hasActions && (
          <View style={{ flex: 1 }}>
            <Button label="Undo last pick" variant="secondary" compact onPress={() => setConfirming('undo')} />
          </View>
        )}
      </View>
      {draft.status !== 'complete' && (
        <Pressable onPress={() => setShowAutodraft(!showAutodraft)} hitSlop={8}>
          <ThemedText type="small" themeColor="textSecondary">
            {showAutodraft ? '▾' : '▸'} Autodraft settings ({data.teams.filter((t) => t.autodraft).length} on)
          </ThemedText>
        </Pressable>
      )}
      {draft.status !== 'complete' && showAutodraft && (
        <>
          {data.teams.map((t) => (
            <View key={t.id} style={styles.switchRow}>
              <ThemedText type="small" style={{ flex: 1 }}>{t.manager_name}</ThemedText>
              <Switch
                value={t.autodraft}
                onValueChange={(v) => {
                  run({ action: 'set-autodraft', teamId: t.id, autodraft: v });
                }}
              />
            </View>
          ))}
        </>
      )}
      <Sheet
        visible={confirming !== null}
        title={confirming === 'start' ? 'Start the draft?' : 'Undo the last pick?'}
        onClose={() => setConfirming(null)}>
        <ThemedText themeColor="textSecondary">
          {confirming === 'start'
            ? 'This randomizes the pick order and puts the first manager on the clock. Make sure the player pool is synced.'
            : 'The player goes back into the pool and the previous manager is on the clock again.'}
        </ThemedText>
        <Button
          label={confirming === 'start' ? 'Start' : 'Undo'}
          variant={confirming === 'undo' ? 'danger' : 'primary'}
          loading={busy}
          onPress={() => act({ action: confirming })}
        />
        <Button label="Cancel" variant="secondary" onPress={() => setConfirming(null)} />
      </Sheet>
    </Card>
  );
}

const styles = StyleSheet.create({
  topBar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', minHeight: 32 },
  clock: { padding: Spacing.three, borderRadius: Spacing.three, gap: Spacing.one },
  clockHeadline: { fontSize: 24, lineHeight: 30 },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, minHeight: 40 },
  segmented: { flexDirection: 'row', padding: Spacing.half, borderRadius: Spacing.three },
  segment: { flex: 1, alignItems: 'center', paddingVertical: Spacing.two, borderRadius: Spacing.two + 2 },
  search: { minHeight: 44, borderRadius: Spacing.two, borderWidth: 1, paddingHorizontal: Spacing.three, fontSize: 16 },
  chips: { gap: Spacing.one },
  chip: { paddingHorizontal: Spacing.three, paddingVertical: Spacing.one + 2, borderRadius: Spacing.four },
  boardRow: { flexDirection: 'row', gap: Spacing.one, marginBottom: Spacing.one },
  boardCell: { width: 108, paddingHorizontal: Spacing.one },
  boardPick: { minHeight: 64, borderRadius: Spacing.two, padding: Spacing.two, borderWidth: 2, borderColor: 'transparent' },
  dropRow: { borderWidth: 2, borderRadius: Spacing.two, padding: Spacing.two },
  buttonRow: { flexDirection: 'row', gap: Spacing.two },
});
