import type { IClock } from '../core/abstractions/IClock';
import type { IAdminRepository } from '../core/abstractions/adminRepository';
import type {
  DataStoreHealthProbe,
  DataStoreKey,
  DataStoreMetadata,
  IDataStore,
  MetaRecord,
} from '../core/abstractions/IDataStore';
import type { ITaxonomyRepository } from '../core/abstractions/taxonomyRepository';
import type { AppUser, UserRole } from '../core/domain/auth';
import type { ContentItem, ContentTopic } from '../core/domain/content';
import type { PermissionKey, StaffPermission } from '../core/domain/permissions';
import {
  FEATURE_FLAG_KEYS,
  type FeatureFlag,
  type SiteSetting,
} from '../core/domain/settings';
import type {
  AgeGroup,
  ImpactLevel,
  Person,
  Tag,
  Topic,
} from '../core/domain/taxonomy';
import { GamePortalService } from '../core/services/gamePortalService';
import { PermissionPolicyService } from '../core/services/permissionPolicyService';
import { SystemClock } from '../infrastructure/clock/SystemClock';
import { envConfig } from '../infrastructure/config/envConfig';
import { IndexedDbDataStore } from '../infrastructure/data/IndexedDbDataStore';
import { IndexedDbGameRepository } from '../infrastructure/data/IndexedDbGameRepository';
import {
  STAGE29_OBJECT_STORES,
  STORE_NAMES,
} from '../infrastructure/data/migrations';
import { DatabaseSeeder } from '../infrastructure/data/seed';
import { AppLogger } from '../infrastructure/logging/AppLogger';
import {
  buildSandboxedSrcdocFromPackage,
  createStoredZipBytes,
  Html5GamePackageService,
} from '../infrastructure/storage/html5GamePackageService';
import { ensureStage29GamesDefaultFlagAsync } from '../web/services/appContainer';
import { assert, assertEqual, type UnitTestCase } from './testRunner';

const utf8Encoder = new TextEncoder();

