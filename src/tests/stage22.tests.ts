import type { IClock } from '../core/abstractions/IClock';
import type { IAdminRepository } from '../core/abstractions/adminRepository';
import type {
  ExportedDatabaseSnapshot,
  IBackupLogRepository,
  IBackupSnapshotProvider,
  IBackupStorage,
} from '../core/abstractions/backupService';
import type { ICommentRepository } from '../core/abstractions/commentRepository';
import type { IContentRepository } from '../core/abstractions/contentRepository';
import type { IContentRequestRepository } from '../core/abstractions/contentRequestRepository';
import type { IDownloadEventRepository } from '../core/abstractions/downloadRepository';
import type {
  FileReadRangeResult,
  IFileStorage,
} from '../core/abstractions/fileStorage';
import type { IInteractionRepository } from '../core/abstractions/interactionRepository';
import type { ILayoutRepository } from '../core/abstractions/layoutRepository';
import type { ITaxonomyRepository } from '../core/abstractions/taxonomyRepository';
import type { IViewEventRepository } from '../core/abstractions/viewTracker';
import type { DownloadEvent, ViewEvent } from '../core/domain/analytics';
import type { AppUser, UserRole } from '../core/domain/auth';
import type {
  BackupLog,
  BackupRestoreReport,
  BackupSnapshotFile,
  BackupStoredFileEntry,
} from '../core/domain/backup';
import {
  CommentStatus,
  type BlockedWord,
  type CommentItem,
  type CommentReport,
} from '../core/domain/comments';
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
import type { ContentBookmark, ContentLike } from '../core/domain/interactions';
import type { HeroSlide, HomeShelf, StaticPage } from '../core/domain/layout';
import type { PermissionKey, StaffPermission } from '../core/domain/permissions';
import {
  ContentRequestStatus,
  type ContentRequestItem,
} from '../core/domain/requests';
import {
  FEATURE_FLAG_KEYS,
  type FeatureFlag,
  type SiteSetting,
} from '../core/domain/settings';
import type { FileSaveRequest, StoredFileMetadata } from '../core/domain/storage';
import type {
  AgeGroup,
  ImpactLevel,
  Person,
  Tag,
  Topic,
} from '../core/domain/taxonomy';
import { AnalyticsDashboardService } from '../core/services/analyticsDashboardService';
import {
  BackupService,
  RESTORE_SANDBOX_DB_NAME,
} from '../core/services/backupService';
import { CommentService } from '../core/services/commentService';
import { ContentCatalogService } from '../core/services/contentCatalogService';
import { ContentDetailService } from '../core/services/contentDetailService';
import { ContentManagementService } from '../core/services/contentManagementService';
import { ContentRequestService } from '../core/services/contentRequestService';
import { DownloadService } from '../core/services/downloadService';
import { FileUploadService } from '../core/services/fileUploadService';
import { InteractionService } from '../core/services/interactionService';
import { PermissionPolicyService } from '../core/services/permissionPolicyService';
import { SearchNormalizer } from '../core/services/searchNormalizer';
import {
  auditDocumentExternalCdnUrls,
  buildSafeErrorReport,
  getRobotsMetaForRoute,
  validateCspPolicy,
  validateRobotsTxtContent,
} from '../core/services/securityAuditService';
import { SitemapService } from '../core/services/sitemapService';
import { ViewTrackerService } from '../core/services/viewTrackerService';
import { SystemClock } from '../infrastructure/clock/SystemClock';
import { envConfig } from '../infrastructure/config/envConfig';
import { IndexedDbDataStore } from '../infrastructure/data/IndexedDbDataStore';
import { DATABASE_MIGRATIONS, STORE_NAMES } from '../infrastructure/data/migrations';
import { INITIAL_AGE_GROUPS } from '../infrastructure/data/seed';
import { AppLogger } from '../infrastructure/logging/AppLogger';
import { HmacDownloadTokenProtector } from '../infrastructure/security/HmacDownloadTokenProtector';
import { assert, assertEqual, type UnitTestCase } from './testRunner';

const PRODUCTION_CSP_POLICY =
  "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; media-src 'self' blob: data:; font-src 'self' data:; connect-src 'self' blob: data:; frame-src 'self' blob: https://www.aparat.com https://aparat.com; object-src 'self' blob:; base-uri 'self'";

class Stage22FakeClock implements IClock {
  private currentMs: number;
  private readonly inner = new SystemClock();

  constructor(initialIso = '2026-11-24T10:00:00.000Z') {
    this.currentMs = Date.parse(initialIso);
  }

