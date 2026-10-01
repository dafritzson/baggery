import { useState } from 'react';
import { Pressable, type StyleProp, StyleSheet, type TextStyle } from 'react-native';

import { ThemedText, type ThemedTextProps } from '@/components/themed-text';
import { useOpenPlayer } from '@/lib/player';

/** A player's name (or line) that opens their stats popup; underlined on hover. */
export function PlayerName({
  playerId,
  children,
  type = 'small',
  style,
  numberOfLines,
}: {
  playerId: number;
  children: string;
  type?: ThemedTextProps['type'];
  style?: StyleProp<TextStyle>;
  numberOfLines?: number;
}) {
  const openPlayer = useOpenPlayer();
  const [hovered, setHovered] = useState(false);
  return (
    <Pressable
      onPress={() => openPlayer(playerId)}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      accessibilityRole="button"
      accessibilityHint="Shows the player's stats"
      style={{ flexShrink: 1 }}>
      <ThemedText type={type} numberOfLines={numberOfLines} style={[style, hovered && { textDecorationLine: StyleSheet.flatten(style)?.textDecorationLine === 'line-through' ? 'underline line-through' : 'underline' }]}>
        {children}
      </ThemedText>
    </Pressable>
  );
}
