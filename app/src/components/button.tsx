import { ActivityIndicator, Pressable, StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type Variant = 'primary' | 'secondary' | 'danger';

export function Button({
  label,
  onPress,
  variant = 'primary',
  disabled = false,
  loading = false,
  compact = false,
}: {
  label: string;
  onPress: () => void;
  variant?: Variant;
  disabled?: boolean;
  loading?: boolean;
  compact?: boolean;
}) {
  const theme = useTheme();
  const background = variant === 'primary' ? theme.accent : variant === 'danger' ? theme.danger : theme.backgroundSelected;
  const color = variant === 'secondary' ? theme.text : theme.accentText;
  const inactive = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: inactive }}
      disabled={inactive}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        compact && styles.compact,
        {
          backgroundColor: background,
          opacity: inactive ? 0.5 : 1,
          boxShadow: pressed && !inactive ? theme.sunken : theme.raised,
        },
      ]}>
      {loading ? (
        <ActivityIndicator color={color} />
      ) : (
        <ThemedText type={compact ? 'smallBold' : 'default'} style={[styles.label, { color }]}>
          {label}
        </ThemedText>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: 48,
    paddingHorizontal: Spacing.four,
    borderRadius: Radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  compact: { minHeight: 36, paddingHorizontal: Spacing.three, borderRadius: Radius.md },
  label: { fontWeight: 700 },
});
