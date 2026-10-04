import { LinearGradient } from 'expo-linear-gradient';
import { router, useLocalSearchParams } from 'expo-router';
import { type ReactNode, useMemo, useRef, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Switch, View } from 'react-native';
import * as DropdownMenu from 'zeego/dropdown-menu';

import { type DraftConfig, ROSTER_SIZE, type Turn, draftTurns, nextTurn } from '@core/draft.ts';

import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { Columns } from '@/components/columns';
import { QueueList, isOut, queueTarget, useDraftQueue } from '@/components/draft-queue';
import { injuryText } from '@/components/injury';
import { Loader } from '@/components/loader';
import { PlayerName } from '@/components/player-name';
import { PlayersList, draftableNow, useDraftBoard } from '@/components/players-list';
import { Screen } from '@/components/screen';
import { Sheet } from '@/components/sheet';
import { FoldChevron, HeadshotStack, RosterRows, TeamTile, emptySlots } from '@/components/team-roster';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Radius, Spacing } from '@/constants/theme';
import { useLayout } from '@/hooks/use-layout';
import { useTheme } from '@/hooks/use-theme';
import { formatLockTime, mlbTeamAbbr, playerLine, playerName } from '@/lib/format';
import { type DraftAction, useDraftAction, useOpenPlayer } from '@/lib/player';
import { type Draft, type DraftActionRow, type SeasonData, coreActions, currentRosters, draftConfig, useSeason } from '@/lib/season';
import { ownerLine, ownerName, teamLabel, teamName } from '@/lib/teams';
import { callFunction } from '@/lib/supabase';

type Tab = 'players' | 'queue' | 'board' | 'rosters';

export default function DraftRoomScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data, loading, refetch, requestedYear } = useSeason();
  const draft = data?.drafts.find((d) => d.id === id);
  // Back to the season's drafts, keeping the year in the URL.
  const goToDrafts = () => router.dismissTo(requestedYear ? { pathname: '/draft', params: { year: requestedYear } } : '/draft');

  if (loading) return <Screen><Loader /></Screen>;
  if (!data || !draft) {
    return (
      <Screen>
        <ThemedText>Draft not found.</ThemedText>
        <Button label="All drafts" variant="secondary" onPress={goToDrafts} />
      </Screen>
    );
  }
  return <DraftRoom data={data} draft={draft} refetch={refetch} />;
}

