import type { IClock } from '../core/abstractions/IClock';
import type { IAdminRepository } from '../core/abstractions/adminRepository';
import type { IAuthRepository } from '../core/abstractions/authRepository';
import type { IContentRepository } from '../core/abstractions/contentRepository';
import type { IDownloadEventRepository } from '../core/abstractions/downloadRepository';
import type {
  FileReadRangeResult,
  IFileStorage,
} from '../core/abstractions/fileStorage';
import type { ITaxonomyRepository } from '../core/abstractions/taxonomyRepository';
import type { IViewEventRepository } from '../core/abstractions/viewTracker';
import {
  DownloadKind,
  type DownloadEvent,
  type ViewEvent,
} from '../core/domain/analytics';
import type { AppUser, UserRole } from '../core/domain/auth';
import {
  ContentFileKind,
  ContentStatus,
  FileStorageType,
  type ContentFile,
  type ContentItem,
  type ContentPerson,
  type ContentSource,
  type ContentTag,
  type ContentTopic,
} from '../core/domain/content';
import type { PermissionKey, StaffPermission } from '../core/domain/permissions';
import type { FeatureFlag, SiteSetting } from '../core/domain/settings';
import type { FileSaveRequest, StoredFileMetadata } from '../core/domain/storage';
import type {
  AgeGroup,
  ImpactLevel,
  Person,
  Tag,
  Topic,
} from '../core/domain/taxonomy';
import { AnalyticsDashboardService } from '../core/services/analyticsDashboardService';
import { DownloadService } from '../core/services/downloadService';
import {
  formatJalaliDate,
  getJalaliMonthLength,
  getJalaliWeekdayIndex,
  gregorianToJalali,
  isJalaliLeapYear,
  jalaliToGregorian,
  jalaliToUtcRangeBounds,
  parseJalaliInput,
} from '../core/services/jalaliCalendarService';
import { PermissionPolicyService } from '../core/services/permissionPolicyService';
import { ViewTrackerService } from '../core/services/viewTrackerService';
import { SystemClock } from '../infrastructure/clock/SystemClock';
import { envConfig } from '../infrastructure/config/envConfig';
import { IndexedDbAuthRepository } from '../infrastructure/data/IndexedDbAuthRepository';
import { IndexedDbContentRepository } from '../infrastructure/data/IndexedDbContentRepository';
import { IndexedDbDataStore } from '../infrastructure/data/IndexedDbDataStore';
import { IndexedDbDownloadEventRepository } from '../infrastructure/data/IndexedDbDownloadEventRepository';
import { IndexedDbTaxonomyRepository } from '../infrastructure/data/IndexedDbTaxonomyRepository';
import { IndexedDbViewEventRepository } from '../infrastructure/data/IndexedDbViewEventRepository';
import {
  DATABASE_MIGRATIONS,
  STAGE13_OBJECT_STORES,
  STAGE14_OBJECT_STORES,
  STORE_NAMES,
} from '../infrastructure/data/migrations';
import { INITIAL_AGE_GROUPS } from '../infrastructure/data/seed';
import { AppLogger } from '../infrastructure/logging/AppLogger';
import { HmacDownloadTokenProtector } from '../infrastructure/security/HmacDownloadTokenProtector';
import { LocalIndexedDbFileStorage } from '../infrastructure/storage/LocalIndexedDbFileStorage';
import { assert, assertEqual, type UnitTestCase } from './testRunner';

class Stage19FakeClock implements IClock {
  private currentMs: number;
  private readonly inner = new SystemClock();

  constructor(initialIso = '2026-11-23T12:00:00.000Z') {
    this.currentMs = Date.parse(initialIso);
  }

  public setUtcIso(iso: string): void {
    this.currentMs = Date.parse(iso);
  }

  public advanceMinutes(minutes: number): void {
    this.currentMs += minutes * 60 * 1000;
  }

