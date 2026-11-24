import type {
  DownloadBackupArchiveResult,
  IBackupLogRepository,
  IBackupService,
  IBackupSnapshotProvider,
  IBackupStorage,
  ListBackupLogsResult,
  ParseBackupFileResult,
  RestoreBackupResult,
  RunBackupResult,
} from '../abstractions/backupService';
import type { IClock } from '../abstractions/IClock';
import type { ILogger } from '../abstractions/ILogger';
import type { AppUser } from '../domain/auth';
import type {
  BackupKind,
  BackupLog,
  BackupSnapshotCounts,
  BackupSnapshotFile,
  BackupStoredFileEntry,
} from '../domain/backup';
import { PermissionPolicyService } from './permissionPolicyService';

export const MAX_RETAINED_BACKUPS = 4;
export const BACKUP_FORMAT_VERSION = 1 as const;
export const BACKUP_APP_NAME = 'MerajAndisheh' as const;
export const RESTORE_SANDBOX_DB_NAME = 'MerajAndisheh_RestoreTestDB';

const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function timingSafeEqualStrings(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

function sha256Pure(messageBytes: Uint8Array): string {
  const K = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ]);

  const H = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);

  const bitLen = messageBytes.length * 8;
  const paddedLen = Math.ceil((messageBytes.length + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLen);
  padded.set(messageBytes);
  padded[messageBytes.length] = 0x80;

  const view = new DataView(padded.buffer);
  view.setUint32(paddedLen - 8, Math.floor(bitLen / 0x100000000), false);
  view.setUint32(paddedLen - 4, bitLen >>> 0, false);

  const w = new Uint32Array(64);
  for (let offset = 0; offset < paddedLen; offset += 64) {
    for (let i = 0; i < 16; i += 1) {
      w[i] = view.getUint32(offset + i * 4, false);
    }
    for (let i = 16; i < 64; i += 1) {
      const s0 =
        ((w[i - 15] >>> 7) | (w[i - 15] << 25)) ^
        ((w[i - 15] >>> 18) | (w[i - 15] << 14)) ^
        (w[i - 15] >>> 3);
      const s1 =
        ((w[i - 2] >>> 17) | (w[i - 2] << 15)) ^
        ((w[i - 2] >>> 19) | (w[i - 2] << 13)) ^
        (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }

    let [a, b, c, d, e, f, g, h] = H;
    for (let i = 0; i < 64; i += 1) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + K[i] + w[i]) >>> 0;
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) >>> 0;

      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    H[0] = (H[0] + a) >>> 0;
    H[1] = (H[1] + b) >>> 0;
    H[2] = (H[2] + c) >>> 0;
    H[3] = (H[3] + d) >>> 0;
    H[4] = (H[4] + e) >>> 0;
    H[5] = (H[5] + f) >>> 0;
    H[6] = (H[6] + g) >>> 0;
    H[7] = (H[7] + h) >>> 0;
  }

  return Array.from(H, (val) => val.toString(16).padStart(8, '0')).join('');
}

export async function computeSha256HexAsync(text: string): Promise<string> {
  const encoded = new TextEncoder().encode(text);
  if (typeof crypto !== 'undefined' && typeof crypto.subtle !== 'undefined') {
    const buffer = await crypto.subtle.digest('SHA-256', encoded);
    return bytesToHex(new Uint8Array(buffer));
  }
  return sha256Pure(encoded);
}

function buildArchiveFilePath(
  isoTimestamp: string,
  kind: BackupKind,
  existingPaths: ReadonlySet<string>,
): string {
  const date = new Date(isoTimestamp);
  const validDate = Number.isNaN(date.getTime()) ? new Date() : date;
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp = [
    validDate.getUTCFullYear(),
    pad(validDate.getUTCMonth() + 1),
    pad(validDate.getUTCDate()),
    '-',
    pad(validDate.getUTCHours()),
    pad(validDate.getUTCMinutes()),
    pad(validDate.getUTCSeconds()),
  ].join('');
  const suffix = kind === 'Manual' ? 'manual' : 'scheduled';
  const basePath = `backups/meraj-andisheh-${stamp}-${suffix}.bak`;
  if (!existingPaths.has(basePath)) {
    return basePath;
  }
  let counter = 2;
  while (counter < 1000) {
    const candidate = `backups/meraj-andisheh-${stamp}-${String(counter).padStart(2, '0')}-${suffix}.bak`;
    if (!existingPaths.has(candidate)) {
      return candidate;
    }
    counter += 1;
  }
  return `backups/meraj-andisheh-${stamp}-${Date.now()}-${suffix}.bak`;
}

