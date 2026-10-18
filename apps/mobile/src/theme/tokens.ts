/**
 * Design tokens — mirrors the web app's HSL palette (sky theme) so the
 * mobile app and the website share one brand. Colors are plain hex here
 * because React Native Stylesheets take hex, not `hsl()` strings.
 */
export const colors = {
  background: '#F2F8FC',
  card: '#FFFFFF',
  foreground: '#0A1620',
  mutedForeground: '#5A6B7A',
  primary: '#0077B3',
  primaryForeground: '#FFFFFF',
  secondary: '#E3EEF6',
  accent: '#CFE8F8',
  border: '#D5E4EE',
  success: '#16A34A',
  warning: '#D97706',
  destructive: '#DC2626',
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
} as const;

export const radii = {
  sm: 6,
  md: 10,
  lg: 16,
} as const;

export const type = {
  hero: { fontSize: 26, fontWeight: '700' as const },
  title: { fontSize: 20, fontWeight: '600' as const },
  body: { fontSize: 15, fontWeight: '400' as const },
  caption: { fontSize: 12, fontWeight: '400' as const },
  mono: { fontSize: 14, fontWeight: '500' as const },
} as const;
