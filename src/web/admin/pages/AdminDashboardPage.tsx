import {
  BarChart3,
  Calendar,
  Download,
  ExternalLink,
  Eye,
  FileSpreadsheet,
  RefreshCw,
  ShieldCheck,
  TrendingUp,
  Users,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import type {
  AdvancedDashboardAnalytics,
  BasicDashboardStats,
  DashboardFilter,
  DashboardRangePreset,
  PeriodStatRow,
  RankedContentStat,
} from '../../../core/domain/analytics';
import { ContentStatus } from '../../../core/domain/content';
import { buildAdvancedAnalyticsCsv } from '../../../core/services/analyticsCsvService';
import {
  dateToJalali,
  formatJalaliDate,
  getTodayJalali,
  jalaliToUtcRangeBounds,
} from '../../../core/services/jalaliCalendarService';
import { useAuth } from '../../auth/AuthContext';
import {
  AgeGroupBreakdownChart,
  DailyTrendChart,
  RootTopicBreakdownChart,
} from '../../components/charts';
import { Alert, Button, JalaliDatePicker } from '../../components/ui';
import type { ResourceKey } from '../../resources/fa';
import { toPersianDigits } from '../../resources/formatters';
import { t } from '../../resources/i18n';
import { appContainer } from '../../services/appContainer';
import { AdminLayout } from '../AdminLayout';

export interface AdminDashboardPageProps {
  currentRoute: string;
}

type PeriodTabKey = 'daily' | 'weekly';

const RANGE_PRESETS: readonly DashboardRangePreset[] = ['7d', '30d', '90d', 'all', 'custom'];

function getTodayJalaliFormatted(): string {
  const today = getTodayJalali(true);
  return formatJalaliDate(today.jy, today.jm, today.jd, true);
}

function getDaysAgoJalaliFormatted(daysAgo: number): string {
  const now = new Date();
  const d = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - daysAgo),
  );
  const jalali = dateToJalali(d, true);
  return formatJalaliDate(jalali.jy, jalali.jm, jalali.jd, true);
}

function formatJalaliIsoUtcPersian(isoTimestamp: string | null | undefined): string {
  if (!isoTimestamp) {
    return '—';
  }
  const parsed = new Date(isoTimestamp);
  if (Number.isNaN(parsed.getTime())) {
    return '—';
  }
  const j = dateToJalali(parsed, true);
  return formatJalaliDate(j.jy, j.jm, j.jd, true);
}

function formatJalaliDateTimeLocalPersian(isoTimestamp: string | null | undefined): string {
  if (!isoTimestamp) {
    return '—';
  }
  const parsed = new Date(isoTimestamp);
  if (Number.isNaN(parsed.getTime())) {
    return '—';
  }
  const j = dateToJalali(parsed, false);
  const datePart = formatJalaliDate(j.jy, j.jm, j.jd, true);
  const hh = String(parsed.getHours()).padStart(2, '0');
  const mm = String(parsed.getMinutes()).padStart(2, '0');
  return `${datePart} · ${toPersianDigits(`${hh}:${mm}`)}`;
}

