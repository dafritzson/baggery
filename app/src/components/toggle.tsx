import { Pressable, StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/**
 * Segmented toggle: a sunken track with the chosen option raised out of it. `large` matches the
 * height of a menu chip, for a screen's main controls. `fill` stretches it across its container,
 * options splitting the width evenly, as tall tabs; an option's `note` sits small under its label.
 */
export function Toggle<T>({
  options,
  value,
  onChange,
  large,
  fill,
}: {
  options: { value: T; label: string; note?: string }[];
  value: T;
  onChange: (v: T) => void;
  large?: boolean;
  fill?: boolean;
}) {
  const theme = useTheme();
  return (
    <ThemedView type="backgroundElement" elevation="sunken" style={[styles.toggle, fill && styles.toggleFill]}>
      {options.map((o) => (
        <Pressable
          key={o.label}
          onPress={() => onChange(o.value)}
          accessibilityRole="button"
          accessibilityState={{ selected: value === o.value }}
          style={[styles.item, large && styles.itemLarge, fill && styles.itemFill, value === o.value && { backgroundColor: theme.segment, boxShadow: theme.raised }]}>
          <ThemedText
            type={fill ? 'default' : 'smallBold'}
            themeColor={value === o.value ? 'text' : 'textSecondary'}
            numberOfLines={fill ? 1 : undefined}
            style={fill ? styles.fillText : !large && styles.text}>
            {o.label}
          </ThemedText>
          {fill && options.some((x) => x.note !== undefined) && (
            // Every option keeps the note's line, so the tabs don't change height when a note moves.
            <ThemedText type="smallBold" themeColor="textSecondary" style={styles.note}>
              {o.note || ' '}
            </ThemedText>
          )}
        </Pressable>
      ))}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  toggle: { flexDirection: 'row', borderRadius: Radius.md, padding: 2 },
  item: { paddingHorizontal: Spacing.two, paddingVertical: 2, borderRadius: Radius.sm },
  itemLarge: { paddingVertical: Spacing.one },
  toggleFill: { alignSelf: 'stretch', padding: 3 },
  itemFill: { flex: 1, alignItems: 'center', paddingVertical: Spacing.two },
  fillText: { fontWeight: '700' },
  note: { fontSize: 11, lineHeight: 14, letterSpacing: 0.5, textTransform: 'uppercase' },
  text: { fontSize: 13 },
});
