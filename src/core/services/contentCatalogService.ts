import type { IAdminRepository } from '../abstractions/adminRepository';
import type { IContentRepository } from '../abstractions/contentRepository';
import type { ISearchNormalizer } from '../abstractions/searchNormalizer';
import type { ITaxonomyRepository } from '../abstractions/taxonomyRepository';
import {
  CONTENT_FORMATS,
  ContentStatus,
  type ContentAgeGroup,
  type ContentFormat,
  type ContentItem,
  type ContentPerson,
  type ContentTag,
  type ContentTopic,
} from '../domain/content';
import type {
  AgeGroup,
  ImpactLevel,
  Person,
  Tag,
  Topic,
} from '../domain/taxonomy';
import {
  applyAgeGroupRulesWithMeta,
  isContentAllowedForAgeGroup,
  type AgePriorityGroup,
} from './ageRuleService';
import { normalizeDigits } from './identifierService';
import { defaultSearchNormalizer } from './searchNormalizer';

export type CatalogSortOption = 'latest' | 'most_viewed' | 'most_liked';

export const DEFAULT_CATALOG_PAGE_SIZE = 12;

export interface CatalogDataset {
  items: readonly ContentItem[];
  topics: readonly Topic[];
  tags: readonly Tag[];
  persons: readonly Person[];
  impactLevels: readonly ImpactLevel[];
  ageGroups: readonly AgeGroup[];
  contentTopics: readonly ContentTopic[];
  contentTags: readonly ContentTag[];
  contentPersons: readonly ContentPerson[];
  contentAgeGroups: readonly ContentAgeGroup[];
}

export interface PublicCatalogQuery {
  query?: string;
  topicIds?: readonly number[];
  tagIds?: readonly number[];
  personIds?: readonly number[];
  formats?: readonly ContentFormat[];
  impactLevelIds?: readonly number[];
  filterAgeGroupIds?: readonly number[];
  sort?: CatalogSortOption;
  page?: number;
  pageSize?: number;
  activeAgeGroup: AgeGroup | null;
}

export interface CatalogContentCardItem {
  item: ContentItem;
  topicIds: number[];
  tagIds: number[];
  personIds: number[];
  ageGroupIds: number[];
  primaryTopicName: string | null;
  priorityGroup: AgePriorityGroup;
}

export interface CatalogFacetsCounts {
  topics: Record<number, number>;
  tags: Record<number, number>;
  persons: Record<number, number>;
  formats: Record<ContentFormat, number>;
  impactLevels: Record<number, number>;
  ageGroups: Record<number, number>;
}

export interface PublicCatalogResult {
  items: CatalogContentCardItem[];
  totalCount: number;
  page: number;
  pageSize: number;
  totalPages: number;
  facetsCounts: CatalogFacetsCounts;
  expandedTopicIds: number[];
}

function parseTimestampMs(iso: string | null | undefined): number {
  if (!iso) {
    return 0;
  }
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? 0 : ms;
}

function buildLinkMap(links: ReadonlyArray<{ contentId: number }>, readTargetId: (link: never) => number): Map<number, number[]> {
  const map = new Map<number, number[]>();
  for (const link of links) {
    const targetId = readTargetId(link as never);
    const list = map.get(link.contentId);
    if (list) {
      list.push(targetId);
    } else {
      map.set(link.contentId, [targetId]);
    }
  }
  return map;
}

function createEmptyFormatsRecord(): Record<ContentFormat, number> {
  const rec = {} as Record<ContentFormat, number>;
  for (const format of CONTENT_FORMATS) {
    rec[format] = 0;
  }
  return rec;
}

function computePriorityGroup(
  itemAgeGroupIds: readonly number[],
  activeAgeGroup: AgeGroup | null,
): AgePriorityGroup {
  if (!activeAgeGroup) {
    return itemAgeGroupIds.length === 0 ? 2 : 3;
  }
  if (itemAgeGroupIds.includes(activeAgeGroup.id)) {
    return 1;
  }
  if (itemAgeGroupIds.length === 0) {
    return 2;
  }
  return 3;
}