function DraftRoom({ data, draft, refetch }: { data: SeasonData; draft: Draft; refetch: () => void }) {
  const wide = useLayout() === 'wide';
  const [chosenTab, setTab] = useState<Tab>('players');
  const [selected, setSelected] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const config = draftConfig(data, draft);
  const actions = coreActions(data.actions, draft.id);
  const turn = draft.status === 'live' ? nextTurn(config, actions) : null;
  const teamsById = new Map(data.teams.map((t) => [t.id, t]));
  const myTeam = data.myTeam;
  // On a ghost turn, the eliminated manager making it is the one on the clock.
  const myTurn = !!turn && (turn.ghost?.by ?? turn.teamId) === myTeam?.id;
  const canAct = !!turn && (myTurn || data.isCommissioner);
  const onBehalfOf = turn && !myTurn ? teamLabel(data, teamsById.get(turn.ghost?.by ?? turn.teamId)) : undefined;
  const dropOptions = turn ? currentRosters(data).get(turn.teamId) ?? [] : [];
  // The ghost fills its empty spots without dropping anyone.
  const filling = !!turn?.ghost && dropOptions.length < ROSTER_SIZE;

  // The player popup's Draft button opens the pick sheet, for anyone the drafter can still take:
  // decided apart from the board, which lists owned players and eliminated teams too.
  const draftable = useMemo(() => draftableNow(data), [data]);
  const board = useDraftBoard(data, draft);
  // Your queue, for autodraft to pick from while you're away. It also adds and removes from the popup.
  const target = queueTarget(data, draft);
  const canQueue = !!target;
  const queue = useDraftQueue(draft.id, canQueue, draftable);
  const draftAction = useMemo(
    (): DraftAction | null =>
      canAct || canQueue
        ? {
            label: onBehalfOf ? `Draft for ${onBehalfOf}` : 'Draft',
            canDraft: (id) => canAct && draftable.has(id),
            draft: setSelected,
            queue: canQueue ? { canQueue: (id) => draftable.has(id), has: queue.has, toggle: queue.toggle } : undefined,
          }
        : null,
    [canAct, canQueue, onBehalfOf, draftable, queue],
  );
  useDraftAction(draftAction);

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
  // Hitters whose MLB team is out can't stay: no yielding (or passing a ghost turn) until they're
  // replaced, and the ghost can't skip filling a spot. Unless nobody undrafted is left.
  const nobodyLeft = draftable.size === 0;
  const mustReplace = nobodyLeft
    ? 0
    : dropOptions.filter((id) => data.mlbTeams.get(data.poolByPlayer.get(id)?.mlb_team_id ?? 0)?.eliminated).length;
  const yieldButton =
    myTurn &&
    draft.kind === 'redraft' &&
    (!filling || nobodyLeft) &&
    (mustReplace > 0 ? (
      <ThemedText type="small" themeColor="textSecondary">
        {mustReplace === 1 ? 'You have 1 empty spot' : `You have ${mustReplace} empty spots`} (team out) to fill before you can{' '}
        {turn?.ghost ? 'pass' : 'yield'}.
      </ThemedText>
    ) : (
      <Button
        label={turn?.ghost ? 'Pass this ghost turn' : "I'm done: yield my remaining picks"}
        pulse
        onPress={() => run({ action: 'yield' })}
      />
    ));
  // On your ghost turn: what kind of turn it is, and a link to how ghost turns work.
  const ghostHelp = myTurn && turn?.ghost && <GhostTurnHelp filling={filling} nobodyLeft={nobodyLeft} />;
  // The Queue tab goes away once you have no turns left to queue for.
  const tab = chosenTab === 'queue' && !target ? 'players' : chosenTab;
  const queued = queue.entries.filter((e) => draftable.has(e.playerId)).length;
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
      <Segmented value={tab} onChange={setTab} queue={target ? (queued ? `Queue · ${queued}` : 'Queue') : null} />
      {tab === 'players' && <PlayersList data={data} board={board} />}
      {tab === 'queue' && target && (
        <QueueList data={data} queue={queue} available={draftable} dropFrom={target.dropFrom} autodraft={autodraft} />
      )}
      {tab === 'board' && <Board data={data} draft={draft} config={config} />}
      {tab === 'rosters' && <Rosters data={data} draft={draft} />}
    </>
  );

  return (
    <Screen
      width="wide"
      header={
        // Phone: the clock bar is pinned above the scrolling content. Desktop has the clock card instead.
        !wide && (
          <ClockBar
            status={status}
            myTurn={myTurn}
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
              {ghostHelp}
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
          {ghostHelp}
          {yieldButton}
          {tabs}
        </>
      )}
      {commissioner?.confirmSheet}

      <PickSheet
        data={data}
        draft={draft}
        playerId={selected}
        onBehalfOf={onBehalfOf}
        forGhost={!!turn?.ghost}
        needsDrop={draft.kind === 'redraft' && !filling}
        dropOptions={dropOptions}
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
  const team = turn ? data.teams.find((t) => t.id === (turn.ghost?.by ?? turn.teamId)) : undefined;
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
  const n = draft.pick_order.length;
  const forGhost = turn.ghost ? ' for the 👻 Ghost' : '';
  return {
    headline: myTurn ? `You're on the clock${forGhost}!` : `${teamLabel(data, team)} is on the clock${forGhost}`,
    detail: `${turn.round > draft.rounds ? `Ghost pick ${pickLabel(turn.slot, n, draft.rounds)}` : `Round ${turn.round} · Pick ${(turn.slot % n) + 1}`} · #${actionCount + 1} overall`,
    last,
  };
}

