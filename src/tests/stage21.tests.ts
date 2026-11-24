import type { IClock } from '../core/abstractions/IClock';
import type { IAdminRepository } from '../core/abstractions/adminRepository';
import type {
  ExportedDatabaseSnapshot,
  IBackupLogRepository,
  IBackupSnapshotProvider,
  IBackupStorage,
} from '../core/abstractions/backupService';
import type { AppUser } from '../core/domain/auth';
import type {
  BackupLog,
  BackupRestoreReport,
  BackupSnapshotFile,
  BackupStoredFileEntry,
} from '../core/domain/backup';
import { ContentStatus } from '../core/domain/content';
import type { StaffPermission } from '../core/domain/permissions';
import type { FeatureFlag, SiteSetting } from '../core/domain/settings';
import type { AgeGroup } from '../core/domain/taxonomy';
import {
  BackupService,
  MAX_RETAINED_BACKUPS,
  RESTORE_SANDBOX_DB_NAME,
} from '../core/services/backupService';
import { PermissionPolicyService } from '../core/services/permissionPolicyService';
import { SystemClock } from '../infrastructure/clock/SystemClock';
import { envConfig } from '../infrastructure/config/envConfig';
import { IndexedDbBackupRepository } from '../infrastructure/data/IndexedDbBackupRepository';
import { IndexedDbBackupSnapshotProvider } from '../infrastructure/data/IndexedDbBackupSnapshotProvider';
import { IndexedDbDataStore } from '../infrastructure/data/IndexedDbDataStore';
import {
  DATABASE_MIGRATIONS,
  STAGE21_OBJECT_STORES,
  STORE_NAMES,
} from '../infrastructure/data/migrations';
import { BackupScheduler } from '../infrastructure/jobs/BackupScheduler';
import { AppLogger } from '../infrastructure/logging/AppLogger';
import { LocalIndexedDbFileStorage } from '../infrastructure/storage/LocalIndexedDbFileStorage';
import { assert, assertEqual, type UnitTestCase } from './testRunner';

class Stage21FakeClock implements IClock {
  private currentMs: number;
  private readonly inner = new SystemClock();

  constructor(initialIso = '2026-11-23T12:00:00.000Z') {
    this.currentMs = Date.parse(initialIso);
  }

  public advanceMs(ms: number): void {
    this.currentMs += ms;
  }

  public now(): Date {
    return new Date(this.currentMs);
  }

  public nowUtcIso(): string {
    return new Date(this.currentMs).toISOString();
  }

  public nowJalali(): string {
    return this.inner.toJalali(this.now());
  }

  public toJalali(date: Date): string {
    return this.inner.toJalali(date);
  }
}

class MemoryAdminRepository implements IAdminRepository {
  public users: AppUser[] = [];
  public permissions: StaffPermission[] = [];
  public settings: SiteSetting[] = [];
  public flags: FeatureFlag[] = [];
  public ageGroups: AgeGroup[] = [];

  public async getUserById(id: number): Promise<AppUser | null> {
    return this.users.find((u) => u.id === id) ?? null;
  }

  public async getUserByNormalizedEmail(normalizedEmail: string): Promise<AppUser | null> {
    return this.users.find((u) => u.normalizedEmail === normalizedEmail) ?? null;
  }

  public async getUserByNormalizedPhoneNumber(
    normalizedPhoneNumber: string,
  ): Promise<AppUser | null> {
    return (
      this.users.find((u) => u.normalizedPhoneNumber === normalizedPhoneNumber) ??
      null
    );
  }

  public async getAllUsers(): Promise<AppUser[]> {
    return [...this.users];
  }

  public async createUser(user: Omit<AppUser, 'id'>): Promise<AppUser> {
    const nextId = this.users.reduce((max, u) => Math.max(max, u.id), 0) + 1;
    const created: AppUser = { ...user, id: nextId };
    this.users.push(created);
    return created;
  }

  public async updateUser(user: AppUser): Promise<void> {
    const idx = this.users.findIndex((u) => u.id === user.id);
    if (idx === -1) {
      this.users.push({ ...user });
    } else {
      this.users[idx] = { ...user };
    }
  }

