import type { IClock } from '../core/abstractions/IClock';
import type { IAdminRepository } from '../core/abstractions/adminRepository';
import type { IContentRepository } from '../core/abstractions/contentRepository';
import type { IDownloadEventRepository } from '../core/abstractions/downloadRepository';
import { DownloadKind, type DownloadEvent } from '../core/domain/analytics';
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
import type { StaffPermission } from '../core/domain/permissions';
import type { FeatureFlag, SiteSetting } from '../core/domain/settings';
import {
  STORY_HEIGHT,
  STORY_MIME_TYPE,
  STORY_QUOTE_MAX_LENGTH,
  STORY_TEMPLATE_KEYS,
  STORY_TITLE_MAX_LENGTH,
  STORY_WIDTH,
} from '../core/domain/story';
import type { AgeGroup } from '../core/domain/taxonomy';
import { SearchNormalizer } from '../core/services/searchNormalizer';
import { StoryService } from '../core/services/storyService';
import { SystemClock } from '../infrastructure/clock/SystemClock';
import { envConfig } from '../infrastructure/config/envConfig';
import { IndexedDbAdminRepository } from '../infrastructure/data/IndexedDbAdminRepository';
import { IndexedDbAuthRepository } from '../infrastructure/data/IndexedDbAuthRepository';
import { IndexedDbContentRepository } from '../infrastructure/data/IndexedDbContentRepository';
import { IndexedDbDataStore } from '../infrastructure/data/IndexedDbDataStore';
import { IndexedDbDownloadEventRepository } from '../infrastructure/data/IndexedDbDownloadEventRepository';
import { DATABASE_MIGRATIONS, STORE_NAMES } from '../infrastructure/data/migrations';
import { DatabaseSeeder, INITIAL_AGE_GROUPS } from '../infrastructure/data/seed';
import { AppLogger } from '../infrastructure/logging/AppLogger';
import {
  ensureStage25StoryGeneratorDefaultFlagAsync,
  STAGE25_STORY_GENERATOR_FLAG_META_KEY,
} from '../web/services/appContainer';
import { renderStoryToPngBlobAsync } from '../web/services/storyCanvasRenderer';
import { assert, assertEqual, type UnitTestCase } from './testRunner';

class Stage25FakeClock implements IClock {
  private iso: string;
  private readonly inner = new SystemClock();

