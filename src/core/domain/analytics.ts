import type { ContentFormat, ContentStatus } from './content';

export interface ViewEvent {
  id: number;
  contentId: number;
  userId: number | null;
  visitorId: string;
  ageGroupId: number | null;
  primaryTopicId: number | null;
  /** ISO 8601 UTC timestamp */
  occurredAt: string;
  isCounted: boolean;
}

export enum DownloadKind {
  File = 1,
  Story = 2,
}

export interface DownloadEvent {
  id: number;
  kind: DownloadKind;
  contentId: number;
  fileId: number | null;
  userId: number | null;
  ageGroupId: number | null;
  /** ISO 8601 UTC timestamp */
  occurredAt: string;
}

export interface DownloadTokenPayload {
  userId: number;
  contentId: number;
  fileId: number;
  issuedAtEpochMs: number;
  expiresAtEpochMs: number;
}

export type DashboardRangePreset = '7d' | '30d' | '90d' | 'all' | 'custom';

export interface DashboardFilter {
  preset: DashboardRangePreset;
  fromIso?: string | null;
  toIso?: string | null;
  topLimit?: number;
}

export interface DashboardSummary {
  uniqueVisitors: number;
  totalCountedViews: number;
  totalRawViews: number;
  averageViewsPerVisitor: number;
  totalDownloads: number;
  uniqueDownloaders: number;
}

export interface RankedContentStat {
  contentId: number;
  title: string;
  slug: string;
  format: ContentFormat;
  status: ContentStatus;
  count: number;
  uniqueUsers: number;
}

export interface PeriodStatRow {
  periodKey: string;
  periodStartIso: string;
  periodEndIso: string;
  countedViews: number;
  uniqueVisitors: number;
  downloads: number;
}

export interface EventIntegrityReport {
  totalViewEvents: number;
  viewEventsWithAgeGroup: number;
  viewEventsWithPrimaryTopic: number;
  totalDownloadEvents: number;
  downloadEventsWithAgeGroup: number;
}

export interface BasicDashboardStats {
  appliedPreset: DashboardRangePreset;
  fromIso: string | null;
  toIso: string | null;
  summary: DashboardSummary;
  topViewedContents: RankedContentStat[];
  topDownloadedContents: RankedContentStat[];
  dailyStats: PeriodStatRow[];
  weeklyStats: PeriodStatRow[];
  integrity: EventIntegrityReport;
}

export interface DailyStatRecord {
  /** UTC date key in YYYY-MM-DD format */
  date: string;
  /** AgeGroup id, or 0 when null / unspecified */
  ageGroupId: number;
  /** Root Topic id, or 0 when null / uncategorized */
  rootTopicId: number;
  views: number;
  downloads: number;
  /** ISO 8601 UTC timestamp of the aggregation run */
  updatedAt: string;
}

export interface DailyTrendChartPoint {
  dateKey: string;
  jalaliLabel: string;
  views: number;
  downloads: number;
}

export interface AgeGroupStatBreakdown {
  ageGroupId: number;
  ageGroupName: string;
  themeKey: string | null;
  views: number;
  downloads: number;
  viewsSharePercent: number;
  downloadsSharePercent: number;
}

export interface RootTopicStatBreakdown {
  rootTopicId: number;
  rootTopicName: string;
  views: number;
  downloads: number;
  totalInteractions: number;
}

export interface AdvancedDashboardAnalytics {
  appliedPreset: DashboardRangePreset;
  fromIso: string | null;
  toIso: string | null;
  trendSeries: DailyTrendChartPoint[];
  byAgeGroup: AgeGroupStatBreakdown[];
  byRootTopic: RootTopicStatBreakdown[];
  totalAggregatedViews: number;
  totalAggregatedDownloads: number;
  lastAggregatedAt: string | null;
}

export interface DailyAggregationOptions {
  /** Optional inclusive start UTC date key (YYYY-MM-DD) */
  fromDateKey?: string;
  /** Optional inclusive end UTC date key (YYYY-MM-DD) */
  toDateKey?: string;
}

export interface DailyAggregationResult {
  processedViewEvents: number;
  processedDownloadEvents: number;
  writtenRecordsCount: number;
  deletedStaleRecordsCount: number;
  aggregatedAt: string;
}

