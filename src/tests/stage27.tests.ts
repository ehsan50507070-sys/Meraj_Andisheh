import type { IClock } from '../core/abstractions/IClock';
import type {
  DataStoreHealthProbe,
  DataStoreKey,
  DataStoreMetadata,
  IDataStore,
  MetaRecord,
} from '../core/abstractions/IDataStore';
import type { IAdminRepository } from '../core/abstractions/adminRepository';
import type { IDailyStatRepository } from '../core/abstractions/dailyStatRepository';
import type { ITaxonomyRepository } from '../core/abstractions/taxonomyRepository';
import {
  DownloadKind,
  type AdvancedDashboardAnalytics,
  type DailyStatRecord,
  type DownloadEvent,
  type ViewEvent,
} from '../core/domain/analytics';
import type { AppUser, UserRole } from '../core/domain/auth';
import type { ContentItem, ContentTopic } from '../core/domain/content';
import type { PermissionKey, StaffPermission } from '../core/domain/permissions';
import type { FeatureFlag, SiteSetting } from '../core/domain/settings';
import type {
  AgeGroup,
  ImpactLevel,
  Person,
  Tag,
  Topic,
} from '../core/domain/taxonomy';
import { AdvancedAnalyticsService } from '../core/services/advancedAnalyticsService';
import {
  buildAdvancedAnalyticsCsv,
  UTF8_BOM,
  type AnalyticsCsvLabels,
} from '../core/services/analyticsCsvService';
import { DailyStatAggregationService } from '../core/services/dailyStatAggregationService';
import { PermissionPolicyService } from '../core/services/permissionPolicyService';
import { SystemClock } from '../infrastructure/clock/SystemClock';
import { envConfig } from '../infrastructure/config/envConfig';
import { IndexedDbBackupSnapshotProvider } from '../infrastructure/data/IndexedDbBackupSnapshotProvider';
import { IndexedDbDailyStatRepository } from '../infrastructure/data/IndexedDbDailyStatRepository';
import { IndexedDbDataStore } from '../infrastructure/data/IndexedDbDataStore';
import {
  DATABASE_MIGRATIONS,
  STAGE27_OBJECT_STORES,
  STORE_NAMES,
} from '../infrastructure/data/migrations';
import { DatabaseSeeder, INITIAL_AGE_GROUPS } from '../infrastructure/data/seed';
import { DailyStatsAggregationJob } from '../infrastructure/jobs/DailyStatsAggregationJob';
import { AppLogger } from '../infrastructure/logging/AppLogger';
import { assert, assertEqual, type UnitTestCase } from './testRunner';

class Stage27FakeClock implements IClock {
  private iso: string;
  private readonly inner = new SystemClock();

  constructor(initialIso = '2026-11-24T10:00:00.000Z') {
    this.iso = initialIso;
  }

  public setUtcIso(nextIso: string): void {
    this.iso = nextIso;
  }

  public advanceMs(deltaMs: number): void {
    const next = new Date(Date.parse(this.iso) + deltaMs);
    this.iso = next.toISOString();
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

class MemoryStage27DataStore implements IDataStore {
  public readonly meta = new Map<string, MetaRecord>();
  public readonly stores = new Map<string, unknown[]>();
  public readAllHook?: () => Promise<void>;

  constructor() {
    this.stores.set('dailyStats', []);
    this.stores.set('viewEvents', []);
    this.stores.set('downloadEvents', []);
    this.stores.set('contentTopics', []);
    this.stores.set('topics', []);
  }

  public getMetadata(): DataStoreMetadata {
    return {
      databaseName: 'MemoryStage27DB',
      databaseVersion: envConfig.databaseVersion,
      metaStoreName: '_meta',
    };
  }

  public async connect(): Promise<void> {}

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
    if (this.readAllHook && storeName === 'viewEvents') {
      await this.readAllHook();
    }
    return [...(this.stores.get(storeName) ?? [])] as T[];
  }

  public async putRecord<T>(storeName: string, record: T): Promise<void> {
    const arr = this.stores.get(storeName) ?? [];
    if (storeName === 'dailyStats') {
      const incoming = record as unknown as DailyStatRecord;
      const idx = (arr as DailyStatRecord[]).findIndex(
        (r) =>
          r.date === incoming.date &&
          r.ageGroupId === incoming.ageGroupId &&
          r.rootTopicId === incoming.rootTopicId,
      );
      if (idx >= 0) {
        arr[idx] = { ...incoming };
      } else {
        arr.push({ ...incoming });
      }
      this.stores.set(storeName, arr);
      return;
    }
    arr.push(record);
    this.stores.set(storeName, arr);
  }

  public async deleteByKey(storeName: string, key: DataStoreKey): Promise<void> {
    const arr = this.stores.get(storeName) ?? [];
    if (storeName === 'dailyStats' && Array.isArray(key) && key.length === 3) {
      const [date, ageGroupId, rootTopicId] = key;
      this.stores.set(
        storeName,
        (arr as DailyStatRecord[]).filter(
          (r) =>
            !(
              r.date === date &&
              r.ageGroupId === ageGroupId &&
              r.rootTopicId === rootTopicId
            ),
        ),
      );
    }
  }

  public async verifyConnection(): Promise<DataStoreHealthProbe> {
    return {
      connected: true,
      readWriteVerified: true,
      latencyMs: 1,
      metadata: this.getMetadata(),
    };
  }
}

class MemoryStage27DailyStatRepository implements IDailyStatRepository {
  private readonly store: MemoryStage27DataStore;

