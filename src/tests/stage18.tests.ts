import type { IClock } from '../core/abstractions/IClock';
import type { IAdminRepository } from '../core/abstractions/adminRepository';
import type { IContentRepository } from '../core/abstractions/contentRepository';
import type { FileReadRangeResult, IFileStorage } from '../core/abstractions/fileStorage';
import type { ILayoutRepository } from '../core/abstractions/layoutRepository';
import type { ITaxonomyRepository } from '../core/abstractions/taxonomyRepository';
import type { IViewEventRepository } from '../core/abstractions/viewTracker';
import type { ViewEvent } from '../core/domain/analytics';
import type { AppUser } from '../core/domain/auth';
import {
  ContentStatus,
  type ContentAgeGroup,
  type ContentFile,
  type ContentItem,
  type ContentPerson,
  type ContentSource,
  type ContentTag,
  type ContentTopic,
} from '../core/domain/content';
import type { HeroSlide, HomeShelf, StaticPage } from '../core/domain/layout';
import type { PermissionKey, StaffPermission } from '../core/domain/permissions';
import {
  FEATURE_FLAG_KEYS,
  type FeatureFlag,
  type SiteSetting,
} from '../core/domain/settings';
import type { FileVisibility, StoredFileMetadata } from '../core/domain/storage';
import type {
  AgeGroup,
  ImpactLevel,
  Person,
  Tag,
  Topic,
} from '../core/domain/taxonomy';
import { FileUploadService } from '../core/services/fileUploadService';
import { HomePageService } from '../core/services/homePageService';
import { LayoutManagementService } from '../core/services/layoutManagementService';
import { PermissionPolicyService } from '../core/services/permissionPolicyService';
import { SystemClock } from '../infrastructure/clock/SystemClock';
import { envConfig } from '../infrastructure/config/envConfig';
import { IndexedDbDataStore } from '../infrastructure/data/IndexedDbDataStore';
import { IndexedDbLayoutRepository } from '../infrastructure/data/IndexedDbLayoutRepository';
import {
  DATABASE_MIGRATIONS,
  STAGE18_OBJECT_STORES,
  STORE_NAMES,
} from '../infrastructure/data/migrations';
import { INITIAL_AGE_GROUPS } from '../infrastructure/data/seed';
import { ensureStage18LayoutSeededAsync } from '../infrastructure/data/stage18LayoutSeed';
import { AppLogger } from '../infrastructure/logging/AppLogger';
import { assert, assertEqual, type UnitTestCase } from './testRunner';

class Stage18FakeClock implements IClock {
  private iso: string;
  private readonly inner = new SystemClock();

  constructor(initialIso = '2026-11-23T12:00:00.000Z') {
    this.iso = initialIso;
  }

