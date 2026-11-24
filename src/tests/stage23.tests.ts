import type { IClock } from '../core/abstractions/IClock';
import type { IAdminRepository } from '../core/abstractions/adminRepository';
import type { IContentRepository } from '../core/abstractions/contentRepository';
import type { IFilmRepository } from '../core/abstractions/filmRepository';
import type { ITaxonomyRepository } from '../core/abstractions/taxonomyRepository';
import type { IViewEventRepository } from '../core/abstractions/viewTracker';
import type { ViewEvent } from '../core/domain/analytics';
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
import type { FilmInfo } from '../core/domain/portals';
import type { FeatureFlag, SiteSetting } from '../core/domain/settings';
import type { AgeGroup, ImpactLevel, Person, Tag, Topic } from '../core/domain/taxonomy';
import { FilmPortalService } from '../core/services/filmPortalService';
import { PermissionPolicyService } from '../core/services/permissionPolicyService';
import { SearchNormalizer } from '../core/services/searchNormalizer';
import { ViewTrackerService } from '../core/services/viewTrackerService';
import { SystemClock } from '../infrastructure/clock/SystemClock';
import { envConfig } from '../infrastructure/config/envConfig';
import { IndexedDbBackupSnapshotProvider } from '../infrastructure/data/IndexedDbBackupSnapshotProvider';
import { IndexedDbDataStore } from '../infrastructure/data/IndexedDbDataStore';
import { IndexedDbFilmRepository } from '../infrastructure/data/IndexedDbFilmRepository';
import {
  DATABASE_MIGRATIONS,
  STAGE23_OBJECT_STORES,
  STORE_NAMES,
} from '../infrastructure/data/migrations';
import { INITIAL_AGE_GROUPS } from '../infrastructure/data/seed';
import { AppLogger } from '../infrastructure/logging/AppLogger';
import { assert, assertEqual, type UnitTestCase } from './testRunner';

class Stage23FakeClock implements IClock {
  private iso: string;
  private readonly inner = new SystemClock();

