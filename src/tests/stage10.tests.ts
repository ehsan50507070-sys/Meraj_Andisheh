import type { IAdminRepository } from '../core/abstractions/adminRepository';
import type { IClock } from '../core/abstractions/IClock';
import type { ITaxonomyRepository } from '../core/abstractions/taxonomyRepository';
import type { AppUser } from '../core/domain/auth';
import { ContentStatus, type ContentItem, type ContentTopic } from '../core/domain/content';
import type { StaffPermission } from '../core/domain/permissions';
import type { FeatureFlag, SiteSetting } from '../core/domain/settings';
import type {
  AgeGroup,
  ImpactLevel,
  Person,
  Tag,
  Topic,
} from '../core/domain/taxonomy';
import { canAccessAdminRoute } from '../core/services/navigationGuardService';
import { PermissionPolicyService } from '../core/services/permissionPolicyService';
import { SearchNormalizer } from '../core/services/searchNormalizer';
import { generateSlug } from '../core/services/slugService';
import type { SmartImportPromptTemplates } from '../core/services/smartImportParser';
import { SmartImportService } from '../core/services/smartImportService';
import { SystemClock } from '../infrastructure/clock/SystemClock';
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
import { AppLogger } from '../infrastructure/logging/AppLogger';
import { assert, assertEqual, type UnitTestCase } from './testRunner';

class Stage10Clock implements IClock {
  private readonly iso = '2026-11-15T10:00:00.000Z';
  private readonly inner = new SystemClock();

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

class MemoryStage10AdminRepository implements IAdminRepository {
  public users: AppUser[] = [];
  public staffPermissions: StaffPermission[] = [];
  public featureFlags: FeatureFlag[] = INITIAL_FEATURE_FLAGS.map((f) => ({ ...f }));
  public siteSettings: SiteSetting[] = INITIAL_SITE_SETTINGS.map((s) => ({ ...s }));
  private nextUserId = 20;
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
    for (const s of settings) {
      const idx = this.siteSettings.findIndex((item) => item.key === s.key);
      if (idx === -1) this.siteSettings.push({ ...s });
      else this.siteSettings[idx] = { ...s };
    }
  }
  public async getActiveAgeGroups(): Promise<AgeGroup[]> {
    return INITIAL_AGE_GROUPS.filter((g) => g.isActive).map((g) => ({ ...g }));
  }
}

class MemoryStage10TaxonomyRepository implements ITaxonomyRepository {
  public topics: Topic[] = INITIAL_TOPICS.map((item) => ({ ...item }));
  public tags: Tag[] = [];
  public persons: Person[] = [];
  public impactLevels: ImpactLevel[] = INITIAL_IMPACT_LEVELS.map((item) => ({ ...item }));
  public ageGroups: AgeGroup[] = INITIAL_AGE_GROUPS.map((item) => ({ ...item }));

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
    return [...this.tags];
  }
  public async getTagById(id: number): Promise<Tag | null> {
    const found = this.tags.find((t) => t.id === id);
    return found ? { ...found } : null;
  }
  public async createTag(tag: Omit<Tag, 'id'>): Promise<Tag> {
    const created: Tag = { ...tag, id: this.nextTagId++ };
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
    return [...this.persons];
  }
  public async getPersonById(id: number): Promise<Person | null> {
    const found = this.persons.find((p) => p.id === id);
    return found ? { ...found } : null;
  }
  public async createPerson(person: Omit<Person, 'id'>): Promise<Person> {
    const created: Person = { ...person, id: this.nextPersonId++ };
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
    return [...this.impactLevels];
  }
  public async getImpactLevelById(id: number): Promise<ImpactLevel | null> {
    const found = this.impactLevels.find((l) => l.id === id);
    return found ? { ...found } : null;
  }
  public async createImpactLevel(level: Omit<ImpactLevel, 'id'>): Promise<ImpactLevel> {
    const created: ImpactLevel = { ...level, id: this.nextImpactId++ };
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
    return [...this.ageGroups];
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
    return { ...item, id: this.nextContentId++ };
  }
  public async linkContentTopic(): Promise<void> {}
}

