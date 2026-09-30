import { useEffect, useState } from 'react';
import { StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';

import type { BagHit } from '@core/bag-celebration.ts';

import { type Drop, dropTransform, makeDrops } from '@/lib/bag-rain';

/** Bag emoji falling past the whole screen, harder for more bags. (Web: bag-rain.web.tsx.) */
export function BagRain({ bag }: { bag: BagHit }) {
  const { width, height } = useWindowDimensions();
  // Once per celebration: a resize doesn't reshuffle the rain.
  const [drops] = useState(() => makeDrops(bag, width));
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {drops.map((drop, i) => (
        <FallingEmoji key={i} drop={drop} height={height} />
      ))}
    </View>
  );
}

function FallingEmoji({ drop, height }: { drop: Drop; height: number }) {
  const fall = useSharedValue(0);
  useEffect(() => {
    fall.set(withDelay(drop.delay, withTiming(1, { duration: drop.duration, easing: Easing.in(Easing.quad) })));
  }, [drop, fall]);
  const style = useAnimatedStyle(() => {
    const { translateY, translateX, rotate } = dropTransform(drop, height, fall.value);
    return { opacity: fall.value > 0 ? 1 : 0, transform: [{ translateY }, { translateX }, { rotate }] };
  });
  return (
    <Animated.View style={[styles.drop, { left: drop.x - drop.size / 2 }, style]}>
      <Text style={{ fontSize: drop.size, lineHeight: drop.size * 1.25 }}>{drop.emoji}</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  drop: { position: 'absolute', top: 0 },
});