/**
 * On your turn for the ghost team: whether it fills an empty spot (no drop, no pass) or is an
 * ordinary redraft pick, with a link to the ghost's rules.
 */
function GhostTurnHelp({ filling, nobodyLeft }: { filling: boolean; nobodyLeft: boolean }) {
  const theme = useTheme();
  return (
    <Card title="Your pick for the 👻 Ghost" style={{ backgroundColor: theme.tint }}>
      <ThemedText type="small">
        {filling && nobodyLeft
          ? 'Nobody undrafted is left to fill its empty spot, so pass this turn.'
          : filling
          ? "Add an undrafted hitter to fill one of its empty spots. There's no drop, and this turn can't be passed."
          : "A regular redraft pick: add an undrafted hitter to fill one of its empty spots or replace one of its hitters who's still playing. Passing skips only this turn."}
      </ThemedText>
      <Pressable
        accessibilityRole="link"
        hitSlop={8}
        onPress={() => router.navigate({ pathname: '/rules', params: { section: 'ghost' } })}>
        <ThemedText type="smallBold" style={{ color: theme.accent }}>How ghost turns work ›</ThemedText>
      </Pressable>
    </Card>
  );
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
  menu,
}: {
  status: ClockStatus;
  myTurn: boolean;
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
          {status.headline}
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
 * Shows the new value the moment it's tapped and stays tappable while it saves: a tap during a
 * save is queued, and only the last value is sent once that save lands. If a save fails, it goes
 * back to the saved value (and the draft room shows the error). After saving, it keeps showing
 * the new value until the season reload catches up.
 */
function AutodraftSwitch({ value, onChange }: { value: boolean; onChange: (v: boolean) => Promise<string | null> }) {
  const [local, setLocal] = useState<{ value: boolean; saving: boolean } | null>(null);
  const queued = useRef<boolean | null>(null);
  if (local && !local.saving && value === local.value) setLocal(null);

  async function save(v: boolean) {
    let target = v;
    for (;;) {
      if (await onChange(target)) {
        queued.current = null;
        setLocal(null);
        return;
      }
      const next = queued.current;
      queued.current = null;
      if (next === null || next === target) break;
      target = next;
    }
    setLocal({ value: target, saving: false });
  }

  return (
    <Switch
      value={local ? local.value : value}
      onValueChange={(v) => {
        const saving = local?.saving;
        setLocal({ value: v, saving: true });
        if (saving) queued.current = v;
        else save(v);
      }}
    />
  );
}

/** The draft room's tabs. `queue` is the Queue tab's label, or null without one. */
function Segmented({ value, onChange, queue }: { value: Tab; onChange: (t: Tab) => void; queue: string | null }) {
  const theme = useTheme();
  const tabs: [Tab, string][] = [
    ['players', 'Players'],
    ...(queue ? [['queue', queue] as [Tab, string]] : []),
    ['board', 'Board'],
    ['rosters', 'Rosters'],
  ];
  return (
    <ThemedView type="backgroundElement" elevation="sunken" style={styles.segmented}>
      {tabs.map(([key, label]) => (
        <Pressable
          key={key}
          onPress={() => onChange(key)}
          style={[styles.segment, value === key && { backgroundColor: theme.segment, boxShadow: theme.raised }]}>
          <ThemedText type="smallBold" themeColor={value === key ? 'text' : 'textSecondary'}>{label}</ThemedText>
        </Pressable>
      ))}
    </ThemedView>
  );
}

function Board({ data, draft, config }: { data: SeasonData; draft: Draft; config: DraftConfig }) {
  const ghostAfter = config.ghost && !draft.pick_order.includes(config.ghost.teamId) ? config.ghost : undefined;
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
            const owner = team && (team.is_ghost ? ownerLine(data, team) : ownerName(data, team));
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
                  <ThemedText type="small" themeColor="textSecondary">
                    {pickLabel(slot, n)}
                    {teamId === config.ghost?.teamId && <GhostBy data={data} config={config} slot={slot} />}
                  </ThemedText>
                  {action?.type === 'pick' ? (
                    <PlayerName playerId={action.addPlayerId} numberOfLines={2}>{playerName(data, action.addPlayerId)}</PlayerName>
                  ) : (
                    <ThemedText type="small" numberOfLines={2}>
                      {action?.type === 'yield' ? 'Yielded' : isCurrent ? 'On the clock' : ''}
                    </ThemedText>
                  )}
                </ThemedView>
              );
            })}
          </View>
        ))}
        {ghostAfter && (
          // Draft 3: the ghost's picks, by the managers out after round 1, come after the snake.
          <View style={styles.boardRow}>
            {ghostAfter.turns.map((g, i) => {
              const slot = draft.rounds * n + i;
              const action = bySlot.get(slot);
              const isCurrent = current?.slot === slot;
              return (
                <ThemedView
                  key={slot}
                  type="backgroundElement"
                  style={[styles.boardCell, styles.boardPick, isCurrent && { borderColor: theme.danger, borderWidth: 2 }]}>
                  <ThemedText type="small" themeColor="textSecondary">
                    👻 {pickLabel(slot, n, draft.rounds)}
                    <GhostBy data={data} config={config} slot={slot} />
                  </ThemedText>
                  {action?.type === 'pick' ? (
                    <PlayerName playerId={action.addPlayerId} numberOfLines={2}>{playerName(data, action.addPlayerId)}</PlayerName>
                  ) : (
                    <ThemedText type="small" numberOfLines={2}>{isCurrent ? 'On the clock' : ''}</ThemedText>
                  )}
                </ThemedView>
              );
            })}
          </View>
        )}
      </View>
    </ScrollView>
  );
}

