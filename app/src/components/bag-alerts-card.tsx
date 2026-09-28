import { useEffect, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { ThemedText } from '@/components/themed-text';
import { Toggle } from '@/components/toggle';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import { type Prefs, type PushState, type Scope, loadPushState, savePush, sendTestPush, turnOffPush } from '@/lib/push';
import { supabase } from '@/lib/supabase';

const SCOPES: { value: Scope | 'off'; label: string }[] = [
  { value: 'off', label: 'Off' },
  { value: 'mine', label: 'My hitters' },
  { value: 'league', label: 'Everyone’s' },
];

const ON_OFF = [
  { value: true, label: 'On' },
  { value: false, label: 'Off' },
];

const DELAYS = [
  { value: 0, label: 'None' },
  { value: 30, label: '30s' },
  { value: 60, label: '1 min' },
  { value: 120, label: '2 min' },
];

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
function reachWarning(standing: Standing, scope: Scope | 'off', email: string | undefined): string | null {
  if (standing === 'not-member') {
    return `${email ?? 'This account'} isn’t in the league, so no alerts will come here. Sign in with the account you play with.`;
  }
  if (scope === 'mine' && standing === 'no-team') {
    return 'You don’t have a team this season, so My hitters won’t alert. Choose Everyone’s, or claim a spot.';
  }
  if (scope === 'mine' && standing === 'out') {
    return 'Your team is out, so My hitters won’t alert anymore. Choose Everyone’s to follow the rest.';
  }
  return null;
}

/**
 * Alerts on this device: a notification ("👜 Shohei Ohtani got a bag") when your hitters, or
 * anyone's, get a bag, and with them sub alerts (👀 off the bench, 😠 replaced) and cut alerts (🥵 on
 * the hot seat, 😮‍💨 off the chopping block), each of which can be turned off, and lineup alerts (📋
 * a starting lineup is posted), which are off unless turned on, and draft alerts (⏰ you're on the
 * clock), which are on unless turned off. Web push, so web only
 * for now; on iPhone it takes the Home Screen app.
 */
export function BagAlertsCard() {
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const [standing, setStanding] = useState<Standing>('none');
  const { session } = useAuth();
  const theme = useTheme();
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

  function choose(prefs: Prefs) {
    const firstTime = state?.kind !== 'on';
    run(() => savePush(prefs), { kind: 'on', ...prefs }, firstTime ? 'On. Send a test to check it works.' : 'Saved.');
  }

  const on = state.kind === 'on' ? state : null;
  const prefs: Prefs | null = on && {
    scope: on.scope,
    delaySeconds: on.delaySeconds,
    subs: on.subs,
    cut: on.cut,
    lineups: on.lineups,
    draft: on.draft,
  };
  const warning = reachWarning(standing, on?.scope ?? 'off', session?.user.email);

  return (
    <Card title="Alerts">
      {state.kind === 'install' ? (
        <ThemedText themeColor="textSecondary">
          On iPhone, alerts need Baggery on your Home Screen. In Safari, tap Share, then Add to Home Screen. Open
          Baggery from the new icon and come back here to turn them on.
        </ThemedText>
      ) : state.kind === 'unsupported' ? (
        <ThemedText themeColor="textSecondary">
          This browser can’t show notifications. Use Chrome on Android, or Baggery from the Home Screen on iPhone.
        </ThemedText>
      ) : state.kind === 'blocked' ? (
        <ThemedText themeColor="textSecondary">
          Notifications are blocked for Baggery. Allow them in your browser’s site settings (on iPhone: Settings →
          Notifications → Baggery), then come back here.
        </ThemedText>
      ) : (
        <>
          <ThemedText themeColor="textSecondary">
            A notification on this device when a hitter gets a bag.
          </ThemedText>
          <View style={styles.row}>
            <Toggle<Scope | 'off'>
              options={SCOPES}
              value={on?.scope ?? 'off'}
              onChange={(v) => {
                if (busy) return;
                if (v === 'off') run(turnOffPush, { kind: 'off' }, 'Off on this device.');
                else {
                  choose({
                    scope: v,
                    delaySeconds: on?.delaySeconds ?? 0,
                    subs: on?.subs ?? true,
                    cut: on?.cut ?? true,
                    lineups: on?.lineups ?? false,
                    draft: on?.draft ?? true,
                  });
                }
              }}
            />
          </View>
          {warning && <ThemedText type="small" themeColor="danger">{warning}</ThemedText>}
          {on && (
            <>
              <ThemedText type="smallBold" themeColor="textSecondary">Spoiler delay</ThemedText>
              <View style={styles.row}>
                <Toggle
                  options={DELAYS}
                  value={on.delaySeconds}
                  onChange={(v) => !busy && choose({ ...prefs!, delaySeconds: v })}
                />
              </View>
              <ThemedText type="small" themeColor="textSecondary">
                Holds alerts back if you watch on a stream that runs behind.
              </ThemedText>
              <ThemedText type="smallBold" themeColor="textSecondary">Subs</ThemedText>
              <View style={styles.row}>
                <Toggle options={ON_OFF} value={on.subs} onChange={(v) => !busy && choose({ ...prefs!, subs: v })} />
              </View>
              <ThemedText type="small" themeColor="textSecondary">
                👀 when a hitter comes off the bench, 😠 when one is taken out of the game.
              </ThemedText>
              <ThemedText type="smallBold" themeColor="textSecondary">Cut line</ThemedText>
              <View style={styles.row}>
                <Toggle options={ON_OFF} value={on.cut} onChange={(v) => !busy && choose({ ...prefs!, cut: v })} />
              </View>
              <ThemedText type="small" themeColor="textSecondary">
                🥵 when a team drops below the cut, 😮‍💨 when it climbs back above. Checked after each game ends.
              </ThemedText>
              <ThemedText type="smallBold" themeColor="textSecondary">Lineups</ThemedText>
              <View style={styles.row}>
                <Toggle options={ON_OFF} value={on.lineups} onChange={(v) => !busy && choose({ ...prefs!, lineups: v })} />
              </View>
              <ThemedText type="small" themeColor="textSecondary">
                📋 when a team posts its starting lineup, usually a few hours before first pitch: where your hitters bat, or
                that they’re on the bench. 🪑 if a late change drops one.
              </ThemedText>
              <View style={[styles.section, { borderColor: theme.border }]}>
                <ThemedText type="smallBold" themeColor="textSecondary" style={styles.sectionTitle}>Draft</ThemedText>
              </View>
              <ThemedText type="smallBold" themeColor="textSecondary">You’re on the clock</ThemedText>
              <View style={styles.row}>
                <Toggle options={ON_OFF} value={on.draft} onChange={(v) => !busy && choose({ ...prefs!, draft: v })} />
              </View>
              <ThemedText type="small" themeColor="textSecondary">
                ⏰ when it’s your turn to pick in a draft. Not while autodraft is picking for you.
              </ThemedText>
              <View style={styles.row}>
                <Button
                  label={busy ? 'Sending…' : 'Send a test'}
                  variant="secondary"
                  disabled={busy}
                  onPress={() =>
                    run(
                      sendTestPush,
                      on,
                      'Sent. It should show up in a few seconds. Nothing? Check that notifications are allowed for this browser and that Focus or Do Not Disturb is off (on a Mac: System Settings → Notifications).',
                    )
                  }
                />
              </View>
            </>
          )}
        </>
      )}
      {message && (
        <ThemedText type="small" themeColor={message.error ? 'danger' : 'success'}>{message.text}</ThemedText>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  section: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: Spacing.two, marginTop: Spacing.one },
  sectionTitle: { textTransform: 'uppercase', letterSpacing: 0.5 },
});