/**
 * Recursively collects each selected topicId along with all descendants in the topic tree.
 * Uses a Set to guard against malformed cyclic parent chains.
 */
export function expandTopicIdsWithDescendants(
  selectedTopicIds: readonly number[] | undefined,
  topics: readonly Topic[],
): number[] {
  if (!selectedTopicIds || selectedTopicIds.length === 0) {
    return [];
  }

  const childrenByParent = new Map<number, number[]>();
  for (const topic of topics) {
    if (topic.parentId !== null) {
      const list = childrenByParent.get(topic.parentId);
      if (list) {
        list.push(topic.id);
      } else {
        childrenByParent.set(topic.parentId, [topic.id]);
      }
    }
  }

  const visited = new Set<number>();
  const queue: number[] = [];

  for (const rawId of selectedTopicIds) {
    if (Number.isInteger(rawId) && rawId > 0 && !visited.has(rawId)) {
      visited.add(rawId);
      queue.push(rawId);
    }
  }

  let cursor = 0;
  while (cursor < queue.length) {
    const currentId = queue[cursor++];
    const children = childrenByParent.get(currentId);
    if (children) {
      for (const childId of children) {
        if (!visited.has(childId)) {
          visited.add(childId);
          queue.push(childId);
        }
      }
    }
  }

  return Array.from(visited);
}

interface CompiledSearchQuery {
  hasQuery: boolean;
  normalizedQuery: string;
  compactQuery: string;
  tokens: string[];
}

function compileSearchQuery(rawQuery: string | undefined, normalizer: ISearchNormalizer): CompiledSearchQuery {
  const normalizedQuery = normalizer.normalize(rawQuery ?? '');
  if (!normalizedQuery) {
    return {
      hasQuery: false,
      normalizedQuery: '',
      compactQuery: '',
      tokens: [],
    };
  }
  return {
    hasQuery: true,
    normalizedQuery,
    compactQuery: normalizedQuery.replace(/\s+/g, ''),
    tokens: normalizedQuery.split(' ').filter((t) => t.length > 0),
  };
}

function matchesCompiledQuery(
  item: ContentItem,
  compiled: CompiledSearchQuery,
  normalizer: ISearchNormalizer,
): boolean {
  if (!compiled.hasQuery) {
    return true;
  }

  const combinedRaw =
    item.searchText && item.searchText.trim().length > 0
      ? `${item.title} ${item.summary} ${item.searchText}`
      : `${item.title} ${item.summary}`;
  const normHaystack = normalizer.normalize(combinedRaw);

  if (normHaystack.includes(compiled.normalizedQuery)) {
    return true;
  }

  const compactHaystack = normHaystack.replace(/\s+/g, '');
  if (compiled.compactQuery.length >= 2 && compactHaystack.includes(compiled.compactQuery)) {
    return true;
  }

  if (compiled.tokens.length > 1) {
    return compiled.tokens.every(
      (token) => normHaystack.includes(token) || compactHaystack.includes(token),
    );
  }

  return false;
}

function hasAnyMatch(candidateIds: readonly number[], targetSet: ReadonlySet<number>): boolean {
  for (let i = 0; i < candidateIds.length; i += 1) {
    if (targetSet.has(candidateIds[i])) {
      return true;
    }
  }
  return false;
}

/**
 * Pure Section 3.2 / 3.7 / 3.8 public catalog query engine.
 * Designed with O(1) Map/Set lookups to handle 1,000+ items well below 2 seconds.
 */
