import { router, useLocalSearchParams } from 'expo-router';
import { type ReactNode, useMemo, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Switch, TextInput, View } from 'react-native';
import * as DropdownMenu from 'zeego/dropdown-menu';

import { type DraftConfig, type Turn, nextTurn } from '@core/draft.ts';

import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { Columns } from '@/components/columns';
import { type PlayerRow, PlayerTable } from '@/components/player-table';
import { Screen } from '@/components/screen';
import { Sheet } from '@/components/sheet';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useLayout } from '@/hooks/use-layout';
import { useTheme } from '@/hooks/use-theme';
import { formatLockTime, mlbTeamAbbr, playerLine, playerName } from '@/lib/format';
import { type Draft, type DraftActionRow, type SeasonData, coreActions, currentRosters, useSeason } from '@/lib/season';
import { ownerName, teamLabel, teamName } from '@/lib/teams';
import { callFunction } from '@/lib/supabase';

type Tab = 'players' | 'board' | 'rosters';

export default function DraftRoomScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data, loading, refetch, requestedYear } = useSeason();
  const draft = data?.drafts.find((d) => d.id === id);
  // Back to the season being viewed, keeping the year in the URL.
  const goHome = () => router.replace(requestedYear ? { pathname: '/', params: { year: requestedYear } } : '/');

  if (loading) return <Screen><ThemedText themeColor="textSecondary">Loading…</ThemedText></Screen>;
  if (!data || !draft) {
    return (
      <Screen>
        <ThemedText>Draft not found.</ThemedText>
        <Button label="Home" variant="secondary" onPress={goHome} />
      </Screen>
    );
  }
  return <DraftRoom data={data} draft={draft} refetch={refetch} />;
}

