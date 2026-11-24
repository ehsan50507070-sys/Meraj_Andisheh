import type { IClock } from '../core/abstractions/IClock';
import type { IAdminRepository } from '../core/abstractions/adminRepository';
import type { IBookRepository } from '../core/abstractions/bookRepository';
import type { IContentRepository } from '../core/abstractions/contentRepository';
import type { IDownloadEventRepository } from '../core/abstractions/downloadRepository';
import type { FileReadRangeResult, IFileStorage } from '../core/abstractions/fileStorage';
import type { ITaxonomyRepository } from '../core/abstractions/taxonomyRepository';
import type { DownloadEvent } from '../core/domain/analytics';
import type { AppUser } from '../core/domain/auth';
import {
  ContentFileKind,
  ContentStatus,
  FileStorageType,
  type ContentAgeGroup,
  type ContentFile,
  type ContentFormat,
  type ContentItem,
  type ContentPerson,
  type ContentSource,
  type ContentTag,
  type ContentTopic,
} from '../core/domain/content';
import type { StaffPermission } from '../core/domain/permissions';
import type { BookInfo } from '../core/domain/portals';
import type { FeatureFlag, SiteSetting } from '../core/domain/settings';
import type { FileSaveRequest, StoredFileMetadata } from '../core/domain/storage';
import type { AgeGroup, ImpactLevel, Person, Tag, Topic } from '../core/domain/taxonomy';
import { BookPortalService } from '../core/services/bookPortalService';
import { ContentManagementService } from '../core/services/contentManagementService';
import { DownloadService } from '../core/services/downloadService';
import { FileUploadService } from '../core/services/fileUploadService';
import { PermissionPolicyService } from '../core/services/permissionPolicyService';
import { SearchNormalizer } from '../core/services/searchNormalizer';
import { SystemClock } from '../infrastructure/clock/SystemClock';
import { envConfig } from '../infrastructure/config/envConfig';
import { IndexedDbBackupSnapshotProvider } from '../infrastructure/data/IndexedDbBackupSnapshotProvider';
import { IndexedDbBookRepository } from '../infrastructure/data/IndexedDbBookRepository';
import { IndexedDbDataStore } from '../infrastructure/data/IndexedDbDataStore';
import {
  DATABASE_MIGRATIONS,
  STAGE24_OBJECT_STORES,
  STORE_NAMES,
} from '../infrastructure/data/migrations';
import { INITIAL_AGE_GROUPS } from '../infrastructure/data/seed';
import { AppLogger } from '../infrastructure/logging/AppLogger';
import { HmacDownloadTokenProtector } from '../infrastructure/security/HmacDownloadTokenProtector';
import { assert, assertEqual, type UnitTestCase } from './testRunner';

class Stage24FakeClock implements IClock {
  private iso: string;
  private readonly inner = new SystemClock();

  constructor(initialIso = '2026-11-24T12:00:00.000Z') {
    this.iso = initialIso;
  }