  public async deleteSessionsByUserId(_userId: number): Promise<void> {
    // No-op in memory mock
  }

  public async getStaffPermissionsByUserId(userId: number): Promise<StaffPermission[]> {
    return this.permissions.filter((p) => p.userId === userId);
  }

  public async replaceStaffPermissions(
    userId: number,
    permissions: Omit<StaffPermission, 'id'>[],
  ): Promise<StaffPermission[]> {
    const created: StaffPermission[] = permissions.map((p, idx) => ({
      ...p,
      id: idx + 1,
      userId,
    }));
    this.permissions = [
      ...this.permissions.filter((p) => p.userId !== userId),
      ...created,
    ];
    return created;
  }

  public async getAllFeatureFlags(): Promise<FeatureFlag[]> {
    return [...this.flags];
  }

  public async upsertFeatureFlag(flag: FeatureFlag): Promise<void> {
    const idx = this.flags.findIndex((f) => f.key === flag.key);
    if (idx === -1) {
      this.flags.push({ ...flag });
    } else {
      this.flags[idx] = { ...flag };
    }
  }

  public async getAllSiteSettings(): Promise<SiteSetting[]> {
    return [...this.settings];
  }

  public async getSiteSettingByKey(key: string): Promise<SiteSetting | null> {
    return this.settings.find((s) => s.key === key) ?? null;
  }

  public async upsertSiteSettings(settings: SiteSetting[]): Promise<void> {
    for (const setting of settings) {
      const idx = this.settings.findIndex((s) => s.key === setting.key);
      if (idx === -1) {
        this.settings.push({ ...setting });
      } else {
        this.settings[idx] = { ...setting };
      }
    }
  }

  public async getActiveAgeGroups(): Promise<AgeGroup[]> {
    return [...this.ageGroups];
  }
}

class MemoryBackupStore implements IBackupLogRepository, IBackupStorage {
  public logs: BackupLog[] = [];
  public archives = new Map<string, { payloadText: string; sizeBytes: number }>();
  private nextId = 1;

  public async createBackupLogAsync(
    entry: Omit<BackupLog, 'id'>,
  ): Promise<BackupLog> {
    const created: BackupLog = { ...entry, id: this.nextId++ };
    this.logs.push(created);
    return { ...created };
  }

  public async updateBackupLogAsync(entry: BackupLog): Promise<void> {
    const idx = this.logs.findIndex((l) => l.id === entry.id);
    if (idx !== -1) {
      this.logs[idx] = { ...entry };
    }
  }

  public async getBackupLogByIdAsync(id: number): Promise<BackupLog | null> {
    const found = this.logs.find((l) => l.id === id);
    return found ? { ...found } : null;
  }

  public async listBackupLogsAsync(): Promise<BackupLog[]> {
    return this.logs.map((l) => ({ ...l }));
  }

  public async saveArchiveAsync(
    filePath: string,
    payloadText: string,
  ): Promise<{ sizeBytes: number }> {
    const sizeBytes = new TextEncoder().encode(payloadText).byteLength;
    this.archives.set(filePath, { payloadText, sizeBytes });
    return { sizeBytes };
  }

  public async readArchiveAsync(filePath: string): Promise<string | null> {
    return this.archives.get(filePath)?.payloadText ?? null;
  }

  public async deleteArchiveAsync(filePath: string): Promise<void> {
    this.archives.delete(filePath);
  }

  public async listArchivePathsAsync(): Promise<string[]> {
    return Array.from(this.archives.keys());
  }
}

class MemorySnapshotProvider implements IBackupSnapshotProvider {
  public databaseVersion: number = envConfig.databaseVersion;
  public tables: Record<string, unknown[]> = {
    [STORE_NAMES.CONTENT_ITEMS]: [],
    [STORE_NAMES.USERS]: [],
    [STORE_NAMES.TOPICS]: [],
  };
  public storedFiles: BackupStoredFileEntry[] = [];
  public lastSandboxSnapshot: BackupSnapshotFile | null = null;

