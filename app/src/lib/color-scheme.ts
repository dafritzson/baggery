import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSyncExternalStore } from 'react';
import { Platform } from 'react-native';

/** Light or dark as picked with the header's toggle; null follows the device. */
export type ColorSchemeChoice = 'light' | 'dark' | null;

const KEY = 'baggery.colorScheme';
const listeners = new Set<() => void>();
let choice: ColorSchemeChoice = null;

const parse = (value: string | null): ColorSchemeChoice => (value === 'light' || value === 'dark' ? value : null);

/** Web: menus in global.css and the browser's own scrollbars and form controls follow the choice. */
function applyToDocument() {
  if (Platform.OS !== 'web' || typeof document === 'undefined') return;
  const root = document.documentElement;
  if (choice) {
    root.dataset.theme = choice;
    root.style.colorScheme = choice;
  } else {
    delete root.dataset.theme;
    root.style.colorScheme = '';
  }
}

function set(next: ColorSchemeChoice) {
  choice = next;
  applyToDocument();
  listeners.forEach((l) => l());
}

// Web reads localStorage right away so the first paint is already in the right theme.
if (Platform.OS === 'web') {
  try {
    choice = parse(window.localStorage.getItem(KEY));
    applyToDocument();
  } catch {}
} else {
  AsyncStorage.getItem(KEY)
    .then((saved) => set(parse(saved)))
    .catch(() => {});
}

export function setColorSchemeChoice(next: ColorSchemeChoice) {
  set(next);
  (next ? AsyncStorage.setItem(KEY, next) : AsyncStorage.removeItem(KEY)).catch(() => {});
}

export function useColorSchemeChoice(): ColorSchemeChoice {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => choice,
    () => choice,
  );
}
