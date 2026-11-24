import { TrendingUp } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { DailyTrendChartPoint } from '../../../core/domain/analytics';
import { toPersianDigits } from '../../resources/formatters';
import { t } from '../../resources/i18n';

export interface DailyTrendChartProps {
  points: readonly DailyTrendChartPoint[];
  totalViews: number;
  totalDownloads: number;
}

const CHART_WIDTH = 720;
const CHART_HEIGHT = 270;
const PAD_LEFT = 48;
const PAD_RIGHT = 24;
const PAD_TOP = 24;
const PAD_BOTTOM = 44;

function computeNiceMax(value: number): number {
  if (value <= 0) {
    return 4;
  }
  const rawStep = value / 4;
  const magnitude = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const fraction = rawStep / magnitude;
  let niceFraction = 1;
  if (fraction <= 1) niceFraction = 1;
  else if (fraction <= 2) niceFraction = 2;
  else if (fraction <= 5) niceFraction = 5;
  else niceFraction = 10;
  return niceFraction * magnitude * 4;
}

export function DailyTrendChart({
  points,
  totalViews,
  totalDownloads,
}: DailyTrendChartProps) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);

  const plotWidth = CHART_WIDTH - PAD_LEFT - PAD_RIGHT;
  const plotHeight = CHART_HEIGHT - PAD_TOP - PAD_BOTTOM;

  const { maxY, yTicks, coords, viewsLinePath, viewsAreaPath, downloadsLinePath, downloadsAreaPath } =
    useMemo(() => {
      const peak = points.reduce(
        (acc, p) => Math.max(acc, p.views, p.downloads),
        0,
      );
      const niceMax = computeNiceMax(peak);
      const ticks = [0, 0.25, 0.5, 0.75, 1].map((ratio) => ({
        value: Math.round(niceMax * ratio),
        y: PAD_TOP + plotHeight - ratio * plotHeight,
      }));

      const count = points.length;
      const computedCoords = points.map((pt, idx) => {
        const x =
          count === 1
            ? PAD_LEFT + plotWidth / 2
            : PAD_LEFT + (idx / Math.max(1, count - 1)) * plotWidth;
        const yViews = PAD_TOP + plotHeight - (pt.views / niceMax) * plotHeight;
        const yDownloads = PAD_TOP + plotHeight - (pt.downloads / niceMax) * plotHeight;
        return { x, yViews, yDownloads, point: pt };
      });

      const buildLine = (key: 'yViews' | 'yDownloads'): string => {
        if (computedCoords.length === 0) return '';
        return computedCoords
          .map((c, idx) => `${idx === 0 ? 'M' : 'L'} ${c.x.toFixed(1)} ${c[key].toFixed(1)}`)
          .join(' ');
      };

      const buildArea = (key: 'yViews' | 'yDownloads'): string => {
        if (computedCoords.length < 2) return '';
        const baseY = PAD_TOP + plotHeight;
        const line = buildLine(key);
        const last = computedCoords[computedCoords.length - 1];
        const first = computedCoords[0];
        return `${line} L ${last.x.toFixed(1)} ${baseY.toFixed(1)} L ${first.x.toFixed(1)} ${baseY.toFixed(1)} Z`;
      };

      return {
        maxY: niceMax,
        yTicks: ticks,
        coords: computedCoords,
        viewsLinePath: buildLine('yViews'),
        viewsAreaPath: buildArea('yViews'),
        downloadsLinePath: buildLine('yDownloads'),
        downloadsAreaPath: buildArea('yDownloads'),
      };
    }, [points, plotHeight, plotWidth]);

  const xLabelIndices = useMemo(() => {
    if (points.length === 0) return new Set<number>();
    if (points.length <= 6) {
      return new Set(points.map((_, idx) => idx));
    }
    const maxLabels = 6;
    const step = Math.ceil((points.length - 1) / (maxLabels - 1));
    const set = new Set<number>([0, points.length - 1]);
    for (let i = step; i < points.length - 1; i += step) {
      set.add(i);
    }
    return set;
  }, [points]);

  const activePoint =
    activeIndex !== null && activeIndex >= 0 && activeIndex < coords.length
      ? coords[activeIndex]
      : coords.length > 0
        ? coords[coords.length - 1]
        : null;

  return (
    <section className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-card)] shadow-[var(--shadow-card)] p-4 sm:p-5 space-y-4 min-w-0">
      <header className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 pb-3 border-b border-[var(--color-border)]">
        <div className="space-y-1 min-w-0">
          <div className="flex items-center gap-2">
            <TrendingUp
              className="w-4 h-4 text-[var(--color-primary)] shrink-0"
              aria-hidden="true"
            />
            <h2 className="text-sm sm:text-base font-bold text-[var(--color-text)]">
              {t('admin.dashboard.charts.trend.title')}
            </h2>
          </div>
          <p className="text-xs text-[var(--color-muted)] leading-relaxed">
            {t('admin.dashboard.charts.trend.subtitle')}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3 text-xs shrink-0">
          <span className="inline-flex items-center gap-1.5 text-[var(--color-text)] font-medium">
            <span
              className="w-2.5 h-2.5 rounded-full bg-[var(--color-primary)] shrink-0"
              aria-hidden="true"
            />
            {t('admin.dashboard.charts.viewsLegend')}
          </span>
          <span className="inline-flex items-center gap-1.5 text-[var(--color-text)] font-medium">
            <span
              className="w-2.5 h-2.5 rounded-full bg-[var(--color-secondary)] shrink-0"
              aria-hidden="true"
            />
            {t('admin.dashboard.charts.downloadsLegend')}
          </span>
          <span className="px-2 py-0.5 rounded-[var(--radius-control)] bg-[var(--color-surface-alt)] border border-[var(--color-border)] text-[11px] font-semibold text-[var(--color-muted)] tabular-nums-strict whitespace-nowrap">
            {t('admin.dashboard.charts.trend.totalBadge', {
              views: toPersianDigits(totalViews),
              downloads: toPersianDigits(totalDownloads),
            })}
          </span>
        </div>
      </header>

      {points.length === 0 ? (
        <div className="py-10 text-center text-xs sm:text-sm text-[var(--color-muted)]">
          {t('admin.dashboard.charts.trend.empty')}
        </div>
      ) : (
        <div className="space-y-3">
          {/* Interactive Tooltip Readout Strip */}
          {activePoint ? (
            <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 rounded-[var(--radius-control)] bg-[var(--color-surface-alt)] border border-[var(--color-border)] text-xs">
              <span className="font-semibold text-[var(--color-text)] tabular-nums-strict">
                {activePoint.point.jalaliLabel}
              </span>
              <span className="font-semibold text-[var(--color-primary)] tabular-nums-strict">
                {t('admin.dashboard.charts.countSummary', {
                  views: toPersianDigits(activePoint.point.views),
                  downloads: toPersianDigits(activePoint.point.downloads),
                })}
              </span>
            </div>
          ) : null}

          <div className="w-full overflow-hidden" dir="ltr">
            <svg
              viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
              className="w-full h-auto block select-none"
              role="img"
              aria-label={t('admin.dashboard.charts.trend.ariaLabel')}
            >
              {/* Horizontal Gridlines & Y-Axis Ticks */}
              {yTicks.map((tick) => (
                <g key={tick.value}>
                  <line
                    x1={PAD_LEFT}
                    y1={tick.y}
                    x2={CHART_WIDTH - PAD_RIGHT}
                    y2={tick.y}
                    stroke="var(--color-border)"
                    strokeWidth={1}
                    strokeDasharray={tick.value === 0 ? undefined : '4 4'}
                  />
                  <text
                    x={PAD_LEFT - 8}
                    y={tick.y + 4}
                    textAnchor="end"
                    fill="var(--color-muted)"
                    fontSize="11"
                    fontFamily="inherit"
                  >
                    {toPersianDigits(tick.value)}
                  </text>
                </g>
              ))}

              {/* Subtle Area Fills */}
              {viewsAreaPath ? (
                <path
                  d={viewsAreaPath}
                  fill="var(--color-primary)"
                  fillOpacity={0.12}
                />
              ) : null}
              {downloadsAreaPath ? (
                <path
                  d={downloadsAreaPath}
                  fill="var(--color-secondary)"
                  fillOpacity={0.12}
                />
              ) : null}

              {/* Trend Lines */}
              {viewsLinePath ? (
                <path
                  d={viewsLinePath}
                  fill="none"
                  stroke="var(--color-primary)"
                  strokeWidth={2.5}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              ) : null}
              {downloadsLinePath ? (
                <path
                  d={downloadsLinePath}
                  fill="none"
                  stroke="var(--color-secondary)"
                  strokeWidth={2.5}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              ) : null}

              {/* Active Vertical Guide */}
              {activePoint ? (
                <line
                  x1={activePoint.x}
                  y1={PAD_TOP}
                  x2={activePoint.x}
                  y2={PAD_TOP + plotHeight}
                  stroke="var(--color-primary)"
                  strokeOpacity={0.35}
                  strokeWidth={1.5}
                />
              ) : null}

              {/* Data Points + Hit Targets */}
              {coords.map((c, idx) => {
                const isSelected = activePoint?.point.dateKey === c.point.dateKey;
                const hitWidth =
                  coords.length > 1 ? plotWidth / coords.length : plotWidth;
                return (
                  <g key={`${c.point.dateKey}-${maxY}`}>
                    <circle
                      cx={c.x}
                      cy={c.yViews}
                      r={isSelected ? 5 : 3.5}
                      fill="var(--color-primary)"
                      stroke="var(--color-surface)"
                      strokeWidth={1.5}
                    />
                    <circle
                      cx={c.x}
                      cy={c.yDownloads}
                      r={isSelected ? 5 : 3.5}
                      fill="var(--color-secondary)"
                      stroke="var(--color-surface)"
                      strokeWidth={1.5}
                    />

                    {xLabelIndices.has(idx) ? (
                      <text
                        x={c.x}
                        y={CHART_HEIGHT - 14}
                        textAnchor="middle"
                        fill="var(--color-muted)"
                        fontSize="11"
                        fontFamily="inherit"
                      >
                        {c.point.jalaliLabel}
                      </text>
                    ) : null}

                    <rect
                      x={c.x - hitWidth / 2}
                      y={PAD_TOP}
                      width={Math.max(16, hitWidth)}
                      height={plotHeight + 12}
                      fill="transparent"
                      tabIndex={0}
                      role="button"
                      aria-label={`${c.point.jalaliLabel} - ${t('admin.dashboard.charts.countSummary', {
                        views: toPersianDigits(c.point.views),
                        downloads: toPersianDigits(c.point.downloads),
                      })}`}
                      onMouseEnter={() => setActiveIndex(idx)}
                      onFocus={() => setActiveIndex(idx)}
                      onClick={() => setActiveIndex(idx)}
                      className="cursor-pointer outline-none"
                    />
                  </g>
                );
              })}
            </svg>
          </div>

          <p className="text-[11px] text-[var(--color-muted)]">
            {t('admin.dashboard.charts.tooltipHint')}
          </p>
        </div>
      )}
    </section>
  );
}
