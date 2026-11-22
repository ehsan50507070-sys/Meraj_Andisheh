import type { ISessionTokenStore } from '../../core/abstractions/authRepository';
import { envConfig } from '../config/envConfig';

export class LocalSessionTokenStore implements ISessionTokenStore {
  private readonly storageKey: string;
  private memoryToken: string | null = null;

  constructor(storageKey: string = envConfig.sessionStorageKey) {
    this.storageKey = storageKey;
  }

  public getRawToken(): string | null {
    if (typeof window === 'undefined' || !window.localStorage) {
      return this.memoryToken;
    }
    try {
      return window.localStorage.getItem(this.storageKey) ?? this.memoryToken;
    } catch {
      return this.memoryToken;
    }
  }

  public setRawToken(token: string): void {
    this.memoryToken = token;
    if (typeof window === 'undefined' || !window.localStorage) {
      return;
    }
    try {
      window.localStorage.setItem(this.storageKey, token);
    } catch {
      // Keep in-memory fallback
    }
  }

  public clearRawToken(): void {
    this.memoryToken = null;
    if (typeof window === 'undefined' || !window.localStorage) {
      return;
    }
    try {
      window.localStorage.removeItem(this.storageKey);
    } catch {
      // Ignore storage errors
    }
  }
}
