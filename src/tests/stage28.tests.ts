import type { IClock } from '../core/abstractions/IClock';
import type { IAdminRepository } from '../core/abstractions/adminRepository';
import type {
  DataStoreHealthProbe,
  DataStoreKey,
  DataStoreMetadata,
  IDataStore,
  MetaRecord,
} from '../core/abstractions/IDataStore';
import {
  ContentFileKind,
  ContentStatus,
  FileStorageType,
  type ContentFile,
  type ContentItem,
} from '../core/domain/content';
import type { AppUser, UserRole } from '../core/domain/auth';
import type { PermissionKey, StaffPermission } from '../core/domain/permissions';
import type { FeatureFlag, SiteSetting } from '../core/domain/settings';
import type { AgeGroup } from '../core/domain/taxonomy';
import { DownloadKind } from '../core/domain/analytics';
import { DownloadService } from '../core/services/downloadService';
import { PermissionPolicyService } from '../core/services/permissionPolicyService';
import { S3PresignedUrlService } from '../core/services/s3PresignedUrlService';
import { StorageMigrationService } from '../core/services/storageMigrationService';
import { SystemClock } from '../infrastructure/clock/SystemClock';
import { envConfig } from '../infrastructure/config/envConfig';
import { IndexedDbContentRepository } from '../infrastructure/data/IndexedDbContentRepository';
import { IndexedDbDataStore } from '../infrastructure/data/IndexedDbDataStore';
import { IndexedDbDownloadEventRepository } from '../infrastructure/data/IndexedDbDownloadEventRepository';
import {
  STAGE28_OBJECT_STORES,
  STORE_NAMES,
} from '../infrastructure/data/migrations';
import { DatabaseSeeder } from '../infrastructure/data/seed';
import { AppLogger } from '../infrastructure/logging/AppLogger';
import { HmacDownloadTokenProtector } from '../infrastructure/security/HmacDownloadTokenProtector';
import { IndexedDbS3StorageConfigStore } from '../infrastructure/storage/IndexedDbS3StorageConfigStore';
import { LocalIndexedDbFileStorage } from '../infrastructure/storage/LocalIndexedDbFileStorage';
import { RoutingFileStorage } from '../infrastructure/storage/RoutingFileStorage';
import { S3FileStorage } from '../infrastructure/storage/S3FileStorage';
import { assert, assertEqual, type UnitTestCase } from './testRunner';

class Stage28FakeClock implements IClock {
  private iso: string;
  private readonly inner = new SystemClock();

  constructor(initialIso = '2026-11-24T10:00:00.000Z') {
    this.iso = initialIso;
  }

  public advanceMs(deltaMs: number): void {
    this.iso = new Date(Date.parse(this.iso) + deltaMs).toISOString();
  }

  public now(): Date {
    return new Date(this.iso);
  }

  public nowUtcIso(): string {
    return this.iso;
  }

  public nowJalali(): string {
    return this.inner.toJalali(this.now());
  }

  public toJalali(date: Date): string {
    return this.inner.toJalali(date);
  }
}

class MemoryStage28DataStore implements IDataStore {
  private readonly meta = new Map<string, MetaRecord>();
  private readonly tables = new Map<string, Map<string, unknown>>();
  private readonly autoIds = new Map<string, number>();

  private getTable(storeName: string): Map<string, unknown> {
    let table = this.tables.get(storeName);
    if (!table) {
      table = new Map<string, unknown>();
      this.tables.set(storeName, table);
    }
    return table;
  }

  private resolveKeyPath(storeName: string): string {
    switch (storeName) {
      case STORE_NAMES.STORED_FILES:
      case STORE_NAMES.S3_BUCKET_OBJECTS:
        return 'storageKey';
      case STORE_NAMES.SITE_SETTINGS:
      case STORE_NAMES.FEATURE_FLAGS:
        return 'key';
      default:
        return 'id';
    }
  }

  private stringifyKey(key: DataStoreKey): string {
    return Array.isArray(key) ? key.join('|') : String(key);
  }

  public getMetadata(): DataStoreMetadata {
    return {
      databaseName: 'MemoryStage28DB',
      databaseVersion: envConfig.databaseVersion,
      metaStoreName: STORE_NAMES.META,
    };
  }

