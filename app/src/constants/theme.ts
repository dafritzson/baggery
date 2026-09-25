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
    /** The selected option in a segmented toggle: lighter than its sunken track. */
    segment: '#ffffff',
    /**
     * 3D surfaces, all soft shadows: raised (cards, tables, chips, buttons) casts a close shadow
     * plus a wide, faint one; sunken (inputs, toggle tracks, pressed buttons) has a soft shadow
     * inside; floating (popups, side panels) sits higher.
     */
    raised: '0 1px 2px rgba(16, 24, 40, 0.08), 0 4px 12px rgba(16, 24, 40, 0.10)',
    sunken: 'inset 0 2px 4px rgba(16, 24, 40, 0.10)',
    floating: '0 16px 40px rgba(16, 24, 40, 0.18), 0 4px 12px rgba(16, 24, 40, 0.08)',
    /** Standings totals, like the old scoring sheet: safe (blue), tied at the cut (lavender), out (red). */
    standingSafe: '#D3E2F4',
    standingTied: '#DCD5EC',
    standingOut: '#F3D0D0',
    /** Your own team and players (Standings rows, Games cards): a soft blue-gray. */
    mine: '#DCE5F4',
  },
  dark: {
    text: '#ffffff',
    // Near-black rather than black, so the raised/floating shadows below still read.
    background: '#111113',
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
    segment: '#2E3135',
    raised: '0 1px 2px rgba(0, 0, 0, 0.8), 0 4px 14px rgba(0, 0, 0, 0.7)',
    sunken: 'inset 0 2px 5px rgba(0, 0, 0, 0.6)',
    floating: '0 16px 40px rgba(0, 0, 0, 0.8), 0 4px 12px rgba(0, 0, 0, 0.6)',
    standingSafe: '#1C3050',
    standingTied: '#30284A',
    standingOut: '#4A2228',
    mine: '#223047',
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
