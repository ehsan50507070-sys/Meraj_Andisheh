import type { IAdminRepository } from '../core/abstractions/adminRepository';
import type { IFileStorage } from '../core/abstractions/fileStorage';
import type { IClock } from '../core/abstractions/IClock';
import type { AppUser } from '../core/domain/auth';
import type { StaffPermission } from '../core/domain/permissions';
import type { FeatureFlag, SiteSetting } from '../core/domain/settings';
import type { FileSaveRequest, StoredFileMetadata } from '../core/domain/storage';
import type { AgeGroup } from '../core/domain/taxonomy';
import { FileUploadService } from '../core/services/fileUploadService';
import {
  extractNormalizedExtension,
  getCategoryForExtension,
  getMimeTypeForExtension,
} from '../core/services/fileValidationService';
import { PermissionPolicyService } from '../core/services/permissionPolicyService';
import { SystemClock } from '../infrastructure/clock/SystemClock';
import { envConfig } from '../infrastructure/config/envConfig';
import { IndexedDbDataStore } from '../infrastructure/data/IndexedDbDataStore';
import {
  DATABASE_MIGRATIONS,
  STAGE7_OBJECT_STORES,
  STORE_NAMES,
} from '../infrastructure/data/migrations';
import {
  INITIAL_AGE_GROUPS,
  INITIAL_FEATURE_FLAGS,
  INITIAL_SITE_SETTINGS,
} from '../infrastructure/data/seed';
import { AppLogger } from '../infrastructure/logging/AppLogger';
import { LocalIndexedDbFileStorage } from '../infrastructure/storage/LocalIndexedDbFileStorage';
import { assert, assertEqual, type UnitTestCase } from './testRunner';

class Stage7FakeClock implements IClock {
  private readonly iso = '2026-09-01T08:30:00.000Z';
  private readonly helperClock = new SystemClock();

  public now(): Date {
    return new Date(this.iso);
  }
  public nowUtcIso(): string {
    return this.iso;
  }
  public nowJalali(): string {
    return this.helperClock.toJalali(this.now());
  }
  public toJalali(date: Date): string {
    return this.helperClock.toJalali(date);
  }
}

function generateTestUuid(counter: number): string {
  const hex = counter.toString(16).padStart(12, '0');
  return `11111111-2222-4333-8444-${hex}`;
}

class MemoryFileStorage implements IFileStorage {
  private readonly entries = new Map<
    string,
    { bytes: Uint8Array; metadata: StoredFileMetadata }
  >();
  private readonly clock: IClock;
  private seq = 1;

  constructor(clock: IClock) {
    this.clock = clock;
  }

  public async saveAsync(request: FileSaveRequest): Promise<StoredFileMetadata> {
    const ext = extractNormalizedExtension(request.originalFileName) ?? 'bin';
    const uuid = generateTestUuid(this.seq++);
    const prefix = request.visibility === 'public' ? 'public/thumb' : 'private/vault';
    const storageKey = `${prefix}/${uuid}.${ext}`;

    const copy = new Uint8Array(request.bytes.byteLength);
    copy.set(request.bytes);

    const metadata: StoredFileMetadata = {
      storageKey,
      originalFileName: request.originalFileName,
      extension: ext,
      mimeType: request.contentType || getMimeTypeForExtension(ext),
      sizeBytes: copy.byteLength,
      visibility: request.visibility,
      category: getCategoryForExtension(ext) ?? 'document',
      uploadedById: request.uploadedById ?? null,
      createdAt: this.clock.nowUtcIso(),
    };

    this.entries.set(storageKey, { bytes: copy, metadata });
    return { ...metadata };
  }

  public async openReadAsync(
    storageKey: string,
  ): Promise<{ bytes: Uint8Array; metadata: StoredFileMetadata } | null> {
    const found = this.entries.get(storageKey);
    if (!found) {
      return null;
    }
    const copy = new Uint8Array(found.bytes.byteLength);
    copy.set(found.bytes);
    return { bytes: copy, metadata: { ...found.metadata } };
  }

