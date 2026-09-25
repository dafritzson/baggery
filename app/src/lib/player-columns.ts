import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';

import { COLUMNS, type ColumnKey, DEFAULT_COLUMNS } from '@/components/player-table';

// localStorage on web, so the choice sticks to this browser.
const KEY = 'baggery.playerTable.columns';

/** The player table's columns, as this person last picked them (the defaults until they do). */
export function usePlayerColumns(): [ColumnKey[], (columns: ColumnKey[]) => void] {
  const [columns, setColumns] = useState<ColumnKey[]>(DEFAULT_COLUMNS);

  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(KEY)
      .then((saved) => {
        if (cancelled || !saved) return;
        const keys = JSON.parse(saved);
        // Skip columns that no longer exist.
        if (Array.isArray(keys)) setColumns(COLUMNS.map((c) => c.key).filter((k) => keys.includes(k)));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  function save(next: ColumnKey[]) {
    setColumns(next);
    AsyncStorage.setItem(KEY, JSON.stringify(next)).catch(() => {});
  }

  return [columns, save];
}
