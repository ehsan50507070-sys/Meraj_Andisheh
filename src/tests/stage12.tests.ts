import type { IClock } from '../core/abstractions/IClock';
import { ContentStatus, type ContentFormat, type ContentItem } from '../core/domain/content';
import type { AgeGroup, ImpactLevel, Person, Tag, Topic } from '../core/domain/taxonomy';
import {
  queryPublicCatalog,
  ContentCatalogService,
  type CatalogDataset,
} from '../core/services/contentCatalogService';
import {
  getLiveSuggestions,
  MAX_LIVE_SUGGESTIONS,
  SearchSuggestionService,
  type SearchSuggestionDataset,
} from '../core/services/searchSuggestionService';
import { SearchNormalizer } from '../core/services/searchNormalizer';
import { SystemClock } from '../infrastructure/clock/SystemClock';
import { IndexedDbAdminRepository } from '../infrastructure/data/IndexedDbAdminRepository';
import { IndexedDbAuthRepository } from '../infrastructure/data/IndexedDbAuthRepository';
import { IndexedDbContentRepository } from '../infrastructure/data/IndexedDbContentRepository';
import { IndexedDbDataStore } from '../infrastructure/data/IndexedDbDataStore';
import { IndexedDbTaxonomyRepository } from '../infrastructure/data/IndexedDbTaxonomyRepository';
import { DatabaseSeeder, INITIAL_AGE_GROUPS } from '../infrastructure/data/seed';
import { AppLogger } from '../infrastructure/logging/AppLogger';
import { assert, assertEqual, type UnitTestCase } from './testRunner';

