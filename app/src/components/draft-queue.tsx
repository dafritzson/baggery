import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import * as DropdownMenu from 'zeego/dropdown-menu';

import { type QueueEntry, draftTurns } from '@core/draft.ts';

import { Card } from '@/components/card';
import { PlayerName } from '@/components/player-name';
import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { playerLine, playerName } from '@/lib/format';
import { type Draft, type SeasonData, currentRosters, draftConfig } from '@/lib/season';
import { callFunction, supabase } from '@/lib/supabase';

/**
 * Whether you can queue players for a draft, and whose roster your picks would drop from (null
 * when they only add: the initial draft, or the ghost's empty spots). Null when you have no turns.
 */
export function queueTarget(data: SeasonData, draft: Draft): { dropFrom: string | null } | null {
  const me = data.myTeam;
  if (!me || draft.status === 'complete' || data.season.status === 'complete') return null;
  if (draft.status === 'scheduled') {
    // The order isn't set yet. Managers already out make the ghost's turns (see RULES.md): adds,
    // except Draft 4's by those out after round 1, which redraft the ghost's roster.
    const ghost = data.teams.find((t) => t.is_ghost);
    if (me.eliminated_after_round === null) return { dropFrom: draft.kind === 'redraft' ? me.id : null };
    return { dropFrom: draft.number === 4 && me.eliminated_after_round === 1 ? ghost?.id ?? null : null };
  }
  const mine = draftTurns(draftConfig(data, draft)).filter((t) => (t.ghost?.by ?? t.teamId) === me.id);
  if (!mine.length) return null;
  const redraft = mine.find((t) => draft.kind === 'redraft' && t.ghost?.kind !== 'add');
  return { dropFrom: redraft?.teamId ?? null };
}

export interface DraftQueue {
  entries: QueueEntry[];
  error: string | null;
  has: (playerId: number) => boolean;
  toggle: (playerId: number) => void;
  update: (change: (entries: QueueEntry[]) => QueueEntry[]) => void;
}

/**
 * Your queue for a draft. Only you can read it (row level security). Changes show at once and are
 * saved in order; a failed save shows its error and reloads what's saved. Players drafted since
 * are left out whenever it's changed.
 */
export function useDraftQueue(draftId: string, enabled: boolean, available: Set<number>): DraftQueue {
  const [entries, setEntries] = useState<QueueEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const latest = useRef<QueueEntry[]>([]);
  const saving = useRef<Promise<void>>(Promise.resolve());

  const load = useCallback(async () => {
    const { data: rows } = await supabase
      .from('draft_queue')
      .select('mlb_player_id, drop_player_id')
      .eq('draft_id', draftId)
      .order('position');
    if (!rows) return;
    latest.current = rows.map((r) => ({ playerId: r.mlb_player_id, dropPlayerId: r.drop_player_id ?? undefined }));
    setEntries(latest.current);
  }, [draftId]);

  useEffect(() => {
    if (enabled) load();
  }, [enabled, load]);

  const update = useCallback(
    (change: (entries: QueueEntry[]) => QueueEntry[]) => {
      const next = change(latest.current.filter((e) => available.has(e.playerId)));
      latest.current = next;
      setEntries(next);
      setError(null);
      saving.current = saving.current
        .then(async () => {
          const message = await callFunction('draft', { draftId, action: 'set-queue', queue: next });
          if (message) {
            setError(message);
            await load();
          }
        })
        // Keeps the chain going for the next change.
        .catch(() => setError('Couldn’t save your queue. Try again.'));
    },
    [draftId, available, load],
  );

  return useMemo(
    (): DraftQueue => ({
      entries,
      error,
      has: (id) => entries.some((e) => e.playerId === id),
      toggle: (id) => update((q) => (q.some((e) => e.playerId === id) ? q.filter((e) => e.playerId !== id) : [...q, { playerId: id }])),
      update,
    }),
    [entries, error, update],
  );
}

/** The Queue tab: your queued players in order, to reorder, remove, and in a redraft pick who each drops. */
export function QueueList({
  data,
  queue,
  available,
  dropFrom,
  autodraft,
}: {
  data: SeasonData;
  queue: DraftQueue;
  available: Set<number>;
  dropFrom: string | null;
  /** Your autodraft switch, which the queue works through. */
  autodraft: ReactNode;
}) {
  const theme = useTheme();
  const shown = queue.entries.filter((e) => available.has(e.playerId));
  const roster = dropFrom ? currentRosters(data).get(dropFrom) ?? [] : [];
  // Hitters whose team is out (or who are off its postseason roster) leave empty spots to fill.
  const empty = roster.filter((id) => isOut(data, id));
  const alive = roster.filter((id) => !isOut(data, id));
  const move = (from: number, to: number) =>
    queue.update((q) => {
      const next = [...q];
      const [entry] = next.splice(from, 1);
      next.splice(to, 0, entry);
      return next;
    });
  const setDrop = (playerId: number, dropPlayerId: number | undefined) =>
    queue.update((q) => q.map((e) => (e.playerId === playerId ? { ...e, dropPlayerId } : e)));

  return (
    <Card>
      <ThemedText type="small" themeColor="textSecondary">
        Only you can see your queue. When autodraft picks for you (your switch, or the commissioner’s autopick), it
        takes the top player here who’s still available.
        {!dropFrom && ' If the queue runs out, it goes back to the most regular-season TB.'}
      </ThemedText>
      {dropFrom && (
        <ThemedText type="small" themeColor={empty.length ? 'text' : 'textSecondary'}>
          {empty.length
            ? `${empty.length === 1 ? '1 empty spot' : `${empty.length} empty spots`} to fill (${empty.map((id) => playerName(data, id)).join(', ')}: team out). Your queue fills them from the top.`
            : 'Your spots fill when a hitter’s team is knocked out. To swap out someone still playing, choose him under Replaces.'}
        </ThemedText>
      )}
      {autodraft}
      {dropFrom && <WhenQueueRunsOut />}
      {queue.error && <ThemedText themeColor="danger">{queue.error}</ThemedText>}
      {shown.length === 0 ? (
        <ThemedText type="small" themeColor="textSecondary">
          Nobody queued yet. Tap a player on the Players tab, then Add to queue.
        </ThemedText>
      ) : (
        <View style={{ gap: Spacing.one }}>
          {shown.map((e, i) => (
            <View key={e.playerId} style={[styles.row, { borderColor: theme.border }]}>
              <ThemedText type="smallBold" themeColor="textSecondary" style={styles.rank}>{i + 1}</ThemedText>
              <View style={styles.main}>
                <PlayerName playerId={e.playerId} numberOfLines={1}>{playerLine(data, e.playerId)}</PlayerName>
                {dropFrom && <DropPicker data={data} alive={alive} value={e.dropPlayerId} onChange={(d) => setDrop(e.playerId, d)} />}
              </View>
              <IconButton label="↑" hint="Move up" disabled={i === 0} onPress={() => move(i, i - 1)} />
              <IconButton label="↓" hint="Move down" disabled={i === shown.length - 1} onPress={() => move(i, i + 1)} />
              <IconButton label="✕" hint="Remove from queue" onPress={() => queue.toggle(e.playerId)} />
            </View>
          ))}
        </View>
      )}
    </Card>
  );
}

