import { CONTENT_FORMATS, type ContentFormat } from '../../core/domain/content';
import type { CatalogSortOption } from '../../core/services/contentCatalogService';
import { normalizeDigits } from '../../core/services/identifierService';

export interface CatalogFilterState {
  query: string;
  topicIds: number[];
  tagIds: number[];
  personIds: number[];
  formats: ContentFormat[];
  impactLevelIds: number[];
  filterAgeGroupIds: number[];
  sort: CatalogSortOption;
  page: number;
}

export const EMPTY_CATALOG_FILTER_STATE: CatalogFilterState = {
  query: '',
  topicIds: [],
  tagIds: [],
  personIds: [],
  formats: [],
  impactLevelIds: [],
  filterAgeGroupIds: [],
  sort: 'latest',
  page: 1,
};

function parsePositiveIntList(raw: string | null): number[] {
  if (!raw) {
    return [];
  }
  const normalized = normalizeDigits(raw);
  const parts = normalized.split(',');
  const out: number[] = [];
  const seen = new Set<number>();
  for (const part of parts) {
    const trimmed = part.trim();
    if (!/^\d+$/.test(trimmed)) {
      continue;
    }
    const val = Number.parseInt(trimmed, 10);
    if (Number.isInteger(val) && val > 0 && !seen.has(val)) {
      seen.add(val);
      out.push(val);
    }
  }
  return out;
}

function parseFormatList(raw: string | null): ContentFormat[] {
  if (!raw) {
    return [];
  }
  const formatLookup = new Map<string, ContentFormat>(
    CONTENT_FORMATS.map((fmt) => [fmt.toLowerCase(), fmt]),
  );
  const parts = raw.split(',');
  const out: ContentFormat[] = [];
  const seen = new Set<ContentFormat>();
  for (const part of parts) {
    const matched = formatLookup.get(part.trim().toLowerCase());
    if (matched && !seen.has(matched)) {
      seen.add(matched);
      out.push(matched);
    }
  }
  return out;
}

function parseSortOption(raw: string | null): CatalogSortOption {
  if (raw === 'most_viewed' || raw === 'most_liked' || raw === 'latest') {
    return raw;
  }
  return 'latest';
}

function parsePageNumber(raw: string | null): number {
  if (!raw) {
    return 1;
  }
  const normalized = normalizeDigits(raw).trim();
  if (!/^\d+$/.test(normalized)) {
    return 1;
  }
  const val = Number.parseInt(normalized, 10);
  return Number.isInteger(val) && val >= 1 ? val : 1;
}

export function parseCatalogHashState(rawHash: string): CatalogFilterState {
  const qIndex = rawHash.indexOf('?');
  if (qIndex === -1) {
    return { ...EMPTY_CATALOG_FILTER_STATE };
  }

  const params = new URLSearchParams(rawHash.slice(qIndex + 1));

  return {
    query: (params.get('q') ?? '').trim(),
    topicIds: parsePositiveIntList(params.get('topics')),
    tagIds: parsePositiveIntList(params.get('tags')),
    personIds: parsePositiveIntList(params.get('persons')),
    formats: parseFormatList(params.get('formats')),
    impactLevelIds: parsePositiveIntList(params.get('impacts')),
    filterAgeGroupIds: parsePositiveIntList(params.get('ages')),
    sort: parseSortOption(params.get('sort')),
    page: parsePageNumber(params.get('page')),
  };
}

export function buildCatalogHash(
  basePath: '/content' | '/search',
  state: CatalogFilterState,
): string {
  const params = new URLSearchParams();
  const trimmedQuery = state.query.trim();

  if (trimmedQuery) {
    params.set('q', trimmedQuery);
  }
  if (state.topicIds.length > 0) {
    params.set('topics', state.topicIds.join(','));
  }
  if (state.formats.length > 0) {
    params.set('formats', state.formats.join(','));
  }
  if (state.tagIds.length > 0) {
    params.set('tags', state.tagIds.join(','));
  }
  if (state.personIds.length > 0) {
    params.set('persons', state.personIds.join(','));
  }
  if (state.impactLevelIds.length > 0) {
    params.set('impacts', state.impactLevelIds.join(','));
  }
  if (state.filterAgeGroupIds.length > 0) {
    params.set('ages', state.filterAgeGroupIds.join(','));
  }
  if (state.sort !== 'latest') {
    params.set('sort', state.sort);
  }
  if (state.page > 1) {
    params.set('page', String(state.page));
  }

  const queryString = params.toString();
  return queryString ? `#${basePath}?${queryString}` : `#${basePath}`;
}
