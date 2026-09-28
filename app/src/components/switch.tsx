import { Pressable, StyleSheet, View } from 'react-native';

import { useTheme } from '@/hooks/use-theme';

/** An on/off switch: the accent when on, with its knob to the right. */
export function Switch({
  value,
  onChange,
  label,
  disabled = false,
}: {
  value: boolean;
  onChange: (v: boolean) => void;
  /** What it switches, for screen readers. */
  label: string;
  disabled?: boolean;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityState={{ checked: value, disabled }}
      disabled={disabled}
      onPress={() => onChange(!value)}
      hitSlop={8}
      style={[
        styles.track,
        { backgroundColor: value ? theme.accent : theme.switchOff, opacity: disabled ? 0.5 : 1 },
        value && styles.on,
      ]}>
      <View style={styles.knob} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  track: { width: 44, height: 26, borderRadius: 13, padding: 3, flexDirection: 'row' },
  on: { justifyContent: 'flex-end' },
  knob: { width: 20, height: 20, borderRadius: 10, backgroundColor: '#ffffff', boxShadow: '0 1px 2px rgba(16, 24, 40, 0.25)' },
});