  constructor(initialIso = '2026-11-24T12:00:00.000Z') {
    this.iso = initialIso;
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

class MemoryStage25AdminRepository implements IAdminRepository {
  public users: AppUser[] = [];
  public permissions: StaffPermission[] = [];
  public flags: FeatureFlag[] = [{ key: 'StoryGenerator', isEnabled: true }];
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

  public async deleteSessionsByUserId(_userId: number): Promise<void> {}

  public async getStaffPermissionsByUserId(
    userId: number,
  ): Promise<StaffPermission[]> {
    return this.permissions.filter((p) => p.userId === userId);
  }

  public async replaceStaffPermissions(
    userId: number,
    permissions: Omit<StaffPermission, 'id'>[],
  ): Promise<StaffPermission[]> {
    const created = permissions.map((p, idx) => ({
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

class MemoryStage25ContentRepository implements IContentRepository {
  public items: ContentItem[] = [];
  public sources: ContentSource[] = [];
  public files: ContentFile[] = [];
  public contentTopics: ContentTopic[] = [];
  public contentTags: ContentTag[] = [];
  public contentPersons: ContentPerson[] = [];
  public contentAgeGroups: ContentAgeGroup[] = [];
  private itemSeq = 1;
  private sourceSeq = 1;
  private fileSeq = 1;

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

  public async createContentItem(
    item: Omit<ContentItem, 'id'>,
  ): Promise<ContentItem> {
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
      contentId,
      id: this.sourceSeq++,
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
      contentId,
      id: this.fileSeq++,
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

  public async getAllContentAgeGroups(): Promise<ContentAgeGroup[]> {
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

  public async userExists(_userId: number): Promise<boolean> {
    return true;
  }
}

class MemoryStage25DownloadEventRepository implements IDownloadEventRepository {
  public events: DownloadEvent[] = [];
  private seq = 1;

  public async createDownloadEvent(
    event: Omit<DownloadEvent, 'id'>,
  ): Promise<DownloadEvent> {
    const created: DownloadEvent = { ...event, id: this.seq++ };
    this.events.push(created);
    return { ...created };
  }

  public async getDownloadEventsByContentId(
    contentId: number,
  ): Promise<DownloadEvent[]> {
    return this.events
      .filter((e) => e.contentId === contentId)
      .map((e) => ({ ...e }));
  }

  public async getDownloadEventsByUserId(userId: number): Promise<DownloadEvent[]> {
    return this.events
      .filter((e) => e.userId === userId)
      .map((e) => ({ ...e }));
  }

  public async getAllDownloadEvents(): Promise<DownloadEvent[]> {
    return this.events.map((e) => ({ ...e }));
  }
}

function makeUserPayload(
  email: string,
  role: 'SuperAdmin' | 'Member',
  ageGroupId: number,
  nowIso: string,
): Omit<AppUser, 'id'> {
  return {
    email,
    normalizedEmail: email.toLowerCase(),
    emailConfirmed: true,
    phoneNumber: null,
    normalizedPhoneNumber: null,
    phoneNumberConfirmed: false,
    passwordHash: 'hash',
    passwordSalt: 'salt',
    displayName: email.split('@')[0],
    ageGroupId,
    personalizationEnabled: true,
    mustChangePassword: false,
    isActive: true,
    isDeleted: false,
    deletedAt: null,
    role,
    failedLoginCount: 0,
    lockoutEnd: null,
    createdAt: nowIso,
    lastLoginAt: nowIso,
  };
}

async function createStage25HarnessAsync() {
  const clock = new Stage25FakeClock();
  const logger = new AppLogger(clock, `meraj_stage25_test_${Date.now()}`, 100);
  logger.clearLogs();

  const adminRepository = new MemoryStage25AdminRepository();
  const contentRepository = new MemoryStage25ContentRepository();
  const downloadEventRepository = new MemoryStage25DownloadEventRepository();
  const searchNormalizer = new SearchNormalizer();

  const storyService = new StoryService({
    contentRepository,
    adminRepository,
    downloadEventRepository,
    clock,
    logger,
  });

  const adultAge = adminRepository.ageGroups.find((g) => g.key === 'adult')!;
  const childAge = adminRepository.ageGroups.find((g) => g.key === 'child')!;

  const author = await adminRepository.createUser(
    makeUserPayload('author@meraj.ir', 'SuperAdmin', adultAge.id, clock.nowUtcIso()),
  );
  const member = await adminRepository.createUser(
    makeUserPayload('member@meraj.ir', 'Member', adultAge.id, clock.nowUtcIso()),
  );

  return {
    clock,
    logger,
    adminRepository,
    contentRepository,
    downloadEventRepository,
    searchNormalizer,
    storyService,
    adultAge,
    childAge,
    author,
    member,
  };
}

function createSampleDataUrlPng(): string | null {
  if (typeof document === 'undefined') {
    return null;
  }
  const canvas = document.createElement('canvas');
  canvas.width = 160;
  canvas.height = 120;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return null;
  }
  ctx.fillStyle = '#1E3A8A';
  ctx.fillRect(0, 0, 160, 120);
  ctx.fillStyle = '#F59E0B';
  ctx.beginPath();
  ctx.arc(80, 60, 32, 0, Math.PI * 2);
  ctx.fill();
  return canvas.toDataURL('image/png');
}

export const stage25Tests: UnitTestCase[] = [
  {
    id: 'stage25_guest_and_feature_flag_gate',
    nameKey: 'tests.stage25.guestAndFeatureFlagGate.name',
    descriptionKey: 'tests.stage25.guestAndFeatureFlagGate.desc',
    run: async () => {
      const h = await createStage25HarnessAsync();
      try {
        const published = await h.contentRepository.createContentItem({
          title: 'مقاله‌ی سواد رسانه‌ای و تفکر نقادانه',
          slug: 'media-literacy-story-test',
          summary: 'خلاصه‌ای دقیق درباره‌ی شناخت منابع معتبر در فضای دیجیتال.',
          body: '<p>متن مقاله</p>',
          format: 'Article',
          impactLevelId: 1,
          readWatchMinutes: 6,
          thumbnailKey: null,
          status: ContentStatus.Published,
          isFeatured: false,
          languageCode: 'fa',
          viewCount: 0,
          downloadCount: 0,
          likeCount: 0,
          searchText: h.searchNormalizer.normalize('مقاله سواد رسانه ای'),
          createdById: h.author.id,
          publishedAt: h.clock.nowUtcIso(),
          createdAt: h.clock.nowUtcIso(),
          updatedAt: h.clock.nowUtcIso(),
        });

        // 1. UI button visibility helper checks
        assertEqual(
          h.storyService.canUserGenerateStory(null, true),
          false,
          'Guest must not see Story Generator button even when feature flag is true',
        );
        assertEqual(
          h.storyService.canUserGenerateStory(h.member, false),
          false,
          'Member must not see Story Generator button when feature flag is false',
        );
        assertEqual(
          h.storyService.canUserGenerateStory(h.member, true),
          true,
          'Active member must see Story Generator button when feature flag is true',
        );

        // 2. Guest direct service call -> AUTH_REQUIRED, 0 events
        const guestRes = await h.storyService.recordStoryDownloadAsync({
          currentUser: null,
          contentId: published.id,
          activeAgeGroup: h.adultAge,
        });
        assertEqual(guestRes.ok, false, 'Guest recordStoryDownloadAsync must fail');
        if (!guestRes.ok) {
          assertEqual(
            guestRes.errorCode,
            'AUTH_REQUIRED',
            'Guest call must return AUTH_REQUIRED',
          );
        }
        assertEqual(
          h.downloadEventRepository.events.length,
          0,
          'Guest rejection must record 0 DownloadEvents',
        );

        // 3. Disabled FeatureFlag -> FEATURE_DISABLED, 0 events
        await h.adminRepository.upsertFeatureFlag({
          key: 'StoryGenerator',
          isEnabled: false,
        });
        const disabledRes = await h.storyService.recordStoryDownloadAsync({
          currentUser: h.member,
          contentId: published.id,
          activeAgeGroup: h.adultAge,
        });
        assertEqual(
          disabledRes.ok,
          false,
          'recordStoryDownloadAsync must fail when StoryGenerator flag is disabled',
        );
        if (!disabledRes.ok) {
          assertEqual(
            disabledRes.errorCode,
            'FEATURE_DISABLED',
            'Disabled flag must return FEATURE_DISABLED',
          );
        }
        assertEqual(
          h.downloadEventRepository.events.length,
          0,
          'Disabled flag rejection must record 0 DownloadEvents',
        );
      } finally {
        h.logger.clearLogs();
      }
    },
  },
  {
    id: 'stage25_download_event_story_record',
    nameKey: 'tests.stage25.downloadEventStoryRecord.name',
    descriptionKey: 'tests.stage25.downloadEventStoryRecord.desc',
    run: async () => {
      const h = await createStage25HarnessAsync();
      const tempDbName = `MerajStage25_Record_${Date.now()}`;
      try {
        const longTitle = 'الف '.repeat(90).trim();
        const longExcerpt = 'متن بریده‌ی کلیدی کتاب برای اشتراک‌گذاری استوری. '.repeat(8).trim();

        // Check prepareStoryDefaults formatting, truncation limits, keyExcerpts preference, and /admin removal
        const defaults = h.storyService.prepareStoryDefaults({
          content: {
            title: longTitle,
            summary: 'خلاصه عمومی محتوا',
          },
          topicName: 'کتاب‌خوانی و پژوهش',
          keyExcerpts: longExcerpt,
          siteTitle: 'معراج اندیشه',
          siteUrl: 'https://meraj-andisheh.ir/#/admin/portals',
        });

        assertEqual(defaults.template, 'cinematic-dark', 'Default template must be cinematic-dark');
        assertEqual(defaults.showTitle, true, 'showTitle must default to true');
        assert(
          defaults.title.length <= STORY_TITLE_MAX_LENGTH,
          `Prepared title must be <= ${STORY_TITLE_MAX_LENGTH} chars`,
        );
        assert(
          defaults.quote.length <= STORY_QUOTE_MAX_LENGTH,
          `Prepared quote must be <= ${STORY_QUOTE_MAX_LENGTH} chars`,
        );
        assert(
          defaults.quote.includes('بریده‌ی کلیدی'),
          'prepareStoryDefaults must prefer keyExcerpts over summary when non-empty',
        );
        assert(
          !defaults.siteUrl.toLowerCase().includes('admin'),
          'Public siteUrl on story card must never contain /admin',
        );

        // Verify persistence in real IndexedDB v17 using real created user & published content
        if (typeof indexedDB !== 'undefined') {
          const store = new IndexedDbDataStore(
            tempDbName,
            envConfig.databaseVersion,
            envConfig.metaStoreName,
          );
          try {
            await store.connect();
            const seeder = new DatabaseSeeder(store, h.logger);
            await seeder.seed();
            await ensureStage25StoryGeneratorDefaultFlagAsync(store);

            const authRepo = new IndexedDbAuthRepository(store);
            const adminRepo = new IndexedDbAdminRepository(store);
            const contentRepo = new IndexedDbContentRepository(store);
            const downloadRepo = new IndexedDbDownloadEventRepository(store);

            const dbMember = await authRepo.createUser(
              makeUserPayload(
                `story-member-${Date.now()}@meraj.ir`,
                'Member',
                h.adultAge.id,
                h.clock.nowUtcIso(),
              ),
            );
            const dbContent = await contentRepo.createContentItem({
              title: 'کتاب راهنمای تفکر پژوهشی',
              slug: 'research-thinking-guide',
              summary: 'مقدمه‌ای کوتاه برای روش تحقیق و مطالعه‌ی نظام‌مند.',
              body: '<p>متن کتاب</p>',
              format: 'Book',
              impactLevelId: 1,
              readWatchMinutes: 18,
              thumbnailKey: null,
              status: ContentStatus.Published,
              isFeatured: false,
              languageCode: 'fa',
              viewCount: 0,
              downloadCount: 3,
              likeCount: 0,
              searchText: 'کتاب راهنمای تفکر پژوهشی',
              createdById: dbMember.id,
              publishedAt: h.clock.nowUtcIso(),
              createdAt: h.clock.nowUtcIso(),
              updatedAt: h.clock.nowUtcIso(),
            });

            const realStoryService = new StoryService({
              contentRepository: contentRepo,
              adminRepository: adminRepo,
              downloadEventRepository: downloadRepo,
              clock: h.clock,
              logger: h.logger,
            });

            const res = await realStoryService.recordStoryDownloadAsync({
              currentUser: dbMember,
              contentId: dbContent.id,
              activeAgeGroup: h.adultAge,
            });

            assertEqual(res.ok, true, 'Active member story recording must succeed');
            if (res.ok) {
              assertEqual(res.event.kind, DownloadKind.Story, 'DownloadEvent.kind must be Story (2)');
              assertEqual(res.event.fileId, null, 'Story DownloadEvent.fileId must be null');
              assertEqual(res.event.contentId, dbContent.id, 'contentId must match target content');
              assertEqual(res.event.userId, dbMember.id, 'userId must match logged-in member');
            }

            const persistedEvents = await downloadRepo.getDownloadEventsByUserId(dbMember.id);
            assertEqual(persistedEvents.length, 1, 'Exactly 1 DownloadEvent row must be stored in IndexedDB');
            assertEqual(persistedEvents[0].kind, DownloadKind.Story, 'Persisted kind must be Story');
            assertEqual(persistedEvents[0].fileId, null, 'Persisted fileId must be null');

            const refreshedContent = await contentRepo.getContentItemById(dbContent.id);
            assertEqual(
              refreshedContent?.downloadCount,
              3,
              'Story export must not alter file downloadCount counter',
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
  {
    id: 'stage25_child_safety_guard',
    nameKey: 'tests.stage25.childSafetyGuard.name',
    descriptionKey: 'tests.stage25.childSafetyGuard.desc',
    run: async () => {
      const h = await createStage25HarnessAsync();
      try {
        const adultContent = await h.contentRepository.createContentItem({
          title: 'محتوای تخصصی بزرگسالان',
          slug: 'adult-story-guard-test',
          summary: 'تحلیل تخصصی ویژه بزرگسالان',
          body: '<p>متن</p>',
          format: 'Article',
          impactLevelId: 1,
          readWatchMinutes: 10,
          thumbnailKey: null,
          status: ContentStatus.Published,
          isFeatured: false,
          languageCode: 'fa',
          viewCount: 0,
          downloadCount: 0,
          likeCount: 0,
          searchText: 'محتوای تخصصی بزرگسالان',
          createdById: h.author.id,
          publishedAt: h.clock.nowUtcIso(),
          createdAt: h.clock.nowUtcIso(),
          updatedAt: h.clock.nowUtcIso(),
        });
        await h.contentRepository.replaceContentAgeGroups(adultContent.id, [
          h.adultAge.id,
        ]);

        const draftContent = await h.contentRepository.createContentItem({
          title: 'محتوای پیش‌نویس',
          slug: 'draft-story-guard-test',
          summary: 'پیش‌نویس منتشرنشده',
          body: '<p>پیش‌نویس</p>',
          format: 'Article',
          impactLevelId: 1,
          readWatchMinutes: 5,
          thumbnailKey: null,
          status: ContentStatus.Draft,
          isFeatured: false,
          languageCode: 'fa',
          viewCount: 0,
          downloadCount: 0,
          likeCount: 0,
          searchText: 'محتوای پیش نویس',
          createdById: h.author.id,
          publishedAt: null,
          createdAt: h.clock.nowUtcIso(),
          updatedAt: h.clock.nowUtcIso(),
        });

        // 1. Child active age group on adult-only content -> CONTENT_NOT_AVAILABLE
        const childBlocked = await h.storyService.recordStoryDownloadAsync({
          currentUser: h.member,
          contentId: adultContent.id,
          activeAgeGroup: h.childAge,
        });
        assertEqual(
          childBlocked.ok,
          false,
          'Adult-only content must be rejected in child mode',
        );
        if (!childBlocked.ok) {
          assertEqual(
            childBlocked.errorCode,
            'CONTENT_NOT_AVAILABLE',
            'Child safety block must return CONTENT_NOT_AVAILABLE',
          );
        }

        // 2. Draft content -> CONTENT_NOT_AVAILABLE
        const draftBlocked = await h.storyService.recordStoryDownloadAsync({
          currentUser: h.member,
          contentId: draftContent.id,
          activeAgeGroup: h.adultAge,
        });
        assertEqual(draftBlocked.ok, false, 'Draft content must be rejected');

        assertEqual(
          h.downloadEventRepository.events.length,
          0,
          'Blocked requests must leave 0 DownloadEvents',
        );

        // 3. Adult active age group -> allowed
        const adultAllowed = await h.storyService.recordStoryDownloadAsync({
          currentUser: h.member,
          contentId: adultContent.id,
          activeAgeGroup: h.adultAge,
        });
        assertEqual(
          adultAllowed.ok,
          true,
          'Adult content must succeed under adult age group',
        );
      } finally {
        h.logger.clearLogs();
      }
    },
  },
  {
    id: 'stage25_canvas_render_three_templates',
    nameKey: 'tests.stage25.canvasRenderThreeTemplates.name',
    descriptionKey: 'tests.stage25.canvasRenderThreeTemplates.desc',
    run: async () => {
      assertEqual(STORY_WIDTH, 1080, 'STORY_WIDTH constant must be 1080');
      assertEqual(STORY_HEIGHT, 1920, 'STORY_HEIGHT constant must be 1920');
      assertEqual(STORY_MIME_TYPE, 'image/png', 'STORY_MIME_TYPE must be image/png');
      assertEqual(STORY_TEMPLATE_KEYS.length, 3, 'Must expose 3 story templates');

      if (typeof document === 'undefined') {
        return;
      }

      const sampleThumb = createSampleDataUrlPng();
      for (const template of STORY_TEMPLATE_KEYS) {
        const rendered = await renderStoryToPngBlobAsync({
          template,
          showTitle: template !== 'quote-focus',
          title: 'ساختار تفکر خلاق و خوانش عمیق در جهان معاصر',
          quote:
            'یادگیری اصیل زمانی شکل می‌گیرد که پرسشگری با مطالعه و گفت‌وگوی مستمر همراه شود.',
          topicName: 'پژوهش و تفکر',
          siteTitle: 'معراج اندیشه',
          siteUrl: 'meraj-andisheh.ir',
          thumbnailDataUrl: template === 'light-minimal' ? null : sampleThumb,
        });

        assertEqual(
          rendered.width,
          1080,
          `Template ${template} canvas width must equal 1080px`,
        );
        assertEqual(
          rendered.height,
          1920,
          `Template ${template} canvas height must equal 1920px`,
        );
        assertEqual(
          rendered.blob.type,
          'image/png',
          `Template ${template} blob MIME type must be image/png`,
        );
        assert(
          rendered.blob.size > 1000,
          `Template ${template} rendered PNG size must be > 1000 bytes (actual=${rendered.blob.size})`,
        );
      }
    },
  },
  {
    id: 'stage25_migration_v17_default_flag',
    nameKey: 'tests.stage25.migrationV17DefaultFlag.name',
    descriptionKey: 'tests.stage25.migrationV17DefaultFlag.desc',
    run: async () => {
      assert(
        envConfig.stageNumber >= 25,
        `envConfig.stageNumber must be >= 25 (actual=${envConfig.stageNumber})`,
      );
      assert(
        envConfig.databaseVersion >= 17,
        `envConfig.databaseVersion must be >= 17 (actual=${envConfig.databaseVersion})`,
      );
      assert(
        DATABASE_MIGRATIONS.some((m) => m.version === 17),
        'DATABASE_MIGRATIONS must contain version 17',
      );

      if (typeof indexedDB === 'undefined') {
        return;
      }

      const tempUpgradeDb = `MerajStage25_V16_To_V17_${Date.now()}`;
      const clock = new Stage25FakeClock();
      const logger = new AppLogger(clock, `meraj_s25_mig_${Date.now()}`, 50);

      try {
        // 1. Simulate existing v16 database where StoryGenerator defaulted to false
        const storeV16 = new IndexedDbDataStore(
          tempUpgradeDb,
          16,
          envConfig.metaStoreName,
        );
        await storeV16.connect();
        const seederV16 = new DatabaseSeeder(storeV16, logger);
        await seederV16.seed();
        const adminBefore = new IndexedDbAdminRepository(storeV16);
        const flagsBefore = await adminBefore.getAllFeatureFlags();
        const flagBefore = flagsBefore.find((f) => f.key === 'StoryGenerator');
        assertEqual(
          flagBefore?.isEnabled,
          false,
          'Fresh v16 seed must initially keep StoryGenerator disabled before v17 migration',
        );
        storeV16.close();

        // 2. Upgrade to v17 -> migration must enable StoryGenerator automatically
        const storeV17 = new IndexedDbDataStore(
          tempUpgradeDb,
          envConfig.databaseVersion,
          envConfig.metaStoreName,
        );
        try {
          await storeV17.connect();
          const adminAfter = new IndexedDbAdminRepository(storeV17);
          const flagsAfter = await adminAfter.getAllFeatureFlags();
          const flagAfter = flagsAfter.find((f) => f.key === 'StoryGenerator');
          assertEqual(
            flagAfter?.isEnabled,
            true,
            'Migration v17 must enable StoryGenerator on database upgrade',
          );
          const metaRecord = await storeV17.getMeta(
            STAGE25_STORY_GENERATOR_FLAG_META_KEY,
          );
          assert(
            Boolean(metaRecord && metaRecord.value === '1'),
            'Migration v17 must persist stage25 meta marker',
          );

          // Ensure helper stays idempotent even if Admin later toggles the flag off
          await adminAfter.upsertFeatureFlag({
            key: 'StoryGenerator',
            isEnabled: false,
          });
          await ensureStage25StoryGeneratorDefaultFlagAsync(storeV17);
          const afterRespect = (await adminAfter.getAllFeatureFlags()).find(
            (f) => f.key === 'StoryGenerator',
          );
          assertEqual(
            afterRespect?.isEnabled,
            false,
            'Startup flag helper must respect subsequent admin disable choice via meta marker',
          );

          const rawFlags = await storeV17.getAll<{
            key: string;
            isEnabled: boolean;
          }>(STORE_NAMES.FEATURE_FLAGS);
          assert(rawFlags.length >= 7, 'FeatureFlags store must remain intact after v17');
        } finally {
          storeV17.close();
        }
      } finally {
        logger.clearLogs();
        await deleteTempDatabaseAsync(tempUpgradeDb);
      }
    },
  },
];