  public async openReadRangeAsync(
    storageKey: string,
    startByte: number,
    endByte: number,
  ) {
    const found = this.entries.get(storageKey);
    if (!found) {
      return null;
    }
    const totalBytes = found.bytes.byteLength;
    const safeStart = Math.max(0, Math.min(Math.floor(startByte), Math.max(0, totalBytes - 1)));
    const safeEnd = Math.max(safeStart, Math.min(Math.floor(endByte), Math.max(0, totalBytes - 1)));
    const sliced = totalBytes === 0 ? new Uint8Array(0) : found.bytes.slice(safeStart, safeEnd + 1);
    return {
      chunk: sliced,
      totalBytes,
      startByte: safeStart,
      endByte: safeEnd,
      mimeType: found.metadata.mimeType,
    };
  }

  public async getMetadataAsync(storageKey: string): Promise<StoredFileMetadata | null> {
    const found = this.entries.get(storageKey);
    return found ? { ...found.metadata } : null;
  }

  public async deleteAsync(storageKey: string): Promise<void> {
    this.entries.delete(storageKey);
  }

  public async existsAsync(storageKey: string): Promise<boolean> {
    return this.entries.has(storageKey);
  }

  public async listAllMetadataAsync(): Promise<StoredFileMetadata[]> {
    return Array.from(this.entries.values()).map((entry) => ({ ...entry.metadata }));
  }
}

class MemoryStage7AdminRepository implements IAdminRepository {
  public users: AppUser[] = [];
  public staffPermissions: StaffPermission[] = [];
  public featureFlags: FeatureFlag[] = INITIAL_FEATURE_FLAGS.map((f) => ({ ...f }));
  public siteSettings: SiteSetting[] = INITIAL_SITE_SETTINGS.map((s) => ({ ...s }));
  private nextUserId = 1;
  private nextPermId = 1;

  public async getUserById(id: number): Promise<AppUser | null> {
    return this.users.find((u) => u.id === id) ?? null;
  }
  public async getUserByNormalizedEmail(email: string): Promise<AppUser | null> {
    return this.users.find((u) => u.normalizedEmail === email) ?? null;
  }
  public async getUserByNormalizedPhoneNumber(phone: string): Promise<AppUser | null> {
    return this.users.find((u) => u.normalizedPhoneNumber === phone) ?? null;
  }
  public async getAllUsers(): Promise<AppUser[]> {
    return [...this.users];
  }
  public async createUser(user: Omit<AppUser, 'id'>): Promise<AppUser> {
    const created: AppUser = { ...user, id: this.nextUserId++ };
    this.users.push(created);
    return created;
  }
  public async updateUser(user: AppUser): Promise<void> {
    const idx = this.users.findIndex((u) => u.id === user.id);
    if (idx !== -1) this.users[idx] = { ...user };
  }
  public async deleteSessionsByUserId(): Promise<void> {}
  public async getStaffPermissionsByUserId(userId: number): Promise<StaffPermission[]> {
    return this.staffPermissions.filter((p) => p.userId === userId);
  }
  public async replaceStaffPermissions(
    userId: number,
    permissions: Omit<StaffPermission, 'id'>[],
  ): Promise<StaffPermission[]> {
    this.staffPermissions = this.staffPermissions.filter((p) => p.userId !== userId);
    const created = permissions.map((p) => ({ ...p, id: this.nextPermId++ }));
    this.staffPermissions.push(...created);
    return created;
  }
  public async getAllFeatureFlags(): Promise<FeatureFlag[]> {
    return [...this.featureFlags];
  }
  public async upsertFeatureFlag(flag: FeatureFlag): Promise<void> {
    const idx = this.featureFlags.findIndex((f) => f.key === flag.key);
    if (idx === -1) this.featureFlags.push({ ...flag });
    else this.featureFlags[idx] = { ...flag };
  }
  public async getAllSiteSettings(): Promise<SiteSetting[]> {
    return [...this.siteSettings];
  }
  public async getSiteSettingByKey(key: string): Promise<SiteSetting | null> {
    const found = this.siteSettings.find((s) => s.key === key);
    return found ? { ...found } : null;
  }
  public async upsertSiteSettings(settings: SiteSetting[]): Promise<void> {
    for (const setting of settings) {
      const idx = this.siteSettings.findIndex((s) => s.key === setting.key);
      if (idx === -1) this.siteSettings.push({ ...setting });
      else this.siteSettings[idx] = { ...setting };
    }
  }
  public async getActiveAgeGroups(): Promise<AgeGroup[]> {
    return [...INITIAL_AGE_GROUPS];
  }
}