function sanitizeTablesObject(rawTables: Record<string, unknown[]>): Record<string, unknown[]> {
  const clean: Record<string, unknown[]> = {};
  const sortedNames = Object.keys(rawTables).sort((a, b) => a.localeCompare(b));
  for (const name of sortedNames) {
    if (FORBIDDEN_KEYS.has(name)) {
      continue;
    }
    const rows = rawTables[name];
    clean[name] = Array.isArray(rows) ? rows : [];
  }
  return clean;
}

function computeSnapshotCounts(
  tables: Record<string, unknown[]>,
  storedFiles: readonly BackupStoredFileEntry[],
): BackupSnapshotCounts {
  const byTable: Record<string, number> = {};
  let totalRecords = 0;
  for (const [tableName, rows] of Object.entries(tables)) {
    byTable[tableName] = rows.length;
    totalRecords += rows.length;
  }
  return {
    tablesCount: Object.keys(tables).length,
    totalRecords,
    storedFilesCount: storedFiles.length,
    byTable,
  };
}

function buildCanonicalUnsignedPayload(snapshot: {
  formatVersion: number;
  appName: string;
  databaseVersion: number;
  createdAt: string;
  kind: BackupKind;
  tables: Record<string, unknown[]>;
  storedFiles: BackupStoredFileEntry[];
  counts: BackupSnapshotCounts;
}): string {
  return JSON.stringify({
    formatVersion: snapshot.formatVersion,
    appName: snapshot.appName,
    databaseVersion: snapshot.databaseVersion,
    createdAt: snapshot.createdAt,
    kind: snapshot.kind,
    tables: snapshot.tables,
    storedFiles: snapshot.storedFiles,
    counts: snapshot.counts,
  });
}

function sortLogsNewestFirst(logs: readonly BackupLog[]): BackupLog[] {
  return [...logs].sort((a, b) => {
    const timeCmp = b.startedAt.localeCompare(a.startedAt);
    if (timeCmp !== 0) {
      return timeCmp;
    }
    return b.id - a.id;
  });
}

export interface BackupServiceDependencies {
  backupLogRepository: IBackupLogRepository;
  backupStorage: IBackupStorage;
  snapshotProvider: IBackupSnapshotProvider;
  permissionPolicyService: PermissionPolicyService;
  clock: IClock;
  logger?: ILogger;
}

export class BackupService implements IBackupService {
  private readonly backupLogRepository: IBackupLogRepository;
  private readonly backupStorage: IBackupStorage;
  private readonly snapshotProvider: IBackupSnapshotProvider;
  private readonly policyService: PermissionPolicyService;
  private readonly clock: IClock;
  private readonly logger?: ILogger;
  private activeRunLock = false;

  constructor(deps: BackupServiceDependencies) {
    this.backupLogRepository = deps.backupLogRepository;
    this.backupStorage = deps.backupStorage;
    this.snapshotProvider = deps.snapshotProvider;
    this.policyService = deps.permissionPolicyService;
    this.clock = deps.clock;
    this.logger = deps.logger;
  }