function DraftRoom({ data, draft, refetch }: { data: SeasonData; draft: Draft; refetch: () => void }) {
  const wide = useLayout() === 'wide';
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

  const status = clockStatus(data, draft, turn, myTurn, actions.length);
  const errorText = error && <ThemedText themeColor="danger">{error}</ThemedText>;
  const commissioner = useCommissionerActions(data, draft, turn, run);
  const yieldButton = myTurn && draft.kind === 'redraft' && (
    <Button label="I'm done: yield my remaining picks" variant="secondary" onPress={() => run({ action: 'yield' })} />
  );
  const autodraft = myTeam && draft.status !== 'complete' && (
    <View style={styles.switchRow}>
      <ThemedText type="small" style={{ flex: 1 }}>Autodraft for me</ThemedText>
      <AutodraftSwitch
        value={myTeam.autodraft}
        onChange={(v) => run({ action: 'set-autodraft', teamId: myTeam.id, autodraft: v })}
      />
    </View>
  );
  const tabs = (
    <>
      <Segmented value={tab} onChange={setTab} />
      {tab === 'players' && <PlayersList data={data} canAct={canAct} onSelect={setSelected} />}
      {tab === 'board' && <Board data={data} draft={draft} config={config} />}
      {tab === 'rosters' && <Rosters data={data} draft={draft} />}
    </>
  );

  return (
    <Screen
      width="wide"
      header={
        wide ? (
          <View style={styles.topBar}>
            <ThemedText type="smallBold">Draft {draft.number}</ThemedText>
          </View>
        ) : (
          <ClockBar
            status={status}
            myTurn={myTurn}
            draftNumber={draft.number}
            menu={<DraftMenu data={data} draft={draft} run={run} commissioner={commissioner} />}
          />
        )
      }>
      {wide ? (
        // Desktop: the draft itself in the main column; your team and the controls alongside.
        <Columns
          main={
            <>
              <OnTheClock status={status} myTurn={myTurn} />
              {errorText}
              {yieldButton}
              {tabs}
            </>
          }
          side={
            <>
              {myTeam && <MyRoster data={data} teamId={myTeam.id} />}
              <RecentPicks data={data} draft={draft} config={config} />
              {autodraft && <Card>{autodraft}</Card>}
              {commissioner && <CommissionerCard data={data} draft={draft} run={run} actions={commissioner} />}
            </>
          }
        />
      ) : (
        // Phone: the clock bar is pinned above; autodraft and commissioner tools are in its ⋯ menu.
        <>
          {errorText}
          {commissioner?.canStart && (
            <Button label="Start the draft (randomizes the order)" onPress={() => commissioner.confirm('start')} />
          )}
          {yieldButton}
          {tabs}
        </>
      )}
      {commissioner?.confirmSheet}

      <PickSheet
        data={data}
        draft={draft}
        playerId={selected}
        onBehalfOf={turn && !myTurn ? teamLabel(data, teamsById.get(turn.teamId)) : undefined}
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

interface ClockStatus {
  headline: string;
  detail: string | null;
  last: string | null;
}

/** What the clock card (desktop) and the clock bar (phone) say. */
function clockStatus(data: SeasonData, draft: Draft, turn: Turn | null, myTurn: boolean, actionCount: number): ClockStatus {
  const team = turn ? data.teams.find((t) => t.id === turn.teamId) : undefined;
  const lastAction = data.actions.filter((a) => a.draft_id === draft.id).at(-1);
  const lastTeam = lastAction && data.teams.find((t) => t.id === lastAction.fantasy_team_id);
  const last =
    lastAction && lastTeam
      ? `${teamName(lastTeam)} ${
          lastAction.type === 'yield'
            ? 'yielded'
            : `took ${playerLine(data, lastAction.add_player_id!)}${lastAction.drop_player_id ? `, dropped ${playerName(data, lastAction.drop_player_id)}` : ''}`
        }${lastAction.is_auto ? ' (auto)' : ''}`
      : null;

  if (draft.status === 'scheduled') {
    return {
      headline: 'Waiting for the commissioner to start the draft',
      detail: draft.locks_at ? `Picks lock ${formatLockTime(draft.locks_at)}` : null,
      last,
    };
  }
  if (draft.status === 'complete' || !turn) return { headline: 'Draft complete', detail: null, last };
  return {
    headline: myTurn ? "You're on the clock!" : `${teamLabel(data, team)} is on the clock`,
    detail: `Round ${turn.round} · Pick ${(turn.slot % draft.pick_order.length) + 1} · #${actionCount + 1} overall`,
    last,
  };
}

/** Desktop: the big clock card at the top of the main column. */
function OnTheClock({ status, myTurn }: { status: ClockStatus; myTurn: boolean }) {
  const theme = useTheme();
  return (
    <ThemedView
      type={myTurn ? undefined : 'backgroundElement'}
      style={[styles.clock, myTurn && { backgroundColor: theme.highlight, borderColor: theme.danger, borderWidth: 2 }]}>
      <ThemedText type="subtitle" style={styles.clockHeadline}>{status.headline}</ThemedText>
      {status.detail && <ThemedText type="small" themeColor="textSecondary">{status.detail}</ThemedText>}
      {status.last && <ThemedText type="small">Last: {status.last}</ThemedText>}
    </ThemedView>
  );
}

/** Phone: a slim clock bar pinned under the app header, with the draft options menu. */
function ClockBar({
  status,
  myTurn,
  draftNumber,
  menu,
}: {
  status: ClockStatus;
  myTurn: boolean;
  draftNumber: number;
  menu: ReactNode;
}) {
  const theme = useTheme();
  const detail = [status.detail, status.last && `Last: ${status.last}`].filter(Boolean).join(' · ');
  return (
    <ThemedView
      type={myTurn ? undefined : 'backgroundElement'}
      style={[styles.clockBar, myTurn && { backgroundColor: theme.highlight, borderColor: theme.danger }]}>
      <View style={{ flex: 1 }}>
        <ThemedText type="smallBold" numberOfLines={1}>
          Draft {draftNumber} · {status.headline}
        </ThemedText>
        {detail !== '' && (
          <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>{detail}</ThemedText>
        )}
      </View>
      {menu}
    </ThemedView>
  );
}

/**
 * Flips as soon as it's tapped and stays disabled until the server confirms the save, so taps
 * can't pile up. It goes back if the save fails. After the save, it keeps showing the saved
 * value until the season reload catches up.
 */
function AutodraftSwitch({ value, onChange }: { value: boolean; onChange: (v: boolean) => Promise<string | null> }) {
  const [local, setLocal] = useState<{ value: boolean; saving: boolean } | null>(null);
  if (local && !local.saving && value === local.value) setLocal(null);
  return (
    <Switch
      value={local ? local.value : value}
      disabled={local?.saving}
      onValueChange={async (v) => {
        setLocal({ value: v, saving: true });
        const error = await onChange(v);
        setLocal(error ? null : { value: v, saving: false });
      }}
    />
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
          {draft.pick_order.map((teamId) => {
            const team = data.teams.find((t) => t.id === teamId);
            const owner = team && ownerName(data, team);
            return (
              <View key={teamId} style={styles.boardCell}>
                <ThemedText type="smallBold" numberOfLines={1}>{team ? teamName(team) : '—'}</ThemedText>
                {owner && <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>{owner}</ThemedText>}
              </View>
            );
          })}
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
                  <ThemedText type="small" themeColor="textSecondary">{pickLabel(slot, n)}</ThemedText>
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

/** Sidebar: your current players. */
function MyRoster({ data, teamId }: { data: SeasonData; teamId: string }) {
  const roster = currentRosters(data).get(teamId) ?? [];
  return (
    <Card title={`My roster · ${roster.length}/4`}>
      {roster.length === 0 && <ThemedText type="small" themeColor="textSecondary">No players yet</ThemedText>}
      {roster.map((id) => (
        <View key={id} style={styles.sideRow}>
          <ThemedText type="small" numberOfLines={1} style={{ flex: 1 }}>{playerLine(data, id)}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">{data.poolByPlayer.get(id)?.regular_season_tb ?? ''}</ThemedText>
        </View>
      ))}
    </Card>
  );
}

/** "2.6": round 2, sixth pick of the round, for a snake slot (0-based). */
function pickLabel(slot: number, teams: number): string {
  return `${Math.floor(slot / teams) + 1}.${(slot % teams) + 1}`;
}

/** Sidebar: every pick in this draft, newest first, in a panel that scrolls back to the first pick. */
function RecentPicks({ data, draft, config }: { data: SeasonData; draft: Draft; config: DraftConfig }) {
  const theme = useTheme();
  const actions = coreActions(data.actions, draft.id);
  const rows = data.actions.filter((a) => a.draft_id === draft.id);
  // Replay the draft to find each action's snake slot (redraft yields skip slots).
  const slots = actions.map((_, i) => nextTurn(config, actions.slice(0, i))?.slot ?? i);
  const picks = rows.map((a, i) => ({ a, slot: slots[i] })).reverse();
  return (
    <ThemedView type="backgroundElement" style={styles.picksPanel}>
      <ThemedText type="smallBold" themeColor="textSecondary" style={styles.picksTitle}>
        Picks{picks.length ? ` · ${picks.length}` : ''}
      </ThemedText>
      {picks.length === 0 ? (
        <ThemedText type="small" themeColor="textSecondary" style={styles.picksEmpty}>No picks yet</ThemedText>
      ) : (
        <ScrollView style={[styles.picksList, { borderTopColor: theme.border }]} nestedScrollEnabled>
          {picks.map(({ a, slot }) => (
            <PickCard
              key={a.action_number}
              data={data}
              action={a}
              label={pickLabel(slot, draft.pick_order.length)}
            />
          ))}
        </ScrollView>
      )}
    </ThemedView>
  );
}

/** One pick: the player up top, then who took them. Tapping will open the player's stats. */
function PickCard({
  data,
  action,
  label,
}: {
  data: SeasonData;
  action: DraftActionRow;
  label: string;
}) {
  const theme = useTheme();
  const [hovered, setHovered] = useState(false);
  const team = data.teams.find((t) => t.id === action.fantasy_team_id);
  const owner = team && ownerName(data, team);
  const playerId = action.type === 'pick' ? action.add_player_id! : null;
  const player = playerId !== null ? data.players.get(playerId) : undefined;
  const tb = playerId !== null ? data.poolByPlayer.get(playerId)?.regular_season_tb : undefined;
  const details = [player?.primary_position, playerId !== null && mlbTeamAbbr(data, playerId), tb !== undefined && `${tb} TB`]
    .filter(Boolean)
    .join(' · ');

  return (
    // A Pressable so a tap can open the player's stats later; for now it only shows hover.
    <Pressable
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      style={[styles.pickCard, { backgroundColor: hovered ? theme.tintHover : theme.tint, boxShadow: theme.bevel }]}>
      <View style={styles.pickCardTop}>
        <ThemedText type="smallBold" numberOfLines={1} style={styles.pickPlayer}>
          {playerId !== null ? playerName(data, playerId) : 'Yielded'}
        </ThemedText>
        <View style={[styles.pickBadge, { backgroundColor: theme.tintStrong }]}>
          <ThemedText type="smallBold" themeColor="textSecondary" style={styles.pickBadgeText}>
            {label}
            {action.is_auto ? ' · auto' : ''}
          </ThemedText>
        </View>
      </View>
      {details !== '' && <ThemedText type="small" themeColor="textSecondary" style={styles.pickLine}>{details}</ThemedText>}
      <ThemedText type="small" numberOfLines={1} style={styles.pickTeam}>
        {team ? teamName(team) : '—'}
        {owner && <ThemedText type="small" themeColor="textSecondary" style={styles.pickOwner}> · {owner}</ThemedText>}
      </ThemedText>
    </Pressable>
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
          <Card key={teamId} title={`${teamLabel(data, team)}${team?.id === data.myTeam?.id ? ' · you' : ''} · ${roster.length}/4`}>
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

interface CommissionerActions {
  canStart: boolean;
  /** Manager on the clock, when autopick is available. */
  autopickFor: string | null;
  canUndo: boolean;
  busy: boolean;
  confirm: (action: 'start' | 'undo') => void;
  autopick: () => void;
  /** Confirmation for start and undo; render it once. */
  confirmSheet: ReactNode;
}

/** Commissioner actions for this draft, or null for everyone else. Shared by the card and the phone menu. */
function useCommissionerActions(
  data: SeasonData,
  draft: Draft,
  turn: Turn | null,
  run: (body: object) => Promise<string | null>,
): CommissionerActions | null {
  const [confirming, setConfirming] = useState<'start' | 'undo' | null>(null);
  const [busy, setBusy] = useState(false);
  if (!data.isCommissioner) return null;
  const onClock = draft.status === 'live' && turn ? data.teams.find((t) => t.id === turn.teamId) : undefined;

  async function act(body: object) {
    setBusy(true);
    await run(body);
    setBusy(false);
    setConfirming(null);
  }

  return {
    canStart: draft.status === 'scheduled',
    autopickFor: onClock ? teamName(onClock) : null,
    canUndo: data.actions.some((a) => a.draft_id === draft.id),
    busy,
    confirm: setConfirming,
    autopick: () => act({ action: 'autopick' }),
    confirmSheet: (
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
    ),
  };
}

/** Every manager's autodraft switch (commissioner). */
function AutodraftSettings({ data, run }: { data: SeasonData; run: (body: object) => Promise<string | null> }) {
  return (
    <>
      {data.teams.map((t) => (
        <View key={t.id} style={styles.switchRow}>
          <ThemedText type="small" style={{ flex: 1 }}>{teamLabel(data, t)}</ThemedText>
          <AutodraftSwitch
            value={t.autodraft}
            onChange={(v) => run({ action: 'set-autodraft', teamId: t.id, autodraft: v })}
          />
        </View>
      ))}
    </>
  );
}

/** Desktop sidebar: commissioner tools. */
function CommissionerCard({
  data,
  draft,
  run,
  actions,
}: {
  data: SeasonData;
  draft: Draft;
  run: (body: object) => Promise<string | null>;
  actions: CommissionerActions;
}) {
  const [showAutodraft, setShowAutodraft] = useState(false);
  return (
    <Card title="Commissioner">
      {actions.canStart && (
        <Button label="Start the draft (randomizes the order)" onPress={() => actions.confirm('start')} />
      )}
      <View style={styles.buttonRow}>
        {actions.autopickFor && (
          <View style={{ flex: 1 }}>
            <Button label="Autopick" variant="secondary" compact loading={actions.busy} onPress={actions.autopick} />
          </View>
        )}
        {actions.canUndo && (
          <View style={{ flex: 1 }}>
            <Button label="Undo last pick" variant="secondary" compact onPress={() => actions.confirm('undo')} />
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
      {draft.status !== 'complete' && showAutodraft && <AutodraftSettings data={data} run={run} />}
    </Card>
  );
}

/** Phone: the ⋯ menu in the clock bar, with your autodraft switch and the commissioner tools. */
function DraftMenu({
  data,
  draft,
  run,
  commissioner,
}: {
  data: SeasonData;
  draft: Draft;
  run: (body: object) => Promise<string | null>;
  commissioner: CommissionerActions | null;
}) {
  const theme = useTheme();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const myTeam = data.myTeam;
  const open = draft.status !== 'complete';
  const showAutodraft = !!myTeam && open;
  if (!showAutodraft && !commissioner) return null;

  return (
    <>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger className="menu-trigger menu-trigger-chip" aria-label="Draft options">
          <View style={[styles.moreButton, { backgroundColor: theme.backgroundSelected }]}>
            <ThemedText type="smallBold">⋯</ThemedText>
          </View>
        </DropdownMenu.Trigger>
        <DropdownMenu.Content className="menu-content" align="end" sideOffset={6} collisionPadding={8}>
          {showAutodraft && (
            <DropdownMenu.CheckboxItem
              key="autodraft"
              className="menu-item"
              value={myTeam.autodraft ? 'on' : 'off'}
              onValueChange={(next) => run({ action: 'set-autodraft', teamId: myTeam.id, autodraft: next === 'on' })}>
              <DropdownMenu.ItemTitle>Autodraft for me</DropdownMenu.ItemTitle>
              <DropdownMenu.ItemIndicator className="menu-check">✓</DropdownMenu.ItemIndicator>
            </DropdownMenu.CheckboxItem>
          )}
          {showAutodraft && commissioner && <DropdownMenu.Separator className="menu-separator" />}
          {commissioner && (
            <DropdownMenu.Group key="commissioner">
              <DropdownMenu.Label className="menu-label menu-label-heading">Commissioner</DropdownMenu.Label>
              {commissioner.canStart && (
                <DropdownMenu.Item key="start" className="menu-item" onSelect={() => commissioner.confirm('start')}>
                  <DropdownMenu.ItemTitle>Start the draft…</DropdownMenu.ItemTitle>
                </DropdownMenu.Item>
              )}
              {commissioner.autopickFor && (
                <DropdownMenu.Item key="autopick" className="menu-item" onSelect={commissioner.autopick}>
                  <DropdownMenu.ItemTitle>{`Autopick for ${commissioner.autopickFor}`}</DropdownMenu.ItemTitle>
                </DropdownMenu.Item>
              )}
              {commissioner.canUndo && (
                <DropdownMenu.Item
                  key="undo"
                  className="menu-item menu-item-danger"
                  destructive={Platform.OS !== 'web' || undefined}
                  onSelect={() => commissioner.confirm('undo')}>
                  <DropdownMenu.ItemTitle>Undo last pick…</DropdownMenu.ItemTitle>
                </DropdownMenu.Item>
              )}
              {open && (
                <DropdownMenu.Item key="settings" className="menu-item" onSelect={() => setSettingsOpen(true)}>
                  <DropdownMenu.ItemTitle>Autodraft settings…</DropdownMenu.ItemTitle>
                </DropdownMenu.Item>
              )}
            </DropdownMenu.Group>
          )}
        </DropdownMenu.Content>
      </DropdownMenu.Root>
      <Sheet visible={settingsOpen} title="Autodraft settings" onClose={() => setSettingsOpen(false)}>
        <AutodraftSettings data={data} run={run} />
        <Button label="Done" variant="secondary" onPress={() => setSettingsOpen(false)} />
      </Sheet>
    </>
  );
}

const styles = StyleSheet.create({
  topBar: { flexDirection: 'row', alignItems: 'center', minHeight: 32 },
  clock: { padding: Spacing.three, borderRadius: Spacing.three, gap: Spacing.one },
  clockHeadline: { fontSize: 24, lineHeight: 30 },
  clockBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    borderRadius: Spacing.three,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  moreButton: { width: 36, height: 32, borderRadius: Spacing.two, alignItems: 'center', justifyContent: 'center' },
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
  sideRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  picksPanel: { borderRadius: Spacing.three, overflow: 'hidden' },
  picksTitle: { textTransform: 'uppercase', letterSpacing: 0.5, padding: Spacing.three, paddingBottom: Spacing.two },
  picksEmpty: { paddingHorizontal: Spacing.three, paddingBottom: Spacing.three },
  // About 6 picks tall; scroll for the rest.
  picksList: { maxHeight: 340, borderTopWidth: StyleSheet.hairlineWidth },
  pickCard: { paddingVertical: Spacing.two, paddingHorizontal: Spacing.three },
  pickCardTop: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  pickPlayer: { flex: 1, fontSize: 15, lineHeight: 19 },
  pickLine: { fontSize: 13, lineHeight: 17 },
  pickBadge: { paddingHorizontal: Spacing.one + 2 },
  pickBadgeText: { fontSize: 11, lineHeight: 16, fontVariant: ['tabular-nums'] },
  pickTeam: { fontSize: 13, lineHeight: 17 },
  pickOwner: { fontSize: 13, lineHeight: 17, fontStyle: 'italic' },
});
