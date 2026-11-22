import type { IAdminRepository } from '../core/abstractions/adminRepository';
import type { IFileStorage } from '../core/abstractions/fileStorage';
import type { IClock } from '../core/abstractions/IClock';
import type { ITaxonomyRepository } from '../core/abstractions/taxonomyRepository';
import type { AppUser } from '../core/domain/auth';
import {
  ContentStatus,
  type ContentItem,
  type ContentPerson,
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
import { FileUploadService } from '../core/services/fileUploadService';
import {
  extractNormalizedExtension,
  getCategoryForExtension,
  getMimeTypeForExtension,
} from '../core/services/fileValidationService';
import { canAccessAdminRoute } from '../core/services/navigationGuardService';
import { PermissionPolicyService } from '../core/services/permissionPolicyService';
import { TaxonomyService } from '../core/services/taxonomyService';
import { SystemClock } from '../infrastructure/clock/SystemClock';
import { envConfig } from '../infrastructure/config/envConfig';
import { IndexedDbDataStore } from '../infrastructure/data/IndexedDbDataStore';
import { IndexedDbTaxonomyRepository } from '../infrastructure/data/IndexedDbTaxonomyRepository';
import { DatabaseSeeder, INITIAL_AGE_GROUPS, INITIAL_FEATURE_FLAGS, INITIAL_IMPACT_LEVELS, INITIAL_SITE_SETTINGS, INITIAL_TOPICS } from '../infrastructure/data/seed';
import { AppLogger } from '../infrastructure/logging/AppLogger';
import { assert, assertEqual, type UnitTestCase } from './testRunner';

class Stage8FakeClock implements IClock {
  private readonly iso = '2026-10-01T10:00:00.000Z';
  private readonly helperClock = new SystemClock();

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

function generateTestUuid(counter: number): string {
  const hex = counter.toString(16).padStart(12, '0');
  return `aaaaaaaa-bbbb-4ccc-8ddd-${hex}`;
}

class MemoryStage8FileStorage implements IFileStorage {
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

class MemoryStage8AdminRepository implements IAdminRepository {
  public users: AppUser[] = [];
  public staffPermissions: StaffPermission[] = [];
  public featureFlags: FeatureFlag[] = INITIAL_FEATURE_FLAGS.map((f) => ({ ...f }));
  public siteSettings: SiteSetting[] = INITIAL_SITE_SETTINGS.map((s) => ({ ...s }));
  private nextUserId = 1;
  private nextPermId = 1;

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

class MemoryTaxonomyRepository implements ITaxonomyRepository {
  public topics: Topic[] = INITIAL_TOPICS.map((item) => ({ ...item }));
  public tags: Tag[] = [];
  public persons: Person[] = [];
  public impactLevels: ImpactLevel[] = INITIAL_IMPACT_LEVELS.map((item) => ({ ...item }));
  public ageGroups: AgeGroup[] = INITIAL_AGE_GROUPS.map((item) => ({ ...item }));
  public contentItems: ContentItem[] = [];
  public contentTopics: ContentTopic[] = [];
  public contentTags: ContentTag[] = [];
  public contentPersons: ContentPerson[] = [];

  private nextTopicId = 100;
  private nextTagId = 1;
  private nextPersonId = 1;
  private nextImpactId = 100;
  private nextContentId = 1;

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
    return [...this.contentTopics];
  }
  public async countContentTagsByTagId(tagId: number): Promise<number> {
    return this.contentTags.filter((item) => item.tagId === tagId).length;
  }
  public async countContentPersonsByPersonId(personId: number): Promise<number> {
    return this.contentPersons.filter((item) => item.personId === personId).length;
  }
  public async countContentItemsByImpactLevelId(impactLevelId: number): Promise<number> {
    return this.contentItems.filter((item) => item.impactLevelId === impactLevelId).length;
  }

  public async createContentItem(item: Omit<ContentItem, 'id'>): Promise<ContentItem> {
    const created: ContentItem = { ...item, id: this.nextContentId++ };
    this.contentItems.push(created);
    return { ...created };
  }
  public async linkContentTopic(contentId: number, topicId: number): Promise<void> {
    const exists = this.contentTopics.some(
      (link) => link.contentId === contentId && link.topicId === topicId,
    );
    if (!exists) {
      this.contentTopics.push({ contentId, topicId });
    }
  }
}

async function createStage8Harness() {
  const clock = new Stage8FakeClock();
  const adminRepo = new MemoryStage8AdminRepository();
  const taxonomyRepo = new MemoryTaxonomyRepository();
  const logger = new AppLogger(clock, `meraj_stage8_test_${Date.now()}`, 50);
  logger.clearLogs();

  const fileStorage = new MemoryStage8FileStorage(clock);
  const policyService = new PermissionPolicyService(adminRepo, logger);
  const uploadService = new FileUploadService(fileStorage, adminRepo, policyService, logger);
  const taxonomyService = new TaxonomyService(
    taxonomyRepo,
    policyService,
    uploadService,
    logger,
  );

  const superAdmin = await adminRepo.createUser({
    email: 'super@example.com',
    normalizedEmail: 'super@example.com',
    emailConfirmed: true,
    phoneNumber: null,
    normalizedPhoneNumber: null,
    phoneNumberConfirmed: false,
    passwordHash: 'hash',
    passwordSalt: 'salt',
    displayName: 'مدیر کل',
    ageGroupId: null,
    personalizationEnabled: true,
    mustChangePassword: false,
    isActive: true,
    role: 'SuperAdmin',
    failedLoginCount: 0,
    lockoutEnd: null,
    createdAt: clock.nowUtcIso(),
    lastLoginAt: null,
  });

  const taxonomyStaff = await adminRepo.createUser({
    email: 'tax-staff@example.com',
    normalizedEmail: 'tax-staff@example.com',
    emailConfirmed: true,
    phoneNumber: null,
    normalizedPhoneNumber: null,
    phoneNumberConfirmed: false,
    passwordHash: 'hash',
    passwordSalt: 'salt',
    displayName: 'همکار طبقه‌بندی',
    ageGroupId: null,
    personalizationEnabled: true,
    mustChangePassword: false,
    isActive: true,
    role: 'Staff',
    failedLoginCount: 0,
    lockoutEnd: null,
    createdAt: clock.nowUtcIso(),
    lastLoginAt: null,
  });
  await adminRepo.replaceStaffPermissions(taxonomyStaff.id, [
    {
      userId: taxonomyStaff.id,
      permissionKey: 'taxonomy.manage',
      grantedAt: clock.nowUtcIso(),
      grantedById: superAdmin.id,
    },
  ]);

  const unauthorizedStaff = await adminRepo.createUser({
    email: 'comments-staff@example.com',
    normalizedEmail: 'comments-staff@example.com',
    emailConfirmed: true,
    phoneNumber: null,
    normalizedPhoneNumber: null,
    phoneNumberConfirmed: false,
    passwordHash: 'hash',
    passwordSalt: 'salt',
    displayName: 'همکار نظرات',
    ageGroupId: null,
    personalizationEnabled: true,
    mustChangePassword: false,
    isActive: true,
    role: 'Staff',
    failedLoginCount: 0,
    lockoutEnd: null,
    createdAt: clock.nowUtcIso(),
    lastLoginAt: null,
  });
  await adminRepo.replaceStaffPermissions(unauthorizedStaff.id, [
    {
      userId: unauthorizedStaff.id,
      permissionKey: 'comments.moderate',
      grantedAt: clock.nowUtcIso(),
      grantedById: superAdmin.id,
    },
  ]);

  const member = await adminRepo.createUser({
    email: 'member@example.com',
    normalizedEmail: 'member@example.com',
    emailConfirmed: true,
    phoneNumber: null,
    normalizedPhoneNumber: null,
    phoneNumberConfirmed: false,
    passwordHash: 'hash',
    passwordSalt: 'salt',
    displayName: 'کاربر عادی',
    ageGroupId: 1,
    personalizationEnabled: true,
    mustChangePassword: false,
    isActive: true,
    role: 'Member',
    failedLoginCount: 0,
    lockoutEnd: null,
    createdAt: clock.nowUtcIso(),
    lastLoginAt: null,
  });

  return {
    clock,
    adminRepo,
    taxonomyRepo,
    logger,
    fileStorage,
    uploadService,
    taxonomyService,
    superAdmin,
    taxonomyStaff,
    unauthorizedStaff,
    member,
  };
}

const VALID_PNG_1 = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01]);
const VALID_PNG_2 = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x02]);
const EXE_MZ_BYTES = new Uint8Array([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00]);

