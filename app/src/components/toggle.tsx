import { Pressable, StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/**
 * Segmented toggle: a sunken track with the chosen option raised out of it. `large` matches the
 * height of a menu chip, for a screen's main controls.
 */
export function Toggle<T>({
  options,
  value,
  onChange,
  large,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  large?: boolean;
}) {
  const theme = useTheme();
  return (
    <ThemedView type="backgroundElement" elevation="sunken" style={styles.toggle}>
      {options.map((o) => (
        <Pressable
          key={o.label}
          onPress={() => onChange(o.value)}
          accessibilityRole="button"
          accessibilityState={{ selected: value === o.value }}
          style={[styles.item, large && styles.itemLarge, value === o.value && { backgroundColor: theme.segment, boxShadow: theme.raised }]}>
          <ThemedText type="smallBold" themeColor={value === o.value ? 'text' : 'textSecondary'} style={!large && styles.text}>
            {o.label}
          </ThemedText>
        </Pressable>
      ))}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  toggle: { flexDirection: 'row', borderRadius: Radius.md, padding: 2 },
  item: { paddingHorizontal: Spacing.two, paddingVertical: 2, borderRadius: Radius.sm },
  itemLarge: { paddingHorizontal: Spacing.three - 4, paddingVertical: Spacing.one },
  text: { fontSize: 13 },
});
