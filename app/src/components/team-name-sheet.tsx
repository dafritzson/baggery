import { useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';

import { Button } from '@/components/button';
import { Sheet } from '@/components/sheet';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/**
 * A team name input with a dice button (another random name) and a save button. Starts from
 * `initialName`; `onSave` returns an error message or null.
 */
export function TeamNameField({
  saveLabel,
  initialName,
  suggest,
  onSave,
  autoFocus = false,
}: {
  saveLabel: string;
  initialName: string;
  suggest: () => string;
  onSave: (name: string) => Promise<string | null>;
  autoFocus?: boolean;
}) {
  const theme = useTheme();
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
    <View style={styles.field}>
      <View style={styles.row}>
        <TextInput
          value={name}
          onChangeText={(v) => {
            setName(v);
            setError(null);
          }}
          maxLength={30}
          autoFocus={autoFocus}
          accessibilityLabel="Team name"
          onSubmitEditing={save}
          style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement, borderColor: theme.border }]}
        />
        <Button label="🎲" variant="secondary" onPress={() => setName(suggest())} />
      </View>
      {error && <ThemedText themeColor="danger">{error}</ThemedText>}
      <Button label={saveLabel} onPress={save} loading={saving} disabled={!name.trim()} />
    </View>
  );
}

/** TeamNameField in a bottom sheet (claiming a spot, or the commissioner renaming a team). */
export function TeamNameSheet({
  visible,
  title,
  description,
  onClose,
  ...field
}: {
  visible: boolean;
  title: string;
  description?: string;
  onClose: () => void;
} & Parameters<typeof TeamNameField>[0]) {
  return (
    <Sheet visible={visible} title={title} onClose={onClose}>
      {description && <ThemedText themeColor="textSecondary">{description}</ThemedText>}
      <TeamNameField autoFocus {...field} />
      <Button label="Cancel" variant="secondary" onPress={onClose} />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  field: { gap: Spacing.two },
  row: { flexDirection: 'row', gap: Spacing.two, alignItems: 'center' },
  input: { flex: 1, minHeight: 48, borderWidth: 1, borderRadius: Spacing.two, paddingHorizontal: Spacing.three, fontSize: 16 },
});
