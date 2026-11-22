export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

export interface LogEntry {
  id: string;
  level: LogLevel;
  message: string;
  utcTimestamp: string;
  jalaliTimestamp: string;
  details?: Record<string, unknown>;
}
