import { Platform, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTheme } from '@/hooks/use-theme';

/**
 * Web app on the iOS Home Screen: the status bar is see-through with white text (public/index.html),
 * which reads fine over the dark header but not the light one. In light mode this fills the strip
 * behind the status bar with the accent color. Nothing shows in a browser tab (no top inset).
 */
export function StatusBarBackdrop() {
  const { top } = useSafeAreaInsets();
  const scheme = useColorScheme();
  const theme = useTheme();
  if (Platform.OS !== 'web' || scheme === 'dark' || top === 0) return null;
  return <View pointerEvents="none" style={[styles.strip, { height: top, backgroundColor: theme.accent }]} />;
}

const styles = StyleSheet.create({
  strip: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 1000 },
});
