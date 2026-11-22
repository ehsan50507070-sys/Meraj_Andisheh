import type { IVisitorIdStorage } from '../../core/abstractions/visitorStorage';
import {
  VISITOR_COOKIE_MAX_AGE_SECONDS,
  VISITOR_COOKIE_NAME,
} from '../../core/services/viewTrackerService';

const FALLBACK_STORAGE_KEY = 'ma_vid_fallback';

function generateVisitorGuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  const bytes = new Uint8Array(16);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }

  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function isValidVisitorGuid(value: string | null | undefined): boolean {
  if (!value) {
    return false;
  }
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.trim());
}

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
    // Ignore storage restriction
  }
}

export class BrowserVisitorIdStorage implements IVisitorIdStorage {
  public getOrCreateVisitorId(): string {
    const existingCookie = readCookieOnly(VISITOR_COOKIE_NAME);
    if (isValidVisitorGuid(existingCookie)) {
      return existingCookie!.trim();
    }

    const existingFallback = readFallbackStorage();
    const visitorId = isValidVisitorGuid(existingFallback)
      ? existingFallback!.trim()
      : generateVisitorGuid();

    if (typeof document !== 'undefined') {
      try {
        document.cookie = `${VISITOR_COOKIE_NAME}=${encodeURIComponent(visitorId)}; max-age=${VISITOR_COOKIE_MAX_AGE_SECONDS}; path=/; SameSite=Lax`;
      } catch {
        // Fallback below handles sandboxed cookie restrictions
      }
    }

    const verifiedCookie = readCookieOnly(VISITOR_COOKIE_NAME);
    if (verifiedCookie !== visitorId) {
      writeFallbackStorage(visitorId);
    }

    return visitorId;
  }
}
