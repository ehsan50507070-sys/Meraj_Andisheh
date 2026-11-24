import { FolderTree } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { RootTopicStatBreakdown } from '../../../core/domain/analytics';
import { toPersianDigits } from '../../resources/formatters';
import { t } from '../../resources/i18n';

export interface RootTopicBreakdownChartProps {
  items: readonly RootTopicStatBreakdown[];
}

const CHART_WIDTH = 560;
const ROW_HEIGHT = 44;
const PAD_TOP = 10;
const PAD_BOTTOM = 16;
const PAD_LEFT = 140;
const PAD_RIGHT = 64;

export function RootTopicBreakdownChart({ items }: RootTopicBreakdownChartProps) {
  const [activeTopicId, setActiveTopicId] = useState<number | null>(null);

  const displayItems = useMemo(() => items.slice(0, 10), [items]);
  const chartHeight = PAD_TOP + displayItems.length * ROW_HEIGHT + PAD_BOTTOM;
  const plotWidth = CHART_WIDTH - PAD_LEFT - PAD_RIGHT;

  const maxTotal = useMemo(
    () =>
      displayItems.reduce(
        (max, item) => Math.max(max, item.totalInteractions),
        0,
      ),
    [displayItems],
  );

  const activeItem =
    displayItems.find((row) => row.rootTopicId === activeTopicId) ??
    displayItems[0] ??
    null;

  return (
    <section className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-card)] shadow-[var(--shadow-card)] p-4 sm:p-5 space-y-4 min-w-0 flex flex-col">
      <header className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2 pb-3 border-b border-[var(--color-border)]">
        <div className="space-y-1 min-w-0">
          <div className="flex items-center gap-2">
            <FolderTree
              className="w-4 h-4 text-[var(--color-primary)] shrink-0"
              aria-hidden="true"
            />
            <h2 className="text-sm sm:text-base font-bold text-[var(--color-text)]">
              {t('admin.dashboard.charts.rootTopic.title')}
            </h2>
          </div>
          <p className="text-xs text-[var(--color-muted)] leading-relaxed">
            {t('admin.dashboard.charts.rootTopic.subtitle')}
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

      {displayItems.length === 0 ? (
        <div className="py-8 text-center text-xs sm:text-sm text-[var(--color-muted)]">
          {t('admin.dashboard.charts.rootTopic.empty')}
        </div>
      ) : (
        <div className="space-y-4">
          {activeItem ? (
            <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 rounded-[var(--radius-control)] bg-[var(--color-surface-alt)] border border-[var(--color-border)] text-xs">
              <span className="font-semibold text-[var(--color-text)]">
                {activeItem.rootTopicName}
              </span>
              <span className="font-semibold text-[var(--color-primary)] tabular-nums-strict">
                {t('admin.dashboard.charts.countSummary', {
                  views: toPersianDigits(activeItem.views),
                  downloads: toPersianDigits(activeItem.downloads),
                })}
              </span>
            </div>
          ) : null}

          <div className="w-full overflow-hidden" dir="ltr">
            <svg
              viewBox={`0 0 ${CHART_WIDTH} ${chartHeight}`}
              className="w-full h-auto block select-none"
              role="img"
              aria-label={t('admin.dashboard.charts.rootTopic.ariaLabel')}
            >
              {displayItems.map((row, idx) => {
                const y = PAD_TOP + idx * ROW_HEIGHT;
                const safeMax = Math.max(1, maxTotal);
                const viewsW = (row.views / safeMax) * plotWidth;
                const downloadsW = (row.downloads / safeMax) * plotWidth;
                const totalW = viewsW + downloadsW;
                const isSelected = activeItem?.rootTopicId === row.rootTopicId;
                const truncatedName =
                  row.rootTopicName.length > 18
                    ? `${row.rootTopicName.slice(0, 16)}…`
                    : row.rootTopicName;

                return (
                  <g key={row.rootTopicId}>
                    {isSelected ? (
                      <rect
                        x={4}
                        y={y + 2}
                        width={CHART_WIDTH - 8}
                        height={ROW_HEIGHT - 4}
                        rx={6}
                        fill="var(--color-surface-alt)"
                      />
                    ) : null}

                    {/* Track */}
                    <rect
                      x={PAD_LEFT}
                      y={y + 13}
                      width={plotWidth}
                      height={16}
                      rx={4}
                      fill="var(--color-surface-alt)"
                    />

                    {/* Stacked Views + Downloads */}
                    {row.views > 0 ? (
                      <rect
                        x={PAD_LEFT}
                        y={y + 13}
                        width={Math.max(4, viewsW)}
                        height={16}
                        rx={row.downloads > 0 ? 0 : 4}
                        fill="var(--color-primary)"
                      />
                    ) : null}
                    {row.downloads > 0 ? (
                      <rect
                        x={PAD_LEFT + (row.views > 0 ? Math.max(4, viewsW) : 0)}
                        y={y + 13}
                        width={Math.max(4, downloadsW)}
                        height={16}
                        rx={row.views > 0 ? 0 : 4}
                        fill="var(--color-secondary)"
                      />
                    ) : null}

                    <text
                      x={PAD_LEFT - 10}
                      y={y + 25}
                      textAnchor="end"
                      fill="var(--color-text)"
                      fontSize="11.5"
                      fontFamily="inherit"
                    >
                      {truncatedName}
                    </text>

                    <text
                      x={PAD_LEFT + Math.min(plotWidth, Math.max(totalW, 8)) + 8}
                      y={y + 25}
                      textAnchor="start"
                      fill="var(--color-muted)"
                      fontSize="11.5"
                      fontFamily="inherit"
                    >
                      {toPersianDigits(row.totalInteractions)}
                    </text>

                    <rect
                      x={0}
                      y={y}
                      width={CHART_WIDTH}
                      height={ROW_HEIGHT}
                      fill="transparent"
                      tabIndex={0}
                      role="button"
                      aria-label={`${row.rootTopicName} - ${t('admin.dashboard.charts.countSummary', {
                        views: toPersianDigits(row.views),
                        downloads: toPersianDigits(row.downloads),
                      })}`}
                      onMouseEnter={() => setActiveTopicId(row.rootTopicId)}
                      onFocus={() => setActiveTopicId(row.rootTopicId)}
                      onClick={() => setActiveTopicId(row.rootTopicId)}
                      className="cursor-pointer outline-none"
                    />
                  </g>
                );
              })}
            </svg>
          </div>
        </div>
      )}
    </section>
  );
}