  constructor(store: MemoryStage27DataStore) {
    this.store = store;
  }

  public async getAllDailyStats(): Promise<DailyStatRecord[]> {
    return this.store.getAll<DailyStatRecord>('dailyStats');
  }

  public async getDailyStatsByDate(dateKey: string): Promise<DailyStatRecord[]> {
    const all = await this.getAllDailyStats();
    return all.filter((r) => r.date === dateKey);
  }

  public async upsertDailyStat(record: DailyStatRecord): Promise<void> {
    await this.store.putRecord('dailyStats', record);
  }

  public async deleteDailyStat(
    date: string,
    ageGroupId: number,
    rootTopicId: number,
  ): Promise<void> {
    await this.store.deleteByKey('dailyStats', [date, ageGroupId, rootTopicId]);
  }
}

class MemoryStage27AdminRepository implements IAdminRepository {
  public users: AppUser[] = [];
  public permissions: StaffPermission[] = [];
  public flags: FeatureFlag[] = [];
  public settings: SiteSetting[] = [];
  public ageGroups: AgeGroup[] = INITIAL_AGE_GROUPS.map((g, idx) => ({
    ...g,
    id: idx + 1,
  }));

  public async getUserById(id: number): Promise<AppUser | null> {
    return this.users.find((u) => u.id === id) ?? null;
  }

  public async getUserByNormalizedEmail(
    normalizedEmail: string,
  ): Promise<AppUser | null> {
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

  public async deleteSessionsByUserId(): Promise<void> {}

  public async getStaffPermissionsByUserId(userId: number): Promise<StaffPermission[]> {
    return this.permissions.filter((p) => p.userId === userId);
  }

  public async replaceStaffPermissions(
    userId: number,
    permissions: Omit<StaffPermission, 'id'>[],
  ): Promise<StaffPermission[]> {
    this.permissions = this.permissions.filter((p) => p.userId !== userId);
    let nextId = this.permissions.reduce((m, p) => Math.max(m, p.id ?? 0), 0) + 1;
    const inserted: StaffPermission[] = [];
    for (const perm of permissions) {
      const created: StaffPermission = { ...perm, id: nextId };
      nextId += 1;
      this.permissions.push(created);
      inserted.push(created);
    }
    return inserted;
  }

  public async getAllFeatureFlags(): Promise<FeatureFlag[]> {
    return [...this.flags];
  }

  public async upsertFeatureFlag(flag: FeatureFlag): Promise<void> {
    const idx = this.flags.findIndex((f) => f.key === flag.key);
    if (idx === -1) this.flags.push({ ...flag });
    else this.flags[idx] = { ...flag };
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
      if (idx === -1) this.settings.push({ ...setting });
      else this.settings[idx] = { ...setting };
    }
  }

  public async getActiveAgeGroups(): Promise<AgeGroup[]> {
    return this.ageGroups.filter((g) => g.isActive);
  }
}

class MemoryStage27TaxonomyRepository implements ITaxonomyRepository {
  public topics: Topic[] = [];
  public tags: Tag[] = [];
  public persons: Person[] = [];
  public impactLevels: ImpactLevel[] = [];
  public ageGroups: AgeGroup[] = INITIAL_AGE_GROUPS.map((g, idx) => ({
    ...g,
    id: idx + 1,
  }));
  public contentTopics: ContentTopic[] = [];

  public async getAllTopics(): Promise<Topic[]> {
    return [...this.topics];
  }

  public async getTopicById(id: number): Promise<Topic | null> {
    return this.topics.find((t) => t.id === id) ?? null;
  }

