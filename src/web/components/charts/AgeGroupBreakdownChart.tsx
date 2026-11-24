import { Users } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { AgeGroupStatBreakdown } from '../../../core/domain/analytics';
import { Alert } from '../ui';
import { toPersianDigits } from '../../resources/formatters';
import { t } from '../../resources/i18n';

export interface AgeGroupBreakdownChartProps {
  items: readonly AgeGroupStatBreakdown[];
}

const CHART_WIDTH = 560;
const CHART_HEIGHT = 240;
const PAD_LEFT = 46;
const PAD_RIGHT = 18;
const PAD_TOP = 20;
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

export function AgeGroupBreakdownChart({ items }: AgeGroupBreakdownChartProps) {
  const [hoveredAgeId, setHoveredAgeId] = useState<number | null>(null);

  const hasAnyEvents = useMemo(
    () => items.some((row) => row.views > 0 || row.downloads > 0),
    [items],
  );

  const plotWidth = CHART_WIDTH - PAD_LEFT - PAD_RIGHT;
  const plotHeight = CHART_HEIGHT - PAD_TOP - PAD_BOTTOM;

  const { maxY, yTicks, bars } = useMemo(() => {
    const peak = items.reduce((acc, row) => Math.max(acc, row.views, row.downloads), 0);
    const niceMax = computeNiceMax(peak);
    const ticks = [0, 0.25, 0.5, 0.75, 1].map((ratio) => ({
      value: Math.round(niceMax * ratio),
      y: PAD_TOP + plotHeight - ratio * plotHeight,
    }));

    const groupCount = Math.max(1, items.length);
    const slotWidth = plotWidth / groupCount;
    const singleBarWidth = Math.max(10, Math.min(24, slotWidth * 0.28));
    const barGap = 4;

    const computedBars = items.map((row, idx) => {
      const centerX = PAD_LEFT + idx * slotWidth + slotWidth / 2;
      const viewsHeight = (row.views / niceMax) * plotHeight;
      const downloadsHeight = (row.downloads / niceMax) * plotHeight;
      return {
        row,
        centerX,
        slotWidth,
        singleBarWidth,
        viewsX: centerX - singleBarWidth - barGap / 2,
        viewsY: PAD_TOP + plotHeight - viewsHeight,
        viewsHeight,
        downloadsX: centerX + barGap / 2,
        downloadsY: PAD_TOP + plotHeight - downloadsHeight,
        downloadsHeight,
      };
    });

    return { maxY: niceMax, yTicks: ticks, bars: computedBars };
  }, [items, plotHeight, plotWidth]);

  const activeRow =
    items.find((row) => row.ageGroupId === hoveredAgeId) ??
    items.find((row) => row.views > 0 || row.downloads > 0) ??
    items[0] ??
    null;

  return (
    <section className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-card)] shadow-[var(--shadow-card)] p-4 sm:p-5 space-y-4 min-w-0 flex flex-col">
      <header className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2 pb-3 border-b border-[var(--color-border)]">
        <div className="space-y-1 min-w-0">
          <div className="flex items-center gap-2">
            <Users
              className="w-4 h-4 text-[var(--color-primary)] shrink-0"
              aria-hidden="true"
            />
            <h2 className="text-sm sm:text-base font-bold text-[var(--color-text)]">
              {t('admin.dashboard.charts.ageGroup.title')}
            </h2>
          </div>
          <p className="text-xs text-[var(--color-muted)] leading-relaxed">
            {t('admin.dashboard.charts.ageGroup.subtitle')}
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
        </div>
      </header>

      <Alert
        variant="info"
        message={t('admin.dashboard.advanced.ageTransparencyNote')}
      />

      {!hasAnyEvents ? (
        <div className="py-8 text-center text-xs sm:text-sm text-[var(--color-muted)]">
          {t('admin.dashboard.charts.ageGroup.empty')}
        </div>
      ) : (
        <div className="space-y-4">
          {activeRow ? (
            <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 rounded-[var(--radius-control)] bg-[var(--color-surface-alt)] border border-[var(--color-border)] text-xs">
              <span className="font-semibold text-[var(--color-text)]">
                {activeRow.ageGroupName}
              </span>
              <span className="font-semibold text-[var(--color-primary)] tabular-nums-strict">
                {t('admin.dashboard.charts.countSummary', {
                  views: toPersianDigits(activeRow.views),
                  downloads: toPersianDigits(activeRow.downloads),
                })}
              </span>
            </div>
          ) : null}

          <div className="w-full overflow-hidden" dir="ltr">
            <svg
              viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
              className="w-full h-auto block select-none"
              role="img"
              aria-label={t('admin.dashboard.charts.ageGroup.ariaLabel')}
            >
              {yTicks.map((tick) => (
                <g key={`${tick.value}-${maxY}`}>
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

              {bars.map((bar) => {
                const isSelected = activeRow?.ageGroupId === bar.row.ageGroupId;
                return (
                  <g key={bar.row.ageGroupId}>
                    {isSelected ? (
                      <rect
                        x={bar.centerX - bar.slotWidth * 0.42}
                        y={PAD_TOP}
                        width={bar.slotWidth * 0.84}
                        height={plotHeight}
                        rx={6}
                        fill="var(--color-surface-alt)"
                      />
                    ) : null}

                    <rect
                      x={bar.viewsX}
                      y={bar.viewsY}
                      width={bar.singleBarWidth}
                      height={Math.max(bar.row.views > 0 ? 3 : 0, bar.viewsHeight)}
                      rx={3}
                      fill="var(--color-primary)"
                    />
                    <rect
                      x={bar.downloadsX}
                      y={bar.downloadsY}
                      width={bar.singleBarWidth}
                      height={Math.max(bar.row.downloads > 0 ? 3 : 0, bar.downloadsHeight)}
                      rx={3}
                      fill="var(--color-secondary)"
                    />

                    <text
                      x={bar.centerX}
                      y={CHART_HEIGHT - 14}
                      textAnchor="middle"
                      fill="var(--color-text)"
                      fontSize="11"
                      fontFamily="inherit"
                    >
                      {bar.row.ageGroupName.length > 14
                        ? `${bar.row.ageGroupName.slice(0, 12)}…`
                        : bar.row.ageGroupName}
                    </text>

                    <rect
                      x={bar.centerX - bar.slotWidth / 2}
                      y={PAD_TOP}
                      width={bar.slotWidth}
                      height={plotHeight + 24}
                      fill="transparent"
                      tabIndex={0}
                      role="button"
                      aria-label={`${bar.row.ageGroupName} - ${t('admin.dashboard.charts.countSummary', {
                        views: toPersianDigits(bar.row.views),
                        downloads: toPersianDigits(bar.row.downloads),
                      })}`}
                      onMouseEnter={() => setHoveredAgeId(bar.row.ageGroupId)}
                      onFocus={() => setHoveredAgeId(bar.row.ageGroupId)}
                      onClick={() => setHoveredAgeId(bar.row.ageGroupId)}
                      className="cursor-pointer outline-none"
                    />
                  </g>
                );
              })}
            </svg>
          </div>

          <ul className="divide-y divide-[var(--color-border)] border-t border-[var(--color-border)] pt-2">
            {items.map((row) => (
              <li
                key={row.ageGroupId}
                className="py-2 flex flex-wrap items-center justify-between gap-2 text-xs"
              >
                <span className="font-semibold text-[var(--color-text)]">
                  {row.ageGroupName}
                </span>
                <div className="flex flex-wrap items-center gap-3 text-[var(--color-muted)] tabular-nums-strict">
                  <span>
                    {t('admin.dashboard.charts.ageGroup.viewsShareLabel', {
                      percent: toPersianDigits(row.viewsSharePercent),
                    })}
                  </span>
                  <span>
                    {t('admin.dashboard.charts.ageGroup.downloadsShareLabel', {
                      percent: toPersianDigits(row.downloadsSharePercent),
                    })}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
