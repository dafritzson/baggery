import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSyncExternalStore } from 'react';

import { COLUMNS, type ColumnKey, DEFAULT_COLUMNS } from '@/components/player-table';

// localStorage on web, so the choice sticks to this browser. Shared by every table on the page
// (and Research, which sizes its list to the columns).
const KEY = 'baggery.playerTable.columns';
// Every column there was when the choice was saved, so a new default column still shows for people
// who picked their own. Choices saved before this was kept knew every column but these.
const KNOWN_KEY = 'baggery.playerTable.knownColumns';
const ADDED_SINCE: ColumnKey[] = ['postPa', 'postTb'];
const listeners = new Set<() => void>();
let columns: ColumnKey[] = DEFAULT_COLUMNS;

function set(next: ColumnKey[]) {
  columns = next;
  listeners.forEach((l) => l());
}

AsyncStorage.multiGet([KEY, KNOWN_KEY])
  .then(([[, saved], [, savedKnown]]) => {
    if (!saved) return;
    const keys = JSON.parse(saved);
    if (!Array.isArray(keys)) return;
    const known: string[] = savedKnown ? JSON.parse(savedKnown) : COLUMNS.map((c) => c.key).filter((k) => !ADDED_SINCE.includes(k));
    // Skip columns that no longer exist, and add default ones that are new since.
    set(COLUMNS.filter((c) => keys.includes(c.key) || (c.default && !known.includes(c.key))).map((c) => c.key));
  })
  .catch(() => {});

function save(next: ColumnKey[]) {
  set(next);
  AsyncStorage.multiSet([
    [KEY, JSON.stringify(next)],
    [KNOWN_KEY, JSON.stringify(COLUMNS.map((c) => c.key))],
  ]).catch(() => {});
}

/** The player table's columns, as this person last picked them (the defaults until they do). */
export function usePlayerColumns(): [ColumnKey[], (columns: ColumnKey[]) => void] {
  const current = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => columns,
    () => columns,
  );
  return [current, save];
}