async function createStage10User(
  repo: Pick<IAdminRepository, 'createUser'>,
  role: AppUser['role'],
  email: string,
  displayName: string,
  clock: IClock,
): Promise<AppUser> {
  return repo.createUser({
    email,
    normalizedEmail: email.toUpperCase(),
    emailConfirmed: true,
    phoneNumber: null,
    normalizedPhoneNumber: null,
    phoneNumberConfirmed: false,
    passwordHash: 'test-hash',
    passwordSalt: null,
    displayName,
    ageGroupId: 4,
    personalizationEnabled: true,
    mustChangePassword: false,
    isActive: true,
    role,
    failedLoginCount: 0,
    lockoutEnd: null,
    createdAt: clock.nowUtcIso(),
    lastLoginAt: null,
  });
}

function buildStage10Harness() {
  const clock = new Stage10Clock();
  const logger = new AppLogger(clock);
  const adminRepo = new MemoryStage10AdminRepository();
  const taxonomyRepo = new MemoryStage10TaxonomyRepository();
  const normalizer = new SearchNormalizer();
  const policyService = new PermissionPolicyService(adminRepo, logger);
  const smartImportService = new SmartImportService(
    taxonomyRepo,
    policyService,
    normalizer,
    logger,
  );
  return { clock, logger, adminRepo, taxonomyRepo, smartImportService };
}

const TEST_PROMPT_TEMPLATES: SmartImportPromptTemplates = {
  header: 'هدر تست',
  templateBlock: '[شروع قالب]\n[عنوان]\n...\n[پایان قالب]',
  rulesBlock: 'قوانین تست',
  siteListsHeading: 'فهرست سایت:',
  siteTopicsLabel: 'موضوعات',
  siteAgeGroupsLabel: 'رده‌ها',
  siteImpactLevelsLabel: 'اثرگذاری',
  siteEmptyFallback: 'خالی',
};

