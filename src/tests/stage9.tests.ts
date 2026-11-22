import type { IAdminRepository } from '../core/abstractions/adminRepository';
import type { IContentRepository } from '../core/abstractions/contentRepository';
import type { IFileStorage } from '../core/abstractions/fileStorage';
import type { IClock } from '../core/abstractions/IClock';
import type { ITaxonomyRepository } from '../core/abstractions/taxonomyRepository';
import type { AppUser } from '../core/domain/auth';
import {
  ContentFileKind,
  ContentStatus,
  FileStorageType,
  type ContentAgeGroup,
  type ContentFile,
  type ContentItem,
  type ContentPerson,
  type ContentSource,
  type ContentTag,
  type ContentTopic,
} from '../core/domain/content';
import type { StaffPermission } from '../core/domain/permissions';
import type { FeatureFlag, SiteSetting } from '../core/domain/settings';
import type { FileSaveRequest, StoredFileMetadata } from '../core/domain/storage';
import type {
  AgeGroup,
  ImpactLevel,
  Person,
  Tag,
  Topic,
} from '../core/domain/taxonomy';
import { ContentManagementService } from '../core/services/contentManagementService';
import { validateExternalUrl } from '../core/services/externalLinkService';
import { FileUploadService } from '../core/services/fileUploadService';
import {
  extractNormalizedExtension,
  getCategoryForExtension,
  getMimeTypeForExtension,
} from '../core/services/fileValidationService';
import { canAccessAdminRoute } from '../core/services/navigationGuardService';
import { PermissionPolicyService } from '../core/services/permissionPolicyService';
import { SearchNormalizer } from '../core/services/searchNormalizer';
import { SystemClock } from '../infrastructure/clock/SystemClock';
import { envConfig } from '../infrastructure/config/envConfig';
import { IndexedDbAdminRepository } from '../infrastructure/data/IndexedDbAdminRepository';
import { IndexedDbAuthRepository } from '../infrastructure/data/IndexedDbAuthRepository';
import { IndexedDbContentRepository } from '../infrastructure/data/IndexedDbContentRepository';
import { IndexedDbDataStore } from '../infrastructure/data/IndexedDbDataStore';
import { IndexedDbTaxonomyRepository } from '../infrastructure/data/IndexedDbTaxonomyRepository';
import {
  DatabaseSeeder,
  INITIAL_AGE_GROUPS,
  INITIAL_FEATURE_FLAGS,
  INITIAL_IMPACT_LEVELS,
  INITIAL_SITE_SETTINGS,
  INITIAL_TOPICS,
} from '../infrastructure/data/seed';
import { LocalIndexedDbFileStorage } from '../infrastructure/storage/LocalIndexedDbFileStorage';
import { AppLogger } from '../infrastructure/logging/AppLogger';
import { assert, assertEqual, type UnitTestCase } from './testRunner';

class Stage9FakeClock implements IClock {
  private iso = '2026-11-10T09:00:00.000Z';
  private readonly helperClock = new SystemClock();

  public advanceMinutes(minutes: number): void {
    const next = new Date(Date.parse(this.iso) + minutes * 60_000);
    this.iso = next.toISOString();
  }
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

function makePngBytes(): Uint8Array {
  return new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01]);
}

function generateTestUuid(counter: number): string {
  const hex = counter.toString(16).padStart(12, '0');
  return `99999999-aaaa-4ccc-8ddd-${hex}`;
}

class MemoryStage9FileStorage implements IFileStorage {
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
      category: getCategoryForExtension(ext) ?? 'image',
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
    if (!found) return null;
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
    if (!found) return null;
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

class MemoryStage9AdminRepository implements IAdminRepository {
  public users: AppUser[] = [];
  public staffPermissions: StaffPermission[] = [];
  public featureFlags: FeatureFlag[] = INITIAL_FEATURE_FLAGS.map((f) => ({ ...f }));
  public siteSettings: SiteSetting[] = INITIAL_SITE_SETTINGS.map((s) => ({ ...s }));
  private nextUserId = 10;
  private nextPermId = 10;

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
    return INITIAL_AGE_GROUPS.filter((g) => g.isActive).map((g) => ({ ...g }));
  }
}

class MemoryStage9TaxonomyRepository implements ITaxonomyRepository {
  public topics: Topic[] = INITIAL_TOPICS.map((item) => ({ ...item }));
  public tags: Tag[] = [];
  public persons: Person[] = [];
  public impactLevels: ImpactLevel[] = INITIAL_IMPACT_LEVELS.map((item) => ({ ...item }));
  public ageGroups: AgeGroup[] = INITIAL_AGE_GROUPS.map((item) => ({ ...item }));

  private readonly contentRepo: MemoryStage9ContentRepository;
  private nextTopicId = 100;
  private nextTagId = 1;
  private nextPersonId = 1;
  private nextImpactId = 100;

  constructor(contentRepo: MemoryStage9ContentRepository) {
    this.contentRepo = contentRepo;
  }