/** " · Kyle": who makes the ghost's pick in a slot. */
function GhostBy({ data, config, slot }: { data: SeasonData; config: DraftConfig; slot: number }) {
  const by = draftTurns(config).find((t) => t.slot === slot)?.ghost?.by;
  const team = by ? data.teams.find((t) => t.id === by) : undefined;
  const name = team && (ownerName(data, team) ?? teamName(team));
  return name ? <ThemedText type="small" themeColor="textSecondary"> · {name}</ThemedText> : null;
}

/** Sidebar: your current players. */
function MyRoster({ data, teamId }: { data: SeasonData; teamId: string }) {
  const theme = useTheme();
  const [open, setOpen] = useState(true);
  const roster = currentRosters(data).get(teamId) ?? [];
  return (
    <Card>
      {/* Like a card title, but tapping it folds the roster down to a headshot stack. */}
      <Pressable
        onPress={() => setOpen(!open)}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityHint={open ? 'Hides your players' : 'Shows your players'}
        style={styles.foldHead}>
        <ThemedText type="smallBold" themeColor="textSecondary" style={styles.foldTitle}>
          My roster · {roster.length}/{ROSTER_SIZE}
        </ThemedText>
        {!open && <HeadshotStack roster={roster} surface={theme.backgroundElement} />}
        <FoldChevron open={open} />
      </Pressable>
      {open && (
        <>
          {roster.length > 0 && (
            <ThemedText themeColor="textSecondary" style={styles.statHead}>Season TB</ThemedText>
          )}
          <RosterRows
            data={data}
            roster={roster}
            empty={emptySlots(data, roster, true)}
            stat={(id) => String(data.poolByPlayer.get(id)?.regular_season_tb ?? '')}
            stacked
          />
        </>
      )}
    </Card>
  );
}