  public async connect(): Promise<void> {}
  public close(): void {}
  public async getObjectStoreNames(): Promise<string[]> {
    return [
      STORE_NAMES.META,
      STORE_NAMES.USERS,
      STORE_NAMES.CONTENT_ITEMS,
      STORE_NAMES.CONTENT_FILES,
      STORE_NAMES.CONTENT_AGE_GROUPS,
      STORE_NAMES.STORED_FILES,
      STORE_NAMES.S3_BUCKET_OBJECTS,
      STORE_NAMES.DOWNLOAD_EVENTS,
    ];
  }
  public async verifyConnection(): Promise<DataStoreHealthProbe> {
    return {
      connected: true,
      readWriteVerified: true,
      latencyMs: 1,
      metadata: this.getMetadata(),
    };
  }
  public async getMeta(key: string): Promise<MetaRecord | null> {
    return this.meta.get(key) ?? null;
  }
  public async setMeta(record: MetaRecord): Promise<void> {
    this.meta.set(record.key, { ...record });
  }
  public async deleteMeta(key: string): Promise<void> {
    this.meta.delete(key);
  }
  public async getAll<T>(storeName: string): Promise<T[]> {
    return Array.from(this.getTable(storeName).values()) as T[];
  }
  public async getByKey<T>(storeName: string, key: DataStoreKey): Promise<T | null> {
    return (this.getTable(storeName).get(this.stringifyKey(key)) as T) ?? null;
  }
  public async getByIndex<T>(
    storeName: string,
    indexName: string,
    indexValue: DataStoreKey,
  ): Promise<T | null> {
    const all = await this.getAllByIndex<T>(storeName, indexName, indexValue);
    return all[0] ?? null;
  }
  public async getAllByIndex<T>(
    storeName: string,
    indexName: string,
    indexValue: DataStoreKey,
  ): Promise<T[]> {
    const field = indexName.startsWith('by_') ? indexName.slice(3) : indexName;
    const rows = await this.getAll<Record<string, unknown>>(storeName);
    return rows.filter((row) => row[field] === indexValue) as unknown as T[];
  }
  public async putRecord<T>(storeName: string, record: T): Promise<void> {
    const rec = record as Record<string, unknown>;
    const kp = this.resolveKeyPath(storeName);
    let keyStr: string;
    if (storeName === STORE_NAMES.CONTENT_AGE_GROUPS) {
      keyStr = `${rec.contentId}|${rec.ageGroupId}`;
    } else {
      keyStr = String(rec[kp]);
    }
    this.getTable(storeName).set(keyStr, record);
  }
  public async addRecordWithAutoId<T>(storeName: string, record: T): Promise<number> {
    const next = (this.autoIds.get(storeName) ?? 0) + 1;
    this.autoIds.set(storeName, next);
    const payload = { ...(record as Record<string, unknown>), id: next };
    this.getTable(storeName).set(String(next), payload);
    return next;
  }
  public async deleteByKey(storeName: string, key: DataStoreKey): Promise<void> {
    this.getTable(storeName).delete(this.stringifyKey(key));
  }
  public async count(storeName: string): Promise<number> {
    return this.getTable(storeName).size;
  }
  public async clearStore(storeName: string): Promise<void> {
    this.getTable(storeName).clear();
  }
  public async resetDatabase(): Promise<void> {
    this.meta.clear();
    this.tables.clear();
    this.autoIds.clear();
  }
}

class MemoryStage28AdminRepo implements IAdminRepository {
  private readonly users = new Map<number, AppUser>();
  private readonly perms = new Map<number, PermissionKey[]>();
  private nextUserId = 1;

  public addUser(role: UserRole, permissions: PermissionKey[] = []): AppUser {
    const id = this.nextUserId++;
    const user: AppUser = {
      id,
      email: `user${id}@meraj.local`,
      normalizedEmail: `USER${id}@MERAJ.LOCAL`,
      emailConfirmed: true,
      phoneNumber: null,
      normalizedPhoneNumber: null,
      phoneNumberConfirmed: false,
      passwordHash: null,
      passwordSalt: null,
      displayName: `کاربر ${id}`,
      role,
      ageGroupId: null,
      personalizationEnabled: true,
      isActive: true,
      mustChangePassword: false,
      failedLoginCount: 0,
      lockoutEnd: null,
      lastLoginAt: null,
      createdAt: '2026-11-24T09:00:00.000Z',
    };
    this.users.set(id, user);
    this.perms.set(id, permissions);
    return user;
  }