  public async getAllTopics(): Promise<Topic[]> {
    return [...this.topics].sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);
  }
  public async getTopicById(id: number): Promise<Topic | null> {
    const found = this.topics.find((t) => t.id === id);
    return found ? { ...found } : null;
  }
  public async createTopic(topic: Omit<Topic, 'id'>): Promise<Topic> {
    const created: Topic = { ...topic, id: this.nextTopicId++ };
    this.topics.push(created);
    return { ...created };
  }
  public async updateTopic(topic: Topic): Promise<void> {
    const idx = this.topics.findIndex((t) => t.id === topic.id);
    if (idx !== -1) this.topics[idx] = { ...topic };
  }
  public async deleteTopic(id: number): Promise<void> {
    this.topics = this.topics.filter((t) => t.id !== id);
  }

  public async getAllTags(): Promise<Tag[]> {
    return [...this.tags].sort((a, b) => b.id - a.id);
  }
  public async getTagById(id: number): Promise<Tag | null> {
    const found = this.tags.find((t) => t.id === id);
    return found ? { ...found } : null;
  }
  public async createTag(tag: Omit<Tag, 'id'>): Promise<Tag> {
    const created: Tag = { ...tag, id: this.nextTagId++ };
    this.tags.push(created);
    return { ...created };
  }
  public async updateTag(tag: Tag): Promise<void> {
    const idx = this.tags.findIndex((t) => t.id === tag.id);
    if (idx !== -1) this.tags[idx] = { ...tag };
  }
  public async deleteTag(id: number): Promise<void> {
    this.tags = this.tags.filter((t) => t.id !== id);
  }

  public async getAllPersons(): Promise<Person[]> {
    return [...this.persons].sort((a, b) => b.id - a.id);
  }
  public async getPersonById(id: number): Promise<Person | null> {
    const found = this.persons.find((p) => p.id === id);
    return found ? { ...found } : null;
  }
  public async createPerson(person: Omit<Person, 'id'>): Promise<Person> {
    const created: Person = { ...person, id: this.nextPersonId++ };
    this.persons.push(created);
    return { ...created };
  }
  public async updatePerson(person: Person): Promise<void> {
    const idx = this.persons.findIndex((p) => p.id === person.id);
    if (idx !== -1) this.persons[idx] = { ...person };
  }
  public async deletePerson(id: number): Promise<void> {
    this.persons = this.persons.filter((p) => p.id !== id);
  }

  public async getAllImpactLevels(): Promise<ImpactLevel[]> {
    return [...this.impactLevels].sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);
  }
  public async getImpactLevelById(id: number): Promise<ImpactLevel | null> {
    const found = this.impactLevels.find((l) => l.id === id);
    return found ? { ...found } : null;
  }
  public async createImpactLevel(level: Omit<ImpactLevel, 'id'>): Promise<ImpactLevel> {
    const created: ImpactLevel = { ...level, id: this.nextImpactId++ };
    this.impactLevels.push(created);
    return { ...created };
  }
  public async updateImpactLevel(level: ImpactLevel): Promise<void> {
    const idx = this.impactLevels.findIndex((l) => l.id === level.id);
    if (idx !== -1) this.impactLevels[idx] = { ...level };
  }
  public async deleteImpactLevel(id: number): Promise<void> {
    this.impactLevels = this.impactLevels.filter((l) => l.id !== id);
  }

  public async getAllAgeGroups(): Promise<AgeGroup[]> {
    return [...this.ageGroups].sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);
  }
  public async getAgeGroupById(id: number): Promise<AgeGroup | null> {
    const found = this.ageGroups.find((g) => g.id === id);
    return found ? { ...found } : null;
  }
  public async updateAgeGroup(group: AgeGroup): Promise<void> {
    const idx = this.ageGroups.findIndex((g) => g.id === group.id);
    if (idx !== -1) this.ageGroups[idx] = { ...group };
  }

  public async getContentTopicLinks(): Promise<ContentTopic[]> {
    return this.contentRepo.getAllContentTopics();
  }
  public async countContentTagsByTagId(tagId: number): Promise<number> {
    return this.contentRepo.contentTags.filter((x) => x.tagId === tagId).length;
  }
  public async countContentPersonsByPersonId(personId: number): Promise<number> {
    return this.contentRepo.contentPersons.filter((x) => x.personId === personId).length;
  }
  public async countContentItemsByImpactLevelId(impactLevelId: number): Promise<number> {
    return this.contentRepo.items.filter((x) => x.impactLevelId === impactLevelId).length;
  }
  public async createContentItem(item: Omit<ContentItem, 'id'>): Promise<ContentItem> {
    return this.contentRepo.createContentItem(item);
  }
  public async linkContentTopic(contentId: number, topicId: number): Promise<void> {
    const exists = this.contentRepo.contentTopics.some(
      (x) => x.contentId === contentId && x.topicId === topicId,
    );
    if (!exists) {
      this.contentRepo.contentTopics.push({ contentId, topicId });
    }
  }
}

class MemoryStage9ContentRepository implements IContentRepository {
  public items: ContentItem[] = [];
  public sources: ContentSource[] = [];
  public files: ContentFile[] = [];
  public contentTopics: ContentTopic[] = [];
  public contentTags: ContentTag[] = [];
  public contentPersons: ContentPerson[] = [];
  public contentAgeGroups: ContentAgeGroup[] = [];

  private readonly adminRepo: MemoryStage9AdminRepository;
  private nextItemId = 1;
  private nextSourceId = 1;
  private nextFileId = 1;

  constructor(adminRepo: MemoryStage9AdminRepository) {
    this.adminRepo = adminRepo;
  }

