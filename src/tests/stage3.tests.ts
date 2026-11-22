import {
  ContentFileKind,
  ContentStatus,
  FileStorageType,
} from '../core/domain/content';
import { FEATURE_FLAG_KEYS } from '../core/domain/settings';
import { validateForPublish } from '../core/services/contentPublishValidator';
import { ensureUniqueSlug, generateSlug } from '../core/services/slugService';
import { SystemClock } from '../infrastructure/clock/SystemClock';
import { envConfig } from '../infrastructure/config/envConfig';
import { IndexedDbDataStore } from '../infrastructure/data/IndexedDbDataStore';
import { STAGE3_OBJECT_STORES, STORE_NAMES } from '../infrastructure/data/migrations';
import { DatabaseSeeder } from '../infrastructure/data/seed';
import { AppLogger } from '../infrastructure/logging/AppLogger';
import { t } from '../web/resources/i18n';
import { assert, assertEqual, type UnitTestCase } from './testRunner';

function buildValidArticleInput() {
  return {
    item: {
      title: 'تحلیل سواد رسانه‌ای در عصر شبکه‌های اجتماعی',
      summary: 'بررسی راهکارهای عملی برای تشخیص اخبار جعلی و ارتقای آگاهی رسانه‌ای خانواده‌ها.',
      body: 'متن کامل مقاله پژوهشی درباره سواد رسانه‌ای و تحلیل پیام‌های دیجیتال.',
      format: 'Article' as const,
      thumbnailKey: 'thumbs/media-literacy.jpg',
    },
    topicIds: [2, 7],
    sources: [{ title: 'فصلنامه پژوهش‌های ارتباطی، شماره ۱۴', url: 'https://example.org/ref-14' }],
    files: [],
  };
}

