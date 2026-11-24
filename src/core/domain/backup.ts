import type { StoredFileMetadata } from './storage';

export type BackupKind = 'Scheduled' | 'Manual';

export type BackupStatus = 'Running' | 'Succeeded' | 'Failed';

export interface BackupLog {
  id: number;
  startedAt: string;
  finishedAt: string | null;
  kind: BackupKind;
  status: BackupStatus;
  filePath: string;
  sizeBytes: number | null;
  message: string | null;
  isRetained: boolean;
  checksumSha256?: string | null;
}

export interface BackupStoredFileEntry {
  metadata: StoredFileMetadata;
  base64Data: string;
}

export interface BackupSnapshotCounts {
  tablesCount: number;
  totalRecords: number;
  storedFilesCount: number;
  byTable: Record<string, number>;
}

export interface BackupSnapshotFile {
  formatVersion: 1;
  appName: 'MerajAndisheh';
  databaseVersion: number;
  createdAt: string;
  kind: BackupKind;
  tables: Record<string, unknown[]>;
  storedFiles: BackupStoredFileEntry[];
  counts: BackupSnapshotCounts;
  checksumSha256: string;
}

export interface BackupRestoreReport {
  ok: boolean;
  targetDatabaseName: string;
  restoredTablesCount: number;
  restoredRecordsCount: number;
  restoredFilesCount: number;
  verifiedContentsCount: number;
  verifiedUsersCount: number;
  verifiedTopicsCount: number;
  durationMs: number;
  errors: string[];
}
