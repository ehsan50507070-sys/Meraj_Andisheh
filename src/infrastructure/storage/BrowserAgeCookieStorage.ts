import type { IAgePreferenceStorage } from '../../core/abstractions/agePreferenceStorage';
import {
  AGE_COOKIE_MAX_AGE_SECONDS,
  AGE_COOKIE_NAME,
} from '../../core/services/ageContextService';

const FALLBACK_STORAGE_KEY = 'ma_age_fallback';

function readCookieOnly(name: string): string | null {
  if (typeof document === 'undefined' || typeof document.cookie !== 'string') {
    return null;
  }
  const cookies = document.cookie.split(';');
  const prefix = `${name}=`;
  for (const raw of cookies) {
    const trimmed = raw.trim();
    if (trimmed.startsWith(prefix)) {
      const rawValue = trimmed.slice(prefix.length).trim();
      if (!rawValue) {
        return null;
      }
      try {
        const decoded = decodeURIComponent(rawValue).trim();
        return decoded || null;
      } catch {
        return rawValue;
      }
    }
  }
  return null;
}

function readFallbackStorage(): string | null {
  if (typeof window === 'undefined' || !window.localStorage) {
    return null;
  }
  try {
    const val = window.localStorage.getItem(FALLBACK_STORAGE_KEY);
    return val && val.trim().length > 0 ? val.trim() : null;
  } catch {
    return null;
  }
}

function writeFallbackStorage(value: string): void {
  if (typeof window === 'undefined' || !window.localStorage) {
    return;
  }
  try {
    window.localStorage.setItem(FALLBACK_STORAGE_KEY, value);
  } catch {
    // Ignore storage quota or private mode restrictions
  }
}

function clearFallbackStorage(): void {
  if (typeof window === 'undefined' || !window.localStorage) {
    return;
  }
  try {
    window.localStorage.removeItem(FALLBACK_STORAGE_KEY);
  } catch {
    // Ignore
  }
}

export class BrowserAgeCookieStorage implements IAgePreferenceStorage {
  public getAgeKey(): string | null {
    const fromCookie = readCookieOnly(AGE_COOKIE_NAME);
    if (fromCookie) {
      return fromCookie;
    }
    return readFallbackStorage();
  }

  public setAgeKey(
    ageKey: string,
    maxAgeSeconds: number = AGE_COOKIE_MAX_AGE_SECONDS,
  ): void {
    const cleanKey = ageKey.trim();
    if (!cleanKey) {
      this.clearAgeKey();
      return;
    }

    const ttl =
      Number.isFinite(maxAgeSeconds) && maxAgeSeconds > 0
        ? Math.floor(maxAgeSeconds)
        : AGE_COOKIE_MAX_AGE_SECONDS;

    if (typeof document !== 'undefined') {
      try {
        document.cookie = `${AGE_COOKIE_NAME}=${encodeURIComponent(cleanKey)}; max-age=${ttl}; path=/; SameSite=Lax`;
      } catch {
        // Fallback below handles blocked document.cookie
      }
    }

    // Verify if cookie persisted; if blocked by sandboxed iframe / file://, persist to fallback key
    const verifiedCookie = readCookieOnly(AGE_COOKIE_NAME);
    if (verifiedCookie === cleanKey) {
      clearFallbackStorage();
    } else {
      writeFallbackStorage(cleanKey);
    }
  }

  public clearAgeKey(): void {
    if (typeof document !== 'undefined') {
      try {
        document.cookie = `${AGE_COOKIE_NAME}=; max-age=0; path=/; SameSite=Lax`;
      } catch {
        // Ignore
      }
    }
    clearFallbackStorage();
  }
}