/** What autodraft does in a redraft once the queue is spent. */
export function WhenQueueRunsOut() {
  const theme = useTheme();
  return (
    <View style={[styles.whenEmpty, { backgroundColor: theme.backgroundSelected }]}>
      <ThemedText type="smallBold">When the queue runs out</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        Autodraft yields the rest of your picks, after filling any spots left by eliminated hitters. You can also yield
        yourself when you’re on the clock.
      </ThemedText>
    </View>
  );
}

/** Whether a rostered hitter leaves an empty spot: his MLB team is out, or he's off its postseason roster. */
function isOut(data: SeasonData, playerId: number): boolean {
  const pool = data.poolByPlayer.get(playerId);
  return !pool || !pool.on_postseason_roster || !!data.mlbTeams.get(pool.mlb_team_id)?.eliminated;
}

/**
 * "Fills: an empty spot ▾", or "Replaces: Mookie Betts ▾" to swap out a hitter still playing.
 * Unset, autodraft fills a spot left by a hitter whose team is out, and skips him when there's none.
 */
function DropPicker({
  data,
  alive,
  value,
  onChange,
}: {
  data: SeasonData;
  /** Rostered hitters still playing: the ones a manager would choose to swap out. */
  alive: number[];
  value: number | undefined;
  onChange: (dropPlayerId: number | undefined) => void;
}) {
  const current = value !== undefined && alive.includes(value) ? value : undefined;
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger className="menu-trigger" aria-label="Who he replaces">
        <ThemedText type="small" themeColor={current === undefined ? 'textSecondary' : 'text'} numberOfLines={1}>
          {current === undefined ? 'Fills: an empty spot' : `Replaces: ${playerName(data, current)}`} ▾
        </ThemedText>
      </DropdownMenu.Trigger>
      <DropdownMenu.Content className="menu-content" align="start" sideOffset={6} collisionPadding={8}>
        <DropdownMenu.CheckboxItem
          key="auto"
          className="menu-item"
          value={current === undefined ? 'on' : 'off'}
          onValueChange={() => onChange(undefined)}>
          <DropdownMenu.ItemTitle>Fill an empty spot</DropdownMenu.ItemTitle>
          <DropdownMenu.ItemIndicator className="menu-check">✓</DropdownMenu.ItemIndicator>
        </DropdownMenu.CheckboxItem>
        {alive.length > 0 && <DropdownMenu.Label key="swap" className="menu-label">Or swap out</DropdownMenu.Label>}
        {alive.map((id) => (
          <DropdownMenu.CheckboxItem
            key={String(id)}
            className="menu-item"
            value={current === id ? 'on' : 'off'}
            onValueChange={() => onChange(id)}>
            <DropdownMenu.ItemTitle>{playerLine(data, id)}</DropdownMenu.ItemTitle>
            <DropdownMenu.ItemIndicator className="menu-check">✓</DropdownMenu.ItemIndicator>
          </DropdownMenu.CheckboxItem>
        ))}
      </DropdownMenu.Content>
    </DropdownMenu.Root>
  );
}

function IconButton({ label, hint, disabled = false, onPress }: { label: string; hint: string; disabled?: boolean; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      hitSlop={4}
      accessibilityRole="button"
      accessibilityLabel={hint}
      style={({ pressed }) => [
        styles.icon,
        { backgroundColor: theme.backgroundSelected, opacity: disabled ? 0.3 : 1, boxShadow: pressed ? theme.sunken : undefined },
      ]}>
      <ThemedText type="smallBold">{label}</ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, paddingVertical: Spacing.two, borderBottomWidth: StyleSheet.hairlineWidth },
  whenEmpty: { borderRadius: Radius.md, padding: Spacing.three, gap: 2 },
  rank: { width: 20, textAlign: 'right', fontVariant: ['tabular-nums'] },
  main: { flex: 1, minWidth: 0, gap: 2 },
  icon: { width: 32, height: 32, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
});
