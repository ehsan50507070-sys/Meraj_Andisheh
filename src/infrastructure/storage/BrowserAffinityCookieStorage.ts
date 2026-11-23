import {
  GUEST_AFFINITY_COOKIE_MAX_AGE_SECONDS,
  GUEST_AFFINITY_COOKIE_NAME,
  GUEST_AFFINITY_MAX_TOPICS,
  GUEST_PERSONALIZATION_COOKIE_NAME,
  type IGuestAffinityStorage,
} from '../../core/abstractions/affinityStorage';
import type { GuestTopicAffinityEntry } from '../../core/domain/personalization';

const AFFINITY_FALLBACK_STORAGE_KEY = 'ma_aff_fallback';
const PERS_ENABLED_FALLBACK_STORAGE_KEY = 'ma_pers_on_fallback';

export interface CookieTransportAdapter {
  getCookieString: () => string;
  setCookieString: (cookieValue: string) => void;
  storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null;
}

function createDefaultTransport(): CookieTransportAdapter {
  return {
    getCookieString: () =>
      typeof document !== 'undefined' && typeof document.cookie === 'string'
        ? document.cookie
        : '',
    setCookieString: (cookieValue: string) => {
      if (typeof document !== 'undefined') {
        document.cookie = cookieValue;
      }
    },
    storage:
      typeof window !== 'undefined' && window.localStorage
        ? window.localStorage
        : null,
  };
}

function readCookieRaw(transport: CookieTransportAdapter, name: string): string | null {
  let rawCookieHeader = '';
  try {
    rawCookieHeader = transport.getCookieString() ?? '';
  } catch {
    return null;
  }
  if (!rawCookieHeader) {
    return null;
  }
  const cookies = rawCookieHeader.split(';');
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

function readFallback(transport: CookieTransportAdapter, key: string): string | null {
  if (!transport.storage) {
    return null;
  }
  try {
    const val = transport.storage.getItem(key);
    return val && val.trim().length > 0 ? val.trim() : null;
  } catch {
    return null;
  }
}

function writeFallback(
  transport: CookieTransportAdapter,
  key: string,
  value: string,
): void {
  if (!transport.storage) {
    return;
  }
  try {
    transport.storage.setItem(key, value);
  } catch {
    // Ignore storage quota or private mode restrictions
  }
}

function clearFallback(transport: CookieTransportAdapter, key: string): void {
  if (!transport.storage) {
    return;
  }
  try {
    transport.storage.removeItem(key);
  } catch {
    // Ignore
  }
}

function writeCookieWithFallback(
  transport: CookieTransportAdapter,
  cookieName: string,
  fallbackKey: string,
  value: string,
  maxAgeSeconds: number,
): void {
  const ttl =
    Number.isFinite(maxAgeSeconds) && maxAgeSeconds > 0
      ? Math.floor(maxAgeSeconds)
      : GUEST_AFFINITY_COOKIE_MAX_AGE_SECONDS;

  try {
    transport.setCookieString(
      `${cookieName}=${encodeURIComponent(value)}; max-age=${ttl}; path=/; SameSite=Lax`,
    );
  } catch {
    // Handled via localStorage fallback below
  }

  const verifiedCookie = readCookieRaw(transport, cookieName);
  if (verifiedCookie === value) {
    clearFallback(transport, fallbackKey);
  } else {
    writeFallback(transport, fallbackKey, value);
  }
}

function clearCookieWithFallback(
  transport: CookieTransportAdapter,
  cookieName: string,
  fallbackKey: string,
): void {
  try {
    transport.setCookieString(`${cookieName}=; max-age=0; path=/; SameSite=Lax`);
  } catch {
    // Ignore
  }
  clearFallback(transport, fallbackKey);
}

function sanitizeAffinityEntries(
  entries: readonly GuestTopicAffinityEntry[],
): GuestTopicAffinityEntry[] {
  const deduped = new Map<number, GuestTopicAffinityEntry>();

  for (const item of entries) {
    if (
      !item ||
      typeof item.rootTopicId !== 'number' ||
      !Number.isInteger(item.rootTopicId) ||
      item.rootTopicId <= 0 ||
      typeof item.viewCount !== 'number' ||
      !Number.isFinite(item.viewCount) ||
      item.viewCount <= 0 ||
      typeof item.lastViewedAt !== 'string' ||
      item.lastViewedAt.trim().length === 0
    ) {
      continue;
    }

    const existing = deduped.get(item.rootTopicId);
    const cleanViewCount = Math.floor(item.viewCount);
    const cleanLastViewedAt = item.lastViewedAt.trim();
    if (!existing) {
      deduped.set(item.rootTopicId, {
        rootTopicId: item.rootTopicId,
        viewCount: cleanViewCount,
        lastViewedAt: cleanLastViewedAt,
      });
    } else {
      const latestAt =
        cleanLastViewedAt > existing.lastViewedAt
          ? cleanLastViewedAt
          : existing.lastViewedAt;
      deduped.set(item.rootTopicId, {
        rootTopicId: item.rootTopicId,
        viewCount: existing.viewCount + cleanViewCount,
        lastViewedAt: latestAt,
      });
    }
  }

  return Array.from(deduped.values())
    .sort(
      (a, b) =>
        b.viewCount - a.viewCount ||
        b.lastViewedAt.localeCompare(a.lastViewedAt) ||
        a.rootTopicId - b.rootTopicId,
    )
    .slice(0, GUEST_AFFINITY_MAX_TOPICS);
}

function parseCookieJson(raw: string | null): GuestTopicAffinityEntry[] {
  if (!raw) {
    return [];
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return [];
    }
    const entries: GuestTopicAffinityEntry[] = [];
    for (const [key, val] of Object.entries(parsed as Record<string, unknown>)) {
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
        continue;
      }
      const rootTopicId = Number(key);
      if (!Number.isInteger(rootTopicId) || rootTopicId <= 0) {
        continue;
      }
      if (!val || typeof val !== 'object' || Array.isArray(val)) {
        continue;
      }
      const record = val as Record<string, unknown>;
      const viewCount =
        typeof record.viewCount === 'number'
          ? record.viewCount
          : typeof record.c === 'number'
            ? record.c
            : 0;
      const lastViewedAt =
        typeof record.lastViewedAt === 'string'
          ? record.lastViewedAt
          : typeof record.at === 'string'
            ? record.at
            : '';
      if (viewCount > 0 && lastViewedAt) {
        entries.push({ rootTopicId, viewCount, lastViewedAt });
      }
    }
    return sanitizeAffinityEntries(entries);
  } catch {
    return [];
  }
}

