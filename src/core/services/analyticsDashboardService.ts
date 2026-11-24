import type { IClock } from '../abstractions/IClock';
import type { IContentRepository } from '../abstractions/contentRepository';
import type { IDownloadEventRepository } from '../abstractions/downloadRepository';
import type { ILogger } from '../abstractions/ILogger';
import type { IViewEventRepository } from '../abstractions/viewTracker';
import type {
  BasicDashboardStats,
  DashboardFilter,
  DashboardRangePreset,
  DownloadEvent,
  EventIntegrityReport,
  PeriodStatRow,
  RankedContentStat,
  ViewEvent,
} from '../domain/analytics';
import type { AppUser } from '../domain/auth';
import type { ContentItem } from '../domain/content';
import type { PermissionPolicyService } from './permissionPolicyService';

export const DEFAULT_DASHBOARD_TOP_LIMIT = 10;
export const MAX_DASHBOARD_TOP_LIMIT = 50;

export type DashboardErrorCode = 'FORBIDDEN' | 'NOT_FOUND' | 'INVALID_DATE_RANGE';

export type DashboardStatsResult =
  | {
      ok: true;
      statusCode: 200;
      data: BasicDashboardStats;
    }
  | {
      ok: false;
      statusCode: 400 | 403 | 404;
      errorCode: DashboardErrorCode;
    };

export interface AnalyticsDashboardServiceDependencies {
  viewEventRepository: IViewEventRepository;
  downloadEventRepository: IDownloadEventRepository;
  contentRepository: IContentRepository;
  permissionPolicyService: PermissionPolicyService;
  clock: IClock;
  logger?: ILogger;
}

const VALID_PRESETS: readonly DashboardRangePreset[] = [
  '7d',
  '30d',
  '90d',
  'all',
  'custom',
] as const;

export function parseDateBoundaryMs(
  raw: string | null | undefined,
  boundary: 'start' | 'end',
): number | null {
  if (!raw || typeof raw !== 'string') {
    return null;
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }

  let year: number;
  let monthIndex: number;
  let day: number;

  const ymdMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (ymdMatch) {
    year = Number.parseInt(ymdMatch[1], 10);
    monthIndex = Number.parseInt(ymdMatch[2], 10) - 1;
    day = Number.parseInt(ymdMatch[3], 10);
    const probe = new Date(Date.UTC(year, monthIndex, day));
    if (
      Number.isNaN(probe.getTime()) ||
      probe.getUTCFullYear() !== year ||
      probe.getUTCMonth() !== monthIndex ||
      probe.getUTCDate() !== day
    ) {
      return null;
    }
  } else {
    const parsedMs = Date.parse(trimmed);
    if (Number.isNaN(parsedMs)) {
      return null;
    }
    const parsedDate = new Date(parsedMs);
    year = parsedDate.getUTCFullYear();
    monthIndex = parsedDate.getUTCMonth();
    day = parsedDate.getUTCDate();
  }

  return boundary === 'start'
    ? Date.UTC(year, monthIndex, day, 0, 0, 0, 0)
    : Date.UTC(year, monthIndex, day, 23, 59, 59, 999);
}

export function resolveDashboardDateRange(
  clock: IClock,
  filter: DashboardFilter,
):
  | { ok: true; preset: DashboardRangePreset; fromMs: number | null; toMs: number | null }
  | { ok: false } {
  const preset: DashboardRangePreset = VALID_PRESETS.includes(filter.preset)
    ? filter.preset
    : '30d';

  if (preset === 'all') {
    return { ok: true, preset: 'all', fromMs: null, toMs: null };
  }

  if (preset === 'custom') {
    const fromMs = parseDateBoundaryMs(filter.fromIso, 'start');
    const toMs = parseDateBoundaryMs(filter.toIso, 'end');
    if (fromMs === null || toMs === null || fromMs > toMs) {
      return { ok: false };
    }
    return { ok: true, preset: 'custom', fromMs, toMs };
  }

  const now = clock.now();
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const d = now.getUTCDate();

  const daysCount = preset === '7d' ? 7 : preset === '90d' ? 90 : 30;
  const fromMs = Date.UTC(y, m, d - (daysCount - 1), 0, 0, 0, 0);
  const toMs = Date.UTC(y, m, d, 23, 59, 59, 999);

  return { ok: true, preset, fromMs, toMs };
}