/** "2.6": round 2, sixth pick of the round, for a snake slot (0-based). "G1": the ghost's first pick after the snake (Draft 3). */
function pickLabel(slot: number, teams: number, rounds = Infinity): string {
  if (slot >= rounds * teams) return `G${slot - rounds * teams + 1}`;
  return `${Math.floor(slot / teams) + 1}.${(slot % teams) + 1}`;
}

/** Sidebar: every pick in this draft, newest first, in a panel that scrolls back to the first pick. */
function RecentPicks({ data, draft, config }: { data: SeasonData; draft: Draft; config: DraftConfig }) {
  const theme = useTheme();
  const [atEnd, setAtEnd] = useState(false);
  const [contentHeight, setContentHeight] = useState(0);
  const [viewHeight, setViewHeight] = useState(0);
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
        <View>
          <ScrollView
            style={[styles.picksList, { borderTopColor: theme.border }]}
            nestedScrollEnabled
            scrollEventThrottle={32}
            onScroll={(e) => {
              const { contentOffset, layoutMeasurement, contentSize } = e.nativeEvent;
              setAtEnd(contentOffset.y + layoutMeasurement.height >= contentSize.height - 4);
            }}
            onContentSizeChange={(_, h) => setContentHeight(h)}
            onLayout={(e) => setViewHeight(e.nativeEvent.layout.height)}>
            {picks.map(({ a, slot }) => (
              <PickCard
                key={a.action_number}
                data={data}
                action={a}
                label={pickLabel(slot, draft.pick_order.length, draft.rounds)}
              />
            ))}
          </ScrollView>
          {/* Fades the last visible card into the panel while there are older picks below. */}
          {contentHeight > viewHeight + 4 && !atEnd && (
            <LinearGradient
              colors={[`${theme.backgroundElement}00`, theme.backgroundElement]}
              style={styles.picksFade}
            />
          )}
        </View>
      )}
    </ThemedView>
  );
}

/** One pick: the player up top, then who took them. Tapping opens the player's stats. */
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
  const openPlayer = useOpenPlayer();
  const [hovered, setHovered] = useState(false);
  const team = data.teams.find((t) => t.id === action.fantasy_team_id);
  // A ghost pick shows who made it.
  const by = action.by_team_id ? data.teams.find((t) => t.id === action.by_team_id) : undefined;
  const owner = by ? ownerName(data, by) ?? teamName(by) : team && ownerName(data, team);
  const playerId = action.type === 'pick' ? action.add_player_id! : null;
  const player = playerId !== null ? data.players.get(playerId) : undefined;
  const tb = playerId !== null ? data.poolByPlayer.get(playerId)?.regular_season_tb : undefined;
  const details = [player?.primary_position, playerId !== null && mlbTeamAbbr(data, playerId), tb !== undefined && `${tb} TB`]
    .filter(Boolean)
    .join(' · ');
  // Who the pick dropped: burned if he was still playing (off the board for good), or replaced
  // when his team is out or he's off its postseason roster.
  const dropId = action.drop_player_id;
  const burned = dropId != null && !isOut(data, dropId);

  return (
    <Pressable
      disabled={playerId === null}
      onPress={() => playerId !== null && openPlayer(playerId)}
      accessibilityRole="button"
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      style={[
        styles.pickCard,
        { backgroundColor: burned ? theme.burnTint : hovered && playerId !== null ? theme.tintHover : theme.tint, boxShadow: theme.raised },
      ]}>
      {burned && (
        <View
          pointerEvents="none"
          style={[styles.burnGlow, { boxShadow: `inset 0 0 14px ${theme.burn}` }]}
          // dataSet isn't in React Native's types; react-native-web turns it into data-* attributes.
          {...({ dataSet: { burnFlicker: '' } } as object)}
        />
      )}
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
      {dropId != null &&
        (burned ? (
          <ThemedText type="smallBold" numberOfLines={1} style={[styles.pickTeam, { color: theme.burn }]}>
            🔥 Burned <ThemedText type="smallBold" style={[{ color: theme.burn }, styles.burnedName]}>{playerName(data, dropId)}</ThemedText>
          </ThemedText>
        ) : (
          <ThemedText type="small" themeColor="textSecondary" numberOfLines={1} style={styles.pickTeam}>
            Replaced {playerName(data, dropId)} ({outReason(data, dropId)})
          </ThemedText>
        ))}
    </Pressable>
  );
}