  public advanceDays(days: number): void {
    this.iso = new Date(this.now().getTime() + days * 24 * 60 * 60 * 1000).toISOString();
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

class MemoryStage18FileStorage implements IFileStorage {
  private files = new Map<string, { bytes: Uint8Array; metadata: StoredFileMetadata }>();
  private seq = 1;

  public async saveAsync(input: {
    bytes: Uint8Array;
    originalFileName: string;
    contentType: string;
    visibility: FileVisibility;
    uploadedById: number;
  }): Promise<StoredFileMetadata> {
    const ext = input.originalFileName.split('.').pop()?.toLowerCase() ?? 'png';
    const key = `${input.visibility}/2026/11/file-${this.seq++}.${ext}`;
    const metadata: StoredFileMetadata = {
      storageKey: key,
      originalFileName: input.originalFileName,
      mimeType: input.contentType,
      extension: ext,
      sizeBytes: input.bytes.byteLength,
      visibility: input.visibility,
      category: 'image',
      uploadedById: input.uploadedById,
      createdAt: new Date().toISOString(),
    };
    this.files.set(key, { bytes: new Uint8Array(input.bytes), metadata });
    return { ...metadata };
  }

  public async openReadAsync(storageKey: string): Promise<{
    metadata: StoredFileMetadata;
    bytes: Uint8Array;
  } | null> {
    const found = this.files.get(storageKey);
    return found
      ? { metadata: { ...found.metadata }, bytes: new Uint8Array(found.bytes) }
      : null;
  }

  public async openReadRangeAsync(
    storageKey: string,
    startByte: number,
    endByte: number,
  ): Promise<FileReadRangeResult | null> {
    const found = this.files.get(storageKey);
    if (!found) {
      return null;
    }
    const clampedEnd = Math.min(endByte, found.bytes.byteLength - 1);
    return {
      chunk: found.bytes.slice(startByte, clampedEnd + 1),
      totalBytes: found.bytes.byteLength,
      startByte,
      endByte: clampedEnd,
      mimeType: found.metadata.mimeType,
    };
  }

  public async getMetadataAsync(storageKey: string): Promise<StoredFileMetadata | null> {
    const found = this.files.get(storageKey);
    return found ? { ...found.metadata } : null;
  }

  public async deleteAsync(storageKey: string): Promise<void> {
    this.files.delete(storageKey);
  }

  public async existsAsync(storageKey: string): Promise<boolean> {
    return this.files.has(storageKey);
  }

  public async listAllMetadataAsync(): Promise<StoredFileMetadata[]> {
    return Array.from(this.files.values()).map((v) => ({ ...v.metadata }));
  }
}

class MemoryStage18Harness
  implements
    ILayoutRepository,
    IContentRepository,
    ITaxonomyRepository,
    IAdminRepository,
    IViewEventRepository
{
  private heroSlides: HeroSlide[] = [];
  private homeShelves: HomeShelf[] = [];
  private staticPages: StaticPage[] = [];
  private slideSeq = 1;
  private shelfSeq = 1;
  private pageSeq = 1;

  private users: AppUser[] = [];
  private staffPermissions: StaffPermission[] = [];
  private siteSettings: SiteSetting[] = [{ key: 'Home.ItemsPerShelf', value: '12' }];
  private featureFlags: FeatureFlag[] = FEATURE_FLAG_KEYS.map((key) => ({
    key,
    isEnabled: false,
  }));

  private ageGroups: AgeGroup[] = INITIAL_AGE_GROUPS.map((g, idx) => ({
    ...g,
    id: idx + 1,
  }));
  private topics: Topic[] = [];
  private tags: Tag[] = [];
  private persons: Person[] = [];
  private impactLevels: ImpactLevel[] = [{ id: 1, name: 'عادی', sortOrder: 1 }];

  private items: ContentItem[] = [];
  private sources: ContentSource[] = [];
  private files: ContentFile[] = [];
  private contentTopics: ContentTopic[] = [];
  private contentTags: ContentTag[] = [];
  private contentPersons: ContentPerson[] = [];
  private contentAgeGroups: ContentAgeGroup[] = [];
  private viewEvents: ViewEvent[] = [];

  private userSeq = 1;
  private permSeq = 1;
  private topicSeq = 1;
  private tagSeq = 1;
  private personSeq = 1;
  private impactSeq = 10;
  private contentSeq = 1;
  private sourceSeq = 1;
  private fileSeq = 1;
  private viewSeq = 1;

  public addUser(role: AppUser['role'], permissions: PermissionKey[] = []): AppUser {
    const id = this.userSeq++;
    const user: AppUser = {
      id,
      email: `user${id}@stage18.test`,
      normalizedEmail: `USER${id}@STAGE18.TEST`,
      emailConfirmed: true,
      phoneNumber: null,
      normalizedPhoneNumber: null,
      phoneNumberConfirmed: false,
      passwordHash: 'hash',
      passwordSalt: 'salt',
      displayName: `کاربر ${id}`,
      role,
      ageGroupId: 4,
      personalizationEnabled: false,
      mustChangePassword: false,
      isActive: true,
      isDeleted: false,
      deletedAt: null,
      failedLoginCount: 0,
      lockoutEnd: null,
      createdAt: '2026-11-23T00:00:00.000Z',
      lastLoginAt: null,
    };
    this.users.push(user);
    for (const permissionKey of permissions) {
      this.staffPermissions.push({
        id: this.permSeq++,
        userId: id,
        permissionKey,
        grantedById: 0,
        grantedAt: '2026-11-23T00:00:00.000Z',
      });
    }
    return user;
  }

  public addTopicSeed(name: string, parentId: number | null = null): Topic {
    const id = this.topicSeq++;
    const topic: Topic = {
      id,
      parentId,
      name,
      slug: `topic-${id}`,
      icon: null,
      sortOrder: id,
      isActive: true,
    };
    this.topics.push(topic);
    return topic;
  }

  public addPublishedContent(options: {
    title: string;
    topicIds?: number[];
    ageGroupIds?: number[];
    isFeatured?: boolean;
    publishedAt?: string;
  }): ContentItem {
    const id = this.contentSeq++;
    const item: ContentItem = {
      id,
      title: options.title,
      slug: `content-${id}`,
      summary: `خلاصه ${options.title}`,
      body: null,
      format: 'Article',
      status: ContentStatus.Published,
      isFeatured: options.isFeatured ?? false,
      readWatchMinutes: 5,
      impactLevelId: 1,
      thumbnailKey: null,
      languageCode: 'fa',
      searchText: options.title,
      viewCount: 0,
      likeCount: 0,
      downloadCount: 0,
      createdById: 1,
      publishedAt:
        options.publishedAt ??
        `2026-11-${String(10 + (id % 10)).padStart(2, '0')}T10:00:00.000Z`,
      createdAt: '2026-11-10T10:00:00.000Z',
      updatedAt: '2026-11-10T10:00:00.000Z',
    };
    this.items.push(item);

    for (const topicId of options.topicIds ?? []) {
      this.contentTopics.push({ contentId: id, topicId });
    }
    for (const ageGroupId of options.ageGroupIds ?? []) {
      this.contentAgeGroups.push({ contentId: id, ageGroupId });
    }
    return item;
  }

  // ILayoutRepository
  public async getAllHeroSlides(): Promise<HeroSlide[]> {
    return this.heroSlides.map((s) => ({ ...s }));
  }
  public async getHeroSlideById(id: number): Promise<HeroSlide | null> {
    const found = this.heroSlides.find((s) => s.id === id);
    return found ? { ...found } : null;
  }
  public async createHeroSlide(slide: Omit<HeroSlide, 'id'>): Promise<HeroSlide> {
    const created = { ...slide, id: this.slideSeq++ };
    this.heroSlides.push(created);
    return { ...created };
  }
  public async updateHeroSlide(slide: HeroSlide): Promise<HeroSlide> {
    const idx = this.heroSlides.findIndex((s) => s.id === slide.id);
    if (idx !== -1) this.heroSlides[idx] = { ...slide };
    return { ...slide };
  }
  public async deleteHeroSlide(id: number): Promise<void> {
    this.heroSlides = this.heroSlides.filter((s) => s.id !== id);
  }

  public async getAllHomeShelves(): Promise<HomeShelf[]> {
    return this.homeShelves.map((s) => ({ ...s }));
  }
  public async getHomeShelfById(id: number): Promise<HomeShelf | null> {
    const found = this.homeShelves.find((s) => s.id === id);
    return found ? { ...found } : null;
  }
  public async createHomeShelf(shelf: Omit<HomeShelf, 'id'>): Promise<HomeShelf> {
    const created = { ...shelf, id: this.shelfSeq++ };
    this.homeShelves.push(created);
    return { ...created };
  }
  public async updateHomeShelf(shelf: HomeShelf): Promise<HomeShelf> {
    const idx = this.homeShelves.findIndex((s) => s.id === shelf.id);
    if (idx !== -1) this.homeShelves[idx] = { ...shelf };
    return { ...shelf };
  }
  public async deleteHomeShelf(id: number): Promise<void> {
    this.homeShelves = this.homeShelves.filter((s) => s.id !== id);
  }

  public async getAllStaticPages(): Promise<StaticPage[]> {
    return this.staticPages.map((p) => ({ ...p }));
  }
  public async getStaticPageById(id: number): Promise<StaticPage | null> {
    const found = this.staticPages.find((p) => p.id === id);
    return found ? { ...found } : null;
  }
  public async getStaticPageBySlug(slug: string): Promise<StaticPage | null> {
    const found = this.staticPages.find((p) => p.slug === slug);
    return found ? { ...found } : null;
  }
  public async createStaticPage(page: Omit<StaticPage, 'id'>): Promise<StaticPage> {
    const created = { ...page, id: this.pageSeq++ };
    this.staticPages.push(created);
    return { ...created };
  }
  public async updateStaticPage(page: StaticPage): Promise<StaticPage> {
    const idx = this.staticPages.findIndex((p) => p.id === page.id);
    if (idx !== -1) this.staticPages[idx] = { ...page };
    return { ...page };
  }
  public async deleteStaticPage(id: number): Promise<void> {
    this.staticPages = this.staticPages.filter((p) => p.id !== id);
  }

  // IViewEventRepository
  public async createViewEvent(event: Omit<ViewEvent, 'id'>): Promise<ViewEvent> {
    const created = { ...event, id: this.viewSeq++ };
    this.viewEvents.push(created);
    return { ...created };
  }
  public async getViewEventsByContentId(contentId: number): Promise<ViewEvent[]> {
    return this.viewEvents.filter((e) => e.contentId === contentId);
  }
  public async getAllViewEvents(): Promise<ViewEvent[]> {
    return this.viewEvents.map((e) => ({ ...e }));
  }

  // IContentRepository
  public async getAllContentItems(): Promise<ContentItem[]> {
    return this.items.map((i) => ({ ...i }));
  }
  public async getContentItemById(id: number): Promise<ContentItem | null> {
    return this.items.find((i) => i.id === id) ?? null;
  }
  public async getContentItemBySlug(slug: string): Promise<ContentItem | null> {
    return this.items.find((i) => i.slug === slug) ?? null;
  }
  public async createContentItem(item: Omit<ContentItem, 'id'>): Promise<ContentItem> {
    const created = { ...item, id: this.contentSeq++ };
    this.items.push(created);
    return created;
  }
  public async updateContentItem(item: ContentItem): Promise<void> {
    this.items = this.items.map((i) => (i.id === item.id ? item : i));
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
    const created = sources.map((s) => ({ ...s, id: this.sourceSeq++ }));
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
    const created = files.map((f) => ({ ...f, id: this.fileSeq++ }));
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
    return this.contentTags
      .filter((ct) => ct.contentId === contentId)
      .map((ct) => ct.tagId);
  }
  public async getAllContentTags(): Promise<ContentTag[]> {
    return [...this.contentTags];
  }
  public async replaceContentTags(contentId: number, tagIds: number[]): Promise<void> {
    this.contentTags = this.contentTags.filter((ct) => ct.contentId !== contentId);
    for (const tagId of tagIds) {
      this.contentTags.push({ contentId, tagId });
    }
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
    for (const personId of personIds) {
      this.contentPersons.push({ contentId, personId });
    }
  }
  public async getAllContentAgeGroups(): Promise<ContentAgeGroup[]> {
    return [...this.contentAgeGroups];
  }
  public async getAgeGroupIdsByContentId(contentId: number): Promise<number[]> {
    return this.contentAgeGroups
      .filter((ca) => ca.contentId === contentId)
      .map((ca) => ca.ageGroupId);
  }
  public async replaceContentAgeGroups(
    contentId: number,
    ageGroupIds: number[],
  ): Promise<void> {
    this.contentAgeGroups = this.contentAgeGroups.filter((ca) => ca.contentId !== contentId);
    for (const ageGroupId of ageGroupIds) {
      this.contentAgeGroups.push({ contentId, ageGroupId });
    }
  }
  public async userExists(userId: number): Promise<boolean> {
    return this.users.some((u) => u.id === userId);
  }

  // ITaxonomyRepository
  public async getAllAgeGroups(): Promise<AgeGroup[]> {
    return [...this.ageGroups];
  }
  public async getAgeGroupById(id: number): Promise<AgeGroup | null> {
    return this.ageGroups.find((g) => g.id === id) ?? null;
  }
  public async updateAgeGroup(group: AgeGroup): Promise<void> {
    this.ageGroups = this.ageGroups.map((g) => (g.id === group.id ? group : g));
  }
  public async getAllTopics(): Promise<Topic[]> {
    return [...this.topics];
  }
  public async getTopicById(id: number): Promise<Topic | null> {
    return this.topics.find((t) => t.id === id) ?? null;
  }
  public async createTopic(topic: Omit<Topic, 'id'>): Promise<Topic> {
    const created = { ...topic, id: this.topicSeq++ };
    this.topics.push(created);
    return created;
  }
  public async updateTopic(topic: Topic): Promise<void> {
    this.topics = this.topics.map((t) => (t.id === topic.id ? topic : t));
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
    const created = { ...tag, id: this.tagSeq++ };
    this.tags.push(created);
    return created;
  }
  public async updateTag(tag: Tag): Promise<void> {
    this.tags = this.tags.map((t) => (t.id === tag.id ? tag : t));
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
    const created = { ...person, id: this.personSeq++ };
    this.persons.push(created);
    return created;
  }
  public async updatePerson(person: Person): Promise<void> {
    this.persons = this.persons.map((p) => (p.id === person.id ? person : p));
  }
  public async deletePerson(id: number): Promise<void> {
    this.persons = this.persons.filter((p) => p.id !== id);
  }
  public async getAllImpactLevels(): Promise<ImpactLevel[]> {
    return [...this.impactLevels];
  }
  public async getImpactLevelById(id: number): Promise<ImpactLevel | null> {
    return this.impactLevels.find((i) => i.id === id) ?? null;
  }
  public async createImpactLevel(level: Omit<ImpactLevel, 'id'>): Promise<ImpactLevel> {
    const created = { ...level, id: this.impactSeq++ };
    this.impactLevels.push(created);
    return created;
  }
  public async updateImpactLevel(level: ImpactLevel): Promise<void> {
    this.impactLevels = this.impactLevels.map((i) => (i.id === level.id ? level : i));
  }
  public async deleteImpactLevel(id: number): Promise<void> {
    this.impactLevels = this.impactLevels.filter((i) => i.id !== id);
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
    return this.items.filter((i) => i.impactLevelId === impactLevelId).length;
  }
  public async linkContentTopic(contentId: number, topicId: number): Promise<void> {
    this.contentTopics.push({ contentId, topicId });
  }

  // IAdminRepository
  public async getAllUsers(): Promise<AppUser[]> {
    return [...this.users];
  }
  public async getUserById(id: number): Promise<AppUser | null> {
    return this.users.find((u) => u.id === id) ?? null;
  }
  public async getUserByNormalizedEmail(): Promise<AppUser | null> {
    return null;
  }
  public async getUserByNormalizedPhoneNumber(): Promise<AppUser | null> {
    return null;
  }
  public async createUser(): Promise<AppUser> {
    throw new Error('Not needed in harness');
  }
  public async updateUser(): Promise<void> {}
  public async getStaffPermissionsByUserId(userId: number): Promise<StaffPermission[]> {
    return this.staffPermissions.filter((p) => p.userId === userId);
  }
  public async replaceStaffPermissions(
    userId: number,
    permissions: Omit<StaffPermission, 'id'>[],
  ): Promise<StaffPermission[]> {
    this.staffPermissions = this.staffPermissions.filter((p) => p.userId !== userId);
    const next = permissions.map((p) => ({ ...p, id: this.permSeq++ }));
    this.staffPermissions.push(...next);
    return next;
  }
  public async deleteSessionsByUserId(): Promise<void> {}
  public async getAllFeatureFlags(): Promise<FeatureFlag[]> {
    return [...this.featureFlags];
  }
  public async upsertFeatureFlag(flag: FeatureFlag): Promise<void> {
    const idx = this.featureFlags.findIndex((x) => x.key === flag.key);
    if (idx === -1) this.featureFlags.push(flag);
    else this.featureFlags[idx] = flag;
  }
  public async getAllSiteSettings(): Promise<SiteSetting[]> {
    return [...this.siteSettings];
  }
  public async getSiteSettingByKey(key: string): Promise<SiteSetting | null> {
    return this.siteSettings.find((s) => s.key === key) ?? null;
  }
  public async upsertSiteSettings(settings: SiteSetting[]): Promise<void> {
    for (const s of settings) {
      const idx = this.siteSettings.findIndex((x) => x.key === s.key);
      if (idx === -1) this.siteSettings.push(s);
      else this.siteSettings[idx] = s;
    }
  }
  public async getActiveAgeGroups(): Promise<AgeGroup[]> {
    return this.ageGroups.filter((g) => g.isActive);
  }
}

function createStage18Bundle(clock: Stage18FakeClock) {
  const harness = new MemoryStage18Harness();
  const logger = new AppLogger(clock, 'meraj_stage18_test_logs', 100);
  logger.clearLogs();
  const policyService = new PermissionPolicyService(harness, logger);
  const fileStorage = new MemoryStage18FileStorage();
  const fileUploadService = new FileUploadService(
    fileStorage,
    harness,
    policyService,
    logger,
  );
  const homePageService = new HomePageService({
    layoutRepository: harness,
    contentRepository: harness,
    taxonomyRepository: harness,
    adminRepository: harness,
    viewEventRepository: harness,
    clock,
  });
  const layoutManagementService = new LayoutManagementService({
    layoutRepository: harness,
    taxonomyRepository: harness,
    permissionPolicyService: policyService,
    fileUploadService,
    fileStorage,
    logger,
  });

  return {
    harness,
    logger,
    homePageService,
    layoutManagementService,
  };
}

export const stage18Tests: UnitTestCase[] = [
  {
    id: 'stage18-seed-and-personalized-hidden',
    nameKey: 'tests.stage18.seedAndPersonalizedHidden.name',
    descriptionKey: 'tests.stage18.seedAndPersonalizedHidden.desc',
    run: async () => {
      const clock = new Stage18FakeClock();
      const { harness, homePageService, layoutManagementService } =
        createStage18Bundle(clock);
      const admin = harness.addUser('SuperAdmin');
      const topic = harness.addTopicSeed('تاریخ');

      harness.addPublishedContent({
        title: 'مقاله‌ی اول',
        topicIds: [topic.id],
        ageGroupIds: [],
        isFeatured: false,
      });

      await layoutManagementService.saveHomeShelf(admin, {
        title: 'پیشنهادهای شما',
        type: 'Personalized',
        topicId: null,
        sortOrder: 1,
        isVisible: true,
      });
      await layoutManagementService.saveHomeShelf(admin, {
        title: 'برگزیده‌ها (خالی)',
        type: 'Featured',
        topicId: null,
        sortOrder: 2,
        isVisible: true,
      });
      await layoutManagementService.saveHomeShelf(admin, {
        title: 'تازه‌ترین محتواها',
        type: 'Latest',
        topicId: null,
        sortOrder: 3,
        isVisible: true,
      });

      const homeData = await homePageService.getHomePageDataAsync(null);
      assert(
        !homeData.shelves.some((s) => s.shelf.type === 'Personalized'),
        'Personalized shelf must remain hidden on Stage 18 public home page',
      );
      assert(
        !homeData.shelves.some((s) => s.shelf.type === 'Featured'),
        'Empty Featured shelf with 0 items must be hidden',
      );
      assertEqual(homeData.shelves.length, 1, 'Only non-empty Latest shelf should appear');
      assertEqual(homeData.shelves[0].shelf.type, 'Latest', 'Visible shelf should be Latest');
    },
  },
  {
    id: 'stage18-trending-7day-algorithm',
    nameKey: 'tests.stage18.trending7DayAlgorithm.name',
    descriptionKey: 'tests.stage18.trending7DayAlgorithm.desc',
    run: async () => {
      const clock = new Stage18FakeClock('2026-11-23T12:00:00.000Z');
      const { harness, homePageService, layoutManagementService } =
        createStage18Bundle(clock);
      const admin = harness.addUser('SuperAdmin');

      const itemA = harness.addPublishedContent({
        title: 'محتوای محبوب ۲ روز اخیر',
        ageGroupIds: [1],
      });
      const itemB = harness.addPublishedContent({
        title: 'محتوای قدیمی ۸ روز پیش',
        ageGroupIds: [1],
      });
      const itemCAdult = harness.addPublishedContent({
        title: 'محتوای بزرگسال پربازدید',
        ageGroupIds: [4],
      });

      const nowMs = clock.now().getTime();
      const dayMs = 24 * 60 * 60 * 1000;

      // Item A: 3 counted views 2 days ago + 1 bot uncounted view 1 day ago
      for (let i = 0; i < 3; i += 1) {
        await harness.createViewEvent({
          contentId: itemA.id,
          visitorId: `va-${i}`,
          userId: null,
          ageGroupId: 1,
          primaryTopicId: null,
          occurredAt: new Date(nowMs - 2 * dayMs + i * 1000).toISOString(),
          isCounted: true,
        });
      }
      await harness.createViewEvent({
        contentId: itemA.id,
        visitorId: 'va-bot',
        userId: null,
        ageGroupId: 1,
        primaryTopicId: null,
        occurredAt: new Date(nowMs - 1 * dayMs).toISOString(),
        isCounted: false,
      });

      // Item B: 5 views 8 days ago (must be excluded) + 1 view 1 day ago => 7d count = 1
      for (let i = 0; i < 5; i += 1) {
        await harness.createViewEvent({
          contentId: itemB.id,
          visitorId: `vb-old-${i}`,
          userId: null,
          ageGroupId: 1,
          primaryTopicId: null,
          occurredAt: new Date(nowMs - 8 * dayMs - i * 1000).toISOString(),
          isCounted: true,
        });
      }
      await harness.createViewEvent({
        contentId: itemB.id,
        visitorId: 'vb-recent',
        userId: null,
        ageGroupId: 1,
        primaryTopicId: null,
        occurredAt: new Date(nowMs - 1 * dayMs).toISOString(),
        isCounted: true,
      });

      // Item C (adult-only): 6 counted views 1 day ago
      for (let i = 0; i < 6; i += 1) {
        await harness.createViewEvent({
          contentId: itemCAdult.id,
          visitorId: `vc-${i}`,
          userId: null,
          ageGroupId: 4,
          primaryTopicId: null,
          occurredAt: new Date(nowMs - 1 * dayMs + i * 1000).toISOString(),
          isCounted: true,
        });
      }

      await layoutManagementService.saveHomeShelf(admin, {
        title: 'برترین‌های هفته',
        type: 'Trending',
        topicId: null,
        sortOrder: 1,
        isVisible: true,
      });

      const allAges = await harness.getAllAgeGroups();
      const adultGroup = allAges.find((g) => g.key === 'adult') ?? null;
      const childGroup = allAges.find((g) => g.key === 'child') ?? null;

      const adultHome = await homePageService.getHomePageDataAsync(adultGroup);
      assertEqual(adultHome.shelves.length, 1, 'Adult home should show Trending shelf');
      const adultTrending = adultHome.shelves[0];
      assertEqual(
        adultTrending.items.map((x) => x.item.id).join(','),
        `${itemCAdult.id},${itemA.id},${itemB.id}`,
        'Adult Trending must rank 7-day counted views: C(6), A(3), B(1)',
      );
      assertEqual(
        adultTrending.trendingCountsByContentId?.[itemB.id],
        1,
        'Views from 8 days ago must be excluded from 7-day Trending window',
      );

      const childHome = await homePageService.getHomePageDataAsync(childGroup);
      const childTrending = childHome.shelves[0];
      assertEqual(
        childTrending.items.map((x) => x.item.id).join(','),
        `${itemA.id},${itemB.id}`,
        'Child Trending must hard-filter out adult-only content',
      );
    },
  },
  {
    id: 'stage18-hero-age-targeting-and-safe-link',
    nameKey: 'tests.stage18.heroAgeTargetingAndSafeLink.name',
    descriptionKey: 'tests.stage18.heroAgeTargetingAndSafeLink.desc',
    run: async () => {
      const clock = new Stage18FakeClock();
      const { harness, homePageService, layoutManagementService } =
        createStage18Bundle(clock);
      const admin = harness.addUser('SuperAdmin');

      const publicRes = await layoutManagementService.saveHeroSlide(admin, {
        title: 'اسلاید عمومی',
        subtitle: 'برای همه رده‌ها',
        linkUrl: '#/content',
        ageGroupId: null,
        isActive: true,
      });
      assert(publicRes.ok, 'Public HeroSlide should save successfully');

      const childRes = await layoutManagementService.saveHeroSlide(admin, {
        title: 'اسلاید ویژه‌ی کودک',
        subtitle: 'فقط برای رده سنی کودک',
        linkUrl: 'https://example.com/kids',
        ageGroupId: 1,
        isActive: true,
      });
      assert(childRes.ok, 'Child-targeted HeroSlide with https link should save');

      const inactiveRes = await layoutManagementService.saveHeroSlide(admin, {
        title: 'اسلاید غیرفعال',
        subtitle: 'نباید دیده شود',
        linkUrl: '#/requests',
        ageGroupId: null,
        isActive: false,
      });
      assert(inactiveRes.ok, 'Inactive slide should save');

      const xssLinkRes = await layoutManagementService.saveHeroSlide(admin, {
        title: 'اسلاید مخرب',
        subtitle: 'لینک ناامن',
        linkUrl: 'javascript:alert(1)',
        ageGroupId: null,
        isActive: true,
      });
      assert(!xssLinkRes.ok, 'javascript: linkUrl must be rejected');
      assertEqual(xssLinkRes.statusCode, 400, 'Unsafe linkUrl must return 400');
      assertEqual(
        xssLinkRes.errorCode,
        'SLIDE_LINK_INVALID',
        'Unsafe linkUrl must return SLIDE_LINK_INVALID',
      );

      const allAges = await harness.getAllAgeGroups();
      const childGroup = allAges.find((g) => g.key === 'child') ?? null;
      const adultGroup = allAges.find((g) => g.key === 'adult') ?? null;

      const childHome = await homePageService.getHomePageDataAsync(childGroup);
      assertEqual(
        childHome.slides.length,
        2,
        'Child should see public + child-specific active slides',
      );

      const adultHome = await homePageService.getHomePageDataAsync(adultGroup);
      assertEqual(
        adultHome.slides.length,
        1,
        'Adult must NOT see child-targeted slide or inactive slide',
      );
      assertEqual(
        adultHome.slides[0].title,
        'اسلاید عمومی',
        'Adult should only see public slide',
      );
    },
  },
  {
    id: 'stage18-shelf-reorder-and-bytopic-tree',
    nameKey: 'tests.stage18.shelfReorderAndByTopicTree.name',
    descriptionKey: 'tests.stage18.shelfReorderAndByTopicTree.desc',
    run: async () => {
      const clock = new Stage18FakeClock();
      const { harness, homePageService, layoutManagementService } =
        createStage18Bundle(clock);
      const admin = harness.addUser('SuperAdmin');

      const parentTopic = harness.addTopicSeed('تاریخ و تمدن', null);
      const childTopic = harness.addTopicSeed('تاریخ معاصر', parentTopic.id);

      const childTopicContent = harness.addPublishedContent({
        title: 'مقاله تاریخ معاصر',
        topicIds: [childTopic.id],
      });

      const shelfLatest = await layoutManagementService.saveHomeShelf(admin, {
        title: 'تازه‌ترین‌ها',
        type: 'Latest',
        topicId: null,
        sortOrder: 1,
        isVisible: true,
      });
      const shelfTopic = await layoutManagementService.saveHomeShelf(admin, {
        title: 'تاریخ و تمدن',
        type: 'ByTopic',
        topicId: parentTopic.id,
        sortOrder: 2,
        isVisible: true,
      });
      assert(shelfLatest.ok && shelfTopic.ok && shelfTopic.data, 'Both shelves should save');

      const beforeReorder = await homePageService.getHomePageDataAsync(null);
      assertEqual(beforeReorder.shelves.length, 2, 'Both shelves should appear');
      assertEqual(beforeReorder.shelves[0].shelf.type, 'Latest', 'Latest starts first');
      assertEqual(
        beforeReorder.shelves[1].items[0].item.id,
        childTopicContent.id,
        'Parent ByTopic shelf must expand child topic items',
      );

      const moveRes = await layoutManagementService.moveHomeShelf(
        admin,
        shelfTopic.data.id,
        'up',
      );
      assert(moveRes.ok, 'moveHomeShelf should succeed');

      const afterReorder = await homePageService.getHomePageDataAsync(null);
      assertEqual(afterReorder.shelves[0].shelf.type, 'ByTopic', 'ByTopic shelf moved to first');
      assertEqual(afterReorder.shelves[1].shelf.type, 'Latest', 'Latest moved to second');
    },
  },
  {
    id: 'stage18-static-page-sanitization-and-footer',
    nameKey: 'tests.stage18.staticPageSanitizationAndFooter.name',
    descriptionKey: 'tests.stage18.staticPageSanitizationAndFooter.desc',
    run: async () => {
      const clock = new Stage18FakeClock();
      const { harness, layoutManagementService } = createStage18Bundle(clock);
      const admin = harness.addUser('SuperAdmin');

      const saveRes = await layoutManagementService.saveStaticPage(admin, {
        title: 'درباره‌ی ما',
        slug: 'about',
        body: '<h2 onload="alert(9)">معرفی</h2><script>alert(1)</script><p>متن <a href="javascript:evil()">بد</a> و <a href="#/content">بانک</a></p>',
        showInFooter: true,
        sortOrder: 1,
      });
      assert(saveRes.ok && saveRes.data, 'StaticPage save should succeed');
      assert(!saveRes.data.body.includes('<script'), 'Saved StaticPage body must strip <script>');
      assert(!saveRes.data.body.includes('onload'), 'Saved StaticPage body must strip event handlers');
      assert(!saveRes.data.body.includes('javascript:'), 'Saved StaticPage body must strip javascript: href');

      const publicPage = await layoutManagementService.getPublicStaticPageBySlug('about');
      assert(publicPage !== null, 'Public StaticPage should load by slug');
      assert(publicPage.body.includes('<h2>معرفی</h2>'), 'Safe heading tag must be preserved');
      assert(publicPage.body.includes('#/content'), 'Safe internal link must be preserved');

      const hiddenPage = await layoutManagementService.saveStaticPage(admin, {
        title: 'صفحه‌ی مخفی از فوتر',
        slug: 'hidden-guide',
        body: '<p>راهنمای اختصاصی</p>',
        showInFooter: false,
        sortOrder: 2,
      });
      assert(hiddenPage.ok, 'Non-footer StaticPage should save');

      const footerPages = await layoutManagementService.listFooterStaticPages();
      assertEqual(footerPages.length, 1, 'Only showInFooter=true pages belong in footer');
      assertEqual(footerPages[0].slug, 'about', 'Footer list should contain about only');
      assert(
        (await layoutManagementService.getPublicStaticPageBySlug('hidden-guide')) !== null,
        'Non-footer page must still be accessible via #/p/slug',
      );
    },
  },
  {
    id: 'stage18-rbac-and-idb-v12',
    nameKey: 'tests.stage18.rbacAndIdbV12.name',
    descriptionKey: 'tests.stage18.rbacAndIdbV12.desc',
    run: async () => {
      const clock = new Stage18FakeClock();
      const { harness, logger, layoutManagementService } = createStage18Bundle(clock);

      const member = harness.addUser('Member');
      const unauthStaff = harness.addUser('Staff', ['content.manage']);
      const layoutStaff = harness.addUser('Staff', ['layout.manage']);

      const memberRes = await layoutManagementService.listHomeShelvesAdmin(member);
      assert(!memberRes.ok && memberRes.statusCode === 404, 'Member must receive 404');

      const logsBefore = logger.getLogs().length;
      const staffForbidden = await layoutManagementService.saveHomeShelf(unauthStaff, {
        title: 'قفسه غیرمجاز',
        type: 'Latest',
        topicId: null,
        isVisible: true,
      });
      assert(!staffForbidden.ok && staffForbidden.statusCode === 403, 'Unauthorized Staff must receive 403');
      const newLogs = logger.getLogs().slice(logsBefore);
      assert(
        newLogs.some((entry) => entry.level === 'WARN'),
        'Unauthorized Staff 403 attempt must record a WARN log',
      );

      const staffAllowed = await layoutManagementService.saveHomeShelf(layoutStaff, {
        title: 'قفسه مجاز',
        type: 'Latest',
        topicId: null,
        isVisible: true,
      });
      assert(staffAllowed.ok, 'Staff with layout.manage must be allowed');

      assert(
        DATABASE_MIGRATIONS.some((m) => m.version === 12),
        'Migration version 12 must be registered for Stage 18',
      );
      assert(
        envConfig.databaseVersion >= 12,
        `envConfig.databaseVersion must be >= 12 for Stage 18 (actual=${envConfig.databaseVersion})`,
      );

      if (typeof indexedDB !== 'undefined') {
        const idbStore = new IndexedDbDataStore(
          envConfig.databaseName,
          envConfig.databaseVersion,
          envConfig.metaStoreName,
        );
        const storeNames = await idbStore.getObjectStoreNames();
        for (const storeName of STAGE18_OBJECT_STORES) {
          assert(
            storeNames.includes(storeName),
            `ObjectStore ${storeName} must exist in IndexedDB v${envConfig.databaseVersion}`,
          );
        }

        await ensureStage18LayoutSeededAsync(idbStore);
        const pagesBeforeSecondSeed = (
          await idbStore.getAll<StaticPage>(STORE_NAMES.STATIC_PAGES)
        ).length;
        const secondSeed = await ensureStage18LayoutSeededAsync(idbStore);
        const pagesAfterSecondSeed = (
          await idbStore.getAll<StaticPage>(STORE_NAMES.STATIC_PAGES)
        ).length;
        assert(secondSeed.skippedAlreadySeeded, 'Second Stage 18 seed run must be idempotent');
        assertEqual(
          pagesAfterSecondSeed,
          pagesBeforeSecondSeed,
          'StaticPages count must stay identical across repeated seed runs',
        );

        const idbRepo = new IndexedDbLayoutRepository(idbStore);
        let tempSlideId: number | null = null;
        try {
          const created = await idbRepo.createHeroSlide({
            title: 'اسلاید تست ماندگاری v12',
            subtitle: 'بررسی ذخیره و خواندن واقعی',
            imageKey: null,
            linkUrl: '#/content',
            sortOrder: 999,
            isActive: false,
            ageGroupId: null,
          });
          tempSlideId = created.id;
          const loaded = await idbRepo.getHeroSlideById(created.id);
          assert(loaded !== null, 'Created HeroSlide must persist in IndexedDB');
          assertEqual(loaded.title, 'اسلاید تست ماندگاری v12', 'HeroSlide title must roundtrip');
          const aboutBySlug = await idbRepo.getStaticPageBySlug('about');
          assert(
            aboutBySlug !== null && aboutBySlug.slug === 'about',
            'StaticPage lookup via by_slug index must resolve seeded page',
          );
        } finally {
          if (tempSlideId !== null) {
            await idbRepo.deleteHeroSlide(tempSlideId);
          }
        }
      }
    },
  },
];
