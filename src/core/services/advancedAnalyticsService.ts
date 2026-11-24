import type { IClock } from '../abstractions/IClock';
import type { ILogger } from '../abstractions/ILogger';
import type { IAdminRepository } from '../abstractions/adminRepository';
import type { IDailyStatRepository } from '../abstractions/dailyStatRepository';
import type { ITaxonomyRepository } from '../abstractions/taxonomyRepository';
import type {
  AdvancedDashboardAnalytics,
  AgeGroupStatBreakdown,
  DailyAggregationResult,
  DailyStatRecord,
  DailyTrendChartPoint,
  DashboardFilter,
  RootTopicStatBreakdown,
} from '../domain/analytics';
import type { AppUser } from '../domain/auth';
import type { AgeGroup, Topic } from '../domain/taxonomy';
import {
  resolveDashboardDateRange,
  type DashboardErrorCode,
} from './analyticsDashboardService';
import type { DailyStatAggregationService } from './dailyStatAggregationService';
import { dateToJalali, formatJalaliDate } from './jalaliCalendarService';
import type { PermissionPolicyService } from './permissionPolicyService';

export type AdvancedAnalyticsResult =
  | {
      ok: true;
      statusCode: 200;
      data: AdvancedDashboardAnalytics;
    }
  | {
      ok: false;
      statusCode: 400 | 403 | 404;
      errorCode: DashboardErrorCode;
    };

export type ManualAggregationResult =
  | {
      ok: true;
      statusCode: 200;
      data: DailyAggregationResult;
    }
  | {
      ok: false;
      statusCode: 403 | 404;
      errorCode: 'FORBIDDEN' | 'NOT_FOUND';
    };

export interface AdvancedAnalyticsQueryOptions {
  refreshAggregation?: boolean;
  unknownAgeGroupLabel?: string;
  uncategorizedTopicLabel?: string;
}

export interface AdvancedAnalyticsServiceDependencies {
  dailyStatRepository: IDailyStatRepository;
  dailyStatAggregationService: DailyStatAggregationService;
  adminRepository: IAdminRepository;
  taxonomyRepository: ITaxonomyRepository;
  permissionPolicyService: PermissionPolicyService;
  clock: IClock;
  logger?: ILogger;
}

function formatUtcDateKeyToJalali(dateKey: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  if (!match) {
    return dateKey;
  }
  const year = Number.parseInt(match[1], 10);
  const monthIndex = Number.parseInt(match[2], 10) - 1;
  const day = Number.parseInt(match[3], 10);
  const d = new Date(Date.UTC(year, monthIndex, day));
  if (Number.isNaN(d.getTime())) {
    return dateKey;
  }
  const jalali = dateToJalali(d, true);
  return formatJalaliDate(jalali.jy, jalali.jm, jalali.jd, true);
}

function computeSharePercent(value: number, total: number): number {
  if (total <= 0 || value <= 0) {
    return 0;
  }
  return Math.round((value / total) * 1000) / 10;
}

export class AdvancedAnalyticsService {
  private readonly dailyStatRepository: IDailyStatRepository;
  private readonly dailyStatAggregationService: DailyStatAggregationService;
  private readonly adminRepository: IAdminRepository;
  private readonly taxonomyRepository: ITaxonomyRepository;
  private readonly permissionPolicyService: PermissionPolicyService;
  private readonly clock: IClock;
  private readonly logger?: ILogger;

  constructor(deps: AdvancedAnalyticsServiceDependencies) {
    this.dailyStatRepository = deps.dailyStatRepository;
    this.dailyStatAggregationService = deps.dailyStatAggregationService;
    this.adminRepository = deps.adminRepository;
    this.taxonomyRepository = deps.taxonomyRepository;
    this.permissionPolicyService = deps.permissionPolicyService;
    this.clock = deps.clock;
    this.logger = deps.logger;
  }

  public async runManualAggregationAsync(
    actor: AppUser | null,
  ): Promise<ManualAggregationResult> {
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

    const result = await this.dailyStatAggregationService.aggregateDailyStatsAsync();
    this.logger?.info('ADVANCED_ANALYTICS_MANUAL_AGGREGATION', {
      actorId: actor?.id ?? null,
      writtenRecordsCount: result.writtenRecordsCount,
    });
    return {
      ok: true,
      statusCode: 200,
      data: result,
    };
  }

  public async getAdvancedDashboardAnalyticsAsync(
    actor: AppUser | null,
    filter?: Partial<DashboardFilter>,
    options?: AdvancedAnalyticsQueryOptions,
  ): Promise<AdvancedAnalyticsResult> {
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
    };