  public advanceMinutes(minutes: number): void {
    this.currentMs += minutes * 60 * 1000;
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

class Stage22MemoryFileStorage implements IFileStorage {
  private readonly files = new Map<
    string,
    { bytes: Uint8Array; meta: StoredFileMetadata }
  >();
  private readonly clock: IClock;
  private seq = 1;

  constructor(clock: IClock) {
    this.clock = clock;
  }

  public async saveAsync(request: FileSaveRequest): Promise<StoredFileMetadata> {
    const cleanName = request.originalFileName.trim();
    const ext = cleanName.includes('.')
      ? cleanName.slice(cleanName.lastIndexOf('.') + 1).toLowerCase()
      : 'bin';
    const category = ext === 'png' || ext === 'jpg' ? 'image' : 'document';
    const storageKey = `${request.visibility}/${category}/s22-${this.seq++}.${ext}`;
    const meta: StoredFileMetadata = {
      storageKey,
      originalFileName: cleanName,
      extension: ext,
      mimeType:
        request.contentType ||
        (ext === 'png' ? 'image/png' : 'application/pdf'),
      sizeBytes: request.bytes.byteLength,
      visibility: request.visibility,
      category,
      uploadedById: request.uploadedById ?? null,
      createdAt: this.clock.nowUtcIso(),
    };
    this.files.set(storageKey, {
      bytes: new Uint8Array(request.bytes),
      meta,
    });
    return { ...meta };
  }

  public async openReadAsync(
    storageKey: string,
  ): Promise<{ bytes: Uint8Array; metadata: StoredFileMetadata } | null> {
    const found = this.files.get(storageKey);
    if (!found) {
      return null;
    }
    return { bytes: new Uint8Array(found.bytes), metadata: { ...found.meta } };
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
      mimeType: found.meta.mimeType,
    };
  }

  public async getMetadataAsync(
    storageKey: string,
  ): Promise<StoredFileMetadata | null> {
    const found = this.files.get(storageKey);
    return found ? { ...found.meta } : null;
  }

  public async deleteAsync(storageKey: string): Promise<void> {
    this.files.delete(storageKey);
  }

  public async existsAsync(storageKey: string): Promise<boolean> {
    return this.files.has(storageKey);
  }

  public async listAllMetadataAsync(): Promise<StoredFileMetadata[]> {
    return Array.from(this.files.values()).map((entry) => ({ ...entry.meta }));
  }

  public async exportBackupEntriesAsync(): Promise<BackupStoredFileEntry[]> {
    const entries: BackupStoredFileEntry[] = [];
    for (const item of this.files.values()) {
      const binary = Array.from(item.bytes, (b) => String.fromCharCode(b)).join('');
      entries.push({
        metadata: { ...item.meta },
        base64Data: btoa(binary),
      });
    }
    return entries;
  }
}

class Stage22MemoryHarness
  implements
    IAdminRepository,
    ITaxonomyRepository,
    IContentRepository,
    IViewEventRepository,
    IDownloadEventRepository,
    IInteractionRepository,
    ICommentRepository,
    IContentRequestRepository,
    ILayoutRepository,
    IBackupLogRepository,
    IBackupStorage,
    IBackupSnapshotProvider
{
  public databaseVersion: number = envConfig.databaseVersion;
  public users: AppUser[] = [];
  public staffPermissions: StaffPermission[] = [];
  public featureFlags: FeatureFlag[] = FEATURE_FLAG_KEYS.map((key) => ({
    key,
    isEnabled: key === 'Comments' || key === 'ContentRequests',
  }));
  public siteSettings: SiteSetting[] = [];
  public ageGroups: AgeGroup[] = INITIAL_AGE_GROUPS.map((g, i) => ({
    ...g,
    id: i + 1,
  }));
  public topics: Topic[] = [];
  public tags: Tag[] = [];
  public persons: Person[] = [];
  public impactLevels: ImpactLevel[] = [{ id: 1, name: 'عادی', sortOrder: 1 }];

  public contents: ContentItem[] = [];
  public sources: ContentSource[] = [];
  public files: ContentFile[] = [];
  public contentTopics: ContentTopic[] = [];
  public contentTags: ContentTag[] = [];
  public contentPersons: ContentPerson[] = [];
  public contentAgeGroups: ContentAgeGroup[] = [];

  public viewEvents: ViewEvent[] = [];
  public downloadEvents: DownloadEvent[] = [];
  public likes: ContentLike[] = [];
  public bookmarks: ContentBookmark[] = [];
  public comments: CommentItem[] = [];
  public commentReports: CommentReport[] = [];
  public blockedWords: BlockedWord[] = [];
  public contentRequests: ContentRequestItem[] = [];

  public heroSlides: HeroSlide[] = [];
  public homeShelves: HomeShelf[] = [];
  public staticPages: StaticPage[] = [];

  public backupLogs: BackupLog[] = [];
  public backupArchives = new Map<
    string,
    { payloadText: string; sizeBytes: number }
  >();
  public sandboxSnapshot: BackupSnapshotFile | null = null;

  public readonly fileStorage: Stage22MemoryFileStorage;

  private seq = {
    user: 10,
    perm: 1,
    topic: 1,
    tag: 1,
    person: 1,
    impact: 10,
    content: 1,
    source: 1,
    file: 1,
    view: 1,
    download: 1,
    comment: 1,
    report: 1,
    blocked: 1,
    request: 1,
    slide: 1,
    shelf: 1,
    staticPage: 1,
    backupLog: 1,
  };

  constructor(clock: IClock) {
    this.fileStorage = new Stage22MemoryFileStorage(clock);
  }

  public async seedUserAsync(params: {
    email: string;
    displayName: string;
    role: UserRole;
    ageGroupId: number | null;
    permissions?: PermissionKey[];
  }): Promise<AppUser> {
    const user: AppUser = {
      id: ++this.seq.user,
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
      ageGroupId: params.ageGroupId,
      personalizationEnabled: false,
      mustChangePassword: false,
      isActive: true,
      isDeleted: false,
      deletedAt: null,
      failedLoginCount: 0,
      lockoutEnd: null,
      createdAt: '2026-11-24T08:00:00.000Z',
      lastLoginAt: null,
    };
    this.users.push(user);
    if (params.permissions && params.permissions.length > 0) {
      await this.replaceStaffPermissions(
        user.id,
        params.permissions.map((permissionKey) => ({
          userId: user.id,
          permissionKey,
          grantedById: user.id,
          grantedAt: '2026-11-24T08:00:00.000Z',
        })),
      );
    }
    return { ...user };
  }

  public getAgeGroupByKey(key: AgeGroup['key']): AgeGroup {
    const found = this.ageGroups.find((g) => g.key === key);
    if (!found) {
      throw new Error(`Missing AgeGroup ${key}`);
    }
    return { ...found };
  }

  // IAdminRepository
  public async getUserById(id: number): Promise<AppUser | null> {
    const found = this.users.find((u) => u.id === id);
    return found ? { ...found } : null;
  }

  public async getUserByNormalizedEmail(
    normalizedEmail: string,
  ): Promise<AppUser | null> {
    const found = this.users.find((u) => u.normalizedEmail === normalizedEmail);
    return found ? { ...found } : null;
  }

  public async getUserByNormalizedPhoneNumber(
    normalizedPhoneNumber: string,
  ): Promise<AppUser | null> {
    const found = this.users.find(
      (u) => u.normalizedPhoneNumber === normalizedPhoneNumber,
    );
    return found ? { ...found } : null;
  }

  public async getAllUsers(): Promise<AppUser[]> {
    return this.users.map((u) => ({ ...u }));
  }

  public async createUser(user: Omit<AppUser, 'id'>): Promise<AppUser> {
    const created: AppUser = { ...user, id: ++this.seq.user };
    this.users.push(created);
    return { ...created };
  }

  public async updateUser(user: AppUser): Promise<void> {
    this.users = this.users.map((u) => (u.id === user.id ? { ...user } : u));
  }

  public async deleteSessionsByUserId(_userId: number): Promise<void> {
    // No-op in harness
  }

  public async getStaffPermissionsByUserId(
    userId: number,
  ): Promise<StaffPermission[]> {
    return this.staffPermissions
      .filter((p) => p.userId === userId)
      .map((p) => ({ ...p }));
  }

  public async replaceStaffPermissions(
    userId: number,
    permissions: Omit<StaffPermission, 'id'>[],
  ): Promise<StaffPermission[]> {
    this.staffPermissions = this.staffPermissions.filter(
      (p) => p.userId !== userId,
    );
    const created = permissions.map((p) => ({ ...p, id: ++this.seq.perm }));
    this.staffPermissions.push(...created);
    return created.map((p) => ({ ...p }));
  }

  public async getAllFeatureFlags(): Promise<FeatureFlag[]> {
    return this.featureFlags.map((f) => ({ ...f }));
  }

  public async upsertFeatureFlag(flag: FeatureFlag): Promise<void> {
    const idx = this.featureFlags.findIndex((f) => f.key === flag.key);
    if (idx === -1) {
      this.featureFlags.push({ ...flag });
    } else {
      this.featureFlags[idx] = { ...flag };
    }
  }

  public async getAllSiteSettings(): Promise<SiteSetting[]> {
    return this.siteSettings.map((s) => ({ ...s }));
  }

  public async getSiteSettingByKey(key: string): Promise<SiteSetting | null> {
    const found = this.siteSettings.find((s) => s.key === key);
    return found ? { ...found } : null;
  }

  public async upsertSiteSettings(settings: SiteSetting[]): Promise<void> {
    for (const s of settings) {
      const idx = this.siteSettings.findIndex((i) => i.key === s.key);
      if (idx === -1) {
        this.siteSettings.push({ ...s });
      } else {
        this.siteSettings[idx] = { ...s };
      }
    }
  }

  public async getActiveAgeGroups(): Promise<AgeGroup[]> {
    return this.ageGroups.filter((g) => g.isActive).map((g) => ({ ...g }));
  }

  // ITaxonomyRepository
  public async getAllAgeGroups(): Promise<AgeGroup[]> {
    return this.ageGroups.map((g) => ({ ...g }));
  }

  public async getAgeGroupById(id: number): Promise<AgeGroup | null> {
    return this.ageGroups.find((g) => g.id === id) ?? null;
  }

  public async updateAgeGroup(ageGroup: AgeGroup): Promise<void> {
    this.ageGroups = this.ageGroups.map((g) =>
      g.id === ageGroup.id ? { ...ageGroup } : g,
    );
  }

  public async getAllTopics(): Promise<Topic[]> {
    return this.topics.map((t) => ({ ...t }));
  }

  public async getTopicById(id: number): Promise<Topic | null> {
    return this.topics.find((t) => t.id === id) ?? null;
  }

  public async createTopic(topic: Omit<Topic, 'id'>): Promise<Topic> {
    const created: Topic = { ...topic, id: ++this.seq.topic };
    this.topics.push(created);
    return { ...created };
  }

  public async updateTopic(topic: Topic): Promise<void> {
    this.topics = this.topics.map((t) => (t.id === topic.id ? { ...topic } : t));
  }

  public async deleteTopic(id: number): Promise<void> {
    this.topics = this.topics.filter((t) => t.id !== id);
  }

  public async getAllTags(): Promise<Tag[]> {
    return this.tags.map((t) => ({ ...t }));
  }

  public async getTagById(id: number): Promise<Tag | null> {
    return this.tags.find((t) => t.id === id) ?? null;
  }

  public async createTag(tag: Omit<Tag, 'id'>): Promise<Tag> {
    const created: Tag = { ...tag, id: ++this.seq.tag };
    this.tags.push(created);
    return { ...created };
  }

  public async updateTag(tag: Tag): Promise<void> {
    this.tags = this.tags.map((t) => (t.id === tag.id ? { ...tag } : t));
  }

  public async deleteTag(id: number): Promise<void> {
    this.tags = this.tags.filter((t) => t.id !== id);
  }

  public async getAllPersons(): Promise<Person[]> {
    return this.persons.map((p) => ({ ...p }));
  }

  public async getPersonById(id: number): Promise<Person | null> {
    return this.persons.find((p) => p.id === id) ?? null;
  }

  public async createPerson(person: Omit<Person, 'id'>): Promise<Person> {
    const created: Person = { ...person, id: ++this.seq.person };
    this.persons.push(created);
    return { ...created };
  }

  public async updatePerson(person: Person): Promise<void> {
    this.persons = this.persons.map((p) =>
      p.id === person.id ? { ...person } : p,
    );
  }

  public async deletePerson(id: number): Promise<void> {
    this.persons = this.persons.filter((p) => p.id !== id);
  }

  public async getAllImpactLevels(): Promise<ImpactLevel[]> {
    return this.impactLevels.map((l) => ({ ...l }));
  }

  public async getImpactLevelById(id: number): Promise<ImpactLevel | null> {
    return this.impactLevels.find((l) => l.id === id) ?? null;
  }

  public async createImpactLevel(
    level: Omit<ImpactLevel, 'id'>,
  ): Promise<ImpactLevel> {
    const created: ImpactLevel = { ...level, id: ++this.seq.impact };
    this.impactLevels.push(created);
    return { ...created };
  }

  public async updateImpactLevel(level: ImpactLevel): Promise<void> {
    this.impactLevels = this.impactLevels.map((l) =>
      l.id === level.id ? { ...level } : l,
    );
  }

  public async deleteImpactLevel(id: number): Promise<void> {
    this.impactLevels = this.impactLevels.filter((l) => l.id !== id);
  }

  public async getContentTopicLinks(): Promise<ContentTopic[]> {
    return this.contentTopics.map((ct) => ({ ...ct }));
  }

  public async countContentTagsByTagId(tagId: number): Promise<number> {
    return this.contentTags.filter((ct) => ct.tagId === tagId).length;
  }

  public async countContentPersonsByPersonId(personId: number): Promise<number> {
    return this.contentPersons.filter((cp) => cp.personId === personId).length;
  }

  public async countContentItemsByImpactLevelId(
    impactLevelId: number,
  ): Promise<number> {
    return this.contents.filter((c) => c.impactLevelId === impactLevelId).length;
  }

  public async linkContentTopic(
    contentId: number,
    topicId: number,
  ): Promise<void> {
    if (
      !this.contentTopics.some(
        (ct) => ct.contentId === contentId && ct.topicId === topicId,
      )
    ) {
      this.contentTopics.push({ contentId, topicId });
    }
  }

  // IContentRepository
  public async getAllContentItems(): Promise<ContentItem[]> {
    return this.contents.map((c) => ({ ...c }));
  }

  public async getContentItemById(id: number): Promise<ContentItem | null> {
    const found = this.contents.find((c) => c.id === id);
    return found ? { ...found } : null;
  }

  public async getContentItemBySlug(slug: string): Promise<ContentItem | null> {
    const found = this.contents.find((c) => c.slug === slug);
    return found ? { ...found } : null;
  }

  public async createContentItem(
    item: Omit<ContentItem, 'id'>,
  ): Promise<ContentItem> {
    const created: ContentItem = { ...item, id: ++this.seq.content };
    this.contents.push(created);
    return { ...created };
  }

  public async updateContentItem(item: ContentItem): Promise<void> {
    this.contents = this.contents.map((c) =>
      c.id === item.id ? { ...item } : c,
    );
  }

  public async getSourcesByContentId(
    contentId: number,
  ): Promise<ContentSource[]> {
    return this.sources
      .filter((s) => s.contentId === contentId)
      .map((s) => ({ ...s }));
  }

  public async getAllSources(): Promise<ContentSource[]> {
    return this.sources.map((s) => ({ ...s }));
  }

  public async replaceSources(
    contentId: number,
    sources: Omit<ContentSource, 'id'>[],
  ): Promise<ContentSource[]> {
    this.sources = this.sources.filter((s) => s.contentId !== contentId);
    const created = sources.map((s) => ({
      ...s,
      id: ++this.seq.source,
      contentId,
    }));
    this.sources.push(...created);
    return created.map((s) => ({ ...s }));
  }

  public async getFilesByContentId(contentId: number): Promise<ContentFile[]> {
    return this.files
      .filter((f) => f.contentId === contentId)
      .map((f) => ({ ...f }));
  }

  public async getAllFiles(): Promise<ContentFile[]> {
    return this.files.map((f) => ({ ...f }));
  }

  public async replaceFiles(
    contentId: number,
    files: Omit<ContentFile, 'id'>[],
  ): Promise<ContentFile[]> {
    this.files = this.files.filter((f) => f.contentId !== contentId);
    const created = files.map((f) => ({
      ...f,
      id: ++this.seq.file,
      contentId,
    }));
    this.files.push(...created);
    return created.map((f) => ({ ...f }));
  }

  public async getTopicIdsByContentId(contentId: number): Promise<number[]> {
    return this.contentTopics
      .filter((ct) => ct.contentId === contentId)
      .map((ct) => ct.topicId);
  }

  public async getAllContentTopics(): Promise<ContentTopic[]> {
    return this.contentTopics.map((ct) => ({ ...ct }));
  }

  public async replaceContentTopics(
    contentId: number,
    topicIds: number[],
  ): Promise<void> {
    this.contentTopics = this.contentTopics.filter(
      (ct) => ct.contentId !== contentId,
    );
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
    return this.contentTags.map((ct) => ({ ...ct }));
  }

  public async replaceContentTags(
    contentId: number,
    tagIds: number[],
  ): Promise<void> {
    this.contentTags = this.contentTags.filter(
      (ct) => ct.contentId !== contentId,
    );
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
    return this.contentPersons.map((cp) => ({ ...cp }));
  }

  public async replaceContentPersons(
    contentId: number,
    personIds: number[],
  ): Promise<void> {
    this.contentPersons = this.contentPersons.filter(
      (cp) => cp.contentId !== contentId,
    );
    for (const personId of personIds) {
      this.contentPersons.push({ contentId, personId });
    }
  }

  public async getAgeGroupIdsByContentId(contentId: number): Promise<number[]> {
    return this.contentAgeGroups
      .filter((ca) => ca.contentId === contentId)
      .map((ca) => ca.ageGroupId);
  }

  public async getAllContentAgeGroups(): Promise<
    Array<{ contentId: number; ageGroupId: number }>
  > {
    return this.contentAgeGroups.map((ca) => ({ ...ca }));
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
    return this.users.some((u) => u.id === userId);
  }

  // IViewEventRepository
  public async createViewEvent(
    event: Omit<ViewEvent, 'id'>,
  ): Promise<ViewEvent> {
    const created: ViewEvent = { ...event, id: ++this.seq.view };
    this.viewEvents.push(created);
    return { ...created };
  }

  public async getViewEventsByContentId(
    contentId: number,
  ): Promise<ViewEvent[]> {
    return this.viewEvents
      .filter((v) => v.contentId === contentId)
      .map((v) => ({ ...v }));
  }

  public async getAllViewEvents(): Promise<ViewEvent[]> {
    return this.viewEvents.map((v) => ({ ...v }));
  }

  // IDownloadEventRepository
  public async createDownloadEvent(
    event: Omit<DownloadEvent, 'id'>,
  ): Promise<DownloadEvent> {
    const created: DownloadEvent = { ...event, id: ++this.seq.download };
    this.downloadEvents.push(created);
    return { ...created };
  }

  public async getDownloadEventsByContentId(
    contentId: number,
  ): Promise<DownloadEvent[]> {
    return this.downloadEvents
      .filter((d) => d.contentId === contentId)
      .map((d) => ({ ...d }));
  }

  public async getDownloadEventsByUserId(
    userId: number,
  ): Promise<DownloadEvent[]> {
    return this.downloadEvents
      .filter((d) => d.userId === userId)
      .map((d) => ({ ...d }));
  }

  public async getAllDownloadEvents(): Promise<DownloadEvent[]> {
    return this.downloadEvents.map((d) => ({ ...d }));
  }

  // IInteractionRepository
  public async getLike(
    userId: number,
    contentId: number,
  ): Promise<ContentLike | null> {
    return (
      this.likes.find((l) => l.userId === userId && l.contentId === contentId) ??
      null
    );
  }

  public async createLike(like: ContentLike): Promise<boolean> {
    if (await this.getLike(like.userId, like.contentId)) {
      return false;
    }
    this.likes.push({ ...like });
    return true;
  }

  public async deleteLike(userId: number, contentId: number): Promise<boolean> {
    const before = this.likes.length;
    this.likes = this.likes.filter(
      (l) => !(l.userId === userId && l.contentId === contentId),
    );
    return this.likes.length < before;
  }

  public async getLikesByUserId(userId: number): Promise<ContentLike[]> {
    return this.likes.filter((l) => l.userId === userId).map((l) => ({ ...l }));
  }

  public async getLikesByContentId(contentId: number): Promise<ContentLike[]> {
    return this.likes
      .filter((l) => l.contentId === contentId)
      .map((l) => ({ ...l }));
  }

  public async countLikesByContentId(contentId: number): Promise<number> {
    return this.likes.filter((l) => l.contentId === contentId).length;
  }

  public async getBookmark(
    userId: number,
    contentId: number,
  ): Promise<ContentBookmark | null> {
    return (
      this.bookmarks.find(
        (b) => b.userId === userId && b.contentId === contentId,
      ) ?? null
    );
  }

  public async createBookmark(bookmark: ContentBookmark): Promise<boolean> {
    if (await this.getBookmark(bookmark.userId, bookmark.contentId)) {
      return false;
    }
    this.bookmarks.push({ ...bookmark });
    return true;
  }

  public async deleteBookmark(
    userId: number,
    contentId: number,
  ): Promise<boolean> {
    const before = this.bookmarks.length;
    this.bookmarks = this.bookmarks.filter(
      (b) => !(b.userId === userId && b.contentId === contentId),
    );
    return this.bookmarks.length < before;
  }

  public async getBookmarksByUserId(
    userId: number,
  ): Promise<ContentBookmark[]> {
    return this.bookmarks
      .filter((b) => b.userId === userId)
      .map((b) => ({ ...b }));
  }

  public async countBookmarksByUserId(userId: number): Promise<number> {
    return this.bookmarks.filter((b) => b.userId === userId).length;
  }

  // ICommentRepository
  public async getCommentById(id: number): Promise<CommentItem | null> {
    const found = this.comments.find((c) => c.id === id);
    return found ? { ...found } : null;
  }

  public async getCommentsByContentId(
    contentId: number,
  ): Promise<CommentItem[]> {
    return this.comments
      .filter((c) => c.contentId === contentId)
      .map((c) => ({ ...c }));
  }

  public async getCommentsByUserId(userId: number): Promise<CommentItem[]> {
    return this.comments
      .filter((c) => c.userId === userId)
      .map((c) => ({ ...c }));
  }

  public async getCommentsByStatus(
    status: CommentStatus,
  ): Promise<CommentItem[]> {
    return this.comments
      .filter((c) => c.status === status)
      .map((c) => ({ ...c }));
  }

  public async getAllComments(): Promise<CommentItem[]> {
    return this.comments.map((c) => ({ ...c }));
  }

  public async createComment(
    comment: Omit<CommentItem, 'id'>,
  ): Promise<CommentItem> {
    const created: CommentItem = { ...comment, id: ++this.seq.comment };
    this.comments.push(created);
    return { ...created };
  }

  public async updateComment(comment: CommentItem): Promise<void> {
    this.comments = this.comments.map((c) =>
      c.id === comment.id ? { ...comment } : c,
    );
  }

  public async deleteComment(id: number): Promise<void> {
    this.comments = this.comments.filter((c) => c.id !== id);
  }

  public async getReportById(id: number): Promise<CommentReport | null> {
    const found = this.commentReports.find((r) => r.id === id);
    return found ? { ...found } : null;
  }

  public async getReportByCommentAndUser(
    commentId: number,
    userId: number,
  ): Promise<CommentReport | null> {
    const found = this.commentReports.find(
      (r) => r.commentId === commentId && r.userId === userId,
    );
    return found ? { ...found } : null;
  }

  public async getReportsByCommentId(
    commentId: number,
  ): Promise<CommentReport[]> {
    return this.commentReports
      .filter((r) => r.commentId === commentId)
      .map((r) => ({ ...r }));
  }

  public async getAllReports(): Promise<CommentReport[]> {
    return this.commentReports.map((r) => ({ ...r }));
  }

  public async createReport(
    report: Omit<CommentReport, 'id'>,
  ): Promise<CommentReport> {
    const created: CommentReport = { ...report, id: ++this.seq.report };
    this.commentReports.push(created);
    return { ...created };
  }

  public async deleteReport(id: number): Promise<void> {
    this.commentReports = this.commentReports.filter((r) => r.id !== id);
  }

  public async deleteReportsByCommentId(commentId: number): Promise<number> {
    const before = this.commentReports.length;
    this.commentReports = this.commentReports.filter(
      (r) => r.commentId !== commentId,
    );
    return before - this.commentReports.length;
  }

  public async getAllBlockedWords(): Promise<BlockedWord[]> {
    return this.blockedWords.map((w) => ({ ...w }));
  }

  public async getBlockedWordById(id: number): Promise<BlockedWord | null> {
    const found = this.blockedWords.find((w) => w.id === id);
    return found ? { ...found } : null;
  }

  public async getBlockedWordByNormalizedWord(
    normalizedWord: string,
  ): Promise<BlockedWord | null> {
    const found = this.blockedWords.find((w) => w.word === normalizedWord);
    return found ? { ...found } : null;
  }

  public async createBlockedWord(
    entry: Omit<BlockedWord, 'id'>,
  ): Promise<BlockedWord> {
    const created: BlockedWord = { ...entry, id: ++this.seq.blocked };
    this.blockedWords.push(created);
    return { ...created };
  }

  public async deleteBlockedWord(id: number): Promise<void> {
    this.blockedWords = this.blockedWords.filter((w) => w.id !== id);
  }

  // IContentRequestRepository
  public async getContentRequestById(
    id: number,
  ): Promise<ContentRequestItem | null> {
    const found = this.contentRequests.find((r) => r.id === id);
    return found ? { ...found } : null;
  }

  public async getContentRequestsByUserId(
    userId: number,
  ): Promise<ContentRequestItem[]> {
    return this.contentRequests
      .filter((r) => r.userId === userId)
      .map((r) => ({ ...r }));
  }

  public async getAllContentRequests(): Promise<ContentRequestItem[]> {
    return this.contentRequests.map((r) => ({ ...r }));
  }

  public async createContentRequest(
    request: Omit<ContentRequestItem, 'id'>,
  ): Promise<ContentRequestItem> {
    const created: ContentRequestItem = { ...request, id: ++this.seq.request };
    this.contentRequests.push(created);
    return { ...created };
  }

  public async updateContentRequest(request: ContentRequestItem): Promise<void> {
    this.contentRequests = this.contentRequests.map((r) =>
      r.id === request.id ? { ...request } : r,
    );
  }

  public async deleteContentRequest(id: number): Promise<void> {
    this.contentRequests = this.contentRequests.filter((r) => r.id !== id);
  }

  // ILayoutRepository
  public async getAllHeroSlides(): Promise<HeroSlide[]> {
    return this.heroSlides.map((s) => ({ ...s }));
  }

  public async getHeroSlideById(id: number): Promise<HeroSlide | null> {
    return this.heroSlides.find((s) => s.id === id) ?? null;
  }

  public async createHeroSlide(
    slide: Omit<HeroSlide, 'id'>,
  ): Promise<HeroSlide> {
    const created: HeroSlide = { ...slide, id: ++this.seq.slide };
    this.heroSlides.push(created);
    return { ...created };
  }

  public async updateHeroSlide(slide: HeroSlide): Promise<HeroSlide> {
    this.heroSlides = this.heroSlides.map((s) =>
      s.id === slide.id ? { ...slide } : s,
    );
    return { ...slide };
  }

  public async deleteHeroSlide(id: number): Promise<void> {
    this.heroSlides = this.heroSlides.filter((s) => s.id !== id);
  }

  public async getAllHomeShelves(): Promise<HomeShelf[]> {
    return this.homeShelves.map((s) => ({ ...s }));
  }

  public async getHomeShelfById(id: number): Promise<HomeShelf | null> {
    return this.homeShelves.find((s) => s.id === id) ?? null;
  }

  public async createHomeShelf(
    shelf: Omit<HomeShelf, 'id'>,
  ): Promise<HomeShelf> {
    const created: HomeShelf = { ...shelf, id: ++this.seq.shelf };
    this.homeShelves.push(created);
    return { ...created };
  }

  public async updateHomeShelf(shelf: HomeShelf): Promise<HomeShelf> {
    this.homeShelves = this.homeShelves.map((s) =>
      s.id === shelf.id ? { ...shelf } : s,
    );
    return { ...shelf };
  }

  public async deleteHomeShelf(id: number): Promise<void> {
    this.homeShelves = this.homeShelves.filter((s) => s.id !== id);
  }

  public async getAllStaticPages(): Promise<StaticPage[]> {
    return this.staticPages.map((p) => ({ ...p }));
  }

  public async getStaticPageById(id: number): Promise<StaticPage | null> {
    return this.staticPages.find((p) => p.id === id) ?? null;
  }

  public async getStaticPageBySlug(slug: string): Promise<StaticPage | null> {
    return this.staticPages.find((p) => p.slug === slug) ?? null;
  }

  public async createStaticPage(
    page: Omit<StaticPage, 'id'>,
  ): Promise<StaticPage> {
    const created: StaticPage = { ...page, id: ++this.seq.staticPage };
    this.staticPages.push(created);
    return { ...created };
  }

  public async updateStaticPage(page: StaticPage): Promise<StaticPage> {
    this.staticPages = this.staticPages.map((p) =>
      p.id === page.id ? { ...page } : p,
    );
    return { ...page };
  }

  public async deleteStaticPage(id: number): Promise<void> {
    this.staticPages = this.staticPages.filter((p) => p.id !== id);
  }

  // IBackupLogRepository & IBackupStorage & IBackupSnapshotProvider
  public async createBackupLogAsync(
    entry: Omit<BackupLog, 'id'>,
  ): Promise<BackupLog> {
    const created: BackupLog = { ...entry, id: ++this.seq.backupLog };
    this.backupLogs.push(created);
    return { ...created };
  }

  public async updateBackupLogAsync(entry: BackupLog): Promise<void> {
    this.backupLogs = this.backupLogs.map((l) =>
      l.id === entry.id ? { ...entry } : l,
    );
  }

  public async getBackupLogByIdAsync(id: number): Promise<BackupLog | null> {
    const found = this.backupLogs.find((l) => l.id === id);
    return found ? { ...found } : null;
  }

  public async listBackupLogsAsync(): Promise<BackupLog[]> {
    return this.backupLogs.map((l) => ({ ...l }));
  }

  public async saveArchiveAsync(
    filePath: string,
    payloadText: string,
  ): Promise<{ sizeBytes: number }> {
    const sizeBytes = new TextEncoder().encode(payloadText).byteLength;
    this.backupArchives.set(filePath, { payloadText, sizeBytes });
    return { sizeBytes };
  }

  public async readArchiveAsync(filePath: string): Promise<string | null> {
    return this.backupArchives.get(filePath)?.payloadText ?? null;
  }

  public async deleteArchiveAsync(filePath: string): Promise<void> {
    this.backupArchives.delete(filePath);
  }

  public async listArchivePathsAsync(): Promise<string[]> {
    return Array.from(this.backupArchives.keys());
  }

  public async exportFullSnapshotAsync(): Promise<ExportedDatabaseSnapshot> {
    return {
      databaseVersion: this.databaseVersion,
      tables: {
        [STORE_NAMES.USERS]: JSON.parse(JSON.stringify(this.users)) as unknown[],
        [STORE_NAMES.TOPICS]: JSON.parse(JSON.stringify(this.topics)) as unknown[],
        [STORE_NAMES.CONTENT_ITEMS]: JSON.parse(
          JSON.stringify(this.contents),
        ) as unknown[],
        [STORE_NAMES.COMMENTS]: JSON.parse(
          JSON.stringify(this.comments),
        ) as unknown[],
        [STORE_NAMES.CONTENT_REQUESTS]: JSON.parse(
          JSON.stringify(this.contentRequests),
        ) as unknown[],
      },
      storedFiles: await this.fileStorage.exportBackupEntriesAsync(),
    };
  }

  public async restoreIntoSandboxDatabaseAsync(
    snapshot: BackupSnapshotFile,
  ): Promise<BackupRestoreReport> {
    this.sandboxSnapshot = JSON.parse(
      JSON.stringify(snapshot),
    ) as BackupSnapshotFile;
    const tables = this.sandboxSnapshot.tables;
    const recordsCount = Object.values(tables).reduce(
      (sum, rows) => sum + rows.length,
      0,
    );
    return {
      ok: true,
      targetDatabaseName: RESTORE_SANDBOX_DB_NAME,
      restoredTablesCount: Object.keys(tables).length,
      restoredRecordsCount: recordsCount,
      restoredFilesCount: this.sandboxSnapshot.storedFiles.length,
      verifiedContentsCount: (tables[STORE_NAMES.CONTENT_ITEMS] ?? []).length,
      verifiedUsersCount: (tables[STORE_NAMES.USERS] ?? []).length,
      verifiedTopicsCount: (tables[STORE_NAMES.TOPICS] ?? []).length,
      durationMs: 1,
      errors: [],
    };
  }

  public async restoreIntoPrimaryDatabaseAsync(
    snapshot: BackupSnapshotFile,
  ): Promise<BackupRestoreReport> {
    const tables = JSON.parse(
      JSON.stringify(snapshot.tables),
    ) as Record<string, unknown[]>;
    const recordsCount = Object.values(tables).reduce(
      (sum, rows) => sum + rows.length,
      0,
    );
    return {
      ok: true,
      targetDatabaseName: envConfig.databaseName,
      restoredTablesCount: Object.keys(tables).length,
      restoredRecordsCount: recordsCount,
      restoredFilesCount: snapshot.storedFiles.length,
      verifiedContentsCount: (tables[STORE_NAMES.CONTENT_ITEMS] ?? []).length,
      verifiedUsersCount: (tables[STORE_NAMES.USERS] ?? []).length,
      verifiedTopicsCount: (tables[STORE_NAMES.TOPICS] ?? []).length,
      durationMs: 1,
      errors: [],
    };
  }
}

function makeSamplePngBytes(): Uint8Array {
  return new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
    0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
    0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53, 0xde,
  ]);
}