async function createStage7Harness() {
  const clock = new Stage7FakeClock();
  const repo = new MemoryStage7AdminRepository();
  const logger = new AppLogger(clock, `meraj_stage7_test_${Date.now()}`, 50);
  logger.clearLogs();
  const fileStorage = new MemoryFileStorage(clock);
  const policyService = new PermissionPolicyService(repo, logger);
  const uploadService = new FileUploadService(fileStorage, repo, policyService, logger);

  const superAdmin = await repo.createUser({
    email: 'admin@example.com',
    normalizedEmail: 'admin@example.com',
    emailConfirmed: true,
    phoneNumber: null,
    normalizedPhoneNumber: null,
    phoneNumberConfirmed: false,
    passwordHash: 'hash',
    passwordSalt: 'salt',
    displayName: 'مدیر کل',
    ageGroupId: null,
    personalizationEnabled: true,
    mustChangePassword: false,
    isActive: true,
    role: 'SuperAdmin',
    failedLoginCount: 0,
    lockoutEnd: null,
    createdAt: clock.nowUtcIso(),
    lastLoginAt: null,
  });

  const contentStaff = await repo.createUser({
    email: 'staff@example.com',
    normalizedEmail: 'staff@example.com',
    emailConfirmed: true,
    phoneNumber: null,
    normalizedPhoneNumber: null,
    phoneNumberConfirmed: false,
    passwordHash: 'hash',
    passwordSalt: 'salt',
    displayName: 'همکار محتوا',
    ageGroupId: null,
    personalizationEnabled: true,
    mustChangePassword: false,
    isActive: true,
    role: 'Staff',
    failedLoginCount: 0,
    lockoutEnd: null,
    createdAt: clock.nowUtcIso(),
    lastLoginAt: null,
  });
  await repo.replaceStaffPermissions(contentStaff.id, [
    {
      userId: contentStaff.id,
      permissionKey: 'content.manage',
      grantedAt: clock.nowUtcIso(),
      grantedById: superAdmin.id,
    },
  ]);

  const otherStaff = await repo.createUser({
    email: 'comments@example.com',
    normalizedEmail: 'comments@example.com',
    emailConfirmed: true,
    phoneNumber: null,
    normalizedPhoneNumber: null,
    phoneNumberConfirmed: false,
    passwordHash: 'hash',
    passwordSalt: 'salt',
    displayName: 'همکار نظرات',
    ageGroupId: null,
    personalizationEnabled: true,
    mustChangePassword: false,
    isActive: true,
    role: 'Staff',
    failedLoginCount: 0,
    lockoutEnd: null,
    createdAt: clock.nowUtcIso(),
    lastLoginAt: null,
  });
  await repo.replaceStaffPermissions(otherStaff.id, [
    {
      userId: otherStaff.id,
      permissionKey: 'comments.moderate',
      grantedAt: clock.nowUtcIso(),
      grantedById: superAdmin.id,
    },
  ]);

  return {
    clock,
    repo,
    logger,
    fileStorage,
    uploadService,
    superAdmin,
    contentStaff,
    otherStaff,
  };
}