function isWithinRange(
  occurredAtIso: string,
  fromMs: number | null,
  toMs: number | null,
): { matched: boolean; timestampMs: number } {
  const ms = Date.parse(occurredAtIso);
  if (Number.isNaN(ms)) {
    return { matched: false, timestampMs: 0 };
  }
  if (fromMs !== null && ms < fromMs) {
    return { matched: false, timestampMs: ms };
  }
  if (toMs !== null && ms > toMs) {
    return { matched: false, timestampMs: ms };
  }
  return { matched: true, timestampMs: ms };
}

function getVisitorUniqueKey(event: ViewEvent): string {
  return event.userId !== null ? `user:${event.userId}` : `visitor:${event.visitorId}`;
}

function getDownloaderUniqueKey(event: DownloadEvent): string {
  return event.userId !== null ? `user:${event.userId}` : `anon:${event.id}`;
}

function getUtcDayBounds(ms: number): {
  key: string;
  startIso: string;
  endIso: string;
} {
  const d = new Date(ms);
  const key = d.toISOString().slice(0, 10);
  return {
    key,
    startIso: `${key}T00:00:00.000Z`,
    endIso: `${key}T23:59:59.999Z`,
  };
}

/**
 * Computes Saturday-to-Friday standard 7-day Persian calendar week bounds for a UTC timestamp.
 */
function getUtcWeekBounds(ms: number): {
  key: string;
  startIso: string;
  endIso: string;
} {
  const d = new Date(ms);
  const offsetSinceSaturday = (d.getUTCDay() + 1) % 7;
  const startDate = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - offsetSinceSaturday, 0, 0, 0, 0),
  );
  const endDate = new Date(
    Date.UTC(
      startDate.getUTCFullYear(),
      startDate.getUTCMonth(),
      startDate.getUTCDate() + 6,
      23,
      59,
      59,
      999,
    ),
  );
  const key = startDate.toISOString().slice(0, 10);
  return {
    key,
    startIso: startDate.toISOString(),
    endIso: endDate.toISOString(),
  };
}

function buildRankedList(
  aggregates: Map<number, { count: number; uniqueKeys: Set<string> }>,
  contentById: Map<number, ContentItem>,
  limit: number,
): RankedContentStat[] {
  const rows: RankedContentStat[] = [];

  for (const [contentId, bucket] of aggregates.entries()) {
    const item = contentById.get(contentId);
    if (!item) {
      continue;
    }
    rows.push({
      contentId: item.id,
      title: item.title,
      slug: item.slug,
      format: item.format,
      status: item.status,
      count: bucket.count,
      uniqueUsers: bucket.uniqueKeys.size,
    });
  }

  rows.sort((a, b) => {
    if (b.count !== a.count) {
      return b.count - a.count;
    }
    if (b.uniqueUsers !== a.uniqueUsers) {
      return b.uniqueUsers - a.uniqueUsers;
    }
    return a.contentId - b.contentId;
  });

  return rows.slice(0, limit);
}

interface PeriodBucketAccumulator {
  periodKey: string;
  periodStartIso: string;
  periodEndIso: string;
  countedViews: number;
  visitorKeys: Set<string>;
  downloads: number;
}

export class AnalyticsDashboardService {
  private readonly viewEventRepository: IViewEventRepository;
  private readonly downloadEventRepository: IDownloadEventRepository;
  private readonly contentRepository: IContentRepository;
  private readonly permissionPolicyService: PermissionPolicyService;
  private readonly clock: IClock;
  private readonly logger?: ILogger;

