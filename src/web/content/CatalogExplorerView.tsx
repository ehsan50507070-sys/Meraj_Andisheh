import { BookOpen, Search, SlidersHorizontal, X } from 'lucide-react';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import type { ContentFormat } from '../../core/domain/content';
import type { Topic } from '../../core/domain/taxonomy';
import {
  DEFAULT_CATALOG_PAGE_SIZE,
  type CatalogSortOption,
  type CatalogTaxonomyLists,
  type PublicCatalogResult,
} from '../../core/services/contentCatalogService';
import { useAge } from '../context/AgeContext';
import {
  Breadcrumb,
  Button,
  ContentCard,
  Pagination,
  type BreadcrumbItem,
} from '../components/ui';
import { MainLayout } from '../layouts/MainLayout';
import { toPersianDigits } from '../resources/formatters';
import type { ResourceKey } from '../resources/fa';
import { t } from '../resources/i18n';
import { navigateToHash } from '../router/HashRouter';
import { appContainer } from '../services/appContainer';
import { CatalogFilterSidebar } from './CatalogFilterSidebar';
import {
  buildCatalogHash,
  EMPTY_CATALOG_FILTER_STATE,
  parseCatalogHashState,
  type CatalogFilterState,
} from './catalogHashParams';

export interface CatalogExplorerViewProps {
  mode: 'bank' | 'search';
  currentRoute: string;
}

const EMPTY_TAXONOMY: CatalogTaxonomyLists = {
  topics: [],
  tags: [],
  persons: [],
  impactLevels: [],
  ageGroups: [],
};

const EMPTY_RESULT: PublicCatalogResult = {
  items: [],
  totalCount: 0,
  page: 1,
  pageSize: DEFAULT_CATALOG_PAGE_SIZE,
  totalPages: 1,
  facetsCounts: {
    topics: {},
    tags: {},
    persons: {},
    formats: {
      Video: 0,
      Audio: 0,
      Article: 0,
      Image: 0,
      Pdf: 0,
      Presentation: 0,
      Book: 0,
      Film: 0,
    },
    impactLevels: {},
    ageGroups: {},
  },
  expandedTopicIds: [],
};

const SORT_OPTIONS: ReadonlyArray<{ value: CatalogSortOption; labelKey: ResourceKey }> = [
  { value: 'latest', labelKey: 'catalog.sort.latest' },
  { value: 'most_viewed', labelKey: 'catalog.sort.most_viewed' },
  { value: 'most_liked', labelKey: 'catalog.sort.most_liked' },
];

function toggleArrayItem<T>(list: readonly T[], target: T): T[] {
  return list.includes(target)
    ? list.filter((item) => item !== target)
    : [...list, target];
}

function buildTopicAncestorsChain(topicId: number, topics: readonly Topic[]): Topic[] {
  const byId = new Map<number, Topic>(topics.map((topic) => [topic.id, topic]));
  const chain: Topic[] = [];
  const visited = new Set<number>();
  let cursor: number | null = topicId;

  while (cursor !== null && !visited.has(cursor)) {
    visited.add(cursor);
    const found = byId.get(cursor);
    if (!found) {
      break;
    }
    chain.push(found);
    cursor = found.parentId;
  }

  return chain.reverse();
}

