export type ThemeKey = 'playful' | 'modern' | 'editorial';

export const THEME_KEYS: readonly ThemeKey[] = ['playful', 'modern', 'editorial'] as const;

export const DEFAULT_THEME_KEY: ThemeKey = 'editorial';

export interface ThemePalette {
  readonly bg: string;
  readonly surface: string;
  readonly surfaceAlt: string;
  readonly primary: string;
  readonly primaryButton: string;
  readonly onPrimary: string;
  readonly accent: string;
  readonly onAccent: string;
  readonly text: string;
  readonly muted: string;
  readonly border: string;
  readonly dangerBg: string;
  readonly onDanger: string;
  readonly infoBg: string;
  readonly infoText: string;
  readonly successBg: string;
  readonly successText: string;
  readonly warningBg: string;
  readonly warningText: string;
  readonly errorBg: string;
  readonly errorText: string;
}

export interface ThemeDefinition {
  readonly key: ThemeKey;
  readonly radiusCardPx: number;
  readonly fontScale: number;
  readonly isDark: boolean;
  readonly palette: ThemePalette;
}

export interface ContrastCheckItem {
  readonly id: string;
  readonly labelKey: string;
  readonly foreground: string;
  readonly background: string;
  readonly ratio: number;
  readonly passesAA: boolean;
}

export interface ThemeContrastReport {
  readonly theme: ThemeKey;
  readonly minimumRequired: number;
  readonly allPassed: boolean;
  readonly checks: readonly ContrastCheckItem[];
}

export const THEME_DEFINITIONS: Record<ThemeKey, ThemeDefinition> = {
  playful: {
    key: 'playful',
    radiusCardPx: 24,
    fontScale: 1.125,
    isDark: false,
    palette: {
      bg: '#FFF8EC',
      surface: '#FFFFFF',
      surfaceAlt: '#FFF2DA',
      primary: '#FF7A00',
      primaryButton: '#FF7A00',
      onPrimary: '#1A1A24',
      accent: '#1FB6FF',
      onAccent: '#1A1A24',
      text: '#2B2B3A',
      muted: '#5A5A6E',
      border: '#EADBC2',
      dangerBg: '#B91C1C',
      onDanger: '#FFFFFF',
      infoBg: '#E0F2FE',
      infoText: '#075985',
      successBg: '#DCFCE7',
      successText: '#166534',
      warningBg: '#FEF3C7',
      warningText: '#92400E',
      errorBg: '#FEE2E2',
      errorText: '#991B1B',
    },
  },
  modern: {
    key: 'modern',
    radiusCardPx: 14,
    fontScale: 1,
    isDark: true,
    palette: {
      bg: '#0F1226',
      surface: '#1A1F3D',
      surfaceAlt: '#23294F',
      primary: '#7C5CFF',
      primaryButton: '#6640F2',
      onPrimary: '#FFFFFF',
      accent: '#00E0B8',
      onAccent: '#0F1226',
      text: '#F2F4FF',
      muted: '#9AA3C7',
      border: '#2E355E',
      dangerBg: '#B91C1C',
      onDanger: '#FFFFFF',
      infoBg: '#132B4A',
      infoText: '#BAE6FD',
      successBg: '#0F3329',
      successText: '#A7F3D0',
      warningBg: '#3B2609',
      warningText: '#FDE68A',
      errorBg: '#3F141B',
      errorText: '#FECACA',
    },
  },
  editorial: {
    key: 'editorial',
    radiusCardPx: 8,
    fontScale: 1,
    isDark: false,
    palette: {
      bg: '#F8FAFC',
      surface: '#FFFFFF',
      surfaceAlt: '#F1F5F9',
      primary: '#14213D',
      primaryButton: '#14213D',
      onPrimary: '#FFFFFF',
      accent: '#10B981',
      onAccent: '#0F172A',
      text: '#1E293B',
      muted: '#475569',
      border: '#E2E8F0',
      dangerBg: '#B91C1C',
      onDanger: '#FFFFFF',
      infoBg: '#E0F2FE',
      infoText: '#075985',
      successBg: '#DCFCE7',
      successText: '#166534',
      warningBg: '#FEF3C7',
      warningText: '#92400E',
      errorBg: '#FEE2E2',
      errorText: '#991B1B',
    },
  },
};

export function isValidThemeKey(value: unknown): value is ThemeKey {
  return typeof value === 'string' && (THEME_KEYS as readonly string[]).includes(value);
}

export function resolveThemeKey(
  value: unknown,
  fallback: ThemeKey = DEFAULT_THEME_KEY,
): ThemeKey {
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (isValidThemeKey(normalized)) {
      return normalized;
    }
  }
  return fallback;
}