  public async getAllContentItems(): Promise<ContentItem[]> {
    return this.items.map((item) => ({ ...item }));
  }
  public async getContentItemById(id: number): Promise<ContentItem | null> {
    const found = this.items.find((item) => item.id === id);
    return found ? { ...found } : null;
  }
  public async getContentItemBySlug(slug: string): Promise<ContentItem | null> {
    const found = this.items.find((item) => item.slug === slug);
    return found ? { ...found } : null;
  }
  public async createContentItem(item: Omit<ContentItem, 'id'>): Promise<ContentItem> {
    const created: ContentItem = { ...item, id: this.nextItemId++ };
    this.items.push(created);
    return { ...created };
  }
  public async updateContentItem(item: ContentItem): Promise<void> {
    const idx = this.items.findIndex((x) => x.id === item.id);
    if (idx !== -1) this.items[idx] = { ...item };
  }

  public async getSourcesByContentId(contentId: number): Promise<ContentSource[]> {
    return this.sources
      .filter((s) => s.contentId === contentId)
      .sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);
  }
  public async getAllSources(): Promise<ContentSource[]> {
    return [...this.sources];
  }
  public async replaceSources(
    contentId: number,
    sources: Omit<ContentSource, 'id'>[],
  ): Promise<ContentSource[]> {
    this.sources = this.sources.filter((s) => s.contentId !== contentId);
    const created: ContentSource[] = sources.map((s, idx) => ({
      ...s,
      id: this.nextSourceId++,
      contentId,
      sortOrder: s.sortOrder ?? idx + 1,
    }));
    this.sources.push(...created);
    return created;
  }

  public async getFilesByContentId(contentId: number): Promise<ContentFile[]> {
    return this.files
      .filter((f) => f.contentId === contentId)
      .sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);
  }
  public async getAllFiles(): Promise<ContentFile[]> {
    return [...this.files];
  }
  public async replaceFiles(
    contentId: number,
    files: Omit<ContentFile, 'id'>[],
  ): Promise<ContentFile[]> {
    this.files = this.files.filter((f) => f.contentId !== contentId);
    const created: ContentFile[] = files.map((f, idx) => ({
      ...f,
      id: this.nextFileId++,
      contentId,
      sortOrder: f.sortOrder ?? idx + 1,
    }));
    this.files.push(...created);
    return created;
  }

  public async getTopicIdsByContentId(contentId: number): Promise<number[]> {
    return this.contentTopics.filter((x) => x.contentId === contentId).map((x) => x.topicId);
  }
  public async getAllContentTopics(): Promise<ContentTopic[]> {
    return [...this.contentTopics];
  }
  public async replaceContentTopics(contentId: number, topicIds: number[]): Promise<void> {
    this.contentTopics = this.contentTopics.filter((x) => x.contentId !== contentId);
    for (const topicId of topicIds) {
      this.contentTopics.push({ contentId, topicId });
    }
  }

  public async getTagIdsByContentId(contentId: number): Promise<number[]> {
    return this.contentTags.filter((x) => x.contentId === contentId).map((x) => x.tagId);
  }
  public async getAllContentTags(): Promise<ContentTag[]> {
    return [...this.contentTags];
  }
  public async replaceContentTags(contentId: number, tagIds: number[]): Promise<void> {
    this.contentTags = this.contentTags.filter((x) => x.contentId !== contentId);
    for (const tagId of tagIds) {
      this.contentTags.push({ contentId, tagId });
    }
  }

  public async getPersonIdsByContentId(contentId: number): Promise<number[]> {
    return this.contentPersons.filter((x) => x.contentId === contentId).map((x) => x.personId);
  }
  public async getAllContentPersons(): Promise<ContentPerson[]> {
    return [...this.contentPersons];
  }
  public async replaceContentPersons(contentId: number, personIds: number[]): Promise<void> {
    this.contentPersons = this.contentPersons.filter((x) => x.contentId !== contentId);
    for (const personId of personIds) {
      this.contentPersons.push({ contentId, personId });
    }
  }

  public async getAgeGroupIdsByContentId(contentId: number): Promise<number[]> {
    return this.contentAgeGroups
      .filter((x) => x.contentId === contentId)
      .map((x) => x.ageGroupId);
  }
  public async getAllContentAgeGroups(): Promise<ContentAgeGroup[]> {
    return [...this.contentAgeGroups];
  }
  public async replaceContentAgeGroups(contentId: number, ageGroupIds: number[]): Promise<void> {
    this.contentAgeGroups = this.contentAgeGroups.filter((x) => x.contentId !== contentId);
    for (const ageGroupId of ageGroupIds) {
      this.contentAgeGroups.push({ contentId, ageGroupId });
    }
  }

  public async userExists(userId: number): Promise<boolean> {
    return (await this.adminRepo.getUserById(userId)) !== null;
  }
}