  constructor(initialIso = '2026-11-24T10:00:00.000Z') {
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

class MemoryStage23AdminRepository implements IAdminRepository {
  public users: AppUser[] = [];
  public permissions: StaffPermission[] = [];
  public flags: FeatureFlag[] = [{ key: 'Films', isEnabled: true }];
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

  public async deleteSessionsByUserId(_userId: number): Promise<void> {
    // No-op in memory double
  }

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

class MemoryStage23ContentRepository implements IContentRepository {
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

  public async userExists(_userId: number): Promise<boolean> {
    return true;
  }
}

class MemoryStage23TaxonomyRepository implements ITaxonomyRepository {
  public topics: Topic[] = [];
  public tags: Tag[] = [];
  public persons: Person[] = [];
  public impactLevels: ImpactLevel[] = [{ id: 1, name: 'آگاهی‌بخش', sortOrder: 1 }];
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

class MemoryStage23FilmRepository implements IFilmRepository {
  private map = new Map<number, FilmInfo>();

  public async getFilmInfoByContentIdAsync(contentId: number): Promise<FilmInfo | null> {
    const found = this.map.get(contentId);
    return found ? { ...found } : null;
  }

  public async getAllFilmInfosAsync(): Promise<FilmInfo[]> {
    return Array.from(this.map.values()).map((info) => ({ ...info }));
  }

  public async upsertFilmInfoAsync(info: FilmInfo): Promise<FilmInfo> {
    const copy: FilmInfo = { ...info };
    if (copy.isWeeklyPick) {
      return this.setWeeklyPickExclusiveAsync(copy.contentId, copy);
    }
    this.map.set(copy.contentId, copy);
    return { ...copy };
  }

  public async setWeeklyPickExclusiveAsync(
    contentId: number,
    infoToSave: FilmInfo,
  ): Promise<FilmInfo> {
    for (const [key, existing] of this.map.entries()) {
      if (key !== contentId && existing.isWeeklyPick) {
        this.map.set(key, { ...existing, isWeeklyPick: false });
      }
    }
    const target: FilmInfo = {
      ...infoToSave,
      contentId,
      isWeeklyPick: true,
    };
    this.map.set(contentId, target);
    return { ...target };
  }

  public async deleteFilmInfoByContentIdAsync(contentId: number): Promise<void> {
    this.map.delete(contentId);
  }
}

class MemoryStage23ViewEventRepository implements IViewEventRepository {
  public events: ViewEvent[] = [];
  private seq = 1;

  public async createViewEvent(event: Omit<ViewEvent, 'id'>): Promise<ViewEvent> {
    const created: ViewEvent = { ...event, id: this.seq++ };
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

function makeUser(id: number, role: 'SuperAdmin' | 'Staff' | 'Member'): AppUser {
  return {
    id,
    email: `${role.toLowerCase()}${id}@meraj.ir`,
    normalizedEmail: `${role.toLowerCase()}${id}@meraj.ir`,
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

function createStage23Harness() {
  const clock = new Stage23FakeClock();
  const logger = new AppLogger(clock, 'meraj_stage23_test_logs', 100);
  logger.clearLogs();

  const adminRepository = new MemoryStage23AdminRepository();
  const contentRepository = new MemoryStage23ContentRepository();
  const taxonomyRepository = new MemoryStage23TaxonomyRepository();
  const filmRepository = new MemoryStage23FilmRepository();
  const viewEventRepository = new MemoryStage23ViewEventRepository();
  const searchNormalizer = new SearchNormalizer();
  const policyService = new PermissionPolicyService(adminRepository, logger);

  const filmPortalService = new FilmPortalService({
    filmRepository,
    contentRepository,
    taxonomyRepository,
    adminRepository,
    policyService,
    logger,
    searchNormalizer,
  });

  const viewTrackerService = new ViewTrackerService(
    viewEventRepository,
    contentRepository,
    clock,
    logger,
    taxonomyRepository,
  );

  const superAdmin = makeUser(1, 'SuperAdmin');
  const staffWithPortals = makeUser(2, 'Staff');
  const staffWithoutPortals = makeUser(3, 'Staff');
  const member = makeUser(4, 'Member');
  adminRepository.users.push(superAdmin, staffWithPortals, staffWithoutPortals, member);
  adminRepository.permissions.push(
    {
      id: 1,
      userId: staffWithPortals.id,
      permissionKey: 'portals.manage',
      grantedAt: '2026-11-24T08:00:00.000Z',
      grantedById: superAdmin.id,
    },
    {
      id: 2,
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
    filmRepository,
    viewEventRepository,
    filmPortalService,
    viewTrackerService,
    searchNormalizer,
    superAdmin,
    staffWithPortals,
    staffWithoutPortals,
    member,
  };
}

async function seedFilmContent(
  harness: ReturnType<typeof createStage23Harness>,
  params: {
    title: string;
    slug: string;
    format?: ContentFormat;
    status?: ContentStatus;
    topicIds?: number[];
    ageGroupIds?: number[];
    publishedAt?: string;
    kind?: FilmInfo['kind'];
    releaseYear?: number | null;
    runtimeMinutes?: number | null;
    ageRatingNote?: string | null;
    isWeeklyPick?: boolean;
  },
): Promise<ContentItem> {
  const created = await harness.contentRepository.createContentItem({
    title: params.title,
    slug: params.slug,
    summary: `خلاصه ${params.title}`,
    body: '<p>متن معرفی فیلم</p>',
    format: params.format ?? 'Film',
    impactLevelId: 1,
    readWatchMinutes: params.runtimeMinutes ?? 45,
    thumbnailKey: null,
    status: params.status ?? ContentStatus.Published,
    isFeatured: false,
    languageCode: 'fa',
    viewCount: 0,
    downloadCount: 0,
    likeCount: 0,
    searchText: harness.searchNormalizer.normalize(`${params.title} ${params.slug}`),
    createdById: harness.superAdmin.id,
    publishedAt:
      (params.status ?? ContentStatus.Published) === ContentStatus.Published
        ? (params.publishedAt ?? '2026-11-24T09:00:00.000Z')
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

  if ((params.format ?? 'Film') === 'Film') {
    await harness.filmRepository.upsertFilmInfoAsync({
      contentId: created.id,
      kind: params.kind ?? 'Documentary',
      releaseYear: params.releaseYear ?? 1403,
      runtimeMinutes: params.runtimeMinutes ?? 50,
      ageRatingNote: params.ageRatingNote ?? null,
      isWeeklyPick: Boolean(params.isWeeklyPick),
    });
  }

  return created;
}

export const stage23Tests: UnitTestCase[] = [
  {
    id: 'stage23_feature_flag_lifecycle',
    nameKey: 'tests.stage23.featureFlagLifecycle.name',
    descriptionKey: 'tests.stage23.featureFlagLifecycle.desc',
    run: async () => {
      const h = createStage23Harness();
      try {
        const topicSci = await h.taxonomyRepository.createTopic({
          name: 'علم و فناوری',
          slug: 'science-tech',
          parentId: null,
          icon: null,
          sortOrder: 1,
          isActive: true,
        });

        await seedFilmContent(h, {
          title: 'مستند رصدخانه ملی',
          slug: 'observatory-doc',
          kind: 'Documentary',
          topicIds: [topicSci.id],
        });
        await seedFilmContent(h, {
          title: 'فیلم داستانی سپیده',
          slug: 'sepideh-film',
          kind: 'Film',
          topicIds: [topicSci.id],
        });
        await seedFilmContent(h, {
          title: 'پویانمایی کاوشگر',
          slug: 'explorer-anim',
          kind: 'Animation',
          topicIds: [topicSci.id],
        });
        await seedFilmContent(h, {
          title: 'فیلم پیش‌نویس پنهان',
          slug: 'draft-film',
          status: ContentStatus.Draft,
          kind: 'Film',
        });
        await seedFilmContent(h, {
          title: 'مقاله عادی غیرفیلم',
          slug: 'normal-article',
          format: 'Article',
          status: ContentStatus.Published,
        });

        // 1. Flag off -> both showcase and detail return not_found / disabled
        await h.adminRepository.upsertFeatureFlag({ key: 'Films', isEnabled: false });
        const disabledShowcase = await h.filmPortalService.getFilmPortalDataAsync(null);
        assertEqual(
          disabledShowcase.enabled,
          false,
          'Showcase must be disabled when FeatureFlag("Films") is false',
        );
        const disabledDetail = await h.filmPortalService.getPublicFilmDetailAsync(
          'observatory-doc',
          null,
        );
        assertEqual(
          disabledDetail.status,
          'not_found',
          'Detail must return not_found when FeatureFlag("Films") is false',
        );

        // 2. Flag on -> only Published format==='Film' are categorized
        await h.adminRepository.upsertFeatureFlag({ key: 'Films', isEnabled: true });
        const enabledShowcase = await h.filmPortalService.getFilmPortalDataAsync(null);
        assert(enabledShowcase.enabled, 'Showcase must be enabled when flag is true');
        assertEqual(
          enabledShowcase.data.allAllowedFilmsCount,
          3,
          'Exactly 3 Published Film items must appear (draft and Article excluded)',
        );
        assertEqual(enabledShowcase.data.countsByKind.Documentary, 1, '1 Documentary expected');
        assertEqual(enabledShowcase.data.countsByKind.Film, 1, '1 Film expected');
        assertEqual(enabledShowcase.data.countsByKind.Animation, 1, '1 Animation expected');
        assert(
          enabledShowcase.data.shelves.some((s) => s.id === 'kind:Documentary') &&
            enabledShowcase.data.shelves.some((s) => s.id === 'kind:Film') &&
            enabledShowcase.data.shelves.some((s) => s.id === 'kind:Animation') &&
            enabledShowcase.data.shelves.some((s) => s.id === `topic:${topicSci.id}`),
          'Showcase must expose non-empty kind and topic shelves',
        );
      } finally {
        h.logger.clearLogs();
      }
    },
  },
  {
    id: 'stage23_weekly_pick_exclusivity',
    nameKey: 'tests.stage23.weeklyPickExclusivity.name',
    descriptionKey: 'tests.stage23.weeklyPickExclusivity.desc',
    run: async () => {
      const h = createStage23Harness();
      const tempDbName = `MerajStage23_WeeklyPick_${Date.now()}`;
      try {
        const film1 = await seedFilmContent(h, {
          title: 'فیلم اول',
          slug: 'film-one',
          kind: 'Film',
        });
        const film2 = await seedFilmContent(h, {
          title: 'فیلم دوم',
          slug: 'film-two',
          kind: 'Documentary',
        });

        const res1 = await h.filmPortalService.setWeeklyPickAsync(h.superAdmin, film1.id);
        assert(res1.ok && res1.data?.isWeeklyPick === true, 'Film 1 must become weekly pick');

        const res2 = await h.filmPortalService.setWeeklyPickAsync(h.staffWithPortals, film2.id);
        assert(res2.ok && res2.data?.isWeeklyPick === true, 'Film 2 must become weekly pick');

        const allInfos = await h.filmRepository.getAllFilmInfosAsync();
        const weeklyPicks = allInfos.filter((i) => i.isWeeklyPick);
        assertEqual(weeklyPicks.length, 1, 'Strictly 1 FilmInfo may have isWeeklyPick === true');
        assertEqual(weeklyPicks[0].contentId, film2.id, 'Film 2 must be the sole weekly pick');

        const info1 = await h.filmRepository.getFilmInfoByContentIdAsync(film1.id);
        assertEqual(info1?.isWeeklyPick, false, 'Film 1 isWeeklyPick must be cleared automatically');

        // Verify transactional IndexedDbFilmRepository exclusivity against real IndexedDB v15
        if (typeof indexedDB !== 'undefined') {
          const store = new IndexedDbDataStore(
            tempDbName,
            envConfig.databaseVersion,
            envConfig.metaStoreName,
          );
          try {
            await store.connect();
            const idbRepo = new IndexedDbFilmRepository(store);
            await idbRepo.setWeeklyPickExclusiveAsync(101, {
              contentId: 101,
              kind: 'Film',
              releaseYear: 1403,
              runtimeMinutes: 80,
              ageRatingNote: null,
              isWeeklyPick: true,
            });
            await idbRepo.setWeeklyPickExclusiveAsync(102, {
              contentId: 102,
              kind: 'Animation',
              releaseYear: 1404,
              runtimeMinutes: 35,
              ageRatingNote: null,
              isWeeklyPick: true,
            });
            const persisted = await idbRepo.getAllFilmInfosAsync();
            const activePicks = persisted.filter((p) => p.isWeeklyPick);
            assertEqual(
              activePicks.length,
              1,
              'IndexedDbFilmRepository must leave strictly 1 weekly pick',
            );
            assertEqual(
              activePicks[0].contentId,
              102,
              'IndexedDbFilmRepository must keep latest weekly pick (102)',
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
    id: 'stage23_child_safety_on_showcase_and_detail',
    nameKey: 'tests.stage23.childSafetyOnShowcaseAndDetail.name',
    descriptionKey: 'tests.stage23.childSafetyOnShowcaseAndDetail.desc',
    run: async () => {
      const h = createStage23Harness();
      try {
        const childAge = h.taxonomyRepository.ageGroups.find((g) => g.key === 'child')!;
        const adultAge = h.taxonomyRepository.ageGroups.find((g) => g.key === 'adult')!;

        const historyTopic = await h.taxonomyRepository.createTopic({
          name: 'تاریخ',
          slug: 'history',
          parentId: null,
          icon: null,
          sortOrder: 1,
          isActive: true,
        });

        await seedFilmContent(h, {
          title: 'مستند تحلیلی بزرگسالان',
          slug: 'adult-only-doc',
          topicIds: [historyTopic.id],
          ageGroupIds: [adultAge.id],
          isWeeklyPick: true,
        });
        await seedFilmContent(h, {
          title: 'پویانمایی کودکانه تاریخ',
          slug: 'child-friendly-anim',
          kind: 'Animation',
          topicIds: [historyTopic.id],
          ageGroupIds: [childAge.id],
          isWeeklyPick: false,
        });

        // For child: adult film (even as WeeklyPick) is stripped from weeklyPick, items, shelves, and detail 404
        const childShowcase = await h.filmPortalService.getFilmPortalDataAsync(childAge);
        assert(childShowcase.enabled, 'Showcase must be enabled');
        assertEqual(
          childShowcase.data.weeklyPick,
          null,
          'Adult weekly pick must not be exposed to child age group',
        );
        assertEqual(childShowcase.data.items.length, 1, 'Only child-allowed film may appear');
        assertEqual(
          childShowcase.data.items[0].item.slug,
          'child-friendly-anim',
          'Child showcase item must be child-friendly-anim',
        );

        const blockedDetail = await h.filmPortalService.getPublicFilmDetailAsync(
          'adult-only-doc',
          childAge,
        );
        assertEqual(
          blockedDetail.status,
          'not_found',
          'Direct #/films/:slug for adult-only film must return not_found for child',
        );

        const childDetail = await h.filmPortalService.getPublicFilmDetailAsync(
          'child-friendly-anim',
          childAge,
        );
        assertEqual(childDetail.status, 'ok', 'Child-friendly film detail must load for child');
        if (childDetail.status === 'ok') {
          assertEqual(
            childDetail.data.relatedFilms.length,
            0,
            'Adult-only film must never leak into child relatedFilms',
          );
        }

        // For adult: both films are visible and adult weeklyPick is active
        const adultDetail = await h.filmPortalService.getPublicFilmDetailAsync(
          'adult-only-doc',
          adultAge,
        );
        assertEqual(adultDetail.status, 'ok', 'Adult film detail must load for adult');
        if (adultDetail.status === 'ok') {
          assertEqual(
            adultDetail.data.relatedFilms.length,
            1,
            'Related film visible for adult age group',
          );
        }
      } finally {
        h.logger.clearLogs();
      }
    },
  },
  {
    id: 'stage23_detail_sources_playback_and_view_tracker',
    nameKey: 'tests.stage23.detailSourcesPlaybackAndViewTracker.name',
    descriptionKey: 'tests.stage23.detailSourcesPlaybackAndViewTracker.desc',
    run: async () => {
      const h = createStage23Harness();
      try {
        const rootTopic = await h.taxonomyRepository.createTopic({
          name: 'فرهنگ و هنر',
          slug: 'culture-art',
          parentId: null,
          icon: null,
          sortOrder: 1,
          isActive: true,
        });

        const filmItem = await seedFilmContent(h, {
          title: 'مستند معماری ایرانی',
          slug: 'iranian-architecture-doc',
          kind: 'Documentary',
          releaseYear: 1403,
          runtimeMinutes: 64,
          ageRatingNote: 'مناسب تمامی گروه‌های سنی بالای ۷ سال',
          isWeeklyPick: true,
          topicIds: [rootTopic.id],
        });

        await h.contentRepository.replaceSources(filmItem.id, [
          {
            contentId: filmItem.id,
            title: 'دایرةالمعارف معماری ایران، ج ۲',
            url: 'https://example.ir/architecture-ref',
            note: 'فصل چهارم',
            sortOrder: 1,
          },
        ]);
        await h.contentRepository.replaceFiles(filmItem.id, [
          {
            contentId: filmItem.id,
            kind: ContentFileKind.Main,
            storageType: FileStorageType.External,
            storageKey: null,
            externalUrl: 'https://www.aparat.com/v/abc123xyz',
            originalFileName: 'aparat-stream',
            mimeType: 'text/html',
            sizeBytes: null,
            isDownloadable: false,
            sortOrder: 1,
          },
        ]);

        const detailRes = await h.filmPortalService.getPublicFilmDetailAsync(
          'iranian-architecture-doc',
          null,
        );
        assertEqual(detailRes.status, 'ok', 'Published film detail must return ok');
        if (detailRes.status === 'ok') {
          assertEqual(detailRes.data.filmInfo.kind, 'Documentary', 'Kind must match Documentary');
          assertEqual(detailRes.data.filmInfo.releaseYear, 1403, 'Release year must match 1403');
          assertEqual(detailRes.data.filmInfo.runtimeMinutes, 64, 'Runtime must match 64 min');
          assertEqual(detailRes.data.sources.length, 1, 'Must return verified sources');
          assertEqual(
            detailRes.data.sources[0].url,
            'https://example.ir/architecture-ref',
            'Source URL must be preserved',
          );

          const validEmbed = h.filmPortalService.resolveEmbedUrl(
            detailRes.data.files[0].externalUrl,
          );
          assertEqual(
            validEmbed,
            'https://www.aparat.com/video/video/embed/videohash/abc123xyz/vt/frame',
            'Aparat URL must convert to safe embed URL',
          );
          assertEqual(
            h.filmPortalService.resolveEmbedUrl('https://evil.example.com/v/123'),
            null,
            'Non-whitelisted embed domain must return null',
          );

          // ViewTracker 30-min deduplication rule
          const v1 = await h.viewTrackerService.trackViewAsync({
            contentId: detailRes.data.item.id,
            userId: null,
            visitorId: 'vis-film-1',
            userAgent: 'Mozilla/5.0',
            ageGroupId: 4,
            primaryTopicId: detailRes.data.primaryRootTopicId,
          });
          assertEqual(v1.isCounted, true, 'First film view must be counted');

          h.clock.setUtcIso('2026-11-24T10:15:00.000Z');
          const v2 = await h.viewTrackerService.trackViewAsync({
            contentId: detailRes.data.item.id,
            userId: null,
            visitorId: 'vis-film-1',
            userAgent: 'Mozilla/5.0',
            ageGroupId: 4,
            primaryTopicId: detailRes.data.primaryRootTopicId,
          });
          assertEqual(v2.isCounted, false, 'View within 30 minutes must not double-count');

          const updatedItem = await h.contentRepository.getContentItemById(filmItem.id);
          assertEqual(updatedItem?.viewCount, 1, 'Content viewCount must equal 1');
        }
      } finally {
        h.logger.clearLogs();
      }
    },
  },
  {
    id: 'stage23_rbac_and_indexeddb_v15',
    nameKey: 'tests.stage23.rbacAndIndexedDbV15.name',
    descriptionKey: 'tests.stage23.rbacAndIndexedDbV15.desc',
    run: async () => {
      const h = createStage23Harness();
      const tempDbName = `MerajStage23_V15_${Date.now()}`;
      try {
        const filmItem = await seedFilmContent(h, {
          title: 'فیلم آزمون دسترسی',
          slug: 'rbac-film-test',
        });

        // Member -> 404
        const memberRes = await h.filmPortalService.setWeeklyPickAsync(h.member, filmItem.id);
        assertEqual(memberRes.ok, false, 'Member cannot manage portals');
        assertEqual(memberRes.statusCode, 404, 'Member must receive 404');

        // Staff without portals.manage -> 403 + WARN log
        h.logger.clearLogs();
        const deniedRes = await h.filmPortalService.listAdminFilmsAsync(h.staffWithoutPortals);
        assertEqual(deniedRes.ok, false, 'Staff without portals.manage must be denied');
        assertEqual(deniedRes.statusCode, 403, 'Staff without portals.manage must receive 403');
        assert(
          h.logger.getLogs().some((log) => log.level === 'WARN'),
          '403 denial must emit WARN security log',
        );

        // Staff with portals.manage -> 200
        const allowedList = await h.filmPortalService.listAdminFilmsAsync(h.staffWithPortals);
        assertEqual(allowedList.ok, true, 'Staff with portals.manage can list admin films');
        assertEqual(allowedList.statusCode, 200, 'Staff with portals.manage gets 200');

        // Persian digits input normalization check on FilmInfo
        const persianDigitsSave = await h.filmPortalService.upsertFilmInfoAsync(
          h.staffWithPortals,
          {
            contentId: filmItem.id,
            kind: 'Animation',
            releaseYear: '۱۴۰۴',
            runtimeMinutes: '۷۲',
            ageRatingNote: 'دارای راهنمای سنی آزمایشی',
            isWeeklyPick: true,
          },
          { sourceContext: 'portals' },
        );
        assertEqual(persianDigitsSave.ok, true, 'Persian numerals must parse cleanly');
        assertEqual(persianDigitsSave.data?.releaseYear, 1404, 'Year 1404 stored');
        assertEqual(persianDigitsSave.data?.runtimeMinutes, 72, 'Runtime 72 stored');

        // IndexedDB v15 schema & Backup snapshot round-trip check
        assert(
          envConfig.databaseVersion >= 15,
          `envConfig.databaseVersion must be >= 15 (actual=${envConfig.databaseVersion})`,
        );
        assert(
          DATABASE_MIGRATIONS.some((m) => m.version === 15),
          'DATABASE_MIGRATIONS must contain version 15',
        );
        assert(
          STAGE23_OBJECT_STORES.includes(STORE_NAMES.FILM_INFOS),
          'STAGE23_OBJECT_STORES must include filmInfos',
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
              storeNames.includes(STORE_NAMES.FILM_INFOS),
              'IndexedDB v15 must contain filmInfos store',
            );
            const idbRepo = new IndexedDbFilmRepository(store);
            await idbRepo.setWeeklyPickExclusiveAsync(filmItem.id, {
              contentId: filmItem.id,
              kind: 'Documentary',
              releaseYear: 1403,
              runtimeMinutes: 55,
              ageRatingNote: 'مناسب همه',
              isWeeklyPick: true,
            });
            const snapshotProvider = new IndexedDbBackupSnapshotProvider(store);
            const exported = await snapshotProvider.exportFullSnapshotAsync();
            assert(
              Array.isArray(exported.tables[STORE_NAMES.FILM_INFOS]) &&
                exported.tables[STORE_NAMES.FILM_INFOS].length === 1,
              'Backup snapshot export must dynamically include filmInfos rows',
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