function getTodayJalaliFilenameSlug(): string {
  const today = getTodayJalali(false);
  return formatJalaliDate(today.jy, today.jm, today.jd, false).replace(/\//g, '-');
}

function getStatusLabelKey(status: ContentStatus): ResourceKey {
  switch (status) {
    case ContentStatus.Published:
      return 'content.status.Published';
    case ContentStatus.Archived:
      return 'content.status.Archived';
    case ContentStatus.Draft:
    default:
      return 'content.status.Draft';
  }
}

function computePercent(numerator: number, denominator: number): number {
  if (denominator <= 0) {
    return 0;
  }
  return Math.min(100, Math.max(0, Math.round((numerator / denominator) * 100)));
}

function RankedContentTable({
  title,
  subtitle,
  countHeader,
  uniqueHeader,
  emptyMessage,
  rows,
  barToneClass,
}: {
  title: string;
  subtitle: string;
  countHeader: string;
  uniqueHeader: string;
  emptyMessage: string;
  rows: readonly RankedContentStat[];
  barToneClass: string;
}) {
  const maxCount = useMemo(
    () => rows.reduce((max, row) => (row.count > max ? row.count : max), 0),
    [rows],
  );

  return (
    <section className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-card)] shadow-[var(--shadow-card)] p-4 sm:p-5 flex flex-col gap-4 min-w-0">
      <header className="space-y-1 pb-3 border-b border-[var(--color-border)]">
        <h2 className="text-sm sm:text-base font-bold text-[var(--color-text)]">{title}</h2>
        <p className="text-xs text-[var(--color-muted)]">{subtitle}</p>
      </header>

      {rows.length === 0 ? (
        <div className="py-8 text-center text-xs sm:text-sm text-[var(--color-muted)]">
          {emptyMessage}
        </div>
      ) : (
        <div className="overflow-x-auto -mx-2 px-2">
          <table className="w-full min-w-[440px] text-xs sm:text-sm border-collapse">
            <thead>
              <tr className="border-b border-[var(--color-border)] text-[var(--color-muted)] text-[11px] sm:text-xs">
                <th scope="col" className="py-2 ps-1 pe-2 text-start font-medium w-10">
                  {t('admin.dashboard.table.colRank')}
                </th>
                <th scope="col" className="py-2 px-2 text-start font-medium">
                  {t('admin.dashboard.table.colTitle')}
                </th>
                <th scope="col" className="py-2 px-2 text-end font-medium whitespace-nowrap">
                  {countHeader}
                </th>
                <th scope="col" className="py-2 ps-2 pe-1 text-end font-medium whitespace-nowrap">
                  {uniqueHeader}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-border)]">
              {rows.map((row, idx) => {
                const widthPercent = maxCount > 0 ? Math.round((row.count / maxCount) * 100) : 0;
                const formatText = t(`content.format.${row.format}` as ResourceKey);
                const isPublished = row.status === ContentStatus.Published;
                return (
                  <tr
                    key={row.contentId}
                    className="hover:bg-[var(--color-surface-alt)] transition-colors"
                  >
                    <td className="py-2.5 ps-1 pe-2 align-top font-semibold text-[var(--color-muted)] tabular-nums-strict">
                      {toPersianDigits(idx + 1)}
                    </td>
                    <td className="py-2.5 px-2 align-top min-w-0">
                      <div className="space-y-1">
                        {isPublished ? (
                          <a
                            href={`#/content/${encodeURIComponent(row.slug)}`}
                            aria-label={t('admin.dashboard.table.openContentAria', {
                              title: row.title,
                            })}
                            className="inline-flex items-center gap-1 font-semibold text-[var(--color-text)] hover:text-[var(--color-primary)] transition-colors break-words"
                          >
                            <span>{row.title}</span>
                            <ExternalLink
                              className="w-3 h-3 shrink-0 opacity-70"
                              aria-hidden="true"
                            />
                          </a>
                        ) : (
                          <span className="font-semibold text-[var(--color-text)] break-words">
                            {row.title}
                          </span>
                        )}
                        <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-[var(--color-muted)]">
                          <span>{formatText}</span>
                          {!isPublished ? (
                            <>
                              <span aria-hidden="true">·</span>
                              <span>{t(getStatusLabelKey(row.status))}</span>
                            </>
                          ) : null}
                        </div>
                        <div
                          aria-hidden="true"
                          className="h-1.5 w-full rounded-full bg-[var(--color-surface-alt)] overflow-hidden"
                        >
                          <div
                            className={`h-full rounded-full ${barToneClass}`}
                            style={{ width: `${Math.max(widthPercent, 4)}%` }}
                          />
                        </div>
                      </div>
                    </td>
                    <td className="py-2.5 px-2 align-top text-end font-bold text-[var(--color-text)] tabular-nums-strict whitespace-nowrap">
                      {toPersianDigits(row.count)}
                    </td>
                    <td className="py-2.5 ps-2 pe-1 align-top text-end font-medium text-[var(--color-muted)] tabular-nums-strict whitespace-nowrap">
                      {toPersianDigits(row.uniqueUsers)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export function AdminDashboardPage({ currentRoute }: AdminDashboardPageProps) {
  const { currentUser } = useAuth();

  const [selectedPreset, setSelectedPreset] = useState<DashboardRangePreset>('30d');
  const [customFromDate, setCustomFromDate] = useState<string>(() =>
    getDaysAgoJalaliFormatted(6),
  );
  const [customToDate, setCustomToDate] = useState<string>(() => getTodayJalaliFormatted());
  const [periodTab, setPeriodTab] = useState<PeriodTabKey>('daily');

  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isAggregating, setIsAggregating] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [actionFeedback, setActionFeedback] = useState<{
    variant: 'success' | 'info';
    message: string;
  } | null>(null);
  const [stats, setStats] = useState<BasicDashboardStats | null>(null);
  const [advancedAnalytics, setAdvancedAnalytics] =
    useState<AdvancedDashboardAnalytics | null>(null);

  const loadStats = useCallback(
    async (filter: Partial<DashboardFilter>) => {
      if (!currentUser) {
        return;
      }
      setIsLoading(true);
      setErrorMessage(null);
      try {
        await appContainer.ensureInitializedAtStartup();
        const [basicResult, advancedResult] = await Promise.all([
          appContainer.analyticsDashboardService.getBasicDashboardStatsAsync(
            currentUser,
            filter,
          ),
          appContainer.advancedAnalyticsService.getAdvancedDashboardAnalyticsAsync(
            currentUser,
            filter,
            {
              unknownAgeGroupLabel: t('admin.dashboard.advanced.unknownAgeGroup'),
              uncategorizedTopicLabel: t('admin.dashboard.advanced.uncategorizedTopic'),
            },
          ),
        ]);
        if (!basicResult.ok) {
          if (basicResult.errorCode === 'INVALID_DATE_RANGE') {
            setErrorMessage(t('admin.dashboard.error.INVALID_DATE_RANGE'));
          } else {
            setErrorMessage(t('admin.dashboard.error.generic'));
          }
          return;
        }
        setStats(basicResult.data);
        if (advancedResult.ok) {
          setAdvancedAnalytics(advancedResult.data);
        } else if (advancedResult.errorCode === 'INVALID_DATE_RANGE') {
          setErrorMessage(t('admin.dashboard.error.INVALID_DATE_RANGE'));
        }
      } catch {
        setErrorMessage(t('admin.dashboard.error.generic'));
      } finally {
        setIsLoading(false);
      }
    },
    [currentUser],
  );

  useEffect(() => {
    void loadStats({ preset: '30d' });
  }, [loadStats]);

  const runCustomJalaliFilter = useCallback(
    (fromJalali: string, toJalali: string) => {
      const bounds = jalaliToUtcRangeBounds(fromJalali, toJalali);
      void loadStats({
        preset: 'custom',
        fromIso: bounds?.fromIso ?? null,
        toIso: bounds?.toIso ?? null,
      });
    },
    [loadStats],
  );

  const handleSelectPreset = (preset: DashboardRangePreset) => {
    setSelectedPreset(preset);
    if (preset === 'custom') {
      const fromVal = customFromDate || getDaysAgoJalaliFormatted(6);
      const toVal = customToDate || getTodayJalaliFormatted();
      if (!customFromDate) setCustomFromDate(fromVal);
      if (!customToDate) setCustomToDate(toVal);
      runCustomJalaliFilter(fromVal, toVal);
      return;
    }
    void loadStats({ preset });
  };

  const handleCustomFilterSubmit = (event: FormEvent) => {
    event.preventDefault();
    setSelectedPreset('custom');
    runCustomJalaliFilter(customFromDate, customToDate);
  };

  const handleRefresh = () => {
    setActionFeedback(null);
    if (selectedPreset === 'custom') {
      runCustomJalaliFilter(customFromDate, customToDate);
      return;
    }
    void loadStats({ preset: selectedPreset });
  };

  const handleRunManualAggregation = async () => {
    if (!currentUser || isAggregating) {
      return;
    }
    setIsAggregating(true);
    setErrorMessage(null);
    setActionFeedback(null);
    try {
      await appContainer.ensureInitializedAtStartup();
      const result = await appContainer.advancedAnalyticsService.runManualAggregationAsync(
        currentUser,
      );
      if (!result.ok) {
        setErrorMessage(t('admin.dashboard.error.generic'));
        return;
      }
      setActionFeedback({
        variant: 'success',
        message: t('admin.dashboard.advanced.aggregationSuccess', {
          records: toPersianDigits(result.data.writtenRecordsCount),
          views: toPersianDigits(result.data.processedViewEvents),
          downloads: toPersianDigits(result.data.processedDownloadEvents),
        }),
      });
      if (selectedPreset === 'custom') {
        runCustomJalaliFilter(customFromDate, customToDate);
      } else {
        await loadStats({ preset: selectedPreset });
      }
    } catch {
      setErrorMessage(t('admin.dashboard.error.generic'));
    } finally {
      setIsAggregating(false);
    }
  };

  const handleExportCsv = () => {
    if (!advancedAnalytics) {
      return;
    }
    const csvContent = buildAdvancedAnalyticsCsv(advancedAnalytics, {
      trendSectionTitle: t('admin.dashboard.csv.trendSectionTitle'),
      ageGroupSectionTitle: t('admin.dashboard.csv.ageGroupSectionTitle'),
      rootTopicSectionTitle: t('admin.dashboard.csv.rootTopicSectionTitle'),
      colDateJalali: t('admin.dashboard.csv.colDateJalali'),
      colDateKey: t('admin.dashboard.csv.colDateKey'),
      colAgeGroup: t('admin.dashboard.csv.colAgeGroup'),
      colRootTopic: t('admin.dashboard.csv.colRootTopic'),
      colViews: t('admin.dashboard.csv.colViews'),
      colViewsShare: t('admin.dashboard.csv.colViewsShare'),
      colDownloads: t('admin.dashboard.csv.colDownloads'),
      colDownloadsShare: t('admin.dashboard.csv.colDownloadsShare'),
      colTotalInteractions: t('admin.dashboard.csv.colTotalInteractions'),
    });

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = `meraj-andisheh-analytics-${getTodayJalaliFilenameSlug()}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(objectUrl);

    setActionFeedback({
      variant: 'info',
      message: t('admin.dashboard.advanced.csvExportSuccess'),
    });
  };

  const periodRows: readonly PeriodStatRow[] = useMemo(() => {
    if (!stats) {
      return [];
    }
    return periodTab === 'daily' ? stats.dailyStats : stats.weeklyStats;
  }, [stats, periodTab]);

  const maxPeriodActivity = useMemo(
    () =>
      periodRows.reduce((max, row) => {
        const total = row.countedViews + row.downloads;
        return total > max ? total : max;
      }, 0),
    [periodRows],
  );

  const isRangeEmpty =
    stats !== null &&
    stats.summary.totalCountedViews === 0 &&
    stats.summary.totalDownloads === 0;

  return (
    <AdminLayout currentRoute={currentRoute}>
      <div className="space-y-6">
        {/* Page Header + Filter Toolbar */}
        <section className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-card)] shadow-[var(--shadow-card)] p-4 sm:p-6 space-y-4">
          <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
            <div className="space-y-1 min-w-0">
              <div className="flex items-center gap-2">
                <BarChart3
                  className="w-5 h-5 text-[var(--color-primary)] shrink-0"
                  aria-hidden="true"
                />
                <h1 className="text-lg sm:text-xl font-bold text-[var(--color-text)]">
                  {t('admin.dashboard.title')}
                </h1>
              </div>
              <p className="text-xs sm:text-sm text-[var(--color-muted)] leading-relaxed">
                {t('admin.dashboard.subtitle')}
              </p>
              {stats ? (
                <p className="text-xs text-[var(--color-muted)] tabular-nums-strict pt-0.5">
                  {stats.fromIso && stats.toIso
                    ? t('admin.dashboard.activeWindowHint', {
                        from: formatJalaliIsoUtcPersian(stats.fromIso),
                        to: formatJalaliIsoUtcPersian(stats.toIso),
                      })
                    : t('admin.dashboard.activeWindowAllHint')}
                </p>
              ) : null}
              <p className="text-xs text-[var(--color-muted)] tabular-nums-strict">
                {advancedAnalytics?.lastAggregatedAt
                  ? t('admin.dashboard.advanced.lastAggregatedLabel', {
                      datetime: formatJalaliDateTimeLocalPersian(
                        advancedAnalytics.lastAggregatedAt,
                      ),
                    })
                  : t('admin.dashboard.advanced.lastAggregatedNever')}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2 shrink-0 self-start">
              <Button
                variant="outline"
                size="sm"
                onClick={handleExportCsv}
                disabled={isLoading || !advancedAnalytics}
                startIcon={<FileSpreadsheet className="w-3.5 h-3.5" />}
                className="whitespace-nowrap shrink-0"
              >
                {t('admin.dashboard.advanced.exportCsvButton')}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void handleRunManualAggregation()}
                disabled={isLoading || isAggregating}
                startIcon={<RefreshCw className="w-3.5 h-3.5" />}
                className="whitespace-nowrap shrink-0"
              >
                {isAggregating
                  ? t('admin.dashboard.advanced.runningAggregationButton')
                  : t('admin.dashboard.advanced.runAggregationButton')}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleRefresh}
                disabled={isLoading}
                startIcon={<RefreshCw className="w-3.5 h-3.5" />}
                className="whitespace-nowrap shrink-0"
              >
                {t('admin.dashboard.refreshButton')}
              </Button>
            </div>
          </div>

          {/* Preset Filter Bar */}
          <div className="pt-2 border-t border-[var(--color-border)] space-y-3">
            <div
              role="group"
              aria-label={t('admin.dashboard.filter.ariaLabel')}
              className="flex flex-wrap items-center gap-1.5 p-1 rounded-[var(--radius-control)] bg-[var(--color-surface-alt)] border border-[var(--color-border)] w-full sm:w-fit"
            >
              {RANGE_PRESETS.map((preset) => {
                const isActive = selectedPreset === preset;
                return (
                  <button
                    key={preset}
                    type="button"
                    aria-pressed={isActive}
                    onClick={() => handleSelectPreset(preset)}
                    className={`px-3 py-2 text-xs sm:text-sm font-medium rounded-[var(--radius-control)] whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                      isActive
                        ? 'bg-[var(--color-primary-button)] text-[var(--color-on-primary)] font-semibold'
                        : 'text-[var(--color-text)] hover:bg-[var(--color-surface)]'
                    }`}
                  >
                    {t(`admin.dashboard.filter.preset.${preset}` as ResourceKey)}
                  </button>
                );
              })}
            </div>

            {selectedPreset === 'custom' ? (
              <form
                onSubmit={handleCustomFilterSubmit}
                className="flex flex-col sm:flex-row sm:items-start gap-3 pt-1"
              >
                <div className="w-full sm:w-52 min-w-0">
                  <JalaliDatePicker
                    id="dashboard-from-date"
                    label={t('admin.dashboard.filter.fromLabel')}
                    value={customFromDate}
                    onChange={setCustomFromDate}
                    disabled={isLoading}
                  />
                </div>

                <div className="w-full sm:w-52 min-w-0">
                  <JalaliDatePicker
                    id="dashboard-to-date"
                    label={t('admin.dashboard.filter.toLabel')}
                    value={customToDate}
                    onChange={setCustomToDate}
                    disabled={isLoading}
                  />
                </div>

                <Button
                  type="submit"
                  variant="primary"
                  size="sm"
                  disabled={isLoading}
                  className="min-h-[42px] whitespace-nowrap shrink-0 self-start sm:mt-[26px]"
                >
                  {t('admin.dashboard.filter.applyButton')}
                </Button>
              </form>
            ) : null}

            {errorMessage ? <Alert variant="error" message={errorMessage} /> : null}
            {actionFeedback ? (
              <Alert variant={actionFeedback.variant} message={actionFeedback.message} />
            ) : null}
          </div>
        </section>

        {isLoading && !stats ? (
          <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-card)] p-8 text-center text-sm text-[var(--color-muted)]">
            {t('admin.dashboard.loading')}
          </div>
        ) : stats ? (
          <>
            {/* KPI Summary Row */}
            <section className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
              <article className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-card)] shadow-[var(--shadow-card)] p-4 sm:p-5 space-y-2">
                <div className="flex items-center justify-between gap-2 text-xs text-[var(--color-muted)]">
                  <span>{t('admin.dashboard.kpi.uniqueVisitorsLabel')}</span>
                  <Users className="w-4 h-4 text-[var(--color-primary)] shrink-0" aria-hidden="true" />
                </div>
                <p className="text-2xl sm:text-3xl font-bold text-[var(--color-text)] tabular-nums-strict">
                  {toPersianDigits(stats.summary.uniqueVisitors)}
                </p>
                <p className="text-[11px] sm:text-xs text-[var(--color-muted)] leading-relaxed">
                  {t('admin.dashboard.kpi.uniqueVisitorsDesc')}
                </p>
              </article>

              <article className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-card)] shadow-[var(--shadow-card)] p-4 sm:p-5 space-y-2">
                <div className="flex items-center justify-between gap-2 text-xs text-[var(--color-muted)]">
                  <span>{t('admin.dashboard.kpi.countedViewsLabel')}</span>
                  <Eye className="w-4 h-4 text-[var(--color-primary)] shrink-0" aria-hidden="true" />
                </div>
                <p className="text-2xl sm:text-3xl font-bold text-[var(--color-text)] tabular-nums-strict">
                  {toPersianDigits(stats.summary.totalCountedViews)}
                </p>
                <p className="text-[11px] sm:text-xs text-[var(--color-muted)] leading-relaxed tabular-nums-strict">
                  {t('admin.dashboard.kpi.countedViewsDesc', {
                    raw: toPersianDigits(stats.summary.totalRawViews),
                  })}
                </p>
              </article>

              <article className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-card)] shadow-[var(--shadow-card)] p-4 sm:p-5 space-y-2">
                <div className="flex items-center justify-between gap-2 text-xs text-[var(--color-muted)]">
                  <span>{t('admin.dashboard.kpi.avgViewsLabel')}</span>
                  <TrendingUp
                    className="w-4 h-4 text-[var(--color-primary)] shrink-0"
                    aria-hidden="true"
                  />
                </div>
                <p className="text-2xl sm:text-3xl font-bold text-[var(--color-text)] tabular-nums-strict">
                  {toPersianDigits(stats.summary.averageViewsPerVisitor.toFixed(1))}
                </p>
                <p className="text-[11px] sm:text-xs text-[var(--color-muted)] leading-relaxed">
                  {t('admin.dashboard.kpi.avgViewsDesc')}
                </p>
              </article>

              <article className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-card)] shadow-[var(--shadow-card)] p-4 sm:p-5 space-y-2">
                <div className="flex items-center justify-between gap-2 text-xs text-[var(--color-muted)]">
                  <span>{t('admin.dashboard.kpi.downloadsLabel')}</span>
                  <Download
                    className="w-4 h-4 text-[var(--color-primary)] shrink-0"
                    aria-hidden="true"
                  />
                </div>
                <p className="text-2xl sm:text-3xl font-bold text-[var(--color-text)] tabular-nums-strict">
                  {toPersianDigits(stats.summary.totalDownloads)}
                </p>
                <p className="text-[11px] sm:text-xs text-[var(--color-muted)] leading-relaxed tabular-nums-strict">
                  {t('admin.dashboard.kpi.downloadsDesc', {
                    unique: toPersianDigits(stats.summary.uniqueDownloaders),
                  })}
                </p>
              </article>
            </section>

            {/* Empty Range Friendly Banner */}
            {isRangeEmpty ? (
              <section className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-card)] p-6 text-center space-y-1.5">
                <h2 className="text-sm sm:text-base font-bold text-[var(--color-text)]">
                  {t('admin.dashboard.emptyRangeTitle')}
                </h2>
                <p className="text-xs sm:text-sm text-[var(--color-muted)]">
                  {t('admin.dashboard.emptyRangeBody')}
                </p>
              </section>
            ) : null}

            {/* Stage 27 Advanced Analytics Charts */}
            {advancedAnalytics ? (
              <div className="space-y-6">
                <DailyTrendChart
                  points={advancedAnalytics.trendSeries}
                  totalViews={advancedAnalytics.totalAggregatedViews}
                  totalDownloads={advancedAnalytics.totalAggregatedDownloads}
                />

                <section className="grid grid-cols-1 xl:grid-cols-2 gap-6 items-stretch">
                  <AgeGroupBreakdownChart items={advancedAnalytics.byAgeGroup} />
                  <RootTopicBreakdownChart items={advancedAnalytics.byRootTopic} />
                </section>
              </div>
            ) : null}

            {/* Two-Column Top Content Lists */}
            <section className="grid grid-cols-1 xl:grid-cols-2 gap-6 items-stretch">
              <RankedContentTable
                title={t('admin.dashboard.topViewed.title')}
                subtitle={t('admin.dashboard.topViewed.subtitle')}
                countHeader={t('admin.dashboard.topViewed.countHeader')}
                uniqueHeader={t('admin.dashboard.topViewed.uniqueHeader')}
                emptyMessage={t('admin.dashboard.topViewed.empty')}
                rows={stats.topViewedContents}
                barToneClass="bg-[var(--color-primary)]"
              />

              <RankedContentTable
                title={t('admin.dashboard.topDownloaded.title')}
                subtitle={t('admin.dashboard.topDownloaded.subtitle')}
                countHeader={t('admin.dashboard.topDownloaded.countHeader')}
                uniqueHeader={t('admin.dashboard.topDownloaded.uniqueHeader')}
                emptyMessage={t('admin.dashboard.topDownloaded.empty')}
                rows={stats.topDownloadedContents}
                barToneClass="bg-[var(--color-secondary)]"
              />
            </section>

            {/* Daily & Weekly Aggregation Table */}
            <section className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-card)] shadow-[var(--shadow-card)] p-4 sm:p-5 space-y-4">
              <header className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pb-3 border-b border-[var(--color-border)]">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <Calendar
                      className="w-4 h-4 text-[var(--color-primary)] shrink-0"
                      aria-hidden="true"
                    />
                    <h2 className="text-sm sm:text-base font-bold text-[var(--color-text)]">
                      {t('admin.dashboard.periods.title')}
                    </h2>
                  </div>
                  <p className="text-xs text-[var(--color-muted)]">
                    {t('admin.dashboard.periods.subtitle')}
                  </p>
                </div>

                <div
                  role="tablist"
                  aria-label={t('admin.dashboard.periods.tabsAria')}
                  className="inline-flex items-center gap-1 p-1 rounded-[var(--radius-control)] bg-[var(--color-surface-alt)] border border-[var(--color-border)] self-start"
                >
                  <button
                    type="button"
                    role="tab"
                    aria-selected={periodTab === 'daily'}
                    onClick={() => setPeriodTab('daily')}
                    className={`px-3 py-1.5 text-xs font-medium rounded-[var(--radius-control)] whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                      periodTab === 'daily'
                        ? 'bg-[var(--color-primary-button)] text-[var(--color-on-primary)] font-semibold'
                        : 'text-[var(--color-text)] hover:bg-[var(--color-surface)]'
                    }`}
                  >
                    {t('admin.dashboard.periods.tab.daily')}
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={periodTab === 'weekly'}
                    onClick={() => setPeriodTab('weekly')}
                    className={`px-3 py-1.5 text-xs font-medium rounded-[var(--radius-control)] whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                      periodTab === 'weekly'
                        ? 'bg-[var(--color-primary-button)] text-[var(--color-on-primary)] font-semibold'
                        : 'text-[var(--color-text)] hover:bg-[var(--color-surface)]'
                    }`}
                  >
                    {t('admin.dashboard.periods.tab.weekly')}
                  </button>
                </div>
              </header>

              {periodRows.length === 0 ? (
                <div className="py-8 text-center text-xs sm:text-sm text-[var(--color-muted)]">
                  {t('admin.dashboard.emptyRangeTitle')}
                </div>
              ) : (
                <div className="overflow-x-auto -mx-2 px-2">
                  <table className="w-full min-w-[520px] text-xs sm:text-sm border-collapse">
                    <thead>
                      <tr className="border-b border-[var(--color-border)] text-[var(--color-muted)] text-[11px] sm:text-xs">
                        <th scope="col" className="py-2 ps-1 pe-3 text-start font-medium">
                          {periodTab === 'daily'
                            ? t('admin.dashboard.periods.colDate')
                            : t('admin.dashboard.periods.colWeekRange')}
                        </th>
                        <th scope="col" className="py-2 px-3 text-end font-medium whitespace-nowrap">
                          {t('admin.dashboard.periods.colViews')}
                        </th>
                        <th scope="col" className="py-2 px-3 text-end font-medium whitespace-nowrap">
                          {t('admin.dashboard.periods.colUniqueVisitors')}
                        </th>
                        <th scope="col" className="py-2 px-3 text-end font-medium whitespace-nowrap">
                          {t('admin.dashboard.periods.colDownloads')}
                        </th>
                        <th
                          scope="col"
                          className="py-2 ps-3 pe-1 text-start font-medium w-36 whitespace-nowrap"
                        >
                          {t('admin.dashboard.periods.colActivity')}
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--color-border)]">
                      {periodRows.map((row) => {
                        const rowTotal = row.countedViews + row.downloads;
                        const activityWidth =
                          maxPeriodActivity > 0
                            ? Math.round((rowTotal / maxPeriodActivity) * 100)
                            : 0;
                        const dateDisplay =
                          periodTab === 'daily'
                            ? formatJalaliIsoUtcPersian(row.periodStartIso)
                            : t('admin.dashboard.periods.weekRangeValue', {
                                from: formatJalaliIsoUtcPersian(row.periodStartIso),
                                to: formatJalaliIsoUtcPersian(row.periodEndIso),
                              });
                        return (
                          <tr
                            key={row.periodKey}
                            className="hover:bg-[var(--color-surface-alt)] transition-colors"
                          >
                            <td className="py-2.5 ps-1 pe-3 font-medium text-[var(--color-text)] tabular-nums-strict whitespace-nowrap">
                              {dateDisplay}
                            </td>
                            <td className="py-2.5 px-3 text-end font-semibold text-[var(--color-text)] tabular-nums-strict">
                              {toPersianDigits(row.countedViews)}
                            </td>
                            <td className="py-2.5 px-3 text-end text-[var(--color-muted)] tabular-nums-strict">
                              {toPersianDigits(row.uniqueVisitors)}
                            </td>
                            <td className="py-2.5 px-3 text-end font-semibold text-[var(--color-text)] tabular-nums-strict">
                              {toPersianDigits(row.downloads)}
                            </td>
                            <td className="py-2.5 ps-3 pe-1">
                              <div
                                aria-hidden="true"
                                className="h-2 w-full rounded-full bg-[var(--color-surface-alt)] overflow-hidden"
                              >
                                <div
                                  className="h-full rounded-full bg-[var(--color-primary)]"
                                  style={{
                                    width: `${rowTotal > 0 ? Math.max(activityWidth, 4) : 0}%`,
                                  }}
                                />
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            {/* Bottom Event Columns Integrity Card */}
            <section className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-card)] shadow-[var(--shadow-card)] p-4 sm:p-5 space-y-4">
              <header className="space-y-1 pb-3 border-b border-[var(--color-border)]">
                <div className="flex items-center gap-2">
                  <ShieldCheck
                    className="w-4 h-4 text-[var(--color-success-text)] shrink-0"
                    aria-hidden="true"
                  />
                  <h2 className="text-sm sm:text-base font-bold text-[var(--color-text)]">
                    {t('admin.dashboard.integrity.title')}
                  </h2>
                </div>
                <p className="text-xs text-[var(--color-muted)] leading-relaxed">
                  {t('admin.dashboard.integrity.subtitle')}
                </p>
              </header>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {[
                  {
                    key: 'view-age',
                    label: t('admin.dashboard.integrity.viewAgeLabel'),
                    filled: stats.integrity.viewEventsWithAgeGroup,
                    total: stats.integrity.totalViewEvents,
                  },
                  {
                    key: 'view-topic',
                    label: t('admin.dashboard.integrity.viewTopicLabel'),
                    filled: stats.integrity.viewEventsWithPrimaryTopic,
                    total: stats.integrity.totalViewEvents,
                  },
                  {
                    key: 'download-age',
                    label: t('admin.dashboard.integrity.downloadAgeLabel'),
                    filled: stats.integrity.downloadEventsWithAgeGroup,
                    total: stats.integrity.totalDownloadEvents,
                  },
                ].map((metric) => {
                  const pct = computePercent(metric.filled, metric.total);
                  return (
                    <div key={metric.key} className="space-y-2">
                      <div className="flex items-center justify-between gap-2 text-xs">
                        <span className="font-medium text-[var(--color-text)]">
                          {metric.label}
                        </span>
                        <span className="font-semibold text-[var(--color-muted)] tabular-nums-strict whitespace-nowrap">
                          {metric.total > 0
                            ? t('admin.dashboard.integrity.ratioValue', {
                                filled: toPersianDigits(metric.filled),
                                total: toPersianDigits(metric.total),
                                percent: toPersianDigits(pct),
                              })
                            : t('admin.dashboard.integrity.noEventsPercent')}
                        </span>
                      </div>
                      <div
                        aria-hidden="true"
                        className="h-2 w-full rounded-full bg-[var(--color-surface-alt)] overflow-hidden"
                      >
                        <div
                          className="h-full rounded-full bg-[var(--color-success-text)]"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          </>
        ) : null}
      </div>
    </AdminLayout>
  );
}
