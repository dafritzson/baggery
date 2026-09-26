import { type RefObject, useRef, useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';

import { Button } from '@/components/button';
import { Sheet } from '@/components/sheet';
import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { type Range, parseBound } from '@/lib/column-filters';

/**
 * Typed bounds for a column's filter, for when the menu's round numbers don't fit: at least and/or
 * at most, starting from the filter as it is. Mount it when it opens, so it starts fresh each time.
 */
export function FilterSheet({
  title,
  range,
  format,
  onApply,
  onClose,
}: {
  /** What the column is, e.g. "Plate appearances". */
  title: string;
  range: Range | undefined;
  /** How the column shows a value, so ".450" comes back as ".450". */
  format: (value: number) => string;
  /** Undefined clears the filter. */
  onApply: (range: Range | undefined) => void;
  onClose: () => void;
}) {
  // As the column shows it (".450"), unless that would round off what was typed before.
  const show = (v: number | null | undefined) => (v == null ? '' : parseBound(format(v)) === v ? format(v) : String(v));
  const [min, setMin] = useState(show(range?.min));
  const [max, setMax] = useState(show(range?.max));
  const [error, setError] = useState<string | null>(null);
  const first = useRef<TextInput>(null);

  function apply() {
    const lo = parseBound(min);
    const hi = parseBound(max);
    if (lo === undefined || hi === undefined) return setError('Enter a number, like 300 or .450.');
    if (lo !== null && hi !== null && lo > hi) return setError('"At least" is more than "at most".');
    onApply(lo === null && hi === null ? undefined : { min: lo, max: hi });
    onClose();
  }

  const edit = (set: (text: string) => void) => (text: string) => {
    set(text);
    setError(null);
  };

  return (
    <Sheet visible title={`Filter ${title.toLowerCase()}`} onClose={onClose} onShow={() => first.current?.focus()}>
      <ThemedText themeColor="textSecondary">Leave a box empty for no limit that way.</ThemedText>
      <View style={styles.row}>
        <BoundField label="At least" value={min} onChange={edit(setMin)} onSubmit={apply} inputRef={first} />
        <BoundField label="At most" value={max} onChange={edit(setMax)} onSubmit={apply} />
      </View>
      {error && <ThemedText themeColor="danger">{error}</ThemedText>}
      <Button label="Apply" onPress={apply} />
      <Button label="Cancel" variant="secondary" onPress={onClose} />
    </Sheet>
  );
}

function BoundField({
  label,
  value,
  onChange,
  onSubmit,
  inputRef,
}: {
  label: string;
  value: string;
  onChange: (text: string) => void;
  onSubmit: () => void;
  inputRef?: RefObject<TextInput | null>;
}) {
  const theme = useTheme();
  return (
    <View style={styles.field}>
      <ThemedText type="smallBold" themeColor="textSecondary">{label}</ThemedText>
      <TextInput
        ref={inputRef}
        value={value}
        onChangeText={onChange}
        onSubmitEditing={onSubmit}
        keyboardType="decimal-pad"
        returnKeyType="done"
        placeholder="No limit"
        placeholderTextColor={theme.textSecondary}
        accessibilityLabel={label}
        style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement, borderColor: theme.border, boxShadow: theme.sunken }]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: Spacing.three },
  field: { flex: 1, gap: Spacing.one },
  input: { minHeight: 48, borderWidth: 1, borderRadius: Radius.md, paddingHorizontal: Spacing.three, fontSize: 16 },
});
