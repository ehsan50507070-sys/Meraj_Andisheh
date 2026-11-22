import type { IClock } from '../../core/abstractions/IClock';
import type { ILogger } from '../../core/abstractions/ILogger';
import type { LogEntry, LogLevel } from '../../core/domain/LogEntry';
import { envConfig } from '../config/envConfig';

function generateLogId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `log_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

export class AppLogger implements ILogger {
  private readonly clock: IClock;
  private readonly storageKey: string;
  private readonly maxEntries: number;
  private memoryFallback: LogEntry[] = [];

  constructor(
    clock: IClock,
    storageKey: string = envConfig.logStorageKey,
    maxEntries: number = envConfig.maxStoredLogs,
  ) {
    this.clock = clock;
    this.storageKey = storageKey;
    this.maxEntries = maxEntries;
  }

  private readStorage(): LogEntry[] {
    if (typeof window === 'undefined' || !window.localStorage) {
      return [...this.memoryFallback];
    }

    try {
      const raw = window.localStorage.getItem(this.storageKey);
      if (!raw) {
        return [];
      }
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        return [];
      }
      return parsed.filter(
        (item): item is LogEntry =>
          typeof item === 'object' &&
          item !== null &&
          typeof (item as LogEntry).id === 'string' &&
          typeof (item as LogEntry).level === 'string' &&
          typeof (item as LogEntry).message === 'string' &&
          typeof (item as LogEntry).utcTimestamp === 'string' &&
          typeof (item as LogEntry).jalaliTimestamp === 'string',
      );
    } catch {
      return [...this.memoryFallback];
    }
  }

  private writeStorage(entries: LogEntry[]): void {
    const trimmed = entries.slice(0, this.maxEntries);
    this.memoryFallback = trimmed;

    if (typeof window === 'undefined' || !window.localStorage) {
      return;
    }

    try {
      window.localStorage.setItem(this.storageKey, JSON.stringify(trimmed));
    } catch {
      // Keep memory fallback if storage quota is exceeded or blocked
    }
  }

  public log(level: LogLevel, message: string, details?: Record<string, unknown>): LogEntry {
    const now = this.clock.now();
    const entry: LogEntry = {
      id: generateLogId(),
      level,
      message,
      utcTimestamp: now.toISOString(),
      jalaliTimestamp: this.clock.toJalali(now),
      details,
    };

    const existing = this.readStorage();
    this.writeStorage([entry, ...existing]);
    return entry;
  }

  public debug(message: string, details?: Record<string, unknown>): LogEntry {
    return this.log('DEBUG', message, details);
  }

  public info(message: string, details?: Record<string, unknown>): LogEntry {
    return this.log('INFO', message, details);
  }

  public warn(message: string, details?: Record<string, unknown>): LogEntry {
    return this.log('WARN', message, details);
  }

  public error(message: string, details?: Record<string, unknown>): LogEntry {
    return this.log('ERROR', message, details);
  }

  public getLogs(): LogEntry[] {
    return this.readStorage();
  }

  public clearLogs(): void {
    this.memoryFallback = [];
    if (typeof window !== 'undefined' && window.localStorage) {
      try {
        window.localStorage.removeItem(this.storageKey);
      } catch {
        // Ignore storage errors
      }
    }
  }

  public formatLogsForExport(): string {
    const logs = this.getLogs();
    if (logs.length === 0) {
      return '';
    }

    return logs
      .slice()
      .reverse()
      .map((entry) => {
        const detailsSegment =
          entry.details && Object.keys(entry.details).length > 0
            ? ` | details=${JSON.stringify(entry.details)}`
            : '';
        return `[${entry.utcTimestamp}] [${entry.jalaliTimestamp}] [${entry.level}] ${entry.message}${detailsSegment}`;
      })
      .join('\n');
  }
}
