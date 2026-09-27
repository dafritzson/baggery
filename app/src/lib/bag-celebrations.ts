// Bag celebrations: which bags get the rain and popup (components/bag-celebration), and whether
// this device wants them at all (Settings). Bags come from the live scores broadcast while the
// app is on screen, or from a tapped bag alert's link (`/games?bag=`).

import AsyncStorage from '@react-native-async-storage/async-storage';
import { router, useGlobalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';

import { type BagHit, bagKey, bagsInChanges, parseBagParam } from '@core/bag-celebration.ts';
import { ownerAt } from '@core/scoreboard.ts';

import { pushDelaySeconds } from '@/lib/push';
import { coreSpells, useScoreChanges, useScores } from '@/lib/scores';
import { useSeason } from '@/lib/season';

export interface Celebration {
  bag: BagHit;
  /** The team the bag counts for, if any. */
  teamId: string | null;
  /** Your own team's bag: "You got 2 bags!" with the rain. Others' (from a tapped alert) get just the popup. */
  yours: boolean;
}

// On or off for this device, like the player table's columns (localStorage on web).
const ENABLED_KEY = 'baggery.celebrations';
const enabledListeners = new Set<() => void>();
let enabled = true;

function setEnabled(next: boolean) {
  enabled = next;
  enabledListeners.forEach((l) => l());
}

AsyncStorage.getItem(ENABLED_KEY)
  .then((saved) => {
    if (saved === 'off') setEnabled(false);
  })
  .catch(() => {});

export function saveCelebrationsEnabled(next: boolean) {
  setEnabled(next);
  AsyncStorage.setItem(ENABLED_KEY, next ? 'on' : 'off').catch(() => {});
}

export function useCelebrationsEnabled(): boolean {
  return useSyncExternalStore(
    (listener) => {
      enabledListeners.add(listener);
      return () => enabledListeners.delete(listener);
    },
    () => enabled,
    () => enabled,
  );
}

// Bags already celebrated, so tapping the alert for one you saw live (the page reloads) doesn't
// show it again. The last few dozen are plenty.
const SHOWN_KEY = 'baggery.celebrated';
let shown: string[] = [];
const shownLoaded = AsyncStorage.getItem(SHOWN_KEY)
  .then((saved) => {
    const keys = saved ? JSON.parse(saved) : [];
    if (Array.isArray(keys)) shown = keys.filter((k) => typeof k === 'string');
  })
  .catch(() => {});

function markShown(key: string) {
  shown = [...shown.filter((k) => k !== key), key].slice(-50);
  AsyncStorage.setItem(SHOWN_KEY, JSON.stringify(shown)).catch(() => {});
}

/** This device's spoiler delay for bag alerts, so the rain doesn't beat the stream either. */
async function spoilerDelayMs(): Promise<number> {
  return (await pushDelaySeconds().catch(() => 0)) * 1000;
}

/** The celebrations waiting to be shown, first one on screen; `done` moves to the next. */
export function useBagCelebrations(): { current: Celebration | null; done: () => void } {
  const { data } = useSeason();
  const { scores } = useScores();
  const on = useCelebrationsEnabled();
  const [queue, setQueue] = useState<Celebration[]>([]);
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());

  const show = useCallback((celebration: Celebration) => {
    const key = bagKey(celebration.bag);
    if (shown.includes(key)) return;
    markShown(key);
    setQueue((q) => [...q, celebration]);
  }, []);

  // Your hitters' bags as they happen, after the spoiler delay. Only while the app is on screen:
  // otherwise the bag alert tells you, and tapping it shows the celebration then.
  const myTeam = data?.myTeam;
  useScoreChanges((before, changes) => {
    if (!on || !data || !myTeam || myTeam.eliminated_after_round !== null) return;
    const bags = bagsInChanges(before, changes, coreSpells(data), myTeam.id, Date.now());
    if (!bags.length) return;
    spoilerDelayMs().then((delay) => {
      const timer = setTimeout(() => {
        timers.current.delete(timer);
        if (AppState.currentState !== 'active') return;
        for (const bag of bags) show({ bag, teamId: myTeam.id, yours: true });
      }, delay);
      timers.current.add(timer);
    });
  });
  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach(clearTimeout);
  }, []);

  // A tapped bag alert: its bag, once the scores have loaded for the popup's stats.
  const { bag: bagParam } = useGlobalSearchParams<{ bag?: string }>();
  useEffect(() => {
    if (!bagParam || !data || !scores) return;
    router.setParams({ bag: undefined });
    const bag = parseBagParam(bagParam);
    if (!bag || !on) return;
    const game = scores.games.find((g) => g.gamePk === bag.gamePk);
    const teamId = (game && ownerAt(coreSpells(data), bag.playerId, game.start)) ?? null;
    shownLoaded.then(() => show({ bag, teamId, yours: !!teamId && teamId === data.myTeam?.id }));
  }, [bagParam, data, scores, on, show]);

  const done = useCallback(() => setQueue((q) => q.slice(1)), []);
  return { current: queue[0] ?? null, done };
}