  public async runBackupAsync(
    actorOrSystem: AppUser | null | 'SYSTEM',
    kind: BackupKind,
    options?: { routePath?: string },
  ): Promise<RunBackupResult> {
    const routePath = options?.routePath ?? '#/admin/backup';

    if (actorOrSystem === 'SYSTEM') {
      if (kind !== 'Scheduled') {
        return {
          ok: false,
          statusCode: 403,
          errorCode: 'FORBIDDEN',
        };
      }
    } else {
      const auth = await this.policyService.authorizePermission(
        actorOrSystem,
        'backup.manage',
        routePath,
      );
      if (!auth.allowed) {
        return {
          ok: false,
          statusCode: auth.statusCode === 404 ? 404 : 403,
          errorCode: auth.statusCode === 404 ? 'NOT_FOUND' : 'FORBIDDEN',
        };
      }
    }

    if (this.activeRunLock) {
      return {
        ok: false,
        statusCode: 500,
        errorCode: 'BACKUP_FAILED',
      };
    }

    this.activeRunLock = true;
    const startedAt = this.clock.nowUtcIso();
    let logRecord: BackupLog | null = null;

    try {
      const [existingLogs, existingArchivePaths] = await Promise.all([
        this.backupLogRepository.listBackupLogsAsync(),
        this.backupStorage.listArchivePathsAsync(),
      ]);
      const knownPaths = new Set<string>([
        ...existingLogs.map((l) => l.filePath),
        ...existingArchivePaths,
      ]);
      const filePath = buildArchiveFilePath(startedAt, kind, knownPaths);

      logRecord = await this.backupLogRepository.createBackupLogAsync({
        startedAt,
        finishedAt: null,
        kind,
        status: 'Running',
        filePath,
        sizeBytes: null,
        message: null,
        isRetained: false,
        checksumSha256: null,
      });

      const exported = await this.snapshotProvider.exportFullSnapshotAsync();
      const cleanTables = sanitizeTablesObject(exported.tables);
      const cleanFiles = Array.isArray(exported.storedFiles) ? exported.storedFiles : [];
      const counts = computeSnapshotCounts(cleanTables, cleanFiles);

      const unsignedPayload = buildCanonicalUnsignedPayload({
        formatVersion: BACKUP_FORMAT_VERSION,
        appName: BACKUP_APP_NAME,
        databaseVersion: exported.databaseVersion,
        createdAt: startedAt,
        kind,
        tables: cleanTables,
        storedFiles: cleanFiles,
        counts,
      });
      const checksumSha256 = await computeSha256HexAsync(unsignedPayload);

      const snapshot: BackupSnapshotFile = {
        formatVersion: BACKUP_FORMAT_VERSION,
        appName: BACKUP_APP_NAME,
        databaseVersion: exported.databaseVersion,
        createdAt: startedAt,
        kind,
        tables: cleanTables,
        storedFiles: cleanFiles,
        counts,
        checksumSha256,
      };

      const serialized = JSON.stringify(snapshot, null, 2);
      const saved = await this.backupStorage.saveArchiveAsync(filePath, serialized);
      const finishedAt = this.clock.nowUtcIso();

      const completedLog: BackupLog = {
        ...logRecord,
        finishedAt,
        status: 'Succeeded',
        sizeBytes: saved.sizeBytes,
        checksumSha256,
        isRetained: true,
        message: `tables=${counts.tablesCount};records=${counts.totalRecords};files=${counts.storedFilesCount}`,
      };
      await this.backupLogRepository.updateBackupLogAsync(completedLog);

      const prunedCount = await this.enforceRetentionPolicyAsync();

      this.logger?.info('BACKUP_SUCCEEDED', {
        backupLogId: completedLog.id,
        kind,
        filePath,
        sizeBytes: saved.sizeBytes,
        prunedCount,
      });

      return {
        ok: true,
        statusCode: 200,
        backupLog: completedLog,
        prunedCount,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      const finishedAt = this.clock.nowUtcIso();
      if (logRecord) {
        const failedLog: BackupLog = {
          ...logRecord,
          finishedAt,
          status: 'Failed',
          isRetained: false,
          message: errorMsg,
        };
        await this.backupLogRepository.updateBackupLogAsync(failedLog);
        logRecord = failedLog;
      }

      this.logger?.error('BACKUP_FAILED', {
        kind,
        error: errorMsg,
      });

      return {
        ok: false,
        statusCode: 500,
        backupLog: logRecord ?? undefined,
        errorCode: 'BACKUP_FAILED',
      };
    } finally {
      this.activeRunLock = false;
    }
  }

  private async enforceRetentionPolicyAsync(): Promise<number> {
    const allLogs = sortLogsNewestFirst(
      await this.backupLogRepository.listBackupLogsAsync(),
    );
    const retainedSucceeded = allLogs.filter(
      (log) => log.status === 'Succeeded' && log.isRetained,
    );

    const keepLogs = retainedSucceeded.slice(0, MAX_RETAINED_BACKUPS);
    const keepPaths = new Set<string>(keepLogs.map((l) => l.filePath));
    const logsToPrune = retainedSucceeded.slice(MAX_RETAINED_BACKUPS);

    let prunedCount = 0;
    for (const oldLog of logsToPrune) {
      await this.backupStorage.deleteArchiveAsync(oldLog.filePath);
      await this.backupLogRepository.updateBackupLogAsync({
        ...oldLog,
        isRetained: false,
        message: oldLog.message
          ? `${oldLog.message} | pruned`
          : 'pruned',
      });
      prunedCount += 1;

      this.logger?.info('BACKUP_RETENTION_PRUNED', {
        backupLogId: oldLog.id,
        filePath: oldLog.filePath,
      });
    }

    // Remove any stale orphaned archives not in the top 4 retained set
    const storedPaths = await this.backupStorage.listArchivePathsAsync();
    for (const storedPath of storedPaths) {
      if (!keepPaths.has(storedPath)) {
        await this.backupStorage.deleteArchiveAsync(storedPath);
      }
    }

    return prunedCount;
  }

  public async listBackupLogsAsync(
    actor: AppUser | null,
    routePath = '#/admin/backup',
  ): Promise<ListBackupLogsResult> {
    const auth = await this.policyService.authorizePermission(
      actor,
      'backup.manage',
      routePath,
    );
    if (!auth.allowed) {
      return {
        ok: false,
        statusCode: auth.statusCode === 404 ? 404 : 403,
        errorCode: auth.statusCode === 404 ? 'NOT_FOUND' : 'FORBIDDEN',
      };
    }

    const [rawLogs, retainedPaths] = await Promise.all([
      this.backupLogRepository.listBackupLogsAsync(),
      this.backupStorage.listArchivePathsAsync(),
    ]);
    return {
      ok: true,
      statusCode: 200,
      logs: sortLogsNewestFirst(rawLogs),
      retainedPaths,
    };
  }

  public async downloadBackupArchiveAsync(
    actor: AppUser | null,
    backupLogId: number,
    routePath = '#/admin/backup',
  ): Promise<DownloadBackupArchiveResult> {
    const auth = await this.policyService.authorizePermission(
      actor,
      'backup.manage',
      routePath,
    );
    if (!auth.allowed) {
      return {
        ok: false,
        statusCode: auth.statusCode === 404 ? 404 : 403,
        errorCode: auth.statusCode === 404 ? 'NOT_FOUND' : 'FORBIDDEN',
      };
    }

    const logEntry = await this.backupLogRepository.getBackupLogByIdAsync(backupLogId);
    if (!logEntry || !logEntry.isRetained) {
      return {
        ok: false,
        statusCode: 404,
        errorCode: 'ARCHIVE_NOT_FOUND',
      };
    }

    const payloadText = await this.backupStorage.readArchiveAsync(logEntry.filePath);
    if (payloadText === null) {
      return {
        ok: false,
        statusCode: 404,
        errorCode: 'ARCHIVE_NOT_FOUND',
      };
    }

    const segments = logEntry.filePath.split('/');
    const fileName = segments[segments.length - 1] || `backup-${logEntry.id}.bak`;

    return {
      ok: true,
      statusCode: 200,
      fileName,
      filePath: logEntry.filePath,
      payloadText,
    };
  }

  public async parseAndValidateBackupFileAsync(
    rawContent: string,
  ): Promise<ParseBackupFileResult> {
    if (typeof rawContent !== 'string' || rawContent.trim().length === 0) {
      return { ok: false, errorCode: 'BACKUP_CORRUPTED' };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(rawContent);
    } catch {
      return { ok: false, errorCode: 'BACKUP_CORRUPTED' };
    }

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { ok: false, errorCode: 'BACKUP_CORRUPTED' };
    }

    const obj = parsed as Record<string, unknown>;
    if (
      obj.formatVersion !== BACKUP_FORMAT_VERSION ||
      obj.appName !== BACKUP_APP_NAME ||
      typeof obj.databaseVersion !== 'number' ||
      !Number.isInteger(obj.databaseVersion) ||
      obj.databaseVersion < 1 ||
      typeof obj.createdAt !== 'string' ||
      obj.createdAt.trim().length === 0 ||
      (obj.kind !== 'Manual' && obj.kind !== 'Scheduled') ||
      !obj.tables ||
      typeof obj.tables !== 'object' ||
      Array.isArray(obj.tables) ||
      !Array.isArray(obj.storedFiles) ||
      !obj.counts ||
      typeof obj.counts !== 'object' ||
      Array.isArray(obj.counts) ||
      typeof obj.checksumSha256 !== 'string' ||
      !/^[a-f0-9]{64}$/i.test(obj.checksumSha256.trim())
    ) {
      return { ok: false, errorCode: 'BACKUP_CORRUPTED' };
    }

    const rawTables = obj.tables as Record<string, unknown>;
    const sanitizedTables: Record<string, unknown[]> = {};
    for (const key of Object.keys(rawTables)) {
      if (FORBIDDEN_KEYS.has(key) || !Array.isArray(rawTables[key])) {
        return { ok: false, errorCode: 'BACKUP_CORRUPTED' };
      }
      sanitizedTables[key] = rawTables[key] as unknown[];
    }

    const rawFiles = obj.storedFiles as unknown[];
    for (const fileEntry of rawFiles) {
      if (!fileEntry || typeof fileEntry !== 'object' || Array.isArray(fileEntry)) {
        return { ok: false, errorCode: 'BACKUP_CORRUPTED' };
      }
      const f = fileEntry as Record<string, unknown>;
      if (
        !f.metadata ||
        typeof f.metadata !== 'object' ||
        Array.isArray(f.metadata) ||
        typeof (f.metadata as Record<string, unknown>).storageKey !== 'string' ||
        typeof f.base64Data !== 'string'
      ) {
        return { ok: false, errorCode: 'BACKUP_CORRUPTED' };
      }
    }

    const countsObj = obj.counts as BackupSnapshotCounts;
    const expectedCanonical = buildCanonicalUnsignedPayload({
      formatVersion: obj.formatVersion,
      appName: obj.appName,
      databaseVersion: obj.databaseVersion,
      createdAt: obj.createdAt,
      kind: obj.kind,
      tables: rawTables as Record<string, unknown[]>,
      storedFiles: obj.storedFiles as BackupStoredFileEntry[],
      counts: countsObj,
    });

    const computedSha = await computeSha256HexAsync(expectedCanonical);
    if (!timingSafeEqualStrings(computedSha, obj.checksumSha256.trim().toLowerCase())) {
      return { ok: false, errorCode: 'BACKUP_CORRUPTED' };
    }

    const snapshot: BackupSnapshotFile = {
      formatVersion: BACKUP_FORMAT_VERSION,
      appName: BACKUP_APP_NAME,
      databaseVersion: obj.databaseVersion,
      createdAt: obj.createdAt,
      kind: obj.kind,
      tables: sanitizedTables,
      storedFiles: obj.storedFiles as BackupStoredFileEntry[],
      counts: countsObj,
      checksumSha256: obj.checksumSha256.trim().toLowerCase(),
    };

    return { ok: true, snapshot };
  }

