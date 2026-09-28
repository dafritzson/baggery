import { type ReactNode, useEffect, useState } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';

import { Card } from '@/components/card';
import { Switch } from '@/components/switch';
import { ThemedText } from '@/components/themed-text';
import { Toggle } from '@/components/toggle';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import { type Prefs, type PushState, type Scope, loadPushState, savePush, sendTestPush, turnOffPush } from '@/lib/push';
import { supabase } from '@/lib/supabase';

const SCOPES: { value: Scope; label: string }[] = [
  { value: 'off', label: 'Off' },
  { value: 'mine', label: 'My Baggers' },
  { value: 'league', label: 'Everyone' },
];

const DELAYS = [
  { value: 0, label: '0' },
  { value: 30, label: '30s' },
  { value: 60, label: '1m' },
  { value: 120, label: '2m' },
];

/** What turning the first alert on starts from: every draft alert but autodraft's, and game alerts off. */
const DEFAULTS: Prefs = {
  scope: 'off',
  delaySeconds: 0,
  bags: true,
  subs: true,
  cut: true,
  lineups: false,
  draft: true,
  draftStarted: true,
  autopicks: false,
  draftDone: true,
};

/** With alerts off on this device, every switch shows off. */
const OFF: Prefs = { ...DEFAULTS, draft: false, draftStarted: false, draftDone: false };

/** Where the signed-in account stands in the season being played, which is what alerts follow. */
type Standing = 'none' | 'not-member' | 'no-team' | 'out' | 'playing';

/**
 * The latest season played in the app (not an imported one): whether this account is in its league
 * and has a team still alive there. `none` when there's no such season, or it couldn't be read.
 */
async function loadStanding(userId: string): Promise<Standing> {
  const { data: season } = await supabase
    .from('seasons')
    .select('id, league_id')
    .is('imported_at', null)
    .order('year', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!season) return 'none';
  const [member, team] = await Promise.all([
    supabase.from('league_members').select('user_id').eq('league_id', season.league_id).eq('user_id', userId).maybeSingle(),
    supabase.from('fantasy_teams').select('eliminated_after_round').eq('season_id', season.id).eq('user_id', userId).maybeSingle(),
  ]);
  if (member.error || team.error) return 'none';
  if (!member.data) return 'not-member';
  if (!team.data) return 'no-team';
  return team.data.eliminated_after_round === null ? 'playing' : 'out';
}

/** Why the chosen alerts won't come, if they won't. */
function reachWarning(standing: Standing, scope: Scope, email: string | undefined): string | null {
  if (standing === 'not-member') {
    return `${email ?? 'This account'} isn’t in the league, so no alerts will come here. Sign in with the account you play with.`;
  }
  if (scope === 'mine' && standing === 'no-team') {
    return 'You don’t have a team this season, so My Baggers won’t alert. Choose Everyone, or claim a spot.';
  }
  if (scope === 'mine' && standing === 'out') {
    return 'Your team is out, so My Baggers won’t alert anymore. Choose Everyone to follow the rest.';
  }
  return null;
}

/**
 * Alerts on this device, in two cards. Draft alerts: ⏰ you're on the clock, 📣 a draft started, 🤖
 * autodraft picked for you (off unless turned on), ✅ a draft is done. Game alerts, for your
 * hitters or everyone's: bags, subs, the cut line and lineups (off unless turned on), each with its
 * own switch, and a spoiler delay. Turning the first one on asks for permission and subscribes
 * this browser; turning the last one off unsubscribes it. Web push, so web only for now; on iPhone
 * it takes the Home Screen app.
 */