async function createStage9Harness() {
  const clock = new Stage9FakeClock();
  const adminRepo = new MemoryStage9AdminRepository();
  const contentRepo = new MemoryStage9ContentRepository(adminRepo);
  const taxonomyRepo = new MemoryStage9TaxonomyRepository(contentRepo);
  const logger = new AppLogger(clock, `meraj_stage9_test_${Date.now()}`, 100);
  logger.clearLogs();

  const fileStorage = new MemoryStage9FileStorage(clock);
  const policyService = new PermissionPolicyService(adminRepo, logger);
  const fileUploadService = new FileUploadService(fileStorage, adminRepo, policyService, logger);
  const searchNormalizer = new SearchNormalizer();

  const contentService = new ContentManagementService(
    contentRepo,
    taxonomyRepo,
    policyService,
    fileUploadService,
    searchNormalizer,
    clock,
    logger,
  );

  const superAdmin = await adminRepo.createUser({
    displayName: 'مدیر کل آزمون',
    email: 'superadmin@test.local',
    normalizedEmail: 'superadmin@test.local',
    phoneNumber: null,
    normalizedPhoneNumber: null,
    passwordHash: 'hash',
    passwordSalt: 'salt',
    role: 'SuperAdmin',
    ageGroupId: null,
    emailConfirmed: true,
    phoneNumberConfirmed: false,
    personalizationEnabled: true,
    isActive: true,
    mustChangePassword: false,
    failedLoginCount: 0,
    lockoutEnd: null,
    createdAt: clock.nowUtcIso(),
    lastLoginAt: null,
  });

  const staffUser = await adminRepo.createUser({
    displayName: 'تحریریه بدون مجوز',
    email: 'staff@test.local',
    normalizedEmail: 'staff@test.local',
    phoneNumber: null,
    normalizedPhoneNumber: null,
    passwordHash: 'hash',
    passwordSalt: 'salt',
    role: 'Staff',
    ageGroupId: null,
    emailConfirmed: true,
    phoneNumberConfirmed: false,
    personalizationEnabled: true,
    isActive: true,
    mustChangePassword: false,
    failedLoginCount: 0,
    lockoutEnd: null,
    createdAt: clock.nowUtcIso(),
    lastLoginAt: null,
  });

  const memberUser = await adminRepo.createUser({
    displayName: 'عضو عادی',
    email: 'member@test.local',
    normalizedEmail: 'member@test.local',
    phoneNumber: null,
    normalizedPhoneNumber: null,
    passwordHash: 'hash',
    passwordSalt: 'salt',
    role: 'Member',
    ageGroupId: 2,
    emailConfirmed: true,
    phoneNumberConfirmed: false,
    personalizationEnabled: true,
    isActive: true,
    mustChangePassword: false,
    failedLoginCount: 0,
    lockoutEnd: null,
    createdAt: clock.nowUtcIso(),
    lastLoginAt: null,
  });

  return {
    clock,
    adminRepo,
    contentRepo,
    taxonomyRepo,
    logger,
    fileStorage,
    searchNormalizer,
    contentService,
    superAdmin,
    staffUser,
    memberUser,
  };
}

