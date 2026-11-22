import type { LogEntry, LogLevel } from '../domain/LogEntry';

export interface ILogger {
  log(level: LogLevel, message: string, details?: Record<string, unknown>): LogEntry;
  debug(message: string, details?: Record<string, unknown>): LogEntry;
  info(message: string, details?: Record<string, unknown>): LogEntry;
  warn(message: string, details?: Record<string, unknown>): LogEntry;
  error(message: string, details?: Record<string, unknown>): LogEntry;
  getLogs(): LogEntry[];
  clearLogs(): void;
  formatLogsForExport(): string;
}