export function AlertsSettings() {
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const [standing, setStanding] = useState<Standing>('none');
  const { session } = useAuth();
  const userId = session?.user.id;

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    loadPushState().then(setState, () => setState({ kind: 'unsupported' }));
  }, []);

  useEffect(() => {
    if (Platform.OS !== 'web' || !userId) return;
    loadStanding(userId).then(setStanding, () => setStanding('none'));
  }, [userId]);

  if (Platform.OS !== 'web' || !state) return null;

  if (state.kind === 'install' || state.kind === 'unsupported' || state.kind === 'blocked') {
    return (
      <Card title="Alerts">
        <ThemedText themeColor="textSecondary">
          {state.kind === 'install'
            ? 'On iPhone, alerts need Baggery on your Home Screen. In Safari, tap Share, then Add to Home Screen. Open Baggery from the new icon and come back here to turn them on.'
            : state.kind === 'unsupported'
              ? 'This browser can’t show notifications. Use Chrome on Android, or Baggery from the Home Screen on iPhone.'
              : 'Notifications are blocked for Baggery. Allow them in your browser’s site settings (on iPhone: Settings → Notifications → Baggery), then come back here.'}
        </ThemedText>
      </Card>
    );
  }

  async function run(action: () => Promise<string | null>, next: PushState, done?: string) {
    setBusy(true);
    setMessage(null);
    const error = await action();
    setBusy(false);
    if (error) {
      setMessage({ text: error, error: true });
      // A refusal may have changed what the browser allows (blocked, say).
      setState(await loadPushState().catch(() => state));
    } else {
      setState(next);
      if (done) setMessage({ text: done, error: false });
    }
  }

  const on = state.kind === 'on' ? state : null;
  const prefs: Prefs = on ?? OFF;

  function save(change: Partial<Prefs>) {
    if (busy) return;
    const next = { ...(on ?? DEFAULTS), ...change };
    if (next.scope === 'off' && !next.draft && !next.draftStarted && !next.autopicks && !next.draftDone) {
      run(turnOffPush, { kind: 'off' }, 'Alerts are off on this device.');
    } else {
      run(() => savePush(next), { kind: 'on', ...next }, on ? undefined : 'On. Send a test to check it works.');
    }
  }

  const warning = reachWarning(standing, prefs.scope, session?.user.email);
  const games = prefs.scope !== 'off';

  return (
    <>
      <Card title="Draft alerts">
        <View>
          <AlertRow icon="⏰" name="On the clock" detail="When it’s your turn to pick" value={prefs.draft} onChange={(v) => save({ draft: v })} />
          <Divider />
          <AlertRow icon="📣" name="Draft started" detail="When the commissioner starts a draft" value={prefs.draftStarted} onChange={(v) => save({ draftStarted: v })} />
          <Divider />
          <AlertRow icon="🤖" name="Autodraft picks" detail="When autodraft picks for you" value={prefs.autopicks} onChange={(v) => save({ autopicks: v })} />
          <Divider />
          <AlertRow icon="✅" name="Draft done" detail="When the last pick is made" value={prefs.draftDone} onChange={(v) => save({ draftDone: v })} />
        </View>
      </Card>
      <Card
        title="Game alerts"
        action={<Toggle options={SCOPES} value={prefs.scope} onChange={(v) => save({ scope: v })} />}>
        {warning && <ThemedText type="small" themeColor="danger">{warning}</ThemedText>}
        {games ? (
          <View>
            <AlertRow icon="👜" name="Bags" detail="When a hitter gets a bag" value={prefs.bags} onChange={(v) => save({ bags: v })} />
            <Divider />
            <AlertRow icon="👀" name="Subs" detail="When a hitter comes in or leaves a game" value={prefs.subs} onChange={(v) => save({ subs: v })} />
            <Divider />
            <AlertRow icon="🥵" name="Cut line" detail="When a team drops below or climbs above the cut" value={prefs.cut} onChange={(v) => save({ cut: v })} />
            <Divider />
            <AlertRow icon="📋" name="Lineups" detail="When a lineup is posted with your hitters in it" value={prefs.lineups} onChange={(v) => save({ lineups: v })} />
            <Divider />
            <AlertRow icon="⏱" name="Spoiler delay" detail="If your stream runs behind">
              <Toggle options={DELAYS} value={prefs.delaySeconds} onChange={(v) => save({ delaySeconds: v })} />
            </AlertRow>
          </View>
        ) : (
          <ThemedText type="small" themeColor="textSecondary">
            Bags, subs, the cut line and lineups. Choose My Baggers for your hitters, or Everyone for every team still alive.
          </ThemedText>
        )}
      </Card>
      {on && (
        <View style={styles.footer}>
          <ThemedText type="small" themeColor="textSecondary" style={styles.footerText}>Alerts go to this device only.</ThemedText>
          <Pressable
            accessibilityRole="button"
            disabled={busy}
            hitSlop={8}
            onPress={() =>
              run(
                sendTestPush,
                on,
                'Sent. It should show up in a few seconds. Nothing? Check that notifications are allowed for this browser and that Focus or Do Not Disturb is off (on a Mac: System Settings → Notifications).',
              )
            }>
            <ThemedText type="smallBold" themeColor="accent">{busy ? 'Sending…' : 'Send a test'}</ThemedText>
          </Pressable>
        </View>
      )}
      {message && (
        <ThemedText type="small" themeColor={message.error ? 'danger' : 'success'} style={styles.message}>{message.text}</ThemedText>
      )}
    </>
  );
}

/** One alert: its icon, name and what it's for, and its switch (or another control). */
function AlertRow({
  icon,
  name,
  detail,
  value,
  onChange,
  children,
}: {
  icon: string;
  name: string;
  detail: string;
  value?: boolean;
  onChange?: (v: boolean) => void;
  children?: ReactNode;
}) {
  return (
    <View style={styles.row}>
      <ThemedText style={styles.icon}>{icon}</ThemedText>
      <View style={styles.text}>
        <ThemedText type="smallBold">{name}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">{detail}</ThemedText>
      </View>
      {children ?? <Switch label={name} value={!!value} onChange={(v) => onChange?.(v)} />}
    </View>
  );
}

function Divider() {
  const theme = useTheme();
  return <View style={[styles.divider, { backgroundColor: theme.border }]} />;
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, minHeight: 56, paddingVertical: Spacing.one },
  icon: { width: 24, textAlign: 'center' },
  text: { flex: 1 },
  divider: { height: StyleSheet.hairlineWidth, marginLeft: 24 + Spacing.three },
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.two, paddingHorizontal: Spacing.one },
  footerText: { flex: 1 },
  message: { paddingHorizontal: Spacing.one },
});