export const stage9Tests: UnitTestCase[] = [
  {
    id: 'stage9-publish-valid-and-reject-no-source',
    nameKey: 'tests.stage9.publishValidAndRejectNoSource.name',
    descriptionKey: 'tests.stage9.publishValidAndRejectNoSource.desc',
    run: async () => {
      const { contentService, superAdmin } = await createStage9Harness();

      const thumbRes = await contentService.uploadThumbnailAsync(superAdmin, {
        originalFileName: 'article-cover.png',
        bytes: makePngBytes(),
      });
      assert(thumbRes.ok && thumbRes.data, 'Thumbnail upload should succeed');

      // 1. Valid complete article -> should publish cleanly
      const validDraftRes = await contentService.saveDraft(superAdmin, {
        title: 'آشنایی با روش پژوهش علمی',
        summary: 'چکیده‌ای استاندارد برای آشنایی نوجوانان با روش علمی.',
        body: '<h2>مقدمه</h2><p>پژوهش با پرسشگری آغاز می‌شود.</p>',
        format: 'Article',
        thumbnailKey: thumbRes.data.storageKey,
        isFeatured: true,
        sources: [{ title: 'روش تحقیق پایه، صفحه ۱۲' }],
        files: [],
        topicIds: [1],
        tagIds: [],
        personIds: [],
        ageGroupIds: [],
      });
      assert(validDraftRes.ok && validDraftRes.data, 'Valid draft save should succeed');

      const pubRes = await contentService.publishContent(
        superAdmin,
        validDraftRes.data.item.id,
      );
      assert(pubRes.ok && pubRes.data, 'Valid complete article should publish cleanly');
      assertEqual(pubRes.data.item.status, ContentStatus.Published, 'Status should be Published');
      assert(pubRes.data.item.publishedAt !== null, 'publishedAt timestamp should be populated');

      const publicLoaded = await contentService.getPublicPublishedBySlug(
        pubRes.data.item.slug,
      );
      assert(publicLoaded !== null, 'Published article must be readable via public slug lookup');

      // 2. Article without source -> publish must fail and stay Draft
      const noSourceDraftRes = await contentService.saveDraft(superAdmin, {
        title: 'مقاله بدون منبع',
        summary: 'خلاصه مقاله فاقد منبع.',
        body: '<p>متن کامل مقاله</p>',
        format: 'Article',
        thumbnailKey: thumbRes.data.storageKey,
        isFeatured: false,
        sources: [],
        files: [],
        topicIds: [1],
        tagIds: [],
        personIds: [],
        ageGroupIds: [],
      });
      assert(noSourceDraftRes.ok && noSourceDraftRes.data, 'Draft without source saves as Draft');

      const rejectedPub = await contentService.publishContent(
        superAdmin,
        noSourceDraftRes.data.item.id,
      );
      assert(!rejectedPub.ok, 'Publish without source must be rejected');
      assertEqual(
        rejectedPub.errorCode,
        'PUBLISH_VALIDATION_FAILED',
        'Error code must indicate publish validation failure',
      );
      assert(
        rejectedPub.validationErrors?.some((e) => e.messageKey === 'publish.error.noSource'),
        'Validation errors must include publish.error.noSource',
      );

      const reloaded = await contentService.getContentAggregate(
        superAdmin,
        noSourceDraftRes.data.item.id,
      );
      assertEqual(
        reloaded.data?.item.status,
        ContentStatus.Draft,
        'Rejected content must remain in Draft status',
      );
      assertEqual(
        reloaded.data?.item.publishedAt,
        null,
        'Rejected content must keep publishedAt null',
      );
    },
  },
  {
    id: 'stage9-external-aparat-video-publish',
    nameKey: 'tests.stage9.externalAparatVideoPublish.name',
    descriptionKey: 'tests.stage9.externalAparatVideoPublish.desc',
    run: async () => {
      const { contentService, superAdmin } = await createStage9Harness();

      const thumbRes = await contentService.uploadThumbnailAsync(superAdmin, {
        originalFileName: 'video-cover.png',
        bytes: makePngBytes(),
      });
      assert(thumbRes.ok && thumbRes.data, 'Video thumbnail upload should succeed');

      const aparatUrl = 'https://www.aparat.com/v/abc12';
      const extInfo = validateExternalUrl(aparatUrl);
      assert(extInfo.isValid, 'Aparat HTTPS URL must be valid');
      assert(extInfo.isEmbedAllowed, 'Aparat host must be allowed for internal embed');

      const otherUrlInfo = validateExternalUrl('https://vimeo.com/12345');
      assert(otherUrlInfo.isValid, 'Non-whitelisted HTTPS URL is valid external link');
      assert(!otherUrlInfo.isEmbedAllowed, 'Non-whitelisted host must not be embedded');

      const draftRes = await contentService.saveDraft(superAdmin, {
        title: 'مستند آموزشی شگفتی‌های کهکشان',
        summary: 'ویدیوی آموزشی با لینک خارجی آپارات بدون فایل محلی.',
        body: '',
        format: 'Video',
        thumbnailKey: thumbRes.data.storageKey,
        isFeatured: false,
        sources: [{ title: 'کانال علمی رصدخانه', url: aparatUrl }],
        files: [
          {
            kind: ContentFileKind.Main,
            storageType: FileStorageType.External,
            externalUrl: aparatUrl,
            originalFileName: 'ویدیوی جلسه اول در آپارات',
            mimeType: 'text/html',
            isDownloadable: true, // Caller attempts true; service must enforce false
          },
        ],
        topicIds: [1],
        tagIds: [],
        personIds: [],
        ageGroupIds: [],
      });
      assert(draftRes.ok && draftRes.data, 'Video draft with external Aparat file should save');
      assertEqual(draftRes.data.files.length, 1, 'One external file should be stored');
      assertEqual(
        draftRes.data.files[0].storageType,
        FileStorageType.External,
        'StorageType must be External',
      );
      assertEqual(
        draftRes.data.files[0].isDownloadable,
        false,
        'Rule 3.6: External links must always have isDownloadable = false',
      );

      const pubRes = await contentService.publishContent(superAdmin, draftRes.data.item.id);
      assert(pubRes.ok && pubRes.data, 'Video with valid external Main file must publish');
      assertEqual(pubRes.data.item.status, ContentStatus.Published, 'Video status should be Published');
    },
  },
  {
    id: 'stage9-html-sanitizer-on-save',
    nameKey: 'tests.stage9.htmlSanitizerOnSave.name',
    descriptionKey: 'tests.stage9.htmlSanitizerOnSave.desc',
    run: async () => {
      const { contentService, superAdmin } = await createStage9Harness();

      const maliciousBody =
        '<p>متن سالم</p><script>alert(\'xss\')</script><img src=x onerror="hack()"><a href="javascript:evil()">کلیک</a><a href="https://example.com/guide">منبع امن</a>';

      const saveRes = await contentService.saveDraft(superAdmin, {
        title: 'تست پاکسازی HTML',
        summary: 'بررسی حذف تگ‌ها و اسکریپت‌های خطرناک هنگام ذخیره.',
        body: maliciousBody,
        format: 'Article',
        isFeatured: false,
        sources: [],
        files: [],
        topicIds: [],
        tagIds: [],
        personIds: [],
        ageGroupIds: [],
      });
      assert(saveRes.ok && saveRes.data, 'Save should succeed after sanitizing body');

      const loaded = await contentService.getContentAggregate(
        superAdmin,
        saveRes.data.item.id,
      );
      const savedBody = loaded.data?.item.body ?? '';

      assert(savedBody.includes('<p>متن سالم</p>'), 'Safe <p> tag and content must be preserved');
      assert(savedBody.includes('کلیک'), 'Anchor inner text must be preserved');
      assert(!savedBody.toLowerCase().includes('<script'), '<script tag must be stripped');
      assert(!savedBody.toLowerCase().includes('alert('), 'Script body must be stripped');
      assert(!savedBody.toLowerCase().includes('onerror'), 'Inline onerror attribute must be stripped');
      assert(!savedBody.toLowerCase().includes('javascript:'), 'javascript: URI must be stripped');
      assert(
        savedBody.includes('href="https://example.com/guide"') &&
          savedBody.includes('rel="noopener noreferrer"'),
        'Safe https link must retain href with rel="noopener noreferrer"',
      );
    },
  },
  {
    id: 'stage9-archive-instead-of-delete',
    nameKey: 'tests.stage9.archiveInsteadOfDelete.name',
    descriptionKey: 'tests.stage9.archiveInsteadOfDelete.desc',
    run: async () => {
      const {
        clock,
        logger,
        contentService,
        superAdmin,
      } = await createStage9Harness();

      const thumbRes = await contentService.uploadThumbnailAsync(superAdmin, {
        originalFileName: 'cover.png',
        bytes: makePngBytes(),
      });
      assert(thumbRes.ok && thumbRes.data, 'Thumbnail upload should succeed');

      const draftRes = await contentService.saveDraft(superAdmin, {
        title: 'مقاله برای آزمون بایگانی',
        summary: 'محتوای کامل که سپس بایگانی می‌شود و حذف نمی‌شود.',
        body: '<p>متن کامل مقاله</p>',
        format: 'Article',
        thumbnailKey: thumbRes.data.storageKey,
        isFeatured: false,
        sources: [{ title: 'کتاب مرجع اول' }],
        files: [],
        topicIds: [1],
        tagIds: [],
        personIds: [],
        ageGroupIds: [],
      });
      assert(draftRes.ok && draftRes.data, 'Draft should save');
      assertEqual(
        draftRes.data.item.createdById,
        superAdmin.id,
        'Created draft must store real actor createdById',
      );

      const pubRes = await contentService.publishContent(superAdmin, draftRes.data.item.id);
      assert(pubRes.ok && pubRes.data, 'Publish should succeed');
      assertEqual(
        pubRes.data.item.createdById,
        superAdmin.id,
        'Publish must preserve original createdById',
      );

      const publicBefore = await contentService.getPublicPublishedBySlug(pubRes.data.item.slug);
      assert(publicBefore !== null, 'Public slug query returns published content before archive');

      const archRes = await contentService.archiveContent(superAdmin, pubRes.data.item.id);
      assert(archRes.ok && archRes.data, 'Archive should succeed');
      assertEqual(archRes.data.status, ContentStatus.Archived, 'Status must change to Archived');
      assertEqual(
        archRes.data.createdById,
        superAdmin.id,
        'Archive must preserve original createdById',
      );

      const publicAfter = await contentService.getPublicPublishedBySlug(pubRes.data.item.slug);
      assertEqual(publicAfter, null, 'Archived content must NOT be returned publicly');

      const publicListAfter = await contentService.listPublicPublished();
      assertEqual(
        publicListAfter.some((c) => c.id === pubRes.data!.item.id),
        false,
        'Archived content must be excluded from public published list',
      );

      const adminArchivedList = await contentService.listAdminContents(superAdmin, {
        status: ContentStatus.Archived,
      });
      assert(adminArchivedList.ok && adminArchivedList.data, 'Admin archived list query succeeds');
      const archivedEntry = adminArchivedList.data.items.find(
        (entry) => entry.item.id === pubRes.data!.item.id,
      );
      assert(archivedEntry !== undefined, 'Archived content must remain in admin list (no hard delete)');
      assertEqual(archivedEntry.sourcesCount, 1, 'Sources must remain preserved after archive');

      const restoredRes = await contentService.restoreToDraft(
        superAdmin,
        pubRes.data.item.id,
      );
      assert(restoredRes.ok && restoredRes.data, 'Restore to Draft must succeed');
      assertEqual(restoredRes.data.status, ContentStatus.Draft, 'Restored content is Draft');
      assertEqual(
        restoredRes.data.createdById,
        superAdmin.id,
        'Restore to Draft must preserve original createdById',
      );

      // Browser IndexedDB integration round-trip verification when indexedDB is available
      if (typeof window !== 'undefined' && typeof window.indexedDB !== 'undefined') {
        const testDbName = `${envConfig.databaseName}_stage9_test_${Date.now()}`;
        const testDataStore = new IndexedDbDataStore(
          testDbName,
          envConfig.databaseVersion,
          envConfig.metaStoreName,
        );

        try {
          const seeder = new DatabaseSeeder(testDataStore, logger);
          await seeder.seed();

          const idbAuthRepo = new IndexedDbAuthRepository(testDataStore);
          const idbAdminRepo = new IndexedDbAdminRepository(testDataStore);
          const idbTaxonomyRepo = new IndexedDbTaxonomyRepository(testDataStore);
          const idbContentRepo = new IndexedDbContentRepository(testDataStore);
          const idbFileStorage = new LocalIndexedDbFileStorage(testDataStore, clock);
          const idbPolicy = new PermissionPolicyService(idbAdminRepo, logger);
          const idbUpload = new FileUploadService(idbFileStorage, idbAdminRepo, idbPolicy, logger);
          const idbContentService = new ContentManagementService(
            idbContentRepo,
            idbTaxonomyRepo,
            idbPolicy,
            idbUpload,
            new SearchNormalizer(),
            clock,
            logger,
          );

          // Insert a dummy first user so the real actor gets id >= 2 (never assumes id === 1)
          await idbAuthRepo.createUser({
            displayName: 'کاربر اول نمونه',
            email: 'first.idb@test.local',
            normalizedEmail: 'first.idb@test.local',
            phoneNumber: null,
            normalizedPhoneNumber: null,
            passwordHash: 'hash',
            passwordSalt: 'salt',
            role: 'Member',
            ageGroupId: null,
            emailConfirmed: true,
            phoneNumberConfirmed: false,
            personalizationEnabled: true,
            isActive: true,
            mustChangePassword: false,
            failedLoginCount: 0,
            lockoutEnd: null,
            createdAt: clock.nowUtcIso(),
            lastLoginAt: null,
          });

          const idbActor = await idbAuthRepo.createUser({
            displayName: 'مدیر آزمون IndexedDB',
            email: 'admin.idb@test.local',
            normalizedEmail: 'admin.idb@test.local',
            phoneNumber: null,
            normalizedPhoneNumber: null,
            passwordHash: 'hash',
            passwordSalt: 'salt',
            role: 'SuperAdmin',
            ageGroupId: null,
            emailConfirmed: true,
            phoneNumberConfirmed: false,
            personalizationEnabled: true,
            isActive: true,
            mustChangePassword: false,
            failedLoginCount: 0,
            lockoutEnd: null,
            createdAt: clock.nowUtcIso(),
            lastLoginAt: null,
          });
          assert(idbActor.id >= 2, 'Real IndexedDB user id should be generated dynamically');

          const idbTopics = await idbTaxonomyRepo.getAllTopics();
          assert(idbTopics.length > 0, 'Seeded topics should exist in test IndexedDB');

          const idbThumb = await idbContentService.uploadThumbnailAsync(idbActor, {
            originalFileName: 'idb-cover.png',
            bytes: makePngBytes(),
          });
          assert(idbThumb.ok && idbThumb.data, 'IndexedDB thumbnail upload should succeed');

          const idbDraft = await idbContentService.saveDraft(idbActor, {
            title: 'تست ذخیره و بایگانی واقعی در IndexedDB',
            summary: 'بررسی ذخیره کاربر واقعی، انتشار، بایگانی و بازگردانی در دیتابیس محلی.',
            body: '<p>محتوای ذخیره شده در دیتابیس محلی</p>',
            format: 'Article',
            thumbnailKey: idbThumb.data.storageKey,
            isFeatured: false,
            sources: [{ title: 'منبع محلی معتبر' }],
            files: [],
            topicIds: [idbTopics[0].id],
            tagIds: [],
            personIds: [],
            ageGroupIds: [],
          });
          assert(idbDraft.ok && idbDraft.data, 'IndexedDB draft save should succeed');
          assertEqual(
            idbDraft.data.item.createdById,
            idbActor.id,
            'IndexedDB created content must hold generated actor id',
          );

          const idbUpdated = await idbContentService.saveDraft(idbActor, {
            id: idbDraft.data.item.id,
            title: 'تست ذخیره و بایگانی واقعی در IndexedDB (ویرایش‌شده)',
            summary: idbDraft.data.item.summary,
            body: idbDraft.data.item.body,
            format: 'Article',
            thumbnailKey: idbThumb.data.storageKey,
            isFeatured: false,
            sources: [{ title: 'منبع محلی معتبر' }],
            files: [],
            topicIds: [idbTopics[0].id],
            tagIds: [],
            personIds: [],
            ageGroupIds: [],
          });
          assert(idbUpdated.ok && idbUpdated.data, 'IndexedDB draft update should succeed');
          assertEqual(
            idbUpdated.data.item.createdById,
            idbActor.id,
            'IndexedDB update must preserve actor createdById',
          );

          const idbPublished = await idbContentService.publishContent(
            idbActor,
            idbDraft.data.item.id,
          );
          assert(idbPublished.ok && idbPublished.data, 'IndexedDB publish should succeed');
          assertEqual(
            idbPublished.data.item.createdById,
            idbActor.id,
            'IndexedDB publish must preserve actor createdById',
          );

          const idbArchived = await idbContentService.archiveContent(
            idbActor,
            idbDraft.data.item.id,
          );
          assert(idbArchived.ok && idbArchived.data, 'IndexedDB archive should succeed');
          assertEqual(
            idbArchived.data.createdById,
            idbActor.id,
            'IndexedDB archive must preserve actor createdById',
          );
          assertEqual(
            await idbContentService.getPublicPublishedBySlug(idbPublished.data.item.slug),
            null,
            'Archived IndexedDB item must not be returned publicly',
          );

          const idbRestored = await idbContentService.restoreToDraft(
            idbActor,
            idbDraft.data.item.id,
          );
          assert(idbRestored.ok && idbRestored.data, 'IndexedDB restoreToDraft should succeed');
          assertEqual(
            idbRestored.data.status,
            ContentStatus.Draft,
            'IndexedDB restoreToDraft must return item to Draft',
          );
          assertEqual(
            idbRestored.data.createdById,
            idbActor.id,
            'IndexedDB restoreToDraft must preserve actor createdById',
          );

          const fetchedSources = await idbContentRepo.getSourcesByContentId(idbDraft.data.item.id);
          assertEqual(fetchedSources.length, 1, 'IndexedDbContentRepository round-trip must persist sources');
        } finally {
          testDataStore.close();
          await new Promise<void>((resolve) => {
            const req = window.indexedDB.deleteDatabase(testDbName);
            req.onsuccess = () => resolve();
            req.onerror = () => resolve();
            req.onblocked = () => resolve();
          });
        }
      }
    },
  },
  {
    id: 'stage9-search-normalizer',
    nameKey: 'tests.stage9.searchNormalizer.name',
    descriptionKey: 'tests.stage9.searchNormalizer.desc',
    run: async () => {
      const { contentService, searchNormalizer, superAdmin } = await createStage9Harness();

      const rawTitle = 'كتاب عِلْمِ مـعاصر می‌شود ۱۲۳ PDF';
      const normalized = searchNormalizer.normalize(rawTitle);
      assert(normalized.includes('کتاب'), 'Arabic kaf/yeh must normalize to Persian ک/ی');
      assert(normalized.includes('علم'), 'Diacritics must be stripped');
      assert(normalized.includes('معاصر'), 'Kashida tatweel must be stripped');
      assert(normalized.includes('123'), 'Persian/Arabic digits must normalize to ASCII');
      assert(normalized.includes('pdf'), 'Latin text must lowercase');

      const draftRes = await contentService.saveDraft(superAdmin, {
        title: rawTitle,
        summary: 'خلاصه آزمایش جستجوی هوشمند نرمال‌شده.',
        body: '<p>محتوای تخصصی</p>',
        format: 'Pdf',
        isFeatured: false,
        sources: [{ title: 'دایرةالمعارف دانش' }],
        files: [],
        topicIds: [1],
        tagIds: [],
        personIds: [],
        ageGroupIds: [],
      });
      assert(draftRes.ok && draftRes.data, 'Content with mixed Arabic/Persian chars saves cleanly');

      const queries = ['کتاب', 'علم', 'می‌شود', 'میشود', 'می شود', '123', 'pdf'];
      for (const query of queries) {
        const searchRes = await contentService.listAdminContents(superAdmin, { search: query });
        assert(searchRes.ok && searchRes.data, `Search for "${query}" should succeed`);
        assertEqual(
          searchRes.data.totalCount,
          1,
          `Normalized search for "${query}" must match the saved content`,
        );
      }
    },
  },
  {
    id: 'stage9-content-rbac-policy',
    nameKey: 'tests.stage9.contentRbacPolicy.name',
    descriptionKey: 'tests.stage9.contentRbacPolicy.desc',
    run: async () => {
      const { contentService, adminRepo, logger, superAdmin, staffUser, memberUser } =
        await createStage9Harness();

      // Prepare one draft as SuperAdmin for publish/archive RBAC checks
      const baseDraft = await contentService.saveDraft(superAdmin, {
        title: 'محتوای آزمون دسترسی',
        summary: 'خلاصه آزمون کنترل دسترسی بخش محتوا.',
        body: '<p>متن آزمون</p>',
        format: 'Article',
        isFeatured: false,
        sources: [{ title: 'منبع آزمون' }],
        files: [],
        topicIds: [1],
        tagIds: [],
        personIds: [],
        ageGroupIds: [],
      });
      assert(baseDraft.ok && baseDraft.data, 'SuperAdmin must have full content.manage access');

      // 1. Staff WITHOUT content.manage -> 403 + WARN log
      const warnCountBefore = logger.getLogs().filter((l) => l.level === 'WARN').length;

      const staffCreateDenied = await contentService.saveDraft(staffUser, {
        title: 'تلاش غیرمجاز همکار',
        summary: 'خلاصه',
        format: 'Article',
        isFeatured: false,
        sources: [],
        files: [],
        topicIds: [],
        tagIds: [],
        personIds: [],
        ageGroupIds: [],
      });
      assertEqual(staffCreateDenied.statusCode, 403, 'Staff without content.manage gets 403 on create');

      const staffPublishDenied = await contentService.publishContent(
        staffUser,
        baseDraft.data.item.id,
      );
      assertEqual(staffPublishDenied.statusCode, 403, 'Staff without content.manage gets 403 on publish');

      const staffArchiveDenied = await contentService.archiveContent(
        staffUser,
        baseDraft.data.item.id,
      );
      assertEqual(staffArchiveDenied.statusCode, 403, 'Staff without content.manage gets 403 on archive');

      const warnCountAfter = logger.getLogs().filter((l) => l.level === 'WARN').length;
      assert(
        warnCountAfter >= warnCountBefore + 3,
        'Each 403 denial must append a WARN security log',
      );

      // 2. Grant content.manage to Staff -> succeeds with 200
      await adminRepo.replaceStaffPermissions(staffUser.id, [
        {
          userId: staffUser.id,
          permissionKey: 'content.manage',
          grantedAt: '2026-11-10T09:00:00.000Z',
          grantedById: superAdmin.id,
        },
      ]);

      const staffAllowedList = await contentService.listAdminContents(staffUser, {});
      assertEqual(staffAllowedList.statusCode, 200, 'Staff with content.manage gets 200 on list');

      const staffTaxOpts = await contentService.getTaxonomyOptionsForContent(staffUser);
      assertEqual(
        staffTaxOpts.statusCode,
        200,
        'Staff with only content.manage can read taxonomy options without requiring taxonomy.manage',
      );

      // 3. Member and Guest -> 404 (panel completely hidden)
      const memberRes = await contentService.listAdminContents(memberUser, {});
      assertEqual(memberRes.statusCode, 404, 'Member must receive 404 on content admin queries');
      assertEqual(
        canAccessAdminRoute(memberUser),
        false,
        'Navigation guard hides content admin route from Member',
      );

      const guestRes = await contentService.saveDraft(null, {
        title: 'تلاش مهمان',
        summary: 'خلاصه',
        format: 'Article',
        isFeatured: false,
        sources: [],
        files: [],
        topicIds: [],
        tagIds: [],
        personIds: [],
        ageGroupIds: [],
      });
      assertEqual(guestRes.statusCode, 404, 'Guest must receive 404 on content admin mutations');
      assertEqual(
        canAccessAdminRoute(null),
        false,
        'Navigation guard hides content admin route from Guest',
      );
    },
  },
];
