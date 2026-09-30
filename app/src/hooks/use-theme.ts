/**
 * Learn more about light and dark modes:
 * https://docs.expo.dev/guides/color-schemes/
 */

import { createContext, createElement, type ReactNode, use, useMemo } from 'react';

import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

// Any color per key, not the palette's exact values, so a fill's theme can swap some of them.
type Theme = Record<keyof (typeof Colors)['light'], string>;

/** The fill of the surface around, when it's one of the dark highlight fills (FillSurface). */
const FillContext = createContext<'mineFill' | 'otherFill' | null>(null);

export function useTheme(): Theme {
  const scheme = useColorScheme();
  const fill = use(FillContext);
  const base = Colors[scheme === 'unspecified' ? 'light' : scheme];
  return useMemo(() => (fill ? onFill(base, base[fill]) : base), [base, fill]);
}

/** The theme for text and marks drawn on a dark fill: light text, and a white YOU tag. */
function onFill(base: Theme, fill: string): Theme {
  return {
    ...base,
    text: base.onFill,
    textSecondary: base.onFillSecondary,
    accent: base.onFill,
    accentText: fill,
    // The ▶ stays blue, not white like other accents, so it still looks tappable.
    playButton: '#60A5FA',
    success: '#86EFAC',
    danger: '#FCA5A5',
  };
}

/** Whether this is drawn on one of the dark highlight fills. */
export function useOnFill(): boolean {
  return use(FillContext) !== null;
}

/**
 * Children drawn on your hitters' dark green (or another manager's dark blue) read the theme for
 * that fill, so their text turns light without each one knowing. Nothing opened from inside (a
 * sheet) should render under it.
 */
export function FillSurface({ fill, children }: { fill: 'mineFill' | 'otherFill' | null | undefined; children: ReactNode }) {
  return createElement(FillContext, { value: fill ?? null }, children);
}