function makeSamplePdfBytes(): Uint8Array {
  return new TextEncoder().encode(
    '%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n',
  );
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

export const stage22Tests: UnitTestCase[] = [
  {
    id: 'stage22_phase1_e2e_smoke',
    nameKey: 'tests.stage22.phase1E2eSmoke.name',
    descriptionKey: 'tests.stage22.phase1E2eSmoke.desc',
    run: async () => {
      const clock = new Stage22FakeClock();
      const logger = new AppLogger(clock, 'stage22_smoke_logs_unused', 100);
      logger.clearLogs();

      const h = new Stage22MemoryHarness(clock);
      const searchNormalizer = new SearchNormalizer();
      const policyService = new PermissionPolicyService(h, logger);
      const fileUploadService = new FileUploadService(
        h.fileStorage,
        h,
        policyService,
        logger,
      );
      const contentManagement = new ContentManagementService(
        h,
        h,
        policyService,
        fileUploadService,
        searchNormalizer,
        clock,
        logger,
      );
      const contentCatalog = new ContentCatalogService(
        h,
        h,
        h,
        searchNormalizer,
      );
      const contentDetail = new ContentDetailService(h, h, h.fileStorage);
      const viewTracker = new ViewTrackerService(
        h,
        h,
        clock,
        logger,
        h,
        undefined,
      );
      const downloadService = new DownloadService(
        h,
        h,
        h.fileStorage,
        new HmacDownloadTokenProtector(),
        clock,
        logger,
      );
      const interactionService = new InteractionService(
        h,
        h,
        h,
        clock,
        logger,
      );
      const commentService = new CommentService({
        commentRepository: h,
        contentRepository: h,
        adminRepository: h,
        taxonomyRepository: h,
        permissionPolicyService: policyService,
        searchNormalizer,
        clock,
        logger,
      });
      const requestService = new ContentRequestService({
        contentRequestRepository: h,
        contentRepository: h,
        adminRepository: h,
        taxonomyRepository: h,
        permissionPolicyService: policyService,
        searchNormalizer,
        clock,
        logger,
      });
      const dashboardService = new AnalyticsDashboardService({
        viewEventRepository: h,
        downloadEventRepository: h,
        contentRepository: h,
        permissionPolicyService: policyService,
        clock,
        logger,
      });
      const backupService = new BackupService({
        backupLogRepository: h,
        backupStorage: h,
        snapshotProvider: h,
        permissionPolicyService: policyService,
        clock,
        logger,
      });

      try {
        const adultAge = h.getAgeGroupByKey('adult');
        const childAge = h.getAgeGroupByKey('child');

        // Step 1: Real users + Topic
        const superAdmin = await h.seedUserAsync({
          email: 'superadmin-s22@meraj.ir',
          displayName: 'مدیر کل دودی',
          role: 'SuperAdmin',
          ageGroupId: adultAge.id,
        });
        const adultMember = await h.seedUserAsync({
          email: 'adult-s22@meraj.ir',
          displayName: 'پژوهشگر بزرگسال',
          role: 'Member',
          ageGroupId: adultAge.id,
        });
        const childMember = await h.seedUserAsync({
          email: 'child-s22@meraj.ir',
          displayName: 'دوست کوچک',
          role: 'Member',
          ageGroupId: childAge.id,
        });
        const rootTopic = await h.createTopic({
          name: 'حکمت و فلسفه اسلامی',
          slug: 'philosophy',
          parentId: null,
          icon: null,
          sortOrder: 1,
          isActive: true,
        });

        // Step 2: Upload real thumbnail & PDF + create & publish Adult-only content
        const thumbRes = await contentManagement.uploadThumbnailAsync(superAdmin, {
          originalFileName: 'cover.png',
          bytes: makeSamplePngBytes(),
        });
        assert(
          thumbRes.ok && thumbRes.data,
          'Thumbnail upload must succeed in Phase 1 smoke test',
        );
        const docRes = await contentManagement.uploadContentFileAsync(superAdmin, {
          originalFileName: 'handbook.pdf',
          bytes: makeSamplePdfBytes(),
        });
        assert(
          docRes.ok && docRes.data,
          'Attachment PDF upload must succeed in Phase 1 smoke test',
        );

        const draftRes = await contentManagement.saveDraft(superAdmin, {
          title: 'مبانی معرفت شناسی و کتابشناسی پژوهش',
          summary: 'خلاصه جامع درباره معرفت شناسی و روش تحقیق علمی در متون اسلامی',
          body: '<p>متن پژوهشی کامل درباره کتاب و اندیشه</p>',
          format: 'Pdf',
          impactLevelId: 1,
          readWatchMinutes: 12,
          thumbnailKey: thumbRes.data!.storageKey,
          isFeatured: true,
          sources: [
            {
              title: 'پژوهشنامه فلسفه',
              url: 'https://example.org/philosophy',
              sortOrder: 1,
            },
          ],
          files: [
            {
              kind: ContentFileKind.Main,
              storageType: FileStorageType.Local,
              storageKey: docRes.data!.storageKey,
              externalUrl: null,
              originalFileName: 'handbook.pdf',
              mimeType: 'application/pdf',
              sizeBytes: docRes.data!.sizeBytes,
              isDownloadable: true,
              sortOrder: 1,
            },
          ],
          topicIds: [rootTopic.id],
          tagIds: [],
          personIds: [],
          ageGroupIds: [adultAge.id],
        });
        assert(
          draftRes.ok && draftRes.data,
          'Draft save must succeed in Phase 1 smoke test',
        );

        const pubRes = await contentManagement.publishContent(
          superAdmin,
          draftRes.data!.item.id,
        );
        assert(
          pubRes.ok && pubRes.data && pubRes.data.item.status === ContentStatus.Published,
          'Publishing full content must succeed',
        );
        const published = pubRes.data!;

        // Child age filter must block Adult-only content on catalog and detail
        const childCatalog = await contentCatalog.queryCatalogAsync({
          activeAgeGroup: childAge,
        });
        assertEqual(
          childCatalog.result.totalCount,
          0,
          'Child age profile must receive 0 adult-only contents in catalog',
        );
        const childDetail = await contentDetail.getPublicContentDetailAsync(
          published.item.slug,
          childAge,
        );
        assertEqual(
          childDetail.status,
          'not_found',
          'Child age profile must get not_found (404) on adult-only content detail',
        );

        // Step 3: Normalized Persian search with Arabic yeh ('ي') & kaf ('ك')
        const searchRes = await contentCatalog.queryCatalogAsync({
          query: 'كتابشناسي',
          activeAgeGroup: adultAge,
        });
        assertEqual(
          searchRes.result.totalCount,
          1,
          'Normalized Persian search must match Arabic yeh/kaf query',
        );

        // Step 4: View tracking (count 1st, deduplicate 2nd within 30 min)
        const v1 = await viewTracker.trackViewAsync({
          contentId: published.item.id,
          userId: adultMember.id,
          visitorId: 's22-adult-visitor',
          userAgent: 'Mozilla/5.0',
          ageGroupId: adultAge.id,
          primaryTopicId: rootTopic.id,
        });
        assertEqual(v1.isCounted, true, 'First view must be counted');

        clock.advanceMinutes(10);
        const v2 = await viewTracker.trackViewAsync({
          contentId: published.item.id,
          userId: adultMember.id,
          visitorId: 's22-adult-visitor',
          userAgent: 'Mozilla/5.0',
          ageGroupId: adultAge.id,
          primaryTopicId: rootTopic.id,
        });
        assertEqual(
          v2.isCounted,
          false,
          'Duplicate view within 30 min must not be counted',
        );

        // Step 5: Signed download link + execution
        const linkRes = await downloadService.createSignedDownloadLinkAsync({
          currentUser: adultMember,
          contentId: published.item.id,
          fileId: published.files[0].id,
          activeAgeGroup: adultAge,
        });
        assert(linkRes.ok, 'Creating signed download link must succeed');
        if (!linkRes.ok) {
          throw new Error('Expected signed download link');
        }
        const dlRes = await downloadService.executeSignedDownloadAsync({
          token: linkRes.token,
          currentUser: adultMember,
          activeAgeGroup: adultAge,
        });
        assert(dlRes.ok, 'Executing signed download must succeed');

        // Step 6: Like & Bookmark
        const likeRes = await interactionService.toggleLikeAsync(
          adultMember,
          published.item.id,
        );
        assert(likeRes.ok && likeRes.liked && likeRes.likeCount === 1, 'Like must succeed');
        const bmRes = await interactionService.toggleBookmarkAsync(
          adultMember,
          published.item.id,
        );
        assert(bmRes.ok && bmRes.bookmarked, 'Bookmark must succeed');

        // Step 7: Comments (Adult immediate Published; Child Pending if eligible)
        const adultCommentRes = await commentService.submitCommentAsync(
          adultMember,
          published.item.id,
          'بسیار مقاله دقیق و ارزشمندی بود.',
        );
        assert(
          adultCommentRes.ok &&
            adultCommentRes.comment?.status === CommentStatus.Published,
          'Adult clean comment must be Published immediately',
        );

        // Create an all-ages content to verify Child author Pending moderation
        const childDocRes = await contentManagement.uploadContentFileAsync(superAdmin, {
          originalFileName: 'story.pdf',
          bytes: makeSamplePdfBytes(),
        });
        assert(childDocRes.ok && childDocRes.data, 'Child story file upload must succeed');
        const storyDraft = await contentManagement.saveDraft(superAdmin, {
          title: 'داستان کوتاه علمی برای همه',
          summary: 'قصه علمی مناسب کودکان و نوجوانان',
          body: '<p>قصه کوتاه</p>',
          format: 'Article',
          thumbnailKey: thumbRes.data!.storageKey,
          isFeatured: false,
          sources: [{ title: 'کتاب کودک', sortOrder: 1 }],
          files: [],
          topicIds: [rootTopic.id],
          tagIds: [],
          personIds: [],
          ageGroupIds: [],
        });
        assert(storyDraft.ok && storyDraft.data, 'All-ages story draft must save');
        const storyPub = await contentManagement.publishContent(
          superAdmin,
          storyDraft.data!.item.id,
        );
        assert(storyPub.ok && storyPub.data, 'All-ages story publish must succeed');
        const childCommentRes = await commentService.submitCommentAsync(
          childMember,
          storyPub.data!.item.id,
          'خیلی جالب و قشنگ بود!',
        );
        assert(
          childCommentRes.ok &&
            childCommentRes.comment?.status === CommentStatus.Pending &&
            childCommentRes.comment.moderationReason === 'child_author',
          'Child comment must enter Pending moderation queue',
        );

        // Step 8: Content Request submit -> Done linked to published content
        const reqSubmit = await requestService.submitContentRequestAsync(
          adultMember,
          {
            title: 'درخواست کتابنامه معرفت شناسی',
            description: 'لطفاً فایل کتابنامه روش پژوهش منتشر شود.',
          },
        );
        assert(reqSubmit.ok && reqSubmit.request, 'Content request submit must succeed');
        const reqDone = await requestService.updateContentRequestByAdminAsync(
          superAdmin,
          reqSubmit.request!.id,
          {
            status: ContentRequestStatus.Done,
            adminNote: 'منتشر و پیوند داده شد.',
            linkedContentId: published.item.id,
          },
        );
        assert(
          reqDone.ok &&
            reqDone.request?.status === ContentRequestStatus.Done &&
            reqDone.request.linkedContentId === published.item.id,
          'Admin updating request to Done with linked content must succeed',
        );

        // Step 9: Analytics Dashboard reflects 1 counted view & 1 download
        const dashRes = await dashboardService.getBasicDashboardStatsAsync(
          superAdmin,
          { preset: '30d' },
        );
        assert(dashRes.ok, 'Analytics dashboard must load for SuperAdmin');
        if (!dashRes.ok) {
          throw new Error('Expected dashboard stats');
        }
        assertEqual(
          dashRes.data.summary.totalCountedViews,
          1,
          'Dashboard must show 1 counted view',
        );
        assertEqual(
          dashRes.data.summary.totalDownloads,
          1,
          'Dashboard must show 1 download event',
        );

        // Step 10: Backup + Sandbox Restore verification
        const backupRun = await backupService.runBackupAsync(superAdmin, 'Manual');
        assert(
          backupRun.ok && backupRun.backupLog,
          'Manual backup in smoke test must succeed',
        );
        const sandboxRes = await backupService.testRestoreOnSandboxAsync(
          superAdmin,
          { backupLogId: backupRun.backupLog!.id },
        );
        assert(
          sandboxRes.ok &&
            sandboxRes.report &&
            sandboxRes.report.targetDatabaseName === RESTORE_SANDBOX_DB_NAME &&
            sandboxRes.report.verifiedContentsCount === 2,
          'Sandbox restore test must verify both published contents cleanly',
        );
      } finally {
        logger.clearLogs();
      }
    },
  },
  {
    id: 'stage22_sitemap_published_only',
    nameKey: 'tests.stage22.sitemapPublishedOnly.name',
    descriptionKey: 'tests.stage22.sitemapPublishedOnly.desc',
    run: async () => {
      const clock = new Stage22FakeClock('2026-11-24T10:00:00.000Z');
      const h = new Stage22MemoryHarness(clock);

      await h.createStaticPage({
        slug: 'about',
        title: 'درباره ما',
        body: '<p>معراج اندیشه</p>',
        showInFooter: true,
        sortOrder: 1,
      });

      await h.createContentItem({
        title: 'محتوای منتشرشده فارسی',
        slug: 'مسیر-علم-و-اندیشه',
        summary: 'خلاصه',
        body: '<p>متن</p>',
        format: 'Article',
        impactLevelId: 1,
        status: ContentStatus.Published,
        publishedAt: '2026-11-22T12:00:00.000Z',
        readWatchMinutes: 5,
        thumbnailKey: null,
        isFeatured: false,
        languageCode: 'fa',
        searchText: 'محتوای منتشرشده فارسی',
        viewCount: 0,
        downloadCount: 0,
        likeCount: 0,
        createdById: 1,
        createdAt: '2026-11-22T12:00:00.000Z',
        updatedAt: '2026-11-23T12:00:00.000Z',
      });

      await h.createContentItem({
        title: 'پیش‌نویس محرمانه',
        slug: 'secret-draft-item',
        summary: 'خلاصه',
        body: '<p>متن</p>',
        format: 'Article',
        impactLevelId: 1,
        status: ContentStatus.Draft,
        publishedAt: null,
        readWatchMinutes: 3,
        thumbnailKey: null,
        isFeatured: false,
        languageCode: 'fa',
        searchText: 'پیش نویس محرمانه',
        viewCount: 0,
        downloadCount: 0,
        likeCount: 0,
        createdById: 1,
        createdAt: '2026-11-23T12:00:00.000Z',
        updatedAt: '2026-11-23T12:00:00.000Z',
      });

      await h.createContentItem({
        title: 'آرشیوشده قدیمی',
        slug: 'old-archived-item',
        summary: 'خلاصه',
        body: '<p>متن</p>',
        format: 'Article',
        impactLevelId: 1,
        status: ContentStatus.Archived,
        publishedAt: '2026-10-01T12:00:00.000Z',
        readWatchMinutes: 3,
        thumbnailKey: null,
        isFeatured: false,
        languageCode: 'fa',
        searchText: 'آرشیوشده قدیمی',
        viewCount: 0,
        downloadCount: 0,
        likeCount: 0,
        createdById: 1,
        createdAt: '2026-10-01T12:00:00.000Z',
        updatedAt: '2026-10-01T12:00:00.000Z',
      });

      const sitemapService = new SitemapService({
        contentRepository: h,
        layoutRepository: h,
        clock,
      });

      const result = await sitemapService.generateSitemapXmlAsync(
        'https://example.github.io/meraj',
      );

      assert(
        result.xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>'),
        'Sitemap must start with XML declaration',
      );
      assert(
        result.xml.includes('<loc>https://example.github.io/meraj/#/</loc>'),
        'Sitemap must contain home route',
      );
      assert(
        result.xml.includes('<loc>https://example.github.io/meraj/#/content</loc>'),
        'Sitemap must contain content catalog route',
      );
      assert(
        result.xml.includes('<loc>https://example.github.io/meraj/#/p/about</loc>'),
        'Sitemap must contain public static page',
      );
      assert(
        result.xml.includes(encodeURIComponent('مسیر-علم-و-اندیشه')),
        'Sitemap must include encoded slug of Published content',
      );
      assert(
        result.xml.includes('<lastmod>2026-11-23</lastmod>'),
        'Sitemap must include ISO date lastmod',
      );
      assertEqual(
        result.publishedContentsCount,
        1,
        'Only 1 Published content must be included',
      );
      assertEqual(
        result.staticPagesCount,
        1,
        'Static page count must match',
      );

      const forbiddenSubstrings = [
        'secret-draft-item',
        'old-archived-item',
        '#/admin',
        '#/account',
        '#/download',
        '#/setup',
        '#/health',
        '#/dev',
        '#/error',
      ];
      for (const forbidden of forbiddenSubstrings) {
        assert(
          !result.xml.includes(forbidden),
          `Sitemap must NOT include ${forbidden}`,
        );
      }
    },
  },
  {
    id: 'stage22_robots_meta_and_csp_audit',
    nameKey: 'tests.stage22.robotsMetaAndCspAudit.name',
    descriptionKey: 'tests.stage22.robotsMetaAndCspAudit.desc',
    run: async () => {
      const noindexRoutes = [
        '#/admin/content',
        '#/admin/dashboard',
        '#/account/login',
        '#/account/profile',
        '#/download/signed-token',
        '#/setup/initial-admin',
        '#/health',
        '#/dev/components',
        '#/error/500',
      ];
      for (const route of noindexRoutes) {
        assertEqual(
          getRobotsMetaForRoute(route),
          'noindex, nofollow',
          `Private/admin/system route ${route} must get noindex, nofollow`,
        );
      }

      const indexRoutes = [
        '#/',
        '#/content',
        '#/content/sample-slug',
        '#/search?q=book',
        '#/p/about',
      ];
      for (const route of indexRoutes) {
        assertEqual(
          getRobotsMetaForRoute(route),
          'index, follow',
          `Public route ${route} must get index, follow`,
        );
      }

      const validCsp = validateCspPolicy(PRODUCTION_CSP_POLICY);
      assert(
        validCsp.isValid,
        `Production CSP policy must pass audit (issues: ${validCsp.issues.join(',')})`,
      );

      const externalCdnCsp = validateCspPolicy(
        "default-src 'self'; script-src 'self' https://cdn.example.com; style-src 'self'; img-src 'self'; media-src 'self'; font-src 'self'; connect-src 'self'; frame-src 'self'; object-src 'none'; base-uri 'self'",
      );
      assertEqual(
        externalCdnCsp.isValid,
        false,
        'CSP allowing external script CDN must fail audit',
      );

      const unsafeEvalCsp = validateCspPolicy(
        "default-src 'self'; script-src 'self' 'unsafe-eval'; style-src 'self'; img-src 'self'; media-src 'self'; font-src 'self'; connect-src 'self'; frame-src 'self'; object-src 'none'; base-uri 'self'",
      );
      assertEqual(
        unsafeEvalCsp.isValid,
        false,
        'CSP allowing unsafe-eval must fail audit',
      );

      const cdnAuditResult = auditDocumentExternalCdnUrls(
        [
          './assets/main.js',
          '/src/main.tsx',
          'https://ais-dev-abc.europe-west2.run.app/assets/app.js',
          'https://aistudio.google.com/bridge.js',
          'https://www.gstatic.com/preview.js',
          'https://fonts.googleapis.com/css2?family=Vazirmatn',
          'https://cdn.jsdelivr.net/npm/foo.js',
          'https://fonts.gstatic.com/s/font.woff2',
        ],
        'ais-dev-abc.europe-west2.run.app',
      );
      assertEqual(
        cdnAuditResult.length,
        3,
        'External CDN audit must ignore same-origin & preview bridge URLs while flagging all 3 external CDNs',
      );
      assert(
        cdnAuditResult.includes('https://fonts.googleapis.com/css2?family=Vazirmatn') &&
          cdnAuditResult.includes('https://cdn.jsdelivr.net/npm/foo.js') &&
          cdnAuditResult.includes('https://fonts.gstatic.com/s/font.woff2'),
        'External CDN audit must report exact third-party CDN URLs',
      );

      const validRobots = validateRobotsTxtContent(
        'User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /setup\nDisallow: /account\nDisallow: /download\nSitemap: ./sitemap.xml\n',
      );
      assert(
        validRobots.isValid,
        `Valid robots.txt must pass validation (missing: ${validRobots.missingDirectives.join(',')})`,
      );

      const invalidRobots = validateRobotsTxtContent(
        'User-agent: *\nAllow: /\nDisallow: /setup\n',
      );
      assertEqual(
        invalidRobots.isValid,
        false,
        'robots.txt missing Disallow: /admin and Sitemap must fail validation',
      );
      assert(
        invalidRobots.missingDirectives.includes('Disallow: /admin') &&
          invalidRobots.missingDirectives.includes('Sitemap'),
        'robots.txt validator must list missing directives',
      );
    },
  },
  {
    id: 'stage22_safe_error_report_500',
    nameKey: 'tests.stage22.safeErrorReport500.name',
    descriptionKey: 'tests.stage22.safeErrorReport500.desc',
    run: async () => {
      const clock = new Stage22FakeClock('2026-11-24T10:30:00.000Z');
      const logger = new AppLogger(clock, 'stage22_err_logs_unused', 20);
      logger.clearLogs();

      try {
        const sensitiveErr = new Error(
          'INTERNAL_SQL_SECRET_LEAK at Object.<anonymous> (/src/secret.ts:42)',
        );

        const prodReport = buildSafeErrorReport(
          sensitiveErr,
          false,
          clock,
          logger,
        );
        assert(
          /^MA-ERR-20261124-[0-9A-F]{4}$/.test(prodReport.errorId),
          'Error ID must follow MA-ERR-YYYYMMDD-XXXX format',
        );
        assertEqual(
          prodReport.safeMessageKey,
          'error500.safeBody',
          'Safe error report must use public error500.safeBody key',
        );
        assertEqual(
          prodReport.technicalDetails,
          null,
          'Production 500 report MUST hide technicalDetails (null)',
        );
        assertEqual(
          prodReport.isDevelopment,
          false,
          'Production report flag must be false',
        );

        const recordedLogs = logger.getLogs();
        assert(
          recordedLogs.length >= 1 && recordedLogs[0].level === 'ERROR',
          'Error report must log an ERROR entry with errorId',
        );

        const devReport = buildSafeErrorReport(
          sensitiveErr,
          true,
          clock,
          logger,
        );
        assert(
          typeof devReport.technicalDetails === 'string' &&
            devReport.technicalDetails.includes('INTERNAL_SQL_SECRET_LEAK'),
          'Development 500 report must expose technicalDetails for debugging',
        );
      } finally {
        logger.clearLogs();
      }
    },
  },
  {
    id: 'stage22_build_and_phase1_readiness',
    nameKey: 'tests.stage22.buildAndPhase1Readiness.name',
    descriptionKey: 'tests.stage22.buildAndPhase1Readiness.desc',
    run: async () => {
      assert(
        envConfig.stageNumber >= 22,
        `envConfig.stageNumber must be >= 22 (actual=${envConfig.stageNumber})`,
      );
      assert(
        envConfig.databaseVersion >= 14,
        `envConfig.databaseVersion must be >= 14 (actual=${envConfig.databaseVersion})`,
      );
      assert(
        DATABASE_MIGRATIONS.some((m) => m.version === 14),
        'DATABASE_MIGRATIONS must include version 14',
      );

      if (typeof indexedDB !== 'undefined') {
        const tempDbName = `MerajStage22_Readiness_${Date.now()}`;
        const store = new IndexedDbDataStore(
          tempDbName,
          envConfig.databaseVersion,
          envConfig.metaStoreName,
        );
        try {
          await store.connect();
          const storeNames = await store.getObjectStoreNames();
          const requiredPhase1Stores = [
            STORE_NAMES.META,
            STORE_NAMES.USERS,
            STORE_NAMES.CONTENT_ITEMS,
            STORE_NAMES.TOPICS,
            STORE_NAMES.VIEW_EVENTS,
            STORE_NAMES.DOWNLOAD_EVENTS,
            STORE_NAMES.LIKES,
            STORE_NAMES.BOOKMARKS,
            STORE_NAMES.COMMENTS,
            STORE_NAMES.CONTENT_REQUESTS,
            STORE_NAMES.HERO_SLIDES,
            STORE_NAMES.HOME_SHELVES,
            STORE_NAMES.STATIC_PAGES,
            STORE_NAMES.USER_TOPIC_AFFINITIES,
            STORE_NAMES.BACKUP_LOGS,
            STORE_NAMES.BACKUP_ARCHIVES,
          ];
          for (const storeName of requiredPhase1Stores) {
            assert(
              storeNames.includes(storeName),
              `Phase 1 IndexedDB store missing: ${storeName}`,
            );
          }
          store.close();
        } finally {
          await deleteTempDatabaseAsync(tempDbName);
        }
      }
    },
  },
];
