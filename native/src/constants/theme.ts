/**
 * Below are the colors that are used in the app. The colors are defined in the light and dark mode.
 * There are many other ways to style your app. For example, [Nativewind](https://www.nativewind.dev/), [Tamagui](https://tamagui.dev/), [unistyles](https://reactnativeunistyles.vercel.app), etc.
 */

import '@/global.css';

import { Platform } from 'react-native';

// Opiflow brand — final palette: Navy·Deep #11273B, Water·Primary #2A86C5,
// Navy·Brand #1A3550, Muted #6B7585.
export const Brand = {
  primary: '#2A86C5',
  primaryDeep: '#1A3550',
  primaryPressed: '#226C9E',
  primarySoft: '#E7F0F8',
  onPrimary: '#FFFFFF',
  ink: '#11273B',
  navy: '#1A3550',
  slate: '#6B7585',
  success: '#18A06A',
  warn: '#E0922F',
  danger: '#DA4A4A',
  tagline: 'Customer Action Management',
} as const;

// Brand gradient stops (water → navy) — buttons, FABs, chat bubbles, icon tiles.
export const BrandGradient = ['#2A86C5', '#1A3550'] as const;
export const SuccessGradient = ['#2CC27E', '#18A06A'] as const;

// Layered soft shadows (iOS shadow* + Android elevation).
export const Shadow = {
  card: { shadowColor: '#11273B', shadowOpacity: 0.06, shadowRadius: 18, shadowOffset: { width: 0, height: 6 }, elevation: 2 },
  float: { shadowColor: '#11273B', shadowOpacity: 0.16, shadowRadius: 28, shadowOffset: { width: 0, height: 14 }, elevation: 10 },
} as const;

export const Radius = { card: 22, control: 16, pill: 999 } as const;

// Semantic color tokens. LIGHT values intentionally equal the colors currently
// hard-coded across the screens, so converting `'#FFFFFF'` → `c.card` etc. is a
// no-op in light mode (zero regression) and gives dark mode for free.
//   text        — primary ink            textSecondary — muted label
//   textFaint   — placeholders/hints     background    — screen base
//   card        — card / sheet surface   surface       — chips, inputs, tracks
//   border      — visible hairline       borderFaint   — near-invisible card edge
export const Colors = {
  light: {
    text: '#11273B',
    textSecondary: '#6B7585',
    textFaint: '#9AA4B2',
    background: '#FFFFFF',
    card: '#FFFFFF',
    surface: '#F4F6F9',
    inputBg: '#FFFFFF',
    backgroundElement: '#F4F6F9',
    backgroundSelected: '#E6EDF4',
    border: '#E3E7ED',
    borderFaint: 'rgba(17,39,59,0.06)',
    glass: 'rgba(255,255,255,0.94)',
    glassBorder: 'rgba(17,39,59,0.08)',
    tabOn: '#E7F0F8',
    tint: Brand.primary,
  },
  dark: {
    text: '#EAF0F6',
    textSecondary: '#9AA4B2',
    textFaint: '#6B7585',
    background: '#0E1722',
    card: '#17232F',
    surface: '#1E2B38',
    inputBg: '#0F1923',
    backgroundElement: '#1E2B38',
    backgroundSelected: '#26384A',
    border: '#2A3744',
    borderFaint: 'rgba(255,255,255,0.07)',
    glass: 'rgba(20,31,42,0.92)',
    glassBorder: 'rgba(255,255,255,0.10)',
    tabOn: 'rgba(79,163,227,0.16)',
    tint: '#4FA3E3',
  },
} as const;

export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;

// The active palette returned by useTheme(); used to type screen style factories
// (`const makeStyles = (c: ThemePalette) => StyleSheet.create({...})`). Values are
// widened to `string` so both the light and dark palettes are assignable.
export type ThemePalette = { [K in keyof typeof Colors.light]: string };

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

// Clearance for the floating glass tab bar (see glass-tab-bar.tsx geometry):
// BAR_H 64 + raised AI FAB overhang (~49 above the bar) + max safe-area bottom.
// 110/108 cleared the bar but NOT the FAB top (~147px on notch iPhones), so the
// last centered row could hide behind the FAB — hence 128/126.
export const BottomTabInset = Platform.select({ ios: 128, android: 126 }) ?? 0;
export const MaxContentWidth = 800;