  private async resolveSnapshotInputAsync(input: {
    backupLogId?: number;
    rawContent?: string;
  }): Promise<
    | { ok: true; snapshot: BackupSnapshotFile }
    | { ok: false; statusCode: 400 | 404; errorCode: 'ARCHIVE_NOT_FOUND' | 'BACKUP_CORRUPTED' }
  > {
    let rawPayload = input.rawContent;
    if (typeof rawPayload !== 'string' && typeof input.backupLogId === 'number') {
      const logEntry = await this.backupLogRepository.getBackupLogByIdAsync(input.backupLogId);
      if (!logEntry || !logEntry.isRetained) {
        return { ok: false, statusCode: 404, errorCode: 'ARCHIVE_NOT_FOUND' };
      }
      const archiveText = await this.backupStorage.readArchiveAsync(logEntry.filePath);
      if (archiveText === null) {
        return { ok: false, statusCode: 404, errorCode: 'ARCHIVE_NOT_FOUND' };
      }
      rawPayload = archiveText;
    }

    if (typeof rawPayload !== 'string') {
      return { ok: false, statusCode: 404, errorCode: 'ARCHIVE_NOT_FOUND' };
    }

    const parsed = await this.parseAndValidateBackupFileAsync(rawPayload);
    if (!parsed.ok || !parsed.snapshot) {
      return { ok: false, statusCode: 400, errorCode: 'BACKUP_CORRUPTED' };
    }

    return { ok: true, snapshot: parsed.snapshot };
  }