  public async getAllUsers(): Promise<AppUser[]> {
    return Array.from(this.users.values());
  }
  public async getUserById(id: number): Promise<AppUser | null> {
    return this.users.get(id) ?? null;
  }
  public async getUserByNormalizedEmail(norm: string): Promise<AppUser | null> {
    return (
      Array.from(this.users.values()).find((u) => u.normalizedEmail === norm) ?? null
    );
  }
  public async getUserByNormalizedPhoneNumber(
    norm: string,
  ): Promise<AppUser | null> {
    return (
      Array.from(this.users.values()).find(
        (u) => u.normalizedPhoneNumber === norm,
      ) ?? null
    );
  }
  public async createUser(): Promise<AppUser> {
    throw new Error('Not needed');
  }
  public async updateUser(): Promise<void> {}
  public async deleteSessionsByUserId(): Promise<void> {}
  public async getStaffPermissionsByUserId(
    userId: number,
  ): Promise<StaffPermission[]> {
    const keys = this.perms.get(userId) ?? [];
    return keys.map((permissionKey, idx) => ({
      id: idx + 1,
      userId,
      permissionKey,
      grantedAt: '2026-11-24T09:00:00.000Z',
      grantedById: null,
    }));
  }
  public async replaceStaffPermissions(): Promise<StaffPermission[]> {
    return [];
  }
  public async getAllFeatureFlags(): Promise<FeatureFlag[]> {
    return [];
  }
  public async upsertFeatureFlag(): Promise<void> {}
  public async getAllSiteSettings(): Promise<SiteSetting[]> {
    return [];
  }
  public async getSiteSettingByKey(): Promise<SiteSetting | null> {
    return null;
  }
  public async upsertSiteSettings(): Promise<void> {}
  public async getActiveAgeGroups(): Promise<AgeGroup[]> {
    return [];
  }
}