  public advanceDays(days: number): void {
    this.currentMs += days * 24 * 60 * 60 * 1000;
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

class Stage19MemoryFileStorage implements IFileStorage {
  private readonly blobs = new Map<
    string,
    { bytes: Uint8Array; meta: StoredFileMetadata }
  >();
  private readonly clock: IClock;
  private seq = 1;

  constructor(clock: IClock) {
    this.clock = clock;
  }

  public async saveAsync(request: FileSaveRequest): Promise<StoredFileMetadata> {
    const ext = request.originalFileName.includes('.')
      ? request.originalFileName.slice(request.originalFileName.lastIndexOf('.'))
      : '';
    const storageKey = `${request.visibility}/document/s19-${this.seq++}${ext}`;
    const meta: StoredFileMetadata = {
      storageKey,
      originalFileName: request.originalFileName,
      extension: ext.replace(/^\./, '') || 'bin',
      mimeType: request.contentType || 'application/pdf',
      sizeBytes: request.bytes.byteLength,
      visibility: request.visibility,
      category: 'document',
      uploadedById: request.uploadedById ?? null,
      createdAt: this.clock.nowUtcIso(),
    };
    this.blobs.set(storageKey, { bytes: new Uint8Array(request.bytes), meta });
    return { ...meta };
  }

  public async openReadAsync(
    storageKey: string,
  ): Promise<{ bytes: Uint8Array; metadata: StoredFileMetadata } | null> {
    const entry = this.blobs.get(storageKey);
    if (!entry) {
      return null;
    }
    return { bytes: new Uint8Array(entry.bytes), metadata: { ...entry.meta } };
  }

  public async openReadRangeAsync(
    storageKey: string,
    startByte: number,
    endByte: number,
  ): Promise<FileReadRangeResult | null> {
    const entry = this.blobs.get(storageKey);
    if (!entry) {
      return null;
    }
    const clampedEnd = Math.min(endByte, entry.bytes.byteLength - 1);
    const chunk = entry.bytes.slice(startByte, clampedEnd + 1);
    return {
      chunk,
      totalBytes: entry.bytes.byteLength,
      startByte,
      endByte: clampedEnd,
      mimeType: entry.meta.mimeType,
    };
  }

  public async getMetadataAsync(storageKey: string): Promise<StoredFileMetadata | null> {
    return this.blobs.get(storageKey)?.meta ?? null;
  }

  public async deleteAsync(storageKey: string): Promise<void> {
    this.blobs.delete(storageKey);
  }

  public async existsAsync(storageKey: string): Promise<boolean> {
    return this.blobs.has(storageKey);
  }

  public async listAllMetadataAsync(): Promise<StoredFileMetadata[]> {
    return Array.from(this.blobs.values()).map((entry) => ({ ...entry.meta }));
  }
}

class Stage19MemoryHarness
  implements
    IAdminRepository,
    IContentRepository,
    ITaxonomyRepository,
    IViewEventRepository,
    IDownloadEventRepository
{
  private nextUserId = 100;
  private nextPermissionId = 1;
  private nextContentId = 1;
  private nextSourceId = 1;
  private nextFileId = 1;
  private nextTopicId = 1;
  private nextTagId = 1;
  private nextPersonId = 1;
  private nextImpactId = 1;
  private nextViewId = 1;
  private nextDownloadId = 1;

  public users: AppUser[] = [];
  public staffPermissions: StaffPermission[] = [];
  public featureFlags: FeatureFlag[] = [];
  public siteSettings: SiteSetting[] = [];
  public ageGroups: AgeGroup[] = INITIAL_AGE_GROUPS.map((item) => ({ ...item }));
  public topics: Topic[] = [];
  public tags: Tag[] = [];
  public persons: Person[] = [];
  public impactLevels: ImpactLevel[] = [];

  public contents: ContentItem[] = [];
  public sources: ContentSource[] = [];
  public files: ContentFile[] = [];
  public contentTopics: ContentTopic[] = [];
  public contentTags: ContentTag[] = [];
  public contentPersons: ContentPerson[] = [];
  public contentAgeGroups: Array<{ contentId: number; ageGroupId: number }> = [];

  public viewEvents: ViewEvent[] = [];
  public downloadEvents: DownloadEvent[] = [];

  public async createTestUser(params: {
    email: string;
    displayName: string;
    role: UserRole;
    ageGroupId?: number | null;
    permissions?: PermissionKey[];
  }): Promise<AppUser> {
    const user: AppUser = {
      id: this.nextUserId++,
      email: params.email,
      normalizedEmail: params.email.toUpperCase(),
      emailConfirmed: true,
      phoneNumber: null,
      normalizedPhoneNumber: null,
      phoneNumberConfirmed: false,
      passwordHash: null,
      passwordSalt: null,
      displayName: params.displayName,
      role: params.role,
      ageGroupId: params.ageGroupId ?? null,
      personalizationEnabled: false,
      mustChangePassword: false,
      isActive: true,
      isDeleted: false,
      deletedAt: null,
      failedLoginCount: 0,
      lockoutEnd: null,
      createdAt: '2026-11-01T08:00:00.000Z',
      lastLoginAt: null,
    };
    this.users.push(user);

    if (params.permissions && params.permissions.length > 0) {
      await this.replaceStaffPermissions(
        user.id,
        params.permissions.map((permissionKey) => ({
          userId: user.id,
          permissionKey,
          grantedAt: '2026-11-01T08:00:00.000Z',
          grantedById: user.id,
        })),
      );
    }

    return user;
  }

  // IAdminRepository
  public async getUserById(id: number): Promise<AppUser | null> {
    return this.users.find((u) => u.id === id) ?? null;
  }
  public async getUserByNormalizedEmail(normalizedEmail: string): Promise<AppUser | null> {
    return this.users.find((u) => u.normalizedEmail === normalizedEmail) ?? null;
  }
  public async getUserByNormalizedPhoneNumber(normalizedPhone: string): Promise<AppUser | null> {
    return this.users.find((u) => u.normalizedPhoneNumber === normalizedPhone) ?? null;
  }
  public async getAllUsers(): Promise<AppUser[]> {
    return [...this.users];
  }
  public async createUser(user: Omit<AppUser, 'id'>): Promise<AppUser> {
    const created = { ...user, id: this.nextUserId++ };
    this.users.push(created);
    return created;
  }
  public async updateUser(user: AppUser): Promise<void> {
    const idx = this.users.findIndex((u) => u.id === user.id);
    if (idx >= 0) this.users[idx] = { ...user };
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
    const created = permissions.map((p) => ({ ...p, id: this.nextPermissionId++ }));
    this.staffPermissions.push(...created);
    return created;
  }
  public async getAllFeatureFlags(): Promise<FeatureFlag[]> {
    return [...this.featureFlags];
  }
  public async upsertFeatureFlag(flag: FeatureFlag): Promise<void> {
    const idx = this.featureFlags.findIndex((f) => f.key === flag.key);
    if (idx >= 0) this.featureFlags[idx] = { ...flag };
    else this.featureFlags.push({ ...flag });
  }
  public async getAllSiteSettings(): Promise<SiteSetting[]> {
    return [...this.siteSettings];
  }
  public async getSiteSettingByKey(key: string): Promise<SiteSetting | null> {
    return this.siteSettings.find((s) => s.key === key) ?? null;
  }
  public async upsertSiteSettings(settings: SiteSetting[]): Promise<void> {
    for (const s of settings) {
      const idx = this.siteSettings.findIndex((item) => item.key === s.key);
      if (idx >= 0) this.siteSettings[idx] = { ...s };
      else this.siteSettings.push({ ...s });
    }
  }
  public async getActiveAgeGroups(): Promise<AgeGroup[]> {
    return this.ageGroups.filter((ag) => ag.isActive);
  }

  // IContentRepository
  public async getAllContentItems(): Promise<ContentItem[]> {
    return [...this.contents];
  }
  public async getContentItemById(id: number): Promise<ContentItem | null> {
    return this.contents.find((c) => c.id === id) ?? null;
  }
  public async getContentItemBySlug(slug: string): Promise<ContentItem | null> {
    return this.contents.find((c) => c.slug === slug) ?? null;
  }
  public async createContentItem(item: Omit<ContentItem, 'id'>): Promise<ContentItem> {
    const created: ContentItem = { ...item, id: this.nextContentId++ };
    this.contents.push(created);
    return created;
  }
  public async updateContentItem(item: ContentItem): Promise<void> {
    const idx = this.contents.findIndex((c) => c.id === item.id);
    if (idx >= 0) this.contents[idx] = { ...item };
  }
  public async getSourcesByContentId(contentId: number): Promise<ContentSource[]> {
    return this.sources.filter((s) => s.contentId === contentId);
  }
  public async getAllSources(): Promise<ContentSource[]> {
    return [...this.sources];
  }
  public async replaceSources(
    contentId: number,
    sources: Omit<ContentSource, 'id'>[],
  ): Promise<ContentSource[]> {
    this.sources = this.sources.filter((s) => s.contentId !== contentId);
    const created = sources.map((s) => ({ ...s, id: this.nextSourceId++ }));
    this.sources.push(...created);
    return created;
  }
  public async getFilesByContentId(contentId: number): Promise<ContentFile[]> {
    return this.files.filter((f) => f.contentId === contentId);
  }
  public async getAllFiles(): Promise<ContentFile[]> {
    return [...this.files];
  }
  public async replaceFiles(
    contentId: number,
    files: Omit<ContentFile, 'id'>[],
  ): Promise<ContentFile[]> {
    this.files = this.files.filter((f) => f.contentId !== contentId);
    const created = files.map((f) => ({ ...f, id: this.nextFileId++ }));
    this.files.push(...created);
    return created;
  }
  public async getTopicIdsByContentId(contentId: number): Promise<number[]> {
    return this.contentTopics
      .filter((ct) => ct.contentId === contentId)
      .map((ct) => ct.topicId);
  }
  public async getAllContentTopics(): Promise<ContentTopic[]> {
    return [...this.contentTopics];
  }
  public async replaceContentTopics(contentId: number, topicIds: number[]): Promise<void> {
    this.contentTopics = this.contentTopics.filter((ct) => ct.contentId !== contentId);
    for (const topicId of topicIds) {
      this.contentTopics.push({ contentId, topicId });
    }
  }
  public async getTagIdsByContentId(contentId: number): Promise<number[]> {
    return this.contentTags.filter((ct) => ct.contentId === contentId).map((ct) => ct.tagId);
  }
  public async getAllContentTags(): Promise<ContentTag[]> {
    return [...this.contentTags];
  }
  public async replaceContentTags(contentId: number, tagIds: number[]): Promise<void> {
    this.contentTags = this.contentTags.filter((ct) => ct.contentId !== contentId);
    for (const tagId of tagIds) this.contentTags.push({ contentId, tagId });
  }
  public async getPersonIdsByContentId(contentId: number): Promise<number[]> {
    return this.contentPersons
      .filter((cp) => cp.contentId === contentId)
      .map((cp) => cp.personId);
  }
  public async getAllContentPersons(): Promise<ContentPerson[]> {
    return [...this.contentPersons];
  }
  public async replaceContentPersons(contentId: number, personIds: number[]): Promise<void> {
    this.contentPersons = this.contentPersons.filter((cp) => cp.contentId !== contentId);
    for (const personId of personIds) this.contentPersons.push({ contentId, personId });
  }
  public async getAgeGroupIdsByContentId(contentId: number): Promise<number[]> {
    return this.contentAgeGroups
      .filter((ca) => ca.contentId === contentId)
      .map((ca) => ca.ageGroupId);
  }
  public async getAllContentAgeGroups(): Promise<
    Array<{ contentId: number; ageGroupId: number }>
  > {
    return [...this.contentAgeGroups];
  }
  public async replaceContentAgeGroups(
    contentId: number,
    ageGroupIds: number[],
  ): Promise<void> {
    this.contentAgeGroups = this.contentAgeGroups.filter(
      (ca) => ca.contentId !== contentId,
    );
    for (const ageGroupId of ageGroupIds) {
      this.contentAgeGroups.push({ contentId, ageGroupId });
    }
  }
  public async userExists(userId: number): Promise<boolean> {
    return this.users.some((u) => u.id === userId && !u.isDeleted);
  }

  // ITaxonomyRepository
  public async getAllTopics(): Promise<Topic[]> {
    return [...this.topics];
  }
  public async getTopicById(id: number): Promise<Topic | null> {
    return this.topics.find((t) => t.id === id) ?? null;
  }
  public async createTopic(topic: Omit<Topic, 'id'>): Promise<Topic> {
    const created = { ...topic, id: this.nextTopicId++ };
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
  public async getTagById(id: number): Promise<Tag | null> {
    return this.tags.find((t) => t.id === id) ?? null;
  }
  public async createTag(tag: Omit<Tag, 'id'>): Promise<Tag> {
    const created = { ...tag, id: this.nextTagId++ };
    this.tags.push(created);
    return created;
  }
  public async updateTag(tag: Tag): Promise<void> {
    const idx = this.tags.findIndex((t) => t.id === tag.id);
    if (idx >= 0) this.tags[idx] = { ...tag };
  }
  public async deleteTag(id: number): Promise<void> {
    this.tags = this.tags.filter((t) => t.id !== id);
  }
  public async getAllPersons(): Promise<Person[]> {
    return [...this.persons];
  }
  public async getPersonById(id: number): Promise<Person | null> {
    return this.persons.find((p) => p.id === id) ?? null;
  }
  public async createPerson(person: Omit<Person, 'id'>): Promise<Person> {
    const created = { ...person, id: this.nextPersonId++ };
    this.persons.push(created);
    return created;
  }
  public async updatePerson(person: Person): Promise<void> {
    const idx = this.persons.findIndex((p) => p.id === person.id);
    if (idx >= 0) this.persons[idx] = { ...person };
  }
  public async deletePerson(id: number): Promise<void> {
    this.persons = this.persons.filter((p) => p.id !== id);
  }
  public async getAllImpactLevels(): Promise<ImpactLevel[]> {
    return [...this.impactLevels];
  }
  public async getImpactLevelById(id: number): Promise<ImpactLevel | null> {
    return this.impactLevels.find((l) => l.id === id) ?? null;
  }
  public async createImpactLevel(level: Omit<ImpactLevel, 'id'>): Promise<ImpactLevel> {
    const created = { ...level, id: this.nextImpactId++ };
    this.impactLevels.push(created);
    return created;
  }
  public async updateImpactLevel(level: ImpactLevel): Promise<void> {
    const idx = this.impactLevels.findIndex((l) => l.id === level.id);
    if (idx >= 0) this.impactLevels[idx] = { ...level };
  }
  public async deleteImpactLevel(id: number): Promise<void> {
    this.impactLevels = this.impactLevels.filter((l) => l.id !== id);
  }
  public async getAllAgeGroups(): Promise<AgeGroup[]> {
    return [...this.ageGroups];
  }
  public async getAgeGroupById(id: number): Promise<AgeGroup | null> {
    return this.ageGroups.find((ag) => ag.id === id) ?? null;
  }
  public async updateAgeGroup(group: AgeGroup): Promise<void> {
    const idx = this.ageGroups.findIndex((ag) => ag.id === group.id);
    if (idx >= 0) this.ageGroups[idx] = { ...group };
  }
  public async getContentTopicLinks(): Promise<ContentTopic[]> {
    return [...this.contentTopics];
  }
  public async countContentTagsByTagId(tagId: number): Promise<number> {
    return this.contentTags.filter((ct) => ct.tagId === tagId).length;
  }
  public async countContentPersonsByPersonId(personId: number): Promise<number> {
    return this.contentPersons.filter((cp) => cp.personId === personId).length;
  }
  public async countContentItemsByImpactLevelId(impactLevelId: number): Promise<number> {
    return this.contents.filter((c) => c.impactLevelId === impactLevelId).length;
  }
  public async linkContentTopic(contentId: number, topicId: number): Promise<void> {
    this.contentTopics.push({ contentId, topicId });
  }

  // IViewEventRepository
  public async createViewEvent(event: Omit<ViewEvent, 'id'>): Promise<ViewEvent> {
    const created: ViewEvent = { ...event, id: this.nextViewId++ };
    this.viewEvents.push(created);
    return created;
  }
  public async getViewEventsByContentId(contentId: number): Promise<ViewEvent[]> {
    return this.viewEvents.filter((v) => v.contentId === contentId);
  }
  public async getAllViewEvents(): Promise<ViewEvent[]> {
    return [...this.viewEvents];
  }

  // IDownloadEventRepository
  public async createDownloadEvent(event: Omit<DownloadEvent, 'id'>): Promise<DownloadEvent> {
    const created: DownloadEvent = { ...event, id: this.nextDownloadId++ };
    this.downloadEvents.push(created);
    return created;
  }
  public async getDownloadEventsByContentId(contentId: number): Promise<DownloadEvent[]> {
    return this.downloadEvents.filter((d) => d.contentId === contentId);
  }
  public async getDownloadEventsByUserId(userId: number): Promise<DownloadEvent[]> {
    return this.downloadEvents.filter((d) => d.userId === userId);
  }
  public async getAllDownloadEvents(): Promise<DownloadEvent[]> {
    return [...this.downloadEvents];
  }
}

async function seedPublishedContent(
  harness: Stage19MemoryHarness,
  params: {
    title: string;
    slug: string;
    createdById: number;
    topicId: number;
    ageGroupIds?: number[];
  },
): Promise<ContentItem> {
  const item = await harness.createContentItem({
    title: params.title,
    slug: params.slug,
    summary: 'خلاصه آزمایشی مرحله ۱۹',
    body: '<p>متن آزمایشی</p>',
    format: 'Article',
    impactLevelId: null,
    status: ContentStatus.Published,
    publishedAt: '2026-11-10T10:00:00.000Z',
    readWatchMinutes: 5,
    thumbnailKey: null,
    isFeatured: false,
    languageCode: 'fa',
    searchText: params.title,
    viewCount: 0,
    downloadCount: 0,
    likeCount: 0,
    createdById: params.createdById,
    createdAt: '2026-11-10T10:00:00.000Z',
    updatedAt: '2026-11-10T10:00:00.000Z',
  });
  await harness.replaceContentTopics(item.id, [params.topicId]);
  if (params.ageGroupIds && params.ageGroupIds.length > 0) {
    await harness.replaceContentAgeGroups(item.id, params.ageGroupIds);
  }
  return item;
}

export const stage19Tests: UnitTestCase[] = [
  {
    id: 'stage19-metric-3-visitors-10-views-avg-33',
    nameKey: 'tests.stage19.metric3Visitors10ViewsAvg33.name',
    descriptionKey: 'tests.stage19.metric3Visitors10ViewsAvg33.desc',
    run: async () => {
      const clock = new Stage19FakeClock('2026-11-23T08:00:00.000Z');
      const logger = new AppLogger(clock, `meraj_s19_t1_${Date.now()}`, 50);
      const harness = new Stage19MemoryHarness();
      try {
        const superAdmin = await harness.createTestUser({
          email: 'sa19-t1@meraj.local',
          displayName: 'مدیرکل تست ۱۹',
          role: 'SuperAdmin',
        });
        const member = await harness.createTestUser({
          email: 'member19-t1@meraj.local',
          displayName: 'عضو آزمایشی ۱۹',
          role: 'Member',
          ageGroupId: 4,
        });

        const rootTopic = await harness.createTopic({
          name: 'تاریخ',
          slug: 'history',
          parentId: null,
          icon: null,
          sortOrder: 1,
          isActive: true,
        });
        const childTopic = await harness.createTopic({
          name: 'ایران معاصر',
          slug: 'contemporary-iran',
          parentId: rootTopic.id,
          icon: null,
          sortOrder: 1,
          isActive: true,
        });

        const c1 = await seedPublishedContent(harness, {
          title: 'مقاله تاریخ معاصر',
          slug: 'history-article-1',
          createdById: superAdmin.id,
          topicId: childTopic.id,
        });
        const c2 = await seedPublishedContent(harness, {
          title: 'مقاله تمدن',
          slug: 'civilization-article-2',
          createdById: superAdmin.id,
          topicId: rootTopic.id,
        });

        const tracker = new ViewTrackerService(harness, harness, clock, logger, harness);
        const dashboard = new AnalyticsDashboardService({
          viewEventRepository: harness,
          downloadEventRepository: harness,
          contentRepository: harness,
          permissionPolicyService: new PermissionPolicyService(harness, logger),
          clock,
          logger,
        });

        const ua = 'Mozilla/5.0 Chrome/130.0';

        // Visitor 1 (logged-in member): 4 counted views + 1 duplicate (10m gap -> NOT counted)
        await tracker.trackViewAsync({
          contentId: c1.id,
          userId: member.id,
          visitorId: 'vid-member-shared',
          userAgent: ua,
          ageGroupId: 4,
          primaryTopicId: null,
        });
        clock.advanceMinutes(10); // duplicate within 30m -> isCounted=false
        const dup1 = await tracker.trackViewAsync({
          contentId: c1.id,
          userId: member.id,
          visitorId: 'vid-member-shared',
          userAgent: ua,
          ageGroupId: 4,
          primaryTopicId: null,
        });
        assertEqual(dup1.isCounted, false, '10-minute repeat view must not be counted');

        clock.advanceMinutes(35);
        await tracker.trackViewAsync({
          contentId: c1.id,
          userId: member.id,
          visitorId: 'vid-member-shared',
          userAgent: ua,
          ageGroupId: 4,
          primaryTopicId: null,
        });
        clock.advanceMinutes(40);
        await tracker.trackViewAsync({
          contentId: c1.id,
          userId: member.id,
          visitorId: 'vid-member-shared',
          userAgent: ua,
          ageGroupId: 4,
          primaryTopicId: null,
        });
        await tracker.trackViewAsync({
          contentId: c2.id,
          userId: member.id,
          visitorId: 'vid-member-shared',
          userAgent: ua,
          ageGroupId: 4,
          primaryTopicId: rootTopic.id,
        });

        // Visitor 2 (guest-alpha): 3 counted views + 1 duplicate (10m gap -> NOT counted)
        clock.advanceMinutes(45);
        await tracker.trackViewAsync({
          contentId: c1.id,
          userId: null,
          visitorId: 'guest-alpha',
          userAgent: ua,
          ageGroupId: 2,
          primaryTopicId: childTopic.id,
        });
        clock.advanceMinutes(10); // duplicate -> isCounted=false
        const dup2 = await tracker.trackViewAsync({
          contentId: c1.id,
          userId: null,
          visitorId: 'guest-alpha',
          userAgent: ua,
          ageGroupId: 2,
          primaryTopicId: childTopic.id,
        });
        assertEqual(dup2.isCounted, false, 'Guest 10-minute repeat view must not be counted');

        clock.advanceMinutes(35);
        await tracker.trackViewAsync({
          contentId: c1.id,
          userId: null,
          visitorId: 'guest-alpha',
          userAgent: ua,
          ageGroupId: 2,
          primaryTopicId: childTopic.id,
        });
        await tracker.trackViewAsync({
          contentId: c2.id,
          userId: null,
          visitorId: 'guest-alpha',
          userAgent: ua,
          ageGroupId: 2,
          primaryTopicId: rootTopic.id,
        });

        // Visitor 3 (guest-beta): 3 counted views
        clock.advanceMinutes(45);
        await tracker.trackViewAsync({
          contentId: c1.id,
          userId: null,
          visitorId: 'guest-beta',
          userAgent: ua,
          ageGroupId: 1,
          primaryTopicId: childTopic.id,
        });
        clock.advanceMinutes(35);
        await tracker.trackViewAsync({
          contentId: c1.id,
          userId: null,
          visitorId: 'guest-beta',
          userAgent: ua,
          ageGroupId: 1,
          primaryTopicId: childTopic.id,
        });
        await tracker.trackViewAsync({
          contentId: c2.id,
          userId: null,
          visitorId: 'guest-beta',
          userAgent: ua,
          ageGroupId: 1,
          primaryTopicId: rootTopic.id,
        });

        const res = await dashboard.getBasicDashboardStatsAsync(superAdmin, { preset: '30d' });
        assert(res.ok, 'Dashboard stats call must succeed for SuperAdmin');
        assertEqual(res.data.summary.uniqueVisitors, 3, 'Must report exact 3 unique visitors');
        assertEqual(
          res.data.summary.totalCountedViews,
          10,
          'Must report exact 10 counted views (excluding 30m duplicates)',
        );
        assertEqual(
          res.data.summary.totalRawViews,
          12,
          'Raw views must include all 12 ViewEvent records',
        );
        assertEqual(
          res.data.summary.averageViewsPerVisitor,
          3.3,
          'Average 10/3 rounded to 1 decimal must be exact 3.3',
        );
      } finally {
        logger.clearLogs();
      }
    },
  },
  {
    id: 'stage19-top-lists-range-and-periods',
    nameKey: 'tests.stage19.topListsRangeFilterAndPeriods.name',
    descriptionKey: 'tests.stage19.topListsRangeFilterAndPeriods.desc',
    run: async () => {
      const clock = new Stage19FakeClock('2026-11-23T12:00:00.000Z');
      const logger = new AppLogger(clock, `meraj_s19_t2_${Date.now()}`, 50);
      const harness = new Stage19MemoryHarness();
      try {
        const superAdmin = await harness.createTestUser({
          email: 'sa19-t2@meraj.local',
          displayName: 'مدیرکل تست مرتب‌سازی',
          role: 'SuperAdmin',
        });
        const dlUser1 = await harness.createTestUser({
          email: 'dl1-s19@meraj.local',
          displayName: 'دانلودکننده ۱',
          role: 'Member',
          ageGroupId: 4,
        });
        const dlUser2 = await harness.createTestUser({
          email: 'dl2-s19@meraj.local',
          displayName: 'دانلودکننده ۲',
          role: 'Member',
          ageGroupId: 4,
        });

        const topic = await harness.createTopic({
          name: 'فرهنگ و هنر',
          slug: 'culture',
          parentId: null,
          icon: null,
          sortOrder: 1,
          isActive: true,
        });

        const m1 = await seedPublishedContent(harness, {
          title: 'محتوای اول M1',
          slug: 'm1-item',
          createdById: superAdmin.id,
          topicId: topic.id,
        });
        const m2 = await seedPublishedContent(harness, {
          title: 'محتوای دوم M2',
          slug: 'm2-item',
          createdById: superAdmin.id,
          topicId: topic.id,
        });
        const m3 = await seedPublishedContent(harness, {
          title: 'محتوای سوم M3',
          slug: 'm3-item',
          createdById: superAdmin.id,
          topicId: topic.id,
        });

        const recordCountedView = async (
          contentId: number,
          visitorId: string,
          occurredAt: string,
        ) => {
          await harness.createViewEvent({
            contentId,
            userId: null,
            visitorId,
            ageGroupId: 4,
            primaryTopicId: topic.id,
            occurredAt,
            isCounted: true,
          });
        };

        // Within 30d window: M2 = 5 views, M3 = 3 views, M1 = 2 views
        for (let i = 1; i <= 5; i += 1) {
          await recordCountedView(
            m2.id,
            `v-m2-${i}`,
            `2026-11-${String(15 + i).padStart(2, '0')}T10:00:00.000Z`,
          );
        }
        for (let i = 1; i <= 3; i += 1) {
          await recordCountedView(
            m3.id,
            `v-m3-${i}`,
            `2026-11-${String(10 + i).padStart(2, '0')}T11:00:00.000Z`,
          );
        }
        for (let i = 1; i <= 2; i += 1) {
          await recordCountedView(
            m1.id,
            `v-m1-${i}`,
            `2026-11-${String(20 + i).padStart(2, '0')}T12:00:00.000Z`,
          );
        }

        // Old view 40 days ago on M1 (excluded in 30d, included in all)
        await recordCountedView(m1.id, 'v-old-40d', '2026-10-14T09:00:00.000Z');

        // Downloads within 30d: M3 = 4, M1 = 2, M2 = 1 + 1 old download 40 days ago on M1
        const addDl = async (contentId: number, userId: number, occurredAt: string) => {
          await harness.createDownloadEvent({
            kind: DownloadKind.File,
            contentId,
            fileId: 10,
            userId,
            ageGroupId: 4,
            occurredAt,
          });
        };
        await addDl(m3.id, dlUser1.id, '2026-11-11T09:00:00.000Z');
        await addDl(m3.id, dlUser2.id, '2026-11-12T09:00:00.000Z');
        await addDl(m3.id, dlUser1.id, '2026-11-13T09:00:00.000Z');
        await addDl(m3.id, dlUser2.id, '2026-11-22T09:00:00.000Z');
        await addDl(m1.id, dlUser1.id, '2026-11-20T09:00:00.000Z');
        await addDl(m1.id, dlUser2.id, '2026-11-21T09:00:00.000Z');
        await addDl(m2.id, dlUser1.id, '2026-11-18T09:00:00.000Z');
        // 40 days ago download
        await addDl(m1.id, dlUser1.id, '2026-10-14T09:30:00.000Z');

        const dashboard = new AnalyticsDashboardService({
          viewEventRepository: harness,
          downloadEventRepository: harness,
          contentRepository: harness,
          permissionPolicyService: new PermissionPolicyService(harness, logger),
          clock,
          logger,
        });

        const res30 = await dashboard.getBasicDashboardStatsAsync(superAdmin, {
          preset: '30d',
        });
        assert(res30.ok, '30d dashboard query must succeed');
        assertEqual(res30.data.summary.totalCountedViews, 10, '30d must exclude 40-day-old view');
        assertEqual(res30.data.summary.totalDownloads, 7, '30d must exclude 40-day-old download');
        assertEqual(res30.data.summary.uniqueDownloaders, 2, 'Must count 2 unique downloaders');

        assertEqual(res30.data.topViewedContents.length, 3, 'Must return 3 viewed items');
        assertEqual(res30.data.topViewedContents[0].contentId, m2.id, '1st viewed must be M2');
        assertEqual(res30.data.topViewedContents[1].contentId, m3.id, '2nd viewed must be M3');
        assertEqual(res30.data.topViewedContents[2].contentId, m1.id, '3rd viewed must be M1');

        assertEqual(res30.data.topDownloadedContents.length, 3, 'Must return 3 downloaded items');
        assertEqual(res30.data.topDownloadedContents[0].contentId, m3.id, '1st downloaded must be M3');
        assertEqual(res30.data.topDownloadedContents[1].contentId, m1.id, '2nd downloaded must be M1');
        assertEqual(res30.data.topDownloadedContents[2].contentId, m2.id, '3rd downloaded must be M2');

        const dailyViewSum = res30.data.dailyStats.reduce((s, r) => s + r.countedViews, 0);
        const dailyDlSum = res30.data.dailyStats.reduce((s, r) => s + r.downloads, 0);
        assertEqual(dailyViewSum, 10, 'Sum of dailyStats.countedViews must equal 10');
        assertEqual(dailyDlSum, 7, 'Sum of dailyStats.downloads must equal 7');

        const weeklyViewSum = res30.data.weeklyStats.reduce((s, r) => s + r.countedViews, 0);
        const weeklyDlSum = res30.data.weeklyStats.reduce((s, r) => s + r.downloads, 0);
        assertEqual(weeklyViewSum, 10, 'Sum of weeklyStats.countedViews must equal 10');
        assertEqual(weeklyDlSum, 7, 'Sum of weeklyStats.downloads must equal 7');

        const resAll = await dashboard.getBasicDashboardStatsAsync(superAdmin, {
          preset: 'all',
        });
        assert(resAll.ok, 'all preset query must succeed');
        assertEqual(
          resAll.data.summary.totalCountedViews,
          11,
          'all preset must include the 40-day-old view',
        );
        assertEqual(
          resAll.data.summary.totalDownloads,
          8,
          'all preset must include the 40-day-old download',
        );
      } finally {
        logger.clearLogs();
      }
    },
  },
  {
    id: 'stage19-event-columns-integrity-idb',
    nameKey: 'tests.stage19.eventColumnsIntegrityRootTopicAndAge.name',
    descriptionKey: 'tests.stage19.eventColumnsIntegrityRootTopicAndAge.desc',
    run: async () => {
      const clock = new Stage19FakeClock('2026-11-23T14:00:00.000Z');
      const logger = new AppLogger(clock, `meraj_s19_t3_${Date.now()}`, 50);
      const harness = new Stage19MemoryHarness();
      const memStorage = new Stage19MemoryFileStorage(clock);
      const tokenProtector = new HmacDownloadTokenProtector();

      try {
        const superAdmin = await harness.createTestUser({
          email: 'sa19-t3@meraj.local',
          displayName: 'مدیرکل تست یکپارچگی',
          role: 'SuperAdmin',
          ageGroupId: 4,
        });
        const member = await harness.createTestUser({
          email: 'member19-t3@meraj.local',
          displayName: 'عضو نوجوان',
          role: 'Member',
          ageGroupId: 2,
        });
        const teenAge = harness.ageGroups.find((ag) => ag.id === 2)!;

        const rootTopic = await harness.createTopic({
          name: 'تاریخ',
          slug: 'history-root',
          parentId: null,
          icon: null,
          sortOrder: 1,
          isActive: true,
        });
        const childTopic = await harness.createTopic({
          name: 'ایران معاصر',
          slug: 'iran-contemporary',
          parentId: rootTopic.id,
          icon: null,
          sortOrder: 1,
          isActive: true,
        });

        const item = await seedPublishedContent(harness, {
          title: 'سند تاریخ معاصر',
          slug: 'contemporary-doc',
          createdById: superAdmin.id,
          topicId: childTopic.id,
        });

        const savedMeta = await memStorage.saveAsync({
          originalFileName: 'sample.pdf',
          bytes: new Uint8Array([37, 80, 68, 70, 45, 49, 46, 52]),
          contentType: 'application/pdf',
          visibility: 'private',
          uploadedById: member.id,
        });
        const [contentFile] = await harness.replaceFiles(item.id, [
          {
            contentId: item.id,
            kind: ContentFileKind.Main,
            storageType: FileStorageType.Local,
            storageKey: savedMeta.storageKey,
            externalUrl: null,
            originalFileName: 'sample.pdf',
            mimeType: 'application/pdf',
            sizeBytes: savedMeta.sizeBytes,
            sortOrder: 1,
            isDownloadable: true,
          },
        ]);

        // Even when primaryTopicId is passed as null OR as childTopic.id, ViewTrackerService with taxonomyRepository resolves root topic
        const tracker = new ViewTrackerService(harness, harness, clock, logger, harness);
        const viewRes = await tracker.trackViewAsync({
          contentId: item.id,
          userId: member.id,
          visitorId: 'vid-mem-t3',
          userAgent: 'Mozilla/5.0 Chrome/130.0',
          ageGroupId: teenAge.id,
          primaryTopicId: null,
        });
        assert(viewRes.event !== null, 'ViewEvent must be created');
        assertEqual(
          viewRes.event.primaryTopicId,
          rootTopic.id,
          'ViewEvent.primaryTopicId must resolve to root topic ID',
        );
        assertEqual(
          viewRes.event.ageGroupId,
          teenAge.id,
          'ViewEvent.ageGroupId must store active ageGroupId',
        );

        const dlService = new DownloadService(
          harness,
          harness,
          memStorage,
          tokenProtector,
          clock,
          logger,
        );
        const link = await dlService.createSignedDownloadLinkAsync({
          currentUser: member,
          contentId: item.id,
          fileId: contentFile.id,
          activeAgeGroup: teenAge,
        });
        assert(link.ok, 'Signed link creation must succeed');
        const exec = await dlService.executeSignedDownloadAsync({
          token: link.token,
          currentUser: member,
          activeAgeGroup: teenAge,
        });
        assert(exec.ok, 'Signed download execution must succeed');
        assertEqual(exec.event.ageGroupId, teenAge.id, 'DownloadEvent.ageGroupId must be stored');
        assertEqual(exec.event.contentId, item.id, 'DownloadEvent.contentId must match');
        assertEqual(exec.event.fileId, contentFile.id, 'DownloadEvent.fileId must match');
        assertEqual(exec.event.kind, DownloadKind.File, 'DownloadEvent.kind must be File');

        const dashboard = new AnalyticsDashboardService({
          viewEventRepository: harness,
          downloadEventRepository: harness,
          contentRepository: harness,
          permissionPolicyService: new PermissionPolicyService(harness, logger),
          clock,
          logger,
        });
        const statsRes = await dashboard.getBasicDashboardStatsAsync(superAdmin, {
          preset: '30d',
        });
        assert(statsRes.ok, 'Dashboard stats must succeed');
        assertEqual(statsRes.data.integrity.totalViewEvents, 1, 'Integrity totalViewEvents must be 1');
        assertEqual(
          statsRes.data.integrity.viewEventsWithAgeGroup,
          1,
          'Integrity viewEventsWithAgeGroup must be 1',
        );
        assertEqual(
          statsRes.data.integrity.viewEventsWithPrimaryTopic,
          1,
          'Integrity viewEventsWithPrimaryTopic must be 1',
        );
        assertEqual(
          statsRes.data.integrity.totalDownloadEvents,
          1,
          'Integrity totalDownloadEvents must be 1',
        );
        assertEqual(
          statsRes.data.integrity.downloadEventsWithAgeGroup,
          1,
          'Integrity downloadEventsWithAgeGroup must be 1',
        );

        // Real IndexedDB roundtrip check in browser
        assert(
          DATABASE_MIGRATIONS.some((m) => m.version === 12),
          'Migration version 12 must be registered',
        );
        assert(
          envConfig.databaseVersion >= 12,
          `envConfig.databaseVersion must be >= 12 (actual=${envConfig.databaseVersion})`,
        );

        if (typeof indexedDB !== 'undefined') {
          const idbStore = new IndexedDbDataStore(
            envConfig.databaseName,
            envConfig.databaseVersion,
            envConfig.metaStoreName,
          );
          const storeNames = await idbStore.getObjectStoreNames();
          for (const reqStore of [...STAGE13_OBJECT_STORES, ...STAGE14_OBJECT_STORES]) {
            assert(
              storeNames.includes(reqStore),
              `ObjectStore ${reqStore} must exist in IndexedDB v${envConfig.databaseVersion}`,
            );
          }

          const idbAuth = new IndexedDbAuthRepository(idbStore);
          const idbTaxonomy = new IndexedDbTaxonomyRepository(idbStore);
          const idbContent = new IndexedDbContentRepository(idbStore);
          const idbViews = new IndexedDbViewEventRepository(idbStore);
          const idbDownloads = new IndexedDbDownloadEventRepository(idbStore);
          const idbFileStorage = new LocalIndexedDbFileStorage(idbStore, clock);

          let tempUserId: number | null = null;
          let tempRootTopicId: number | null = null;
          let tempChildTopicId: number | null = null;
          let tempContentId: number | null = null;
          let tempStorageKey: string | null = null;
          let tempViewEventId: number | null = null;
          let tempDownloadEventId: number | null = null;

          try {
            const uniqueSuffix = `${Date.now()}_${Math.floor(Math.random() * 10000)}`;
            const realUser = await idbAuth.createUser({
              email: `s19_idb_${uniqueSuffix}@meraj.ir`,
              normalizedEmail: `S19_IDB_${uniqueSuffix}@MERAJ.IR`,
              emailConfirmed: true,
              phoneNumber: null,
              normalizedPhoneNumber: null,
              phoneNumberConfirmed: false,
              passwordHash: null,
              passwordSalt: null,
              displayName: 'کاربر تست یکپارچگی ۱۹',
              role: 'Member',
              ageGroupId: teenAge.id,
              personalizationEnabled: false,
              mustChangePassword: false,
              isActive: true,
              isDeleted: false,
              deletedAt: null,
              failedLoginCount: 0,
              lockoutEnd: null,
              createdAt: clock.nowUtcIso(),
              lastLoginAt: null,
            });
            tempUserId = realUser.id;

            const idbRoot = await idbTaxonomy.createTopic({
              name: `تاریخ تست ${uniqueSuffix}`,
              slug: `s19-root-${uniqueSuffix}`,
              parentId: null,
              icon: null,
              sortOrder: 999,
              isActive: true,
            });
            tempRootTopicId = idbRoot.id;

            const idbChild = await idbTaxonomy.createTopic({
              name: `ایران معاصر تست ${uniqueSuffix}`,
              slug: `s19-child-${uniqueSuffix}`,
              parentId: idbRoot.id,
              icon: null,
              sortOrder: 999,
              isActive: true,
            });
            tempChildTopicId = idbChild.id;

            const idbItem = await idbContent.createContentItem({
              title: 'محتوای تست یکپارچگی ۱۹',
              slug: `s19-content-${uniqueSuffix}`,
              summary: 'بررسی ستون‌های رویداد در IndexedDB',
              body: '<p>متن</p>',
              format: 'Article',
              impactLevelId: null,
              status: ContentStatus.Published,
              publishedAt: clock.nowUtcIso(),
              readWatchMinutes: 3,
              thumbnailKey: null,
              isFeatured: false,
              languageCode: 'fa',
              searchText: 'محتوای تست یکپارچگی ۱۹',
              viewCount: 0,
              downloadCount: 0,
              likeCount: 0,
              createdById: realUser.id,
              createdAt: clock.nowUtcIso(),
              updatedAt: clock.nowUtcIso(),
            });
            tempContentId = idbItem.id;
            await idbContent.replaceContentTopics(idbItem.id, [idbChild.id]);

            const uploaded = await idbFileStorage.saveAsync({
              originalFileName: 's19-check.pdf',
              bytes: new Uint8Array([37, 80, 68, 70, 45, 49, 46, 52]),
              contentType: 'application/pdf',
              visibility: 'private',
              uploadedById: realUser.id,
            });
            tempStorageKey = uploaded.storageKey;
            const [idbFile] = await idbContent.replaceFiles(idbItem.id, [
              {
                contentId: idbItem.id,
                kind: ContentFileKind.Main,
                storageType: FileStorageType.Local,
                storageKey: uploaded.storageKey,
                externalUrl: null,
                originalFileName: 's19-check.pdf',
                mimeType: 'application/pdf',
                sizeBytes: uploaded.sizeBytes,
                sortOrder: 1,
                isDownloadable: true,
              },
            ]);

            const idbTracker = new ViewTrackerService(
              idbViews,
              idbContent,
              clock,
              logger,
              idbTaxonomy,
            );
            const idbViewRes = await idbTracker.trackViewAsync({
              contentId: idbItem.id,
              userId: realUser.id,
              visitorId: `vid-idb-${uniqueSuffix}`,
              userAgent: 'Mozilla/5.0 Chrome/130.0',
              ageGroupId: teenAge.id,
              primaryTopicId: null,
            });
            tempViewEventId = idbViewRes.event?.id ?? null;

            const persistedViews = await idbViews.getViewEventsByContentId(idbItem.id);
            assertEqual(persistedViews.length, 1, 'IDB must store 1 ViewEvent');
            assertEqual(
              persistedViews[0].ageGroupId,
              teenAge.id,
              'Persisted IDB ViewEvent must have active ageGroupId',
            );
            assertEqual(
              persistedViews[0].primaryTopicId,
              idbRoot.id,
              'Persisted IDB ViewEvent must have root topic ID (not child topic ID)',
            );

            const idbDlService = new DownloadService(
              idbContent,
              idbDownloads,
              idbFileStorage,
              tokenProtector,
              clock,
              logger,
            );
            const idbLink = await idbDlService.createSignedDownloadLinkAsync({
              currentUser: realUser,
              contentId: idbItem.id,
              fileId: idbFile.id,
              activeAgeGroup: teenAge,
            });
            assert(idbLink.ok, 'IDB signed download link must succeed');
            const idbExec = await idbDlService.executeSignedDownloadAsync({
              token: idbLink.token,
              currentUser: realUser,
              activeAgeGroup: teenAge,
            });
            assert(idbExec.ok, 'IDB signed download execution must succeed');
            tempDownloadEventId = idbExec.event.id;

            const persistedDownloads = await idbDownloads.getDownloadEventsByContentId(
              idbItem.id,
            );
            assertEqual(persistedDownloads.length, 1, 'IDB must store 1 DownloadEvent');
            assertEqual(
              persistedDownloads[0].ageGroupId,
              teenAge.id,
              'Persisted IDB DownloadEvent must store active ageGroupId',
            );
          } finally {
            if (tempViewEventId !== null) {
              await idbStore.deleteByKey(STORE_NAMES.VIEW_EVENTS, tempViewEventId);
            }
            if (tempDownloadEventId !== null) {
              await idbStore.deleteByKey(STORE_NAMES.DOWNLOAD_EVENTS, tempDownloadEventId);
            }
            if (tempContentId !== null) {
              await idbContent.replaceContentTopics(tempContentId, []);
              await idbContent.replaceFiles(tempContentId, []);
              await idbStore.deleteByKey(STORE_NAMES.CONTENT_ITEMS, tempContentId);
            }
            if (tempStorageKey !== null) {
              await idbFileStorage.deleteAsync(tempStorageKey);
            }
            if (tempChildTopicId !== null) {
              await idbStore.deleteByKey(STORE_NAMES.TOPICS, tempChildTopicId);
            }
            if (tempRootTopicId !== null) {
              await idbStore.deleteByKey(STORE_NAMES.TOPICS, tempRootTopicId);
            }
            if (tempUserId !== null) {
              await idbStore.deleteByKey(STORE_NAMES.USERS, tempUserId);
            }
          }
        }
      } finally {
        logger.clearLogs();
      }
    },
  },
  {
    id: 'stage19-policy-and-invalid-range',
    nameKey: 'tests.stage19.policyAndInvalidRange.name',
    descriptionKey: 'tests.stage19.policyAndInvalidRange.desc',
    run: async () => {
      const clock = new Stage19FakeClock('2026-11-23T12:00:00.000Z');
      const logger = new AppLogger(clock, `meraj_s19_t4_${Date.now()}`, 50);
      const harness = new Stage19MemoryHarness();
      try {
        const superAdmin = await harness.createTestUser({
          email: 'sa19-t4@meraj.local',
          displayName: 'مدیرکل تست دسترسی',
          role: 'SuperAdmin',
        });
        const staffWithPerm = await harness.createTestUser({
          email: 'staff-dash@meraj.local',
          displayName: 'همکار دارای مجوز داشبورد',
          role: 'Staff',
          permissions: ['dashboard.view'],
        });
        const staffWithoutPerm = await harness.createTestUser({
          email: 'staff-nodash@meraj.local',
          displayName: 'همکار بدون مجوز داشبورد',
          role: 'Staff',
          permissions: ['content.manage'],
        });
        const member = await harness.createTestUser({
          email: 'member19-t4@meraj.local',
          displayName: 'عضو عادی',
          role: 'Member',
        });

        const dashboard = new AnalyticsDashboardService({
          viewEventRepository: harness,
          downloadEventRepository: harness,
          contentRepository: harness,
          permissionPolicyService: new PermissionPolicyService(harness, logger),
          clock,
          logger,
        });

        // Guest -> 404
        const guestRes = await dashboard.getBasicDashboardStatsAsync(null, { preset: '30d' });
        assertEqual(guestRes.ok, false, 'Guest must be denied');
        assertEqual(guestRes.statusCode, 404, 'Guest must receive 404');

        // Member -> 404
        const memberRes = await dashboard.getBasicDashboardStatsAsync(member, { preset: '30d' });
        assertEqual(memberRes.ok, false, 'Member must be denied');
        assertEqual(memberRes.statusCode, 404, 'Member must receive 404');

        // Staff without dashboard.view -> 403 + WARN log
        const logsBefore = logger.getLogs().length;
        const staffDenied = await dashboard.getBasicDashboardStatsAsync(staffWithoutPerm, {
          preset: '30d',
        });
        assertEqual(staffDenied.ok, false, 'Staff without dashboard.view must be denied');
        assertEqual(staffDenied.statusCode, 403, 'Staff without dashboard.view must get 403');
        const newLogs = logger.getLogs().slice(0, logger.getLogs().length - logsBefore + 1);
        const warnLog = logger
          .getLogs()
          .find(
            (l) =>
              l.level === 'WARN' &&
              l.message === 'ADMIN_ACCESS_DENIED' &&
              l.details?.requiredPermission === 'dashboard.view',
          );
        assert(warnLog !== undefined && newLogs.length >= 1, '403 denial must record WARN log');

        // Staff with dashboard.view -> 200
        const staffAllowed = await dashboard.getBasicDashboardStatsAsync(staffWithPerm, {
          preset: '30d',
        });
        assertEqual(staffAllowed.ok, true, 'Staff with dashboard.view must succeed');
        assertEqual(staffAllowed.statusCode, 200, 'Staff with dashboard.view must get 200');

        // SuperAdmin -> 200
        const saAllowed = await dashboard.getBasicDashboardStatsAsync(superAdmin, {
          preset: '30d',
        });
        assertEqual(saAllowed.ok, true, 'SuperAdmin must succeed');

        // Custom invalid range (from > to) -> INVALID_DATE_RANGE (400)
        const invalidRange = await dashboard.getBasicDashboardStatsAsync(staffWithPerm, {
          preset: 'custom',
          fromIso: '2026-11-22',
          toIso: '2026-11-10',
        });
        assert(!invalidRange.ok, 'from > to range must fail');
        assertEqual(invalidRange.statusCode, 400, 'Invalid date range must return 400');
        assertEqual(
          invalidRange.errorCode,
          'INVALID_DATE_RANGE',
          'Invalid date range must return INVALID_DATE_RANGE',
        );
      } finally {
        logger.clearLogs();
      }
    },
  },
  {
    id: 'stage19-jalali-calendar-and-conversion',
    nameKey: 'tests.stage19.jalaliCalendarAndConversion.name',
    descriptionKey: 'tests.stage19.jalaliCalendarAndConversion.desc',
    run: async () => {
      // 1. Leap-year verification (1403 leap = 30 Esfand, 1404 non-leap = 29 Esfand)
      assertEqual(isJalaliLeapYear(1399), true, '1399 must be a Jalali leap year');
      assertEqual(isJalaliLeapYear(1403), true, '1403 must be a Jalali leap year');
      assertEqual(isJalaliLeapYear(1404), false, '1404 must NOT be a Jalali leap year');
      assertEqual(isJalaliLeapYear(1408), true, '1408 must be a Jalali leap year');

      assertEqual(getJalaliMonthLength(1403, 1), 31, 'Farvardin must have 31 days');
      assertEqual(getJalaliMonthLength(1403, 7), 30, 'Mehr must have 30 days');
      assertEqual(getJalaliMonthLength(1403, 12), 30, 'Esfand 1403 (leap) must have 30 days');
      assertEqual(getJalaliMonthLength(1404, 12), 29, 'Esfand 1404 (non-leap) must have 29 days');

      // 2. Round-trip conversions for key milestone dates
      const milestones: Array<{
        j: { jy: number; jm: number; jd: number };
        g: { gy: number; gm: number; gd: number };
        label: string;
      }> = [
        { j: { jy: 1403, jm: 1, jd: 1 }, g: { gy: 2024, gm: 3, gd: 20 }, label: '1403/01/01 (Nowruz 1403)' },
        { j: { jy: 1403, jm: 12, jd: 30 }, g: { gy: 2025, gm: 3, gd: 20 }, label: '1403/12/30 (Leap Esfand)' },
        { j: { jy: 1404, jm: 1, jd: 1 }, g: { gy: 2025, gm: 3, gd: 21 }, label: '1404/01/01 (Nowruz 1404)' },
        { j: { jy: 1404, jm: 12, jd: 29 }, g: { gy: 2026, gm: 3, gd: 20 }, label: '1404/12/29' },
        { j: { jy: 1405, jm: 1, jd: 1 }, g: { gy: 2026, gm: 3, gd: 21 }, label: '1405/01/01 (Nowruz 1405)' },
        { j: { jy: 1405, jm: 9, jd: 2 }, g: { gy: 2026, gm: 11, gd: 23 }, label: '1405/09/02' },
        { j: { jy: 1378, jm: 12, jd: 10 }, g: { gy: 2000, gm: 2, gd: 29 }, label: '2000-02-29 Gregorian leap' },
      ];

      for (const m of milestones) {
        const gOut = jalaliToGregorian(m.j.jy, m.j.jm, m.j.jd);
        assertEqual(gOut.gy, m.g.gy, `${m.label}: gy mismatch`);
        assertEqual(gOut.gm, m.g.gm, `${m.label}: gm mismatch`);
        assertEqual(gOut.gd, m.g.gd, `${m.label}: gd mismatch`);

        const jOut = gregorianToJalali(m.g.gy, m.g.gm, m.g.gd);
        assertEqual(jOut.jy, m.j.jy, `${m.label}: roundtrip jy mismatch`);
        assertEqual(jOut.jm, m.j.jm, `${m.label}: roundtrip jm mismatch`);
        assertEqual(jOut.jd, m.j.jd, `${m.label}: roundtrip jd mismatch`);
      }

      // 3. Weekday index (Saturday=0..Friday=6): 1405/09/02 = 2026-11-23 (Monday -> index 2)
      assertEqual(
        getJalaliWeekdayIndex(1405, 9, 2),
        2,
        '1405/09/02 (2026-11-23) must be Monday (weekday index 2 starting Saturday=0)',
      );

      // 4. Format & parse validation (Persian, Arabic, Latin digits, "/" and "-", strict bounds)
      assertEqual(
        formatJalaliDate(1405, 9, 2, true),
        '۱۴۰۵/۰۹/۰۲',
        'formatJalaliDate default must use Persian digits',
      );
      assertEqual(
        formatJalaliDate(1405, 9, 2, false),
        '1405/09/02',
        'formatJalaliDate(usePersianDigits=false) must use Latin digits',
      );

      const pPersian = parseJalaliInput('۱۴۰۵/۰۹/۰۲');
      assert(pPersian !== null, 'Must parse Persian digits ۱۴۰۵/۰۹/۰۲');
      assertEqual(pPersian.jy, 1405, 'Parsed Persian year must be 1405');
      assertEqual(pPersian.jm, 9, 'Parsed Persian month must be 9');
      assertEqual(pPersian.jd, 2, 'Parsed Persian day must be 2');

      const pLatinDash = parseJalaliInput('1405-09-02');
      assert(pLatinDash !== null, 'Must parse Latin hyphenated date 1405-09-02');
      assertEqual(pLatinDash.jy, 1405, 'Parsed Latin year must be 1405');
      assertEqual(pLatinDash.jm, 9, 'Parsed Latin month must be 9');
      assertEqual(pLatinDash.jd, 2, 'Parsed Latin day must be 2');

      const pArabic = parseJalaliInput('١٤٠٣/١٢/٣٠');
      assert(pArabic !== null, 'Must parse Arabic digits for leap Esfand 1403/12/30');
      assertEqual(pArabic.jd, 30, 'Parsed Arabic day must be 30');

      assertEqual(
        parseJalaliInput('1404/12/30'),
        null,
        'Non-leap 1404/12/30 must be rejected as invalid',
      );
      assertEqual(
        parseJalaliInput('۱۴۰۴/۱۲/۳۰'),
        null,
        'Non-leap ۱۴۰۴/۱۲/۳۰ with Persian digits must be rejected as invalid',
      );
      assertEqual(
        parseJalaliInput('1405/07/31'),
        null,
        '31st day in 30-day month Mehr must be rejected as invalid',
      );
      assertEqual(
        parseJalaliInput('1405/13/01'),
        null,
        'Month 13 must be rejected as invalid',
      );
      assertEqual(parseJalaliInput('not-a-date'), null, 'Malformed input must return null');

      // 5. UTC range conversion and end-to-end integration with AnalyticsDashboardService
      const utcBounds = jalaliToUtcRangeBounds('۱۴۰۳/۱۲/۳۰', '۱۴۰۵/۰۹/۰۲');
      assert(utcBounds !== null, 'Valid Jalali range must produce UTC bounds');
      assertEqual(
        utcBounds.fromIso,
        '2025-03-20T00:00:00.000Z',
        '1403/12/30 start bound must be 2025-03-20T00:00:00.000Z',
      );
      assertEqual(
        utcBounds.toIso,
        '2026-11-23T23:59:59.999Z',
        '1405/09/02 end bound must be 2026-11-23T23:59:59.999Z',
      );
      assertEqual(
        jalaliToUtcRangeBounds('1404/12/30', '1405/09/02'),
        null,
        'Invalid Jalali date in range must return null',
      );

      // End-to-end inverted Jalali range passes ISO bounds and produces INVALID_DATE_RANGE
      const clock = new Stage19FakeClock('2026-11-23T12:00:00.000Z');
      const logger = new AppLogger(clock, `meraj_s19_t5_${Date.now()}`, 50);
      const harness = new Stage19MemoryHarness();
      try {
        const superAdmin = await harness.createTestUser({
          email: 'sa19-t5@meraj.local',
          displayName: 'مدیرکل تست تقویم',
          role: 'SuperAdmin',
        });
        const dashboard = new AnalyticsDashboardService({
          viewEventRepository: harness,
          downloadEventRepository: harness,
          contentRepository: harness,
          permissionPolicyService: new PermissionPolicyService(harness, logger),
          clock,
          logger,
        });
        const invertedBounds = jalaliToUtcRangeBounds('۱۴۰۵/۰۹/۰۵', '۱۴۰۵/۰۹/۰۱');
        assert(invertedBounds !== null, 'Parseable inverted dates still return ISO strings');
        const invertedRes = await dashboard.getBasicDashboardStatsAsync(superAdmin, {
          preset: 'custom',
          fromIso: invertedBounds.fromIso,
          toIso: invertedBounds.toIso,
        });
        assert(!invertedRes.ok, 'Inverted Jalali range must fail validation in dashboard service');
        assertEqual(
          invertedRes.errorCode,
          'INVALID_DATE_RANGE',
          'Inverted Jalali range must emit INVALID_DATE_RANGE',
        );
      } finally {
        logger.clearLogs();
      }
    },
  },
];
