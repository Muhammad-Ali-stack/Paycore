/**
 * Design tokens for TypeScript consumers (charts, meta tags, Storybook docs).
 * The source of truth for values is src/styles/tokens.css; components reference
 * CSS variables, never raw colours. The only raw values here are the two
 * browser-chrome colours that must be literal (meta theme-color, manifest).
 */
export const cssVar = (name: string) => `var(--pc-${name})`;

export const color = {
  bg: cssVar('bg'),
  surface: cssVar('surface'),
  raised: cssVar('raised'),
  border: cssVar('border'),
  fg: cssVar('fg'),
  fgMuted: cssVar('fg-muted'),
  fgSubtle: cssVar('fg-subtle'),
  accent: cssVar('accent'),
  accentHover: cssVar('accent-hover'),
  accentTint: cssVar('accent-tint'),
  success: cssVar('success'),
  danger: cssVar('danger'),
  warning: cssVar('warning'),
  chartGrid: cssVar('chart-grid'),
} as const;

export const chartPalette = [1, 2, 3, 4, 5, 6].map((i) => cssVar(`chart-${i}`));

/** Literal colours for the browser chrome (cannot use CSS variables). Mirror tokens.css. */
export const chrome = {
  dark: '#0B0C0F',
  light: '#F7F4EE',
  accent: '#C8A26B',
} as const;

export const radius = { sm: 8, md: 12, lg: 16, xl: 20 } as const;

/** Token catalogue for Storybook's design-token page. */
export const tokenGroups = {
  Surfaces: ['bg', 'surface', 'raised', 'border', 'border-strong'],
  Text: ['fg', 'fg-muted', 'fg-subtle'],
  Accent: ['accent', 'accent-hover', 'accent-tint', 'accent-text'],
  Semantic: ['success', 'danger', 'warning', 'info'],
  Charts: ['chart-1', 'chart-2', 'chart-3', 'chart-4', 'chart-5', 'chart-6'],
} as const;