export class BrowserAffinityCookieStorage implements IGuestAffinityStorage {
  private readonly transport: CookieTransportAdapter;

  constructor(transport?: Partial<CookieTransportAdapter>) {
    const defaults = createDefaultTransport();
    if (!transport) {
      this.transport = defaults;
    } else {
      this.transport = {
        getCookieString: transport.getCookieString ?? defaults.getCookieString,
        setCookieString: transport.setCookieString ?? defaults.setCookieString,
        storage: transport.storage === undefined ? null : transport.storage,
      };
    }
  }

  public getGuestAffinities(): GuestTopicAffinityEntry[] {
    const fromCookie = readCookieRaw(this.transport, GUEST_AFFINITY_COOKIE_NAME);
    if (fromCookie) {
      return parseCookieJson(fromCookie);
    }
    const fromFallback = readFallback(this.transport, AFFINITY_FALLBACK_STORAGE_KEY);
    return parseCookieJson(fromFallback);
  }

  public setGuestAffinities(
    entries: readonly GuestTopicAffinityEntry[],
    maxAgeSeconds: number = GUEST_AFFINITY_COOKIE_MAX_AGE_SECONDS,
  ): void {
    const normalized = sanitizeAffinityEntries(entries);
    if (normalized.length === 0) {
      this.clearGuestAffinities();
      return;
    }

    const serializedMap: Record<string, { c: number; at: string }> = {};
    for (const entry of normalized) {
      serializedMap[String(entry.rootTopicId)] = {
        c: entry.viewCount,
        at: entry.lastViewedAt,
      };
    }

    writeCookieWithFallback(
      this.transport,
      GUEST_AFFINITY_COOKIE_NAME,
      AFFINITY_FALLBACK_STORAGE_KEY,
      JSON.stringify(serializedMap),
      maxAgeSeconds,
    );
  }

  public clearGuestAffinities(): void {
    clearCookieWithFallback(
      this.transport,
      GUEST_AFFINITY_COOKIE_NAME,
      AFFINITY_FALLBACK_STORAGE_KEY,
    );
  }

  public getGuestPersonalizationEnabled(): boolean {
    const raw =
      readCookieRaw(this.transport, GUEST_PERSONALIZATION_COOKIE_NAME) ??
      readFallback(this.transport, PERS_ENABLED_FALLBACK_STORAGE_KEY);
    if (raw === '0' || raw === 'false') {
      return false;
    }
    return true;
  }

  public setGuestPersonalizationEnabled(
    enabled: boolean,
    maxAgeSeconds: number = GUEST_AFFINITY_COOKIE_MAX_AGE_SECONDS,
  ): void {
    writeCookieWithFallback(
      this.transport,
      GUEST_PERSONALIZATION_COOKIE_NAME,
      PERS_ENABLED_FALLBACK_STORAGE_KEY,
      enabled ? '1' : '0',
      maxAgeSeconds,
    );
  }

  public clearGuestPersonalizationPreference(): void {
    clearCookieWithFallback(
      this.transport,
      GUEST_PERSONALIZATION_COOKIE_NAME,
      PERS_ENABLED_FALLBACK_STORAGE_KEY,
    );
  }
}