export function getThemeDefinition(theme: ThemeKey): ThemeDefinition {
  return THEME_DEFINITIONS[theme];
}

function parseHexChannel(hexPair: string): number {
  const value = Number.parseInt(hexPair, 16);
  if (Number.isNaN(value)) {
    throw new Error(`Invalid hex color channel: ${hexPair}`);
  }
  return value / 255;
}

function linearizeSrgbChannel(channel: number): number {
  return channel <= 0.03928 ? channel / 12.92 : Math.pow((channel + 0.055) / 1.055, 2.4);
}

export function parseHexColor(hex: string): { r: number; g: number; b: number } {
  const cleaned = hex.trim().replace(/^#/, '');
  const expanded =
    cleaned.length === 3
      ? cleaned
          .split('')
          .map((ch) => `${ch}${ch}`)
          .join('')
      : cleaned;

  if (!/^[0-9a-fA-F]{6}$/.test(expanded)) {
    throw new Error(`Invalid hex color format: ${hex}`);
  }

  return {
    r: parseHexChannel(expanded.slice(0, 2)),
    g: parseHexChannel(expanded.slice(2, 4)),
    b: parseHexChannel(expanded.slice(4, 6)),
  };
}

export function getRelativeLuminance(hex: string): number {
  const { r, g, b } = parseHexColor(hex);
  const rl = linearizeSrgbChannel(r);
  const gl = linearizeSrgbChannel(g);
  const bl = linearizeSrgbChannel(b);
  return 0.2126 * rl + 0.7152 * gl + 0.0722 * bl;
}

export function calculateContrastRatio(foregroundHex: string, backgroundHex: string): number {
  const l1 = getRelativeLuminance(foregroundHex);
  const l2 = getRelativeLuminance(backgroundHex);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  const ratio = (lighter + 0.05) / (darker + 0.05);
  return Math.round(ratio * 100) / 100;
}

export const WCAG_AA_NORMAL_TEXT_RATIO = 4.5;

export function evaluateThemeContrast(theme: ThemeKey): ThemeContrastReport {
  const { palette } = getThemeDefinition(theme);

  const pairs: Array<{
    id: string;
    labelKey: string;
    foreground: string;
    background: string;
  }> = [
    {
      id: 'text-on-bg',
      labelKey: 'dev.contrast.pair.textOnBg',
      foreground: palette.text,
      background: palette.bg,
    },
    {
      id: 'text-on-surface',
      labelKey: 'dev.contrast.pair.textOnSurface',
      foreground: palette.text,
      background: palette.surface,
    },
    {
      id: 'muted-on-bg',
      labelKey: 'dev.contrast.pair.mutedOnBg',
      foreground: palette.muted,
      background: palette.bg,
    },
    {
      id: 'muted-on-surface',
      labelKey: 'dev.contrast.pair.mutedOnSurface',
      foreground: palette.muted,
      background: palette.surface,
    },
    {
      id: 'on-primary-on-primary',
      labelKey: 'dev.contrast.pair.onPrimary',
      foreground: palette.onPrimary,
      background: palette.primaryButton,
    },
    {
      id: 'on-accent-on-accent',
      labelKey: 'dev.contrast.pair.onAccent',
      foreground: palette.onAccent,
      background: palette.accent,
    },
    {
      id: 'on-danger-on-danger',
      labelKey: 'dev.contrast.pair.onDanger',
      foreground: palette.onDanger,
      background: palette.dangerBg,
    },
    {
      id: 'info-alert',
      labelKey: 'dev.contrast.pair.infoAlert',
      foreground: palette.infoText,
      background: palette.infoBg,
    },
    {
      id: 'success-alert',
      labelKey: 'dev.contrast.pair.successAlert',
      foreground: palette.successText,
      background: palette.successBg,
    },
    {
      id: 'warning-alert',
      labelKey: 'dev.contrast.pair.warningAlert',
      foreground: palette.warningText,
      background: palette.warningBg,
    },
    {
      id: 'error-alert',
      labelKey: 'dev.contrast.pair.errorAlert',
      foreground: palette.errorText,
      background: palette.errorBg,
    },
  ];

  const checks: ContrastCheckItem[] = pairs.map((pair) => {
    const ratio = calculateContrastRatio(pair.foreground, pair.background);
    return {
      ...pair,
      ratio,
      passesAA: ratio >= WCAG_AA_NORMAL_TEXT_RATIO,
    };
  });

  return {
    theme,
    minimumRequired: WCAG_AA_NORMAL_TEXT_RATIO,
    allPassed: checks.every((item) => item.passesAA),
    checks,
  };
}