export function CatalogExplorerView({ mode, currentRoute }: CatalogExplorerViewProps) {
  const { effectiveAgeGroup } = useAge();
  const basePath: '/content' | '/search' = mode === 'search' ? '/search' : '/content';

  const filterState = useMemo(() => parseCatalogHashState(currentRoute), [currentRoute]);
  const [searchInputText, setSearchInputText] = useState<string>(filterState.query);
  const [result, setResult] = useState<PublicCatalogResult>(EMPTY_RESULT);
  const [taxonomy, setTaxonomy] = useState<CatalogTaxonomyLists>(EMPTY_TAXONOMY);
  const [thumbnailUrls, setThumbnailUrls] = useState<Record<number, string>>({});
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState<boolean>(false);

  useEffect(() => {
    setSearchInputText(filterState.query);
  }, [filterState.query]);

  useEffect(() => {
    let active = true;
    const createdUrls: string[] = [];

    const loadCatalog = async () => {
      setIsLoading(true);
      try {
        await appContainer.ensureInitializedAtStartup();
        const { result: queriedResult, taxonomy: loadedTaxonomy } =
          await appContainer.contentCatalogService.queryCatalogAsync({
            query: filterState.query,
            topicIds: filterState.topicIds,
            tagIds: filterState.tagIds,
            personIds: filterState.personIds,
            formats: filterState.formats,
            impactLevelIds: filterState.impactLevelIds,
            filterAgeGroupIds: filterState.filterAgeGroupIds,
            sort: filterState.sort,
            page: filterState.page,
            activeAgeGroup: effectiveAgeGroup,
          });

        if (!active) {
          return;
        }
        setResult(queriedResult);
        setTaxonomy(loadedTaxonomy);

        const nextUrls: Record<number, string> = {};
        await Promise.all(
          queriedResult.items.map(async ({ item }) => {
            if (!item.thumbnailKey) {
              return;
            }
            const media = await appContainer.fileUploadService.openPublicMediaAsync(
              item.thumbnailKey,
            );
            if (!active || !media.ok || !media.bytes || !media.metadata) {
              return;
            }
            const copy = new Uint8Array(media.bytes.byteLength);
            copy.set(media.bytes);
            const blob = new Blob([copy.buffer], { type: media.metadata.mimeType });
            const url = URL.createObjectURL(blob);
            createdUrls.push(url);
            nextUrls[item.id] = url;
          }),
        );

        if (active) {
          setThumbnailUrls(nextUrls);
        }
      } finally {
        if (active) {
          setIsLoading(false);
        }
      }
    };

    void loadCatalog();

    return () => {
      active = false;
      for (const url of createdUrls) {
        URL.revokeObjectURL(url);
      }
    };
  }, [filterState, effectiveAgeGroup]);

  const navigateWithState = (nextState: CatalogFilterState) => {
    const hash = buildCatalogHash(basePath, nextState);
    navigateToHash(hash.slice(1));
  };

  const handleToggleTopic = (topicId: number) => {
    navigateWithState({
      ...filterState,
      topicIds: toggleArrayItem(filterState.topicIds, topicId),
      page: 1,
    });
  };

  const handleToggleFormat = (format: ContentFormat) => {
    navigateWithState({
      ...filterState,
      formats: toggleArrayItem(filterState.formats, format),
      page: 1,
    });
  };

  const handleToggleTag = (tagId: number) => {
    navigateWithState({
      ...filterState,
      tagIds: toggleArrayItem(filterState.tagIds, tagId),
      page: 1,
    });
  };

  const handleTogglePerson = (personId: number) => {
    navigateWithState({
      ...filterState,
      personIds: toggleArrayItem(filterState.personIds, personId),
      page: 1,
    });
  };

  const handleToggleImpact = (impactId: number) => {
    navigateWithState({
      ...filterState,
      impactLevelIds: toggleArrayItem(filterState.impactLevelIds, impactId),
      page: 1,
    });
  };

  const handleToggleAgeGroup = (ageGroupId: number) => {
    navigateWithState({
      ...filterState,
      filterAgeGroupIds: toggleArrayItem(filterState.filterAgeGroupIds, ageGroupId),
      page: 1,
    });
  };

  const handleSortChange = (sort: CatalogSortOption) => {
    navigateWithState({
      ...filterState,
      sort,
      page: 1,
    });
  };

  const handlePageChange = (page: number) => {
    navigateWithState({
      ...filterState,
      page,
    });
    if (typeof window !== 'undefined') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const handleClearAll = () => {
    navigateWithState({
      ...EMPTY_CATALOG_FILTER_STATE,
      query: mode === 'search' ? filterState.query : '',
    });
  };

  const handleClearEverythingIncludingQuery = () => {
    setSearchInputText('');
    navigateWithState({ ...EMPTY_CATALOG_FILTER_STATE });
  };

  const handleSearchPageSubmit = (event: FormEvent) => {
    event.preventDefault();
    navigateWithState({
      ...filterState,
      query: searchInputText.trim(),
      page: 1,
    });
  };

  // Build Breadcrumb items (including ancestor -> child hierarchy when exactly 1 topic is selected)
  const breadcrumbItems = useMemo<BreadcrumbItem[]>(() => {
    const items: BreadcrumbItem[] = [
      { label: t('catalog.breadcrumb.home'), href: '#/' },
      {
        label:
          mode === 'search'
            ? t('catalog.breadcrumb.search')
            : t('catalog.breadcrumb.bank'),
        href:
          mode === 'bank' && filterState.topicIds.length === 1
            ? '#/content'
            : undefined,
      },
    ];

    if (mode === 'bank' && filterState.topicIds.length === 1 && taxonomy.topics.length > 0) {
      const chain = buildTopicAncestorsChain(filterState.topicIds[0], taxonomy.topics);
      chain.forEach((topic, index) => {
        const isLast = index === chain.length - 1;
        items.push({
          label: topic.name,
          href: isLast ? undefined : `#/content?topics=${topic.id}`,
        });
      });
    }

    return items;
  }, [mode, filterState.topicIds, taxonomy.topics]);

  // Build removable active filter chips
  const activeChips = useMemo(() => {
    const topicById = new Map(taxonomy.topics.map((x) => [x.id, x.name]));
    const tagById = new Map(taxonomy.tags.map((x) => [x.id, x.name]));
    const personById = new Map(taxonomy.persons.map((x) => [x.id, x.name]));
    const impactById = new Map(taxonomy.impactLevels.map((x) => [x.id, x.name]));
    const ageById = new Map(taxonomy.ageGroups.map((x) => [x.id, x.name]));

    const chips: Array<{ key: string; label: string; onRemove: () => void }> = [];

    if (filterState.query) {
      chips.push({
        key: 'q',
        label: t('catalog.chip.query', { value: filterState.query }),
        onRemove: () =>
          navigateWithState({ ...filterState, query: '', page: 1 }),
      });
    }

    for (const id of filterState.topicIds) {
      const name = topicById.get(id) ?? toPersianDigits(id);
      chips.push({
        key: `topic-${id}`,
        label: t('catalog.chip.topic', { value: name }),
        onRemove: () => handleToggleTopic(id),
      });
    }

    for (const fmt of filterState.formats) {
      const label = t(`catalog.format.${fmt}` as ResourceKey);
      chips.push({
        key: `fmt-${fmt}`,
        label: t('catalog.chip.format', { value: label }),
        onRemove: () => handleToggleFormat(fmt),
      });
    }

    for (const id of filterState.tagIds) {
      const name = tagById.get(id) ?? toPersianDigits(id);
      chips.push({
        key: `tag-${id}`,
        label: t('catalog.chip.tag', { value: name }),
        onRemove: () => handleToggleTag(id),
      });
    }

    for (const id of filterState.personIds) {
      const name = personById.get(id) ?? toPersianDigits(id);
      chips.push({
        key: `person-${id}`,
        label: t('catalog.chip.person', { value: name }),
        onRemove: () => handleTogglePerson(id),
      });
    }

    for (const id of filterState.impactLevelIds) {
      const name = impactById.get(id) ?? toPersianDigits(id);
      chips.push({
        key: `impact-${id}`,
        label: t('catalog.chip.impact', { value: name }),
        onRemove: () => handleToggleImpact(id),
      });
    }

    for (const id of filterState.filterAgeGroupIds) {
      const name = ageById.get(id) ?? toPersianDigits(id);
      chips.push({
        key: `age-${id}`,
        label: t('catalog.chip.age', { value: name }),
        onRemove: () => handleToggleAgeGroup(id),
      });
    }

    return chips;
  }, [filterState, taxonomy]);

  const activeFiltersCount =
    filterState.topicIds.length +
    filterState.formats.length +
    filterState.tagIds.length +
    filterState.personIds.length +
    filterState.impactLevelIds.length +
    filterState.filterAgeGroupIds.length;

  return (
    <MainLayout currentRoute={currentRoute}>
      <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 py-5 sm:py-8 space-y-5 sm:space-y-6">
        {/* Breadcrumb */}
        <Breadcrumb items={breadcrumbItems} ariaLabel={t('catalog.breadcrumb.ariaLabel')} />

        {/* Page Header (+ Prominent Search Input on #/search) */}
        <section className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-card)] shadow-[var(--shadow-card)] p-4 sm:p-6 space-y-4">
          <div className="space-y-1.5">
            <h1 className="text-xl sm:text-2xl font-bold text-[var(--color-text)] text-balance">
              {mode === 'search' && filterState.query
                ? t('catalog.searchPage.titleWithQuery', { query: filterState.query })
                : mode === 'search'
                  ? t('catalog.searchPage.title')
                  : t('catalog.page.title')}
            </h1>
            <p className="text-xs sm:text-sm text-[var(--color-muted)] leading-relaxed">
              {mode === 'search' ? t('catalog.searchPage.subtitle') : t('catalog.page.subtitle')}
            </p>
          </div>

          {mode === 'search' && (
            <form onSubmit={handleSearchPageSubmit} className="flex flex-col sm:flex-row gap-2.5">
              <div className="relative flex-1">
                <label htmlFor="search-page-query-input" className="sr-only">
                  {t('catalog.searchPage.inputLabel')}
                </label>
                <input
                  id="search-page-query-input"
                  type="search"
                  value={searchInputText}
                  onChange={(e) => setSearchInputText(e.target.value)}
                  placeholder={t('liveSearch.pagePlaceholder')}
                  className="w-full min-h-[44px] pr-10 pl-3 py-2 text-sm bg-[var(--color-surface-alt)] text-[var(--color-text)] placeholder:text-[var(--color-muted)] border border-[var(--color-border)] rounded-[var(--radius-control)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--color-primary)]"
                />
                <Search
                  className="w-4 h-4 text-[var(--color-muted)] absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none"
                  aria-hidden="true"
                />
              </div>
              <Button type="submit" variant="primary" className="min-h-[44px] px-5 shrink-0">
                {t('liveSearch.button')}
              </Button>
            </form>
          )}
        </section>

        {/* Main Split Layout: Desktop 25% Filter Sidebar (Right in RTL) + 75% Results Grid (Left in RTL) */}
        <div className="flex flex-col lg:flex-row items-start gap-6">
          {/* Desktop 25% Filter Sidebar */}
          <aside className="hidden lg:block w-full lg:w-1/4 lg:min-w-[260px] shrink-0">
            <CatalogFilterSidebar
              state={filterState}
              taxonomy={taxonomy}
              facetsCounts={result.facetsCounts}
              activeAgeGroup={effectiveAgeGroup}
              onToggleTopic={handleToggleTopic}
              onToggleFormat={handleToggleFormat}
              onToggleTag={handleToggleTag}
              onTogglePerson={handleTogglePerson}
              onToggleImpact={handleToggleImpact}
              onToggleAgeGroup={handleToggleAgeGroup}
              onClearAll={handleClearAll}
            />
          </aside>

          {/* 75% Results Column */}
          <div className="w-full lg:flex-1 min-w-0 space-y-4">
            {/* Toolbar: Mobile Filter Trigger, Total Count, Sort Selector */}
            <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-card)] p-3.5 sm:p-4 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setMobileFiltersOpen(true)}
                  className="lg:hidden inline-flex items-center gap-1.5 min-h-[40px] px-3 py-1.5 text-xs sm:text-sm font-semibold rounded-[var(--radius-control)] border border-[var(--color-border-strong)] bg-[var(--color-surface-alt)] text-[var(--color-text)] whitespace-nowrap"
                >
                  <SlidersHorizontal className="w-4 h-4 text-[var(--color-primary)]" aria-hidden="true" />
                  <span>
                    {activeFiltersCount > 0
                      ? t('catalog.filters.mobileButtonCount', {
                          count: toPersianDigits(activeFiltersCount),
                        })
                      : t('catalog.filters.mobileButton')}
                  </span>
                </button>

                <span className="text-xs sm:text-sm font-semibold text-[var(--color-text)] tabular-nums-strict">
                  {t('catalog.resultsCount', {
                    count: toPersianDigits(result.totalCount),
                  })}
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-xs text-[var(--color-muted)] ml-1">
                  {t('catalog.sort.label')}
                </span>
                {SORT_OPTIONS.map((option) => {
                  const isActive = filterState.sort === option.value;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      aria-pressed={isActive}
                      onClick={() => handleSortChange(option.value)}
                      className={`min-h-[36px] px-3 py-1.5 text-xs font-medium rounded-[var(--radius-control)] border transition-colors whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--color-primary)] ${
                        isActive
                          ? 'bg-[var(--color-primary-button)] text-[var(--color-on-primary)] border-transparent'
                          : 'bg-[var(--color-surface-alt)] text-[var(--color-text)] border-[var(--color-border)] hover:border-[var(--color-border-strong)]'
                      }`}
                    >
                      {t(option.labelKey)}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Active Removable Filter Chips */}
            {activeChips.length > 0 && (
              <div
                aria-label={t('catalog.filters.activeChipsAria')}
                className="flex flex-wrap items-center gap-2"
              >
                {activeChips.map((chip) => (
                  <button
                    key={chip.key}
                    type="button"
                    onClick={chip.onRemove}
                    aria-label={t('catalog.filters.removeChipAria', { label: chip.label })}
                    className="inline-flex items-center gap-1.5 min-h-[34px] px-2.5 py-1 text-xs font-medium rounded-[var(--radius-control)] bg-[var(--color-surface)] border border-[var(--color-border-strong)] text-[var(--color-text)] hover:border-[var(--color-primary)] transition-colors"
                  >
                    <span>{chip.label}</span>
                    <X className="w-3.5 h-3.5 text-[var(--color-muted)] shrink-0" aria-hidden="true" />
                  </button>
                ))}

                <button
                  type="button"
                  onClick={handleClearEverythingIncludingQuery}
                  className="text-xs font-semibold text-[var(--color-primary)] hover:underline underline-offset-4 px-2 py-1 whitespace-nowrap"
                >
                  {t('catalog.filters.clearAll')}
                </button>
              </div>
            )}

            {/* Results Grid */}
            {isLoading ? (
              <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-card)] p-10 text-center text-sm text-[var(--color-muted)]">
                {t('catalog.loading')}
              </div>
            ) : result.items.length === 0 ? (
              <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-card)] p-8 sm:p-12 text-center space-y-3">
                <BookOpen className="w-8 h-8 mx-auto text-[var(--color-muted)]" aria-hidden="true" />
                <h2 className="text-base font-bold text-[var(--color-text)]">
                  {t('catalog.empty.title')}
                </h2>
                <p className="text-xs sm:text-sm text-[var(--color-muted)] max-w-md mx-auto leading-relaxed">
                  {t('catalog.empty.desc')}
                </p>
                {activeChips.length > 0 && (
                  <div className="pt-2">
                    <Button variant="outline" size="sm" onClick={handleClearEverythingIncludingQuery}>
                      {t('catalog.empty.resetButton')}
                    </Button>
                  </div>
                )}
              </div>
            ) : (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-5 items-stretch">
                  {result.items.map((entry) => {
                    const formatKey = `catalog.format.${entry.item.format}` as ResourceKey;
                    return (
                      <ContentCard
                        key={entry.item.id}
                        title={entry.item.title}
                        formatLabel={t(formatKey)}
                        durationMinutes={entry.item.readWatchMinutes ?? 0}
                        topicLabel={entry.primaryTopicName ?? t('catalog.generalTopic')}
                        summary={entry.item.summary}
                        thumbnailUrl={thumbnailUrls[entry.item.id]}
                        thumbnailAlt={entry.item.title}
                        onSelect={() =>
                          navigateToHash(`/content/${encodeURIComponent(entry.item.slug)}`)
                        }
                      />
                    );
                  })}
                </div>

                {result.totalPages > 1 && (
                  <div className="pt-4 border-t border-[var(--color-border)]">
                    <Pagination
                      currentPage={result.page}
                      totalPages={result.totalPages}
                      onPageChange={handlePageChange}
                    />
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {/* Mobile Filter Drawer */}
      {mobileFiltersOpen && (
        <div
          className="fixed inset-0 z-50 lg:hidden flex flex-col bg-[var(--color-bg)]"
          role="dialog"
          aria-modal="true"
          aria-label={t('catalog.filters.title')}
        >
          <div className="flex items-center justify-between gap-3 px-4 py-3 bg-[var(--color-surface)] border-b border-[var(--color-border)]">
            <span className="text-base font-bold text-[var(--color-text)]">
              {t('catalog.filters.title')}
            </span>
            <button
              type="button"
              onClick={() => setMobileFiltersOpen(false)}
              aria-label={t('catalog.filters.closeMobileAria')}
              className="inline-flex items-center justify-center w-10 h-10 rounded-[var(--radius-control)] text-[var(--color-muted)] hover:bg-[var(--color-surface-alt)]"
            >
              <X className="w-5 h-5" aria-hidden="true" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-3">
            <CatalogFilterSidebar
              state={filterState}
              taxonomy={taxonomy}
              facetsCounts={result.facetsCounts}
              activeAgeGroup={effectiveAgeGroup}
              onToggleTopic={handleToggleTopic}
              onToggleFormat={handleToggleFormat}
              onToggleTag={handleToggleTag}
              onTogglePerson={handleTogglePerson}
              onToggleImpact={handleToggleImpact}
              onToggleAgeGroup={handleToggleAgeGroup}
              onClearAll={handleClearAll}
            />
          </div>

          <div className="p-3 bg-[var(--color-surface)] border-t border-[var(--color-border)]">
            <Button
              variant="primary"
              className="w-full min-h-[44px]"
              onClick={() => setMobileFiltersOpen(false)}
            >
              {t('catalog.filters.applyMobileButton', {
                count: toPersianDigits(result.totalCount),
              })}
            </Button>
          </div>
        </div>
      )}
    </MainLayout>
  );
}
