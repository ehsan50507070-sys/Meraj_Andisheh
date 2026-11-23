import type { IClock } from '../core/abstractions/IClock';
import type { IAdminRepository } from '../core/abstractions/adminRepository';
import type { IAuthRepository } from '../core/abstractions/authRepository';
import type { IContentRepository } from '../core/abstractions/contentRepository';
import type { IContentRequestRepository } from '../core/abstractions/contentRequestRepository';
import type { ITaxonomyRepository } from '../core/abstractions/taxonomyRepository';
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
import type {
  AgeGroup,
  ImpactLevel,
  Person,
  Tag,
  Topic,
} from '../core/domain/taxonomy';
import {
  ContentRequestService,
  REQUEST_ADMIN_NOTE_MAX_LENGTH,
  REQUEST_DESCRIPTION_MAX_LENGTH,
  REQUEST_TITLE_MAX_LENGTH,
  validateOptionalRequestLink,
} from '../core/services/contentRequestService';
import { PermissionPolicyService } from '../core/services/permissionPolicyService';
import { SearchNormalizer } from '../core/services/searchNormalizer';
import { SystemClock } from '../infrastructure/clock/SystemClock';
import { envConfig } from '../infrastructure/config/envConfig';
import { IndexedDbAdminRepository } from '../infrastructure/data/IndexedDbAdminRepository';
import { IndexedDbAuthRepository } from '../infrastructure/data/IndexedDbAuthRepository';
import { IndexedDbContentRepository } from '../infrastructure/data/IndexedDbContentRepository';
import { IndexedDbContentRequestRepository } from '../infrastructure/data/IndexedDbContentRequestRepository';
import { IndexedDbDataStore } from '../infrastructure/data/IndexedDbDataStore';
import { IndexedDbTaxonomyRepository } from '../infrastructure/data/IndexedDbTaxonomyRepository';
import {
  DATABASE_MIGRATIONS,
  STAGE17_OBJECT_STORES,
  STORE_NAMES,
} from '../infrastructure/data/migrations';
import { INITIAL_AGE_GROUPS } from '../infrastructure/data/seed';
import { AppLogger } from '../infrastructure/logging/AppLogger';
import { assert, assertEqual, type UnitTestCase } from './testRunner';

class Stage17FakeClock implements IClock {
  private iso: string;
  private readonly inner = new SystemClock();

  constructor(initialIso = '2026-11-23T12:00:00.000Z') {
    this.iso = initialIso;
  }

