import type { IClock } from '../abstractions/IClock';
import type { IDataStore } from '../abstractions/IDataStore';
import type { ILogger } from '../abstractions/ILogger';
import type {
  DailyAggregationOptions,
  DailyAggregationResult,
  DailyStatRecord,
  DownloadEvent,
  ViewEvent,
} from '../domain/analytics';
import type { ContentTopic } from '../domain/content';
import type { Topic } from '../domain/taxonomy';
import { resolveRootTopicId } from './viewTrackerService';

export const DAILY_STATS_LAST_AGGREGATED_META_KEY =
  'stage27_daily_stats_last_aggregated_at_v1';

export interface DailyStatAggregationStores {
  dailyStats: string;
  viewEvents: string;
  downloadEvents: string;
  contentTopics: string;
  topics: string;
}

export const DEFAULT_DAILY_STAT_AGGREGATION_STORES: Readonly<DailyStatAggregationStores> =
  Object.freeze({
    dailyStats: 'dailyStats',
    viewEvents: 'viewEvents',
    downloadEvents: 'downloadEvents',
    contentTopics: 'contentTopics',
    topics: 'topics',
  });

function normalizeDateKeyInput(raw: string | undefined): string | null {
  if (!raw || typeof raw !== 'string') {
    return null;
  }
  const trimmed = raw.trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (!match) {
    return null;
  }
  const year = Number.parseInt(match[1], 10);
  const monthIndex = Number.parseInt(match[2], 10) - 1;
  const day = Number.parseInt(match[3], 10);
  const probe = new Date(Date.UTC(year, monthIndex, day));
  if (
    Number.isNaN(probe.getTime()) ||
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== monthIndex ||
    probe.getUTCDate() !== day
  ) {
    return null;
  }
  return trimmed;
}

function toUtcDateKey(occurredAtIso: string): string | null {
  if (!occurredAtIso || typeof occurredAtIso !== 'string') {
    return null;
  }
  const parsedMs = Date.parse(occurredAtIso);
  if (Number.isNaN(parsedMs)) {
    return null;
  }
  return new Date(parsedMs).toISOString().slice(0, 10);
}

function isDateKeyInWindow(
  dateKey: string,
  fromDateKey: string | null,
  toDateKey: string | null,
): boolean {
  if (fromDateKey !== null && dateKey < fromDateKey) {
    return false;
  }
  if (toDateKey !== null && dateKey > toDateKey) {
    return false;
  }
  return true;
}

function normalizePositiveIntOrZero(value: number | null | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return 0;
  }
  return Math.floor(value);
}

interface StatBucket {
  date: string;
  ageGroupId: number;
  rootTopicId: number;
  views: number;
  downloads: number;
}

export class DailyStatAggregationService {
  private readonly dataStore: IDataStore;
  private readonly clock: IClock;
  private readonly logger?: ILogger;
  private readonly stores: DailyStatAggregationStores;

  constructor(
    dataStore: IDataStore,
    clock: IClock,
    logger?: ILogger,
    stores?: Partial<DailyStatAggregationStores>,
  ) {
    this.dataStore = dataStore;
    this.clock = clock;
    this.logger = logger;
    this.stores = {
      ...DEFAULT_DAILY_STAT_AGGREGATION_STORES,
      ...stores,
    };
  }

  public async getLastAggregatedAtAsync(): Promise<string | null> {
    const meta = await this.dataStore.getMeta(DAILY_STATS_LAST_AGGREGATED_META_KEY);
    if (!meta || !meta.value) {
      return null;
    }
    return meta.value;
  }

