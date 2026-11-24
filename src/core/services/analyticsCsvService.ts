import type { AdvancedDashboardAnalytics } from '../domain/analytics';

export const UTF8_BOM = '\uFEFF';

export interface AnalyticsCsvLabels {
  trendSectionTitle: string;
  ageGroupSectionTitle: string;
  rootTopicSectionTitle: string;
  colDateJalali: string;
  colDateKey: string;
  colAgeGroup: string;
  colRootTopic: string;
  colViews: string;
  colViewsShare: string;
  colDownloads: string;
  colDownloadsShare: string;
  colTotalInteractions: string;
}

const FORMULA_INJECTION_PREFIX_REGEX = /^[=+\-@\t\r]/;

/**
 * Escapes a single CSV cell per RFC 4180 and neutralizes dangerous Excel formula prefixes
 * on non-numeric strings so exported reports stay safe in Windows/macOS Microsoft Excel.
 */
export function escapeCsvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? String(value) : '0';
  }

  let text = String(value);
  if (FORMULA_INJECTION_PREFIX_REGEX.test(text)) {
    text = `'${text}`;
  }

  const needsQuotes =
    text.includes(',') ||
    text.includes('"') ||
    text.includes('\n') ||
    text.includes('\r') ||
    text.trim() !== text;

  if (!needsQuotes) {
    return text;
  }

  return `"${text.replace(/"/g, '""')}"`;
}

function serializeCsvRow(cells: ReadonlyArray<string | number | null | undefined>): string {
  return cells.map((cell) => escapeCsvCell(cell)).join(',');
}

/**
 * Generates an Excel-compatible UTF-8 BOM CSV export containing Daily Trend,
 * Age Group Breakdown, and Root Topic Breakdown sections.
 */
export function buildAdvancedAnalyticsCsv(
  analytics: AdvancedDashboardAnalytics,
  labels: AnalyticsCsvLabels,
): string {
  const lines: string[] = [];

  // Section 1: Daily Trend
  lines.push(serializeCsvRow([labels.trendSectionTitle]));
  lines.push(
    serializeCsvRow([
      labels.colDateJalali,
      labels.colDateKey,
      labels.colViews,
      labels.colDownloads,
    ]),
  );
  for (const point of analytics.trendSeries) {
    lines.push(
      serializeCsvRow([
        point.jalaliLabel,
        point.dateKey,
        point.views,
        point.downloads,
      ]),
    );
  }

  lines.push('');

  // Section 2: Age Group Breakdown
  lines.push(serializeCsvRow([labels.ageGroupSectionTitle]));
  lines.push(
    serializeCsvRow([
      labels.colAgeGroup,
      labels.colViews,
      labels.colViewsShare,
      labels.colDownloads,
      labels.colDownloadsShare,
    ]),
  );
  for (const ageRow of analytics.byAgeGroup) {
    lines.push(
      serializeCsvRow([
        ageRow.ageGroupName,
        ageRow.views,
        ageRow.viewsSharePercent,
        ageRow.downloads,
        ageRow.downloadsSharePercent,
      ]),
    );
  }

  lines.push('');

  // Section 3: Root Topic Breakdown
  lines.push(serializeCsvRow([labels.rootTopicSectionTitle]));
  lines.push(
    serializeCsvRow([
      labels.colRootTopic,
      labels.colViews,
      labels.colDownloads,
      labels.colTotalInteractions,
    ]),
  );
  for (const topicRow of analytics.byRootTopic) {
    lines.push(
      serializeCsvRow([
        topicRow.rootTopicName,
        topicRow.views,
        topicRow.downloads,
        topicRow.totalInteractions,
      ]),
    );
  }

  return `${UTF8_BOM}${lines.join('\r\n')}\r\n`;
}
