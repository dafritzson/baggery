import type { TextStyle } from 'react-native';

import type { useTheme } from '@/hooks/use-theme';

/**
 * A hitter whose MLB team is eliminated (Rosters, Standings): his name in gray with a thick red
 * line through it, until he's replaced.
 */
export function outNameStyle(theme: ReturnType<typeof useTheme>): TextStyle {
  return {
    color: theme.textSecondary,
    textDecorationLine: 'line-through',
    textDecorationColor: theme.danger,
    // Not in React Native's types; react-native-web passes it to the CSS.
    ...({ textDecorationThickness: 2 } as object),
  };
}