  public async createTopic(topic: Omit<Topic, 'id'>): Promise<Topic> {
    const id = this.topics.reduce((m, t) => Math.max(m, t.id), 0) + 1;
    const created: Topic = { ...topic, id };
    this.topics.push(created);
    return created;
  }

  public async updateTopic(topic: Topic): Promise<void> {
    const idx = this.topics.findIndex((t) => t.id === topic.id);
    if (idx >= 0) this.topics[idx] = { ...topic };
  }

  public async deleteTopic(id: number): Promise<void> {
    this.topics = this.topics.filter((t) => t.id !== id);
  }

  public async getAllTags(): Promise<Tag[]> {
    return [...this.tags];
  }
  public async getTagById(): Promise<Tag | null> {
    return null;
  }
  public async createTag(tag: Omit<Tag, 'id'>): Promise<Tag> {
    return { ...tag, id: 1 };
  }
  public async updateTag(): Promise<void> {}
  public async deleteTag(): Promise<void> {}
  public async getAllPersons(): Promise<Person[]> {
    return [...this.persons];
  }
  public async getPersonById(): Promise<Person | null> {
    return null;
  }
  public async createPerson(person: Omit<Person, 'id'>): Promise<Person> {
    return { ...person, id: 1 };
  }
  public async updatePerson(): Promise<void> {}
  public async deletePerson(): Promise<void> {}
  public async getAllImpactLevels(): Promise<ImpactLevel[]> {
    return [...this.impactLevels];
  }
  public async getImpactLevelById(): Promise<ImpactLevel | null> {
    return null;
  }
  public async createImpactLevel(
    level: Omit<ImpactLevel, 'id'>,
  ): Promise<ImpactLevel> {
    return { ...level, id: 1 };
  }
  public async updateImpactLevel(): Promise<void> {}
  public async deleteImpactLevel(): Promise<void> {}
  public async getAllAgeGroups(): Promise<AgeGroup[]> {
    return [...this.ageGroups];
  }
  public async getAgeGroupById(id: number): Promise<AgeGroup | null> {
    return this.ageGroups.find((g) => g.id === id) ?? null;
  }
  public async updateAgeGroup(): Promise<void> {}
  public async getContentTopicLinks(): Promise<ContentTopic[]> {
    return [...this.contentTopics];
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
  public async createContentItem(
    item: Omit<ContentItem, 'id'>,
  ): Promise<ContentItem> {
    return { ...item, id: 1 };
  }
  public async linkContentTopic(contentId: number, topicId: number): Promise<void> {
    this.contentTopics.push({ contentId, topicId });
  }
}

async function createRealTestUserAsync(
  adminRepo: IAdminRepository,
  role: UserRole,
  email: string,
  displayName: string,
  clock: IClock,
): Promise<AppUser> {
  return adminRepo.createUser({
    email,
    normalizedEmail: email.trim().toLowerCase(),
    emailConfirmed: true,
    phoneNumber: null,
    normalizedPhoneNumber: null,
    phoneNumberConfirmed: false,
    passwordHash: 'test-hash-value',
    passwordSalt: 'test-salt-value',
    displayName,
    ageGroupId: 4,
    personalizationEnabled: true,
    mustChangePassword: false,
    isActive: true,
    role,
    failedLoginCount: 0,
    lockoutEnd: null,
    createdAt: clock.nowUtcIso(),
    lastLoginAt: null,
  });
}

async function grantPermissionAsync(
  adminRepo: IAdminRepository,
  userId: number,
  permissionKey: PermissionKey,
  clock: IClock,
): Promise<void> {
  await adminRepo.replaceStaffPermissions(userId, [
    {
      userId,
      permissionKey,
      grantedAt: clock.nowUtcIso(),
      grantedById: null,
    },
  ]);
}

export const stage27Tests: readonly UnitTestCase[] = [
  {
    id: 'stage27-idempotent-aggregation',
    nameKey: 'tests.stage27.idempotentAggregation.name',
    descriptionKey: 'tests.stage27.idempotentAggregation.desc',
    async run() {
      const clock = new Stage27FakeClock('2026-11-24T23:55:00.000Z');
      const logger = new AppLogger(clock, `meraj_s27_t1_${Date.now()}`, 50);
      const dataStore = new MemoryStage27DataStore();

      try {
        const topics: Topic[] = [
          {
            id: 10,
            parentId: null,
            name: 'اندیشه اسلامی',
            slug: 'islamic-thought',
            icon: null,
            sortOrder: 1,
            isActive: true,
          },
          {
            id: 11,
            parentId: 10,
            name: 'فلسفه و کلام',
            slug: 'philosophy',
            icon: null,
            sortOrder: 2,
            isActive: true,
          },
        ];
        const contentTopics: ContentTopic[] = [{ contentId: 101, topicId: 11 }];
        const viewEvents: ViewEvent[] = [
          {
            id: 1,
            contentId: 101,
            userId: 5,
            visitorId: 'v1',
            ageGroupId: 2,
            primaryTopicId: 11,
            occurredAt: '2026-11-24T09:00:00.000Z',
            isCounted: true,
          },
          {
            id: 2,
            contentId: 101,
            userId: 5,
            visitorId: 'v1',
            ageGroupId: 2,
            primaryTopicId: 11,
            occurredAt: '2026-11-24T09:10:00.000Z',
            isCounted: false,
          },
          {
            id: 3,
            contentId: 999,
            userId: null,
            visitorId: 'v2',
            ageGroupId: null,
            primaryTopicId: null,
            occurredAt: '2026-11-24T12:00:00.000Z',
            isCounted: true,
          },
        ];
        const downloadEvents: DownloadEvent[] = [
          {
            id: 1,
            kind: DownloadKind.File,
            contentId: 101,
            fileId: 40,
            userId: 5,
            ageGroupId: 2,
            occurredAt: '2026-11-24T10:30:00.000Z',
          },
          {
            id: 2,
            kind: DownloadKind.Story,
            contentId: 101,
            fileId: null,
            userId: 5,
            ageGroupId: 2,
            occurredAt: '2026-11-24T11:30:00.000Z',
          },
        ];
        const staleRecord: DailyStatRecord = {
          date: '2026-11-20',
          ageGroupId: 2,
          rootTopicId: 10,
          views: 99,
          downloads: 88,
          updatedAt: '2026-11-20T23:59:00.000Z',
        };

        dataStore.stores.set('topics', topics);
        dataStore.stores.set('contentTopics', contentTopics);
        dataStore.stores.set('viewEvents', viewEvents);
        dataStore.stores.set('downloadEvents', downloadEvents);
        dataStore.stores.set('dailyStats', [staleRecord]);

        const service = new DailyStatAggregationService(dataStore, clock, logger);

        const res1 = await service.aggregateDailyStatsAsync();
        const res2 = await service.aggregateDailyStatsAsync();
        const res3 = await service.aggregateDailyStatsAsync();

        assertEqual(
          res1.deletedStaleRecordsCount,
          1,
          'First run must remove stale pre-existing record with no matching events',
        );
        assertEqual(res3.processedViewEvents, 2, 'Only isCounted=true views must count');
        assertEqual(
          res3.processedDownloadEvents,
          2,
          'Both File and Story downloads must count',
        );
        assertEqual(
          res2.writtenRecordsCount,
          2,
          'Expected exactly 2 aggregated (date, ageGroupId, rootTopicId) buckets',
        );

        const rows = await dataStore.getAll<DailyStatRecord>('dailyStats');
        assertEqual(
          rows.length,
          2,
          'Repeated aggregation runs must never duplicate dailyStats records',
        );

        const bucketKnown = rows.find(
          (r) =>
            r.date === '2026-11-24' && r.ageGroupId === 2 && r.rootTopicId === 10,
        );
        assert(Boolean(bucketKnown), 'Expected rootTopicId=10 bucket for subtopic 11');
        assertEqual(
          bucketKnown?.views,
          1,
          'Views must remain 1 (not doubled after 3 runs, and isCounted=false excluded)',
        );
        assertEqual(
          bucketKnown?.downloads,
          2,
          'Downloads must remain 2 (File + Story) after 3 runs',
        );

        const bucketFallback = rows.find(
          (r) =>
            r.date === '2026-11-24' && r.ageGroupId === 0 && r.rootTopicId === 0,
        );
        assert(
          Boolean(bucketFallback),
          'Null ageGroupId & uncategorized content must map to (0, 0)',
        );
        assertEqual(bucketFallback?.views, 1, 'Fallback bucket must count 1 view');
        assertEqual(bucketFallback?.downloads, 0, 'Fallback bucket must have 0 downloads');
      } finally {
        logger.clearLogs();
      }
    },
  },
  {
    id: 'stage27-advanced-analytics-breakdown',
    nameKey: 'tests.stage27.advancedAnalyticsBreakdown.name',
    descriptionKey: 'tests.stage27.advancedAnalyticsBreakdown.desc',
    async run() {
      const clock = new Stage27FakeClock('2026-11-24T12:00:00.000Z');
      const logger = new AppLogger(clock, `meraj_s27_t2_${Date.now()}`, 50);
      const dataStore = new MemoryStage27DataStore();
      const dailyStatRepo = new MemoryStage27DailyStatRepository(dataStore);
      const adminRepo = new MemoryStage27AdminRepository();
      const taxonomyRepo = new MemoryStage27TaxonomyRepository();

      try {
        const superAdmin = await createRealTestUserAsync(
          adminRepo,
          'SuperAdmin',
          's27-super@example.com',
          'مدیرکل آمار',
          clock,
        );

        taxonomyRepo.topics = [
          {
            id: 1,
            parentId: null,
            name: 'علوم انسانی',
            slug: 'humanities',
            icon: null,
            sortOrder: 1,
            isActive: true,
          },
          {
            id: 2,
            parentId: null,
            name: 'فناوری و رسانه',
            slug: 'media',
            icon: null,
            sortOrder: 2,
            isActive: true,
          },
        ];

        dataStore.stores.set('topics', taxonomyRepo.topics);
        dataStore.stores.set('contentTopics', [
          { contentId: 10, topicId: 1 },
          { contentId: 20, topicId: 2 },
        ]);
        dataStore.stores.set('viewEvents', [
          {
            id: 1,
            contentId: 10,
            userId: superAdmin.id,
            visitorId: 'u1',
            ageGroupId: 2,
            primaryTopicId: 1,
            occurredAt: '2026-11-23T10:00:00.000Z',
            isCounted: true,
          },
          {
            id: 2,
            contentId: 20,
            userId: superAdmin.id,
            visitorId: 'u1',
            ageGroupId: 4,
            primaryTopicId: 2,
            occurredAt: '2026-11-24T10:00:00.000Z',
            isCounted: true,
          },
          {
            id: 3,
            contentId: 20,
            userId: null,
            visitorId: 'g1',
            ageGroupId: null,
            primaryTopicId: 2,
            occurredAt: '2026-11-24T11:00:00.000Z',
            isCounted: true,
          },
        ] satisfies ViewEvent[]);
        dataStore.stores.set('downloadEvents', [
          {
            id: 1,
            kind: DownloadKind.File,
            contentId: 20,
            fileId: 1,
            userId: superAdmin.id,
            ageGroupId: 4,
            occurredAt: '2026-11-24T11:30:00.000Z',
          },
        ] satisfies DownloadEvent[]);

        const aggService = new DailyStatAggregationService(dataStore, clock, logger);
        const policyService = new PermissionPolicyService(adminRepo, logger);
        const advService = new AdvancedAnalyticsService({
          dailyStatRepository: dailyStatRepo,
          dailyStatAggregationService: aggService,
          adminRepository: adminRepo,
          taxonomyRepository: taxonomyRepo,
          permissionPolicyService: policyService,
          clock,
          logger,
        });

        const res = await advService.getAdvancedDashboardAnalyticsAsync(
          superAdmin,
          { preset: '7d' },
          {
            unknownAgeGroupLabel: 'نامشخص',
            uncategorizedTopicLabel: 'بدون دسته‌بندی',
          },
        );
        assert(res.ok, 'SuperAdmin must receive 200 advanced analytics');
        assertEqual(res.data.totalAggregatedViews, 3, 'Total views must equal 3');
        assertEqual(res.data.totalAggregatedDownloads, 1, 'Total downloads must equal 1');

        assertEqual(res.data.trendSeries.length, 2, 'Trend series must cover 2 days');
        assertEqual(
          res.data.trendSeries[0].dateKey,
          '2026-11-23',
          'Trend series must be sorted ascending by date',
        );
        assert(
          /[۰-۹]{4}\/[۰-۹]{2}\/[۰-۹]{2}/.test(res.data.trendSeries[0].jalaliLabel),
          'Trend point jalaliLabel must format Jalali date in Persian digits',
        );

        const unknownAge = res.data.byAgeGroup.find((g) => g.ageGroupId === 0);
        assert(Boolean(unknownAge), 'Unknown age group (0) must appear when events have null ageGroupId');
        assertEqual(unknownAge?.ageGroupName, 'نامشخص', 'Unknown age group label must match');
        assertEqual(unknownAge?.views, 1, 'Unknown age group views must equal 1');

        assertEqual(
          res.data.byRootTopic[0].rootTopicId,
          2,
          'Top root topic by totalInteractions (3) must appear first',
        );
        assertEqual(
          res.data.byRootTopic[0].totalInteractions,
          3,
          'Top topic interactions must equal 3',
        );
        assertEqual(
          res.data.byRootTopic[1].rootTopicId,
          1,
          'Second topic must have id 1',
        );
        assertEqual(
          res.data.byRootTopic[1].totalInteractions,
          1,
          'Second topic interactions must equal 1',
        );

        // Custom range narrowing to single day 2026-11-23
        const narrowRes = await advService.getAdvancedDashboardAnalyticsAsync(
          superAdmin,
          {
            preset: 'custom',
            fromIso: '2026-11-23',
            toIso: '2026-11-23',
          },
          { refreshAggregation: false },
        );
        assert(narrowRes.ok, 'Valid single-day custom range must succeed');
        assertEqual(narrowRes.data.trendSeries.length, 1, 'Narrowed range must have 1 day');
        assertEqual(narrowRes.data.totalAggregatedViews, 1, 'Narrowed views must equal 1');
        assertEqual(
          narrowRes.data.totalAggregatedDownloads,
          0,
          'Narrowed downloads must equal 0',
        );

        const badRange = await advService.getAdvancedDashboardAnalyticsAsync(superAdmin, {
          preset: 'custom',
          fromIso: '2026-11-25',
          toIso: '2026-11-20',
        });
        assertEqual(badRange.statusCode, 400, 'Inverted custom range must fail with 400');
      } finally {
        logger.clearLogs();
      }
    },
  },
  {
    id: 'stage27-csv-export-bom-escaping',
    nameKey: 'tests.stage27.csvExportBomAndEscaping.name',
    descriptionKey: 'tests.stage27.csvExportBomAndEscaping.desc',
    async run() {
      const sample: AdvancedDashboardAnalytics = {
        appliedPreset: '7d',
        fromIso: '2026-11-18T00:00:00.000Z',
        toIso: '2026-11-24T23:59:59.999Z',
        trendSeries: [
          {
            dateKey: '2026-11-24',
            jalaliLabel: '۱۴۰۵/۰۹/۰۳',
            views: 15,
            downloads: 4,
          },
        ],
        byAgeGroup: [
          {
            ageGroupId: 4,
            ageGroupName: 'بزرگسال',
            themeKey: 'editorial',
            views: 15,
            downloads: 4,
            viewsSharePercent: 100,
            downloadsSharePercent: 100,
          },
        ],
        byRootTopic: [
          {
            rootTopicId: 1,
            rootTopicName: 'تاریخ, "تمدن"',
            views: 10,
            downloads: 3,
            totalInteractions: 13,
          },
          {
            rootTopicId: 2,
            rootTopicName: '=SUM(A1:A2)',
            views: 5,
            downloads: 1,
            totalInteractions: 6,
          },
        ],
        totalAggregatedViews: 15,
        totalAggregatedDownloads: 4,
        lastAggregatedAt: '2026-11-24T12:00:00.000Z',
      };

      const labels: AnalyticsCsvLabels = {
        trendSectionTitle: 'روند روزانه بازدید و دانلود',
        ageGroupSectionTitle: 'تفکیک آمار بر اساس رده سنی',
        rootTopicSectionTitle: 'تفکیک آمار بر اساس موضوع ریشه',
        colDateJalali: 'تاریخ شمسی',
        colDateKey: 'تاریخ میلادی (UTC)',
        colAgeGroup: 'رده سنی',
        colRootTopic: 'موضوع ریشه',
        colViews: 'بازدید شمرده شده',
        colViewsShare: 'سهم بازدید (٪)',
        colDownloads: 'تعداد دانلود',
        colDownloadsShare: 'سهم دانلود (٪)',
        colTotalInteractions: 'مجموع تعامل (بازدید + دانلود)',
      };

      const csv = buildAdvancedAnalyticsCsv(sample, labels);
      assert(
        csv.startsWith(UTF8_BOM),
        'CSV export MUST begin with UTF-8 BOM (\\uFEFF) for Windows Excel Persian support',
      );
      assert(csv.includes('\r\n'), 'CSV export must use CRLF line endings');
      assert(
        csv.includes(labels.trendSectionTitle) &&
          csv.includes(labels.ageGroupSectionTitle) &&
          csv.includes(labels.rootTopicSectionTitle),
        'CSV export must contain all 3 Persian section headers',
      );
      assert(
        csv.includes('"تاریخ, ""تمدن""",10,3,13'),
        'CSV must properly RFC-4180 quote and double-escape comma/quotes inside topic titles',
      );
      assert(
        csv.includes("'=SUM(A1:A2),5,1,6"),
        'CSV must neutralize dangerous leading Excel formula characters',
      );
    },
  },
  {
    id: 'stage27-background-job-schedule-lock',
    nameKey: 'tests.stage27.backgroundJobScheduleAndLock.name',
    descriptionKey: 'tests.stage27.backgroundJobScheduleAndLock.desc',
    async run() {
      const clock = new Stage27FakeClock('2026-11-24T00:00:00.000Z');
      const logger = new AppLogger(clock, `meraj_s27_t4_${Date.now()}`, 50);
      const dataStore = new MemoryStage27DataStore();

      dataStore.stores.set('viewEvents', [
        {
          id: 1,
          contentId: 1,
          userId: 1,
          visitorId: 'v1',
          ageGroupId: 4,
          primaryTopicId: null,
          occurredAt: '2026-11-24T00:00:00.000Z',
          isCounted: true,
        },
      ] satisfies ViewEvent[]);

      let releaseGate: (() => void) | null = null;
      let isGated = true;
      dataStore.readAllHook = () =>
        new Promise<void>((resolve) => {
          if (!isGated) {
            resolve();
            return;
          }
          releaseGate = resolve;
        });

      const aggService = new DailyStatAggregationService(dataStore, clock, logger);
      const job = new DailyStatsAggregationJob({
        aggregationService: aggService,
        clock,
        logger,
      });

      try {
        const firstPromise = job.runNowAsync();
        const concurrentSecond = await job.runNowAsync();
        assertEqual(
          concurrentSecond.executed,
          false,
          'Concurrent invocation while aggregation is in progress must be skipped cleanly',
        );

        isGated = false;
        if (releaseGate) {
          (releaseGate as () => void)();
        }
        const firstResult = await firstPromise;
        assertEqual(firstResult.executed, true, 'First aggregation run must succeed');
        assertEqual(
          job.getState().lastRunAtIso,
          '2026-11-24T00:00:00.000Z',
          'Job state must record completion timestamp',
        );

        dataStore.readAllHook = undefined;

        clock.advanceMs(2 * 60 * 60 * 1000);
        const earlyTick = await job.tickAsync();
        assertEqual(
          earlyTick.executed,
          false,
          'Nightly job must wait until 24h interval has elapsed',
        );

        clock.advanceMs(22 * 60 * 60 * 1000);
        const dueTick = await job.tickAsync();
        assertEqual(
          dueTick.executed,
          true,
          'Nightly job must run after 24h interval elapses',
        );
        assertEqual(
          job.getState().lastRunAtIso,
          '2026-11-25T00:00:00.000Z',
          'Job state must advance timestamp after 24h run',
        );

        job.start();
        assertEqual(job.getState().isRunning, true, 'Job must report running when started');
        job.stop();
        assertEqual(job.getState().isRunning, false, 'Job must report stopped after stop()');
      } finally {
        job.stop();
        logger.clearLogs();
      }
    },
  },
  {
    id: 'stage27-rbac-and-idb-v19',
    nameKey: 'tests.stage27.rbacDashboardViewAndIdbV19.name',
    descriptionKey: 'tests.stage27.rbacDashboardViewAndIdbV19.desc',
    async run() {
      const clock = new Stage27FakeClock('2026-11-24T12:00:00.000Z');
      const logger = new AppLogger(clock, `meraj_s27_t5_${Date.now()}`, 50);
      const memStore = new MemoryStage27DataStore();
      const memDailyRepo = new MemoryStage27DailyStatRepository(memStore);
      const adminRepo = new MemoryStage27AdminRepository();
      const taxonomyRepo = new MemoryStage27TaxonomyRepository();

      try {
        const superAdmin = await createRealTestUserAsync(
          adminRepo,
          'SuperAdmin',
          's27-admin@example.com',
          'مدیرکل',
          clock,
        );
        const staffAllowed = await createRealTestUserAsync(
          adminRepo,
          'Staff',
          's27-staff-ok@example.com',
          'همکار آمار',
          clock,
        );
        await grantPermissionAsync(adminRepo, staffAllowed.id, 'dashboard.view', clock);

        const staffDenied = await createRealTestUserAsync(
          adminRepo,
          'Staff',
          's27-staff-no@example.com',
          'همکار بدون دسترسی',
          clock,
        );
        const member = await createRealTestUserAsync(
          adminRepo,
          'Member',
          's27-member@example.com',
          'عضو عادی',
          clock,
        );

        const aggService = new DailyStatAggregationService(memStore, clock, logger);
        const policyService = new PermissionPolicyService(adminRepo, logger);
        const advService = new AdvancedAnalyticsService({
          dailyStatRepository: memDailyRepo,
          dailyStatAggregationService: aggService,
          adminRepository: adminRepo,
          taxonomyRepository: taxonomyRepo,
          permissionPolicyService: policyService,
          clock,
          logger,
        });

        const guestRes = await advService.getAdvancedDashboardAnalyticsAsync(null, {
          preset: '7d',
        });
        assertEqual(guestRes.statusCode, 404, 'Guest must receive 404');

        const memberRes = await advService.getAdvancedDashboardAnalyticsAsync(member, {
          preset: '7d',
        });
        assertEqual(memberRes.statusCode, 404, 'Member must receive 404');

        logger.clearLogs();
        const staffDeniedRes = await advService.getAdvancedDashboardAnalyticsAsync(
          staffDenied,
          { preset: '7d' },
        );
        assertEqual(
          staffDeniedRes.statusCode,
          403,
          'Staff without dashboard.view must receive 403',
        );
        const warnLogs = logger.getLogs().filter((l) => l.level === 'WARN');
        assert(
          warnLogs.length > 0,
          '403 on unauthorized Staff must emit a WARN audit log',
        );

        const manualDenied = await advService.runManualAggregationAsync(staffDenied);
        assertEqual(
          manualDenied.statusCode,
          403,
          'Manual aggregation trigger must also enforce dashboard.view',
        );

        const staffAllowedRes = await advService.getAdvancedDashboardAnalyticsAsync(
          staffAllowed,
          { preset: '7d' },
        );
        assertEqual(
          staffAllowedRes.statusCode,
          200,
          'Staff with dashboard.view must receive 200',
        );

        const superManualRes = await advService.runManualAggregationAsync(superAdmin);
        assertEqual(
          superManualRes.statusCode,
          200,
          'SuperAdmin manual aggregation must succeed with 200',
        );
      } finally {
        logger.clearLogs();
      }

      // IndexedDB v18 -> v19 migration & compound key verification
      assert(
        envConfig.stageNumber >= 27,
        `envConfig.stageNumber must be >= 27 (actual=${envConfig.stageNumber})`,
      );
      assert(
        envConfig.databaseVersion >= 19,
        `envConfig.databaseVersion must be >= 19 (actual=${envConfig.databaseVersion})`,
      );
      assert(
        DATABASE_MIGRATIONS.some((m) => m.version === 19),
        'DATABASE_MIGRATIONS must include version 19',
      );
      assert(
        STAGE27_OBJECT_STORES.includes(STORE_NAMES.DAILY_STATS),
        'STAGE27_OBJECT_STORES must include dailyStats',
      );

      if (typeof indexedDB === 'undefined') {
        return;
      }

      const tempDbName = `MerajStage27_V18_To_V19_${Date.now()}`;
      const migLogger = new AppLogger(clock, `meraj_s27_mig_${Date.now()}`, 50);

      try {
        const storeV18 = new IndexedDbDataStore(
          tempDbName,
          18,
          envConfig.metaStoreName,
        );
        await storeV18.connect();
        const seeder = new DatabaseSeeder(storeV18, migLogger);
        await seeder.seed();
        storeV18.close();

        const storeV19 = new IndexedDbDataStore(
          tempDbName,
          envConfig.databaseVersion,
          envConfig.metaStoreName,
        );
        try {
          await storeV19.connect();
          const storeNames = await storeV19.getObjectStoreNames();
          assert(
            storeNames.includes(STORE_NAMES.DAILY_STATS),
            'v19 migration must create dailyStats object store',
          );

          const dailyRepo = new IndexedDbDailyStatRepository(storeV19);
          const sampleStat: DailyStatRecord = {
            date: '2026-11-24',
            ageGroupId: 0,
            rootTopicId: 0,
            views: 12,
            downloads: 3,
            updatedAt: clock.nowUtcIso(),
          };
          await dailyRepo.upsertDailyStat(sampleStat);

          const queried = await dailyRepo.getDailyStatsByDate('2026-11-24');
          assertEqual(
            queried.length,
            1,
            'dailyStats date index must retrieve stored compound-key record',
          );
          assertEqual(queried[0].views, 12, 'Persisted views count must equal 12');
          assertEqual(
            queried[0].downloads,
            3,
            'Persisted downloads count must equal 3',
          );

          const snapshotProvider = new IndexedDbBackupSnapshotProvider(storeV19);
          const snapshot = await snapshotProvider.exportFullSnapshotAsync();
          assert(
            Array.isArray(snapshot.tables[STORE_NAMES.DAILY_STATS]) &&
              snapshot.tables[STORE_NAMES.DAILY_STATS].length === 1,
            'Full backup snapshot must include dailyStats table records',
          );
        } finally {
          storeV19.close();
        }
      } finally {
        migLogger.clearLogs();
        await deleteTempDatabaseAsync(tempDbName);
      }
    },
  },
];
