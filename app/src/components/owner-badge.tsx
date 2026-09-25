import { View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';

// Muted colors that hold white text in light and dark mode.
const PALETTE = ['#2F6FDB', '#C2410C', '#15803D', '#7C3AED', '#B91C1C', '#0E7490', '#A16207', '#BE185D', '#4D7C0F', '#475569'];

/**
 * A round badge with the owner's initial, in a color that stays with the team. My team gets an
 * accent ring; an unclaimed spot (no owner) gets an empty dashed circle.
 */
export function OwnerBadge({ teamId, owner, mine, size = 30 }: { teamId: string; owner: string | null; mine?: boolean; size?: number }) {
  const theme = useTheme();
  const round = { width: size, height: size, borderRadius: size / 2 };
  if (!owner) return <View style={[round, { borderWidth: 1.5, borderStyle: 'dashed', borderColor: theme.textSecondary }]} />;
  let hash = 0;
  for (const ch of teamId) hash = (hash * 31 + ch.charCodeAt(0)) | 0;
  return (
    <View
      style={[
        round,
        {
          backgroundColor: PALETTE[Math.abs(hash) % PALETTE.length],
          alignItems: 'center',
          justifyContent: 'center',
          boxShadow: mine ? `0 0 0 2px ${theme.backgroundElement}, 0 0 0 3.5px ${theme.accent}` : undefined,
        },
      ]}>
      <ThemedText style={{ color: '#fff', fontSize: size * 0.42, lineHeight: size * 0.52, fontWeight: 700 }}>
        {owner[0].toUpperCase()}
      </ThemedText>
    </View>
  );
}
