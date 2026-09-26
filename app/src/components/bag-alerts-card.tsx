import { useEffect, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { ThemedText } from '@/components/themed-text';
import { Toggle } from '@/components/toggle';
import { Spacing } from '@/constants/theme';
import { type Prefs, type PushState, type Scope, loadPushState, savePush, sendTestPush, turnOffPush } from '@/lib/push';

const SCOPES: { value: Scope | 'off'; label: string }[] = [
  { value: 'off', label: 'Off' },
  { value: 'mine', label: 'My hitters' },
  { value: 'league', label: 'Everyone’s' },
];

const DELAYS = [
  { value: 0, label: 'None' },
  { value: 30, label: '30s' },
  { value: 60, label: '1 min' },
  { value: 120, label: '2 min' },
];

/**
 * Bag alerts on this device: a notification ("👜 Shohei Ohtani got a bag") when your hitters, or
 * anyone's, get a bag. Web push, so web only for now; on iPhone it takes the Home Screen app.
 */
export function BagAlertsCard() {
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    loadPushState().then(setState, () => setState({ kind: 'unsupported' }));
  }, []);

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

  return (
    <Card title="Bag alerts">
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
                else choose({ scope: v, delaySeconds: on?.delaySeconds ?? 0 });
              }}
            />
          </View>
          {on && (
            <>
              <ThemedText type="smallBold" themeColor="textSecondary">Spoiler delay</ThemedText>
              <View style={styles.row}>
                <Toggle
                  options={DELAYS}
                  value={on.delaySeconds}
                  onChange={(v) => !busy && choose({ scope: on.scope, delaySeconds: v })}
                />
              </View>
              <ThemedText type="small" themeColor="textSecondary">
                Holds alerts back if you watch on a stream that runs behind.
              </ThemedText>
              <View style={styles.row}>
                <Button
                  label={busy ? 'Sending…' : 'Send a test'}
                  variant="secondary"
                  disabled={busy}
                  onPress={() => run(sendTestPush, on, 'Sent. It should show up in a few seconds.')}
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
});
