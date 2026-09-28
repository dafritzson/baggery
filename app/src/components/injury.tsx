import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Radius } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { shortDate } from '@/lib/format';
import type { PoolEntry } from '@/lib/season';

/** "IL10" in red beside the name of a hitter on the injured list. */
export function InjuryChip({ list }: { list: number }) {
  const theme = useTheme();
  return (
    <View
      accessible
      accessibilityLabel={`On the ${list}-day injured list`}
      style={[styles.chip, { backgroundColor: theme.highlight }]}>
      <ThemedText type="smallBold" style={[styles.text, { color: theme.danger }]}>IL{list}</ThemedText>
    </View>
  );
}

/** "10-day injured list: Right calf strain. Can come off it 9/27." Null when he isn't on it. */
export function injuryText(entry: Pick<PoolEntry, 'injured_list' | 'injury' | 'injury_return'> | undefined): string | null {
  if (!entry || entry.injured_list === null) return null;
  const note = entry.injury?.trim().replace(/\.$/, '');
  const back = entry.injury_return ? ` Can come off it ${shortDate(entry.injury_return)}.` : '';
  return `${entry.injured_list}-day injured list${note ? `: ${note}` : ''}.${back}`;
}

const styles = StyleSheet.create({
  chip: { borderRadius: Radius.sm, paddingHorizontal: 5, marginLeft: 2 },
  text: { fontSize: 11, lineHeight: 16 },
});
