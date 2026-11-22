import { useEffect, useState } from 'react';
import {
  DEFAULT_THEME_KEY,
  isValidThemeKey,
  resolveThemeKey,
  type ThemeKey,
} from '../../core/services/themeService';
import { envConfig } from '../../infrastructure/config/envConfig';

type ThemeChangeListener = (theme: ThemeKey) => void;

class ThemeManagerService {
  private currentTheme: ThemeKey = DEFAULT_THEME_KEY;
  private readonly listeners = new Set<ThemeChangeListener>();

  public initialize(): ThemeKey {
    const queryTheme = this.readThemeFromHashQuery();
    const storedTheme = this.readStoredTheme();
    const initial = queryTheme ?? storedTheme ?? DEFAULT_THEME_KEY;

    this.applyTheme(initial, false);
    return initial;
  }

  public getTheme(): ThemeKey {
    return this.currentTheme;
  }

  public readThemeFromHashQuery(): ThemeKey | null {
    if (typeof window === 'undefined') {
      return null;
    }
    const rawHash = window.location.hash;
    const queryIndex = rawHash.indexOf('?');
    if (queryIndex === -1) {
      return null;
    }
    const queryString = rawHash.slice(queryIndex + 1);
    const params = new URLSearchParams(queryString);
    const candidate = params.get('theme');
    return isValidThemeKey(candidate) ? candidate : null;
  }

  private readStoredTheme(): ThemeKey | null {
    if (typeof window === 'undefined' || !window.localStorage) {
      return null;
    }
    try {
      const saved = window.localStorage.getItem(envConfig.themeStorageKey);
      return isValidThemeKey(saved) ? saved : null;
    } catch {
      return null;
    }
  }

  private writeStoredTheme(theme: ThemeKey): void {
    if (typeof window === 'undefined' || !window.localStorage) {
      return;
    }
    try {
      window.localStorage.setItem(envConfig.themeStorageKey, theme);
    } catch {
      // Ignore storage quota / privacy errors
    }
  }

  public setTheme(nextTheme: ThemeKey | string, syncHashQuery = false): ThemeKey {
    const resolved = resolveThemeKey(nextTheme, this.currentTheme);
    this.applyTheme(resolved, syncHashQuery);
    return resolved;
  }

  public syncFromCurrentHash(): ThemeKey | null {
    const fromHash = this.readThemeFromHashQuery();
    if (fromHash && fromHash !== this.currentTheme) {
      this.applyTheme(fromHash, false);
    }
    return fromHash;
  }

  private applyTheme(theme: ThemeKey, syncHashQuery: boolean): void {
    this.currentTheme = theme;

    if (typeof document !== 'undefined') {
      document.documentElement.setAttribute('data-theme', theme);
    }

    this.writeStoredTheme(theme);

    if (syncHashQuery && typeof window !== 'undefined') {
      const rawHash = window.location.hash || envConfig.defaultHashRoute;
      const [basePath, rawQuery = ''] = rawHash.split('?');
      const params = new URLSearchParams(rawQuery);
      params.set('theme', theme);
      const nextHash = `${basePath}?${params.toString()}`;
      if (window.location.hash !== nextHash) {
        window.history.replaceState(null, '', nextHash);
      }
    }

    this.listeners.forEach((listener) => listener(theme));
  }

  public subscribe(listener: ThemeChangeListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}

export const ThemeManager = new ThemeManagerService();

export function useTheme(): {
  theme: ThemeKey;
  setTheme: (nextTheme: ThemeKey, syncHashQuery?: boolean) => void;
} {
  const [theme, setThemeState] = useState<ThemeKey>(() => ThemeManager.getTheme());

  useEffect(() => {
    setThemeState(ThemeManager.getTheme());
    return ThemeManager.subscribe((updated) => {
      setThemeState(updated);
    });
  }, []);

  return {
    theme,
    setTheme: (nextTheme: ThemeKey, syncHashQuery = false) => {
      ThemeManager.setTheme(nextTheme, syncHashQuery);
    },
  };
}
