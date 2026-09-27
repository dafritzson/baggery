import type { ReactNode } from 'react';
import { StyleSheet, type StyleProp, View, type ViewStyle } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Radius, Spacing } from '@/constants/theme';

/** A card, with an optional title and, beside the title, an optional control (a toggle, say). */
export function Card({
  title,
  action,
  children,
  style,
}: {
  title?: string;
  action?: ReactNode;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const heading = title && <ThemedText type="smallBold" themeColor="textSecondary" style={styles.title}>{title}</ThemedText>;
  return (
    <ThemedView type="backgroundElement" style={[styles.card, style]}>
      {action ? (
        <View style={styles.header}>
          {heading}
          {action}
        </View>
      ) : (
        heading
      )}
      {children}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  card: { padding: Spacing.three, borderRadius: Radius.lg, gap: Spacing.two },
  title: { textTransform: 'uppercase', letterSpacing: 0.5 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.two },
});