    const resolvedRange = resolveDashboardDateRange(this.clock, normalizedFilter);
    if (!resolvedRange.ok) {
      this.logger?.info('ADVANCED_DASHBOARD_INVALID_DATE_RANGE', {
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

    if (options?.refreshAggregation !== false) {
      await this.dailyStatAggregationService.aggregateDailyStatsAsync();
    }

    const [allStats, ageGroups, topics, lastAggregatedAt] = await Promise.all([
      this.dailyStatRepository.getAllDailyStats(),
      this.taxonomyRepository.getAllAgeGroups(),
      this.taxonomyRepository.getAllTopics(),
      this.dailyStatAggregationService.getLastAggregatedAtAsync(),
    ]);

    const fromDateKey =
      resolvedRange.fromMs !== null
        ? new Date(resolvedRange.fromMs).toISOString().slice(0, 10)
        : null;
    const toDateKey =
      resolvedRange.toMs !== null
        ? new Date(resolvedRange.toMs).toISOString().slice(0, 10)
        : null;

    const filteredStats: DailyStatRecord[] = allStats.filter((rec) => {
      if (fromDateKey !== null && rec.date < fromDateKey) {
        return false;
      }
      if (toDateKey !== null && rec.date > toDateKey) {
        return false;
      }
      return true;
    });

    const trendMap = new Map<string, { views: number; downloads: number }>();
    const ageMap = new Map<number, { views: number; downloads: number }>();
    const topicMap = new Map<number, { views: number; downloads: number }>();

    let totalAggregatedViews = 0;
    let totalAggregatedDownloads = 0;

    for (const rec of filteredStats) {
      totalAggregatedViews += rec.views;
      totalAggregatedDownloads += rec.downloads;

      const dayBucket = trendMap.get(rec.date) ?? { views: 0, downloads: 0 };
      dayBucket.views += rec.views;
      dayBucket.downloads += rec.downloads;
      trendMap.set(rec.date, dayBucket);

      const ageBucket = ageMap.get(rec.ageGroupId) ?? { views: 0, downloads: 0 };
      ageBucket.views += rec.views;
      ageBucket.downloads += rec.downloads;
      ageMap.set(rec.ageGroupId, ageBucket);

      const topicBucket = topicMap.get(rec.rootTopicId) ?? { views: 0, downloads: 0 };
      topicBucket.views += rec.views;
      topicBucket.downloads += rec.downloads;
      topicMap.set(rec.rootTopicId, topicBucket);
    }

    const trendSeries: DailyTrendChartPoint[] = Array.from(trendMap.entries())
      .sort(([dateA], [dateB]) => dateA.localeCompare(dateB))
      .map(([dateKey, counts]) => ({
        dateKey,
        jalaliLabel: formatUtcDateKeyToJalali(dateKey),
        views: counts.views,
        downloads: counts.downloads,
      }));

    const sortedAgeGroups = [...ageGroups].sort((a, b) => a.sortOrder - b.sortOrder);
    const ageGroupById = new Map<number, AgeGroup>(
      sortedAgeGroups.map((group) => [group.id, group]),
    );

    const unknownAgeGroupLabel = options?.unknownAgeGroupLabel ?? '-';
    const byAgeGroup: AgeGroupStatBreakdown[] = [];

    for (const group of sortedAgeGroups) {
      const counts = ageMap.get(group.id) ?? { views: 0, downloads: 0 };
      byAgeGroup.push({
        ageGroupId: group.id,
        ageGroupName: group.name,
        themeKey: group.themeKey,
        views: counts.views,
        downloads: counts.downloads,
        viewsSharePercent: computeSharePercent(counts.views, totalAggregatedViews),
        downloadsSharePercent: computeSharePercent(counts.downloads, totalAggregatedDownloads),
      });
    }

    // Include any non-registered or unspecified (0) ageGroupIds that have events
    const extraAgeIds = Array.from(ageMap.keys())
      .filter((id) => !ageGroupById.has(id))
      .sort((a, b) => {
        if (a === 0) return 1;
        if (b === 0) return -1;
        return a - b;
      });

    for (const extraId of extraAgeIds) {
      const counts = ageMap.get(extraId)!;
      if (counts.views === 0 && counts.downloads === 0) {
        continue;
      }
      byAgeGroup.push({
        ageGroupId: extraId,
        ageGroupName: extraId === 0 ? unknownAgeGroupLabel : `${unknownAgeGroupLabel} (${extraId})`,
        themeKey: null,
        views: counts.views,
        downloads: counts.downloads,
        viewsSharePercent: computeSharePercent(counts.views, totalAggregatedViews),
        downloadsSharePercent: computeSharePercent(counts.downloads, totalAggregatedDownloads),
      });
    }

    const rootTopicById = new Map<number, Topic>(
      topics.filter((t) => t.parentId === null).map((t) => [t.id, t]),
    );
    const allTopicById = new Map<number, Topic>(topics.map((t) => [t.id, t]));
    const uncategorizedTopicLabel = options?.uncategorizedTopicLabel ?? '-';

    const byRootTopic: RootTopicStatBreakdown[] = Array.from(topicMap.entries())
      .map(([rootTopicId, counts]) => {
        const matchedTopic = rootTopicById.get(rootTopicId) ?? allTopicById.get(rootTopicId);
        const rootTopicName =
          rootTopicId === 0
            ? uncategorizedTopicLabel
            : (matchedTopic?.name ?? `${uncategorizedTopicLabel} (${rootTopicId})`);
        return {
          rootTopicId,
          rootTopicName,
          views: counts.views,
          downloads: counts.downloads,
          totalInteractions: counts.views + counts.downloads,
        };
      })
      .filter((row) => row.totalInteractions > 0)
      .sort((a, b) => {
        if (b.totalInteractions !== a.totalInteractions) {
          return b.totalInteractions - a.totalInteractions;
        }
        if (b.views !== a.views) {
          return b.views - a.views;
        }
        return a.rootTopicId - b.rootTopicId;
      });

    return {
      ok: true,
      statusCode: 200,
      data: {
        appliedPreset: resolvedRange.preset,
        fromIso:
          resolvedRange.fromMs !== null ? new Date(resolvedRange.fromMs).toISOString() : null,
        toIso: resolvedRange.toMs !== null ? new Date(resolvedRange.toMs).toISOString() : null,
        trendSeries,
        byAgeGroup,
        byRootTopic,
        totalAggregatedViews,
        totalAggregatedDownloads,
        lastAggregatedAt,
      },
    };
  }
}
