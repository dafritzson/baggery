import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type Variant = 'primary' | 'secondary' | 'danger' | 'success';

export function Button({
  label,
  onPress,
  variant = 'primary',
  disabled = false,
  loading = false,
  compact = false,
  pulse = false,
}: {
  label: string;
  onPress: () => void;
  variant?: Variant;
  disabled?: boolean;
  loading?: boolean;
  compact?: boolean;
  /** A ring that fades in and out (global.css), for the move you most likely want to make. */
  pulse?: boolean;
}) {
  const theme = useTheme();
  const background = variant === 'primary' ? theme.accent : variant === 'danger' ? theme.danger : variant === 'success' ? theme.success : theme.backgroundSelected;
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
      {pulse && !inactive && (
        <View
          pointerEvents="none"
          style={[styles.pulse, { borderColor: background }]}
          // dataSet isn't in React Native's types; react-native-web turns it into data-* attributes.
          {...({ dataSet: { buttonPulse: '' } } as object)}
        />
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
  pulse: { position: 'absolute', top: -5, right: -5, bottom: -5, left: -5, borderWidth: 3, borderRadius: Radius.lg + 5 },
});