  public advanceMinutes(minutes: number): void {
    this.iso = new Date(this.now().getTime() + minutes * 60 * 1000).toISOString();
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

class MemoryStage17Harness
  implements
    IContentRequestRepository,
    IContentRepository,
    ITaxonomyRepository,
    IAdminRepository
{
  private users: AppUser[] = [];
  private staffPermissions: StaffPermission[] = [];
  private featureFlags: FeatureFlag[] = FEATURE_FLAG_KEYS.map((key) => ({
    key,
    isEnabled: key === 'ContentRequests',
  }));
  private siteSettings: SiteSetting[] = [];

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
  private requests: ContentRequestItem[] = [];

  private userSeq = 20;
  private permSeq = 1;
  private topicSeq = 1;
  private tagSeq = 1;
  private personSeq = 1;
  private impactSeq = 10;
  private itemSeq = 1;
  private sourceSeq = 1;
  private fileSeq = 1;
  private requestSeq = 1;

  public async seedUser(partial: Partial<AppUser>): Promise<AppUser> {
    const id = ++this.userSeq;
    const user: AppUser = {
      id,
      email: partial.email ?? `user${id}@meraj.ir`,
      normalizedEmail: (partial.email ?? `user${id}@meraj.ir`).toUpperCase(),
      emailConfirmed: true,
      phoneNumber: partial.phoneNumber ?? null,
      normalizedPhoneNumber: partial.normalizedPhoneNumber ?? null,
      phoneNumberConfirmed: Boolean(partial.phoneNumber),
      passwordHash: null,
      passwordSalt: null,
      displayName: partial.displayName ?? `کاربر ${id}`,
      role: partial.role ?? 'Member',
      ageGroupId: partial.ageGroupId ?? 3,
      personalizationEnabled: false,
      mustChangePassword: false,
      isActive: partial.isActive ?? true,
      isDeleted: partial.isDeleted ?? false,
      deletedAt: partial.deletedAt ?? null,
      failedLoginCount: 0,
      lockoutEnd: null,
      createdAt: partial.createdAt ?? '2026-11-23T08:00:00.000Z',
      lastLoginAt: partial.lastLoginAt ?? null,
    };
    this.users.push(user);
    return user;
  }

  public getAgeGroupByKey(key: AgeGroup['key']): AgeGroup {
    const found = this.ageGroups.find((g) => g.key === key);
    if (!found) {
      throw new Error(`AgeGroup ${key} missing in harness`);
    }
    return { ...found };
  }

  public async grantStaffPermission(
    userId: number,
    permissionKey: PermissionKey,
  ): Promise<void> {
    this.staffPermissions.push({
      id: ++this.permSeq,
      userId,
      permissionKey,
      grantedById: 0,
      grantedAt: '2026-11-23T08:00:00.000Z',
    });
  }

  public async seedContent(params: {
    title: string;
    slug: string;
    status: ContentStatus;
    ageGroupIds?: number[];
  }): Promise<ContentItem> {
    const item = await this.createContentItem({
      title: params.title,
      slug: params.slug,
      summary: 'خلاصه کوتاه محتوا',
      body: 'متن آزمایشی محتوا',
      format: 'Article',
      impactLevelId: 1,
      status: params.status,
      publishedAt:
        params.status === ContentStatus.Published
          ? '2026-11-23T09:00:00.000Z'
          : null,
      readWatchMinutes: 6,
      thumbnailKey: null,
      isFeatured: false,
      languageCode: 'fa',
      searchText: params.title,
      viewCount: 0,
      downloadCount: 0,
      likeCount: 0,
      createdById: 1,
      createdAt: '2026-11-23T09:00:00.000Z',
      updatedAt: '2026-11-23T09:00:00.000Z',
    });
    if (params.ageGroupIds && params.ageGroupIds.length > 0) {
      await this.replaceContentAgeGroups(item.id, params.ageGroupIds);
    }
    return item;
  }

  // IContentRequestRepository
  public async getContentRequestById(
    id: number,
  ): Promise<ContentRequestItem | null> {
    const found = this.requests.find((r) => r.id === id);
    return found ? { ...found } : null;
  }

  public async getContentRequestsByUserId(
    userId: number,
  ): Promise<ContentRequestItem[]> {
    return this.requests.filter((r) => r.userId === userId).map((r) => ({ ...r }));
  }

  public async getAllContentRequests(): Promise<ContentRequestItem[]> {
    return this.requests.map((r) => ({ ...r }));
  }

  public async createContentRequest(
    request: Omit<ContentRequestItem, 'id'>,
  ): Promise<ContentRequestItem> {
    const created: ContentRequestItem = { ...request, id: ++this.requestSeq };
    this.requests.push(created);
    return { ...created };
  }

  public async updateContentRequest(request: ContentRequestItem): Promise<void> {
    this.requests = this.requests.map((r) =>
      r.id === request.id ? { ...request } : r,
    );
  }

  public async deleteContentRequest(id: number): Promise<void> {
    this.requests = this.requests.filter((r) => r.id !== id);
  }

  // IAdminRepository
  public async getAllUsers(): Promise<AppUser[]> {
    return this.users.map((u) => ({ ...u }));
  }

  public async getUserById(userId: number): Promise<AppUser | null> {
    const found = this.users.find((u) => u.id === userId);
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

  public async createUser(user: Omit<AppUser, 'id'>): Promise<AppUser> {
    const created: AppUser = { ...user, id: ++this.userSeq };
    this.users.push(created);
    return { ...created };
  }

  public async updateUser(user: AppUser): Promise<void> {
    this.users = this.users.map((u) => (u.id === user.id ? { ...user } : u));
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
    const inserted = permissions.map((p) => ({ ...p, id: ++this.permSeq }));
    this.staffPermissions.push(...inserted);
    return inserted.map((p) => ({ ...p }));
  }

  public async deleteSessionsByUserId(_userId: number): Promise<void> {
    // No-op in memory harness
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
      const idx = this.siteSettings.findIndex((item) => item.key === s.key);
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
      g.id === ageGroup.id ? ageGroup : g,
    );
  }

  public async getAllTopics(): Promise<Topic[]> {
    return [...this.topics];
  }

  public async getTopicById(id: number): Promise<Topic | null> {
    return this.topics.find((t) => t.id === id) ?? null;
  }

  public async createTopic(topic: Omit<Topic, 'id'>): Promise<Topic> {
    const created = { ...topic, id: ++this.topicSeq };
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
    const created = { ...tag, id: ++this.tagSeq };
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
    const created = { ...person, id: ++this.personSeq };
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

  public async createImpactLevel(
    level: Omit<ImpactLevel, 'id'>,
  ): Promise<ImpactLevel> {
    const created = { ...level, id: ++this.impactSeq };
    this.impactLevels.push(created);
    return created;
  }

  public async updateImpactLevel(level: ImpactLevel): Promise<void> {
    this.impactLevels = this.impactLevels.map((i) =>
      i.id === level.id ? level : i,
    );
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

  public async countContentItemsByImpactLevelId(
    impactLevelId: number,
  ): Promise<number> {
    return this.items.filter((i) => i.impactLevelId === impactLevelId).length;
  }

  public async linkContentTopic(
    contentId: number,
    topicId: number,
  ): Promise<void> {
    this.contentTopics.push({ contentId, topicId });
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

  public async createContentItem(
    item: Omit<ContentItem, 'id'>,
  ): Promise<ContentItem> {
    const created = { ...item, id: ++this.itemSeq };
    this.items.push(created);
    return created;
  }

  public async updateContentItem(item: ContentItem): Promise<void> {
    this.items = this.items.map((i) => (i.id === item.id ? item : i));
  }

  public async getSourcesByContentId(
    contentId: number,
  ): Promise<ContentSource[]> {
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
    const created = sources.map((s) => ({ ...s, id: ++this.sourceSeq }));
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
    const created = files.map((f) => ({ ...f, id: ++this.fileSeq }));
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
    return [...this.contentTags];
  }

  public async replaceContentTags(
    contentId: number,
    tagIds: number[],
  ): Promise<void> {
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
}

function createStage17Service(harness: MemoryStage17Harness, clock: IClock) {
  const logger = new AppLogger(clock, 'meraj_stage17_test_logs', 100);
  logger.clearLogs();
  const permissionPolicyService = new PermissionPolicyService(harness, logger);
  const service = new ContentRequestService({
    contentRequestRepository: harness,
    contentRepository: harness,
    adminRepository: harness,
    taxonomyRepository: harness,
    permissionPolicyService,
    searchNormalizer: new SearchNormalizer(),
    clock,
    logger,
    deletedDisplayName: 'کاربر حذف‌شده',
  });
  return { service, logger };
}

export const stage17Tests: UnitTestCase[] = [
  {
    id: 'stage17-max3-open-limit-and-free-slot',
    nameKey: 'tests.stage17.max3OpenLimitAndFreeSlot.name',
    descriptionKey: 'tests.stage17.max3OpenLimitAndFreeSlot.desc',
    run: async () => {
      const clock = new Stage17FakeClock();
      const harness = new MemoryStage17Harness();
      const { service } = createStage17Service(harness, clock);

      const member = await harness.seedUser({ displayName: 'عضو فعال' });
      const staff = await harness.seedUser({
        displayName: 'همکار درخواست‌ها',
        role: 'Staff',
      });
      await harness.grantStaffPermission(staff.id, 'requests.manage');

      const r1 = await service.submitContentRequestAsync(member, {
        title: 'درخواست اول',
        description: 'شرح درخواست اول برای بررسی',
      });
      clock.advanceMinutes(1);
      const r2 = await service.submitContentRequestAsync(member, {
        title: 'درخواست دوم',
        description: 'شرح درخواست دوم برای بررسی',
      });
      clock.advanceMinutes(1);
      const r3 = await service.submitContentRequestAsync(member, {
        title: 'درخواست سوم',
        description: 'شرح درخواست سوم برای بررسی',
      });

      assertEqual(r1.ok, true, 'First request must succeed');
      assertEqual(r1.statusCode, 201, 'First request statusCode should be 201');
      assertEqual(
        r1.request?.status,
        ContentRequestStatus.Submitted,
        'Initial status must be Submitted',
      );
      assertEqual(r2.ok, true, 'Second request must succeed');
      assertEqual(r3.ok, true, 'Third request must succeed');
      assertEqual(r3.openCount, 3, 'Open count after 3 submits must be 3');

      const blocked1 = await service.submitContentRequestAsync(member, {
        title: 'درخواست چهارم مسدود',
        description: 'نباید ثبت شود چون ۳ مورد باز وجود دارد',
      });
      assertEqual(blocked1.ok, false, '4th request must be rejected');
      assertEqual(blocked1.statusCode, 429, '4th request statusCode should be 429');
      assertEqual(
        blocked1.errorCode,
        'MAX_OPEN_REQUESTS_REACHED',
        'Error code should be MAX_OPEN_REQUESTS_REACHED',
      );

      clock.advanceMinutes(1);
      const toInProgress = await service.updateContentRequestByAdminAsync(
        staff,
        r1.request!.id,
        { status: ContentRequestStatus.InProgress },
      );
      assertEqual(toInProgress.ok, true, 'Transition to InProgress should succeed');

      const blocked2 = await service.submitContentRequestAsync(member, {
        title: 'درخواست چهارم در حال انجام',
        description: 'InProgress همچنان درخواست باز محسوب می‌شود',
      });
      assertEqual(blocked2.ok, false, 'InProgress should still count toward max 3');
      assertEqual(
        blocked2.errorCode,
        'MAX_OPEN_REQUESTS_REACHED',
        'Blocked InProgress error code',
      );

      clock.advanceMinutes(1);
      const toDone = await service.updateContentRequestByAdminAsync(
        staff,
        r1.request!.id,
        { status: ContentRequestStatus.Done, adminNote: 'تولید شد' },
      );
      assertEqual(toDone.ok, true, 'Transition to Done should succeed');

      clock.advanceMinutes(1);
      const r4 = await service.submitContentRequestAsync(member, {
        title: 'درخواست چهارم آزادشده',
        description: 'پس از Done شدن درخواست اول باید ثبت شود',
      });
      assertEqual(r4.ok, true, '4th request must succeed after Done');
      assertEqual(r4.openCount, 3, 'Open count should be 3 again');

      clock.advanceMinutes(1);
      const toRejected = await service.updateContentRequestByAdminAsync(
        staff,
        r2.request!.id,
        { status: ContentRequestStatus.Rejected, adminNote: 'تکراری است' },
      );
      assertEqual(toRejected.ok, true, 'Transition to Rejected should succeed');

      const r5 = await service.submitContentRequestAsync(member, {
        title: 'درخواست پنجم بعد از رد',
        description: 'پس از Rejected شدن درخواست دوم باید ثبت شود',
      });
      assertEqual(r5.ok, true, '5th request must succeed after Rejected');
      assertEqual(r5.openCount, 3, 'Open count remains 3');
    },
  },
  {
    id: 'stage17-validation-and-safe-link',
    nameKey: 'tests.stage17.validationAndSafeLink.name',
    descriptionKey: 'tests.stage17.validationAndSafeLink.desc',
    run: async () => {
      const clock = new Stage17FakeClock();
      const harness = new MemoryStage17Harness();
      const { service } = createStage17Service(harness, clock);

      const member = await harness.seedUser({ displayName: 'کاربر اعتبارسنجی' });
      const superAdmin = await harness.seedUser({
        displayName: 'مدیرکل',
        role: 'SuperAdmin',
      });

      const guestRes = await service.submitContentRequestAsync(null, {
        title: 'عنوان',
        description: 'توضیح',
      });
      assertEqual(guestRes.ok, false, 'Guest submit must fail');
      assertEqual(guestRes.statusCode, 401, 'Guest submit returns 401');
      assertEqual(guestRes.errorCode, 'AUTH_REQUIRED', 'Guest errorCode AUTH_REQUIRED');

      const emptyTitle = await service.submitContentRequestAsync(member, {
        title: '   ',
        description: 'توضیح معتبر',
      });
      assertEqual(
        emptyTitle.errorCode,
        'REQUEST_TITLE_INVALID',
        'Empty title rejected',
      );

      const longTitle = await service.submitContentRequestAsync(member, {
        title: 'آ'.repeat(REQUEST_TITLE_MAX_LENGTH + 1),
        description: 'توضیح معتبر',
      });
      assertEqual(
        longTitle.errorCode,
        'REQUEST_TITLE_INVALID',
        'Title > 150 chars rejected',
      );

      const emptyDesc = await service.submitContentRequestAsync(member, {
        title: 'عنوان معتبر',
        description: '  ',
      });
      assertEqual(
        emptyDesc.errorCode,
        'REQUEST_DESCRIPTION_INVALID',
        'Empty description rejected',
      );

      const longDesc = await service.submitContentRequestAsync(member, {
        title: 'عنوان معتبر',
        description: 'ب'.repeat(REQUEST_DESCRIPTION_MAX_LENGTH + 1),
      });
      assertEqual(
        longDesc.errorCode,
        'REQUEST_DESCRIPTION_INVALID',
        'Description > 2000 chars rejected',
      );

      for (const badLink of [
        'javascript:alert(1)',
        'JAVASCRIPT:confirm(1)',
        'data:text/html,<script>alert(1)</script>',
        'ftp://files.example.com/test',
        'not-a-valid-url',
      ]) {
        const check = validateOptionalRequestLink(badLink);
        assertEqual(check.ok, false, `Link must fail helper validation: ${badLink}`);
        const badRes = await service.submitContentRequestAsync(member, {
          title: 'عنوان معتبر',
          description: 'توضیح معتبر',
          link: badLink,
        });
        assertEqual(badRes.ok, false, `Service must reject link: ${badLink}`);
        assertEqual(
          badRes.errorCode,
          'REQUEST_LINK_INVALID',
          `Invalid link errorCode for ${badLink}`,
        );
      }

      const validRes = await service.submitContentRequestAsync(member, {
        title: '<script>alert("xss")</script> اقتصاد مقاومتی',
        description: 'توضیح با تگ <b>ساده</b> برای نمایش متنی امن',
        link: 'https://meraj.ir/research/economics?ref=1',
      });
      assertEqual(validRes.ok, true, 'Valid https request must pass');
      assertEqual(
        validRes.request?.title,
        '<script>alert("xss")</script> اقتصاد مقاومتی',
        'Title should preserve raw text cleanly',
      );
      assertEqual(
        validRes.request?.link,
        'https://meraj.ir/research/economics?ref=1',
        'Valid https link stored intact',
      );

      const tooLongNote = await service.updateContentRequestByAdminAsync(
        superAdmin,
        validRes.request!.id,
        {
          status: ContentRequestStatus.InProgress,
          adminNote: 'ج'.repeat(REQUEST_ADMIN_NOTE_MAX_LENGTH + 1),
        },
      );
      assertEqual(tooLongNote.ok, false, 'Admin note > 1000 rejected');
      assertEqual(
        tooLongNote.errorCode,
        'ADMIN_NOTE_TOO_LONG',
        'Error code ADMIN_NOTE_TOO_LONG',
      );
    },
  },
  {
    id: 'stage17-rbac-and-privacy-isolation',
    nameKey: 'tests.stage17.rbacAndPrivacyIsolation.name',
    descriptionKey: 'tests.stage17.rbacAndPrivacyIsolation.desc',
    run: async () => {
      const clock = new Stage17FakeClock();
      const harness = new MemoryStage17Harness();
      const { service, logger } = createStage17Service(harness, clock);

      const memberA = await harness.seedUser({ displayName: 'عضو الف' });
      const memberB = await harness.seedUser({ displayName: 'عضو ب' });
      const deletedUser = await harness.seedUser({
        displayName: 'کاربر حذف‌شده',
        isActive: false,
        isDeleted: true,
        deletedAt: '2026-11-23T11:00:00.000Z',
      });
      await harness.createContentRequest({
        userId: deletedUser.id,
        title: 'درخواست کاربر قدیمی',
        description: 'این درخواست پیش از حذف حساب ثبت شده است.',
        link: null,
        status: ContentRequestStatus.Submitted,
        adminNote: null,
        linkedContentId: null,
        createdAt: '2026-11-23T10:00:00.000Z',
        updatedAt: '2026-11-23T10:00:00.000Z',
      });

      const staffNoPerm = await harness.seedUser({
        displayName: 'همکار بی‌دسترسی',
        role: 'Staff',
      });
      const staffWithPerm = await harness.seedUser({
        displayName: 'همکار مجاز درخواست',
        role: 'Staff',
      });
      await harness.grantStaffPermission(staffWithPerm.id, 'requests.manage');

      const created = await service.submitContentRequestAsync(memberA, {
        title: 'درخواست خصوصی الف',
        description: 'فقط الف و مدیر مجاز باید آن را ببینند.',
      });
      assertEqual(created.ok, true, 'memberA submit succeeds');

      const spyB = await service.listUserContentRequestsAsync(
        memberB,
        memberA.id,
      );
      assertEqual(spyB.ok, false, 'memberB cannot list memberA requests');
      assertEqual(spyB.statusCode, 403, 'memberB spy returns 403');
      assertEqual(spyB.errorCode, 'FORBIDDEN', 'memberB spy errorCode FORBIDDEN');

      const spyGuest = await service.listUserContentRequestsAsync(
        null,
        memberA.id,
      );
      assertEqual(spyGuest.ok, false, 'Guest cannot list user requests');
      assertEqual(spyGuest.statusCode, 403, 'Guest list returns 403');

      const selfRead = await service.listUserContentRequestsAsync(
        memberA,
        memberA.id,
      );
      assertEqual(selfRead.ok, true, 'Self read succeeds');
      assertEqual(selfRead.items?.length, 1, 'Self read returns 1 item');

      const memberAdminTry = await service.listAdminContentRequestsAsync(memberA);
      assertEqual(memberAdminTry.ok, false, 'Member blocked from admin list');
      assertEqual(memberAdminTry.statusCode, 404, 'Member gets 404 on admin API');

      logger.clearLogs();
      const noPermList = await service.listAdminContentRequestsAsync(staffNoPerm);
      assertEqual(noPermList.ok, false, 'Staff without permission denied');
      assertEqual(noPermList.statusCode, 403, 'Staff without permission gets 403');
      assertEqual(noPermList.errorCode, 'FORBIDDEN', 'Denied staff errorCode');

      const noPermUpdate = await service.updateContentRequestByAdminAsync(
        staffNoPerm,
        created.request!.id,
        { status: ContentRequestStatus.InProgress },
      );
      assertEqual(noPermUpdate.ok, false, 'Staff without permission cannot update');
      assertEqual(noPermUpdate.statusCode, 403, 'Staff update denied gets 403');

      const warnLogs = logger.getLogs().filter((l) => l.level === 'WARN');
      assert(warnLogs.length >= 2, 'Denied staff access must produce WARN logs');

      const permList = await service.listAdminContentRequestsAsync(staffWithPerm);
      assertEqual(permList.ok, true, 'Permitted staff sees all requests');
      assertEqual(permList.statusCode, 200, 'Permitted staff statusCode 200');
      assertEqual(permList.items?.length, 2, 'Permitted staff sees 2 rows');

      const deletedRow = permList.items?.find(
        (r) => r.request.userId === deletedUser.id,
      );
      assert(
        deletedRow !== undefined,
        'Deleted user request must remain readable in admin',
      );
      assertEqual(
        deletedRow?.requesterDisplayName,
        'کاربر حذف‌شده',
        'Deleted requester displays safe label',
      );
      assertEqual(
        deletedRow?.isRequesterDeleted,
        true,
        'Deleted requester flag is true',
      );

      const permUpdate = await service.updateContentRequestByAdminAsync(
        staffWithPerm,
        created.request!.id,
        {
          status: ContentRequestStatus.InProgress,
          adminNote: 'در صف پژوهش است',
        },
      );
      assertEqual(permUpdate.ok, true, 'Permitted staff can update request');
      assertEqual(
        permUpdate.request?.adminNote,
        'در صف پژوهش است',
        'Admin note persisted',
      );
    },
  },
  {
    id: 'stage17-linked-published-content-only',
    nameKey: 'tests.stage17.linkedPublishedContentOnly.name',
    descriptionKey: 'tests.stage17.linkedPublishedContentOnly.desc',
    run: async () => {
      const clock = new Stage17FakeClock();
      const harness = new MemoryStage17Harness();
      const { service } = createStage17Service(harness, clock);

      const childAge = harness.getAgeGroupByKey('child');
      const adultAge = harness.getAgeGroupByKey('adult');

      const adultMember = await harness.seedUser({
        displayName: 'کاربر بزرگسال',
        ageGroupId: adultAge.id,
      });
      const childMember = await harness.seedUser({
        displayName: 'کاربر کودک',
        ageGroupId: childAge.id,
      });
      const superAdmin = await harness.seedUser({
        displayName: 'مدیرکل',
        role: 'SuperAdmin',
      });

      const draftItem = await harness.seedContent({
        title: 'محتوای پیش‌نویس',
        slug: 'draft-item-req',
        status: ContentStatus.Draft,
        ageGroupIds: [adultAge.id, childAge.id],
      });
      const adultPublished = await harness.seedContent({
        title: 'تحلیل ویژه بزرگسال',
        slug: 'adult-published-req',
        status: ContentStatus.Published,
        ageGroupIds: [adultAge.id],
      });
      const childPublished = await harness.seedContent({
        title: 'داستان کودکانه',
        slug: 'child-published-req',
        status: ContentStatus.Published,
        ageGroupIds: [childAge.id, adultAge.id],
      });

      const reqAdult = await service.submitContentRequestAsync(adultMember, {
        title: 'درخواست تحلیل اقتصاد',
        description: 'لطفاً این موضوع را منتشر کنید.',
      });
      assertEqual(reqAdult.ok, true, 'Adult request created');

      const linkDraftRes = await service.updateContentRequestByAdminAsync(
        superAdmin,
        reqAdult.request!.id,
        {
          status: ContentRequestStatus.Done,
          linkedContentId: draftItem.id,
        },
      );
      assertEqual(linkDraftRes.ok, false, 'Linking Draft item must be rejected');
      assertEqual(linkDraftRes.statusCode, 400, 'Linking Draft returns 400');
      assertEqual(
        linkDraftRes.errorCode,
        'LINKED_CONTENT_NOT_PUBLISHED',
        'ErrorCode LINKED_CONTENT_NOT_PUBLISHED',
      );

      const candidates =
        await service.listPublishedContentsForLinkingAsync(superAdmin);
      assertEqual(candidates.ok, true, 'Published candidates loaded');
      assertEqual(
        candidates.items?.some((c) => c.id === draftItem.id),
        false,
        'Draft item must not appear in published picker',
      );

      const linkAdultRes = await service.updateContentRequestByAdminAsync(
        superAdmin,
        reqAdult.request!.id,
        {
          status: ContentRequestStatus.Done,
          adminNote: 'منتشر شد و متصل گردید.',
          linkedContentId: adultPublished.id,
        },
      );
      assertEqual(linkAdultRes.ok, true, 'Linking Published item succeeds');
      assertEqual(
        linkAdultRes.linkedContent?.slug,
        'adult-published-req',
        'Linked slug matches',
      );

      const adultList = await service.listUserContentRequestsAsync(
        adultMember,
        adultMember.id,
      );
      assertEqual(
        adultList.items?.[0].linkedContent?.id,
        adultPublished.id,
        'Adult sees linked published item',
      );

      const reqChild = await service.submitContentRequestAsync(childMember, {
        title: 'درخواست قصه صوتی',
        description: 'یک قصه جذاب می‌خواهم.',
      });
      assertEqual(reqChild.ok, true, 'Child request created');

      await service.updateContentRequestByAdminAsync(
        superAdmin,
        reqChild.request!.id,
        {
          status: ContentRequestStatus.Done,
          linkedContentId: adultPublished.id,
        },
      );
      const childListUnsafe = await service.listUserContentRequestsAsync(
        childMember,
        childMember.id,
      );
      assertEqual(
        childListUnsafe.items?.[0].linkedContent,
        null,
        'Child profile must NOT see link to adult-only published content',
      );

      await service.updateContentRequestByAdminAsync(
        superAdmin,
        reqChild.request!.id,
        {
          status: ContentRequestStatus.Done,
          linkedContentId: childPublished.id,
        },
      );
      const childListSafe = await service.listUserContentRequestsAsync(
        childMember,
        childMember.id,
      );
      assertEqual(
        childListSafe.items?.[0].linkedContent?.id,
        childPublished.id,
        'Child profile sees child-allowed linked content',
      );

      const unlinkRes = await service.updateContentRequestByAdminAsync(
        superAdmin,
        reqChild.request!.id,
        {
          status: ContentRequestStatus.Done,
          linkedContentId: null,
        },
      );
      assertEqual(unlinkRes.ok, true, 'Unlinking content succeeds');
      assertEqual(unlinkRes.request?.linkedContentId, null, 'linkedContentId cleared');
      assertEqual(unlinkRes.linkedContent, null, 'linkedContent summary cleared');
    },
  },
  {
    id: 'stage17-feature-flag-and-idb-v11',
    nameKey: 'tests.stage17.featureFlagAndIdbV11.name',
    descriptionKey: 'tests.stage17.featureFlagAndIdbV11.desc',
    run: async () => {
      const clock = new Stage17FakeClock();
      const harness = new MemoryStage17Harness();
      const { service } = createStage17Service(harness, clock);

      const member = await harness.seedUser({ displayName: 'کاربر فلگ' });
      const superAdmin = await harness.seedUser({
        displayName: 'مدیرکل فلگ',
        role: 'SuperAdmin',
      });

      const created = await service.submitContentRequestAsync(member, {
        title: 'درخواست پیش از خاموشی ماژول',
        description: 'این داده باید هنگام خاموشی ماژول حفظ شود.',
      });
      assertEqual(created.ok, true, 'Request created while flag enabled');

      await harness.upsertFeatureFlag({
        key: 'ContentRequests',
        isEnabled: false,
      });

      const disabledSubmit = await service.submitContentRequestAsync(member, {
        title: 'تست هنگام خاموشی',
        description: 'نباید ثبت شود',
      });
      assertEqual(disabledSubmit.statusCode, 404, 'Submit returns 404 when disabled');
      assertEqual(
        disabledSubmit.errorCode,
        'FEATURE_DISABLED',
        'Submit errorCode FEATURE_DISABLED',
      );

      const disabledUserList = await service.listUserContentRequestsAsync(
        member,
        member.id,
      );
      assertEqual(
        disabledUserList.statusCode,
        404,
        'User list returns 404 when disabled',
      );
      assertEqual(
        disabledUserList.errorCode,
        'FEATURE_DISABLED',
        'User list errorCode FEATURE_DISABLED',
      );

      const disabledAdminList =
        await service.listAdminContentRequestsAsync(superAdmin);
      assertEqual(
        disabledAdminList.statusCode,
        404,
        'Admin list returns 404 when disabled',
      );
      assertEqual(
        disabledAdminList.errorCode,
        'FEATURE_DISABLED',
        'Admin list errorCode FEATURE_DISABLED',
      );

      await harness.upsertFeatureFlag({
        key: 'ContentRequests',
        isEnabled: true,
      });

      const restoredList = await service.listUserContentRequestsAsync(
        member,
        member.id,
      );
      assertEqual(restoredList.ok, true, 'User list restores when re-enabled');
      assertEqual(restoredList.items?.length, 1, 'Existing request preserved');
      assertEqual(
        restoredList.items?.[0].request.title,
        'درخواست پیش از خاموشی ماژول',
        'Stored title intact after flag toggle',
      );

      assert(
        DATABASE_MIGRATIONS.some((m) => m.version === 11),
        'Migration version 11 must be registered for Stage 17',
      );
      assert(
        envConfig.databaseVersion >= 11,
        `envConfig.databaseVersion must be >= 11 for Stage 17 (actual=${envConfig.databaseVersion})`,
      );

      if (typeof indexedDB !== 'undefined') {
        const dataStore = new IndexedDbDataStore(
          envConfig.databaseName,
          envConfig.databaseVersion,
          envConfig.metaStoreName,
        );
        const storeNames = await dataStore.getObjectStoreNames();
        for (const requiredStore of STAGE17_OBJECT_STORES) {
          assert(
            storeNames.includes(requiredStore),
            `ObjectStore ${requiredStore} must exist in IndexedDB v${envConfig.databaseVersion}`,
          );
        }

        const adminRepo: IAdminRepository = new IndexedDbAdminRepository(
          dataStore,
        );
        const authRepo: IAuthRepository = new IndexedDbAuthRepository(
          dataStore,
        );
        const contentRepo: IContentRepository = new IndexedDbContentRepository(
          dataStore,
        );
        const taxonomyRepo: ITaxonomyRepository =
          new IndexedDbTaxonomyRepository(dataStore);
        const requestRepo: IContentRequestRepository =
          new IndexedDbContentRequestRepository(dataStore);
        const idbLogger = new AppLogger(
          clock,
          'meraj_stage17_idb_test_logs',
          50,
        );
        const idbService = new ContentRequestService({
          contentRequestRepository: requestRepo,
          contentRepository: contentRepo,
          adminRepository: adminRepo,
          taxonomyRepository: taxonomyRepo,
          permissionPolicyService: new PermissionPolicyService(
            adminRepo,
            idbLogger,
          ),
          searchNormalizer: new SearchNormalizer(),
          clock,
          logger: idbLogger,
          deletedDisplayName: 'کاربر حذف‌شده',
        });

        const originalFlag = (await adminRepo.getAllFeatureFlags()).find(
          (f) => f.key === 'ContentRequests',
        );

        let createdUserId: number | null = null;
        let createdRequestId: number | null = null;
        try {
          await adminRepo.upsertFeatureFlag({
            key: 'ContentRequests',
            isEnabled: true,
          });
          const unique = `${Date.now()}_${Math.floor(Math.random() * 10000)}`;
          const email = `stage17_idb_${unique}@meraj.ir`;
          const realUser = await authRepo.createUser({
            email,
            normalizedEmail: email.toUpperCase(),
            emailConfirmed: true,
            phoneNumber: null,
            normalizedPhoneNumber: null,
            phoneNumberConfirmed: false,
            passwordHash: null,
            passwordSalt: null,
            displayName: 'کاربر تست IDB مرحله ۱۷',
            role: 'Member',
            ageGroupId: null,
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
          createdUserId = realUser.id;

          const idbSubmit = await idbService.submitContentRequestAsync(
            realUser,
            {
              title: 'درخواست ماندگار IndexedDB',
              description: 'راستی‌آزمایی جدول contentRequests در نسخه ۱۱',
              link: 'https://example.com/stage17',
            },
          );
          assertEqual(idbSubmit.ok, true, 'IDB submit should succeed');
          createdRequestId = idbSubmit.request?.id ?? null;
          assert(createdRequestId !== null, 'Created IDB request should have id');

          const persisted = await requestRepo.getContentRequestById(
            createdRequestId!,
          );
          assertEqual(
            persisted?.title,
            'درخواست ماندگار IndexedDB',
            'Persisted request title must match',
          );
        } finally {
          if (createdRequestId !== null) {
            await requestRepo.deleteContentRequest(createdRequestId);
          }
          if (createdUserId !== null) {
            await dataStore.deleteByKey(STORE_NAMES.USERS, createdUserId);
          }
          if (originalFlag) {
            await adminRepo.upsertFeatureFlag(originalFlag);
          }
        }
      }
    },
  },
];
