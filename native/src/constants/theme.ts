/**
 * Below are the colors that are used in the app. The colors are defined in the light and dark mode.
 * There are many other ways to style your app. For example, [Nativewind](https://www.nativewind.dev/), [Tamagui](https://tamagui.dev/), [unistyles](https://reactnativeunistyles.vercel.app), etc.
 */

import '@/global.css';

import { Platform } from 'react-native';

// Opiflow brand — palette from the CAM brand memo (Opiflow_CAM_Brand_Memo.pdf):
// heading blue #2563EB, ink #111827, soft panels #EAF2FF, slate #94A3B8.
export const Brand = {
  primary: '#2563EB',
  primaryPressed: '#1D4ED8',
  primarySoft: '#EAF2FF',
  onPrimary: '#FFFFFF',
  ink: '#111827',
  slate: '#94A3B8',
  tagline: 'Customer Action Management',
} as const;

export const Colors = {
  light: {
    text: '#0A1120',
    background: '#FFFFFF',
    backgroundElement: '#F4F6F9',
    backgroundSelected: '#E6EDF4',
    textSecondary: '#5B6472',
    tint: Brand.primary,
    border: '#E3E7ED',
  },
  dark: {
    text: '#F5F7FA',
    background: '#0B0F14',
    backgroundElement: '#161B22',
    backgroundSelected: '#222A33',
    textSecondary: '#9AA4B2',
    tint: '#4FA3E3',
    border: '#222A33',
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

export const BottomTabInset = Platform.select({ ios: 50, android: 80 }) ?? 0;
export const MaxContentWidth = 800;
