import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSyncExternalStore } from 'react';

import { COLUMNS, type ColumnKey, DEFAULT_COLUMNS } from '@/components/player-table';

// localStorage on web, so the choice sticks to this browser. Shared by every table on the page
// (and Research, which sizes its list to the columns).
const KEY = 'baggery.playerTable.columns';
const listeners = new Set<() => void>();
let columns: ColumnKey[] = DEFAULT_COLUMNS;

function set(next: ColumnKey[]) {
  columns = next;
  listeners.forEach((l) => l());
}

AsyncStorage.getItem(KEY)
  .then((saved) => {
    if (!saved) return;
    const keys = JSON.parse(saved);
    // Skip columns that no longer exist.
    if (Array.isArray(keys)) set(COLUMNS.map((c) => c.key).filter((k) => keys.includes(k)));
  })
  .catch(() => {});

function save(next: ColumnKey[]) {
  set(next);
  AsyncStorage.setItem(KEY, JSON.stringify(next)).catch(() => {});
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
