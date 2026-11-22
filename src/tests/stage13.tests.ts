import type { IClock } from '../core/abstractions/IClock';
import type { IContentRepository } from '../core/abstractions/contentRepository';
import type { IFileStorage } from '../core/abstractions/fileStorage';
import type { ITaxonomyRepository } from '../core/abstractions/taxonomyRepository';
import type { IViewEventRepository } from '../core/abstractions/viewTracker';
import type { ViewEvent } from '../core/domain/analytics';
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
import type { FileSaveRequest, StoredFileMetadata } from '../core/domain/storage';
import type { AgeGroup, ImpactLevel, Person, Tag, Topic } from '../core/domain/taxonomy';
import {
  ContentDetailService,
  getRelatedContents,
} from '../core/services/contentDetailService';
import { resolveAparatEmbedUrl } from '../core/services/externalLinkService';
import {
  extractNormalizedExtension,
  getCategoryForExtension,
  getMimeTypeForExtension,
} from '../core/services/fileValidationService';
import { SearchNormalizer } from '../core/services/searchNormalizer';
import {
  isKnownBotUserAgent,
  resolveRootTopicId,
  ViewTrackerService,
} from '../core/services/viewTrackerService';
import { SystemClock } from '../infrastructure/clock/SystemClock';
import { envConfig } from '../infrastructure/config/envConfig';
import { IndexedDbAuthRepository } from '../infrastructure/data/IndexedDbAuthRepository';
import { IndexedDbContentRepository } from '../infrastructure/data/IndexedDbContentRepository';
import { IndexedDbDataStore } from '../infrastructure/data/IndexedDbDataStore';
import { IndexedDbViewEventRepository } from '../infrastructure/data/IndexedDbViewEventRepository';
import { STAGE13_OBJECT_STORES, STORE_NAMES } from '../infrastructure/data/migrations';
import { DatabaseSeeder, INITIAL_AGE_GROUPS } from '../infrastructure/data/seed';
import { AppLogger } from '../infrastructure/logging/AppLogger';
import { LocalIndexedDbFileStorage } from '../infrastructure/storage/LocalIndexedDbFileStorage';
import { assert, assertEqual, type UnitTestCase } from './testRunner';

class Stage13FakeClock implements IClock {
  private iso: string;
  private readonly inner = new SystemClock();