  /**
   * Idempotently aggregates ViewEvent (isCounted=true) and DownloadEvent into `dailyStats`.
   * Existing records within the processed date window are cleanly replaced by newly computed
   * totals so repeated runs never double-count metrics.
   */
  public async aggregateDailyStatsAsync(
    options?: DailyAggregationOptions,
  ): Promise<DailyAggregationResult> {
    const fromDateKey = normalizeDateKeyInput(options?.fromDateKey);
    const toDateKey = normalizeDateKeyInput(options?.toDateKey);

    const [viewEvents, downloadEvents, contentTopics, topics, existingDailyStats] =
      await Promise.all([
        this.dataStore.getAll<ViewEvent>(this.stores.viewEvents),
        this.dataStore.getAll<DownloadEvent>(this.stores.downloadEvents),
        this.dataStore.getAll<ContentTopic>(this.stores.contentTopics),
        this.dataStore.getAll<Topic>(this.stores.topics),
        this.dataStore.getAll<DailyStatRecord>(this.stores.dailyStats),
      ]);

    const topicIdsByContent = new Map<number, number[]>();
    for (const link of contentTopics) {
      const list = topicIdsByContent.get(link.contentId);
      if (list) {
        list.push(link.topicId);
      } else {
        topicIdsByContent.set(link.contentId, [link.topicId]);
      }
    }
    for (const list of topicIdsByContent.values()) {
      list.sort((a, b) => a - b);
    }

    const contentRootTopicCache = new Map<number, number>();
    const getContentRootTopicId = (contentId: number): number => {
      const cached = contentRootTopicCache.get(contentId);
      if (cached !== undefined) {
        return cached;
      }
      const linkedTopicIds = topicIdsByContent.get(contentId) ?? [];
      const resolved = resolveRootTopicId(linkedTopicIds, topics) ?? 0;
      contentRootTopicCache.set(contentId, resolved);
      return resolved;
    };

    const buckets = new Map<string, StatBucket>();
    const getOrCreateBucket = (
      date: string,
      ageGroupId: number,
      rootTopicId: number,
    ): StatBucket => {
      const compoundKey = `${date}|${ageGroupId}|${rootTopicId}`;
      let bucket = buckets.get(compoundKey);
      if (!bucket) {
        bucket = {
          date,
          ageGroupId,
          rootTopicId,
          views: 0,
          downloads: 0,
        };
        buckets.set(compoundKey, bucket);
      }
      return bucket;
    };

    let processedViewEvents = 0;
    for (const ev of viewEvents) {
      if (!ev.isCounted) {
        continue;
      }
      const dateKey = toUtcDateKey(ev.occurredAt);
      if (!dateKey || !isDateKeyInWindow(dateKey, fromDateKey, toDateKey)) {
        continue;
      }
      const ageGroupId = normalizePositiveIntOrZero(ev.ageGroupId);
      const rootTopicId =
        ev.primaryTopicId !== null && ev.primaryTopicId !== undefined && ev.primaryTopicId > 0
          ? (resolveRootTopicId([ev.primaryTopicId], topics) ?? 0)
          : getContentRootTopicId(ev.contentId);

      const bucket = getOrCreateBucket(dateKey, ageGroupId, rootTopicId);
      bucket.views += 1;
      processedViewEvents += 1;
    }

    let processedDownloadEvents = 0;
    for (const ev of downloadEvents) {
      const dateKey = toUtcDateKey(ev.occurredAt);
      if (!dateKey || !isDateKeyInWindow(dateKey, fromDateKey, toDateKey)) {
        continue;
      }
      const ageGroupId = normalizePositiveIntOrZero(ev.ageGroupId);
      const rootTopicId = getContentRootTopicId(ev.contentId);

      const bucket = getOrCreateBucket(dateKey, ageGroupId, rootTopicId);
      bucket.downloads += 1;
      processedDownloadEvents += 1;
    }

    // Delete any existing dailyStats entries in the processed date window that are no longer present
    // (and overwrite remaining entries idempotently with putRecord).
    let deletedStaleRecordsCount = 0;
    for (const existing of existingDailyStats) {
      if (!isDateKeyInWindow(existing.date, fromDateKey, toDateKey)) {
        continue;
      }
      const compoundKey = `${existing.date}|${existing.ageGroupId}|${existing.rootTopicId}`;
      if (!buckets.has(compoundKey)) {
        await this.dataStore.deleteByKey(this.stores.dailyStats, [
          existing.date,
          existing.ageGroupId,
          existing.rootTopicId,
        ]);
        deletedStaleRecordsCount += 1;
      }
    }

    const nowIso = this.clock.nowUtcIso();
    let writtenRecordsCount = 0;
    const sortedBuckets = Array.from(buckets.values()).sort((a, b) => {
      const dateCmp = a.date.localeCompare(b.date);
      if (dateCmp !== 0) {
        return dateCmp;
      }
      if (a.ageGroupId !== b.ageGroupId) {
        return a.ageGroupId - b.ageGroupId;
      }
      return a.rootTopicId - b.rootTopicId;
    });

    for (const bucket of sortedBuckets) {
      const record: DailyStatRecord = {
        date: bucket.date,
        ageGroupId: bucket.ageGroupId,
        rootTopicId: bucket.rootTopicId,
        views: bucket.views,
        downloads: bucket.downloads,
        updatedAt: nowIso,
      };
      await this.dataStore.putRecord(this.stores.dailyStats, record);
      writtenRecordsCount += 1;
    }

    await this.dataStore.setMeta({
      key: DAILY_STATS_LAST_AGGREGATED_META_KEY,
      value: nowIso,
      updatedAtUtc: nowIso,
    });

    this.logger?.info('DAILY_STATS_AGGREGATED', {
      fromDateKey,
      toDateKey,
      processedViewEvents,
      processedDownloadEvents,
      writtenRecordsCount,
      deletedStaleRecordsCount,
    });

    return {
      processedViewEvents,
      processedDownloadEvents,
      writtenRecordsCount,
      deletedStaleRecordsCount,
      aggregatedAt: nowIso,
    };
  }
}
