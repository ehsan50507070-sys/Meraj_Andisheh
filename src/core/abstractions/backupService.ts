import type { AppUser } from '../domain/auth';
import type {
  BackupKind,
  BackupLog,
  BackupRestoreReport,
  BackupSnapshotFile,
  BackupStoredFileEntry,
} from '../domain/backup';

export interface IBackupLogRepository {
  createBackupLogAsync(entry: Omit<BackupLog, 'id'>): Promise<BackupLog>;
  updateBackupLogAsync(entry: BackupLog): Promise<void>;
  getBackupLogByIdAsync(id: number): Promise<BackupLog | null>;
  listBackupLogsAsync(): Promise<BackupLog[]>;
}

export interface IBackupStorage {
  saveArchiveAsync(filePath: string, payloadText: string): Promise<{ sizeBytes: number }>;
  readArchiveAsync(filePath: string): Promise<string | null>;
  deleteArchiveAsync(filePath: string): Promise<void>;
  listArchivePathsAsync(): Promise<string[]>;
}

export interface ExportedDatabaseSnapshot {
  databaseVersion: number;
  tables: Record<string, unknown[]>;
  storedFiles: BackupStoredFileEntry[];
}

export interface IBackupSnapshotProvider {
  exportFullSnapshotAsync(): Promise<ExportedDatabaseSnapshot>;
  restoreIntoSandboxDatabaseAsync(snapshot: BackupSnapshotFile): Promise<BackupRestoreReport>;
  restoreIntoPrimaryDatabaseAsync(snapshot: BackupSnapshotFile): Promise<BackupRestoreReport>;
}

export type BackupErrorCode =
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'BACKUP_FAILED'
  | 'ARCHIVE_NOT_FOUND'
  | 'BACKUP_CORRUPTED'
  | 'CONFIRMATION_REQUIRED'
  | 'RESTORE_FAILED';

export interface RunBackupResult {
  ok: boolean;
  statusCode: 200 | 403 | 404 | 500;
  backupLog?: BackupLog;
  prunedCount?: number;
  errorCode?: BackupErrorCode;
  messageKey?: string;
}

export interface ListBackupLogsResult {
  ok: boolean;
  statusCode: 200 | 403 | 404;
  logs?: BackupLog[];
  retainedPaths?: string[];
  errorCode?: BackupErrorCode;
}

export interface DownloadBackupArchiveResult {
  ok: boolean;
  statusCode: 200 | 403 | 404;
  fileName?: string;
  filePath?: string;
  payloadText?: string;
  errorCode?: BackupErrorCode;
}

export interface ParseBackupFileResult {
  ok: boolean;
  snapshot?: BackupSnapshotFile;
  errorCode?: 'BACKUP_CORRUPTED';
}

export interface RestoreBackupResult {
  ok: boolean;
  statusCode: 200 | 400 | 403 | 404 | 500;
  report?: BackupRestoreReport;
  snapshot?: BackupSnapshotFile;
  errorCode?: BackupErrorCode;
}

export interface IBackupService {
  runBackupAsync(
    actorOrSystem: AppUser | null | 'SYSTEM',
    kind: BackupKind,
    options?: { routePath?: string },
  ): Promise<RunBackupResult>;

  listBackupLogsAsync(
    actor: AppUser | null,
    routePath?: string,
  ): Promise<ListBackupLogsResult>;

  downloadBackupArchiveAsync(
    actor: AppUser | null,
    backupLogId: number,
    routePath?: string,
  ): Promise<DownloadBackupArchiveResult>;

  parseAndValidateBackupFileAsync(rawContent: string): Promise<ParseBackupFileResult>;

  testRestoreOnSandboxAsync(
    actor: AppUser | null,
    input: { backupLogId?: number; rawContent?: string },
    routePath?: string,
  ): Promise<RestoreBackupResult>;

  restoreFullDatabaseAsync(
    actor: AppUser | null,
    input: { backupLogId?: number; rawContent?: string; confirmed: boolean },
    routePath?: string,
  ): Promise<RestoreBackupResult>;
}