  public async exportFullSnapshotAsync(): Promise<ExportedDatabaseSnapshot> {
    return {
      databaseVersion: this.databaseVersion,
      tables: JSON.parse(JSON.stringify(this.tables)) as Record<string, unknown[]>,
      storedFiles: JSON.parse(
        JSON.stringify(this.storedFiles),
      ) as BackupStoredFileEntry[],
    };
  }

  public async restoreIntoSandboxDatabaseAsync(
    snapshot: BackupSnapshotFile,
  ): Promise<BackupRestoreReport> {
    // Deep-clone into sandbox state without mutating primary tables or storedFiles
    const sandboxTables = JSON.parse(
      JSON.stringify(snapshot.tables),
    ) as Record<string, unknown[]>;
    const sandboxFiles = JSON.parse(
      JSON.stringify(snapshot.storedFiles),
    ) as BackupStoredFileEntry[];
    this.lastSandboxSnapshot = {
      ...snapshot,
      tables: sandboxTables,
      storedFiles: sandboxFiles,
    };

    const recordsCount = Object.values(sandboxTables).reduce(
      (sum, rows) => sum + rows.length,
      0,
    );

    return {
      ok: true,
      targetDatabaseName: RESTORE_SANDBOX_DB_NAME,
      restoredTablesCount: Object.keys(sandboxTables).length,
      restoredRecordsCount: recordsCount,
      restoredFilesCount: sandboxFiles.length,
      verifiedContentsCount: (sandboxTables[STORE_NAMES.CONTENT_ITEMS] ?? []).length,
      verifiedUsersCount: (sandboxTables[STORE_NAMES.USERS] ?? []).length,
      verifiedTopicsCount: (sandboxTables[STORE_NAMES.TOPICS] ?? []).length,
      durationMs: 1,
      errors: [],
    };
  }

  public async restoreIntoPrimaryDatabaseAsync(
    snapshot: BackupSnapshotFile,
  ): Promise<BackupRestoreReport> {
    this.tables = JSON.parse(
      JSON.stringify(snapshot.tables),
    ) as Record<string, unknown[]>;
    this.storedFiles = JSON.parse(
      JSON.stringify(snapshot.storedFiles),
    ) as BackupStoredFileEntry[];

    const recordsCount = Object.values(this.tables).reduce(
      (sum, rows) => sum + rows.length,
      0,
    );

    return {
      ok: true,
      targetDatabaseName: envConfig.databaseName,
      restoredTablesCount: Object.keys(this.tables).length,
      restoredRecordsCount: recordsCount,
      restoredFilesCount: this.storedFiles.length,
      verifiedContentsCount: (this.tables[STORE_NAMES.CONTENT_ITEMS] ?? []).length,
      verifiedUsersCount: (this.tables[STORE_NAMES.USERS] ?? []).length,
      verifiedTopicsCount: (this.tables[STORE_NAMES.TOPICS] ?? []).length,
      durationMs: 1,
      errors: [],
    };
  }
}

function makeTestUser(
  id: number,
  role: AppUser['role'],
  email: string,
): AppUser {
  return {
    id,
    email,
    normalizedEmail: email.toLowerCase(),
    emailConfirmed: true,
    phoneNumber: null,
    normalizedPhoneNumber: null,
    phoneNumberConfirmed: false,
    passwordHash: null,
    passwordSalt: null,
    displayName: email.split('@')[0],
    role,
    ageGroupId: 2,
    isActive: true,
    mustChangePassword: false,
    personalizationEnabled: true,
    failedLoginCount: 0,
    lockoutEnd: null,
    createdAt: '2026-11-01T00:00:00.000Z',
    lastLoginAt: '2026-11-23T08:00:00.000Z',
  };
}