function createStage28Harness() {
  const clock = new Stage28FakeClock('2026-11-24T10:00:00.000Z');
  const logKey = `meraj_stage28_logs_${Date.now()}_${Math.random()}`;
  const logger = new AppLogger(clock, logKey, 200);
  const dataStore = new MemoryStage28DataStore();
  const adminRepo = new MemoryStage28AdminRepo();
  const contentRepo = new IndexedDbContentRepository(
    dataStore as unknown as IndexedDbDataStore,
  );
  const downloadEventRepo = new IndexedDbDownloadEventRepository(
    dataStore as unknown as IndexedDbDataStore,
  );
  const policyService = new PermissionPolicyService(adminRepo, logger);

  const superAdmin = adminRepo.addUser('SuperAdmin', ['settings.manage']);
  const staffWithSettings = adminRepo.addUser('Staff', ['settings.manage']);
  const staffWithoutSettings = adminRepo.addUser('Staff', ['content.manage']);
  const member = adminRepo.addUser('Member', []);

  // Seed users into dataStore.USERS so foreign key userExists passes
  const seedUsersToStore = async () => {
    for (const u of [superAdmin, staffWithSettings, staffWithoutSettings, member]) {
      await dataStore.putRecord(STORE_NAMES.USERS, u);
    }
  };

  const configStore = new IndexedDbS3StorageConfigStore(
    dataStore as unknown as IndexedDbDataStore,
  );
  const localFileStorage = new LocalIndexedDbFileStorage(
    dataStore as unknown as IndexedDbDataStore,
    clock,
  );
  const s3FileStorage = new S3FileStorage(
    dataStore as unknown as IndexedDbDataStore,
    configStore,
    clock,
  );
  const routingFileStorage = new RoutingFileStorage({
    localStorage: localFileStorage,
    s3Storage: s3FileStorage,
    configStore,
  });
  const presignedUrlService = new S3PresignedUrlService(clock);
  const tokenProtector = new HmacDownloadTokenProtector({
    secretKeyBytes: new TextEncoder().encode('stage28-test-hmac-secret'),
  });

  const downloadService = new DownloadService(
    contentRepo,
    downloadEventRepo,
    routingFileStorage,
    tokenProtector,
    clock,
    logger,
    {
      getStorageConfigAsync: () => configStore.getConfigAsync(),
      presignedUrlService,
    },
  );

  const storageMigrationService = new StorageMigrationService({
    configStore,
    localStorage: localFileStorage,
    s3Storage: s3FileStorage,
    contentRepository: contentRepo,
    policyService,
    clock,
    logger,
  });

  const createPublishedContentWithFile = async (params: {
    creatorId: number;
    storageKey: string;
    storageType: FileStorageType;
    originalFileName: string;
    mimeType: string;
    sizeBytes: number;
  }): Promise<{ item: ContentItem; file: ContentFile }> => {
    const item = await contentRepo.createContentItem({
      title: `محتوای آزمایشی ${params.originalFileName}`,
      slug: `sample-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
      summary: 'خلاصه محتوای آزمایشی مرحله ۲۸',
      body: null,
      format: 'Video',
      impactLevelId: null,
      status: ContentStatus.Published,
      publishedAt: clock.nowUtcIso(),
      readWatchMinutes: 5,
      thumbnailKey: params.storageKey,
      isFeatured: false,
      languageCode: 'fa',
      searchText: 'محتوای آزمایشی',
      viewCount: 0,
      downloadCount: 0,
      likeCount: 0,
      createdById: params.creatorId,
      createdAt: clock.nowUtcIso(),
      updatedAt: clock.nowUtcIso(),
    });

    const inserted = await contentRepo.replaceFiles(item.id, [
      {
        contentId: item.id,
        kind: ContentFileKind.Main,
        storageType: params.storageType,
        storageKey: params.storageKey,
        externalUrl: null,
        originalFileName: params.originalFileName,
        mimeType: params.mimeType,
        sizeBytes: params.sizeBytes,
        isDownloadable: true,
        sortOrder: 0,
      },
    ]);

    return { item, file: inserted[0] };
  };

  return {
    clock,
    logger,
    dataStore,
    contentRepo,
    downloadEventRepo,
    configStore,
    localFileStorage,
    s3FileStorage,
    routingFileStorage,
    presignedUrlService,
    downloadService,
    storageMigrationService,
    superAdmin,
    staffWithSettings,
    staffWithoutSettings,
    member,
    seedUsersToStore,
    createPublishedContentWithFile,
    cleanup: () => logger.clearLogs(),
  };
}

async function deleteTempIndexedDatabaseAsync(dbName: string): Promise<void> {
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

export const stage28Tests: UnitTestCase[] = [
  {
    id: 'stage28-routing-save-read-and-range',
    nameKey: 'tests.stage28.routingSaveReadAndRange.name',
    descriptionKey: 'tests.stage28.routingSaveReadAndRange.desc',
    run: async () => {
      const h = createStage28Harness();
      try {
        await h.seedUsersToStore();

        const localSample = new Uint8Array([1, 2, 3, 4]);
        const localSaved = await h.routingFileStorage.saveAsync({
          bytes: localSample,
          originalFileName: 'local-thumb.png',
          contentType: 'image/png',
          visibility: 'public',
          uploadedById: h.superAdmin.id,
        });
        assert(
          await h.localFileStorage.existsAsync(localSaved.storageKey),
          'Default local provider must save to localFileStorage',
        );
        assertEqual(
          await h.s3FileStorage.existsAsync(localSaved.storageKey),
          false,
          'Default local provider must not write to s3BucketObjects',
        );

        const cfgRes = await h.storageMigrationService.saveStorageConfigAsync(
          h.superAdmin,
          {
            provider: 's3',
            endpoint: 'https://s3.ir-thr-at1.arvanstorage.ir',
            bucketName: 'meraj-media',
            region: 'ir-thr-at1',
            accessKeyId: 'AKIA_STAGE28_TEST',
            secretAccessKey: 'SECRET_STAGE28_TEST',
            forcePathStyle: true,
          },
        );
        assertEqual(cfgRes.ok, true, 'SuperAdmin must save valid S3 config');

        const probeRes = await h.storageMigrationService.testS3ConnectionAsync(
          h.superAdmin,
        );
        assertEqual(
          probeRes.ok && probeRes.data.ok,
          true,
          'S3 connection test probe must succeed',
        );

        const videoBytes = new Uint8Array(32);
        for (let i = 0; i < 32; i += 1) {
          videoBytes[i] = i + 10;
        }
        const s3Saved = await h.routingFileStorage.saveAsync({
          bytes: videoBytes,
          originalFileName: 'lecture-sample.mp4',
          contentType: 'video/mp4',
          visibility: 'private',
          uploadedById: h.superAdmin.id,
        });

        assert(
          await h.s3FileStorage.existsAsync(s3Saved.storageKey),
          'When provider=s3, RoutingFileStorage must save into S3FileStorage',
        );
        assertEqual(
          await h.localFileStorage.existsAsync(s3Saved.storageKey),
          false,
          'When provider=s3, new upload must not duplicate into localFileStorage',
        );

        const fullRead = await h.routingFileStorage.openReadAsync(s3Saved.storageKey);
        assert(fullRead !== null, 'S3 file must openReadAsync successfully');
        assertEqual(fullRead.bytes.byteLength, 32, 'Full read length must match');

        const rangeRead = await h.s3FileStorage.openReadRangeAsync(
          s3Saved.storageKey,
          8,
          15,
        );
        assert(rangeRead !== null, 'S3FileStorage must support Range reads');
        assertEqual(rangeRead.startByte, 8, 'Range startByte must be 8');
        assertEqual(rangeRead.endByte, 15, 'Range endByte must be 15');
        assertEqual(rangeRead.totalBytes, 32, 'Range totalBytes must be 32');
        assertEqual(rangeRead.chunk.byteLength, 8, 'Range chunk length must be 8 bytes');
        assertEqual(rangeRead.chunk[0], 18, 'Range byte[0] must match source offset 8');
        assertEqual(rangeRead.chunk[7], 25, 'Range byte[7] must match source offset 15');
      } finally {
        h.cleanup();
      }
    },
  },
  {
    id: 'stage28-presigned-url-five-min-and-tamper',
    nameKey: 'tests.stage28.presignedUrlFiveMinAndTamper.name',
    descriptionKey: 'tests.stage28.presignedUrlFiveMinAndTamper.desc',
    run: async () => {
      const h = createStage28Harness();
      try {
        await h.seedUsersToStore();
        await h.storageMigrationService.saveStorageConfigAsync(h.superAdmin, {
          provider: 's3',
          endpoint: 'https://s3.ir-thr-at1.arvanstorage.ir',
          bucketName: 'meraj-media',
          region: 'ir-thr-at1',
          accessKeyId: 'AKIA_SIGN_TEST',
          secretAccessKey: 'SECRET_SIGN_TEST_XYZ',
          forcePathStyle: true,
        });

        const payloadBytes = new Uint8Array([70, 71, 72, 73, 74, 75, 76, 77, 78, 79]);
        const meta = await h.s3FileStorage.saveAsync({
          bytes: payloadBytes,
          originalFileName: 'presigned-doc.pdf',
          contentType: 'application/pdf',
          visibility: 'private',
          uploadedById: h.superAdmin.id,
        });
        const { item, file } = await h.createPublishedContentWithFile({
          creatorId: h.superAdmin.id,
          storageKey: meta.storageKey,
          storageType: FileStorageType.S3,
          originalFileName: 'presigned-doc.pdf',
          mimeType: 'application/pdf',
          sizeBytes: payloadBytes.byteLength,
        });

        // Issued at 10:00:00
        const linkRes = await h.downloadService.createSignedDownloadLinkAsync({
          currentUser: h.member,
          contentId: item.id,
          fileId: file.id,
          activeAgeGroup: null,
        });
        assertEqual(linkRes.ok, true, 'Member must receive signed download link');
        if (!linkRes.ok || !linkRes.presignedS3Url) {
          throw new Error('Expected presignedS3Url on S3 download link');
        }
        assertEqual(linkRes.storageProvider, 's3', 'storageProvider must be s3');
        assertEqual(
          linkRes.s3SignedExpiresInSeconds,
          300,
          'Presigned TTL must be 300 seconds (5 minutes)',
        );
        assert(
          linkRes.presignedS3Url.includes('X-Amz-Algorithm=AWS4-HMAC-SHA256') &&
            linkRes.presignedS3Url.includes('X-Amz-Expires=300'),
          'Presigned URL must include AWS4-HMAC-SHA256 and X-Amz-Expires=300',
        );

        // Advance to 10:03:00 (+180s) -> valid download + Range
        h.clock.advanceMs(3 * 60 * 1000);
        const dlValid = await h.downloadService.executeS3PresignedDownloadAsync({
          presignedUrl: linkRes.presignedS3Url,
          currentUser: h.member,
          activeAgeGroup: null,
          range: { startByte: 2, endByte: 5 },
        });
        assertEqual(dlValid.ok, true, 'At minute 3, presigned S3 download must succeed');
        if (dlValid.ok) {
          assertEqual(dlValid.bytes.byteLength, 4, 'Range chunk must have 4 bytes');
          assertEqual(dlValid.event.kind, DownloadKind.File, 'Must log DownloadKind.File');
          assertEqual(dlValid.storageProvider, 's3', 'Must indicate storageProvider=s3');
        }

        // Tamper 1 character of X-Amz-Signature -> INVALID_SIGNATURE
        const sigLastChar = linkRes.presignedS3Url.slice(-1);
        const flippedChar = sigLastChar === 'a' ? 'b' : 'a';
        const tamperedUrl = `${linkRes.presignedS3Url.slice(0, -1)}${flippedChar}`;
        const dlTampered = await h.downloadService.executeS3PresignedDownloadAsync({
          presignedUrl: tamperedUrl,
          currentUser: h.member,
          activeAgeGroup: null,
        });
        assertEqual(dlTampered.ok, false, 'Tampered presigned URL must fail');
        if (!dlTampered.ok) {
          assertEqual(
            dlTampered.errorCode,
            'INVALID_SIGNATURE',
            'Tampering 1 char must yield INVALID_SIGNATURE',
          );
        }

        // Advance past 10:05:00 -> 10:05:01 -> PRESIGNED_URL_EXPIRED
        h.clock.advanceMs(2 * 60 * 1000 + 1000);
        const dlExpired = await h.downloadService.executeS3PresignedDownloadAsync({
          presignedUrl: linkRes.presignedS3Url,
          currentUser: h.member,
          activeAgeGroup: null,
        });
        assertEqual(dlExpired.ok, false, 'Expired presigned URL at 10:05:01 must fail');
        if (!dlExpired.ok) {
          assertEqual(
            dlExpired.errorCode,
            'PRESIGNED_URL_EXPIRED',
            'Expired S3 URL must return PRESIGNED_URL_EXPIRED',
          );
        }
      } finally {
        h.cleanup();
      }
    },
  },
  {
    id: 'stage28-migration-preserves-local-and-idempotent',
    nameKey: 'tests.stage28.migrationPreservesLocalAndIdempotent.name',
    descriptionKey: 'tests.stage28.migrationPreservesLocalAndIdempotent.desc',
    run: async () => {
      const h = createStage28Harness();
      try {
        await h.seedUsersToStore();

        const thumbBytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
        const docBytes = new Uint8Array([37, 80, 68, 70, 45, 49, 46, 55, 10]);

        const localThumb = await h.routingFileStorage.saveAsync({
          bytes: thumbBytes,
          originalFileName: 'cover.png',
          contentType: 'image/png',
          visibility: 'public',
          uploadedById: h.superAdmin.id,
        });
        const localDoc = await h.routingFileStorage.saveAsync({
          bytes: docBytes,
          originalFileName: 'guide.pdf',
          contentType: 'application/pdf',
          visibility: 'private',
          uploadedById: h.superAdmin.id,
        });

        const { item } = await h.createPublishedContentWithFile({
          creatorId: h.superAdmin.id,
          storageKey: localDoc.storageKey,
          storageType: FileStorageType.Local,
          originalFileName: 'guide.pdf',
          mimeType: 'application/pdf',
          sizeBytes: docBytes.byteLength,
        });

        await h.storageMigrationService.saveStorageConfigAsync(h.superAdmin, {
          provider: 's3',
          endpoint: 'https://minio.local:9000',
          bucketName: 'meraj-archive',
          region: 'ir-thr-at1',
          accessKeyId: 'MINIO_ACCESS',
          secretAccessKey: 'MINIO_SECRET',
          forcePathStyle: true,
        });

        const firstRun = await h.storageMigrationService.migrateLocalFilesToS3Async(
          h.superAdmin,
        );
        assertEqual(firstRun.ok, true, 'First migration run must succeed');
        if (firstRun.ok) {
          assertEqual(firstRun.data.migratedCount, 2, 'Both local files must migrate');
          assertEqual(firstRun.data.skippedCount, 0, 'Skipped count on first run is 0');
          assertEqual(
            firstRun.data.localFilesPreserved,
            true,
            'Migration must preserve local files',
          );
          assertEqual(
            firstRun.data.updatedContentFilesCount,
            1,
            'ContentFile storageType must update from Local to S3',
          );
        }

        // Exact key preservation & local preservation checks
        assert(
          await h.s3FileStorage.existsAsync(localThumb.storageKey),
          'Thumb must exist in S3 with identical storageKey',
        );
        assert(
          await h.s3FileStorage.existsAsync(localDoc.storageKey),
          'Doc must exist in S3 with identical storageKey',
        );
        assert(
          (await h.localFileStorage.existsAsync(localThumb.storageKey)) &&
            (await h.localFileStorage.existsAsync(localDoc.storageKey)),
          'CRITICAL: Both local files MUST NOT be deleted automatically during migration',
        );

        const updatedFiles = await h.contentRepo.getFilesByContentId(item.id);
        assertEqual(
          updatedFiles[0]?.storageType,
          FileStorageType.S3,
          'ContentFile.storageType must now be FileStorageType.S3',
        );

        // Second idempotent run
        const secondRun = await h.storageMigrationService.migrateLocalFilesToS3Async(
          h.superAdmin,
        );
        assertEqual(secondRun.ok, true, 'Second migration run must succeed');
        if (secondRun.ok) {
          assertEqual(secondRun.data.migratedCount, 0, 'Second run must migrate 0 files');
          assertEqual(
            secondRun.data.skippedCount,
            2,
            'Second run must skip both files as already_in_s3',
          );
        }
      } finally {
        h.cleanup();
      }
    },
  },
  {
    id: 'stage28-rbac-and-zero-secret-leak-in-logs',
    nameKey: 'tests.stage28.rbacAndZeroSecretLeakInLogs.name',
    descriptionKey: 'tests.stage28.rbacAndZeroSecretLeakInLogs.desc',
    run: async () => {
      const h = createStage28Harness();
      const canarySecret = 'ULTRA-TOP-SECRET-KEY-NEVER-LOG-987654321';
      try {
        await h.seedUsersToStore();

        const guestRes = await h.storageMigrationService.getStorageConfigAsync(null);
        assertEqual(guestRes.statusCode, 404, 'Guest must get 404');

        const memberRes = await h.storageMigrationService.migrateLocalFilesToS3Async(
          h.member,
        );
        assertEqual(memberRes.statusCode, 404, 'Member must get 404');

        const unauthorizedStaffRes =
          await h.storageMigrationService.saveStorageConfigAsync(
            h.staffWithoutSettings,
            {
              provider: 's3',
              endpoint: 'https://s3.ir-thr-at1.arvanstorage.ir',
              bucketName: 'b',
              region: 'ir-thr-at1',
              accessKeyId: 'A',
              secretAccessKey: canarySecret,
            },
          );
        assertEqual(
          unauthorizedStaffRes.statusCode,
          403,
          'Staff without settings.manage must get 403',
        );
        assert(
          h.logger.getLogs().some((entry) => entry.level === 'WARN'),
          '403 attempt must produce WARN log',
        );

        // Attempting migration before S3 is configured -> S3_NOT_CONFIGURED
        const unconfiguredMig =
          await h.storageMigrationService.migrateLocalFilesToS3Async(
            h.staffWithSettings,
          );
        assertEqual(unconfiguredMig.ok, false, 'Unconfigured S3 migration must fail');
        if (!unconfiguredMig.ok) {
          assertEqual(
            unconfiguredMig.errorCode,
            'S3_NOT_CONFIGURED',
            'Must return S3_NOT_CONFIGURED',
          );
        }

        // Save valid config with canarySecret & run operations
        const saved = await h.storageMigrationService.saveStorageConfigAsync(
          h.staffWithSettings,
          {
            provider: 's3',
            endpoint: 'https://s3.ir-thr-at1.arvanstorage.ir',
            bucketName: 'safe-bucket',
            region: 'ir-thr-at1',
            accessKeyId: 'AKIACANARYPUBLIC',
            secretAccessKey: canarySecret,
            forcePathStyle: true,
          },
        );
        assertEqual(saved.ok, true, 'Staff with settings.manage must save config');
        await h.storageMigrationService.testS3ConnectionAsync(h.staffWithSettings);
        await h.storageMigrationService.disconnectS3Async(h.staffWithSettings);

        const serializedLogs = JSON.stringify(h.logger.getLogs());
        assertEqual(
          serializedLogs.includes(canarySecret),
          false,
          'CRITICAL: secretAccessKey must NEVER appear anywhere in AppLogger entries',
        );
      } finally {
        h.cleanup();
      }
    },
  },
  {
    id: 'stage28-verified-cleanup-and-disconnect-fallback',
    nameKey: 'tests.stage28.verifiedCleanupAndDisconnectFallback.name',
    descriptionKey: 'tests.stage28.verifiedCleanupAndDisconnectFallback.desc',
    run: async () => {
      const h = createStage28Harness();
      try {
        await h.seedUsersToStore();

        const fileBytes = new Uint8Array([10, 20, 30, 40, 50, 60]);
        const savedLocal = await h.routingFileStorage.saveAsync({
          bytes: fileBytes,
          originalFileName: 'book-chapter.pdf',
          contentType: 'application/pdf',
          visibility: 'private',
          uploadedById: h.superAdmin.id,
        });
        const { item, file } = await h.createPublishedContentWithFile({
          creatorId: h.superAdmin.id,
          storageKey: savedLocal.storageKey,
          storageType: FileStorageType.Local,
          originalFileName: 'book-chapter.pdf',
          mimeType: 'application/pdf',
          sizeBytes: fileBytes.byteLength,
        });

        await h.storageMigrationService.saveStorageConfigAsync(h.superAdmin, {
          provider: 's3',
          endpoint: 'local-s3://meraj-bucket',
          bucketName: 'meraj-bucket',
          region: 'ir-thr-at1',
          accessKeyId: 'LOCAL_KEY',
          secretAccessKey: 'LOCAL_SECRET_SAFE',
          forcePathStyle: true,
        });
        await h.storageMigrationService.migrateLocalFilesToS3Async(h.superAdmin);

        // Must require explicit confirmation checkbox
        const unconfirmedCleanup =
          await h.storageMigrationService.confirmCleanupMigratedLocalFilesAsync(
            h.superAdmin,
            { confirmed: false },
          );
        assertEqual(unconfirmedCleanup.ok, false, 'Unconfirmed cleanup must reject');

        // Confirmed verified cleanup
        const cleanupRes =
          await h.storageMigrationService.confirmCleanupMigratedLocalFilesAsync(
            h.superAdmin,
            { confirmed: true },
          );
        assertEqual(cleanupRes.ok, true, 'Verified local cleanup must succeed');
        if (cleanupRes.ok) {
          assertEqual(cleanupRes.data.cleanedCount, 1, 'Must delete 1 verified local file');
          assertEqual(cleanupRes.data.remainingLocalCount, 0, '0 local files left');
        }

        // Download still succeeds from S3 after local cleanup
        const s3Link = await h.downloadService.createSignedDownloadLinkAsync({
          currentUser: h.member,
          contentId: item.id,
          fileId: file.id,
          activeAgeGroup: null,
        });
        assertEqual(s3Link.ok, true, 'Download from S3 must succeed after local cleanup');
        if (s3Link.ok) {
          const execS3 = await h.downloadService.executeSignedDownloadAsync({
            token: s3Link.token,
            currentUser: h.member,
            activeAgeGroup: null,
          });
          assertEqual(execS3.ok, true, 'Executing download from S3 must succeed');
        }

        // Disconnect S3 & fallback to local: controlled FILE_NOT_FOUND without crash or secret leak
        const discRes = await h.storageMigrationService.disconnectS3Async(h.superAdmin);
        assertEqual(discRes.ok, true, 'Disconnect must switch provider back to local');
        const linkAfterDisconnect = await h.downloadService.createSignedDownloadLinkAsync({
          currentUser: h.member,
          contentId: item.id,
          fileId: file.id,
          activeAgeGroup: null,
        });
        assertEqual(
          linkAfterDisconnect.ok,
          false,
          'After local cleanup & S3 disconnect, missing local file returns controlled failure',
        );
        if (!linkAfterDisconnect.ok) {
          assertEqual(
            linkAfterDisconnect.errorCode,
            'FILE_NOT_FOUND',
            'Expected FILE_NOT_FOUND after disconnect when local copy was cleaned',
          );
        }

        // Verify envConfig & IndexedDB v20 + Stage 3 Seed parity if indexedDB exists
        assert(
          envConfig.databaseVersion >= 20,
          'envConfig.databaseVersion must be >= 20',
        );
        assert(
          STAGE28_OBJECT_STORES.includes(STORE_NAMES.S3_BUCKET_OBJECTS),
          'STAGE28_OBJECT_STORES must include s3BucketObjects',
        );

        if (typeof indexedDB !== 'undefined') {
          const tempDb = `MerajAndishehDB_Stage28_${Date.now()}`;
          const tempStore = new IndexedDbDataStore(
            tempDb,
            envConfig.databaseVersion,
            envConfig.metaStoreName,
          );
          const tempLogger = new AppLogger(
            h.clock,
            `meraj_stage28_idb_log_${Date.now()}`,
            20,
          );
          const seeder = new DatabaseSeeder(tempStore, tempLogger);
          try {
            const seedResult = await seeder.seed();
            const stores = await tempStore.getObjectStoreNames();
            assert(
              stores.includes(STORE_NAMES.S3_BUCKET_OBJECTS),
              'IndexedDB v20 must include s3BucketObjects store',
            );
            assertEqual(
              seedResult.summary.siteSettings,
              8,
              'Stage 3 SiteSettings seed count must remain 8',
            );
          } finally {
            tempLogger.clearLogs();
            tempStore.close();
            await deleteTempIndexedDatabaseAsync(tempDb);
          }
        }
      } finally {
        h.cleanup();
      }
    },
  },
];