  public async testRestoreOnSandboxAsync(
    actor: AppUser | null,
    input: { backupLogId?: number; rawContent?: string },
    routePath = '#/admin/backup',
  ): Promise<RestoreBackupResult> {
    const auth = await this.policyService.authorizePermission(
      actor,
      'backup.manage',
      routePath,
    );
    if (!auth.allowed) {
      return {
        ok: false,
        statusCode: auth.statusCode === 404 ? 404 : 403,
        errorCode: auth.statusCode === 404 ? 'NOT_FOUND' : 'FORBIDDEN',
      };
    }

    const resolved = await this.resolveSnapshotInputAsync(input);
    if (!resolved.ok) {
      return {
        ok: false,
        statusCode: resolved.statusCode,
        errorCode: resolved.errorCode,
      };
    }

    try {
      const report = await this.snapshotProvider.restoreIntoSandboxDatabaseAsync(
        resolved.snapshot,
      );
      this.logger?.info('BACKUP_SANDBOX_RESTORE_VERIFIED', {
        actorId: actor?.id,
        ok: report.ok,
        targetDatabaseName: report.targetDatabaseName,
        restoredRecordsCount: report.restoredRecordsCount,
        restoredFilesCount: report.restoredFilesCount,
      });

      return {
        ok: report.ok,
        statusCode: report.ok ? 200 : 500,
        report,
        snapshot: resolved.snapshot,
        errorCode: report.ok ? undefined : 'RESTORE_FAILED',
      };
    } catch (error) {
      this.logger?.error('BACKUP_SANDBOX_RESTORE_FAILED', {
        actorId: actor?.id,
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        ok: false,
        statusCode: 500,
        errorCode: 'RESTORE_FAILED',
      };
    }
  }

  public async restoreFullDatabaseAsync(
    actor: AppUser | null,
    input: { backupLogId?: number; rawContent?: string; confirmed: boolean },
    routePath = '#/admin/backup',
  ): Promise<RestoreBackupResult> {
    const auth = await this.policyService.authorizePermission(
      actor,
      'backup.manage',
      routePath,
    );
    if (!auth.allowed) {
      return {
        ok: false,
        statusCode: auth.statusCode === 404 ? 404 : 403,
        errorCode: auth.statusCode === 404 ? 'NOT_FOUND' : 'FORBIDDEN',
      };
    }

    if (!input.confirmed) {
      return {
        ok: false,
        statusCode: 400,
        errorCode: 'CONFIRMATION_REQUIRED',
      };
    }

    const resolved = await this.resolveSnapshotInputAsync(input);
    if (!resolved.ok) {
      return {
        ok: false,
        statusCode: resolved.statusCode,
        errorCode: resolved.errorCode,
      };
    }

    try {
      const report = await this.snapshotProvider.restoreIntoPrimaryDatabaseAsync(
        resolved.snapshot,
      );
      this.logger?.warn('BACKUP_PRIMARY_RESTORE_EXECUTED', {
        actorId: actor?.id,
        ok: report.ok,
        restoredTablesCount: report.restoredTablesCount,
        restoredRecordsCount: report.restoredRecordsCount,
        restoredFilesCount: report.restoredFilesCount,
      });

      return {
        ok: report.ok,
        statusCode: report.ok ? 200 : 500,
        report,
        snapshot: resolved.snapshot,
        errorCode: report.ok ? undefined : 'RESTORE_FAILED',
      };
    } catch (error) {
      this.logger?.error('BACKUP_PRIMARY_RESTORE_FAILED', {
        actorId: actor?.id,
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        ok: false,
        statusCode: 500,
        errorCode: 'RESTORE_FAILED',
      };
    }
  }
}