export function queryPublicCatalog(
  dataset: CatalogDataset,
  query: PublicCatalogQuery,
  normalizer: ISearchNormalizer = defaultSearchNormalizer,
): PublicCatalogResult {
  const topicsByContent = buildLinkMap(
    dataset.contentTopics,
    (l: ContentTopic) => l.topicId,
  );
  const tagsByContent = buildLinkMap(
    dataset.contentTags,
    (l: ContentTag) => l.tagId,
  );
  const personsByContent = buildLinkMap(
    dataset.contentPersons,
    (l: ContentPerson) => l.personId,
  );
  const ageGroupsByContent = buildLinkMap(
    dataset.contentAgeGroups,
    (l: ContentAgeGroup) => l.ageGroupId,
  );

  const topicNameById = new Map<number, string>();
  const topicParentById = new Map<number, number | null>();
  for (const topic of dataset.topics) {
    topicNameById.set(topic.id, topic.name);
    topicParentById.set(topic.id, topic.parentId);
  }

  const expandedTopicIds = expandTopicIdsWithDescendants(query.topicIds, dataset.topics);
  const topicFilterSet = new Set<number>(expandedTopicIds);
  const tagFilterSet = new Set<number>(query.tagIds ?? []);
  const personFilterSet = new Set<number>(query.personIds ?? []);
  const formatFilterSet = new Set<ContentFormat>(query.formats ?? []);
  const impactFilterSet = new Set<number>(query.impactLevelIds ?? []);
  const ageFilterSet = new Set<number>(query.filterAgeGroupIds ?? []);

  const compiledQuery = compileSearchQuery(query.query, normalizer);

  const facetsCounts: CatalogFacetsCounts = {
    topics: {},
    tags: {},
    persons: {},
    formats: createEmptyFormatsRecord(),
    impactLevels: {},
    ageGroups: {},
  };

  interface PreparedCandidate {
    item: ContentItem;
    topicIds: number[];
    tagIds: number[];
    personIds: number[];
    ageGroupIds: number[];
    primaryTopicName: string | null;
  }

  const matchedCandidates: PreparedCandidate[] = [];

  for (let i = 0; i < dataset.items.length; i += 1) {
    const item = dataset.items[i];

    // Rule 1: Published only
    if (item.status !== ContentStatus.Published) {
      continue;
    }

    const ageGroupIds = ageGroupsByContent.get(item.id) ?? [];

    // Rule 2: Active AgeGroup Section 3.2 hard filter (non-bypassable for child)
    if (!isContentAllowedForAgeGroup(ageGroupIds, query.activeAgeGroup)) {
      continue;
    }

    // Rule 5: Normalized search query filter
    if (!matchesCompiledQuery(item, compiledQuery, normalizer)) {
      continue;
    }

    const topicIds = topicsByContent.get(item.id) ?? [];
    const tagIds = tagsByContent.get(item.id) ?? [];
    const personIds = personsByContent.get(item.id) ?? [];

    // Accumulate facet counts across age-safe, search-matched published items
    facetsCounts.formats[item.format] = (facetsCounts.formats[item.format] ?? 0) + 1;

    if (item.impactLevelId !== null) {
      facetsCounts.impactLevels[item.impactLevelId] =
        (facetsCounts.impactLevels[item.impactLevelId] ?? 0) + 1;
    }

    // Topic facet count includes ancestor propagation (deduplicated per content item)
    if (topicIds.length > 0) {
      const countedTopicsForItem = new Set<number>();
      for (let t = 0; t < topicIds.length; t += 1) {
        let cursor: number | null = topicIds[t];
        let depthGuard = 0;
        while (cursor !== null && !countedTopicsForItem.has(cursor) && depthGuard < 16) {
          countedTopicsForItem.add(cursor);
          facetsCounts.topics[cursor] = (facetsCounts.topics[cursor] ?? 0) + 1;
          cursor = topicParentById.get(cursor) ?? null;
          depthGuard += 1;
        }
      }
    }

    for (let t = 0; t < tagIds.length; t += 1) {
      const tid = tagIds[t];
      facetsCounts.tags[tid] = (facetsCounts.tags[tid] ?? 0) + 1;
    }

    for (let p = 0; p < personIds.length; p += 1) {
      const pid = personIds[p];
      facetsCounts.persons[pid] = (facetsCounts.persons[pid] ?? 0) + 1;
    }

    for (let a = 0; a < ageGroupIds.length; a += 1) {
      const aid = ageGroupIds[a];
      facetsCounts.ageGroups[aid] = (facetsCounts.ageGroups[aid] ?? 0) + 1;
    }

    // Rule 3 & 4: AND across groups, OR within each group
    if (topicFilterSet.size > 0 && !hasAnyMatch(topicIds, topicFilterSet)) {
      continue;
    }
    if (tagFilterSet.size > 0 && !hasAnyMatch(tagIds, tagFilterSet)) {
      continue;
    }
    if (personFilterSet.size > 0 && !hasAnyMatch(personIds, personFilterSet)) {
      continue;
    }
    if (formatFilterSet.size > 0 && !formatFilterSet.has(item.format)) {
      continue;
    }
    if (
      impactFilterSet.size > 0 &&
      (item.impactLevelId === null || !impactFilterSet.has(item.impactLevelId))
    ) {
      continue;
    }
    if (ageFilterSet.size > 0 && !hasAnyMatch(ageGroupIds, ageFilterSet)) {
      continue;
    }

    const primaryTopicName =
      topicIds.length > 0 ? (topicNameById.get(topicIds[0]) ?? null) : null;

    matchedCandidates.push({
      item,
      topicIds,
      tagIds,
      personIds,
      ageGroupIds,
      primaryTopicName,
    });
  }

  // Rule 6: Sorting
  const sortMode: CatalogSortOption = query.sort ?? 'latest';
  let sortedEntries: CatalogContentCardItem[];

  if (sortMode === 'latest') {
    const prioritized = applyAgeGroupRulesWithMeta(
      matchedCandidates.map((c) => ({
        item: c,
        ageGroupIds: c.ageGroupIds,
        publishedAt: c.item.publishedAt,
        createdAt: c.item.createdAt,
        id: c.item.id,
      })),
      query.activeAgeGroup,
    );

    sortedEntries = prioritized.map((entry) => ({
      item: entry.item.item,
      topicIds: entry.item.topicIds,
      tagIds: entry.item.tagIds,
      personIds: entry.item.personIds,
      ageGroupIds: entry.item.ageGroupIds,
      primaryTopicName: entry.item.primaryTopicName,
      priorityGroup: entry.priorityGroup,
    }));
  } else {
    sortedEntries = matchedCandidates
      .map((c) => ({
        item: c.item,
        topicIds: c.topicIds,
        tagIds: c.tagIds,
        personIds: c.personIds,
        ageGroupIds: c.ageGroupIds,
        primaryTopicName: c.primaryTopicName,
        priorityGroup: computePriorityGroup(c.ageGroupIds, query.activeAgeGroup),
      }))
      .sort((a, b) => {
        const primaryMetric =
          sortMode === 'most_viewed'
            ? b.item.viewCount - a.item.viewCount
            : b.item.likeCount - a.item.likeCount;
        if (primaryMetric !== 0) {
          return primaryMetric;
        }
        if (a.priorityGroup !== b.priorityGroup) {
          return a.priorityGroup - b.priorityGroup;
        }
        const pubDiff = parseTimestampMs(b.item.publishedAt) - parseTimestampMs(a.item.publishedAt);
        if (pubDiff !== 0) {
          return pubDiff;
        }
        const createdDiff = parseTimestampMs(b.item.createdAt) - parseTimestampMs(a.item.createdAt);
        if (createdDiff !== 0) {
          return createdDiff;
        }
        return b.item.id - a.item.id;
      });
  }

  // Rule 7: Pagination
  const rawPageSize = query.pageSize ?? DEFAULT_CATALOG_PAGE_SIZE;
  const pageSize =
    Number.isFinite(rawPageSize) && rawPageSize >= 1
      ? Math.floor(rawPageSize)
      : DEFAULT_CATALOG_PAGE_SIZE;
  const totalCount = sortedEntries.length;
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const rawPage = query.page ?? 1;
  const page =
    Number.isFinite(rawPage) && rawPage >= 1
      ? Math.min(Math.floor(rawPage), totalPages)
      : 1;

  const startIndex = (page - 1) * pageSize;
  const pagedItems = sortedEntries.slice(startIndex, startIndex + pageSize);

  return {
    items: pagedItems,
    totalCount,
    page,
    pageSize,
    totalPages,
    facetsCounts,
    expandedTopicIds,
  };
}

