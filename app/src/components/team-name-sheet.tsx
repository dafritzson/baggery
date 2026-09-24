import { useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';

import { Button } from '@/components/button';
import { Sheet } from '@/components/sheet';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/**
 * Asks for a team name (claiming a spot, or renaming a team). Starts from `initialName`;
 * the dice button suggests another random name. `onSave` returns an error message or null.
 */
export function TeamNameSheet({
  visible,
  title,
  description,
  saveLabel,
  initialName,
  suggest,
  onSave,
  onClose,
}: {
  visible: boolean;
  title: string;
  description?: string;
  saveLabel: string;
  initialName: string;
  suggest: () => string;
  onSave: (name: string) => Promise<string | null>;
  onClose: () => void;
}) {
  const theme = useTheme();
  // The parent remounts this (via key) each time it opens, so state starts fresh.
  const [name, setName] = useState(initialName);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    const message = await onSave(name);
    setSaving(false);
    setError(message);
  }

  return (
    <Sheet visible={visible} title={title} onClose={onClose}>
      {description && <ThemedText themeColor="textSecondary">{description}</ThemedText>}
      <View style={styles.row}>
        <TextInput
          value={name}
          onChangeText={(v) => {
            setName(v);
            setError(null);
          }}
          maxLength={30}
          autoFocus
          accessibilityLabel="Team name"
          onSubmitEditing={save}
          style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement, borderColor: theme.border }]}
        />
        <Button label="🎲" variant="secondary" onPress={() => setName(suggest())} />
      </View>
      {error && <ThemedText themeColor="danger">{error}</ThemedText>}
      <Button label={saveLabel} onPress={save} loading={saving} disabled={!name.trim()} />
      <Button label="Cancel" variant="secondary" onPress={onClose} />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: Spacing.two, alignItems: 'center' },
  input: { flex: 1, minHeight: 48, borderWidth: 1, borderRadius: Spacing.two, paddingHorizontal: Spacing.three, fontSize: 16 },
});
