// Bag celebrations: which bags get the rain and popup (components/bag-celebration), and whether
// this device wants them at all (Settings). Bags come from the live scores broadcast while the
// app is on screen, or from a tapped bag alert (lib/notification-taps, or the `/games?bag=` link the
// app opened with).

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
  /** Unique per celebration, so one bag shown twice in a row is drawn afresh. */
  id: number;
  bag: BagHit;
  /** The team the bag counts for, if any. */
  teamId: string | null;
  /** Your own team's bag: "You got 2 bags!" with the rain. Others' (from a tapped alert) get just the popup. */
  yours: boolean;
}

let nextId = 1;

// Tapped bag alerts' bags (`bagParam`s), waiting for the season to load. Kept outside the hook so
// a tap picked up before the app has its data, or while it's still coming to the front, isn't lost.
const TAP_WAIT_FOR_SCORES_MS = 3000;
const tapListeners = new Set<() => void>();
let tappedBags: string[] = [];

/** Shows a tapped bag alert's bag once the app can. */
export function tapBag(param: string) {
  tappedBags = [...tappedBags, param];
  tapListeners.forEach((l) => l());
}

function useTappedBags(): string[] {
  return useSyncExternalStore(
    (listener) => {
      tapListeners.add(listener);
      return () => tapListeners.delete(listener);
    },
    () => tappedBags,
    () => tappedBags,
  );
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

// Bags already celebrated, so the live scores don't show one twice (say, after the page reloads).
// A tapped alert always shows its bag, seen or not. The last few dozen are plenty.
const SHOWN_KEY = 'baggery.celebrated';
let shown: string[] = [];
const shownLoaded = AsyncStorage.getItem(SHOWN_KEY)
  .then((saved) => {
    const keys = saved ? JSON.parse(saved) : [];
    if (Array.isArray(keys)) shown = keys.filter((k) => typeof k === 'string');
  })
  .catch(() => {});

// Tapped bags shown lately: a tap can arrive twice, in the link the app opened with and again
// from the service worker (lib/notification-taps), and is shown once.
const TAP_REPEAT_MS = 30 * 1000;
const tapped = new Map<string, number>();

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

  const show = useCallback((celebration: Omit<Celebration, 'id'>, tap = false) => {
    const key = bagKey(celebration.bag);
    if (tap) {
      const now = Date.now();
      if (now - (tapped.get(key) ?? 0) < TAP_REPEAT_MS) return;
      tapped.set(key, now);
    } else if (shown.includes(key)) {
      return;
    }
    markShown(key);
    // Already waiting or on screen (live, then tapped): once is enough.
    setQueue((q) => (q.some((c) => bagKey(c.bag) === key) ? q : [...q, { ...celebration, id: nextId++ }]));
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

  // The link the app opened with, from a tapped bag alert: its bag joins the taps below.
  const { bag: bagParam } = useGlobalSearchParams<{ bag?: string }>();
  useEffect(() => {
    if (!bagParam) return;
    tapBag(bagParam);
    router.setParams({ bag: undefined });
  }, [bagParam]);

  // Tapped bag alerts: each one's bag, every time. Once the season has loaded, and
  // the scores for the popup's stats, or a few seconds on without them (they fill in when they come).
  const taps = useTappedBags();
  useEffect(() => {
    if (!taps.length || !data) return;
    const showTaps = () => {
      const params = tappedBags;
      tappedBags = [];
      tapListeners.forEach((l) => l());
      if (!on) return;
      for (const param of params) {
        const bag = parseBagParam(param);
        if (!bag) continue;
        const game = scores?.games.find((g) => g.gamePk === bag.gamePk);
        // Whoever had him when the game started, or now if the scores don't have the game yet.
        const teamId = ownerAt(coreSpells(data), bag.playerId, game?.start ?? new Date().toISOString()) ?? null;
        shownLoaded.then(() => show({ bag, teamId, yours: !!teamId && teamId === data.myTeam?.id }, true));
      }
    };
    if (scores) {
      showTaps();
      return;
    }
    const wait = setTimeout(showTaps, TAP_WAIT_FOR_SCORES_MS);
    return () => clearTimeout(wait);
  }, [taps, data, scores, on, show]);

  const done = useCallback(() => setQueue((q) => q.slice(1)), []);
  return { current: queue[0] ?? null, done };
}