export const stage3Tests: UnitTestCase[] = [
  {
    id: 'stage3-migration-object-stores',
    nameKey: 'health.card.tests.stage3Case1Name',
    descriptionKey: 'health.card.tests.stage3Case1Desc',
    run: async () => {
      const store = new IndexedDbDataStore(
        envConfig.databaseName,
        envConfig.databaseVersion,
        envConfig.metaStoreName,
      );
      await store.connect();
      const storeNames = await store.getObjectStoreNames();

      assert(
        storeNames.includes(STORE_NAMES.META),
        `Missing base store: ${STORE_NAMES.META}`,
      );

      for (const expectedStore of STAGE3_OBJECT_STORES) {
        assert(
          storeNames.includes(expectedStore),
          `Missing Stage 3 ObjectStore after migration v${envConfig.databaseVersion}: ${expectedStore}`,
        );
      }
    },
  },
  {
    id: 'stage3-idempotent-seed',
    nameKey: 'health.card.tests.stage3Case2Name',
    descriptionKey: 'health.card.tests.stage3Case2Desc',
    run: async () => {
      const clock = new SystemClock();
      const testDbName = `MerajAndishehDB_SeedTest_${Date.now()}`;
      const testLogKey = `meraj_seed_test_log_${Date.now()}`;
      const testStore = new IndexedDbDataStore(
        testDbName,
        envConfig.databaseVersion,
        envConfig.metaStoreName,
      );
      const testLogger = new AppLogger(clock, testLogKey, 10);
      const seeder = new DatabaseSeeder(testStore, testLogger);

      try {
        const firstRun = await seeder.seed();
        const secondRun = await seeder.seed();

        assert(firstRun.insertedCount > 0, 'First seed run must insert initial records');
        assertEqual(secondRun.insertedCount, 0, 'Second seed run must insert 0 duplicate records');

        const summary = secondRun.summary;
        assertEqual(summary.ageGroups, 4, 'AgeGroups count must be 4');
        assertEqual(summary.impactLevels, 3, 'ImpactLevels count must be 3');
        assertEqual(summary.topics, 10, 'Topics count must be 10');
        assertEqual(summary.featureFlags, FEATURE_FLAG_KEYS.length, 'FeatureFlags count must be 7');
        assertEqual(summary.siteSettings, 8, 'SiteSettings count must be 8');
        assertEqual(summary.allModulesDisabled, true, 'All 7 feature flags must default to disabled');
      } finally {
        testLogger.clearLogs();
        testStore.close();
        if (typeof window !== 'undefined' && window.indexedDB) {
          window.indexedDB.deleteDatabase(testDbName);
        }
      }
    },
  },
  {
    id: 'stage3-publish-valid-article',
    nameKey: 'health.card.tests.stage3Case3Name',
    descriptionKey: 'health.card.tests.stage3Case3Desc',
    run: () => {
      const result = validateForPublish(buildValidArticleInput());
      assertEqual(result.isValid, true, 'Complete Article must be valid for publish');
      assertEqual(result.errors.length, 0, 'Complete Article must have 0 validation errors');
      assertEqual(ContentStatus.Published, 2, 'ContentStatus.Published enum value must be 2');
    },
  },
  {
    id: 'stage3-publish-article-missing-source',
    nameKey: 'health.card.tests.stage3Case4Name',
    descriptionKey: 'health.card.tests.stage3Case4Desc',
    run: () => {
      const input = {
        ...buildValidArticleInput(),
        sources: [],
      };
      const result = validateForPublish(input);
      assertEqual(result.isValid, false, 'Article without sources must be rejected');

      const sourceError = result.errors.find((err) => err.field === 'sources');
      assert(sourceError !== undefined, 'Expected a validation error on field "sources"');
      assertEqual(
        sourceError.messageKey,
        'publish.error.noSource',
        'Expected publish.error.noSource message key',
      );
      assert(
        t(sourceError.messageKey).includes('بدون منبع منتشر'),
        'Localized source error message must explain publish without source is forbidden',
      );
    },
  },
  {
    id: 'stage3-publish-video-missing-file',
    nameKey: 'health.card.tests.stage3Case5Name',
    descriptionKey: 'health.card.tests.stage3Case5Desc',
    run: () => {
      const result = validateForPublish({
        item: {
          title: 'مستند کوتاه اقتصاد مقاومتی',
          summary: 'مروری بر ظرفیت‌های تولید داخلی و نقش دانش‌بنیان‌ها.',
          body: null,
          format: 'Video',
          thumbnailKey: 'thumbs/economy-doc.jpg',
        },
        topicIds: [4, 9],
        sources: [{ title: 'گزارش مرکز پژوهش‌ها', url: null }],
        files: [],
      });

      assertEqual(result.isValid, false, 'Video without main file or external link must fail');
      assert(
        result.errors.some((err) => err.field === 'files'),
        'Expected files validation error for Video without main file',
      );
    },
  },
  {
    id: 'stage3-publish-video-external-aparat',
    nameKey: 'health.card.tests.stage3Case6Name',
    descriptionKey: 'health.card.tests.stage3Case6Desc',
    run: () => {
      const result = validateForPublish({
        item: {
          title: 'مستند روایت پیشرفت علمی',
          summary: 'گزارش تصویری از دستاوردهای پژوهشی پژوهشگران جوان.',
          body: null,
          format: 'Video',
          thumbnailKey: 'thumbs/aparat-doc.jpg',
        },
        topicIds: [1],
        sources: [{ title: 'آرشیو مستند معراج', url: 'https://www.aparat.com/v/sample123' }],
        files: [
          {
            kind: ContentFileKind.Main,
            storageType: FileStorageType.External,
            storageKey: null,
            externalUrl: 'https://www.aparat.com/v/sample123',
          },
        ],
      });

      assertEqual(result.isValid, true, 'Video with External Main file and source must pass');
    },
  },
  {
    id: 'stage3-publish-missing-topic-or-thumbnail',
    nameKey: 'health.card.tests.stage3Case7Name',
    descriptionKey: 'health.card.tests.stage3Case7Desc',
    run: () => {
      const noTopicResult = validateForPublish({
        ...buildValidArticleInput(),
        topicIds: [],
      });
      assertEqual(noTopicResult.isValid, false, 'Content without topics must fail');
      assert(
        noTopicResult.errors.some((err) => err.field === 'topicIds'),
        'Expected topicIds error',
      );

      const noThumbResult = validateForPublish({
        ...buildValidArticleInput(),
        item: {
          ...buildValidArticleInput().item,
          thumbnailKey: null,
        },
      });
      assertEqual(noThumbResult.isValid, false, 'Content without thumbnailKey must fail');
      assert(
        noThumbResult.errors.some((err) => err.field === 'thumbnailKey'),
        'Expected thumbnailKey error',
      );
    },
  },
  {
    id: 'stage3-publish-title-summary-limits',
    nameKey: 'health.card.tests.stage3Case8Name',
    descriptionKey: 'health.card.tests.stage3Case8Desc',
    run: () => {
      const emptyTitleResult = validateForPublish({
        ...buildValidArticleInput(),
        item: {
          ...buildValidArticleInput().item,
          title: '   ',
        },
      });
      assertEqual(emptyTitleResult.isValid, false, 'Empty title must fail');

      const longTitleResult = validateForPublish({
        ...buildValidArticleInput(),
        item: {
          ...buildValidArticleInput().item,
          title: 'الف'.repeat(201),
        },
      });
      assertEqual(longTitleResult.isValid, false, 'Title longer than 200 chars must fail');
      assert(
        longTitleResult.errors.some((err) => err.code === 'TITLE_TOO_LONG'),
        'Expected TITLE_TOO_LONG error',
      );

      const longSummaryResult = validateForPublish({
        ...buildValidArticleInput(),
        item: {
          ...buildValidArticleInput().item,
          summary: 'ب'.repeat(601),
        },
      });
      assertEqual(longSummaryResult.isValid, false, 'Summary longer than 600 chars must fail');
      assert(
        longSummaryResult.errors.some((err) => err.code === 'SUMMARY_TOO_LONG'),
        'Expected SUMMARY_TOO_LONG error',
      );
    },
  },
  {
    id: 'stage3-slug-service-persian',
    nameKey: 'health.card.tests.stage3Case9Name',
    descriptionKey: 'health.card.tests.stage3Case9Desc',
    run: () => {
      const base = generateSlug('مسیر اقتصاد');
      assertEqual(base, 'مسیر-اقتصاد', 'Slug for "مسیر اقتصاد" must be "مسیر-اقتصاد"');

      assertEqual(
        ensureUniqueSlug(base, ['مسیر-اقتصاد']),
        'مسیر-اقتصاد-2',
        'First duplicate must append -2',
      );
      assertEqual(
        ensureUniqueSlug(base, ['مسیر-اقتصاد', 'مسیر-اقتصاد-2']),
        'مسیر-اقتصاد-3',
        'Second duplicate must append -3',
      );

      const normalizedArabic = generateSlug('اقتصادِ يك كِشور — Testing!');
      assertEqual(
        normalizedArabic,
        'اقتصاد-یک-کشور-testing',
        'Arabic Yeh/Kaf, diacritics, punctuation, and Latin casing must normalize cleanly',
      );
    },
  },
];