const VALID_PDF_BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a]);
const VALID_PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
const VALID_JPG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const VALID_WEBP_BYTES = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
]);
const VALID_MP4_BYTES = new Uint8Array([
  0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x6d, 0x70, 0x34, 0x32,
]);
const VALID_MP3_BYTES = new Uint8Array([0x49, 0x44, 0x33, 0x03, 0x00, 0x00]);
const VALID_ZIP_BYTES = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]);
const EXE_MZ_BYTES = new Uint8Array([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00]);

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) return false;
  for (let i = 0; i < a.byteLength; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

export const stage7Tests: UnitTestCase[] = [
  {
    id: 'stage7-valid-pdf-upload',
    nameKey: 'tests.stage7.validPdfUpload.name',
    descriptionKey: 'tests.stage7.validPdfUpload.desc',
    run: async () => {
      assert(
        DATABASE_MIGRATIONS.some((m) => m.version === 6),
        'Migration version 6 must be registered',
      );
      assert(
        STAGE7_OBJECT_STORES.includes(STORE_NAMES.STORED_FILES),
        'STAGE7_OBJECT_STORES must include storedFiles',
      );

      const h = await createStage7Harness();
      try {
        const res = await h.uploadService.uploadFileAsync(h.contentStaff, {
          originalFileName: 'secret-report-name.pdf',
          bytes: VALID_PDF_BYTES,
          visibility: 'private',
        });

        assertEqual(res.ok, true, 'Valid PDF upload must succeed');
        const key = res.metadata!.storageKey;
        assert(
          /^private\/vault\/[0-9a-f-]{36}\.pdf$/i.test(key),
          `Storage key must follow UUID format without original filename (got ${key})`,
        );
        assert(
          !key.includes('secret-report-name'),
          'Original file name must never appear in storageKey',
        );
        assertEqual(
          res.metadata!.originalFileName,
          'secret-report-name.pdf',
          'Original filename must be kept only in metadata',
        );
        assertEqual(
          await h.fileStorage.existsAsync(key),
          true,
          'existsAsync must return true after save',
        );
        const readBack = await h.fileStorage.openReadAsync(key);
        assert(readBack !== null, 'openReadAsync must return saved file');
        assert(
          bytesEqual(readBack!.bytes, VALID_PDF_BYTES),
          'Read bytes must exactly match uploaded bytes',
        );

        if (typeof window !== 'undefined' && window.indexedDB) {
          const testDbName = `MerajStage7IdbTest_${Date.now()}`;
          const testStore = new IndexedDbDataStore(
            testDbName,
            envConfig.databaseVersion,
            envConfig.metaStoreName,
          );
          try {
            await testStore.connect();
            const stores = await testStore.getObjectStoreNames();
            assert(
              stores.includes(STORE_NAMES.STORED_FILES),
              'storedFiles object store must exist after Migration v6',
            );
            const idbStorage = new LocalIndexedDbFileStorage(testStore, h.clock);
            const savedIdb = await idbStorage.saveAsync({
              bytes: VALID_PDF_BYTES,
              originalFileName: 'idb-doc.pdf',
              contentType: 'application/pdf',
              visibility: 'private',
              uploadedById: h.superAdmin.id,
            });
            assertEqual(
              await idbStorage.existsAsync(savedIdb.storageKey),
              true,
              'LocalIndexedDbFileStorage existsAsync must be true',
            );
            const readIdb = await idbStorage.openReadAsync(savedIdb.storageKey);
            assert(
              readIdb !== null && bytesEqual(readIdb.bytes, VALID_PDF_BYTES),
              'LocalIndexedDbFileStorage must round-trip binary bytes identically',
            );
          } finally {
            testStore.close();
            window.indexedDB.deleteDatabase(testDbName);
          }
        }
      } finally {
        h.logger.clearLogs();
      }
    },
  },
  {
    id: 'stage7-renamed-exe-rejected',
    nameKey: 'tests.stage7.renamedExeRejected.name',
    descriptionKey: 'tests.stage7.renamedExeRejected.desc',
    run: async () => {
      const h = await createStage7Harness();
      try {
        const res = await h.uploadService.uploadFileAsync(h.superAdmin, {
          originalFileName: 'invoice.pdf',
          bytes: EXE_MZ_BYTES,
          visibility: 'private',
        });

        assertEqual(res.ok, false, 'Renamed MZ executable must be rejected');
        assertEqual(
          res.errorCode,
          'FILE_SIGNATURE_MISMATCH',
          'Renamed EXE as PDF must return FILE_SIGNATURE_MISMATCH',
        );
      } finally {
        h.logger.clearLogs();
      }
    },
  },
  {
    id: 'stage7-forbidden-extensions',
    nameKey: 'tests.stage7.forbiddenExtensions.name',
    descriptionKey: 'tests.stage7.forbiddenExtensions.desc',
    run: async () => {
      const h = await createStage7Harness();
      try {
        const dangerous = ['evil.exe', 'app.js', 'page.html', 'vector.svg', 'run.bat'];
        for (const name of dangerous) {
          const res = await h.uploadService.uploadFileAsync(h.superAdmin, {
            originalFileName: name,
            bytes: new Uint8Array([0x61, 0x62, 0x63, 0x64]),
            visibility: 'private',
          });
          assertEqual(res.ok, false, `Forbidden file ${name} must be rejected`);
          assertEqual(
            res.errorCode,
            'FORBIDDEN_EXTENSION',
            `${name} must fail with FORBIDDEN_EXTENSION`,
          );
        }
      } finally {
        h.logger.clearLogs();
      }
    },
  },
  {
    id: 'stage7-magic-bytes-formats',
    nameKey: 'tests.stage7.magicBytesFormats.name',
    descriptionKey: 'tests.stage7.magicBytesFormats.desc',
    run: async () => {
      const h = await createStage7Harness();
      try {
        const validSamples: Array<{ name: string; bytes: Uint8Array }> = [
          { name: 'cover.png', bytes: VALID_PNG_BYTES },
          { name: 'photo.jpg', bytes: VALID_JPG_BYTES },
          { name: 'banner.webp', bytes: VALID_WEBP_BYTES },
          { name: 'clip.mp4', bytes: VALID_MP4_BYTES },
          { name: 'audio.mp3', bytes: VALID_MP3_BYTES },
          { name: 'slides.docx', bytes: VALID_ZIP_BYTES },
          { name: 'bundle.zip', bytes: VALID_ZIP_BYTES },
        ];

        for (const sample of validSamples) {
          const okRes = await h.uploadService.uploadFileAsync(h.superAdmin, {
            originalFileName: sample.name,
            bytes: sample.bytes,
            visibility: 'private',
          });
          assertEqual(okRes.ok, true, `Valid ${sample.name} must succeed`);

          const bogusRes = await h.uploadService.uploadFileAsync(h.superAdmin, {
            originalFileName: sample.name,
            bytes: new Uint8Array([0x3c, 0x73, 0x76, 0x67, 0x3e]), // <svg>
            visibility: 'private',
          });
          assertEqual(bogusRes.ok, false, `Spoofed ${sample.name} must be rejected`);
          assertEqual(
            bogusRes.errorCode,
            'FILE_SIGNATURE_MISMATCH',
            `Spoofed ${sample.name} must return FILE_SIGNATURE_MISMATCH`,
          );
        }
      } finally {
        h.logger.clearLogs();
      }
    },
  },
  {
    id: 'stage7-size-limits',
    nameKey: 'tests.stage7.sizeLimits.name',
    descriptionKey: 'tests.stage7.sizeLimits.desc',
    run: async () => {
      const h = await createStage7Harness();
      try {
        const overOther = await h.uploadService.uploadFileAsync(h.superAdmin, {
          originalFileName: 'big-doc.pdf',
          bytes: VALID_PDF_BYTES,
          visibility: 'private',
          overrideSizeBytes: 101 * 1024 * 1024,
        });
        assertEqual(overOther.ok, false, '101MB PDF must exceed 100MB limit');
        assertEqual(
          overOther.errorCode,
          'FILE_TOO_LARGE',
          '101MB PDF must fail with FILE_TOO_LARGE',
        );

        const okVideo = await h.uploadService.uploadFileAsync(h.superAdmin, {
          originalFileName: 'ok-video.mp4',
          bytes: VALID_MP4_BYTES,
          visibility: 'private',
          overrideSizeBytes: 450 * 1024 * 1024,
        });
        assertEqual(okVideo.ok, true, '450MB MP4 must fit within 500MB video limit');

        const overVideo = await h.uploadService.uploadFileAsync(h.superAdmin, {
          originalFileName: 'huge-video.mp4',
          bytes: VALID_MP4_BYTES,
          visibility: 'private',
          overrideSizeBytes: 501 * 1024 * 1024,
        });
        assertEqual(overVideo.ok, false, '501MB MP4 must exceed 500MB video limit');
        assertEqual(
          overVideo.errorCode,
          'FILE_TOO_LARGE',
          '501MB MP4 must fail with FILE_TOO_LARGE',
        );

        // Dynamic SiteSetting check
        await h.repo.upsertSiteSettings([{ key: 'Upload.MaxOtherMb', value: '5' }]);
        const dynamicRejected = await h.uploadService.uploadFileAsync(h.superAdmin, {
          originalFileName: 'medium-doc.pdf',
          bytes: VALID_PDF_BYTES,
          visibility: 'private',
          overrideSizeBytes: 6 * 1024 * 1024,
        });
        assertEqual(dynamicRejected.ok, false, 'Dynamic SiteSetting limit 5MB must reject 6MB PDF');
        assertEqual(
          dynamicRejected.errorCode,
          'FILE_TOO_LARGE',
          '6MB PDF over 5MB limit must fail with FILE_TOO_LARGE',
        );
      } finally {
        h.logger.clearLogs();
      }
    },
  },
  {
    id: 'stage7-public-private-isolation',
    nameKey: 'tests.stage7.publicPrivateIsolation.name',
    descriptionKey: 'tests.stage7.publicPrivateIsolation.desc',
    run: async () => {
      const h = await createStage7Harness();
      try {
        const publicPng = await h.uploadService.uploadFileAsync(h.contentStaff, {
          originalFileName: 'thumb.png',
          bytes: VALID_PNG_BYTES,
          visibility: 'public',
        });
        assertEqual(publicPng.ok, true, 'Public PNG thumbnail upload must succeed');
        assert(
          publicPng.metadata!.storageKey.startsWith('public/thumb/'),
          'Public thumbnail key must start with public/thumb/',
        );

        const publicOpen = await h.uploadService.openPublicMediaAsync(
          publicPng.metadata!.storageKey,
        );
        assertEqual(publicOpen.ok, true, 'Public PNG must open via public media guard');
        assert(
          bytesEqual(publicOpen.bytes!, VALID_PNG_BYTES),
          'Public media route must return exact image bytes',
        );

        const privatePdf = await h.uploadService.uploadFileAsync(h.contentStaff, {
          originalFileName: 'private-book.pdf',
          bytes: VALID_PDF_BYTES,
          visibility: 'private',
        });
        assertEqual(privatePdf.ok, true, 'Private PDF upload must succeed');

        h.logger.clearLogs();
        const blockedPrivateOpen = await h.uploadService.openPublicMediaAsync(
          privatePdf.metadata!.storageKey,
        );
        assertEqual(
          blockedPrivateOpen.ok,
          false,
          'Private PDF must be blocked from public media route',
        );
        assertEqual(
          h.logger.getLogs().filter((l) => l.level === 'WARN').length,
          1,
          'Unauthorized public access to private file must be logged as WARN',
        );

        const pdfAsPublic = await h.uploadService.uploadFileAsync(h.superAdmin, {
          originalFileName: 'not-allowed-public.pdf',
          bytes: VALID_PDF_BYTES,
          visibility: 'public',
        });
        assertEqual(pdfAsPublic.ok, false, 'PDF upload with public visibility must be rejected');
        assertEqual(
          pdfAsPublic.errorCode,
          'PUBLIC_ONLY_IMAGES_ALLOWED',
          'Non-image in public space must return PUBLIC_ONLY_IMAGES_ALLOWED',
        );

        // Unauthorized staff cannot upload via admin storage tool
        const unauthStaffRes = await h.uploadService.uploadFileAsync(h.otherStaff, {
          originalFileName: 'doc.pdf',
          bytes: VALID_PDF_BYTES,
          visibility: 'private',
        });
        assertEqual(unauthStaffRes.statusCode, 403, 'Staff without content/settings must get 403');
      } finally {
        h.logger.clearLogs();
      }
    },
  },
  {
    id: 'stage7-delete-file',
    nameKey: 'tests.stage7.deleteFile.name',
    descriptionKey: 'tests.stage7.deleteFile.desc',
    run: async () => {
      const h = await createStage7Harness();
      try {
        const res = await h.uploadService.uploadFileAsync(h.superAdmin, {
          originalFileName: 'to-delete.pdf',
          bytes: VALID_PDF_BYTES,
          visibility: 'private',
        });
        assertEqual(res.ok, true, 'Initial file upload must succeed');
        const key = res.metadata!.storageKey;

        assertEqual(
          await h.fileStorage.existsAsync(key),
          true,
          'File must exist before delete',
        );
        const delRes = await h.uploadService.deleteFileAsync(h.superAdmin, key);
        assertEqual(delRes.ok, true, 'deleteFileAsync must succeed');
        assertEqual(
          await h.fileStorage.existsAsync(key),
          false,
          'existsAsync must be false after deleteAsync',
        );
        assertEqual(
          await h.fileStorage.openReadAsync(key),
          null,
          'openReadAsync must return null after deleteAsync',
        );
      } finally {
        h.logger.clearLogs();
      }
    },
  },
];