  public setUtcIso(nextIso: string): void {
    this.iso = nextIso;
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

function makeStage24SecretKey(): Uint8Array {
  const key = new Uint8Array(32);
  for (let i = 0; i < 32; i += 1) {
    key[i] = (i * 19 + 31) & 0xff;
  }
  return key;
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

class MemoryStage24AdminRepository implements IAdminRepository {
  public users: AppUser[] = [];
  public permissions: StaffPermission[] = [];
  public flags: FeatureFlag[] = [{ key: 'Books', isEnabled: true }];
  public settings: SiteSetting[] = [];
  public ageGroups: AgeGroup[] = INITIAL_AGE_GROUPS.map((g, idx) => ({ ...g, id: idx + 1 }));

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
      this.users.find((u) => u.normalizedPhoneNumber === normalizedPhoneNumber) ?? null
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

  public async deleteSessionsByUserId(_userId: number): Promise<void> {}

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
    return this.flags.map((f) => ({ ...f }));
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
    for (const s of settings) {
      const idx = this.settings.findIndex((existing) => existing.key === s.key);
      if (idx === -1) {
        this.settings.push({ ...s });
      } else {
        this.settings[idx] = { ...s };
      }
    }
  }

  public async getActiveAgeGroups(): Promise<AgeGroup[]> {
    return this.ageGroups.filter((ag) => ag.isActive);
  }
}

class MemoryStage24ContentRepository implements IContentRepository {
  public items: ContentItem[] = [];
  public sources: ContentSource[] = [];
  public files: ContentFile[] = [];
  public contentTopics: ContentTopic[] = [];
  public contentTags: ContentTag[] = [];
  public contentPersons: ContentPerson[] = [];
  public contentAgeGroups: ContentAgeGroup[] = [];
  private readonly adminRepository: MemoryStage24AdminRepository;
  private itemSeq = 1;
  private sourceSeq = 1;
  private fileSeq = 1;

  constructor(adminRepository: MemoryStage24AdminRepository) {
    this.adminRepository = adminRepository;
  }

  public async getAllContentItems(): Promise<ContentItem[]> {
    return this.items.map((i) => ({ ...i }));
  }

  public async getContentItemById(id: number): Promise<ContentItem | null> {
    const found = this.items.find((i) => i.id === id);
    return found ? { ...found } : null;
  }

  public async getContentItemBySlug(slug: string): Promise<ContentItem | null> {
    const found = this.items.find((i) => i.slug === slug);
    return found ? { ...found } : null;
  }

  public async createContentItem(item: Omit<ContentItem, 'id'>): Promise<ContentItem> {
    const created: ContentItem = { ...item, id: this.itemSeq++ };
    this.items.push(created);
    return { ...created };
  }

  public async updateContentItem(item: ContentItem): Promise<void> {
    const idx = this.items.findIndex((i) => i.id === item.id);
    if (idx !== -1) {
      this.items[idx] = { ...item };
    }
  }

  public async getSourcesByContentId(contentId: number): Promise<ContentSource[]> {
    return this.sources.filter((s) => s.contentId === contentId).map((s) => ({ ...s }));
  }

  public async getAllSources(): Promise<ContentSource[]> {
    return this.sources.map((s) => ({ ...s }));
  }

  public async replaceSources(
    contentId: number,
    sources: Omit<ContentSource, 'id'>[],
  ): Promise<ContentSource[]> {
    this.sources = this.sources.filter((s) => s.contentId !== contentId);
    const created = sources.map((s) => ({ ...s, contentId, id: this.sourceSeq++ }));
    this.sources.push(...created);
    return created.map((s) => ({ ...s }));
  }

  public async getFilesByContentId(contentId: number): Promise<ContentFile[]> {
    return this.files.filter((f) => f.contentId === contentId).map((f) => ({ ...f }));
  }

  public async getAllFiles(): Promise<ContentFile[]> {
    return this.files.map((f) => ({ ...f }));
  }

  public async replaceFiles(
    contentId: number,
    files: Omit<ContentFile, 'id'>[],
  ): Promise<ContentFile[]> {
    this.files = this.files.filter((f) => f.contentId !== contentId);
    const created = files.map((f) => ({ ...f, contentId, id: this.fileSeq++ }));
    this.files.push(...created);
    return created.map((f) => ({ ...f }));
  }

  public async getTopicIdsByContentId(contentId: number): Promise<number[]> {
    return this.contentTopics.filter((ct) => ct.contentId === contentId).map((ct) => ct.topicId);
  }

  public async getAllContentTopics(): Promise<ContentTopic[]> {
    return this.contentTopics.map((ct) => ({ ...ct }));
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
    return this.contentTags.map((ct) => ({ ...ct }));
  }

  public async replaceContentTags(contentId: number, tagIds: number[]): Promise<void> {
    this.contentTags = this.contentTags.filter((ct) => ct.contentId !== contentId);
    for (const tagId of tagIds) {
      this.contentTags.push({ contentId, tagId });
    }
  }

  public async getPersonIdsByContentId(contentId: number): Promise<number[]> {
    return this.contentPersons.filter((cp) => cp.contentId === contentId).map((cp) => cp.personId);
  }

  public async getAllContentPersons(): Promise<ContentPerson[]> {
    return this.contentPersons.map((cp) => ({ ...cp }));
  }

  public async replaceContentPersons(contentId: number, personIds: number[]): Promise<void> {
    this.contentPersons = this.contentPersons.filter((cp) => cp.contentId !== contentId);
    for (const personId of personIds) {
      this.contentPersons.push({ contentId, personId });
    }
  }

  public async getAgeGroupIdsByContentId(contentId: number): Promise<number[]> {
    return this.contentAgeGroups
      .filter((ca) => ca.contentId === contentId)
      .map((ca) => ca.ageGroupId);
  }

  public async getAllContentAgeGroups(): Promise<ContentAgeGroup[]> {
    return this.contentAgeGroups.map((ca) => ({ ...ca }));
  }

  public async replaceContentAgeGroups(contentId: number, ageGroupIds: number[]): Promise<void> {
    this.contentAgeGroups = this.contentAgeGroups.filter((ca) => ca.contentId !== contentId);
    for (const ageGroupId of ageGroupIds) {
      this.contentAgeGroups.push({ contentId, ageGroupId });
    }
  }

  public async userExists(userId: number): Promise<boolean> {
    return this.adminRepository.users.some((u) => u.id === userId);
  }
}

class MemoryStage24TaxonomyRepository implements ITaxonomyRepository {
  public topics: Topic[] = [];
  public tags: Tag[] = [];
  public persons: Person[] = [];
  public impactLevels: ImpactLevel[] = [{ id: 1, name: 'عمیق و تحلیلی', sortOrder: 1 }];
  public ageGroups: AgeGroup[] = INITIAL_AGE_GROUPS.map((g, idx) => ({ ...g, id: idx + 1 }));
  private seq = 100;

  public async getAllTopics(): Promise<Topic[]> {
    return this.topics.map((t) => ({ ...t }));
  }

  public async getTopicById(id: number): Promise<Topic | null> {
    return this.topics.find((t) => t.id === id) ?? null;
  }

  public async createTopic(topic: Omit<Topic, 'id'>): Promise<Topic> {
    const created: Topic = { ...topic, id: this.seq++ };
    this.topics.push(created);
    return created;
  }

  public async updateTopic(_topic: Topic): Promise<void> {}
  public async deleteTopic(_id: number): Promise<void> {}

  public async getAllTags(): Promise<Tag[]> {
    return this.tags.map((t) => ({ ...t }));
  }

  public async getTagById(id: number): Promise<Tag | null> {
    return this.tags.find((t) => t.id === id) ?? null;
  }

  public async createTag(tag: Omit<Tag, 'id'>): Promise<Tag> {
    const created: Tag = { ...tag, id: this.seq++ };
    this.tags.push(created);
    return created;
  }

  public async updateTag(_tag: Tag): Promise<void> {}
  public async deleteTag(_id: number): Promise<void> {}

  public async getAllPersons(): Promise<Person[]> {
    return this.persons.map((p) => ({ ...p }));
  }

  public async getPersonById(id: number): Promise<Person | null> {
    return this.persons.find((p) => p.id === id) ?? null;
  }

  public async createPerson(person: Omit<Person, 'id'>): Promise<Person> {
    const created: Person = { ...person, id: this.seq++ };
    this.persons.push(created);
    return created;
  }

  public async updatePerson(_person: Person): Promise<void> {}
  public async deletePerson(_id: number): Promise<void> {}

  public async getAllImpactLevels(): Promise<ImpactLevel[]> {
    return this.impactLevels.map((i) => ({ ...i }));
  }

  public async getImpactLevelById(id: number): Promise<ImpactLevel | null> {
    return this.impactLevels.find((i) => i.id === id) ?? null;
  }

  public async createImpactLevel(level: Omit<ImpactLevel, 'id'>): Promise<ImpactLevel> {
    const created: ImpactLevel = { ...level, id: this.seq++ };
    this.impactLevels.push(created);
    return created;
  }

  public async updateImpactLevel(_level: ImpactLevel): Promise<void> {}
  public async deleteImpactLevel(_id: number): Promise<void> {}

  public async getAllAgeGroups(): Promise<AgeGroup[]> {
    return this.ageGroups.map((a) => ({ ...a }));
  }

  public async getAgeGroupById(id: number): Promise<AgeGroup | null> {
    return this.ageGroups.find((a) => a.id === id) ?? null;
  }

  public async updateAgeGroup(_group: AgeGroup): Promise<void> {}
  public async getContentTopicLinks(): Promise<ContentTopic[]> {
    return [];
  }
  public async countContentTagsByTagId(_tagId: number): Promise<number> {
    return 0;
  }
  public async countContentPersonsByPersonId(_personId: number): Promise<number> {
    return 0;
  }
  public async countContentItemsByImpactLevelId(_impactLevelId: number): Promise<number> {
    return 0;
  }
  public async createContentItem(_item: Omit<ContentItem, 'id'>): Promise<ContentItem> {
    throw new Error('Not needed');
  }
  public async linkContentTopic(_contentId: number, _topicId: number): Promise<void> {}
}

class MemoryStage24BookRepository implements IBookRepository {
  private map = new Map<number, BookInfo>();

  public async getBookInfoByContentIdAsync(contentId: number): Promise<BookInfo | null> {
    const found = this.map.get(contentId);
    return found ? { ...found } : null;
  }

  public async getAllBookInfosAsync(): Promise<BookInfo[]> {
    return Array.from(this.map.values()).map((info) => ({ ...info }));
  }

  public async upsertBookInfoAsync(info: BookInfo): Promise<BookInfo> {
    const copy: BookInfo = { ...info };
    this.map.set(copy.contentId, copy);
    return { ...copy };
  }

  public async deleteBookInfoByContentIdAsync(contentId: number): Promise<boolean> {
    return this.map.delete(contentId);
  }
}

class MemoryStage24FileStorage implements IFileStorage {
  private entries = new Map<string, { bytes: Uint8Array; metadata: StoredFileMetadata }>();
  private seq = 1;

  public async saveAsync(request: FileSaveRequest): Promise<StoredFileMetadata> {
    const storageKey = `${request.visibility}/${this.seq++}_${request.originalFileName}`;
    const ext = request.originalFileName.split('.').pop()?.toLowerCase() ?? '';
    const metadata: StoredFileMetadata = {
      storageKey,
      originalFileName: request.originalFileName,
      extension: ext,
      mimeType: request.contentType,
      sizeBytes: request.bytes.byteLength,
      visibility: request.visibility,
      category: ext === 'png' || ext === 'jpg' || ext === 'jpeg' || ext === 'webp' ? 'image' : 'document',
      uploadedById: request.uploadedById ?? null,
      createdAt: new Date().toISOString(),
    };
    this.entries.set(storageKey, {
      bytes: new Uint8Array(request.bytes),
      metadata,
    });
    return { ...metadata };
  }

  public async openReadAsync(
    storageKey: string,
  ): Promise<{ bytes: Uint8Array; metadata: StoredFileMetadata } | null> {
    const entry = this.entries.get(storageKey);
    if (!entry) {
      return null;
    }
    return {
      bytes: new Uint8Array(entry.bytes),
      metadata: { ...entry.metadata },
    };
  }

  public async openReadRangeAsync(
    storageKey: string,
    startByte: number,
    endByte: number,
  ): Promise<FileReadRangeResult | null> {
    const entry = this.entries.get(storageKey);
    if (!entry) {
      return null;
    }
    const clampedEnd = Math.min(endByte, entry.bytes.byteLength - 1);
    return {
      chunk: entry.bytes.slice(startByte, clampedEnd + 1),
      totalBytes: entry.bytes.byteLength,
      startByte,
      endByte: clampedEnd,
      mimeType: entry.metadata.mimeType,
    };
  }

  public async getMetadataAsync(storageKey: string): Promise<StoredFileMetadata | null> {
    const entry = this.entries.get(storageKey);
    return entry ? { ...entry.metadata } : null;
  }

  public async deleteAsync(storageKey: string): Promise<void> {
    this.entries.delete(storageKey);
  }

  public async existsAsync(storageKey: string): Promise<boolean> {
    return this.entries.has(storageKey);
  }

  public async listAllMetadataAsync(): Promise<StoredFileMetadata[]> {
    return Array.from(this.entries.values()).map((e) => ({ ...e.metadata }));
  }
}

class MemoryStage24DownloadEventRepository implements IDownloadEventRepository {
  public events: DownloadEvent[] = [];
  private seq = 1;

  public async createDownloadEvent(event: Omit<DownloadEvent, 'id'>): Promise<DownloadEvent> {
    const created: DownloadEvent = { ...event, id: this.seq++ };
    this.events.push(created);
    return { ...created };
  }

  public async getDownloadEventsByContentId(contentId: number): Promise<DownloadEvent[]> {
    return this.events.filter((e) => e.contentId === contentId).map((e) => ({ ...e }));
  }

  public async getDownloadEventsByUserId(userId: number): Promise<DownloadEvent[]> {
    return this.events.filter((e) => e.userId === userId).map((e) => ({ ...e }));
  }

  public async getAllDownloadEvents(): Promise<DownloadEvent[]> {
    return this.events.map((e) => ({ ...e }));
  }
}

function makeStage24User(id: number, role: 'SuperAdmin' | 'Staff' | 'Member'): AppUser {
  return {
    id,
    email: `${role.toLowerCase()}${id}@meraj.ir`,
    normalizedEmail: `${role.toLowerCase()}${id}@meraj.ir`.toUpperCase(),
    emailConfirmed: true,
    phoneNumber: null,
    normalizedPhoneNumber: null,
    phoneNumberConfirmed: false,
    passwordHash: 'hash',
    passwordSalt: 'salt',
    displayName: `${role} ${id}`,
    ageGroupId: 4,
    personalizationEnabled: true,
    mustChangePassword: false,
    isActive: true,
    role,
    failedLoginCount: 0,
    lockoutEnd: null,
    createdAt: '2026-11-24T08:00:00.000Z',
    lastLoginAt: '2026-11-24T08:00:00.000Z',
  };
}

function createStage24Harness() {
  const clock = new Stage24FakeClock();
  const logger = new AppLogger(clock, 'meraj_stage24_test_logs', 100);
  logger.clearLogs();

  const adminRepository = new MemoryStage24AdminRepository();
  const contentRepository = new MemoryStage24ContentRepository(adminRepository);
  const taxonomyRepository = new MemoryStage24TaxonomyRepository();
  const bookRepository = new MemoryStage24BookRepository();
  const fileStorage = new MemoryStage24FileStorage();
  const downloadEventRepository = new MemoryStage24DownloadEventRepository();
  const searchNormalizer = new SearchNormalizer();
  const policyService = new PermissionPolicyService(adminRepository, logger);
  const fileUploadService = new FileUploadService(
    fileStorage,
    adminRepository,
    policyService,
    logger,
  );

  const bookPortalService = new BookPortalService({
    bookRepository,
    contentRepository,
    taxonomyRepository,
    adminRepository,
    policyService,
    logger,
    searchNormalizer,
    fileStorage,
  });

  const contentManagementService = new ContentManagementService(
    contentRepository,
    taxonomyRepository,
    policyService,
    fileUploadService,
    searchNormalizer,
    clock,
    logger,
  );

  const tokenProtector = new HmacDownloadTokenProtector({
    secretKeyBytes: makeStage24SecretKey(),
  });
  const downloadService = new DownloadService(
    contentRepository,
    downloadEventRepository,
    fileStorage,
    tokenProtector,
    clock,
    logger,
  );

  const superAdmin = makeStage24User(1, 'SuperAdmin');
  const staffWithPortalsAndContent = makeStage24User(2, 'Staff');
  const staffWithoutPortals = makeStage24User(3, 'Staff');
  const member = makeStage24User(4, 'Member');
  adminRepository.users.push(
    superAdmin,
    staffWithPortalsAndContent,
    staffWithoutPortals,
    member,
  );

  adminRepository.permissions.push(
    {
      id: 1,
      userId: staffWithPortalsAndContent.id,
      permissionKey: 'portals.manage',
      grantedAt: '2026-11-24T08:00:00.000Z',
      grantedById: superAdmin.id,
    },
    {
      id: 2,
      userId: staffWithPortalsAndContent.id,
      permissionKey: 'content.manage',
      grantedAt: '2026-11-24T08:00:00.000Z',
      grantedById: superAdmin.id,
    },
    {
      id: 3,
      userId: staffWithoutPortals.id,
      permissionKey: 'content.manage',
      grantedAt: '2026-11-24T08:00:00.000Z',
      grantedById: superAdmin.id,
    },
  );

  return {
    clock,
    logger,
    adminRepository,
    contentRepository,
    taxonomyRepository,
    bookRepository,
    fileStorage,
    downloadEventRepository,
    bookPortalService,
    contentManagementService,
    downloadService,
    searchNormalizer,
    superAdmin,
    staffWithPortalsAndContent,
    staffWithoutPortals,
    member,
  };
}

async function seedBookContent(
  harness: ReturnType<typeof createStage24Harness>,
  params: {
    title: string;
    slug: string;
    format?: ContentFormat;
    status?: ContentStatus;
    isFeatured?: boolean;
    topicIds?: number[];
    ageGroupIds?: number[];
    publishedAt?: string;
    author?: string;
    publisher?: string | null;
    publishYear?: number | null;
    pages?: number | null;
    keyExcerpts?: string | null;
    studioNote?: string | null;
  },
): Promise<ContentItem> {
  const created = await harness.contentRepository.createContentItem({
    title: params.title,
    slug: params.slug,
    summary: `خلاصه معرفی ${params.title}`,
    body: '<p>معرفی و نقد کتاب در معراج اندیشه</p>',
    format: params.format ?? 'Book',
    impactLevelId: 1,
    readWatchMinutes: 18,
    thumbnailKey: null,
    status: params.status ?? ContentStatus.Published,
    isFeatured: Boolean(params.isFeatured),
    languageCode: 'fa',
    viewCount: 0,
    downloadCount: 0,
    likeCount: 0,
    searchText: harness.searchNormalizer.normalize(
      `${params.title} ${params.author ?? ''} ${params.publisher ?? ''}`,
    ),
    createdById: harness.superAdmin.id,
    publishedAt:
      (params.status ?? ContentStatus.Published) === ContentStatus.Published
        ? (params.publishedAt ?? '2026-11-24T10:00:00.000Z')
        : null,
    createdAt: '2026-11-24T08:00:00.000Z',
    updatedAt: '2026-11-24T08:00:00.000Z',
  });

  if (params.topicIds && params.topicIds.length > 0) {
    await harness.contentRepository.replaceContentTopics(created.id, params.topicIds);
  }
  if (params.ageGroupIds && params.ageGroupIds.length > 0) {
    await harness.contentRepository.replaceContentAgeGroups(created.id, params.ageGroupIds);
  }

  if ((params.format ?? 'Book') === 'Book') {
    await harness.bookRepository.upsertBookInfoAsync({
      contentId: created.id,
      author: params.author ?? 'مرتضی مطهری',
      publisher: params.publisher ?? 'انتشارات صدرا',
      publishYear: params.publishYear ?? 1402,
      pages: params.pages ?? 280,
      keyExcerpts: params.keyExcerpts ?? 'بریده‌ی کلیدی کتاب برای تأمل و گفتگو.',
      studioNote: params.studioNote ?? 'یادداشت تبیینی استودیو معراج اندیشه پیرامون کتاب.',
    });
  }

  return created;
}

export const stage24Tests: UnitTestCase[] = [
  {
    id: 'stage24_feature_flag_lifecycle',
    nameKey: 'tests.stage24.featureFlagLifecycle.name',
    descriptionKey: 'tests.stage24.featureFlagLifecycle.desc',
    run: async () => {
      const h = createStage24Harness();
      try {
        const topicPhilosophy = await h.taxonomyRepository.createTopic({
          name: 'اندیشه و فلسفه',
          slug: 'thought-philosophy',
          parentId: null,
          icon: null,
          sortOrder: 1,
          isActive: true,
        });
        const topicEducation = await h.taxonomyRepository.createTopic({
          name: 'تربیت و خانواده',
          slug: 'education-family',
          parentId: null,
          icon: null,
          sortOrder: 2,
          isActive: true,
        });

        await seedBookContent(h, {
          title: 'تأملاتی در فلسفه‌ی اخلاق',
          slug: 'ethics-reflections-book',
          author: 'دکتر رضا داوری',
          publisher: 'پژوهشگاه حکمت',
          isFeatured: true,
          topicIds: [topicPhilosophy.id],
        });
        await seedBookContent(h, {
          title: 'گام‌های تربیت نوجوان',
          slug: 'teen-education-book',
          author: 'زهرا محمدی',
          publisher: 'نشر فرهنگ پویا',
          isFeatured: false,
          topicIds: [topicEducation.id],
        });
        await seedBookContent(h, {
          title: 'پیش‌نویس کتاب منتشرنشده',
          slug: 'draft-book-hidden',
          status: ContentStatus.Draft,
          author: 'نویسنده‌ی آزمایشی',
          topicIds: [topicPhilosophy.id],
        });
        await seedBookContent(h, {
          title: 'مقاله‌ی غیرکتابی',
          slug: 'non-book-article',
          format: 'Article',
          status: ContentStatus.Published,
          topicIds: [topicPhilosophy.id],
        });

        // 1. Flag disabled -> #/books and #/books/:slug both report disabled / not_found
        await h.adminRepository.upsertFeatureFlag({ key: 'Books', isEnabled: false });
        const disabledShowcase = await h.bookPortalService.getBookPortalDataAsync(null);
        assertEqual(
          disabledShowcase.enabled,
          false,
          'Book showcase must be disabled when FeatureFlag("Books") is false',
        );
        const disabledDetail = await h.bookPortalService.getPublicBookDetailAsync(
          'ethics-reflections-book',
          null,
        );
        assertEqual(
          disabledDetail.status,
          'not_found',
          'Book detail must return not_found when FeatureFlag("Books") is false',
        );

        // 2. Flag enabled -> only Published format==='Book' appear, plus search & topic shelf filters
        await h.adminRepository.upsertFeatureFlag({ key: 'Books', isEnabled: true });
        const enabledShowcase = await h.bookPortalService.getBookPortalDataAsync(null);
        assert(enabledShowcase.enabled, 'Book showcase must be enabled when flag is true');
        assertEqual(
          enabledShowcase.data.allAllowedBooksCount,
          2,
          'Exactly 2 Published Book items must appear (draft and Article excluded)',
        );
        assertEqual(
          enabledShowcase.data.featuredBooks.length,
          1,
          'Exactly 1 featured book must appear',
        );
        assertEqual(
          enabledShowcase.data.shelves.length,
          2,
          'Two non-empty topic shelves expected',
        );

        const searchByPublisher = await h.bookPortalService.getBookPortalDataAsync(null, {
          query: 'فرهنگ پویا',
        });
        assert(searchByPublisher.enabled, 'Search result must be enabled');
        assertEqual(
          searchByPublisher.data.items.length,
          1,
          'Search by publisher must match 1 book',
        );
        assertEqual(
          searchByPublisher.data.items[0].item.slug,
          'teen-education-book',
          'Matched book slug must be teen-education-book',
        );

        const filterByTopic = await h.bookPortalService.getBookPortalDataAsync(null, {
          topicId: topicPhilosophy.id,
        });
        assert(filterByTopic.enabled, 'Topic filter result must be enabled');
        assertEqual(
          filterByTopic.data.items.length,
          1,
          'Topic filter must narrow to philosophy book',
        );
        assertEqual(
          filterByTopic.data.items[0].bookInfo.author,
          'دکتر رضا داوری',
          'Topic filter must return author metadata cleanly',
        );
      } finally {
        h.logger.clearLogs();
      }
    },
  },
  {
    id: 'stage24_publish_requires_source_and_book_info',
    nameKey: 'tests.stage24.publishRequiresSourceAndBookInfo.name',
    descriptionKey: 'tests.stage24.publishRequiresSourceAndBookInfo.desc',
    run: async () => {
      const h = createStage24Harness();
      try {
        const topicSci = await h.taxonomyRepository.createTopic({
          name: 'تاریخ و تمدن',
          slug: 'history-civ',
          parentId: null,
          icon: null,
          sortOrder: 1,
          isActive: true,
        });

        // Upload real cover image & PDF sample file via ContentManagementService
        const pngHeader = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
        const coverUpload = await h.contentManagementService.uploadThumbnailAsync(
          h.staffWithPortalsAndContent,
          {
            originalFileName: 'book-cover.png',
            bytes: pngHeader,
          },
        );
        assert(coverUpload.ok && coverUpload.data, 'Cover thumbnail upload must succeed');

        const pdfHeader = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 10, 20]);
        const sampleUpload = await h.contentManagementService.uploadContentFileAsync(
          h.staffWithPortalsAndContent,
          {
            originalFileName: 'book-sample.pdf',
            bytes: pdfHeader,
          },
        );
        assert(sampleUpload.ok && sampleUpload.data, 'Sample PDF upload must succeed');

        // 1. Save draft Book WITHOUT ContentSource
        const draftWithoutSource = await h.contentManagementService.saveDraft(
          h.staffWithPortalsAndContent,
          {
            title: 'کتاب روش تحقیق تمدنی',
            slug: 'civilizational-research-book',
            summary: 'معرفی کتاب در باب روش‌های پژوهش تاریخی و تمدنی.',
            body: '<p>معرفی تفصیلی کتاب</p>',
            format: 'Book',
            impactLevelId: 1,
            readWatchMinutes: 15,
            thumbnailKey: coverUpload.data.storageKey,
            isFeatured: true,
            sources: [],
            files: [
              {
                kind: ContentFileKind.Main,
                storageType: FileStorageType.Local,
                storageKey: sampleUpload.data.storageKey,
                externalUrl: null,
                originalFileName: sampleUpload.data.originalFileName,
                mimeType: sampleUpload.data.mimeType,
                sizeBytes: sampleUpload.data.sizeBytes,
                isDownloadable: true,
              },
            ],
            topicIds: [topicSci.id],
            tagIds: [],
            personIds: [],
            ageGroupIds: [],
          },
        );
        assert(draftWithoutSource.ok && draftWithoutSource.data, 'Draft Book must save cleanly');
        const bookContentId = draftWithoutSource.data.item.id;

        // 2. Save BookInfo for this book
        const bookInfoSave = await h.bookPortalService.upsertBookInfoAsync(
          h.staffWithPortalsAndContent,
          {
            contentId: bookContentId,
            author: 'دکتر حسن رحیمی',
            publisher: 'نشر دانش معاصر',
            publishYear: '۱۴۰۳',
            pages: '۳۴۲',
            keyExcerpts: '«فصل اول: فهم ریشه‌های تحول فرهنگی نیازمند بررسی متون اصلی است.»',
            studioNote: 'پیشنهاد ویژه برای آغاز مطالعه‌ی موضوعی در حوزه‌ی تاریخ تمدن.',
          },
          { sourceContext: 'contentForm', routePath: `#/admin/content/edit/${bookContentId}` },
        );
        assert(bookInfoSave.ok && bookInfoSave.data, 'BookInfo must save via contentForm context');

        // 3. Attempting publish without ContentSource must fail with PUBLISH_VALIDATION_FAILED (noSource)
        const publishDenied = await h.contentManagementService.publishContent(
          h.staffWithPortalsAndContent,
          bookContentId,
        );
        assertEqual(
          publishDenied.ok,
          false,
          'Publishing a Book without ContentSource must fail',
        );
        assertEqual(
          publishDenied.errorCode,
          'PUBLISH_VALIDATION_FAILED',
          'Publish failure must return PUBLISH_VALIDATION_FAILED',
        );
        assert(
          Boolean(publishDenied.validationErrors?.some((e) => e.code === 'SOURCE_REQUIRED')),
          'Validation errors must include SOURCE_REQUIRED',
        );

        // 4. Add a valid ContentSource and publish -> must succeed cleanly
        const draftWithSource = await h.contentManagementService.saveDraft(
          h.staffWithPortalsAndContent,
          {
            id: bookContentId,
            title: 'کتاب روش تحقیق تمدنی',
            slug: 'civilizational-research-book',
            summary: 'معرفی کتاب در باب روش‌های پژوهش تاریخی و تمدنی.',
            body: '<p>معرفی تفصیلی کتاب</p>',
            format: 'Book',
            impactLevelId: 1,
            readWatchMinutes: 15,
            thumbnailKey: coverUpload.data.storageKey,
            isFeatured: true,
            sources: [
              {
                title: 'کتاب‌شناسی ملی ایران — شناسنامه ثبت کتاب',
                url: 'https://example.ir/national-bib-record',
                note: 'چاپ سوم، ۱۴۰۳',
              },
            ],
            files: [
              {
                kind: ContentFileKind.Main,
                storageType: FileStorageType.Local,
                storageKey: sampleUpload.data.storageKey,
                externalUrl: null,
                originalFileName: sampleUpload.data.originalFileName,
                mimeType: sampleUpload.data.mimeType,
                sizeBytes: sampleUpload.data.sizeBytes,
                isDownloadable: true,
              },
            ],
            topicIds: [topicSci.id],
            tagIds: [],
            personIds: [],
            ageGroupIds: [],
          },
        );
        assert(draftWithSource.ok, 'Updating draft with ContentSource must succeed');

        const publishSuccess = await h.contentManagementService.publishContent(
          h.staffWithPortalsAndContent,
          bookContentId,
        );
        assert(publishSuccess.ok, 'Publishing Book with ContentSource + cover must succeed');

        // 5. Verify public BookDetail returns all BookInfo fields and verified source
        const detailRes = await h.bookPortalService.getPublicBookDetailAsync(
          'civilizational-research-book',
          null,
        );
        assertEqual(detailRes.status, 'ok', 'Published Book detail must load');
        if (detailRes.status === 'ok') {
          assertEqual(detailRes.data.bookInfo.author, 'دکتر حسن رحیمی', 'Author must match');
          assertEqual(
            detailRes.data.bookInfo.publisher,
            'نشر دانش معاصر',
            'Publisher must match',
          );
          assertEqual(detailRes.data.bookInfo.publishYear, 1403, 'PublishYear must be 1403');
          assertEqual(detailRes.data.bookInfo.pages, 342, 'Pages must be 342');
          assert(
            detailRes.data.bookInfo.keyExcerpts?.includes('فصل اول') ?? false,
            'KeyExcerpts must be returned',
          );
          assert(
            detailRes.data.bookInfo.studioNote?.includes('پیشنهاد ویژه') ?? false,
            'StudioNote must be returned',
          );
          assertEqual(detailRes.data.sources.length, 1, 'Verified ContentSource must appear');
        }
      } finally {
        h.logger.clearLogs();
      }
    },
  },
  {
    id: 'stage24_sample_pdf_download_auth_and_signed_link',
    nameKey: 'tests.stage24.samplePdfDownloadAuthAndSignedLink.name',
    descriptionKey: 'tests.stage24.samplePdfDownloadAuthAndSignedLink.desc',
    run: async () => {
      const h = createStage24Harness();
      try {
        const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x35, 1, 2, 3, 4]);
        const storedPdf = await h.fileStorage.saveAsync({
          originalFileName: 'ketab-sample.pdf',
          contentType: 'application/pdf',
          bytes: pdfBytes,
          visibility: 'private',
          uploadedById: h.superAdmin.id,
        });

        const bookItem = await seedBookContent(h, {
          title: 'کتاب مهارت‌های تفکر انتقادی',
          slug: 'critical-thinking-book',
          author: 'دکتر مریم کریمی',
          publisher: 'انتشارات معرفت',
        });

        const savedFiles = await h.contentRepository.replaceFiles(bookItem.id, [
          {
            contentId: bookItem.id,
            kind: ContentFileKind.Main,
            storageType: FileStorageType.Local,
            storageKey: storedPdf.storageKey,
            externalUrl: null,
            originalFileName: 'ketab-sample.pdf',
            mimeType: 'application/pdf',
            sizeBytes: pdfBytes.byteLength,
            isDownloadable: true,
            sortOrder: 1,
          },
        ]);
        const fileId = savedFiles[0].id;
        const returnHash = `#/books/${bookItem.slug}`;

        // 1. Guest download attempt -> AUTH_REQUIRED + redirectUrl preserving #/books/:slug
        const guestResult = await h.downloadService.createSignedDownloadLinkAsync({
          currentUser: null,
          contentId: bookItem.id,
          fileId,
          activeAgeGroup: null,
          returnUrl: returnHash,
        });
        assertEqual(guestResult.ok, false, 'Guest cannot obtain signed book download link');
        if (!guestResult.ok) {
          assertEqual(guestResult.errorCode, 'AUTH_REQUIRED', 'Guest must receive AUTH_REQUIRED');
          assertEqual(
            guestResult.redirectUrl,
            `#/account/login?returnUrl=${encodeURIComponent(returnHash)}`,
            'Redirect URL must preserve returnUrl to #/books/:slug',
          );
        }

        // 2. Authenticated member -> 5-minute signed link issued and resolves PDF bytes
        const memberLink = await h.downloadService.createSignedDownloadLinkAsync({
          currentUser: h.member,
          contentId: bookItem.id,
          fileId,
          activeAgeGroup: null,
          returnUrl: returnHash,
        });
        assert(memberLink.ok, 'Authenticated member must receive signed download link');
        if (memberLink.ok) {
          const ttlDiffMs = memberLink.expiresAtEpochMs - h.clock.now().getTime();
          assertEqual(ttlDiffMs, 5 * 60 * 1000, 'Signed book token TTL must equal 5 minutes');

          const downloadRes = await h.downloadService.executeSignedDownloadAsync({
            currentUser: h.member,
            token: memberLink.token,
            activeAgeGroup: null,
          });
          assert(downloadRes.ok, 'Signed book sample download execution must succeed');
          if (downloadRes.ok) {
            assertEqual(
              downloadRes.originalFileName,
              'ketab-sample.pdf',
              'Downloaded file name must match sample PDF',
            );
            assertEqual(
              downloadRes.bytes.byteLength,
              pdfBytes.byteLength,
              'Downloaded bytes length must match stored sample PDF',
            );
          }

          const updatedBook = await h.contentRepository.getContentItemById(bookItem.id);
          assertEqual(
            updatedBook?.downloadCount,
            1,
            'Book downloadCount must increment after sample download',
          );
        }
      } finally {
        h.logger.clearLogs();
      }
    },
  },
  {
    id: 'stage24_child_safety_on_showcase_and_detail',
    nameKey: 'tests.stage24.childSafetyOnShowcaseAndDetail.name',
    descriptionKey: 'tests.stage24.childSafetyOnShowcaseAndDetail.desc',
    run: async () => {
      const h = createStage24Harness();
      try {
        const childAge = h.taxonomyRepository.ageGroups.find((g) => g.key === 'child')!;
        const adultAge = h.taxonomyRepository.ageGroups.find((g) => g.key === 'adult')!;

        const literatureTopic = await h.taxonomyRepository.createTopic({
          name: 'ادبیات و داستان',
          slug: 'literature',
          parentId: null,
          icon: null,
          sortOrder: 1,
          isActive: true,
        });

        await seedBookContent(h, {
          title: 'تحلیل فلسفی تاریخ معاصر (ویژه بزرگسال)',
          slug: 'adult-only-book',
          author: 'دکتر علیرضا نوری',
          isFeatured: true,
          topicIds: [literatureTopic.id],
          ageGroupIds: [adultAge.id],
        });
        await seedBookContent(h, {
          title: 'قصه‌های مهربانی برای کودکان',
          slug: 'child-friendly-book',
          author: 'مریم کاظمی',
          isFeatured: false,
          topicIds: [literatureTopic.id],
          ageGroupIds: [childAge.id],
        });

        // 1. Child profile: adult book is excluded from items, featuredBooks, shelves, and #/books/:slug -> not_found
        const childShowcase = await h.bookPortalService.getBookPortalDataAsync(childAge);
        assert(childShowcase.enabled, 'Book showcase must be enabled');
        assertEqual(
          childShowcase.data.featuredBooks.length,
          0,
          'Adult featured book must not appear for child profile',
        );
        assertEqual(
          childShowcase.data.items.length,
          1,
          'Only child-allowed book may appear in child showcase',
        );
        assertEqual(
          childShowcase.data.items[0].item.slug,
          'child-friendly-book',
          'Child showcase item must be child-friendly-book',
        );

        const blockedDetail = await h.bookPortalService.getPublicBookDetailAsync(
          'adult-only-book',
          childAge,
        );
        assertEqual(
          blockedDetail.status,
          'not_found',
          'Direct #/books/:adultSlug must return not_found for child',
        );

        const childDetail = await h.bookPortalService.getPublicBookDetailAsync(
          'child-friendly-book',
          childAge,
        );
        assertEqual(childDetail.status, 'ok', 'Child-friendly book detail must open for child');
        if (childDetail.status === 'ok') {
          assertEqual(
            childDetail.data.relatedBooks.length,
            0,
            'Adult-only book must never appear in child relatedBooks',
          );
        }

        // 2. Adult profile: adult book detail opens and sees related book
        const adultDetail = await h.bookPortalService.getPublicBookDetailAsync(
          'adult-only-book',
          adultAge,
        );
        assertEqual(adultDetail.status, 'ok', 'Adult book detail must load for adult');
        if (adultDetail.status === 'ok') {
          assertEqual(
            adultDetail.data.relatedBooks.length,
            1,
            'Adult profile sees related book in same topic',
          );
        }
      } finally {
        h.logger.clearLogs();
      }
    },
  },
  {
    id: 'stage24_rbac_and_indexeddb_v16',
    nameKey: 'tests.stage24.rbacAndIndexedDbV16.name',
    descriptionKey: 'tests.stage24.rbacAndIndexedDbV16.desc',
    run: async () => {
      const h = createStage24Harness();
      const tempDbName = `MerajStage24_V16_${Date.now()}`;
      try {
        const bookItem = await seedBookContent(h, {
          title: 'کتاب آزمون دسترسی پرتال',
          slug: 'rbac-book-test',
        });

        // 1. Member -> 404
        const memberRes = await h.bookPortalService.listAdminBooksAsync(h.member);
        assertEqual(memberRes.ok, false, 'Member cannot list admin books');
        assertEqual(memberRes.statusCode, 404, 'Member must receive 404');

        // 2. Staff without portals.manage -> 403 + WARN log
        h.logger.clearLogs();
        const deniedList = await h.bookPortalService.listAdminBooksAsync(h.staffWithoutPortals);
        assertEqual(deniedList.ok, false, 'Staff without portals.manage must be denied');
        assertEqual(deniedList.statusCode, 403, 'Staff without portals.manage gets 403');
        assert(
          h.logger.getLogs().some((log) => log.level === 'WARN'),
          '403 denial must emit WARN security log',
        );

        // 3. Staff with portals.manage -> 200 + Persian digits normalization on BookInfo
        const allowedList = await h.bookPortalService.listAdminBooksAsync(
          h.staffWithPortalsAndContent,
        );
        assertEqual(allowedList.ok, true, 'Staff with portals.manage can list admin books');
        assertEqual(allowedList.statusCode, 200, 'Staff with portals.manage gets 200');

        const persianDigitsSave = await h.bookPortalService.upsertBookInfoAsync(
          h.staffWithPortalsAndContent,
          {
            contentId: bookItem.id,
            author: 'سعید حسینی',
            publisher: 'نشر فرهنگ',
            publishYear: '۱۴۰۳',
            pages: '۲۸۰',
            keyExcerpts: 'بریده‌ی آزمایشی',
            studioNote: 'یادداشت آزمایشی',
          },
          { sourceContext: 'portals' },
        );
        assertEqual(persianDigitsSave.ok, true, 'Persian numerals on BookInfo must parse cleanly');
        assertEqual(persianDigitsSave.data?.publishYear, 1403, 'Publish year 1403 stored');
        assertEqual(persianDigitsSave.data?.pages, 280, 'Pages 280 stored');

        // 4. IndexedDB v16 schema & Backup snapshot round-trip check
        assert(
          envConfig.databaseVersion >= 16,
          `envConfig.databaseVersion must be >= 16 (actual=${envConfig.databaseVersion})`,
        );
        assert(
          DATABASE_MIGRATIONS.some((m) => m.version === 16),
          'DATABASE_MIGRATIONS must contain version 16',
        );
        assert(
          STAGE24_OBJECT_STORES.includes(STORE_NAMES.BOOK_INFOS),
          'STAGE24_OBJECT_STORES must include bookInfos',
        );

        if (typeof indexedDB !== 'undefined') {
          const store = new IndexedDbDataStore(
            tempDbName,
            envConfig.databaseVersion,
            envConfig.metaStoreName,
          );
          try {
            await store.connect();
            const storeNames = await store.getObjectStoreNames();
            assert(
              storeNames.includes(STORE_NAMES.BOOK_INFOS),
              'IndexedDB v16 must contain bookInfos store',
            );

            const idbRepo = new IndexedDbBookRepository(store);
            await idbRepo.upsertBookInfoAsync({
              contentId: bookItem.id,
              author: 'سعید حسینی',
              publisher: 'نشر فرهنگ',
              publishYear: 1403,
              pages: 280,
              keyExcerpts: 'بریده‌ی آزمایشی',
              studioNote: 'یادداشت آزمایشی',
            });

            const persisted = await idbRepo.getBookInfoByContentIdAsync(bookItem.id);
            assertEqual(persisted?.author, 'سعید حسینی', 'IndexedDbBookRepository persists author');

            const snapshotProvider = new IndexedDbBackupSnapshotProvider(store);
            const exported = await snapshotProvider.exportFullSnapshotAsync();
            assert(
              Array.isArray(exported.tables[STORE_NAMES.BOOK_INFOS]) &&
                exported.tables[STORE_NAMES.BOOK_INFOS].length === 1,
              'Backup snapshot export must dynamically include bookInfos rows',
            );
            store.close();
          } finally {
            store.close();
            await deleteTempDatabaseAsync(tempDbName);
          }
        }
      } finally {
        h.logger.clearLogs();
      }
    },
  },
];