function buildHarness() {
  const clock = new Stage21FakeClock();
  const logger = new AppLogger(clock, 'stage21_test_logs_unused', 50);
  logger.clearLogs();
  const adminRepo = new MemoryAdminRepository();
  const superAdmin = makeTestUser(1, 'SuperAdmin', 'admin@example.com');
  const staffWithBackup = makeTestUser(2, 'Staff', 'backup-staff@example.com');
  const staffWithoutBackup = makeTestUser(3, 'Staff', 'editor@example.com');
  const memberUser = makeTestUser(4, 'Member', 'member@example.com');
  adminRepo.users.push(
    superAdmin,
    staffWithBackup,
    staffWithoutBackup,
    memberUser,
  );
  adminRepo.permissions.push({
    id: 1,
    userId: staffWithBackup.id,
    permissionKey: 'backup.manage',
    grantedAt: '2026-11-01T00:00:00.000Z',
    grantedById: superAdmin.id,
  });

  const policyService = new PermissionPolicyService(adminRepo, logger);
  const store = new MemoryBackupStore();
  const snapshotProvider = new MemorySnapshotProvider();
  const backupService = new BackupService({
    backupLogRepository: store,
    backupStorage: store,
    snapshotProvider,
    permissionPolicyService: policyService,
    clock,
    logger,
  });

  return {
    clock,
    logger,
    adminRepo,
    superAdmin,
    staffWithBackup,
    staffWithoutBackup,
    memberUser,
    store,
    snapshotProvider,
    backupService,
  };
}

async function deleteTempDatabaseAsync(dbName: string): Promise<void> {
  if (typeof indexedDB === 'undefined') {
    return;
  }
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase(dbName);
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();
    req.onblocked = () => resolve();
  });
}