export interface CatalogTaxonomyLists {
  topics: Topic[];
  tags: Tag[];
  persons: Person[];
  impactLevels: ImpactLevel[];
  ageGroups: AgeGroup[];
}

export class ContentCatalogService {
  private readonly contentRepository: IContentRepository;
  private readonly taxonomyRepository: ITaxonomyRepository;
  private readonly adminRepository: IAdminRepository;
  private readonly searchNormalizer: ISearchNormalizer;

  constructor(
    contentRepository: IContentRepository,
    taxonomyRepository: ITaxonomyRepository,
    adminRepository: IAdminRepository,
    searchNormalizer: ISearchNormalizer,
  ) {
    this.contentRepository = contentRepository;
    this.taxonomyRepository = taxonomyRepository;
    this.adminRepository = adminRepository;
    this.searchNormalizer = searchNormalizer;
  }

  public async getPublicPageSize(): Promise<number> {
    const setting = await this.adminRepository.getSiteSettingByKey('Home.ItemsPerShelf');
    if (!setting) {
      return DEFAULT_CATALOG_PAGE_SIZE;
    }
    const normalized = normalizeDigits(setting.value).trim();
    const parsed = Number.parseInt(normalized, 10);
    if (Number.isInteger(parsed) && parsed >= 1 && parsed <= 100) {
      return parsed;
    }
    return DEFAULT_CATALOG_PAGE_SIZE;
  }

