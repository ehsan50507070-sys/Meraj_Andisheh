import type { IAnnouncementDismissStorage } from '../../core/abstractions/announcementDismissStorage';

export const ANNOUNCEMENT_DISMISS_SESSION_KEY =
  'meraj_dismissed_announcements_session_v1';

export class BrowserSessionAnnouncementDismissStorage
  implements IAnnouncementDismissStorage
{
  private readonly storageKey: string;
  private memoryFallback: Set<number> = new Set<number>();

  constructor(storageKey: string = ANNOUNCEMENT_DISMISS_SESSION_KEY) {
    this.storageKey = storageKey;
  }

  private readSessionStorage(): number[] | null {
    if (typeof window === 'undefined' || !window.sessionStorage) {
      return null;
    }
    try {
      const raw = window.sessionStorage.getItem(this.storageKey);
      if (!raw) {
        return [];
      }
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        return [];
      }
      const normalized = parsed
        .map((item) => (typeof item === 'number' ? item : Number.NaN))
        .filter((id) => Number.isInteger(id) && id > 0);
      return Array.from(new Set<number>(normalized));
    } catch {
      return null;
    }
  }

  private writeSessionStorage(ids: readonly number[]): boolean {
    if (typeof window === 'undefined' || !window.sessionStorage) {
      return false;
    }
    try {
      window.sessionStorage.setItem(this.storageKey, JSON.stringify(ids));
      return true;
    } catch {
      return false;
    }
  }

  public getDismissedIds(): number[] {
    const stored = this.readSessionStorage();
    if (stored !== null) {
      this.memoryFallback = new Set<number>(stored);
      return stored;
    }
    return Array.from(this.memoryFallback);
  }

  public dismissAnnouncement(id: number): void {
    if (!Number.isInteger(id) || id <= 0) {
      return;
    }
    const current = new Set<number>(this.getDismissedIds());
    current.add(id);
    this.memoryFallback = current;
    this.writeSessionStorage(Array.from(current));
  }

  public isDismissed(id: number): boolean {
    if (!Number.isInteger(id) || id <= 0) {
      return false;
    }
    return this.getDismissedIds().includes(id);
  }

  public clearDismissed(): void {
    this.memoryFallback.clear();
    if (typeof window !== 'undefined' && window.sessionStorage) {
      try {
        window.sessionStorage.removeItem(this.storageKey);
      } catch {
        // Ignore private browsing or storage errors
      }
    }
  }
}