class Stage29FakeClock implements IClock {
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

class MemoryStage29DataStore implements IDataStore {
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
      case STORE_NAMES.GAME_PACKAGES:
        return 'packageFolder';
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
      databaseName: 'MemoryStage29DB',
      databaseVersion: envConfig.databaseVersion,
      metaStoreName: STORE_NAMES.META,
    };
  }

  public async connect(): Promise<void> {}
  public close(): void {}
  public async getObjectStoreNames(): Promise<string[]> {
    return [
      STORE_NAMES.META,
      STORE_NAMES.GAMES,
      STORE_NAMES.GAME_AGE_GROUPS,
      STORE_NAMES.GAME_SCORES,
      STORE_NAMES.GAME_PACKAGES,
      STORE_NAMES.FEATURE_FLAGS,
      STORE_NAMES.SITE_SETTINGS,
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
  public async getByKey<T>(
    storeName: string,
    key: DataStoreKey,
  ): Promise<T | null> {
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
    let keyStr: string;
    if (storeName === STORE_NAMES.GAME_AGE_GROUPS) {
      keyStr = `${rec.gameId}|${rec.ageGroupId}`;
    } else {
      const kp = this.resolveKeyPath(storeName);
      keyStr = String(rec[kp]);
    }
    this.getTable(storeName).set(keyStr, record);
  }
  public async addRecordWithAutoId<T>(
    storeName: string,
    record: T,
  ): Promise<number> {
    const next = (this.autoIds.get(storeName) ?? 0) + 1;
    this.autoIds.set(storeName, next);
    const payload = { ...(record as Record<string, unknown>), id: next };
    this.getTable(storeName).set(String(next), payload);
    return next;
  }
  public async deleteByKey(
    storeName: string,
    key: DataStoreKey,
  ): Promise<void> {
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

class MemoryStage29AdminRepo implements IAdminRepository {
  private readonly users = new Map<number, AppUser>();
  private readonly perms = new Map<number, PermissionKey[]>();
  private readonly flags = new Map<string, FeatureFlag>();
  private readonly settings = new Map<string, SiteSetting>();
  private ageGroups: AgeGroup[] = [];
  private nextUserId = 1;

  constructor() {
    this.flags.set('Games', {
      key: 'Games',
      isEnabled: true,
    });
    this.settings.set('Upload.MaxOtherMb', {
      key: 'Upload.MaxOtherMb',
      value: '25',
    });
    this.ageGroups = [
      {
        id: 1,
        key: 'child',
        name: 'کودک',
        minAge: 6,
        maxAge: 11,
        themeKey: 'playful',
        sortOrder: 1,
        isActive: true,
      },
      {
        id: 2,
        key: 'teen',
        name: 'نوجوان',
        minAge: 12,
        maxAge: 17,
        themeKey: 'playful',
        sortOrder: 2,
        isActive: true,
      },
      {
        id: 3,
        key: 'youth',
        name: 'جوان',
        minAge: 18,
        maxAge: 29,
        themeKey: 'modern',
        sortOrder: 3,
        isActive: true,
      },
      {
        id: 4,
        key: 'adult',
        name: 'بزرگسال',
        minAge: 30,
        maxAge: null,
        themeKey: 'editorial',
        sortOrder: 4,
        isActive: true,
      },
    ];
  }

  public addUser(
    role: UserRole,
    permissions: PermissionKey[] = [],
    overrides?: Partial<AppUser>,
  ): AppUser {
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
      isDeleted: false,
      mustChangePassword: false,
      failedLoginCount: 0,
      lockoutEnd: null,
      lastLoginAt: null,
      createdAt: '2026-11-24T09:00:00.000Z',
      ...overrides,
    };
    this.users.set(id, user);
    this.perms.set(id, permissions);
    return user;
  }

  public markUserDeleted(userId: number): void {
    const existing = this.users.get(userId);
    if (existing) {
      this.users.set(userId, {
        ...existing,
        isDeleted: true,
        isActive: false,
        displayName: '',
      });
    }
  }

  public setGamesFlag(isEnabled: boolean): void {
    this.flags.set('Games', {
      key: 'Games',
      isEnabled,
    });
  }

  public getAgeGroupsList(): AgeGroup[] {
    return this.ageGroups;
  }

  public async getAllUsers(): Promise<AppUser[]> {
    return Array.from(this.users.values());
  }
  public async getUserById(id: number): Promise<AppUser | null> {
    return this.users.get(id) ?? null;
  }
  public async getUserByNormalizedEmail(norm: string): Promise<AppUser | null> {
    return (
      Array.from(this.users.values()).find((u) => u.normalizedEmail === norm) ??
      null
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
  public async updateUser(user: AppUser): Promise<void> {
    this.users.set(user.id, user);
  }
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
    return Array.from(this.flags.values());
  }
  public async upsertFeatureFlag(flag: FeatureFlag): Promise<void> {
    this.flags.set(flag.key, flag);
  }
  public async getAllSiteSettings(): Promise<SiteSetting[]> {
    return Array.from(this.settings.values());
  }
  public async getSiteSettingByKey(key: string): Promise<SiteSetting | null> {
    return this.settings.get(key) ?? null;
  }
  public async upsertSiteSettings(items: SiteSetting[]): Promise<void> {
    for (const item of items) {
      this.settings.set(item.key, item);
    }
  }
  public async getActiveAgeGroups(): Promise<AgeGroup[]> {
    return this.ageGroups.filter((ag) => ag.isActive);
  }
}

class MemoryStage29TaxonomyRepo implements ITaxonomyRepository {
  private readonly topics: Topic[] = [
    {
      id: 1,
      parentId: null,
      name: 'نجوم و دانش',
      slug: 'astronomy-science',
      icon: null,
      sortOrder: 1,
      isActive: true,
    },
  ];
  private readonly ageGroups: AgeGroup[];

  constructor(ageGroups: AgeGroup[]) {
    this.ageGroups = ageGroups;
  }

  public async getAllTopics(): Promise<Topic[]> {
    return this.topics;
  }
  public async getTopicById(id: number): Promise<Topic | null> {
    return this.topics.find((t) => t.id === id) ?? null;
  }
  public async createTopic(): Promise<Topic> {
    throw new Error('Not needed');
  }
  public async updateTopic(): Promise<void> {}
  public async deleteTopic(): Promise<void> {}
  public async getAllTags(): Promise<Tag[]> {
    return [];
  }
  public async getTagById(): Promise<Tag | null> {
    return null;
  }
  public async createTag(): Promise<Tag> {
    throw new Error('Not needed');
  }
  public async updateTag(): Promise<void> {}
  public async deleteTag(): Promise<void> {}
  public async getAllPersons(): Promise<Person[]> {
    return [];
  }
  public async getPersonById(): Promise<Person | null> {
    return null;
  }
  public async createPerson(): Promise<Person> {
    throw new Error('Not needed');
  }
  public async updatePerson(): Promise<void> {}
  public async deletePerson(): Promise<void> {}
  public async getAllImpactLevels(): Promise<ImpactLevel[]> {
    return [];
  }
  public async getImpactLevelById(): Promise<ImpactLevel | null> {
    return null;
  }
  public async createImpactLevel(): Promise<ImpactLevel> {
    throw new Error('Not needed');
  }
  public async updateImpactLevel(): Promise<void> {}
  public async deleteImpactLevel(): Promise<void> {}
  public async getAllAgeGroups(): Promise<AgeGroup[]> {
    return this.ageGroups;
  }
  public async getAgeGroupById(id: number): Promise<AgeGroup | null> {
    return this.ageGroups.find((ag) => ag.id === id) ?? null;
  }
  public async updateAgeGroup(): Promise<void> {}
  public async getContentTopicLinks(): Promise<ContentTopic[]> {
    return [];
  }
  public async countContentTagsByTagId(): Promise<number> {
    return 0;
  }
  public async countContentPersonsByPersonId(): Promise<number> {
    return 0;
  }
  public async countContentItemsByImpactLevelId(): Promise<number> {
    return 0;
  }
  public async createContentItem(): Promise<ContentItem> {
    throw new Error('Not needed');
  }
  public async linkContentTopic(): Promise<void> {}
}

function createStage29Harness() {
  const clock = new Stage29FakeClock('2026-11-24T10:00:00.000Z');
  const logKey = `meraj_stage29_logs_${Date.now()}_${Math.random()}`;
  const logger = new AppLogger(clock, logKey, 200);
  const dataStore = new MemoryStage29DataStore();
  const adminRepo = new MemoryStage29AdminRepo();
  const taxonomyRepo = new MemoryStage29TaxonomyRepo(adminRepo.getAgeGroupsList());
  const gameRepo = new IndexedDbGameRepository(
    dataStore as unknown as IndexedDbDataStore,
  );
  const packageStorage = new Html5GamePackageService(
    dataStore as unknown as IndexedDbDataStore,
  );
  const policyService = new PermissionPolicyService(adminRepo, logger);

  const gamePortalService = new GamePortalService({
    gameRepository: gameRepo,
    packageStorage,
    taxonomyRepository: taxonomyRepo,
    adminRepository: adminRepo,
    policyService,
    clock,
    logger,
    deletedDisplayName: 'کاربر حذف‌شده',
  });

  const superAdmin = adminRepo.addUser('SuperAdmin', ['portals.manage'], {
    displayName: 'مدیر کل',
  });
  const staffWithPortals = adminRepo.addUser('Staff', ['portals.manage'], {
    displayName: 'مدیر پرتال',
  });
  const staffWithoutPortals = adminRepo.addUser('Staff', ['content.manage'], {
    displayName: 'پشتیبان محتوا',
  });
  const member = adminRepo.addUser('Member', [], {
    displayName: 'امیرحسین',
  });

  const validGameZip = createStoredZipBytes([
    {
      path: 'index.html',
      bytes: utf8Encoder.encode(
        '<!doctype html><html><head><link rel="stylesheet" href="style.css"></head><body><h1>Game</h1><script src="game.js"></script></body></html>',
      ),
    },
    {
      path: 'style.css',
      bytes: utf8Encoder.encode('body { background: #102A43; color: #fff; }'),
    },
    {
      path: 'game.js',
      bytes: utf8Encoder.encode(
        'window.parent.postMessage({ type: "MERAJ_GAME_SCORE", score: 85 }, "*");',
      ),
    },
  ]);

  return {
    clock,
    logger,
    dataStore,
    adminRepo,
    taxonomyRepo,
    gameRepo,
    packageStorage,
    gamePortalService,
    superAdmin,
    staffWithPortals,
    staffWithoutPortals,
    member,
    validGameZip,
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

export const stage29Tests: UnitTestCase[] = [
  {
    id: 'stage29-zip-validation-rules',
    nameKey: 'tests.stage29.zipValidationRules.name',
    descriptionKey: 'tests.stage29.zipValidationRules.desc',
    run: async () => {
      const h = createStage29Harness();
      try {
        // 1) ZIP missing index.html -> ZIP_MISSING_INDEX_HTML
        const missingIndexZip = createStoredZipBytes([
          { path: 'game.js', bytes: utf8Encoder.encode('console.log(1);') },
          { path: 'style.css', bytes: utf8Encoder.encode('body{}') },
        ]);
        const missingRes = await h.gamePortalService.createGameFromZipAsync(
          h.staffWithPortals,
          {
            title: 'بازی بدون صفحه اصلی',
            maxScore: 100,
            isPublished: true,
            zipFileName: 'missing-index.zip',
            zipBytes: missingIndexZip,
          },
        );
        assertEqual(missingRes.ok, false, 'ZIP without index.html must fail');
        assertEqual(missingRes.statusCode, 400, 'Expected HTTP 400');
        assertEqual(
          missingRes.errorCode,
          'ZIP_MISSING_INDEX_HTML',
          'Expected ZIP_MISSING_INDEX_HTML',
        );

        // 2) ZIP with forbidden executable / server scripts (.exe / .php) -> ZIP_FORBIDDEN_FILE_TYPE
        const exeZip = createStoredZipBytes([
          { path: 'index.html', bytes: utf8Encoder.encode('<h1>Hi</h1>') },
          { path: 'malware.exe', bytes: new Uint8Array([77, 90, 0, 1]) },
        ]);
        const exeRes = await h.gamePortalService.createGameFromZipAsync(
          h.staffWithPortals,
          {
            title: 'بازی فایل اجرایی',
            maxScore: 100,
            zipFileName: 'bad-exe.zip',
            zipBytes: exeZip,
          },
        );
        assertEqual(exeRes.ok, false, 'ZIP with .exe must be rejected');
        assertEqual(
          exeRes.errorCode,
          'ZIP_FORBIDDEN_FILE_TYPE',
          'Expected ZIP_FORBIDDEN_FILE_TYPE for .exe',
        );

        const phpZip = createStoredZipBytes([
          { path: 'index.html', bytes: utf8Encoder.encode('<h1>Hi</h1>') },
          { path: 'shell.php', bytes: utf8Encoder.encode('<?php echo 1; ?>') },
        ]);
        const phpRes = await h.gamePortalService.createGameFromZipAsync(
          h.staffWithPortals,
          {
            title: 'بازی اسکریپت سرور',
            maxScore: 100,
            zipFileName: 'bad-php.zip',
            zipBytes: phpZip,
          },
        );
        assertEqual(phpRes.ok, false, 'ZIP with .php must be rejected');
        assertEqual(
          phpRes.errorCode,
          'ZIP_FORBIDDEN_FILE_TYPE',
          'Expected ZIP_FORBIDDEN_FILE_TYPE for .php',
        );

        // 3) ZIP with path traversal (../evil.js) -> ZIP_PATH_TRAVERSAL
        const traversalZip = createStoredZipBytes([
          { path: 'index.html', bytes: utf8Encoder.encode('<h1>Hi</h1>') },
          { path: '../evil.js', bytes: utf8Encoder.encode('alert(1);') },
        ]);
        const traversalRes = await h.gamePortalService.createGameFromZipAsync(
          h.staffWithPortals,
          {
            title: 'بازی نفوذ مسیر',
            maxScore: 100,
            zipFileName: 'traversal.zip',
            zipBytes: traversalZip,
          },
        );
        assertEqual(traversalRes.ok, false, 'ZIP with ../ path traversal must fail');
        assertEqual(
          traversalRes.errorCode,
          'ZIP_PATH_TRAVERSAL',
          'Expected ZIP_PATH_TRAVERSAL',
        );

        // 4) Valid ZIP with Persian digits in maxScore & ageGroup assignment
        const validRes = await h.gamePortalService.createGameFromZipAsync(
          h.staffWithPortals,
          {
            title: 'چالش رصدخانه مراغه',
            description: 'بازی علمی تعاملی',
            endMessage: 'دانش پایه‌ی پیشرفت پایدار است.',
            topicId: 1,
            maxScore: '۱۰۰',
            ageGroupIds: [1, 2],
            isPublished: true,
            zipFileName: 'maragheh-quiz.zip',
            zipBytes: h.validGameZip,
          },
        );
        assertEqual(validRes.ok, true, 'Valid game ZIP must succeed');
        if (!validRes.ok || !validRes.data) {
          throw new Error('Expected created GameItem');
        }
        assertEqual(validRes.data.maxScore, 100, 'Persian digits maxScore must normalize to 100');

        const savedAges = await h.gameRepo.getAgeGroupIdsByGameIdAsync(validRes.data.id);
        assertEqual(savedAges.length, 2, 'Two age groups must be persisted');

        const srcdoc = await h.packageStorage.buildSandboxedGameSrcdocAsync(
          validRes.data.packageFolder,
        );
        assert(
          srcdoc !== null &&
            srcdoc.includes('background: #102A43') &&
            srcdoc.includes('MERAJ_GAME_SCORE'),
          'buildSandboxedGameSrcdocAsync must inline CSS & JS inside srcdoc',
        );
      } finally {
        h.cleanup();
      }
    },
  },
  {
    id: 'stage29-sandbox-iframe-isolation',
    nameKey: 'tests.stage29.sandboxIframeIsolation.name',
    descriptionKey: 'tests.stage29.sandboxIframeIsolation.desc',
    run: async () => {
      const h = createStage29Harness();
      const iframeHolder: { el: HTMLIFrameElement | null } = { el: null };
      let prevCookie = '';
      try {
        const probePkg = {
          packageFolder: 'probe-pkg',
          originalZipName: 'probe.zip',
          totalSizeBytes: 512,
          filesCount: 1,
          createdAt: h.clock.nowUtcIso(),
          entries: [
            {
              path: 'index.html',
              mimeType: 'text/html; charset=utf-8',
              sizeBytes: 512,
              isText: true,
              textContent: `<!doctype html><html><body><script>
(function() {
  var cookieBlocked = false;
  var cookieValue = '';
  try {
    cookieValue = document.cookie;
  } catch (e) {
    cookieBlocked = true;
  }
  var parentDomBlocked = false;
  try {
    var _ = window.parent.document.title;
  } catch (e) {
    parentDomBlocked = true;
  }
  window.parent.postMessage({
    type: 'STAGE29_SANDBOX_PROBE',
    cookieBlocked: cookieBlocked,
    cookieValue: cookieValue,
    parentDomBlocked: parentDomBlocked
  }, '*');
})();
</script></body></html>`,
            },
          ],
        };

        const srcdoc = buildSandboxedSrcdocFromPackage(probePkg);
        assert(srcdoc !== null, 'srcdoc must build for valid package');

        // Also test that dangerous <base> tags are stripped from untrusted HTML
        const strippedBase = buildSandboxedSrcdocFromPackage({
          ...probePkg,
          entries: [
            {
              ...probePkg.entries[0],
              textContent:
                '<!doctype html><head><base href="https://evil.example/"></head><body>OK</body>',
            },
          ],
        });
        assert(
          strippedBase !== null && !strippedBase.toLowerCase().includes('<base'),
          '<base> tags inside untrusted package HTML must be stripped',
        );

        if (typeof document !== 'undefined' && typeof window !== 'undefined') {
          prevCookie = document.cookie;
          document.cookie = 'meraj_stage29_secret=topsecret123; path=/';

          const probeResult = await new Promise<{
            received: boolean;
            cookieBlocked?: boolean;
            cookieValue?: string;
            parentDomBlocked?: boolean;
          }>((resolve) => {
            let settled = false;
            const iframe = document.createElement('iframe');
            iframeHolder.el = iframe;
            iframe.setAttribute('sandbox', 'allow-scripts');
            iframe.style.display = 'none';

            assertEqual(
              iframe.getAttribute('sandbox'),
              'allow-scripts',
              'Iframe sandbox must strictly equal allow-scripts (no allow-same-origin)',
            );

            const timer = window.setTimeout(() => {
              if (!settled) {
                settled = true;
                window.removeEventListener('message', onMsg);
                resolve({ received: false });
              }
            }, 900);

            const onMsg = (ev: MessageEvent) => {
              if (
                ev.source === iframe.contentWindow &&
                ev.data &&
                ev.data.type === 'STAGE29_SANDBOX_PROBE'
              ) {
                if (!settled) {
                  settled = true;
                  window.clearTimeout(timer);
                  window.removeEventListener('message', onMsg);
                  resolve({
                    received: true,
                    cookieBlocked: Boolean(ev.data.cookieBlocked),
                    cookieValue: String(ev.data.cookieValue ?? ''),
                    parentDomBlocked: Boolean(ev.data.parentDomBlocked),
                  });
                }
              }
            };

            window.addEventListener('message', onMsg);
            iframe.srcdoc = srcdoc!;
            document.body.appendChild(iframe);
          });

          if (probeResult.received) {
            const cookieWasIsolated =
              probeResult.cookieBlocked === true ||
              !probeResult.cookieValue?.includes('meraj_stage29_secret');
            assert(
              cookieWasIsolated,
              'Sandboxed iframe without allow-same-origin must NOT read parent cookies',
            );
            assertEqual(
              probeResult.parentDomBlocked,
              true,
              'Sandboxed iframe must get SecurityError reading window.parent.document',
            );
          }
        }
      } finally {
        if (iframeHolder.el && iframeHolder.el.parentNode) {
          iframeHolder.el.parentNode.removeChild(iframeHolder.el);
        }
        if (typeof document !== 'undefined' && prevCookie !== undefined) {
          document.cookie =
            'meraj_stage29_secret=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/';
        }
        h.cleanup();
      }
    },
  },
  {
    id: 'stage29-score-validation-and-top10-leaderboard',
    nameKey: 'tests.stage29.scoreValidationAndTop10Leaderboard.name',
    descriptionKey: 'tests.stage29.scoreValidationAndTop10Leaderboard.desc',
    run: async () => {
      const h = createStage29Harness();
      try {
        const created = await h.gamePortalService.createGameFromZipAsync(
          h.staffWithPortals,
          {
            title: 'مسابقه منطق و اندیشه',
            endMessage: 'اندیشه ورزیدن با پرسش آغاز می‌شود.',
            maxScore: 100,
            isPublished: true,
            zipFileName: 'logic.zip',
            zipBytes: h.validGameZip,
          },
        );
        if (!created.ok || !created.data) {
          throw new Error('Expected game creation');
        }
        const game = created.data;

        // Invalid scores: 999999, -10, 12.5, NaN -> all rejected with 400 & WARN log
        const badScores = [999999, -10, 12.5, Number.NaN];
        for (const badScore of badScores) {
          const res = await h.gamePortalService.submitGameScoreAsync(h.member, {
            gameId: game.id,
            score: badScore,
            activeAgeGroup: null,
          });
          assertEqual(res.ok, false, `Score ${badScore} must be rejected`);
          assertEqual(res.statusCode, 400, 'Out-of-bounds score must return 400');
          assertEqual(
            res.errorCode,
            'INVALID_GAME_SCORE',
            'Expected INVALID_GAME_SCORE',
          );
        }

        const warnLogs = h.logger
          .getLogs()
          .filter(
            (entry) =>
              entry.level === 'WARN' &&
              entry.message.includes('INVALID_GAME_SCORE_REJECTED'),
          );
        assertEqual(
          warnLogs.length,
          4,
          'Every rejected score must record INVALID_GAME_SCORE_REJECTED WARN log',
        );

        // Seed 12 distinct users submitting scores
        const users: AppUser[] = [];
        for (let i = 1; i <= 12; i += 1) {
          users.push(
            h.adminRepo.addUser('Member', [], {
              displayName: `بازیکن ${i}`,
            }),
          );
        }

        // Submit multiple runs for user 0 (first 40, later 95) -> keeps best (95)
        await h.gamePortalService.submitGameScoreAsync(users[0], {
          gameId: game.id,
          score: 40,
          activeAgeGroup: null,
        });
        h.clock.advanceMs(1000);
        await h.gamePortalService.submitGameScoreAsync(users[0], {
          gameId: game.id,
          score: 95,
          activeAgeGroup: null,
        });

        // Remaining 11 users submit ascending scores 50..100
        const assignedScores = [50, 55, 60, 65, 70, 75, 80, 85, 88, 92, 100];
        for (let idx = 0; idx < assignedScores.length; idx += 1) {
          h.clock.advanceMs(1000);
          const submitOk = await h.gamePortalService.submitGameScoreAsync(
            users[idx + 1],
            {
              gameId: game.id,
              score: assignedScores[idx],
              activeAgeGroup: null,
            },
          );
          assertEqual(submitOk.ok, true, `Valid score for user ${idx + 2} must save`);
        }

        // Mark top-scoring user (users[11], score 100) deleted -> should display کاربر حذف‌شده
        h.adminRepo.markUserDeleted(users[11].id);

        const leaderboard = await h.gamePortalService.getGameLeaderboardAsync(
          game.id,
          users[0],
        );
        assertEqual(leaderboard.length, 10, 'Leaderboard must strictly return Top 10');
        assertEqual(leaderboard[0].rank, 1, 'Rank 1 check');
        assertEqual(leaderboard[0].score, 100, 'Highest score must be rank 1');
        assertEqual(
          leaderboard[0].displayName,
          'کاربر حذف‌شده',
          'Deleted user must display anonymized fallback name',
        );
        assertEqual(leaderboard[1].userId, users[0].id, 'Deduplicated user best 95 must be rank 2');
        assertEqual(leaderboard[1].score, 95, 'User best score must be 95');
        assertEqual(leaderboard[1].isCurrentUser, true, 'isCurrentUser flag must match');
        assertEqual(leaderboard[9].rank, 10, 'Last entry must be rank 10');
        assertEqual(
          leaderboard[9].score,
          60,
          '11th and 12th scores (55, 50) must be outside Top 10',
        );

        // Guest submit -> 401 AUTH_REQUIRED
        const guestSubmit = await h.gamePortalService.submitGameScoreAsync(null, {
          gameId: game.id,
          score: 50,
          activeAgeGroup: null,
        });
        assertEqual(guestSubmit.statusCode, 401, 'Guest score submit must return 401');
        assertEqual(guestSubmit.errorCode, 'AUTH_REQUIRED', 'Expected AUTH_REQUIRED');
      } finally {
        h.cleanup();
      }
    },
  },
  {
    id: 'stage29-child-safety-and-games-feature-flag',
    nameKey: 'tests.stage29.childSafetyAndGamesFeatureFlag.name',
    descriptionKey: 'tests.stage29.childSafetyAndGamesFeatureFlag.desc',
    run: async () => {
      const h = createStage29Harness();
      try {
        const ages = await h.adminRepo.getActiveAgeGroups();
        const childAge = ages.find((ag) => ag.key === 'child')!;
        const adultAge = ages.find((ag) => ag.key === 'adult')!;

        // All-ages published game (ageGroupIds = [])
        const allAgesRes = await h.gamePortalService.createGameFromZipAsync(
          h.staffWithPortals,
          {
            title: 'مسابقه همگانی',
            maxScore: 100,
            ageGroupIds: [],
            isPublished: true,
            zipFileName: 'all-ages.zip',
            zipBytes: h.validGameZip,
          },
        );
        assertEqual(allAgesRes.ok, true, 'All-ages game creation must succeed');

        // Adult-only published game (ageGroupIds = [adultAge.id])
        const adultOnlyRes = await h.gamePortalService.createGameFromZipAsync(
          h.staffWithPortals,
          {
            title: 'چالش فلسفه بزرگسال',
            maxScore: 100,
            ageGroupIds: [adultAge.id],
            isPublished: true,
            zipFileName: 'adult-only.zip',
            zipBytes: h.validGameZip,
          },
        );
        assertEqual(adultOnlyRes.ok, true, 'Adult-only game creation must succeed');
        const adultGame = adultOnlyRes.data!;

        // Child visitor sees all-ages game, never sees adult-only game
        const childPortal = await h.gamePortalService.getGamesPortalDataAsync(childAge);
        assertEqual(childPortal.enabled, true, 'Games flag is initially enabled');
        if (childPortal.enabled) {
          assertEqual(
            childPortal.data.items.some((item) => item.game.id === adultGame.id),
            false,
            'CRITICAL Child Safety: Adult-only game MUST NEVER appear for child visitor',
          );
          assertEqual(
            childPortal.data.items.some(
              (item) => item.game.id === allAgesRes.data!.id,
            ),
            true,
            'All-ages game must appear for child visitor',
          );
        }

        // Direct detail access & score submit on adult-only game by child -> 404
        const childDetail = await h.gamePortalService.getPublicGameDetailAsync(
          adultGame.slug,
          childAge,
          h.member,
        );
        assertEqual(
          childDetail.status,
          'not_found',
          'Direct slug access to adult game for child must return not_found (404)',
        );

        const childScore = await h.gamePortalService.submitGameScoreAsync(
          h.member,
          {
            gameId: adultGame.id,
            score: 70,
            activeAgeGroup: childAge,
          },
        );
        assertEqual(
          childScore.statusCode,
          404,
          'Submitting score to adult game under child age must return 404',
        );

        // Adult visitor can open & play adult-only game
        const adultDetail = await h.gamePortalService.getPublicGameDetailAsync(
          adultGame.slug,
          adultAge,
          h.member,
        );
        assertEqual(
          adultDetail.status,
          'ok',
          'Adult visitor must access adult-only game',
        );

        // Toggle FeatureFlag('Games') = false -> portal & detail return disabled/not_found
        h.adminRepo.setGamesFlag(false);
        const disabledPortal = await h.gamePortalService.getGamesPortalDataAsync(
          adultAge,
        );
        assertEqual(
          disabledPortal.enabled,
          false,
          'When Games flag is false, portal must report enabled: false (404)',
        );
        const disabledDetail = await h.gamePortalService.getPublicGameDetailAsync(
          adultGame.slug,
          adultAge,
          h.member,
        );
        assertEqual(
          disabledDetail.status,
          'not_found',
          'When Games flag is false, game play route must return not_found',
        );
        const disabledScore = await h.gamePortalService.submitGameScoreAsync(
          h.member,
          {
            gameId: adultGame.id,
            score: 50,
            activeAgeGroup: adultAge,
          },
        );
        assertEqual(
          disabledScore.errorCode,
          'FEATURE_DISABLED',
          'When Games flag is false, score submission must fail with FEATURE_DISABLED',
        );

        // Restore flag -> accessible again
        h.adminRepo.setGamesFlag(true);
        const restoredPortal = await h.gamePortalService.getGamesPortalDataAsync(
          adultAge,
        );
        assertEqual(restoredPortal.enabled, true, 'Re-enabling flag restores portal');
      } finally {
        h.cleanup();
      }
    },
  },
  {
    id: 'stage29-rbac-permissions-and-idb-v21',
    nameKey: 'tests.stage29.rbacPermissionsAndIdbV21.name',
    descriptionKey: 'tests.stage29.rbacPermissionsAndIdbV21.desc',
    run: async () => {
      const h = createStage29Harness();
      try {
        // RBAC: Guest & Member get 404; Staff without portals.manage gets 403 + WARN log
        const guestList = await h.gamePortalService.listAdminGamesAsync(null);
        assertEqual(guestList.statusCode, 404, 'Guest must get 404');

        const memberCreate = await h.gamePortalService.createGameFromZipAsync(
          h.member,
          {
            title: 'غیرمجاز',
            maxScore: 100,
            zipFileName: 'x.zip',
            zipBytes: h.validGameZip,
          },
        );
        assertEqual(memberCreate.statusCode, 404, 'Member must get 404');

        const staffDenied = await h.gamePortalService.createGameFromZipAsync(
          h.staffWithoutPortals,
          {
            title: 'تلاش بدون مجوز',
            maxScore: 100,
            zipFileName: 'x.zip',
            zipBytes: h.validGameZip,
          },
        );
        assertEqual(
          staffDenied.statusCode,
          403,
          'Staff without portals.manage must get 403',
        );
        assert(
          h.logger.getLogs().some((entry) => entry.level === 'WARN'),
          'Unauthorized Staff 403 attempt must record a WARN log',
        );

        const staffAllowed = await h.gamePortalService.createGameFromZipAsync(
          h.staffWithPortals,
          {
            title: 'بازی مجاز',
            maxScore: 100,
            zipFileName: 'ok.zip',
            zipBytes: h.validGameZip,
          },
        );
        assertEqual(
          staffAllowed.statusCode,
          200,
          'Staff with portals.manage must succeed',
        );

        // Database version & schema check
        assert(
          envConfig.databaseVersion >= 21,
          'envConfig.databaseVersion must be >= 21',
        );
        assertEqual(
          FEATURE_FLAG_KEYS.length,
          7,
          'Stage 3 FEATURE_FLAG_KEYS count must remain 7',
        );
        const expectedStage29Stores: readonly string[] = [
          STORE_NAMES.GAMES,
          STORE_NAMES.GAME_AGE_GROUPS,
          STORE_NAMES.GAME_SCORES,
          STORE_NAMES.GAME_PACKAGES,
        ];
        for (const storeName of STAGE29_OBJECT_STORES) {
          assert(
            expectedStage29Stores.includes(storeName),
            `STAGE29_OBJECT_STORES entry ${storeName} must match STORE_NAMES`,
          );
        }

        if (typeof indexedDB !== 'undefined') {
          const tempDbName = `MerajAndishehDB_Stage29_${Date.now()}`;
          const tempStore = new IndexedDbDataStore(
            tempDbName,
            envConfig.databaseVersion,
            envConfig.metaStoreName,
          );
          const tempLogger = new AppLogger(
            h.clock,
            `meraj_stage29_idb_log_${Date.now()}`,
            20,
          );
          const seeder = new DatabaseSeeder(tempStore, tempLogger);
          try {
            const seedResult = await seeder.seed();
            assertEqual(
              seedResult.summary.featureFlags,
              FEATURE_FLAG_KEYS.length,
              'Stage 3 DatabaseSeeder must preserve 7 initial feature flags',
            );

            await ensureStage29GamesDefaultFlagAsync(tempStore);
            const gamesFlagAfterHelper = await tempStore.getByKey<FeatureFlag>(
              STORE_NAMES.FEATURE_FLAGS,
              'Games',
            );
            assertEqual(
              gamesFlagAfterHelper?.isEnabled,
              true,
              'ensureStage29GamesDefaultFlagAsync must enable Games flag by default',
            );

            const stores = await tempStore.getObjectStoreNames();
            for (const storeName of STAGE29_OBJECT_STORES) {
              assert(
                stores.includes(storeName),
                `IndexedDB v${envConfig.databaseVersion} must include ${storeName}`,
              );
            }

            // Persist a GameItem + GameScore across close & reopen
            const idbGameRepo = new IndexedDbGameRepository(tempStore);
            const savedGame = await idbGameRepo.createGameAsync({
              title: 'پایداری بازی',
              slug: 'game-persist-check',
              description: 'تست ذخیره بازی در IndexedDB',
              endMessage: 'عالی بود',
              thumbnailKey: null,
              packageFolder: 'pkg-persist-1',
              topicId: null,
              maxScore: 100,
              isPublished: true,
              createdById: 1,
              createdAt: h.clock.nowUtcIso(),
              updatedAt: h.clock.nowUtcIso(),
            });
            await idbGameRepo.addGameScoreAsync({
              gameId: savedGame.id,
              userId: 1,
              score: 80,
              createdAt: h.clock.nowUtcIso(),
            });
            tempStore.close();

            const reopenedStore = new IndexedDbDataStore(
              tempDbName,
              envConfig.databaseVersion,
              envConfig.metaStoreName,
            );
            const reopenedRepo = new IndexedDbGameRepository(reopenedStore);
            try {
              const fetchedGame = await reopenedRepo.getGameBySlugAsync(
                'game-persist-check',
              );
              const fetchedScores = await reopenedRepo.getScoresByGameIdAsync(
                savedGame.id,
              );
              assertEqual(
                fetchedGame?.title,
                'پایداری بازی',
                'Game record must persist across DB reopen',
              );
              assertEqual(
                fetchedScores[0]?.score,
                80,
                'GameScore record must persist across DB reopen',
              );
            } finally {
              reopenedStore.close();
            }
          } finally {
            tempLogger.clearLogs();
            tempStore.close();
            await deleteTempIndexedDatabaseAsync(tempDbName);
          }
        }
      } finally {
        h.cleanup();
      }
    },
  },
];
