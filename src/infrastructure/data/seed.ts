import type { ILogger } from '../../core/abstractions/ILogger';
import {
  FEATURE_FLAG_KEYS,
  type FeatureFlag,
  type SiteSetting,
} from '../../core/domain/settings';
import type { AgeGroup, ImpactLevel, Topic } from '../../core/domain/taxonomy';
import { generateSlug } from '../../core/services/slugService';
import type { IndexedDbDataStore } from './IndexedDbDataStore';
import { STORE_NAMES } from './migrations';

export interface SeedSummary {
  ageGroups: number;
  impactLevels: number;
  topics: number;
  featureFlags: number;
  siteSettings: number;
  allModulesDisabled: boolean;
  featureFlagItems: FeatureFlag[];
}

export interface SeedExecutionResult {
  insertedCount: number;
  summary: SeedSummary;
}

export const INITIAL_AGE_GROUPS: readonly AgeGroup[] = [
  {
    id: 1,
    key: 'child',
    name: 'کودک',
    minAge: 7,
    maxAge: 11,
    themeKey: 'playful',
    sortOrder: 1,
    isActive: true,
  },
  {
    id: 2,
    key: 'teen',
    name: 'نوجوان',
    minAge: 12,
    maxAge: 15,
    themeKey: 'modern',
    sortOrder: 2,
    isActive: true,
  },
  {
    id: 3,
    key: 'youth',
    name: 'جوان',
    minAge: 16,
    maxAge: 20,
    themeKey: 'modern',
    sortOrder: 3,
    isActive: true,
  },
  {
    id: 4,
    key: 'adult',
    name: 'بزرگسال (والدین و مربیان)',
    minAge: 21,
    maxAge: null,
    themeKey: 'editorial',
    sortOrder: 4,
    isActive: true,
  },
];

export const INITIAL_IMPACT_LEVELS: readonly ImpactLevel[] = [
  { id: 1, name: 'کم', sortOrder: 1 },
  { id: 2, name: 'متوسط', sortOrder: 2 },
  { id: 3, name: 'زیاد', sortOrder: 3 },
];

export const INITIAL_TOPICS: readonly Topic[] = [
  {
    id: 1,
    parentId: null,
    name: 'تاریخ',
    slug: generateSlug('تاریخ'),
    icon: 'landmark',
    sortOrder: 1,
    isActive: true,
  },
  {
    id: 2,
    parentId: null,
    name: 'رسانه و فضای مجازی',
    slug: generateSlug('رسانه و فضای مجازی'),
    icon: 'monitor',
    sortOrder: 2,
    isActive: true,
  },
  {
    id: 3,
    parentId: null,
    name: 'اندیشه و فرهنگ',
    slug: generateSlug('اندیشه و فرهنگ'),
    icon: 'book-open',
    sortOrder: 3,
    isActive: true,
  },
  {
    id: 4,
    parentId: null,
    name: 'اقتصاد',
    slug: generateSlug('اقتصاد'),
    icon: 'trending-up',
    sortOrder: 4,
    isActive: true,
  },
  {
    id: 5,
    parentId: null,
    name: 'خانواده و تربیت',
    slug: generateSlug('خانواده و تربیت'),
    icon: 'users',
    sortOrder: 5,
    isActive: true,
  },
  {
    id: 6,
    parentId: 1,
    name: 'ایران معاصر',
    slug: generateSlug('ایران معاصر'),
    icon: null,
    sortOrder: 6,
    isActive: true,
  },
  {
    id: 7,
    parentId: 2,
    name: 'سواد رسانه‌ای',
    slug: generateSlug('سواد رسانه‌ای'),
    icon: null,
    sortOrder: 7,
    isActive: true,
  },
  {
    id: 8,
    parentId: 3,
    name: 'دشمن‌شناسی',
    slug: generateSlug('دشمن‌شناسی'),
    icon: null,
    sortOrder: 8,
    isActive: true,
  },
  {
    id: 9,
    parentId: 4,
    name: 'اقتصاد مقاومتی',
    slug: generateSlug('اقتصاد مقاومتی'),
    icon: null,
    sortOrder: 9,
    isActive: true,
  },
  {
    id: 10,
    parentId: 5,
    name: 'مهارت‌های والدگری',
    slug: generateSlug('مهارت‌های والدگری'),
    icon: null,
    sortOrder: 10,
    isActive: true,
  },
];

