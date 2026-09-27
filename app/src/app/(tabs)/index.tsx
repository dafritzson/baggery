import { LuckiestGuy_400Regular, useFonts } from '@expo-google-fonts/luckiest-guy';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { AppState, Platform, StyleSheet, Text, View } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BagGame, GAME_FONT } from '@/components/bag-game';
import { Ballpark } from '@/components/ballpark';
import { Button } from '@/components/button';
import { BOTTOM_TAB_BAR_SPACE } from '@/components/section-nav';
import { Spacing } from '@/constants/theme';
import { useLayout } from '@/hooks/use-layout';
import { fieldView, isNight } from '@/lib/bag-game';
import { type BagGameScores, useBagGameScores } from '@/lib/bag-game-scores';

/** Home: a ballpark where bags fall from the sky. A new game starts every time you come here. */
export default function HomeScreen() {
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const compact = useLayout() === 'compact';
  const { bottom } = useSafeAreaInsets();
  // Day or night by the clock (not dark mode), checked whenever Home comes into view.
  const [night, setNight] = useState(() => isNight(new Date()));
  const reduceMotion = useReducedMotion();
  const [fontsLoaded, fontError] = useFonts({ LuckiestGuy_400Regular });
  const { scores, refresh, save } = useBagGameScores();
  // Game number: a new one remounts the game. 0 = none running.
  const [game, setGame] = useState(0);
  // Scores as they were when the game ended, before saving it: the final screen compares
  // against these ("New league record!").
  const [before, setBefore] = useState<BagGameScores>();
  const newGame = useCallback(() => {
    setBefore(undefined);
    setGame((g) => g + 1);
  }, []);
  const finish = (score: number) => {
    setBefore(scores);
    save(score);
  };

  // Play whenever Home comes into view (unless motion is reduced: then wait for a tap), and stop
  // when it's left or the app goes to the background. Scores may have changed while away.
  useFocusEffect(
    useCallback(() => {
      setNight(isNight(new Date()));
      refresh();
      if (!reduceMotion) newGame();
      const sub = AppState.addEventListener('change', (state) => {
        if (state !== 'active') setGame(0);
        else if (!reduceMotion) newGame();
      });
      return () => {
        sub.remove();
        setGame(0);
      };
    }, [reduceMotion, newGame, refresh]),
  );

  const ready = size && (fontsLoaded || fontError);
  // Phones: the tab bar floats over the bottom, so the field ends above it.
  const visibleBottom = size && (compact ? size.height - BOTTOM_TAB_BAR_SPACE - bottom : size.height);
  const view = size && visibleBottom ? fieldView(size.width, size.height, visibleBottom) : null;

  return (
    <View
      style={[styles.screen, noTouchZoom]}
      onLayout={(e) => setSize({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height })}>
      {view && <Ballpark view={view} night={night} />}
      {ready && view && game > 0 && (
        <BagGame
          key={game}
          view={view}
          scores={scores}
          before={before}
          night={night}
          onFinish={finish}
          onReplay={newGame}
        />
      )}
      {ready && view && game === 0 && reduceMotion && (
        <View style={[styles.start, { height: view.horizon }]}>
          <Text style={styles.startTitle}>BAGGERY</Text>
          <Button label="Play" onPress={newGame} />
        </View>
      )}
    </View>
  );
}

// Web: quick taps shouldn't zoom the page or select text.
const noTouchZoom = Platform.OS === 'web' ? ({ touchAction: 'manipulation', userSelect: 'none' } as object) : null;

const styles = StyleSheet.create({
  screen: { flex: 1, overflow: 'hidden' },
  start: { position: 'absolute', top: 0, left: 0, right: 0, alignItems: 'center', justifyContent: 'center', gap: Spacing.three },
  startTitle: { fontFamily: GAME_FONT, fontSize: 56, color: '#FFD84D' },
});
