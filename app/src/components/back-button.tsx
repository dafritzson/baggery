import { type Href, router } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { Pressable, StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/** Back in history when there is some, else straight to `to` (e.g. after opening a shared link). */
export const goBack = (to: Href) => (router.canGoBack() ? router.back() : router.replace(to));

/**
 * Back to a parent page: a pill big enough to hit with a thumb. Goes back in history when there
 * is some, else straight to `to` (e.g. after opening a shared link).
 */
export function BackButton({ label, to }: { label: string; to: Href }) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Back to ${label}`}
      hitSlop={10}
      onPress={() => goBack(to)}
      style={({ pressed }) => [styles.button, { backgroundColor: pressed ? theme.backgroundSelected : theme.backgroundElement }]}>
      <SymbolView name={{ ios: 'chevron.left', android: 'arrow_back', web: 'arrow_back_ios_new' }} size={16} tintColor={theme.accent} />
      <ThemedText type="smallBold" style={{ color: theme.accent }}>{label}</ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: Spacing.one,
    minHeight: 40,
    paddingLeft: Spacing.two,
    paddingRight: Spacing.three,
    borderRadius: 999,
  },
});