export const stage21Tests: UnitTestCase[] = [
  {
    id: 'stage21_manual_backup_and_log',
    nameKey: 'tests.stage21.manualBackupAndLog.name',
    descriptionKey: 'tests.stage21.manualBackupAndLog.desc',
    run: async () => {
      const h = buildHarness();
      h.snapshotProvider.tables[STORE_NAMES.TOPICS] = [
        { id: 10, name: 'تاریخ اسلام', slug: 'islamic-history' },
      ];
      h.snapshotProvider.tables[STORE_NAMES.CONTENT_ITEMS] = [
        {
          id: 20,
          title: 'مقاله آزمایشی پشتیبان',
          slug: 'sample-backup-article',
          format: 'Article',
          status: ContentStatus.Published,
        },
      ];

      const runRes = await h.backupService.runBackupAsync(
        h.staffWithBackup,
        'Manual',
      );
      assert(runRes.ok && runRes.statusCode === 200, 'Authorized staff manual backup must succeed');
      assert(runRes.backupLog !== undefined, 'backupLog must be returned');
      assertEqual(runRes.backupLog!.status, 'Succeeded', 'Backup status must be Succeeded');
      assertEqual(runRes.backupLog!.kind, 'Manual', 'Backup kind must be Manual');
      assert(runRes.backupLog!.filePath.endsWith('.bak'), 'Backup filePath must end with .bak');
      assert(
        typeof runRes.backupLog!.sizeBytes === 'number' &&
          runRes.backupLog!.sizeBytes > 0,
        'sizeBytes must be > 0',
      );
      assertEqual(runRes.backupLog!.isRetained, true, 'New backup must be retained');
      assert(
        typeof runRes.backupLog!.checksumSha256 === 'string' &&
          /^[a-f0-9]{64}$/i.test(runRes.backupLog!.checksumSha256),
        'checksumSha256 must be valid 64-hex SHA-256',
      );

      const dl = await h.backupService.downloadBackupArchiveAsync(
        h.superAdmin,
        runRes.backupLog!.id,
      );
      assert(dl.ok && typeof dl.payloadText === 'string', 'Download must return archive payload');
      const validated = await h.backupService.parseAndValidateBackupFileAsync(
        dl.payloadText!,
      );
      assert(validated.ok && validated.snapshot !== undefined, 'Archive must validate cleanly');
      assertEqual(
        validated.snapshot!.counts.byTable[STORE_NAMES.CONTENT_ITEMS],
        1,
        'Snapshot counts must record 1 content item',
      );
    },
  },
  {
    id: 'stage21_scheduler_and_retention4',
    nameKey: 'tests.stage21.schedulerAndRetention4.name',
    descriptionKey: 'tests.stage21.schedulerAndRetention4.desc',
    run: async () => {
      const h = buildHarness();
      const scheduler = new BackupScheduler({
        backupService: h.backupService,
        backupLogRepository: h.store,
        clock: h.clock,
        logger: h.logger,
        intervalMs: 60_000,
      });

      // 30s elapsed -> should NOT trigger before 1 minute
      h.clock.advanceMs(30_000);
      const earlyTick = await scheduler.tickAsync();
      assertEqual(earlyTick.executed, false, 'Scheduler must not trigger before 60s');

      // Advance across 5 cycles of 1 minute
      h.clock.advanceMs(35_000);
      const tick1 = await scheduler.tickAsync();
      assertEqual(tick1.executed, true, 'Scheduled backup #1 must execute at 65s');

      for (let i = 2; i <= 5; i += 1) {
        h.clock.advanceMs(65_000);
        const tickN = await scheduler.tickAsync();
        assertEqual(tickN.executed, true, `Scheduled backup #${i} must execute`);
      }

      const listed = await h.backupService.listBackupLogsAsync(h.superAdmin);
      assert(listed.ok && listed.logs !== undefined, 'SuperAdmin must list backup logs');
      assertEqual(listed.logs!.length, 5, 'Exactly 5 backup logs must exist');
      assertEqual(
        listed.retainedPaths!.length,
        MAX_RETAINED_BACKUPS,
        'Exactly 4 backup archive files must remain retained',
      );

      // Sort oldest -> newest by id to inspect pruning
      const chronological = [...listed.logs!].sort((a, b) => a.id - b.id);
      assertEqual(
        chronological[0].isRetained,
        false,
        'Oldest backup log (#1) must be marked isRetained=false after 5th run',
      );
      const deletedArchive = await h.store.readArchiveAsync(
        chronological[0].filePath,
      );
      assertEqual(
        deletedArchive,
        null,
        'Archive file for oldest backup (#1) must be deleted from storage',
      );

      for (let i = 1; i < chronological.length; i += 1) {
        assertEqual(
          chronological[i].isRetained,
          true,
          `Retained backup #${i + 1} must have isRetained=true`,
        );
        const text = await h.store.readArchiveAsync(chronological[i].filePath);
        assert(
          text !== null && text.length > 0,
          `Archive #${i + 1} must still exist on storage`,
        );
      }
    },
  },
  {
    id: 'stage21_sandbox_restore_verification',
    nameKey: 'tests.stage21.sandboxRestoreVerification.name',
    descriptionKey: 'tests.stage21.sandboxRestoreVerification.desc',
    run: async () => {
      const h = buildHarness();
      const sampleBytes = new TextEncoder().encode('MerajAndisheh-Binary-File-Payload-21');
      h.snapshotProvider.tables[STORE_NAMES.TOPICS] = [
        { id: 1, name: 'فرهنگ و تمدن', slug: 'culture' },
      ];
      h.snapshotProvider.tables[STORE_NAMES.USERS] = [h.superAdmin];
      h.snapshotProvider.tables[STORE_NAMES.CONTENT_ITEMS] = [
        {
          id: 101,
          title: 'محتوای اصلی پیش از بازیابی',
          slug: 'original-before-restore',
          format: 'Pdf',
          status: ContentStatus.Published,
          thumbnailKey: 'public/thumb/test-cover.jpg',
        },
      ];
      h.snapshotProvider.storedFiles = [
        {
          metadata: {
            storageKey: 'private/vault/test-doc.pdf',
            originalFileName: 'test-doc.pdf',
            extension: 'pdf',
            mimeType: 'application/pdf',
            sizeBytes: sampleBytes.byteLength,
            visibility: 'private',
            category: 'document',
            uploadedById: h.superAdmin.id,
            createdAt: h.clock.nowUtcIso(),
          },
          base64Data: btoa(
            Array.from(sampleBytes, (b) => String.fromCharCode(b)).join(''),
          ),
        },
      ];

      const manual = await h.backupService.runBackupAsync(h.superAdmin, 'Manual');
      assert(manual.ok && manual.backupLog, 'Manual backup for sandbox test must succeed');

      // Mutate primary data after taking backup to verify sandbox test does not touch primary
      h.snapshotProvider.tables[STORE_NAMES.CONTENT_ITEMS] = [];
      h.snapshotProvider.storedFiles = [];

      const sandboxRes = await h.backupService.testRestoreOnSandboxAsync(
        h.superAdmin,
        { backupLogId: manual.backupLog!.id },
      );
      assert(sandboxRes.ok && sandboxRes.report, 'Sandbox restore must succeed');
      assertEqual(
        sandboxRes.report!.targetDatabaseName,
        RESTORE_SANDBOX_DB_NAME,
        'Sandbox report must target MerajAndisheh_RestoreTestDB',
      );
      assertEqual(
        sandboxRes.report!.verifiedContentsCount,
        1,
        'Sandbox must verify 1 restored content item',
      );
      assertEqual(
        sandboxRes.report!.restoredFilesCount,
        1,
        'Sandbox must verify 1 restored binary file',
      );
      assertEqual(
        h.snapshotProvider.tables[STORE_NAMES.CONTENT_ITEMS].length,
        0,
        'Primary database must remain untouched after sandbox test restore',
      );

      // Full primary restore must require explicit confirmation=true
      const unconfirmed = await h.backupService.restoreFullDatabaseAsync(
        h.superAdmin,
        { backupLogId: manual.backupLog!.id, confirmed: false },
      );
      assertEqual(unconfirmed.ok, false, 'Unconfirmed primary restore must fail');
      assertEqual(unconfirmed.statusCode, 400, 'Unconfirmed restore returns 400');
      assertEqual(
        unconfirmed.errorCode,
        'CONFIRMATION_REQUIRED',
        'Unconfirmed restore errorCode must be CONFIRMATION_REQUIRED',
      );

      const confirmed = await h.backupService.restoreFullDatabaseAsync(
        h.superAdmin,
        { backupLogId: manual.backupLog!.id, confirmed: true },
      );
      assert(confirmed.ok && confirmed.report, 'Confirmed primary restore must succeed');
      assertEqual(
        h.snapshotProvider.tables[STORE_NAMES.CONTENT_ITEMS].length,
        1,
        'Primary database contents must be restored after confirmed full restore',
      );

      // Real IndexedDB + Sandbox DB test when running in browser
      if (typeof indexedDB !== 'undefined') {
        const tempPrimaryName = `MerajStage21_Primary_${Date.now()}`;
        const primaryStore = new IndexedDbDataStore(
          tempPrimaryName,
          envConfig.databaseVersion,
          envConfig.metaStoreName,
        );
        try {
          await primaryStore.connect();
          const fileStorage = new LocalIndexedDbFileStorage(primaryStore, h.clock);
          const idbBackupRepo = new IndexedDbBackupRepository(primaryStore, h.clock);
          const idbSnapshotProvider = new IndexedDbBackupSnapshotProvider(
            primaryStore,
          );
          const idbBackupService = new BackupService({
            backupLogRepository: idbBackupRepo,
            backupStorage: idbBackupRepo,
            snapshotProvider: idbSnapshotProvider,
            permissionPolicyService: new PermissionPolicyService(
              h.adminRepo,
              h.logger,
            ),
            clock: h.clock,
            logger: h.logger,
          });

          const savedMeta = await fileStorage.saveAsync({
            originalFileName: 'real-guide.pdf',
            bytes: sampleBytes,
            contentType: 'application/pdf',
            visibility: 'private',
            uploadedById: h.superAdmin.id,
          });
          await primaryStore.putRecord(STORE_NAMES.CONTENT_ITEMS, {
            id: 501,
            title: 'راهنمای واقعی در IndexedDB',
            slug: 'real-idb-guide',
            format: 'Pdf',
            status: ContentStatus.Published,
          });

          const idbBackup = await idbBackupService.runBackupAsync(
            h.superAdmin,
            'Manual',
          );
          assert(
            idbBackup.ok && idbBackup.backupLog,
            'Real IndexedDB backup must succeed',
          );

          // Remove content from primary DB before sandbox restore
          await primaryStore.clearStore(STORE_NAMES.CONTENT_ITEMS);
          const idbSandboxRes = await idbBackupService.testRestoreOnSandboxAsync(
            h.superAdmin,
            { backupLogId: idbBackup.backupLog!.id },
          );
          assert(
            idbSandboxRes.ok && idbSandboxRes.report,
            'Real IndexedDB sandbox restore must succeed',
          );
          assertEqual(
            idbSandboxRes.report!.verifiedContentsCount,
            1,
            'Real IDB sandbox must verify 1 content item',
          );
          assertEqual(
            idbSandboxRes.report!.restoredFilesCount,
            1,
            'Real IDB sandbox must verify 1 binary file',
          );
          const primaryCountAfterSandbox = await primaryStore.count(
            STORE_NAMES.CONTENT_ITEMS,
          );
          assertEqual(
            primaryCountAfterSandbox,
            0,
            'Real primary IDB content count must stay untouched after sandbox restore',
          );
          assert(
            (await fileStorage.existsAsync(savedMeta.storageKey)) === true,
            'Primary file storage remains intact',
          );
        } finally {
          primaryStore.close();
          await deleteTempDatabaseAsync(tempPrimaryName);
          await deleteTempDatabaseAsync(RESTORE_SANDBOX_DB_NAME);
        }
      }
    },
  },
  {
    id: 'stage21_corrupted_checksum_rejected',
    nameKey: 'tests.stage21.corruptedChecksumRejected.name',
    descriptionKey: 'tests.stage21.corruptedChecksumRejected.desc',
    run: async () => {
      const h = buildHarness();
      h.snapshotProvider.tables[STORE_NAMES.CONTENT_ITEMS] = [
        { id: 1, title: 'سند سالم برای آزمون یکپارچگی', slug: 'healthy-doc' },
      ];
      const manual = await h.backupService.runBackupAsync(h.superAdmin, 'Manual');
      assert(manual.ok && manual.backupLog, 'Backup creation must succeed');

      const dl = await h.backupService.downloadBackupArchiveAsync(
        h.superAdmin,
        manual.backupLog!.id,
      );
      assert(dl.ok && typeof dl.payloadText === 'string', 'Archive download must succeed');
      const raw = dl.payloadText!;

      // Tamper 1 character inside the content title without updating SHA-256
      const tamperedPayload = raw.replace(
        'سند سالم برای آزمون یکپارچگی',
        'سند سالم برای آزمون یکپارچک',
      );
      assert(tamperedPayload !== raw, 'Tampered payload must differ by 1 character');

      const parsedTampered = await h.backupService.parseAndValidateBackupFileAsync(
        tamperedPayload,
      );
      assertEqual(parsedTampered.ok, false, 'Tampered payload must be rejected');
      assertEqual(
        parsedTampered.errorCode,
        'BACKUP_CORRUPTED',
        'Tampered payload errorCode must be BACKUP_CORRUPTED',
      );

      // Tamper checksum directly
      const parsedObj = JSON.parse(raw) as BackupSnapshotFile;
      const flippedChar = parsedObj.checksumSha256[0] === 'a' ? 'b' : 'a';
      const badChecksumText = JSON.stringify({
        ...parsedObj,
        checksumSha256: `${flippedChar}${parsedObj.checksumSha256.slice(1)}`,
      });
      const parsedBadChecksum =
        await h.backupService.parseAndValidateBackupFileAsync(badChecksumText);
      assertEqual(parsedBadChecksum.ok, false, 'Bad checksum must be rejected');
      assertEqual(
        parsedBadChecksum.errorCode,
        'BACKUP_CORRUPTED',
        'Bad checksum errorCode must be BACKUP_CORRUPTED',
      );

      // Restore attempt with malformed JSON or tampered payload must return 400 BACKUP_CORRUPTED
      const restoreBad = await h.backupService.restoreFullDatabaseAsync(
        h.superAdmin,
        { rawContent: '{invalid-json', confirmed: true },
      );
      assertEqual(restoreBad.ok, false, 'Malformed JSON restore must fail');
      assertEqual(restoreBad.statusCode, 400, 'Malformed JSON status must be 400');
      assertEqual(
        restoreBad.errorCode,
        'BACKUP_CORRUPTED',
        'Malformed JSON errorCode must be BACKUP_CORRUPTED',
      );
    },
  },
  {
    id: 'stage21_rbac_and_idb_v14',
    nameKey: 'tests.stage21.rbacAndIdbV14.name',
    descriptionKey: 'tests.stage21.rbacAndIdbV14.desc',
    run: async () => {
      const h = buildHarness();

      // Unauthorized Staff -> 403 + WARN log
      h.logger.clearLogs();
      const unauthStaffRun = await h.backupService.runBackupAsync(
        h.staffWithoutBackup,
        'Manual',
      );
      assertEqual(unauthStaffRun.ok, false, 'Staff without backup.manage must be denied');
      assertEqual(unauthStaffRun.statusCode, 403, 'Unauthorized Staff status must be 403');
      const warnLogs = h.logger.getLogs().filter((l) => l.level === 'WARN');
      assert(warnLogs.length >= 1, 'Unauthorized Staff attempt must emit a WARN log');

      const unauthStaffList = await h.backupService.listBackupLogsAsync(
        h.staffWithoutBackup,
      );
      assertEqual(unauthStaffList.statusCode, 403, 'List logs requires backup.manage');

      // Member and Guest -> 404
      const memberRun = await h.backupService.runBackupAsync(
        h.memberUser,
        'Manual',
      );
      assertEqual(memberRun.statusCode, 404, 'Member must receive 404');

      const guestList = await h.backupService.listBackupLogsAsync(null);
      assertEqual(guestList.statusCode, 404, 'Guest must receive 404');

      // SYSTEM cannot trigger Manual backup; only Scheduled
      const systemManual = await h.backupService.runBackupAsync(
        'SYSTEM',
        'Manual',
      );
      assertEqual(systemManual.statusCode, 403, 'SYSTEM cannot run Manual backup');

      // Authorized Staff & SuperAdmin -> 200
      const staffRun = await h.backupService.runBackupAsync(
        h.staffWithBackup,
        'Manual',
      );
      assertEqual(staffRun.statusCode, 200, 'Staff with backup.manage gets 200');

      const adminList = await h.backupService.listBackupLogsAsync(h.superAdmin);
      assertEqual(adminList.statusCode, 200, 'SuperAdmin gets 200');

      // Verify Migration v14 & envConfig version >= 14
      assert(
        envConfig.databaseVersion >= 14,
        `envConfig.databaseVersion must be >= 14 (actual=${envConfig.databaseVersion})`,
      );
      assert(
        DATABASE_MIGRATIONS.some((m) => m.version === 14),
        'DATABASE_MIGRATIONS must include version 14',
      );
      assert(
        STAGE21_OBJECT_STORES.includes(STORE_NAMES.BACKUP_LOGS) &&
          STAGE21_OBJECT_STORES.includes(STORE_NAMES.BACKUP_ARCHIVES),
        'STAGE21_OBJECT_STORES must include backupLogs and backupArchives',
      );

      if (typeof indexedDB !== 'undefined') {
        const tempDbName = `MerajStage21_V14_${Date.now()}`;
        const store = new IndexedDbDataStore(
          tempDbName,
          envConfig.databaseVersion,
          envConfig.metaStoreName,
        );
        try {
          await store.connect();
          const storeNames = await store.getObjectStoreNames();
          for (const requiredStore of STAGE21_OBJECT_STORES) {
            assert(
              storeNames.includes(requiredStore),
              `IndexedDB v14 must contain objectStore ${requiredStore}`,
            );
          }
        } finally {
          store.close();
          await deleteTempDatabaseAsync(tempDbName);
        }
      }
    },
  },
];
