import { Image } from 'expo-image';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Radius } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

// Muted colors that hold white text in light and dark mode.
const PALETTE = ['#2F6FDB', '#C2410C', '#15803D', '#7C3AED', '#B91C1C', '#0E7490', '#A16207', '#BE185D', '#4D7C0F', '#475569'];

/**
 * A round badge for a team's owner: their photo (uploaded in Settings, else from Google) when
 * they have one, else their initial in a color that stays with the team. My team gets an accent
 * ring; an unclaimed spot (no owner) gets an empty dashed circle.
 */
export function OwnerBadge({
  teamId,
  owner,
  photo,
  mine,
  size = 30,
}: {
  teamId: string;
  owner: string | null;
  photo?: string | null;
  mine?: boolean;
  size?: number;
}) {
  const theme = useTheme();
  const [failed, setFailed] = useState<string | null>(null);
  const round = { width: size, height: size, borderRadius: size / 2 };
  const ring = mine ? `0 0 0 2px ${theme.backgroundElement}, 0 0 0 3.5px ${theme.accent}` : undefined;
  if (!owner) return <View style={[round, { borderWidth: 1.5, borderStyle: 'dashed', borderColor: theme.textSecondary }]} />;
  if (photo && failed !== photo) {
    return (
      <View style={[round, { boxShadow: ring }]}>
        <Image source={photo} style={round} onError={() => setFailed(photo)} accessibilityLabel={owner} />
      </View>
    );
  }
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
          boxShadow: ring,
        },
      ]}>
      <ThemedText style={{ color: '#fff', fontSize: size * 0.42, lineHeight: size * 0.52, fontWeight: 700 }}>
        {owner[0].toUpperCase()}
      </ThemedText>
    </View>
  );
}

/** A small accent "YOU" tag, after my team's owner or name. */
export function YouTag() {
  const theme = useTheme();
  return (
    <View style={[styles.you, { backgroundColor: theme.accent }]}>
      <ThemedText style={[styles.youText, { color: theme.accentText }]}>YOU</ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  you: { paddingHorizontal: 5, height: 15, borderRadius: Radius.sm, justifyContent: 'center' },
  youText: { fontSize: 9, lineHeight: 11, fontWeight: 800, letterSpacing: 0.6 },
});