class Stage12Clock implements IClock {
  private readonly iso = '2026-11-22T10:00:00.000Z';
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

function getSeededAges(): AgeGroup[] {
  return INITIAL_AGE_GROUPS.map((g, idx) => ({ ...g, id: idx + 1 }));
}

function makeTopic(id: number, name: string, parentId: number | null = null, sortOrder = id): Topic {
  return {
    id,
    name,
    slug: `topic-${id}`,
    parentId,
    icon: null,
    sortOrder,
    isActive: true,
  };
}

function makeTag(id: number, name: string): Tag {
  return {
    id,
    name,
    slug: `tag-${id}`,
  };
}

function makePerson(id: number, name: string): Person {
  return {
    id,
    name,
    slug: `person-${id}`,
    bio: '',
    photoKey: null,
  };
}

function makeImpact(id: number, name: string): ImpactLevel {
  return {
    id,
    name,
    sortOrder: id,
  };
}

function makeContentItem(
  partial: Partial<ContentItem> & { id: number; title: string; createdById?: number },
): ContentItem {
  const normalizer = new SearchNormalizer();
  const summary = partial.summary ?? `خلاصه ${partial.title}`;
  return {
    id: partial.id,
    title: partial.title,
    slug: partial.slug ?? `content-${partial.id}`,
    summary,
    body: partial.body ?? null,
    format: partial.format ?? 'Article',
    impactLevelId: partial.impactLevelId ?? 1,
    status: partial.status ?? ContentStatus.Published,
    publishedAt: partial.publishedAt ?? '2026-11-20T12:00:00.000Z',
    readWatchMinutes: partial.readWatchMinutes ?? 8,
    thumbnailKey: partial.thumbnailKey ?? null,
    isFeatured: partial.isFeatured ?? false,
    languageCode: 'fa',
    searchText: partial.searchText ?? normalizer.buildSearchText({ title: partial.title, summary }),
    viewCount: partial.viewCount ?? 0,
    downloadCount: partial.downloadCount ?? 0,
    likeCount: partial.likeCount ?? 0,
    createdById: partial.createdById ?? 100,
    createdAt: partial.createdAt ?? '2026-11-20T12:00:00.000Z',
    updatedAt: partial.updatedAt ?? '2026-11-20T12:00:00.000Z',
  };
}

function createEmptyDataset(): CatalogDataset {
  return {
    items: [],
    topics: [],
    tags: [],
    persons: [],
    impactLevels: [makeImpact(1, 'مقدماتی')],
    ageGroups: getSeededAges(),
    contentTopics: [],
    contentTags: [],
    contentPersons: [],
    contentAgeGroups: [],
  };
}

export const stage12Tests: UnitTestCase[] = [
  {
    id: 'stage12-example-38-subtree',
    nameKey: 'tests.stage12.example38Subtree.name',
    descriptionKey: 'tests.stage12.example38Subtree.desc',
    run: async () => {
      const normalizer = new SearchNormalizer();
      const dataset = createEmptyDataset();
      const topicHistory = makeTopic(1, 'تاریخ', null, 1);
      const topicContemporary = makeTopic(2, 'ایران معاصر', 1, 2);
      const topicPahlavi = makeTopic(3, 'دوره پهلوی', 2, 3);
      const topicMedia = makeTopic(4, 'رسانه', null, 4);
      const topicEconomy = makeTopic(5, 'اقتصاد', null, 5);
      dataset.topics = [topicHistory, topicContemporary, topicPahlavi, topicMedia, topicEconomy];

      dataset.items = [
        makeContentItem({ id: 10, title: 'ویدیوی تاریخ عمومی', format: 'Video' }),
        makeContentItem({ id: 11, title: 'ویدیوی ایران معاصر', format: 'Video' }),
        makeContentItem({ id: 12, title: 'ویدیوی نوه تاریخ (پهلوی)', format: 'Video' }),
        makeContentItem({ id: 13, title: 'ویدیوی رسانه و سواد', format: 'Video' }),
        makeContentItem({ id: 14, title: 'مقاله ایران معاصر', format: 'Article' }),
        makeContentItem({ id: 15, title: 'ویدیوی اقتصاد', format: 'Video' }),
      ];

      dataset.contentTopics = [
        { contentId: 10, topicId: topicHistory.id },
        { contentId: 11, topicId: topicContemporary.id },
        { contentId: 12, topicId: topicPahlavi.id },
        { contentId: 13, topicId: topicMedia.id },
        { contentId: 14, topicId: topicContemporary.id },
        { contentId: 15, topicId: topicEconomy.id },
      ];

      const res = queryPublicCatalog(
        dataset,
        {
          topicIds: [topicHistory.id, topicMedia.id],
          formats: ['Video'],
          activeAgeGroup: null,
        },
        normalizer,
      );

      const ids = res.items.map((x) => x.item.id).sort((a, b) => a - b);
      assertEqual(
        ids.join(','),
        '10,11,12,13',
        'Topic parent+media + Video filter must include history subtree videos and media videos only',
      );
      assert(
        res.expandedTopicIds.includes(topicPahlavi.id),
        'expandedTopicIds must include multi-level descendants',
      );
    },
  },
  {
    id: 'stage12-search-normalization-37',
    nameKey: 'tests.stage12.searchNormalization37.name',
    descriptionKey: 'tests.stage12.searchNormalization37.desc',
    run: async () => {
      const normalizer = new SearchNormalizer();
      const dataset = createEmptyDataset();
      dataset.items = [
        makeContentItem({ id: 1, title: 'كتاب راهنمای اندیشه إسلامي' }),
        makeContentItem({ id: 2, title: 'چگونه پژوهش انجام می‌شود' }),
        makeContentItem({ id: 3, title: 'مبانی علم و معرفت' }),
        makeContentItem({ id: 4, title: 'جلسه ۱۲۳ تاریخ معاصر' }),
      ];

      // 1. Arabic kaf/yeh + hamza equivalence
      const rArabic = queryPublicCatalog(dataset, { query: 'كتاب إسلامي', activeAgeGroup: null }, normalizer);
      const rPersian = queryPublicCatalog(dataset, { query: 'کتاب اسلامی', activeAgeGroup: null }, normalizer);
      assertEqual(rArabic.items.map((x) => x.item.id).join(','), '1', 'Arabic kaf/yeh must match item 1');
      assertEqual(
        rPersian.items.map((x) => x.item.id).join(','),
        '1',
        'Persian kaf/yeh must return identical result',
      );

      // 2. ZWNJ / joined / spaced forms: می‌شود / میشود / می شود
      const rJoined = queryPublicCatalog(dataset, { query: 'میشود', activeAgeGroup: null }, normalizer);
      const rZwnj = queryPublicCatalog(dataset, { query: 'می‌شود', activeAgeGroup: null }, normalizer);
      const rSpaced = queryPublicCatalog(dataset, { query: 'می شود', activeAgeGroup: null }, normalizer);
      assertEqual(rJoined.items.map((x) => x.item.id).join(','), '2', 'Joined میشود must match item 2');
      assertEqual(rZwnj.items.map((x) => x.item.id).join(','), '2', 'ZWNJ می‌شود must match item 2');
      assertEqual(rSpaced.items.map((x) => x.item.id).join(','), '2', 'Spaced می شود must match item 2');

      // 3. Diacritics + tatweel
      const rDiac = queryPublicCatalog(dataset, { query: 'عِلْم', activeAgeGroup: null }, normalizer);
      const rTatweel = queryPublicCatalog(dataset, { query: 'عـلـم', activeAgeGroup: null }, normalizer);
      const rPlain = queryPublicCatalog(dataset, { query: 'علم', activeAgeGroup: null }, normalizer);
      assertEqual(rDiac.items.map((x) => x.item.id).join(','), '3', 'Diacritics عِلْم must match item 3');
      assertEqual(rTatweel.items.map((x) => x.item.id).join(','), '3', 'Tatweel عـلـم must match item 3');
      assertEqual(rPlain.items.map((x) => x.item.id).join(','), '3', 'Plain علم must match item 3');

      // 4. Three-script digits: ۱۲۳ / ١٢٣ / 123
      const rFaNum = queryPublicCatalog(dataset, { query: '۱۲۳', activeAgeGroup: null }, normalizer);
      const rArNum = queryPublicCatalog(dataset, { query: '١٢٣', activeAgeGroup: null }, normalizer);
      const rEnNum = queryPublicCatalog(dataset, { query: '123', activeAgeGroup: null }, normalizer);
      assertEqual(rFaNum.items.map((x) => x.item.id).join(','), '4', 'Persian digits ۱۲۳ must match item 4');
      assertEqual(rArNum.items.map((x) => x.item.id).join(','), '4', 'Arabic digits ١٢٣ must match item 4');
      assertEqual(rEnNum.items.map((x) => x.item.id).join(','), '4', 'ASCII digits 123 must match item 4');
    },
  },
  {
    id: 'stage12-live-autocomplete',
    nameKey: 'tests.stage12.liveAutocomplete.name',
    descriptionKey: 'tests.stage12.liveAutocomplete.desc',
    run: async () => {
      const normalizer = new SearchNormalizer();
      const ages = getSeededAges();
      const child = ages.find((g) => g.key === 'child')!;
      const adult = ages.find((g) => g.key === 'adult')!;

      const suggestionData: SearchSuggestionDataset = {
        items: [
          makeContentItem({ id: 1, title: 'تاریخ برای کودکان ۱', slug: 'tarikh-kid-1' }),
          makeContentItem({ id: 2, title: 'تاریخ برای کودکان ۲', slug: 'tarikh-kid-2' }),
          makeContentItem({ id: 3, title: 'تاریخ برای کودکان ۳', slug: 'tarikh-kid-3' }),
          makeContentItem({ id: 4, title: 'تاریخ برای کودکان ۴', slug: 'tarikh-kid-4' }),
          makeContentItem({ id: 5, title: 'تاریخ برای کودکان ۵', slug: 'tarikh-kid-5' }),
          makeContentItem({ id: 6, title: 'تاریخ تخصصی بزرگسال', slug: 'tarikh-adult-only' }),
          makeContentItem({
            id: 7,
            title: 'تاریخ پیش‌نویس',
            slug: 'tarikh-draft',
            status: ContentStatus.Draft,
          }),
        ],
        topics: [
          makeTopic(1, 'تاریخ اندیشه'),
          makeTopic(2, 'تاریخ تمدن'),
          makeTopic(3, 'تاریخ شفاهی'),
          { ...makeTopic(4, 'تاریخ غیرفعال'), isActive: false },
        ],
        persons: [
          makePerson(1, 'استاد تاریخ‌نگار اول'),
          makePerson(2, 'استاد تاریخ‌نگار دوم'),
          makePerson(3, 'استاد تاریخ‌نگار سوم'),
        ],
        contentAgeGroups: [
          { contentId: 1, ageGroupId: child.id },
          { contentId: 2, ageGroupId: child.id },
          { contentId: 3, ageGroupId: child.id },
          { contentId: 6, ageGroupId: adult.id },
        ],
      };

      const singleChar = getLiveSuggestions('ت', null, suggestionData, normalizer);
      assertEqual(singleChar.length, 0, 'Single character query must return empty suggestions');

      const adultSuggestions = getLiveSuggestions('تا', adult, suggestionData, normalizer);
      assert(
        adultSuggestions.length > 0 && adultSuggestions.length <= MAX_LIVE_SUGGESTIONS,
        '2+ char query must return between 1 and 8 suggestions',
      );
      assert(
        adultSuggestions.some((s) => s.kind === 'content' && s.targetHash.startsWith('#/content/')),
        'Suggestions must include content link',
      );
      assert(
        adultSuggestions.some((s) => s.kind === 'topic' && s.targetHash.startsWith('#/content?topics=')),
        'Suggestions must include topic link',
      );
      assert(
        adultSuggestions.some((s) => s.kind === 'person' && s.targetHash.startsWith('#/content?persons=')),
        'Suggestions must include person link',
      );
      assert(
        !adultSuggestions.some((s) => s.entityId === 7 && s.kind === 'content'),
        'Draft content must never appear in suggestions',
      );
      assert(
        !adultSuggestions.some((s) => s.entityId === 4 && s.kind === 'topic'),
        'Inactive topic must never appear in suggestions',
      );

      const childSuggestions = getLiveSuggestions('تا', child, suggestionData, normalizer);
      assert(
        !childSuggestions.some((s) => s.kind === 'content' && s.entityId === 6),
        'Adult-only content must NEVER appear in live suggestions for child',
      );
    },
  },
  {
    id: 'stage12-child-hard-filter-catalog-and-search',
    nameKey: 'tests.stage12.childHardFilterCatalogAndSearch.name',
    descriptionKey: 'tests.stage12.childHardFilterCatalogAndSearch.desc',
    run: async () => {
      const normalizer = new SearchNormalizer();
      const ages = getSeededAges();
      const child = ages.find((g) => g.key === 'child')!;
      const adult = ages.find((g) => g.key === 'adult')!;

      const dataset = createEmptyDataset();
      dataset.items = [
        makeContentItem({ id: 1, title: 'داستان کودکانه مهربانی', format: 'Video' }),
        makeContentItem({ id: 2, title: 'دانش همگانی برای همه', format: 'Article' }),
        makeContentItem({ id: 3, title: 'مناظره تخصصی بزرگسالان پنهان', format: 'Video' }),
      ];
      dataset.contentAgeGroups = [
        { contentId: 1, ageGroupId: child.id },
        { contentId: 3, ageGroupId: adult.id },
      ];

      // 1. Bank browse as child
      const childBank = queryPublicCatalog(dataset, { activeAgeGroup: child }, normalizer);
      assert(
        !childBank.items.some((x) => x.item.id === 3),
        'Child browsing catalog must never see adult-only content 3',
      );

      // 2. Direct search matching adult content title as child
      const childSearch = queryPublicCatalog(
        dataset,
        { query: 'مناظره تخصصی بزرگسالان پنهان', activeAgeGroup: child },
        normalizer,
      );
      assertEqual(
        childSearch.totalCount,
        0,
        'Searching for adult-only content as child must return 0 items',
      );

      // 3. Bypass attempt passing adult age filter while activeAgeGroup is child
      const childBypassAttempt = queryPublicCatalog(
        dataset,
        { filterAgeGroupIds: [adult.id], activeAgeGroup: child },
        normalizer,
      );
      assertEqual(
        childBypassAttempt.totalCount,
        0,
        'Passing adult filterAgeGroupIds while activeAgeGroup is child must still forbid adult content',
      );

      // 4. End-to-end IndexedDB integration check using a real dynamically created user
      if (typeof indexedDB !== 'undefined') {
        const dbName = `meraj_stage12_idb_${Date.now()}`;
        const store = new IndexedDbDataStore(dbName, 5, 'meta');
        try {
          const clock = new Stage12Clock();
          const logger = new AppLogger(clock, `stage12_logs_${Date.now()}`, 50);
          const seeder = new DatabaseSeeder(store, logger);
          await seeder.seed('stage12-test-seed');

          const authRepo = new IndexedDbAuthRepository(store);
          const adminRepo = new IndexedDbAdminRepository(store);
          const taxonomyRepo = new IndexedDbTaxonomyRepository(store);
          const contentRepo = new IndexedDbContentRepository(store);

          const seededAges = await taxonomyRepo.getAllAgeGroups();
          const idbChild = seededAges.find((g) => g.key === 'child')!;
          const idbAdult = seededAges.find((g) => g.key === 'adult')!;

          const realCreator = await authRepo.createUser({
            email: 'stage12-creator@test.local',
            normalizedEmail: 'STAGE12-CREATOR@TEST.LOCAL',
            phoneNumber: null,
            normalizedPhoneNumber: null,
            displayName: 'سازنده محتوای تست',
            role: 'Staff',
            ageGroupId: idbAdult.id,
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

          const childSafeItem = await contentRepo.createContentItem({
            title: 'قصه شبانه کودک',
            slug: 'kid-night-story',
            summary: 'داستان کوتاه برای کودکان',
            body: null,
            format: 'Audio',
            impactLevelId: 1,
            status: ContentStatus.Published,
            publishedAt: clock.nowUtcIso(),
            readWatchMinutes: 5,
            thumbnailKey: null,
            isFeatured: false,
            languageCode: 'fa',
            searchText: normalizer.buildSearchText({
              title: 'قصه شبانه کودک',
              summary: 'داستان کوتاه برای کودکان',
            }),
            viewCount: 10,
            downloadCount: 0,
            likeCount: 2,
            createdById: realCreator.id,
            createdAt: clock.nowUtcIso(),
            updatedAt: clock.nowUtcIso(),
          });
          await contentRepo.replaceContentAgeGroups(childSafeItem.id, [idbChild.id]);

          const adultOnlyItem = await contentRepo.createContentItem({
            title: 'تحلیل پیشرفته بزرگسال',
            slug: 'adult-deep-analysis',
            summary: 'محتوای ویژه بزرگسالان',
            body: null,
            format: 'Article',
            impactLevelId: 1,
            status: ContentStatus.Published,
            publishedAt: clock.nowUtcIso(),
            readWatchMinutes: 15,
            thumbnailKey: null,
            isFeatured: false,
            languageCode: 'fa',
            searchText: normalizer.buildSearchText({
              title: 'تحلیل پیشرفته بزرگسال',
              summary: 'محتوای ویژه بزرگسالان',
            }),
            viewCount: 50,
            downloadCount: 0,
            likeCount: 10,
            createdById: realCreator.id,
            createdAt: clock.nowUtcIso(),
            updatedAt: clock.nowUtcIso(),
          });
          await contentRepo.replaceContentAgeGroups(adultOnlyItem.id, [idbAdult.id]);

          const catalogService = new ContentCatalogService(
            contentRepo,
            taxonomyRepo,
            adminRepo,
            normalizer,
          );
          const suggestionService = new SearchSuggestionService(
            contentRepo,
            taxonomyRepo,
            normalizer,
          );

          const idbChildCatalog = await catalogService.queryCatalogAsync({
            activeAgeGroup: idbChild,
            filterAgeGroupIds: [idbAdult.id],
          });
          assertEqual(
            idbChildCatalog.result.totalCount,
            0,
            'IDB ContentCatalogService must enforce child hard filter',
          );

          const idbChildAll = await catalogService.queryCatalogAsync({
            activeAgeGroup: idbChild,
          });
          assertEqual(
            idbChildAll.result.items.map((i) => i.item.id).join(','),
            String(childSafeItem.id),
            'IDB catalog for child must return only childSafeItem',
          );

          const idbSuggestions = await suggestionService.getLiveSuggestionsAsync(
            'تحلیل',
            idbChild,
          );
          assert(
            !idbSuggestions.some((s) => s.kind === 'content' && s.entityId === adultOnlyItem.id),
            'IDB SearchSuggestionService must exclude adult-only content for child',
          );
        } finally {
          store.close();
          await new Promise<void>((resolve) => {
            const req = indexedDB.deleteDatabase(dbName);
            req.onsuccess = () => resolve();
            req.onerror = () => resolve();
            req.onblocked = () => resolve();
          });
        }
      }
    },
  },
  {
    id: 'stage12-sorting-and-pagination',
    nameKey: 'tests.stage12.sortingAndPagination.name',
    descriptionKey: 'tests.stage12.sortingAndPagination.desc',
    run: async () => {
      const normalizer = new SearchNormalizer();
      const ages = getSeededAges();
      const teen = ages.find((g) => g.key === 'teen')!;
      const adult = ages.find((g) => g.key === 'adult')!;

      const dataset = createEmptyDataset();
      const generatedItems: ContentItem[] = [];
      // Create 16 items with distinct publishedAt, viewCount, likeCount, and age tiers
      for (let i = 1; i <= 16; i += 1) {
        const day = String(i).padStart(2, '0');
        generatedItems.push(
          makeContentItem({
            id: i,
            title: `محتوای شماره ${i}`,
            publishedAt: `2026-10-${day}T10:00:00.000Z`,
            viewCount: i === 5 ? 999 : i * 10,
            likeCount: i === 3 ? 888 : (20 - i) * 5,
          }),
        );
      }
      dataset.items = generatedItems;
      // Make item 1 explicitly teen (Priority 1), item 2 universal (Priority 2), item 16 adult (Priority 3)
      dataset.contentAgeGroups = [
        { contentId: 1, ageGroupId: teen.id },
        { contentId: 16, ageGroupId: adult.id },
      ];

      // Page 1 (12 items) & Page 2 (4 items)
      const p1 = queryPublicCatalog(
        dataset,
        { sort: 'latest', page: 1, pageSize: 12, activeAgeGroup: teen },
        normalizer,
      );
      const p2 = queryPublicCatalog(
        dataset,
        { sort: 'latest', page: 2, pageSize: 12, activeAgeGroup: teen },
        normalizer,
      );
      assertEqual(p1.totalCount, 16, 'Total count must be 16');
      assertEqual(p1.totalPages, 2, 'Total pages must be 2');
      assertEqual(p1.items.length, 12, 'Page 1 must contain exactly 12 items');
      assertEqual(p2.items.length, 4, 'Page 2 must contain remaining 4 items');

      // 'latest' for teen: Priority 1 (id=1 teen) comes first, then Priority 2 universal newest first (id=15 -> ... -> id=2), then Priority 3 adult (id=16) on page 2 last!
      assertEqual(
        p1.items[0].item.id,
        1,
        'Latest sort with active teen age must place Priority 1 teen item first',
      );
      assertEqual(
        p2.items[p2.items.length - 1].item.id,
        16,
        'Priority 3 adult item must appear last in latest sort for teen',
      );

      // 'most_viewed'
      const mostViewed = queryPublicCatalog(
        dataset,
        { sort: 'most_viewed', page: 1, pageSize: 12, activeAgeGroup: teen },
        normalizer,
      );
      assertEqual(
        mostViewed.items[0].item.id,
        5,
        'most_viewed sort must place item 5 (viewCount 999) first',
      );

      // 'most_liked'
      const mostLiked = queryPublicCatalog(
        dataset,
        { sort: 'most_liked', page: 1, pageSize: 12, activeAgeGroup: teen },
        normalizer,
      );
      assertEqual(
        mostLiked.items[0].item.id,
        3,
        'most_liked sort must place item 3 (likeCount 888) first',
      );
    },
  },
  {
    id: 'stage12-performance-1000-items',
    nameKey: 'tests.stage12.performance1000Items.name',
    descriptionKey: 'tests.stage12.performance1000Items.desc',
    run: async () => {
      const normalizer = new SearchNormalizer();
      const ages = getSeededAges();
      const child = ages.find((g) => g.key === 'child')!;
      const teen = ages.find((g) => g.key === 'teen')!;
      const adult = ages.find((g) => g.key === 'adult')!;

      const dataset = createEmptyDataset();
      dataset.topics = [
        makeTopic(1, 'تاریخ'),
        makeTopic(2, 'ایران معاصر', 1),
        makeTopic(3, 'فلسفه'),
      ];
      dataset.tags = [makeTag(1, 'برگزیده'), makeTag(2, 'تحلیلی')];
      dataset.persons = [makePerson(1, 'دکتر نمونه')];

      const formats: ContentFormat[] = ['Video', 'Audio', 'Article', 'Pdf'];
      const items: ContentItem[] = [];
      const contentTopics = [];
      const contentTags = [];
      const contentPersons = [];
      const contentAgeGroups = [];

      for (let i = 1; i <= 1000; i += 1) {
        const format = formats[i % formats.length];
        const isMatchedSearch = i % 5 === 0;
        const title = isMatchedSearch
          ? `کتاب تاریخ شماره ${i}`
          : `پژوهش اندیشه شماره ${i}`;
        items.push(
          makeContentItem({
            id: i,
            title,
            format,
            viewCount: (i * 17) % 1000,
            likeCount: (i * 13) % 500,
            searchText: normalizer.buildSearchText({ title, summary: '' }),
          }),
        );
        contentTopics.push({ contentId: i, topicId: (i % 3) + 1 });
        contentTags.push({ contentId: i, tagId: (i % 2) + 1 });
        if (i % 4 === 0) {
          contentPersons.push({ contentId: i, personId: 1 });
        }
        const ageMod = i % 3;
        contentAgeGroups.push({
          contentId: i,
          ageGroupId: ageMod === 0 ? child.id : ageMod === 1 ? teen.id : adult.id,
        });
      }

      dataset.items = items;
      dataset.contentTopics = contentTopics;
      dataset.contentTags = contentTags;
      dataset.contentPersons = contentPersons;
      dataset.contentAgeGroups = contentAgeGroups;

      const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
      const res = queryPublicCatalog(
        dataset,
        {
          query: 'كتاب تاريخ',
          topicIds: [1],
          formats: ['Video', 'Article'],
          tagIds: [1],
          sort: 'most_viewed',
          page: 1,
          pageSize: 12,
          activeAgeGroup: teen,
        },
        normalizer,
      );
      const elapsedMs = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0;

      assert(
        elapsedMs < 2000,
        `1,000-item catalog query must complete under 2000ms (actual: ${Math.round(elapsedMs)}ms)`,
      );
      assert(res.totalCount > 0, 'Combined filter over 1,000 items must find matching entries');
      assert(res.items.length <= 12, 'Page size limit of 12 must be respected');
    },
  },
];
