import { View, type ViewProps } from 'react-native';

import { ThemeColor } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type ThemedViewProps = ViewProps & {
  lightColor?: string;
  darkColor?: string;
  type?: ThemeColor;
  /**
   * The 3D look: 'raised' surfaces cast a shadow, 'sunken' ones (toggle tracks, wells) are pushed
   * in. Surfaces (type="backgroundElement") are raised unless told otherwise; the page is flat.
   */
  elevation?: 'raised' | 'sunken' | 'flat';
};

export function ThemedView({ style, lightColor, darkColor, type, elevation, ...otherProps }: ThemedViewProps) {
  const theme = useTheme();
  const depth = elevation ?? (type === 'backgroundElement' ? 'raised' : 'flat');
  const shadow = depth === 'flat' ? null : { boxShadow: depth === 'raised' ? theme.raised : theme.sunken };

  return <View style={[{ backgroundColor: theme[type ?? 'background'] }, shadow, style]} {...otherProps} />;
}