export const INITIAL_FEATURE_FLAGS: readonly FeatureFlag[] = FEATURE_FLAG_KEYS.map((key) => ({
  key,
  isEnabled: false,
}));

export const INITIAL_SITE_SETTINGS: readonly SiteSetting[] = [
  { key: 'Site.Title', value: 'معراج اندیشه' },
  { key: 'Site.Subtitle', value: 'بانک محتوای مستند و تبیینی' },
  { key: 'Personalization.DefaultEnabled', value: '1' },
  { key: 'Personalization.MinViews', value: '3' },
  { key: 'Comments.MaxLength', value: '1000' },
  { key: 'Upload.MaxVideoMb', value: '500' },
  { key: 'Upload.MaxOtherMb', value: '100' },
  { key: 'Home.ItemsPerShelf', value: '12' },
];

export class DatabaseSeeder {
  private readonly dataStore: IndexedDbDataStore;
  private readonly logger: ILogger;
  private activeSeedPromise: Promise<SeedExecutionResult> | null = null;

  constructor(dataStore: IndexedDbDataStore, logger: ILogger) {
    this.dataStore = dataStore;
    this.logger = logger;
  }

  public async seed(logMessage?: string): Promise<SeedExecutionResult> {
    if (this.activeSeedPromise) {
      return this.activeSeedPromise;
    }

    this.activeSeedPromise = this.runSeedInternal(logMessage).finally(() => {
      this.activeSeedPromise = null;
    });

    return this.activeSeedPromise;
  }

  private async runSeedInternal(logMessage?: string): Promise<SeedExecutionResult> {
    await this.dataStore.connect();

    let insertedCount = 0;

    for (const ageGroup of INITIAL_AGE_GROUPS) {
      const inserted = await this.dataStore.putIfAbsent(
        STORE_NAMES.AGE_GROUPS,
        ageGroup.id,
        ageGroup,
      );
      if (inserted) insertedCount += 1;
    }

    for (const impact of INITIAL_IMPACT_LEVELS) {
      const inserted = await this.dataStore.putIfAbsent(
        STORE_NAMES.IMPACT_LEVELS,
        impact.id,
        impact,
      );
      if (inserted) insertedCount += 1;
    }

    for (const topic of INITIAL_TOPICS) {
      const inserted = await this.dataStore.putIfAbsent(
        STORE_NAMES.TOPICS,
        topic.id,
        topic,
      );
      if (inserted) insertedCount += 1;
    }

    for (const flag of INITIAL_FEATURE_FLAGS) {
      const inserted = await this.dataStore.putIfAbsent(
        STORE_NAMES.FEATURE_FLAGS,
        flag.key,
        flag,
      );
      if (inserted) insertedCount += 1;
    }

    for (const setting of INITIAL_SITE_SETTINGS) {
      const inserted = await this.dataStore.putIfAbsent(
        STORE_NAMES.SITE_SETTINGS,
        setting.key,
        setting,
      );
      if (inserted) insertedCount += 1;
    }

    const summary = await this.getSummary();

    if (logMessage) {
      this.logger.info(logMessage, {
        insertedCount,
        ageGroups: summary.ageGroups,
        impactLevels: summary.impactLevels,
        topics: summary.topics,
        featureFlags: summary.featureFlags,
        siteSettings: summary.siteSettings,
      });
    }

    return { insertedCount, summary };
  }

  public async getSummary(): Promise<SeedSummary> {
    await this.dataStore.connect();

    const [ageGroups, impactLevels, topics, featureFlagItems, siteSettings] = await Promise.all([
      this.dataStore.count(STORE_NAMES.AGE_GROUPS),
      this.dataStore.count(STORE_NAMES.IMPACT_LEVELS),
      this.dataStore.count(STORE_NAMES.TOPICS),
      this.dataStore.getAll<FeatureFlag>(STORE_NAMES.FEATURE_FLAGS),
      this.dataStore.count(STORE_NAMES.SITE_SETTINGS),
    ]);

    return {
      ageGroups,
      impactLevels,
      topics,
      featureFlags: featureFlagItems.length,
      siteSettings,
      allModulesDisabled:
        featureFlagItems.length > 0 && featureFlagItems.every((item) => item.isEnabled === false),
      featureFlagItems,
    };
  }
}
