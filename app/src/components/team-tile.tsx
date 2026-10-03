import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Radius } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTheme } from '@/hooks/use-theme';
import { teamColors } from '@/lib/team-colors';

/**
 * A club's abbreviation on a tile in its colors. `faded` is for the loser of a finished game, so
 * the winner stands out. A hairline ring in dark mode keeps the darkest clubs (navy, black) from
 * melting into the card.
 */
export function TeamTile({
  mlbTeamId,
  abbr,
  size = 'small',
  faded,
}: {
  mlbTeamId: number;
  abbr: string;
  size?: 'small' | 'large';
  faded?: boolean;
}) {
  const theme = useTheme();
  const dark = useColorScheme() === 'dark';
  const { bg, fg } = teamColors(mlbTeamId);
  const large = size === 'large';
  return (
    <View
      style={[
        large ? styles.large : styles.small,
        { backgroundColor: bg, boxShadow: theme.raised, borderColor: dark ? 'rgba(255, 255, 255, 0.22)' : 'transparent' },
        faded && styles.faded,
      ]}>
      <ThemedText style={[large ? styles.largeText : styles.smallText, { color: fg }]}>{abbr}</ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  small: { minWidth: 54, height: 28, paddingHorizontal: 10, borderRadius: Radius.md, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  smallText: { fontSize: 15, lineHeight: 20, fontWeight: 800, letterSpacing: 0.5 },
  large: { width: 56, height: 56, borderRadius: Radius.lg, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  largeText: { fontSize: 18, lineHeight: 22, fontWeight: 800, letterSpacing: 0.5 },
  faded: { opacity: 0.6 },
});