export const stage8Tests: UnitTestCase[] = [
  {
    id: 'stage8-topic-tree-hierarchy-cycle',
    nameKey: 'tests.stage8.topicTreeHierarchyAndCycle.name',
    descriptionKey: 'tests.stage8.topicTreeHierarchyAndCycle.desc',
    run: async () => {
      const h = await createStage8Harness();
      try {
        const rootA = await h.taxonomyService.createTopicAsync(h.taxonomyStaff, {
          parentId: null,
          name: 'شاخه اول پژوهش',
          sortOrder: '۱۰',
          isActive: true,
        });
        assertEqual(rootA.ok, true, 'Root A creation must succeed');

        const rootB = await h.taxonomyService.createTopicAsync(h.taxonomyStaff, {
          parentId: null,
          name: 'شاخه دوم پژوهش',
          sortOrder: '۱۱',
          isActive: true,
        });
        assertEqual(rootB.ok, true, 'Root B creation must succeed');

        const level2 = await h.taxonomyService.createTopicAsync(h.taxonomyStaff, {
          parentId: rootA.data!.id,
          name: 'زیرشاخه سطح دوم',
          sortOrder: 1,
          isActive: true,
        });
        assertEqual(level2.ok, true, 'Level 2 creation must succeed');

        const level3 = await h.taxonomyService.createTopicAsync(h.taxonomyStaff, {
          parentId: level2.data!.id,
          name: 'زیرشاخه سطح سوم',
          sortOrder: 1,
          isActive: true,
        });
        assertEqual(level3.ok, true, 'Level 3 creation must succeed');

        // Move level2 (along with its child level3) from rootA to rootB
        const moveRes = await h.taxonomyService.updateTopicAsync(
          h.taxonomyStaff,
          level2.data!.id,
          {
            parentId: rootB.data!.id,
            name: level2.data!.name,
            slug: level2.data!.slug,
            sortOrder: 2,
            isActive: true,
          },
        );
        assertEqual(moveRes.ok, true, 'Moving level 2 topic to root B must succeed');

        const overview = await h.taxonomyService.getTopicsOverviewAsync(h.taxonomyStaff);
        const rootBNode = overview.data!.tree.find((n) => n.topic.id === rootB.data!.id);
        assert(rootBNode !== undefined, 'Root B must exist in tree');
        assertEqual(
          rootBNode!.children[0]?.topic.id,
          level2.data!.id,
          'Level 2 must appear under Root B after move',
        );
        assertEqual(
          rootBNode!.children[0]?.children[0]?.topic.id,
          level3.data!.id,
          'Level 3 must remain attached under Level 2 after move',
        );

        // Attempt to make rootB a child of its own grandchild level3 -> must reject
        const cycleRes = await h.taxonomyService.updateTopicAsync(
          h.taxonomyStaff,
          rootB.data!.id,
          {
            parentId: level3.data!.id,
            name: rootB.data!.name,
            slug: rootB.data!.slug,
            sortOrder: 11,
            isActive: true,
          },
        );
        assertEqual(cycleRes.ok, false, 'Circular parent assignment must fail');
        assertEqual(
          cycleRes.errorCode,
          'TOPIC_CIRCULAR_PARENT',
          'Circular parent must return TOPIC_CIRCULAR_PARENT',
        );

        // Attempt self-parenting -> must reject
        const selfRes = await h.taxonomyService.updateTopicAsync(
          h.taxonomyStaff,
          level2.data!.id,
          {
            parentId: level2.data!.id,
            name: level2.data!.name,
            sortOrder: 2,
            isActive: true,
          },
        );
        assertEqual(
          selfRes.errorCode,
          'TOPIC_CIRCULAR_PARENT',
          'Self-parent must return TOPIC_CIRCULAR_PARENT',
        );
      } finally {
        h.logger.clearLogs();
      }
    },
  },
  {
    id: 'stage8-topic-delete-guard-disable',
    nameKey: 'tests.stage8.topicDeleteGuardAndDisable.name',
    descriptionKey: 'tests.stage8.topicDeleteGuardAndDisable.desc',
    run: async () => {
      const h = await createStage8Harness();
      try {
        const parentRes = await h.taxonomyService.createTopicAsync(h.superAdmin, {
          parentId: null,
          name: 'فلسفه و منطق',
          sortOrder: 20,
          isActive: true,
        });
        const linkedChildRes = await h.taxonomyService.createTopicAsync(h.superAdmin, {
          parentId: parentRes.data!.id,
          name: 'منطق کاربردی',
          sortOrder: 1,
          isActive: true,
        });
        const emptyLeafRes = await h.taxonomyService.createTopicAsync(h.superAdmin, {
          parentId: null,
          name: 'موضوع آزمایشی بدون محتوا',
          sortOrder: 21,
          isActive: true,
        });

        const content = await h.taxonomyRepo.createContentItem({
          title: 'مقاله منطق',
          slug: 'logic-article',
          summary: 'خلاصه مقاله',
          body: 'متن کامل مقاله',
          format: 'Article',
          impactLevelId: 1,
          status: ContentStatus.Published,
          publishedAt: h.clock.nowUtcIso(),
          readWatchMinutes: 5,
          thumbnailKey: 'public/thumb/sample.png',
          isFeatured: false,
          languageCode: 'fa',
          searchText: 'مقاله منطق',
          viewCount: 0,
          downloadCount: 0,
          likeCount: 0,
          createdById: h.superAdmin.id,
          createdAt: h.clock.nowUtcIso(),
          updatedAt: h.clock.nowUtcIso(),
        });
        await h.taxonomyRepo.linkContentTopic(content.id, linkedChildRes.data!.id);

        // Rule 6.7: delete topic with linked content must be blocked
        const blockedChildDelete = await h.taxonomyService.deleteTopicAsync(
          h.superAdmin,
          linkedChildRes.data!.id,
        );
        assertEqual(blockedChildDelete.ok, false, 'Deleting topic with content must fail');
        assertEqual(
          blockedChildDelete.errorCode,
          'TOPIC_HAS_CONTENT',
          'Must fail with TOPIC_HAS_CONTENT',
        );

        // Rule 6.7: parent whose descendant has content must also be blocked with TOPIC_HAS_CONTENT
        const blockedParentDelete = await h.taxonomyService.deleteTopicAsync(
          h.superAdmin,
          parentRes.data!.id,
        );
        assertEqual(
          blockedParentDelete.errorCode,
          'TOPIC_HAS_CONTENT',
          'Parent of content-linked child must fail with TOPIC_HAS_CONTENT',
        );

        // Disabling instead of deleting succeeds cleanly
        const disableRes = await h.taxonomyService.toggleTopicActiveAsync(
          h.superAdmin,
          linkedChildRes.data!.id,
          false,
        );
        assertEqual(disableRes.ok, true, 'Deactivating topic with content must succeed');
        assertEqual(disableRes.data!.isActive, false, 'isActive must become false');

        // Unlinked leaf topic deletes completely
        const deleteEmptyRes = await h.taxonomyService.deleteTopicAsync(
          h.superAdmin,
          emptyLeafRes.data!.id,
        );
        assertEqual(deleteEmptyRes.ok, true, 'Deleting topic without content must succeed');
        assertEqual(
          await h.taxonomyRepo.getTopicById(emptyLeafRes.data!.id),
          null,
          'Deleted topic must no longer exist in store',
        );

        // Also test real IndexedDbTaxonomyRepository round-trip when IndexedDB exists in browser
        if (typeof window !== 'undefined' && window.indexedDB) {
          const testDbName = `MerajStage8IdbTest_${Date.now()}`;
          const testStore = new IndexedDbDataStore(
            testDbName,
            envConfig.databaseVersion,
            envConfig.metaStoreName,
          );
          try {
            const seeder = new DatabaseSeeder(testStore, h.logger);
            await seeder.seed('stage8-idb-seed');
            const idbRepo = new IndexedDbTaxonomyRepository(testStore);
            const idbTaxService = new TaxonomyService(
              idbRepo,
              new PermissionPolicyService(h.adminRepo, h.logger),
              h.uploadService,
              h.logger,
            );
            const createdTag = await idbTaxService.createTagAsync(h.superAdmin, {
              name: 'تست آی‌دی‌بی',
            });
            assertEqual(createdTag.ok, true, 'IndexedDbTaxonomyRepository must create Tag');
            const listedTags = await idbRepo.getAllTags();
            assert(
              listedTags.some((item) => item.id === createdTag.data!.id),
              'Created Tag must persist in IndexedDB',
            );
          } finally {
            testStore.close();
            window.indexedDB.deleteDatabase(testDbName);
          }
        }
      } finally {
        h.logger.clearLogs();
      }
    },
  },
  {
    id: 'stage8-agegroup-update-validation',
    nameKey: 'tests.stage8.ageGroupUpdateAndValidation.name',
    descriptionKey: 'tests.stage8.ageGroupUpdateAndValidation.desc',
    run: async () => {
      const h = await createStage8Harness();
      try {
        const listRes = await h.taxonomyService.listAgeGroupsAsync(h.taxonomyStaff);
        const childGroup = listRes.data!.find((g) => g.key === 'child');
        assert(childGroup !== undefined, 'Child AgeGroup must exist');

        // Update 7-11 -> 6-11
        const updateRes = await h.taxonomyService.updateAgeGroupAsync(
          h.taxonomyStaff,
          childGroup!.id,
          {
            name: childGroup!.name,
            minAge: '۶',
            maxAge: '۱۱',
            themeKey: childGroup!.themeKey,
            sortOrder: childGroup!.sortOrder,
            isActive: true,
          },
        );
        assertEqual(updateRes.ok, true, 'Updating child age range 7-11 to 6-11 must succeed');

        const activeGroups = await h.taxonomyService.getPublicActiveAgeGroupsAsync();
        const updatedChild = activeGroups.find((g) => g.id === childGroup!.id);
        assertEqual(updatedChild?.minAge, 6, 'Updated minAge 6 must reflect immediately');
        assertEqual(updatedChild?.maxAge, 11, 'Updated maxAge 11 must reflect immediately');

        // Invalid range maxAge < minAge must fail
        const badRangeRes = await h.taxonomyService.updateAgeGroupAsync(
          h.taxonomyStaff,
          childGroup!.id,
          {
            name: childGroup!.name,
            minAge: 15,
            maxAge: 10,
            themeKey: 'playful',
            sortOrder: 1,
            isActive: true,
          },
        );
        assertEqual(badRangeRes.ok, false, 'maxAge < minAge must fail');
        assertEqual(
          badRangeRes.errorCode,
          'INVALID_AGE_RANGE',
          'Must return INVALID_AGE_RANGE',
        );

        // Invalid themeKey outside fixed 3 themes must fail
        const badThemeRes = await h.taxonomyService.updateAgeGroupAsync(
          h.taxonomyStaff,
          childGroup!.id,
          {
            name: childGroup!.name,
            minAge: 6,
            maxAge: 11,
            themeKey: 'neon-custom',
            sortOrder: 1,
            isActive: true,
          },
        );
        assertEqual(badThemeRes.ok, false, 'Invalid themeKey must fail');
        assertEqual(
          badThemeRes.errorCode,
          'INVALID_THEME_KEY',
          'Must return INVALID_THEME_KEY',
        );

        // Restore original 7-11 cleanly
        const restoreRes = await h.taxonomyService.updateAgeGroupAsync(
          h.taxonomyStaff,
          childGroup!.id,
          {
            name: childGroup!.name,
            minAge: 7,
            maxAge: 11,
            themeKey: childGroup!.themeKey,
            sortOrder: childGroup!.sortOrder,
            isActive: true,
          },
        );
        assertEqual(restoreRes.ok, true, 'Restoring original 7-11 must succeed');
      } finally {
        h.logger.clearLogs();
      }
    },
  },
  {
    id: 'stage8-person-bio-photo-storage',
    nameKey: 'tests.stage8.personBioAndPhotoStorage.name',
    descriptionKey: 'tests.stage8.personBioAndPhotoStorage.desc',
    run: async () => {
      const h = await createStage8Harness();
      try {
        // Bio > 1000 chars rejected
        const longBioRes = await h.taxonomyService.createPersonAsync(h.taxonomyStaff, {
          name: 'دکتر شهابی',
          bio: 'ا'.repeat(1001),
        });
        assertEqual(longBioRes.ok, false, 'Bio > 1000 chars must fail');
        assertEqual(
          longBioRes.errorCode,
          'PERSON_BIO_TOO_LONG',
          'Must return PERSON_BIO_TOO_LONG',
        );

        // Fake executable disguised as PNG rejected
        const fakePhotoRes = await h.taxonomyService.createPersonAsync(h.taxonomyStaff, {
          name: 'شخصیت جعلی',
          bio: 'توضیح معتبر',
          photoFile: {
            originalFileName: 'avatar.png',
            bytes: EXE_MZ_BYTES,
          },
        });
        assertEqual(fakePhotoRes.ok, false, 'Disguised EXE photo must fail');
        assertEqual(
          fakePhotoRes.errorCode,
          'PERSON_PHOTO_UPLOAD_FAILED',
          'Must return PERSON_PHOTO_UPLOAD_FAILED',
        );

        // Valid Person + PNG photo saved via IFileStorage public GUID key
        const createRes = await h.taxonomyService.createPersonAsync(h.taxonomyStaff, {
          name: 'استاد حکمت',
          bio: 'نویسنده و پژوهشگر علوم اسلامی و انسانی',
          photoFile: {
            originalFileName: 'ostad.png',
            bytes: VALID_PNG_1,
          },
        });
        assertEqual(createRes.ok, true, 'Creating person with valid PNG photo must succeed');
        const firstPhotoKey = createRes.data!.photoKey!;
        assert(
          /^public\/thumb\/[0-9a-f-]{36}\.png$/i.test(firstPhotoKey),
          `Person photoKey must use public/thumb UUID format (got ${firstPhotoKey})`,
        );
        assertEqual(
          await h.fileStorage.existsAsync(firstPhotoKey),
          true,
          'First photo must exist in IFileStorage',
        );

        // Replace photo -> old photo must be deleted cleanly from IFileStorage
        const updateRes = await h.taxonomyService.updatePersonAsync(
          h.taxonomyStaff,
          createRes.data!.id,
          {
            name: 'استاد حکمت',
            slug: createRes.data!.slug,
            bio: createRes.data!.bio,
            photoFile: {
              originalFileName: 'ostad-new.png',
              bytes: VALID_PNG_2,
            },
          },
        );
        assertEqual(updateRes.ok, true, 'Updating person with new PNG must succeed');
        const secondPhotoKey = updateRes.data!.photoKey!;
        assert(
          secondPhotoKey !== firstPhotoKey,
          'Replaced photo must generate a fresh GUID key',
        );
        assertEqual(
          await h.fileStorage.existsAsync(firstPhotoKey),
          false,
          'Old photo must be deleted from IFileStorage upon replacement',
        );
        assertEqual(
          await h.fileStorage.existsAsync(secondPhotoKey),
          true,
          'New photo must exist in IFileStorage',
        );

        // Delete person -> remaining photo cleaned up
        const delRes = await h.taxonomyService.deletePersonAsync(
          h.taxonomyStaff,
          createRes.data!.id,
        );
        assertEqual(delRes.ok, true, 'Deleting unlinked person must succeed');
        assertEqual(
          await h.fileStorage.existsAsync(secondPhotoKey),
          false,
          'Person deletion must clean up stored photo from IFileStorage',
        );
      } finally {
        h.logger.clearLogs();
      }
    },
  },
  {
    id: 'stage8-tag-impact-crud',
    nameKey: 'tests.stage8.tagAndImpactCrud.name',
    descriptionKey: 'tests.stage8.tagAndImpactCrud.desc',
    run: async () => {
      const h = await createStage8Harness();
      try {
        const tag1 = await h.taxonomyService.createTagAsync(h.taxonomyStaff, {
          name: 'تفکر نقادانه',
        });
        assertEqual(tag1.ok, true, 'First tag must be created');
        assertEqual(tag1.data!.slug, 'تفکر-نقادانه', 'Persian slug must be generated cleanly');

        const tag2 = await h.taxonomyService.createTagAsync(h.taxonomyStaff, {
          name: 'تفکر نقادانه',
        });
        assertEqual(tag2.ok, true, 'Duplicate tag name gets unique -2 slug');
        assertEqual(tag2.data!.slug, 'تفکر-نقادانه-2', 'Duplicate slug must append -2');

        const editTag = await h.taxonomyService.updateTagAsync(
          h.taxonomyStaff,
          tag2.data!.id,
          {
            name: 'تفکر تحلیلی',
          },
        );
        assertEqual(editTag.data!.slug, 'تفکر-تحلیلی', 'Edited tag slug updates cleanly');

        const delTag1 = await h.taxonomyService.deleteTagAsync(h.taxonomyStaff, tag1.data!.id);
        const delTag2 = await h.taxonomyService.deleteTagAsync(h.taxonomyStaff, tag2.data!.id);
        assertEqual(delTag1.ok && delTag2.ok, true, 'Tags must delete cleanly');

        // ImpactLevel CRUD
        const impCreate = await h.taxonomyService.createImpactLevelAsync(h.taxonomyStaff, {
          name: 'کاربردی و مهارتی',
          sortOrder: '۴',
        });
        assertEqual(impCreate.ok, true, 'ImpactLevel creation must succeed');
        assertEqual(impCreate.data!.sortOrder, 4, 'Persian digit sortOrder must normalize to 4');

        const impEdit = await h.taxonomyService.updateImpactLevelAsync(
          h.taxonomyStaff,
          impCreate.data!.id,
          {
            name: 'تحول‌ساز ویژه',
            sortOrder: 5,
          },
        );
        assertEqual(impEdit.data!.name, 'تحول‌ساز ویژه', 'ImpactLevel update must apply');

        const impDel = await h.taxonomyService.deleteImpactLevelAsync(
          h.taxonomyStaff,
          impCreate.data!.id,
        );
        assertEqual(impDel.ok, true, 'Unlinked ImpactLevel delete must succeed');
      } finally {
        h.logger.clearLogs();
      }
    },
  },
  {
    id: 'stage8-taxonomy-rbac-policy',
    nameKey: 'tests.stage8.taxonomyRbacPolicy.name',
    descriptionKey: 'tests.stage8.taxonomyRbacPolicy.desc',
    run: async () => {
      const h = await createStage8Harness();
      try {
        // Staff without taxonomy.manage gets 403 + WARN log
        h.logger.clearLogs();
        const unauthList = await h.taxonomyService.getTopicsOverviewAsync(h.unauthorizedStaff);
        assertEqual(unauthList.ok, false, 'Staff without taxonomy.manage must fail');
        assertEqual(unauthList.statusCode, 403, 'Unauthorized Staff must receive 403');
        assertEqual(
          h.logger.getLogs().filter((l) => l.level === 'WARN').length,
          1,
          'Unauthorized Staff attempt must emit 1 WARN log',
        );

        const unauthMutate = await h.taxonomyService.createTagAsync(h.unauthorizedStaff, {
          name: 'تست غیرمجاز',
        });
        assertEqual(unauthMutate.statusCode, 403, 'Unauthorized Staff mutation must return 403');

        // Staff WITH taxonomy.manage succeeds
        const staffOk = await h.taxonomyService.getTopicsOverviewAsync(h.taxonomyStaff);
        assertEqual(staffOk.statusCode, 200, 'Staff with taxonomy.manage must receive 200');

        // SuperAdmin succeeds
        const superOk = await h.taxonomyService.getTopicsOverviewAsync(h.superAdmin);
        assertEqual(superOk.statusCode, 200, 'SuperAdmin must receive 200');

        // Member and Guest get 404 (and admin route hidden)
        assertEqual(
          canAccessAdminRoute(h.member),
          false,
          'Member must not pass admin route guard',
        );
        assertEqual(canAccessAdminRoute(null), false, 'Guest must not pass admin route guard');

        const memberRes = await h.taxonomyService.getTopicsOverviewAsync(h.member);
        assertEqual(memberRes.statusCode, 404, 'Member must receive 404 on taxonomy service');

        const guestRes = await h.taxonomyService.getTopicsOverviewAsync(null);
        assertEqual(guestRes.statusCode, 404, 'Guest must receive 404 on taxonomy service');
      } finally {
        h.logger.clearLogs();
      }
    },
  },
];
