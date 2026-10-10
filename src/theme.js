import { createContext, useContext, useMemo } from 'react';
import { StyleSheet } from 'react-native';

export const palettes = {
  light: {
    bg: '#F6F5FB',
    surface: '#FFFFFF',
    text: '#1B1A2E',
    subtext: '#5E5B73',
    muted: '#9A97AD',
    border: '#ECEAF3',
    primary: '#6C5CE7',
    primarySoft: '#EEEBFF',
    danger: '#E5484D',
    chipActive: '#1B1A2E',
    chipActiveText: '#FFFFFF',
    glass: 'rgba(255,255,255,0.7)', // small buttons on coloured cards
    shadow: '#2A2350',
  },
  dark: {
    bg: '#111017',
    surface: '#1C1B25',
    text: '#F2F1F8',
    subtext: '#B9B6CB',
    muted: '#7E7B93',
    border: '#2D2B39',
    primary: '#8B7DFF',
    primarySoft: '#2A2550',
    danger: '#FF6B70',
    chipActive: '#F2F1F8',
    chipActiveText: '#111017',
    glass: 'rgba(255,255,255,0.09)',
    shadow: '#000000',
  },
};

// Topic colours: soft card background + a matching accent, tuned per theme.
export const noteColorSets = {
  light: [
    { key: 'lavender', bg: '#ECE8FF', accent: '#6C5CE7' },
    { key: 'peach', bg: '#FFE8DB', accent: '#F2763A' },
    { key: 'mint', bg: '#DAF5EA', accent: '#14A673' },
    { key: 'sky', bg: '#DDEEFF', accent: '#2F86E6' },
    { key: 'lemon', bg: '#FFF4C9', accent: '#D49B00' },
    { key: 'rose', bg: '#FFE2EC', accent: '#E64980' },
  ],
  dark: [
    { key: 'lavender', bg: '#25213D', accent: '#A597FF' },
    { key: 'peach', bg: '#35251E', accent: '#FF9A66' },
    { key: 'mint', bg: '#18302A', accent: '#3FD09A' },
    { key: 'sky', bg: '#1B2A3D', accent: '#5AA9FF' },
    { key: 'lemon', bg: '#332D19', accent: '#F2C230' },
    { key: 'rose', bg: '#36202D', accent: '#FF6FA3' },
  ],
};

// Colour keys (theme independent) — used by the data layer.
export const noteColors = noteColorSets.light;

export const fonts = {
  regular: 'PlusJakartaSans_400Regular',
  medium: 'PlusJakartaSans_500Medium',
  semibold: 'PlusJakartaSans_600SemiBold',
  bold: 'PlusJakartaSans_700Bold',
  extrabold: 'PlusJakartaSans_800ExtraBold',
};

export function makeTheme(dark) {
  const set = dark ? noteColorSets.dark : noteColorSets.light;
  return {
    dark,
    colors: dark ? palettes.dark : palettes.light,
    noteColors: set,
    getNoteColor: (key) => set.find((c) => c.key === key) || set[0],
  };
}

const ThemeContext = createContext(makeTheme(false));
export const ThemeProvider = ThemeContext.Provider;
export const useTheme = () => useContext(ThemeContext);

// Styles that depend on the theme: `factory(colors, theme)` is rebuilt only when the theme changes.
export function useStyles(factory) {
  const theme = useTheme();
  return useMemo(() => StyleSheet.create(factory(theme.colors, theme)), [theme, factory]);
}

export const shadowFor = (colors) => ({
  shadowColor: colors.shadow,
  shadowOffset: { width: 0, height: 8 },
  shadowOpacity: 0.12,
  shadowRadius: 16,
  elevation: 6,
});