export const stage10Tests: UnitTestCase[] = [
  {
    id: 'stage10-full-sample-parse',
    nameKey: 'tests.stage10.fullSampleParse.name',
    descriptionKey: 'tests.stage10.fullSampleParse.desc',
    run: async () => {
      const { clock, adminRepo, taxonomyRepo, smartImportService } = buildStage10Harness();
      const superAdmin = await createStage10User(
        adminRepo,
        'SuperAdmin',
        'sa10-1@test.local',
        'مدیر کل ۱۰',
        clock,
      );

      await taxonomyRepo.createTopic({
        parentId: null,
        name: 'رسانه',
        slug: generateSlug('رسانه'),
        icon: null,
        sortOrder: 20,
        isActive: true,
      });
      await taxonomyRepo.createTag({ name: 'تبلیغات', slug: generateSlug('تبلیغات') });
      await taxonomyRepo.createTag({
        name: 'سواد رسانه‌ای',
        slug: generateSlug('سواد رسانه‌ای'),
      });
      await taxonomyRepo.createPerson({
        name: 'دکتر علی شریعتی',
        slug: generateSlug('دکتر علی شریعتی'),
        bio: '',
        photoKey: null,
      });
      await taxonomyRepo.createPerson({
        name: 'شهید مطهری',
        slug: generateSlug('شهید مطهری'),
        bio: '',
        photoKey: null,
      });

      const sample74 = `[شروع قالب]
[عنوان]
تحلیل سواد رسانه‌ای و جریان اطلاعات در عصر دیجیتال
[خلاصه]
بررسی علمی نحوه تشخیص اخبار جعلی و سوگیری رسانه‌ای برای مخاطبان نوجوان و بزرگسال.
[قالب]
مقاله
[موضوعات]
تاریخ > ایران معاصر ; رسانه
[برچسب‌ها]
تبلیغات، سواد رسانه‌ای
[شخصیت‌ها]
دکتر علی شریعتی ; شهید مطهری
[رده سنی]
نوجوان، بزرگسال
[اثرگذاری]
زیاد
[مدت]
۱۲ دقیقه
[منابع]
- مبانی سواد رسانه‌ای در عصر شبکه | https://example.com/media-literacy | فصل اول و دوم
- روش‌های تحلیل گفتمان | | یادداشت تکمیلی
[متن]
<h2>مقدمه</h2>
<p>سواد رسانه‌ای مهارتی بنیادین است.</p>
[پایان قالب]`;

      const res = await smartImportService.parseInputAsync(superAdmin, sample74);
      assert(res.ok && res.data !== undefined, 'Expected parseInputAsync to succeed');
      const result = res.data!;

      assertEqual(result.isValid, true, 'Full sample must be valid');
      assertEqual(result.errors.length, 0, 'Full sample must have zero errors');
      assertEqual(result.draft.status, ContentStatus.Draft, 'Parsed draft status must be Draft');
      assertEqual(
        result.draft.title,
        'تحلیل سواد رسانه‌ای و جریان اطلاعات در عصر دیجیتال',
        'Title mismatch',
      );
      assert(result.draft.slug.length > 0, 'Slug must be auto-generated from title');
      assertEqual(result.draft.format, 'Article', 'Format should map مقاله -> Article');
      assertEqual(result.draft.topicIds.length, 2, 'Both hierarchical and root topics should match');
      assertEqual(result.draft.tagIds.length, 2, 'Both tags should match');
      assertEqual(result.draft.personIds.length, 2, 'Both persons should match');
      assertEqual(result.draft.ageGroupIds.length, 2, 'Teen and Adult age groups should match');
      assertEqual(result.draft.impactLevelId, 3, 'Impact level زیاد (id=3) should match');
      assertEqual(result.draft.readWatchMinutes, 12, '۱۲ دقیقه should parse as 12');
      assertEqual(result.draft.sources.length, 2, 'Both sources should parse');
      assertEqual(
        result.draft.sources[0].url,
        'https://example.com/media-literacy',
        'Source 1 URL mismatch',
      );
      assertEqual(result.draft.sources[1].url, null, 'Source 2 empty URL should be null');
      assertEqual(result.draft.sources[1].note, 'یادداشت تکمیلی', 'Source 2 note mismatch');
      assert(result.draft.bodyHtml.includes('<h2>مقدمه</h2>'), 'Body HTML heading preserved');
      assertEqual(result.suggestions.missingTopics.length, 0, 'No missing topics expected');
      assertEqual(result.suggestions.missingTags.length, 0, 'No missing tags expected');
      assertEqual(result.suggestions.missingPersons.length, 0, 'No missing persons expected');

      const promptWithLists = await smartImportService.buildPromptAsync(
        superAdmin,
        TEST_PROMPT_TEMPLATES,
        true,
      );
      assert(
        promptWithLists.ok &&
          typeof promptWithLists.data === 'string' &&
          promptWithLists.data.includes('تاریخ > ایران معاصر') &&
          promptWithLists.data.includes('نوجوان'),
        'Prompt with site lists should append active topics and age groups',
      );
    },
  },
  {
    id: 'stage10-variants-and-digits',
    nameKey: 'tests.stage10.variantsAndDigits.name',
    descriptionKey: 'tests.stage10.variantsAndDigits.desc',
    run: async () => {
      const { clock, adminRepo, taxonomyRepo, smartImportService } = buildStage10Harness();
      const superAdmin = await createStage10User(
        adminRepo,
        'SuperAdmin',
        'sa10-2@test.local',
        'مدیر کل نگارش',
        clock,
      );

      await taxonomyRepo.createTag({ name: 'سواد رسانه‌ای', slug: generateSlug('سواد رسانه‌ای') });
      await taxonomyRepo.createPerson({
        name: 'علامه طباطبایی',
        slug: generateSlug('علامه طباطبایی'),
        bio: '',
        photoKey: null,
      });

      const noisyInput = `
[ عنوان ]
تحليل كتاب سواد رسانه اي
[ خلاصه ]
يادداشتي كوتاه درباره‌ي رسانه
[ قالب ]
كتاب
[ موضوعات ]
تاريخ / ايران معاصر ؛ رسانه و فضای مجازی ← سواد رسانه اي
[ برچسب ها ]
سواد رسانه اي
[ شخصیت ها ]
علامه طباطبايي
[ رده‌ی سنی ]
كودك؛ نوجوان
[ اثرگذاری ]
متوسط
[ مدت ]
١٢ دقيقه
[ منابع ]
- كتاب مرجع | https://example.com/book | صفحه ۵
[ متن ]
پاراگراف اول بدون تگ

پاراگراف دوم ساده`;

      const res = await smartImportService.parseInputAsync(superAdmin, noisyInput);
      assert(res.ok && res.data !== undefined, 'Expected noisy parse to succeed');
      const parsed = res.data!;

      assertEqual(parsed.isValid, true, 'Noisy input with valid tags should parse cleanly');
      assertEqual(parsed.draft.format, 'Book', 'Arabic كتاب should map to Book');
      assertEqual(parsed.draft.topicIds.length, 2, 'Slash & arrow hierarchical paths should match');
      assertEqual(parsed.draft.tagIds.length, 1, 'Tag without ZWNJ should match');
      assertEqual(parsed.draft.personIds.length, 1, 'Person with Arabic ي should match');
      assertEqual(parsed.draft.ageGroupIds.length, 2, 'Arabic كودك and semicolon نوجوان match');
      assertEqual(parsed.draft.impactLevelId, 2, 'Impact level متوسط should match');
      assertEqual(parsed.draft.readWatchMinutes, 12, 'Arabic-Indic ١٢ should parse as 12');
      assert(
        parsed.draft.bodyHtml.includes('<p>پاراگراف اول بدون تگ</p>') &&
          parsed.draft.bodyHtml.includes('<p>پاراگراف دوم ساده</p>'),
        'Plain text paragraphs should wrap cleanly into <p> tags',
      );
    },
  },
  {
    id: 'stage10-no-auto-create-missing-taxonomy',
    nameKey: 'tests.stage10.noAutoCreateMissingTaxonomy.name',
    descriptionKey: 'tests.stage10.noAutoCreateMissingTaxonomy.desc',
    run: async () => {
      const { clock, adminRepo, taxonomyRepo, smartImportService } = buildStage10Harness();
      const superAdmin = await createStage10User(
        adminRepo,
        'SuperAdmin',
        'sa10-3@test.local',
        'مدیر کل پیشنهاد',
        clock,
      );

      const topicsBefore = (await taxonomyRepo.getAllTopics()).length;
      const tagsBefore = (await taxonomyRepo.getAllTags()).length;
      const personsBefore = (await taxonomyRepo.getAllPersons()).length;

      const missingTaxInput = `[شروع قالب]
[عنوان]
محتوا با دسته‌بندی‌های جدید و ناموجود
[موضوعات]
تاریخ > ایران قاجار ; فناوری نوین > هوش مصنوعی ; تاریخ > ایران معاصر
[برچسب‌ها]
برچسب کاملاً جدید، تحول دیجیتال
[شخصیت‌ها]
پژوهشگر ناشناس
[پایان قالب]`;

      const res = await smartImportService.parseInputAsync(superAdmin, missingTaxInput);
      assert(res.ok && res.data !== undefined, 'Expected parse with missing taxonomy to succeed');
      const parsed = res.data!;

      assertEqual(parsed.isValid, true, 'Missing taxonomy must not block valid draft');
      assertEqual(parsed.draft.topicIds.length, 1, 'Only existing ایران معاصر should be selected');
      assertEqual(parsed.suggestions.missingTopics.length, 2, 'Two missing topics expected');
      assertEqual(
        parsed.suggestions.missingTopics[0].name,
        'ایران قاجار',
        'First missing leaf topic name mismatch',
      );
      assertEqual(
        parsed.suggestions.missingTopics[0].existingParentTopicId,
        1,
        'Existing parent تاریخ (id=1) should be detected without auto-creating child',
      );
      assertEqual(
        parsed.suggestions.missingTopics[1].existingParentTopicId,
        null,
        'Missing root فناوری نوین should have null existingParentTopicId',
      );
      assertEqual(parsed.suggestions.missingTags.length, 2, 'Two missing tags expected');
      assertEqual(parsed.suggestions.missingPersons.length, 1, 'One missing person expected');

      assertEqual(
        (await taxonomyRepo.getAllTopics()).length,
        topicsBefore,
        'Topics count in DB must NEVER increase on parse',
      );
      assertEqual(
        (await taxonomyRepo.getAllTags()).length,
        tagsBefore,
        'Tags count in DB must NEVER increase on parse',
      );
      assertEqual(
        (await taxonomyRepo.getAllPersons()).length,
        personsBefore,
        'Persons count in DB must NEVER increase on parse',
      );

      if (typeof indexedDB !== 'undefined') {
        const dbName = `MerajAndisheh_Stage10_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
        const testStore = new IndexedDbDataStore(dbName);
        const testLogger = new AppLogger(clock);
        try {
          const seeder = new DatabaseSeeder(testStore, testLogger);
          await seeder.seed('stage10-idb-seed');

          const idbAuthRepo = new IndexedDbAuthRepository(testStore);
          const idbAdminRepo = new IndexedDbAdminRepository(testStore);
          const idbActor = await createStage10User(
            idbAuthRepo,
            'SuperAdmin',
            'idb10-admin@test.local',
            'مدیر کل IDB',
            clock,
          );
          const idbTaxRepo = new IndexedDbTaxonomyRepository(testStore);
          const idbContentRepo = new IndexedDbContentRepository(testStore);
          const idbPolicy = new PermissionPolicyService(idbAdminRepo, testLogger);
          const idbSmartImport = new SmartImportService(
            idbTaxRepo,
            idbPolicy,
            new SearchNormalizer(),
            testLogger,
          );

          const idbTopicsBefore = (await idbTaxRepo.getAllTopics()).length;
          const idbTagsBefore = (await idbTaxRepo.getAllTags()).length;
          const idbPersonsBefore = (await idbTaxRepo.getAllPersons()).length;
          const idbContentsBefore = (await idbContentRepo.getAllContentItems()).length;

          const idbRes = await idbSmartImport.parseInputAsync(idbActor, missingTaxInput);
          assert(idbRes.ok && idbRes.data?.isValid === true, 'IDB smart import parse failed');

          assertEqual(
            (await idbTaxRepo.getAllTopics()).length,
            idbTopicsBefore,
            'IDB topics unchanged',
          );
          assertEqual((await idbTaxRepo.getAllTags()).length, idbTagsBefore, 'IDB tags unchanged');
          assertEqual(
            (await idbTaxRepo.getAllPersons()).length,
            idbPersonsBefore,
            'IDB persons unchanged',
          );
          assertEqual(
            (await idbContentRepo.getAllContentItems()).length,
            idbContentsBefore,
            'IDB contentItems must remain untouched after smart import parse',
          );
        } finally {
          testStore.close();
          await new Promise<void>((resolve) => {
            const delReq = indexedDB.deleteDatabase(dbName);
            delReq.onsuccess = () => resolve();
            delReq.onerror = () => resolve();
            delReq.onblocked = () => resolve();
          });
        }
      }
    },
  },
  {
    id: 'stage10-invalid-input-and-empty-title',
    nameKey: 'tests.stage10.invalidInputAndEmptyTitle.name',
    descriptionKey: 'tests.stage10.invalidInputAndEmptyTitle.desc',
    run: async () => {
      const { clock, adminRepo, smartImportService } = buildStage10Harness();
      const superAdmin = await createStage10User(
        adminRepo,
        'SuperAdmin',
        'sa10-4@test.local',
        'مدیر کل خطا',
        clock,
      );

      const emptyRes = await smartImportService.parseInputAsync(superAdmin, '   \n  ');
      assert(emptyRes.ok && emptyRes.data !== undefined, 'Service returns result wrapper');
      assertEqual(emptyRes.data!.isValid, false, 'Empty input must be invalid');
      assertEqual(emptyRes.data!.errors[0]?.code, 'EMPTY_INPUT', 'Expected EMPTY_INPUT error');

      const plainRes = await smartImportService.parseInputAsync(
        superAdmin,
        'این یک متن عادی بدون هیچ تگ ساختاریافته است.',
      );
      assertEqual(plainRes.data!.isValid, false, 'Unstructured text must be invalid');
      assertEqual(
        plainRes.data!.errors[0]?.code,
        'NO_RECOGNIZED_TAGS',
        'Expected NO_RECOGNIZED_TAGS error',
      );
      assertEqual(plainRes.data!.recognizedTagsCount, 0, 'Recognized tags count must be 0');

      const noTitleRes = await smartImportService.parseInputAsync(
        superAdmin,
        `[عنوان]
   
[خلاصه]
خلاصه بدون عنوان
[متن]
<p>متن مقاله</p>`,
      );
      assertEqual(noTitleRes.data!.isValid, false, 'Missing title must be invalid');
      assertEqual(
        noTitleRes.data!.errors[0]?.code,
        'TITLE_REQUIRED',
        'Expected TITLE_REQUIRED error',
      );
    },
  },
  {
    id: 'stage10-sanitize-draft-and-rbac',
    nameKey: 'tests.stage10.sanitizeDraftAndRbac.name',
    descriptionKey: 'tests.stage10.sanitizeDraftAndRbac.desc',
    run: async () => {
      const { clock, logger, adminRepo, smartImportService } = buildStage10Harness();
      const superAdmin = await createStage10User(
        adminRepo,
        'SuperAdmin',
        'sa10-5@test.local',
        'مدیر کل امنیت',
        clock,
      );
      const deniedStaff = await createStage10User(
        adminRepo,
        'Staff',
        'staff-no10@test.local',
        'همکار بی‌دسترسی',
        clock,
      );
      const allowedStaff = await createStage10User(
        adminRepo,
        'Staff',
        'staff-ok10@test.local',
        'همکار مجاز',
        clock,
      );
      await adminRepo.replaceStaffPermissions(allowedStaff.id, [
        {
          userId: allowedStaff.id,
          permissionKey: 'content.manage',
          grantedAt: clock.nowUtcIso(),
          grantedById: superAdmin.id,
        },
      ]);
      const member = await createStage10User(
        adminRepo,
        'Member',
        'member10@test.local',
        'عضو عادی',
        clock,
      );

      const xssInput = `[عنوان]
آزمایش ایمنی HTML و وضعیت پیش‌نویس
[متن]
<script>alert('xss')</script><img src="x" onerror="alert(1)" /><p>متن سالم <strong>آموزشی</strong></p><a href="javascript:alert(2)">لینک مخرب</a>`;

      const okRes = await smartImportService.parseInputAsync(allowedStaff, xssInput);
      assert(okRes.ok && okRes.data !== undefined, 'Staff with content.manage should succeed');
      const parsed = okRes.data!;
      assertEqual(parsed.isValid, true, 'XSS-cleaned valid input should produce draft');
      assertEqual(parsed.draft.status, ContentStatus.Draft, 'Draft status is always forced');
      assert(!parsed.draft.bodyHtml.includes('<script'), 'Script tag must be stripped');
      assert(!parsed.draft.bodyHtml.includes('onerror'), 'Event handler onerror must be stripped');
      assert(!parsed.draft.bodyHtml.includes('javascript:'), 'javascript: href must be stripped');
      assert(
        parsed.draft.bodyHtml.includes('<p>متن سالم <strong>آموزشی</strong></p>'),
        'Safe <p> and <strong> tags must remain intact',
      );

      const saPrompt = await smartImportService.buildPromptAsync(
        superAdmin,
        TEST_PROMPT_TEMPLATES,
        false,
      );
      assertEqual(saPrompt.statusCode, 200, 'SuperAdmin prompt build should return 200');

      logger.clearLogs();
      const forbiddenParse = await smartImportService.parseInputAsync(deniedStaff, xssInput);
      assertEqual(forbiddenParse.statusCode, 403, 'Staff without content.manage gets 403');
      const warnLogs = logger.getLogs().filter((entry) => entry.level === 'WARN');
      assert(warnLogs.length > 0, '403 denial must write a WARN log entry');

      const forbiddenPrompt = await smartImportService.buildPromptAsync(
        deniedStaff,
        TEST_PROMPT_TEMPLATES,
        false,
      );
      assertEqual(forbiddenPrompt.statusCode, 403, 'Staff without content.manage gets 403 on prompt');

      assertEqual(canAccessAdminRoute(member), false, 'Member cannot access admin shell');
      assertEqual(canAccessAdminRoute(null), false, 'Guest cannot access admin shell');
      const memberRes = await smartImportService.parseInputAsync(member, xssInput);
      assertEqual(memberRes.statusCode, 404, 'Member calling smartImportService gets 404');
      const guestRes = await smartImportService.parseInputAsync(null, xssInput);
      assertEqual(guestRes.statusCode, 404, 'Guest calling smartImportService gets 404');
    },
  },
];