  constructor(initialIso = '2026-11-22T10:00:00.000Z') {
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

class MemoryViewEventRepository implements IViewEventRepository {
  private events: ViewEvent[] = [];
  private seq = 1;

  public async createViewEvent(event: Omit<ViewEvent, 'id'>): Promise<ViewEvent> {
    const created: ViewEvent = {
      ...event,
      id: this.seq++,
    };
    this.events.push(created);
    return { ...created };
  }

  public async getViewEventsByContentId(contentId: number): Promise<ViewEvent[]> {
    return this.events.filter((e) => e.contentId === contentId).map((e) => ({ ...e }));
  }

  public async getAllViewEvents(): Promise<ViewEvent[]> {
    return this.events.map((e) => ({ ...e }));
  }
}

class MemoryStage13ContentRepository implements IContentRepository {
  private items: ContentItem[] = [];
  private sources: ContentSource[] = [];
  private files: ContentFile[] = [];
  private contentTopics: ContentTopic[] = [];
  private contentTags: ContentTag[] = [];
  private contentPersons: ContentPerson[] = [];
  private contentAgeGroups: ContentAgeGroup[] = [];
  private readonly existingUserIds = new Set<number>();
  private itemSeq = 1;
  private sourceSeq = 1;
  private fileSeq = 1;

  public registerUser(userId: number): void {
    this.existingUserIds.add(userId);
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
    if (!this.existingUserIds.has(item.createdById)) {
      throw new Error(`FOREIGN_KEY_VIOLATION: createdById=${item.createdById} not found`);
    }
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

  public async getAllContentAgeGroups(): Promise<Array<{ contentId: number; ageGroupId: number }>> {
    return this.contentAgeGroups.map((ca) => ({ ...ca }));
  }

  public async replaceContentAgeGroups(contentId: number, ageGroupIds: number[]): Promise<void> {
    this.contentAgeGroups = this.contentAgeGroups.filter((ca) => ca.contentId !== contentId);
    for (const ageGroupId of ageGroupIds) {
      this.contentAgeGroups.push({ contentId, ageGroupId });
    }
  }

  public async userExists(userId: number): Promise<boolean> {
    return this.existingUserIds.has(userId);
  }
}

class MemoryStage13TaxonomyRepository implements ITaxonomyRepository {
  public topics: Topic[] = [];
  public tags: Tag[] = [];
  public persons: Person[] = [];
  public impactLevels: ImpactLevel[] = [
    { id: 1, name: 'آگاهی‌بخش', sortOrder: 1 },
  ];
  public ageGroups: AgeGroup[] = INITIAL_AGE_GROUPS.map((g, idx) => ({ ...g, id: idx + 1 }));
  private seq = 100;

  public async getAllTopics(): Promise<Topic[]> {
    return this.topics.map((t) => ({ ...t }));
  }
  public async getTopicById(id: number): Promise<Topic | null> {
    return this.topics.find((t) => t.id === id) ?? null;
  }
  public async createTopic(topic: Omit<Topic, 'id'>): Promise<Topic> {
    const created = { ...topic, id: this.seq++ };
    this.topics.push(created);
    return created;
  }
  public async updateTopic(topic: Topic): Promise<void> {
    const idx = this.topics.findIndex((t) => t.id === topic.id);
    if (idx !== -1) this.topics[idx] = { ...topic };
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
    const created = { ...tag, id: this.seq++ };
    this.tags.push(created);
    return created;
  }
  public async updateTag(tag: Tag): Promise<void> {
    const idx = this.tags.findIndex((t) => t.id === tag.id);
    if (idx !== -1) this.tags[idx] = { ...tag };
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
    const created = { ...person, id: this.seq++ };
    this.persons.push(created);
    return created;
  }
  public async updatePerson(person: Person): Promise<void> {
    const idx = this.persons.findIndex((p) => p.id === person.id);
    if (idx !== -1) this.persons[idx] = { ...person };
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
  public async createImpactLevel(level: Omit<ImpactLevel, 'id'>): Promise<ImpactLevel> {
    const created = { ...level, id: this.seq++ };
    this.impactLevels.push(created);
    return created;
  }
  public async updateImpactLevel(level: ImpactLevel): Promise<void> {
    const idx = this.impactLevels.findIndex((l) => l.id === level.id);
    if (idx !== -1) this.impactLevels[idx] = { ...level };
  }
  public async deleteImpactLevel(id: number): Promise<void> {
    this.impactLevels = this.impactLevels.filter((l) => l.id !== id);
  }

  public async getAllAgeGroups(): Promise<AgeGroup[]> {
    return this.ageGroups.map((g) => ({ ...g }));
  }
  public async getAgeGroupById(id: number): Promise<AgeGroup | null> {
    return this.ageGroups.find((g) => g.id === id) ?? null;
  }
  public async updateAgeGroup(group: AgeGroup): Promise<void> {
    const idx = this.ageGroups.findIndex((g) => g.id === group.id);
    if (idx !== -1) this.ageGroups[idx] = { ...group };
  }

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
  public async createContentItem(item: Omit<ContentItem, 'id'>): Promise<ContentItem> {
    return { ...item, id: this.seq++ };
  }
  public async linkContentTopic(): Promise<void> {
    // no-op
  }
}

class MemoryRangeFileStorage implements IFileStorage {
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
    const uuidHex = (this.seq++).toString(16).padStart(12, '0');
    const prefix = request.visibility === 'public' ? 'public/thumb' : 'private/vault';
    const storageKey = `${prefix}/13131313-4444-4555-8666-${uuidHex}.${ext}`;

    const copy = new Uint8Array(request.bytes.byteLength);
    copy.set(request.bytes);

    const metadata: StoredFileMetadata = {
      storageKey,
      originalFileName: request.originalFileName,
      extension: ext,
      mimeType: request.contentType || getMimeTypeForExtension(ext),
      sizeBytes: copy.byteLength,
      visibility: request.visibility,
      category: getCategoryForExtension(ext) ?? 'video',
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
    if (totalBytes === 0) {
      return {
        chunk: new Uint8Array(0),
        totalBytes: 0,
        startByte: 0,
        endByte: 0,
        mimeType: found.metadata.mimeType,
      };
    }
    const safeStart = Math.max(0, Math.min(Math.floor(startByte), totalBytes - 1));
    const safeEnd = Math.max(safeStart, Math.min(Math.floor(endByte), totalBytes - 1));
    const chunk = found.bytes.slice(safeStart, safeEnd + 1);
    return {
      chunk,
      totalBytes,
      startByte: safeStart,
      endByte: safeEnd,
      mimeType: found.metadata.mimeType,
    };
  }

  public async deleteAsync(storageKey: string): Promise<void> {
    this.entries.delete(storageKey);
  }

  public async existsAsync(storageKey: string): Promise<boolean> {
    return this.entries.has(storageKey);
  }

  public async getMetadataAsync(storageKey: string): Promise<StoredFileMetadata | null> {
    return this.entries.get(storageKey)?.metadata ?? null;
  }

  public async listAllMetadataAsync(): Promise<StoredFileMetadata[]> {
    return Array.from(this.entries.values()).map((e) => ({ ...e.metadata }));
  }
}

function makeTestContentItem(
  partial: Partial<ContentItem> & { id: number; title: string; createdById: number },
): ContentItem {
  const normalizer = new SearchNormalizer();
  const summary = partial.summary ?? `خلاصه ${partial.title}`;
  return {
    id: partial.id,
    title: partial.title,
    slug: partial.slug ?? `slug-${partial.id}`,
    summary,
    body: partial.body ?? null,
    format: partial.format ?? 'Article',
    impactLevelId: partial.impactLevelId ?? 1,
    status: partial.status ?? ContentStatus.Published,
    publishedAt: partial.publishedAt ?? '2026-11-20T12:00:00.000Z',
    readWatchMinutes: partial.readWatchMinutes ?? 6,
    thumbnailKey: partial.thumbnailKey ?? null,
    isFeatured: partial.isFeatured ?? false,
    languageCode: 'fa',
    searchText: partial.searchText ?? normalizer.buildSearchText({ title: partial.title, summary }),
    viewCount: partial.viewCount ?? 0,
    downloadCount: partial.downloadCount ?? 0,
    likeCount: partial.likeCount ?? 0,
    createdById: partial.createdById,
    createdAt: partial.createdAt ?? '2026-11-20T12:00:00.000Z',
    updatedAt: partial.updatedAt ?? '2026-11-20T12:00:00.000Z',
  };
}

export const stage13Tests: UnitTestCase[] = [
  {
    id: 'stage13-view-rule-30min',
    nameKey: 'tests.stage13.viewRule30Min.name',
    descriptionKey: 'tests.stage13.viewRule30Min.desc',
    run: async () => {
      const clock = new Stage13FakeClock('2026-11-22T10:00:00.000Z');
      const contentRepo = new MemoryStage13ContentRepository();
      const viewRepo = new MemoryViewEventRepository();
      const authorId = 104;
      contentRepo.registerUser(authorId);

      const topics: Topic[] = [
        { id: 10, name: 'تاریخ', slug: 'history', parentId: null, icon: null, sortOrder: 1, isActive: true },
        { id: 20, name: 'تاریخ معاصر', slug: 'contemporary', parentId: 10, icon: null, sortOrder: 2, isActive: true },
        { id: 30, name: 'جنگ تحمیلی', slug: 'sacred-defense', parentId: 20, icon: null, sortOrder: 3, isActive: true },
      ];

      const item = await contentRepo.createContentItem({
        title: 'مستند ریشه‌های تاریخی',
        slug: 'history-roots-doc',
        summary: 'بررسی مستند و پژوهشی تحولات معاصر.',
        body: null,
        format: 'Video',
        impactLevelId: 1,
        status: ContentStatus.Published,
        publishedAt: '2026-11-20T08:00:00.000Z',
        readWatchMinutes: 15,
        thumbnailKey: null,
        isFeatured: false,
        languageCode: 'fa',
        searchText: 'مستند ریشه‌های تاریخی',
        viewCount: 0,
        downloadCount: 0,
        likeCount: 0,
        createdById: authorId,
        createdAt: '2026-11-20T08:00:00.000Z',
        updatedAt: '2026-11-20T08:00:00.000Z',
      });
      await contentRepo.replaceContentTopics(item.id, [30]);

      const resolvedRoot = resolveRootTopicId([30], topics);
      assertEqual(resolvedRoot, 10, 'Grandchild topic 30 must resolve to root topic 10');

      const tracker = new ViewTrackerService(viewRepo, contentRepo, clock);
      const teenAgeId = 2;

      // 10:00 -> first visit -> counted (1)
      clock.setUtcIso('2026-11-22T10:00:00.000Z');
      const r1 = await tracker.trackViewAsync({
        contentId: item.id,
        userId: null,
        visitorId: 'vid-stage13-test',
        ageGroupId: teenAgeId,
        primaryTopicId: resolvedRoot,
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      });
      assertEqual(r1.isCounted, true, '10:00 visit must be counted');

      // 10:15 -> within 30 minutes of 10:00 -> NOT counted
      clock.setUtcIso('2026-11-22T10:15:00.000Z');
      const r2 = await tracker.trackViewAsync({
        contentId: item.id,
        userId: null,
        visitorId: 'vid-stage13-test',
        ageGroupId: teenAgeId,
        primaryTopicId: resolvedRoot,
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      });
      assertEqual(r2.isCounted, false, '10:15 visit (15m after 10:00) must not increment viewCount');

      // 10:40 -> 40 minutes after last counted (10:00), 25m after uncounted (10:15) -> counted!
      clock.setUtcIso('2026-11-22T10:40:00.000Z');
      const r3 = await tracker.trackViewAsync({
        contentId: item.id,
        userId: null,
        visitorId: 'vid-stage13-test',
        ageGroupId: teenAgeId,
        primaryTopicId: resolvedRoot,
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      });
      assertEqual(
        r3.isCounted,
        true,
        '10:40 visit must be counted because last counted view was 10:00 (40m ago)',
      );

      const updatedItem = await contentRepo.getContentItemById(item.id);
      assertEqual(updatedItem?.viewCount, 2, 'Total viewCount after 10:00, 10:15, 10:40 must be 2');

      const events = await viewRepo.getViewEventsByContentId(item.id);
      assertEqual(events.length, 3, 'All 3 non-bot visits must create ViewEvent rows');
      assertEqual(events[0].isCounted, true, 'Event 0 isCounted');
      assertEqual(events[1].isCounted, false, 'Event 1 isCounted');
      assertEqual(events[2].isCounted, true, 'Event 2 isCounted');
      for (const ev of events) {
        assertEqual(ev.ageGroupId, teenAgeId, 'ViewEvent must record active ageGroupId');
        assertEqual(ev.primaryTopicId, 10, 'ViewEvent must record root topic ID (10)');
      }

      // IndexedDB migration v7 + ViewEvent persistence check in browser runtime
      if (typeof indexedDB !== 'undefined') {
        const testDbName = `MerajAndishehDB_S13_View_${Date.now()}`;
        const store = new IndexedDbDataStore(
          testDbName,
          envConfig.databaseVersion,
          envConfig.metaStoreName,
        );
        const logger = new AppLogger(clock, `meraj_s13_log_${Date.now()}`, 10);
        try {
          const seeder = new DatabaseSeeder(store, logger);
          await seeder.seed();

          const storeNames = await store.getObjectStoreNames();
          for (const sName of STAGE13_OBJECT_STORES) {
            assert(storeNames.includes(sName), `Missing Stage 13 ObjectStore: ${sName}`);
          }

          const idbAuthRepo = new IndexedDbAuthRepository(store);
          const idbViewRepo = new IndexedDbViewEventRepository(store);
          const idbContentRepo = new IndexedDbContentRepository(store);

          // Create real user in users store before creating content
          const seededUser = await idbAuthRepo.createUser({
            email: 'stage13-test@meraj.local',
            normalizedEmail: 'STAGE13-TEST@MERAJ.LOCAL',
            phoneNumber: null,
            normalizedPhoneNumber: null,
            displayName: 'نویسنده تست مرحله ۱۳',
            role: 'Staff',
            ageGroupId: 4,
            personalizationEnabled: false,
            emailConfirmed: true,
            phoneNumberConfirmed: false,
            mustChangePassword: false,
            isActive: true,
            failedLoginCount: 0,
            lockoutEnd: null,
            passwordHash: 'hash',
            passwordSalt: 'salt',
            createdAt: clock.nowUtcIso(),
            lastLoginAt: null,
          });
          assert(typeof seededUser.id === 'number', 'Real user ID must be auto-assigned');

          // Query each required index via store.getAllByIndex to prove Migration v7 indexes exist
          for (const [idxName, probeKey] of [
            ['by_contentId', -1],
            ['by_visitorId', '__probe__'],
            ['by_userId', -1],
            ['by_occurredAt', ''],
            ['by_isCounted', 1],
          ] as const) {
            const rows = await store.getAllByIndex(STORE_NAMES.VIEW_EVENTS, idxName, probeKey);
            assert(Array.isArray(rows), `Index ${idxName} on viewEvents must be queryable`);
          }

          const idbItem = await idbContentRepo.createContentItem({
            title: 'محتوای آزمایشی پایگاه داده',
            slug: 'idb-s13-view-test',
            summary: 'بررسی ذخیره ViewEvent در IndexedDB v7.',
            body: null,
            format: 'Article',
            impactLevelId: null,
            status: ContentStatus.Published,
            publishedAt: clock.nowUtcIso(),
            readWatchMinutes: 4,
            thumbnailKey: null,
            isFeatured: false,
            languageCode: 'fa',
            searchText: 'محتوای آزمایشی پایگاه داده',
            viewCount: 0,
            downloadCount: 0,
            likeCount: 0,
            createdById: seededUser.id as number,
            createdAt: clock.nowUtcIso(),
            updatedAt: clock.nowUtcIso(),
          });

          const idbTracker = new ViewTrackerService(idbViewRepo, idbContentRepo, clock);
          const idbRes = await idbTracker.trackViewAsync({
            contentId: idbItem.id,
            userId: seededUser.id as number,
            visitorId: 'vid-idb-s13',
            ageGroupId: 4,
            primaryTopicId: 1,
            userAgent: 'Mozilla/5.0 Chrome/129.0',
          });
          assertEqual(idbRes.isCounted, true, 'IDB ViewEvent must be counted');

          const storedEvents = await idbViewRepo.getViewEventsByContentId(idbItem.id);
          assertEqual(storedEvents.length, 1, 'IndexedDB must persist 1 ViewEvent');
          assertEqual(storedEvents[0].userId, seededUser.id as number, 'Stored userId must match');
        } finally {
          logger.clearLogs();
          store.close();
          indexedDB.deleteDatabase(testDbName);
        }
      }
    },
  },
  {
    id: 'stage13-bot-filter',
    nameKey: 'tests.stage13.botFilter.name',
    descriptionKey: 'tests.stage13.botFilter.desc',
    run: async () => {
      assertEqual(isKnownBotUserAgent('Googlebot/2.1 (+http://www.google.com/bot.html)'), true, 'Googlebot must be detected');
      assertEqual(isKnownBotUserAgent('curl/8.0.1'), true, 'curl must be detected');
      assertEqual(isKnownBotUserAgent('TelegramBot (like TwitterBot)'), true, 'TelegramBot must be detected');
      assertEqual(isKnownBotUserAgent('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36'), false, 'Standard browser must not be flagged as bot');

      const clock = new Stage13FakeClock();
      const contentRepo = new MemoryStage13ContentRepository();
      const viewRepo = new MemoryViewEventRepository();
      contentRepo.registerUser(201);

      const item = await contentRepo.createContentItem({
        title: 'محتوای بررسی فیلتر ربات',
        slug: 'bot-filter-item',
        summary: 'خلاصه محتوا',
        body: null,
        format: 'Article',
        impactLevelId: 1,
        status: ContentStatus.Published,
        publishedAt: clock.nowUtcIso(),
        readWatchMinutes: 5,
        thumbnailKey: null,
        isFeatured: false,
        languageCode: 'fa',
        searchText: 'محتوای بررسی فیلتر ربات',
        viewCount: 0,
        downloadCount: 0,
        likeCount: 0,
        createdById: 201,
        createdAt: clock.nowUtcIso(),
        updatedAt: clock.nowUtcIso(),
      });

      const tracker = new ViewTrackerService(viewRepo, contentRepo, clock);

      const googleRes = await tracker.trackViewAsync({
        contentId: item.id,
        userId: null,
        visitorId: 'vid-bot-1',
        ageGroupId: 4,
        primaryTopicId: null,
        userAgent: 'Googlebot/2.1 (+http://www.google.com/bot.html)',
      });
      assertEqual(googleRes.skippedAsBot, true, 'Googlebot request must have skippedAsBot=true');
      assertEqual(googleRes.isCounted, false, 'Googlebot request must have isCounted=false');
      assertEqual(googleRes.event, null, 'Googlebot request must not persist a ViewEvent');

      const curlRes = await tracker.trackViewAsync({
        contentId: item.id,
        userId: null,
        visitorId: 'vid-bot-2',
        ageGroupId: 4,
        primaryTopicId: null,
        userAgent: 'curl/8.0',
      });
      assertEqual(curlRes.skippedAsBot, true, 'curl request must have skippedAsBot=true');

      const afterBots = await contentRepo.getContentItemById(item.id);
      assertEqual(afterBots?.viewCount, 0, 'Bot visits must leave viewCount unchanged at 0');

      const humanRes = await tracker.trackViewAsync({
        contentId: item.id,
        userId: null,
        visitorId: 'vid-human',
        ageGroupId: 4,
        primaryTopicId: null,
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) Firefox/130.0',
      });
      assertEqual(humanRes.skippedAsBot, false, 'Normal browser must not be skipped');
      assertEqual(humanRes.isCounted, true, 'Normal browser visit must be counted');

      const afterHuman = await contentRepo.getContentItemById(item.id);
      assertEqual(afterHuman?.viewCount, 1, 'Normal browser visit must increment viewCount to 1');
    },
  },
  {
    id: 'stage13-child-safety-detail-404',
    nameKey: 'tests.stage13.childSafetyDetail404.name',
    descriptionKey: 'tests.stage13.childSafetyDetail404.desc',
    run: async () => {
      const contentRepo = new MemoryStage13ContentRepository();
      const taxonomyRepo = new MemoryStage13TaxonomyRepository();
      const authorId = 305;
      contentRepo.registerUser(authorId);

      const childAge = taxonomyRepo.ageGroups.find((a) => a.key === 'child')!;
      const teenAge = taxonomyRepo.ageGroups.find((a) => a.key === 'teen')!;
      const adultAge = taxonomyRepo.ageGroups.find((a) => a.key === 'adult')!;

      const adultItem = await contentRepo.createContentItem({
        title: 'تحلیل فلسفی ویژه بزرگسالان',
        slug: 'adult-only-philosophy',
        summary: 'محتوای تخصصی رده بزرگسال.',
        body: '<p>متن تخصصی</p>',
        format: 'Article',
        impactLevelId: 1,
        status: ContentStatus.Published,
        publishedAt: '2026-11-20T10:00:00.000Z',
        readWatchMinutes: 12,
        thumbnailKey: null,
        isFeatured: false,
        languageCode: 'fa',
        searchText: 'تحلیل فلسفی ویژه بزرگسالان',
        viewCount: 0,
        downloadCount: 0,
        likeCount: 0,
        createdById: authorId,
        createdAt: '2026-11-20T10:00:00.000Z',
        updatedAt: '2026-11-20T10:00:00.000Z',
      });
      await contentRepo.replaceContentAgeGroups(adultItem.id, [adultAge.id]);

      const draftItem = await contentRepo.createContentItem({
        title: 'مقاله پیش‌نویس',
        slug: 'draft-hidden-item',
        summary: 'پیش‌نویس',
        body: '<p>پیش‌نویس</p>',
        format: 'Article',
        impactLevelId: 1,
        status: ContentStatus.Draft,
        publishedAt: null,
        readWatchMinutes: 5,
        thumbnailKey: null,
        isFeatured: false,
        languageCode: 'fa',
        searchText: 'مقاله پیش‌نویس',
        viewCount: 0,
        downloadCount: 0,
        likeCount: 0,
        createdById: authorId,
        createdAt: '2026-11-20T10:00:00.000Z',
        updatedAt: '2026-11-20T10:00:00.000Z',
      });
      await contentRepo.replaceContentAgeGroups(draftItem.id, [childAge.id]);

      const archivedItem = await contentRepo.createContentItem({
        title: 'مقاله بایگانی‌شده',
        slug: 'archived-hidden-item',
        summary: 'بایگانی‌شده',
        body: '<p>بایگانی</p>',
        format: 'Article',
        impactLevelId: 1,
        status: ContentStatus.Archived,
        publishedAt: '2026-11-18T10:00:00.000Z',
        readWatchMinutes: 5,
        thumbnailKey: null,
        isFeatured: false,
        languageCode: 'fa',
        searchText: 'مقاله بایگانی‌شده',
        viewCount: 0,
        downloadCount: 0,
        likeCount: 0,
        createdById: authorId,
        createdAt: '2026-11-18T10:00:00.000Z',
        updatedAt: '2026-11-19T10:00:00.000Z',
      });

      const detailService = new ContentDetailService(contentRepo, taxonomyRepo);

      const childRes = await detailService.getPublicContentDetailAsync('adult-only-philosophy', childAge);
      assertEqual(childRes.status, 'not_found', 'Child opening adult-only slug directly must receive 404 (not_found)');

      const teenRes = await detailService.getPublicContentDetailAsync('adult-only-philosophy', teenAge);
      assertEqual(teenRes.status, 'ok', 'Teen opening adult-only slug can view via soft priority rule');

      const adultRes = await detailService.getPublicContentDetailAsync('adult-only-philosophy', adultAge);
      assertEqual(adultRes.status, 'ok', 'Adult opening adult-only slug must receive ok');

      const draftRes = await detailService.getPublicContentDetailAsync('draft-hidden-item', adultAge);
      assertEqual(draftRes.status, 'not_found', 'Draft item must return not_found for public');

      const archivedRes = await detailService.getPublicContentDetailAsync('archived-hidden-item', adultAge);
      assertEqual(archivedRes.status, 'not_found', 'Archived item must return not_found for public');
    },
  },
  {
    id: 'stage13-related-contents',
    nameKey: 'tests.stage13.relatedContents.name',
    descriptionKey: 'tests.stage13.relatedContents.desc',
    run: () => {
      const ages = INITIAL_AGE_GROUPS.map((g, idx) => ({ ...g, id: idx + 1 }));
      const childAge = ages.find((a) => a.key === 'child')!;
      const adultAge = ages.find((a) => a.key === 'adult')!;

      const topics: Topic[] = [
        { id: 1, name: 'تاریخ', slug: 'history', parentId: null, icon: null, sortOrder: 1, isActive: true },
        { id: 2, name: 'نجوم', slug: 'astronomy', parentId: null, icon: null, sortOrder: 2, isActive: true },
      ];

      const currentItem = makeTestContentItem({
        id: 1,
        title: 'محتوای اصلی تاریخ',
        createdById: 500,
      });

      const allItems: ContentItem[] = [currentItem];
      const contentTopics: ContentTopic[] = [{ contentId: 1, topicId: 1 }];
      const contentAgeGroups: ContentAgeGroup[] = [{ contentId: 1, ageGroupId: childAge.id }];

      // 8 published items sharing topic 1: items 2..7 child-allowed, items 8..9 adult-only
      for (let i = 2; i <= 9; i += 1) {
        allItems.push(
          makeTestContentItem({
            id: i,
            title: `مرتبط ${i}`,
            publishedAt: `2026-11-${String(10 + i).padStart(2, '0')}T12:00:00.000Z`,
            createdById: 500,
          }),
        );
        contentTopics.push({ contentId: i, topicId: 1 });
        contentAgeGroups.push({
          contentId: i,
          ageGroupId: i >= 8 ? adultAge.id : childAge.id,
        });
      }

      // Unique topic item (topic 2 has no other items)
      const lonelyItem = makeTestContentItem({
        id: 50,
        title: 'محتوای تک‌موضوعی نجوم',
        createdById: 500,
      });
      allItems.push(lonelyItem);
      contentTopics.push({ contentId: 50, topicId: 2 });

      const adultRelated = getRelatedContents({
        currentItemId: currentItem.id,
        currentTopicIds: [1],
        allItems,
        contentTopics,
        contentAgeGroups,
        topics,
        activeAgeGroup: adultAge,
      });
      assertEqual(adultRelated.length, 6, 'Related contents must be capped at max 6');
      assert(
        !adultRelated.some((r) => r.item.id === currentItem.id),
        'Related contents must exclude current item itself',
      );

      const childRelated = getRelatedContents({
        currentItemId: currentItem.id,
        currentTopicIds: [1],
        allItems,
        contentTopics,
        contentAgeGroups,
        topics,
        activeAgeGroup: childAge,
      });
      assertEqual(childRelated.length, 6, 'Child should receive the 6 child-allowed items');
      assert(
        !childRelated.some((r) => r.item.id === 8 || r.item.id === 9),
        'Child related contents must exclude adult-only items (8, 9)',
      );

      const lonelyRelated = getRelatedContents({
        currentItemId: lonelyItem.id,
        currentTopicIds: [2],
        allItems,
        contentTopics,
        contentAgeGroups,
        topics,
        activeAgeGroup: adultAge,
      });
      assertEqual(lonelyRelated.length, 0, 'Item with no same-topic peers must return []');
    },
  },
  {
    id: 'stage13-aparat-and-range-seek',
    nameKey: 'tests.stage13.aparatAndRangeSeek.name',
    descriptionKey: 'tests.stage13.aparatAndRangeSeek.desc',
    run: async () => {
      const embedUrl = resolveAparatEmbedUrl('https://www.aparat.com/v/test123');
      assertEqual(
        embedUrl,
        'https://www.aparat.com/video/video/embed/videohash/test123/vt/frame',
        'Aparat video URL must convert to official embed URL',
      );

      const bareEmbed = resolveAparatEmbedUrl('https://aparat.com/v/AbC_987?t=12');
      assertEqual(
        bareEmbed,
        'https://www.aparat.com/video/video/embed/videohash/AbC_987/vt/frame',
        'aparat.com without www must convert cleanly',
      );

      assertEqual(
        resolveAparatEmbedUrl('https://evil.example.com/v/test123'),
        null,
        'Non-Aparat host must be rejected with null',
      );
      assertEqual(
        resolveAparatEmbedUrl('javascript:alert(1)'),
        null,
        'Dangerous protocol URL must be rejected with null',
      );

      const clock = new Stage13FakeClock();
      const memStorage = new MemoryRangeFileStorage(clock);
      const samplePayload = new TextEncoder().encode('0123456789ABCDEFGHIJ'); // 20 bytes

      const savedMeta = await memStorage.saveAsync({
        bytes: samplePayload,
        originalFileName: 'range-test.mp4',
        contentType: 'video/mp4',
        visibility: 'private',
      });

      const memRange = await memStorage.openReadRangeAsync(savedMeta.storageKey, 4, 9);
      assert(memRange !== null, 'openReadRangeAsync must return non-null result');
      assertEqual(memRange!.totalBytes, 20, 'Total bytes must equal 20');
      assertEqual(memRange!.startByte, 4, 'startByte must equal 4');
      assertEqual(memRange!.endByte, 9, 'endByte must equal 9');
      assertEqual(
        new TextDecoder().decode(memRange!.chunk),
        '456789',
        'Middle byte slice [4..9] must decode to exact "456789"',
      );

      if (typeof indexedDB !== 'undefined') {
        const testDbName = `MerajAndishehDB_S13_Range_${Date.now()}`;
        const store = new IndexedDbDataStore(
          testDbName,
          envConfig.databaseVersion,
          envConfig.metaStoreName,
        );
        try {
          await store.connect();
          const idbFileStorage = new LocalIndexedDbFileStorage(store, clock);
          const idbMeta = await idbFileStorage.saveAsync({
            bytes: samplePayload,
            originalFileName: 'range-idb.mp4',
            contentType: 'video/mp4',
            visibility: 'private',
          });

          const idbRange = await idbFileStorage.openReadRangeAsync(idbMeta.storageKey, 4, 9);
          assert(idbRange !== null, 'IndexedDB openReadRangeAsync must return range');
          assertEqual(idbRange!.totalBytes, 20, 'IndexedDB range totalBytes must be 20');
          assertEqual(
            new TextDecoder().decode(idbRange!.chunk),
            '456789',
            'IndexedDB Blob.slice [4..9] must match exact middle bytes',
          );
        } finally {
          store.close();
          indexedDB.deleteDatabase(testDbName);
        }
      }
    },
  },
];