  constructor(deps: AnalyticsDashboardServiceDependencies) {
    this.viewEventRepository = deps.viewEventRepository;
    this.downloadEventRepository = deps.downloadEventRepository;
    this.contentRepository = deps.contentRepository;
    this.permissionPolicyService = deps.permissionPolicyService;
    this.clock = deps.clock;
    this.logger = deps.logger;
  }

  public async getBasicDashboardStatsAsync(
    actor: AppUser | null,
    filter?: Partial<DashboardFilter>,
  ): Promise<DashboardStatsResult> {
    const auth = await this.permissionPolicyService.authorizePermission(
      actor,
      'dashboard.view',
      '#/admin/dashboard',
    );
    if (!auth.allowed) {
      return {
        ok: false,
        statusCode: auth.statusCode === 403 ? 403 : 404,
        errorCode: auth.statusCode === 403 ? 'FORBIDDEN' : 'NOT_FOUND',
      };
    }

    const normalizedFilter: DashboardFilter = {
      preset: filter?.preset ?? '30d',
      fromIso: filter?.fromIso ?? null,
      toIso: filter?.toIso ?? null,
      topLimit: filter?.topLimit,
    };

    const resolvedRange = resolveDashboardDateRange(this.clock, normalizedFilter);
    if (!resolvedRange.ok) {
      this.logger?.info('DASHBOARD_INVALID_DATE_RANGE', {
        actorId: actor?.id ?? null,
        fromIso: normalizedFilter.fromIso,
        toIso: normalizedFilter.toIso,
      });
      return {
        ok: false,
        statusCode: 400,
        errorCode: 'INVALID_DATE_RANGE',
      };
    }

    const rawTopLimit =
      typeof normalizedFilter.topLimit === 'number' && Number.isFinite(normalizedFilter.topLimit)
        ? Math.floor(normalizedFilter.topLimit)
        : DEFAULT_DASHBOARD_TOP_LIMIT;
    const topLimit = Math.min(Math.max(rawTopLimit, 1), MAX_DASHBOARD_TOP_LIMIT);

    const [allViewEvents, allDownloadEvents, allContentItems] = await Promise.all([
      this.viewEventRepository.getAllViewEvents(),
      this.downloadEventRepository.getAllDownloadEvents(),
      this.contentRepository.getAllContentItems(),
    ]);

    const contentById = new Map<number, ContentItem>(
      allContentItems.map((item) => [item.id, item]),
    );

    const countedVisitorKeys = new Set<string>();
    const downloaderKeys = new Set<string>();

    const viewedAgg = new Map<number, { count: number; uniqueKeys: Set<string> }>();
    const downloadedAgg = new Map<number, { count: number; uniqueKeys: Set<string> }>();

    const dailyBuckets = new Map<string, PeriodBucketAccumulator>();
    const weeklyBuckets = new Map<string, PeriodBucketAccumulator>();

    const ensurePeriodBucket = (
      map: Map<string, PeriodBucketAccumulator>,
      bounds: { key: string; startIso: string; endIso: string },
    ): PeriodBucketAccumulator => {
      let bucket = map.get(bounds.key);
      if (!bucket) {
        bucket = {
          periodKey: bounds.key,
          periodStartIso: bounds.startIso,
          periodEndIso: bounds.endIso,
          countedViews: 0,
          visitorKeys: new Set<string>(),
          downloads: 0,
        };
        map.set(bounds.key, bucket);
      }
      return bucket;
    };

    let totalRawViews = 0;
    let totalCountedViews = 0;
    let viewEventsWithAgeGroup = 0;
    let viewEventsWithPrimaryTopic = 0;

    for (const ev of allViewEvents) {
      const check = isWithinRange(ev.occurredAt, resolvedRange.fromMs, resolvedRange.toMs);
      if (!check.matched) {
        continue;
      }

      totalRawViews += 1;
      if (ev.ageGroupId !== null) {
        viewEventsWithAgeGroup += 1;
      }
      if (ev.primaryTopicId !== null) {
        viewEventsWithPrimaryTopic += 1;
      }

      if (!ev.isCounted) {
        continue;
      }

      totalCountedViews += 1;
      const visitorKey = getVisitorUniqueKey(ev);
      countedVisitorKeys.add(visitorKey);

      let contentBucket = viewedAgg.get(ev.contentId);
      if (!contentBucket) {
        contentBucket = { count: 0, uniqueKeys: new Set<string>() };
        viewedAgg.set(ev.contentId, contentBucket);
      }
      contentBucket.count += 1;
      contentBucket.uniqueKeys.add(visitorKey);

      const dayBucket = ensurePeriodBucket(dailyBuckets, getUtcDayBounds(check.timestampMs));
      dayBucket.countedViews += 1;
      dayBucket.visitorKeys.add(visitorKey);

      const weekBucket = ensurePeriodBucket(weeklyBuckets, getUtcWeekBounds(check.timestampMs));
      weekBucket.countedViews += 1;
      weekBucket.visitorKeys.add(visitorKey);
    }

    let totalDownloads = 0;
    let downloadEventsWithAgeGroup = 0;

    for (const ev of allDownloadEvents) {
      const check = isWithinRange(ev.occurredAt, resolvedRange.fromMs, resolvedRange.toMs);
      if (!check.matched) {
        continue;
      }

      totalDownloads += 1;
      if (ev.ageGroupId !== null) {
        downloadEventsWithAgeGroup += 1;
      }

      const downloaderKey = getDownloaderUniqueKey(ev);
      downloaderKeys.add(downloaderKey);

      let contentBucket = downloadedAgg.get(ev.contentId);
      if (!contentBucket) {
        contentBucket = { count: 0, uniqueKeys: new Set<string>() };
        downloadedAgg.set(ev.contentId, contentBucket);
      }
      contentBucket.count += 1;
      contentBucket.uniqueKeys.add(downloaderKey);

      const dayBucket = ensurePeriodBucket(dailyBuckets, getUtcDayBounds(check.timestampMs));
      dayBucket.downloads += 1;

      const weekBucket = ensurePeriodBucket(weeklyBuckets, getUtcWeekBounds(check.timestampMs));
      weekBucket.downloads += 1;
    }

    const uniqueVisitors = countedVisitorKeys.size;
    const averageViewsPerVisitor =
      uniqueVisitors > 0 ? Math.round((totalCountedViews / uniqueVisitors) * 10) / 10 : 0;

    const toPeriodRows = (map: Map<string, PeriodBucketAccumulator>): PeriodStatRow[] =>
      Array.from(map.values())
        .sort((a, b) => b.periodStartIso.localeCompare(a.periodStartIso))
        .map((bucket) => ({
          periodKey: bucket.periodKey,
          periodStartIso: bucket.periodStartIso,
          periodEndIso: bucket.periodEndIso,
          countedViews: bucket.countedViews,
          uniqueVisitors: bucket.visitorKeys.size,
          downloads: bucket.downloads,
        }));

    const integrity: EventIntegrityReport = {
      totalViewEvents: totalRawViews,
      viewEventsWithAgeGroup,
      viewEventsWithPrimaryTopic,
      totalDownloadEvents: totalDownloads,
      downloadEventsWithAgeGroup,
    };

    return {
      ok: true,
      statusCode: 200,
      data: {
        appliedPreset: resolvedRange.preset,
        fromIso:
          resolvedRange.fromMs !== null ? new Date(resolvedRange.fromMs).toISOString() : null,
        toIso: resolvedRange.toMs !== null ? new Date(resolvedRange.toMs).toISOString() : null,
        summary: {
          uniqueVisitors,
          totalCountedViews,
          totalRawViews,
          averageViewsPerVisitor,
          totalDownloads,
          uniqueDownloaders: downloaderKeys.size,
        },
        topViewedContents: buildRankedList(viewedAgg, contentById, topLimit),
        topDownloadedContents: buildRankedList(downloadedAgg, contentById, topLimit),
        dailyStats: toPeriodRows(dailyBuckets),
        weeklyStats: toPeriodRows(weeklyBuckets),
        integrity,
      },
    };
  }
}