function Rosters({ data, draft }: { data: SeasonData; draft: Draft }) {
  const wide = useLayout() === 'wide';
  const rosters = currentRosters(data);
  const ghost = data.teams.find((t) => t.is_ghost);
  const order = draft.pick_order.length ? draft.pick_order : data.teams.filter((t) => !t.is_ghost).map((t) => t.id);
  // Draft 3: the ghost picks after the snake without being in it.
  if (ghost && draft.ghost_turns.length && !order.includes(ghost.id)) order.push(ghost.id);
  return (
    // Two tiles to a row on desktop, where the main column is wide; an odd one out stays half width.
    <Card style={[styles.rosters, wide && styles.rostersWide]}>
      {order.map((teamId) => {
        const team = data.teams.find((t) => t.id === teamId);
        return team && <TeamTile key={teamId} data={data} team={team} roster={rosters.get(teamId) ?? []} style={wide && styles.rosterWide} />;
      })}
    </Card>
  );
}

function PickSheet({
  data,
  draft,
  playerId,
  onBehalfOf,
  forGhost,
  needsDrop,
  dropOptions,
  onClose,
  onConfirm,
}: {
  data: SeasonData;
  draft: Draft;
  playerId: number | null;
  onBehalfOf?: string;
  forGhost: boolean;
  needsDrop: boolean;
  dropOptions: number[];
  onClose: () => void;
  onConfirm: (dropPlayerId?: number) => Promise<string | null>;
}) {
  const theme = useTheme();
  // Hitters whose team is out (or who are off its postseason roster) leave empty spots: the pick
  // fills one by default, like the queue. Choosing someone still playing swaps him out instead.
  const empty = dropOptions.filter((id) => isOut(data, id));
  const alive = dropOptions.filter((id) => !isOut(data, id));
  const [chosen, setDrop] = useState<number | undefined>();
  const drop = chosen ?? empty[0];
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const injury = playerId !== null ? injuryText(data.poolByPlayer.get(playerId)) : null;

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
      {injury && (
        <ThemedText type="smallBold" themeColor="danger">
          {injury} He scores nothing while he’s off the postseason roster, and you can replace him in Draft 2.
        </ThemedText>
      )}
      {onBehalfOf && <ThemedText type="smallBold">Picking for {onBehalfOf} (commissioner)</ThemedText>}
      {forGhost && <ThemedText type="smallBold">For the 👻 Ghost team</ThemedText>}
      {needsDrop && (
        <View style={{ gap: Spacing.one }}>
          <ThemedText type="smallBold">{empty.length ? 'He fills' : 'Drop which player?'}</ThemedText>
          {empty.length > 0 && (
            <Pressable
              onPress={() => setDrop(empty[0])}
              style={[styles.dropRow, { borderColor: empty.includes(drop ?? -1) ? theme.accent : theme.border }]}>
              <ThemedText type="small">
                {empty.length === 1 ? 'An empty spot' : `One of your ${empty.length} empty spots`} (
                {empty.map((id) => `${playerName(data, id)}: ${outReason(data, id)}`).join(', ')})
              </ThemedText>
            </Pressable>
          )}
          {empty.length > 0 && alive.length > 0 && (
            <ThemedText type="smallBold" themeColor="textSecondary">Or swap out</ThemedText>
          )}
          {alive.map((id) => (
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

/** Why a rostered hitter left an empty spot. */
function outReason(data: SeasonData, playerId: number): string {
  const pool = data.poolByPlayer.get(playerId);
  return pool && data.mlbTeams.get(pool.mlb_team_id)?.eliminated ? 'team out' : 'off the postseason roster';
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
  const onClock = draft.status === 'live' && turn ? data.teams.find((t) => t.id === (turn.ghost?.by ?? turn.teamId)) : undefined;

  async function act(body: object) {
    setBusy(true);
    await run(body);
    setBusy(false);
    setConfirming(null);
  }

  return {
    canStart: draft.status === 'scheduled',
    autopickFor: onClock ? `${teamName(onClock)}${turn?.ghost ? ' (👻 Ghost pick)' : ''}` : null,
    // A finished season's drafts are history.
    canUndo: data.season.status !== 'complete' && data.actions.some((a) => a.draft_id === draft.id),
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
      {data.teams.filter((t) => !t.is_ghost).map((t) => (
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
            {showAutodraft ? '▾' : '▸'} Autodraft settings ({data.teams.filter((t) => t.autodraft && !t.is_ghost).length} on)
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
  clock: { padding: Spacing.three, borderRadius: Radius.lg, gap: Spacing.one },
  clockHeadline: { fontSize: 24, lineHeight: 30 },
  clockBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    borderRadius: Radius.lg,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  moreButton: { width: 36, height: 32, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, minHeight: 40 },
  segmented: { flexDirection: 'row', padding: Spacing.half, borderRadius: Radius.lg },
  segment: { flex: 1, alignItems: 'center', paddingVertical: Spacing.two, borderRadius: Radius.md },
  boardRow: { flexDirection: 'row', gap: Spacing.one, marginBottom: Spacing.one },
  boardCell: { width: 108, paddingHorizontal: Spacing.one },
  boardPick: { minHeight: 64, borderRadius: Radius.md, padding: Spacing.two, borderWidth: 2, borderColor: 'transparent' },
  dropRow: { borderWidth: 2, borderRadius: Radius.md, padding: Spacing.two },
  buttonRow: { flexDirection: 'row', gap: Spacing.two },
  foldHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two + 2 },
  // Card's title look (see Card), in a header that also folds.
  foldTitle: { flex: 1, textTransform: 'uppercase', letterSpacing: 0.5 },
  // Over My roster's last column.
  statHead: { alignSelf: 'flex-end', fontSize: 11, lineHeight: 14, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: -Spacing.one },
  rosters: { gap: Spacing.two + 2 },
  rostersWide: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-start' },
  rosterWide: { flexBasis: '45%', flexGrow: 1, maxWidth: '50%' },
  picksPanel: { borderRadius: Radius.lg, overflow: 'hidden' },
  picksTitle: { textTransform: 'uppercase', letterSpacing: 0.5, padding: Spacing.three, paddingBottom: Spacing.two },
  picksEmpty: { paddingHorizontal: Spacing.three, paddingBottom: Spacing.three },
  // About 6 picks tall; scroll for the rest.
  picksList: { maxHeight: 340, borderTopWidth: StyleSheet.hairlineWidth },
  picksFade: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 48, pointerEvents: 'none' },
  pickCard: { paddingVertical: Spacing.two, paddingHorizontal: Spacing.three },
  burnedName: { textDecorationLine: 'line-through', ...({ textDecorationThickness: 2 } as object) },
  burnGlow: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
  pickCardTop: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  pickPlayer: { flex: 1, fontSize: 15, lineHeight: 19 },
  pickLine: { fontSize: 13, lineHeight: 17 },
  pickBadge: { paddingHorizontal: Spacing.one + 2 },
  pickBadgeText: { fontSize: 11, lineHeight: 16, fontVariant: ['tabular-nums'] },
  pickTeam: { fontSize: 13, lineHeight: 17 },
  pickOwner: { fontSize: 13, lineHeight: 17, fontStyle: 'italic' },
});
