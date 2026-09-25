/**
 * Below are the colors that are used in the app. The colors are defined in the light and dark mode.
 * There are many other ways to style your app. For example, [Nativewind](https://www.nativewind.dev/), [Tamagui](https://tamagui.dev/), [unistyles](https://reactnativeunistyles.vercel.app), etc.
 */

import '@/global.css';

import { Platform } from 'react-native';

export const Colors = {
  light: {
    text: '#000000',
    background: '#ffffff',
    backgroundElement: '#F0F0F3',
    backgroundSelected: '#E0E1E6',
    textSecondary: '#60646C',
    border: '#E0E1E6',
    accent: '#0B3D91',
    accentText: '#ffffff',
    highlight: '#FDECEC',
    danger: '#C8102E',
    success: '#1A7F37',
    /** Light accent-blue fill for list cards, and a stronger one for badges on them. */
    tint: '#E9EFFB',
    tintHover: '#DDE7F9',
    tintStrong: '#D2DDF3',
    /** Raised-tile look for tinted cards: a light top edge and a shaded bottom edge. */
    bevel: 'inset 0 1px 0 rgba(255, 255, 255, 0.9), inset 0 -2px 0 rgba(11, 61, 145, 0.10)',
    /**
     * 3D surfaces: raised (cards, tables, chips, buttons) casts a soft shadow with a lit top edge
     * and a shaded bottom edge; sunken (inputs, toggle tracks, pressed buttons) is pushed in;
     * floating (popups, side panels) sits higher.
     */
    raised:
      '0 1px 2px rgba(16, 24, 40, 0.14), 0 2px 6px rgba(16, 24, 40, 0.06), inset 0 1px 0 rgba(255, 255, 255, 0.9), inset 0 -1px 0 rgba(16, 24, 40, 0.08)',
    sunken: 'inset 0 1px 3px rgba(16, 24, 40, 0.16), inset 0 -1px 0 rgba(255, 255, 255, 0.7)',
    floating: '0 12px 32px rgba(16, 24, 40, 0.18), 0 2px 6px rgba(16, 24, 40, 0.08)',
    /** Standings totals, like the old scoring sheet: safe (blue), tied at the cut (lavender), out (red). */
    standingSafe: '#D3E2F4',
    standingTied: '#DCD5EC',
    standingOut: '#F3D0D0',
    /** Your own players in lists: a mid blue that stands out without shouting. */
    mine: '#B7CCF0',
  },
  dark: {
    text: '#ffffff',
    background: '#000000',
    backgroundElement: '#212225',
    backgroundSelected: '#2E3135',
    textSecondary: '#B0B4BA',
    border: '#2E3135',
    accent: '#5B8DEF',
    accentText: '#000000',
    highlight: '#3A1A1E',
    danger: '#FF6B6B',
    success: '#4ADE80',
    tint: '#16213A',
    tintHover: '#1D2A49',
    tintStrong: '#223257',
    bevel: 'inset 0 1px 0 rgba(255, 255, 255, 0.08), inset 0 -2px 0 rgba(0, 0, 0, 0.45)',
    raised:
      // On a black page a drop shadow barely shows, so the lit top edge does more of the work.
      '0 1px 2px rgba(0, 0, 0, 0.7), 0 3px 8px rgba(0, 0, 0, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.14), inset 0 -1px 0 rgba(0, 0, 0, 0.5)',
    sunken: 'inset 0 1px 3px rgba(0, 0, 0, 0.7), inset 0 -1px 0 rgba(255, 255, 255, 0.05)',
    floating: '0 12px 32px rgba(0, 0, 0, 0.6), 0 2px 6px rgba(0, 0, 0, 0.4)',
    standingSafe: '#1C3050',
    standingTied: '#30284A',
    standingOut: '#4A2228',
    mine: '#2A4574',
  },
} as const;

export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;

export const Fonts = Platform.select({
  ios: {
    /** iOS `UIFontDescriptorSystemDesignDefault` */
    sans: 'system-ui',
    /** iOS `UIFontDescriptorSystemDesignSerif` */
    serif: 'ui-serif',
    /** iOS `UIFontDescriptorSystemDesignRounded` */
    rounded: 'ui-rounded',
    /** iOS `UIFontDescriptorSystemDesignMonospaced` */
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
  web: {
    sans: 'var(--font-display)',
    serif: 'var(--font-serif)',
    rounded: 'var(--font-rounded)',
    mono: 'var(--font-mono)',
  },
});

export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
  six: 64,
} as const;

/**
 * Corner radii: squared-off, with just enough rounding to soften edges. Circles (avatars, dots)
 * stay circles and don't use these.
 */
export const Radius = {
  /** Tags, small buttons, cells. */
  sm: 3,
  /** Chips, inputs, segments, buttons. */
  md: 4,
  /** Cards, tables, panels, sheets. */
  lg: 6,
} as const;

export const BottomTabInset = Platform.select({ ios: 50, android: 80 }) ?? 0;
export const MaxContentWidth = 720;
/** Content width for screens with a desktop layout (Screen width="wide"). */
export const WideContentWidth = 1600;