  public async loadCatalogDataset(): Promise<{
    dataset: CatalogDataset;
    taxonomy: CatalogTaxonomyLists;
  }> {
    const [
      items,
      topics,
      tags,
      persons,
      impactLevels,
      ageGroups,
      contentTopics,
      contentTags,
      contentPersons,
      contentAgeGroups,
    ] = await Promise.all([
      this.contentRepository.getAllContentItems(),
      this.taxonomyRepository.getAllTopics(),
      this.taxonomyRepository.getAllTags(),
      this.taxonomyRepository.getAllPersons(),
      this.taxonomyRepository.getAllImpactLevels(),
      this.taxonomyRepository.getAllAgeGroups(),
      this.contentRepository.getAllContentTopics(),
      this.contentRepository.getAllContentTags(),
      this.contentRepository.getAllContentPersons(),
      this.contentRepository.getAllContentAgeGroups(),
    ]);

    const sortedTopics = [...topics].sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);
    const sortedImpacts = [...impactLevels].sort(
      (a, b) => a.sortOrder - b.sortOrder || a.id - b.id,
    );
    const sortedAges = [...ageGroups].sort(
      (a, b) => a.sortOrder - b.sortOrder || a.id - b.id,
    );
    const sortedTags = [...tags].sort((a, b) => a.name.localeCompare(b.name, 'fa'));
    const sortedPersons = [...persons].sort((a, b) => a.name.localeCompare(b.name, 'fa'));

    return {
      dataset: {
        items,
        topics: sortedTopics,
        tags: sortedTags,
        persons: sortedPersons,
        impactLevels: sortedImpacts,
        ageGroups: sortedAges,
        contentTopics,
        contentTags,
        contentPersons,
        contentAgeGroups,
      },
      taxonomy: {
        topics: sortedTopics,
        tags: sortedTags,
        persons: sortedPersons,
        impactLevels: sortedImpacts,
        ageGroups: sortedAges,
      },
    };
  }

  public async queryCatalogAsync(query: PublicCatalogQuery): Promise<{
    result: PublicCatalogResult;
    taxonomy: CatalogTaxonomyLists;
  }> {
    const [{ dataset, taxonomy }, defaultPageSize] = await Promise.all([
      this.loadCatalogDataset(),
      query.pageSize ? Promise.resolve(query.pageSize) : this.getPublicPageSize(),
    ]);

    const result = queryPublicCatalog(
      dataset,
      {
        ...query,
        pageSize: query.pageSize ?? defaultPageSize,
      },
      this.searchNormalizer,
    );

    return {
      result,
      taxonomy,
    };
  }
}
