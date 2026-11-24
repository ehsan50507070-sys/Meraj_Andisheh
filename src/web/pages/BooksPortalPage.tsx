import {
  BookOpen,
  Search,
  Sparkles,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import type {
  BookPortalData,
  BookPortalItem,
} from '../../core/domain/portals';
import { useAuth } from '../auth/AuthContext';
import { Button } from '../components/ui';
import { useAge } from '../context/AgeContext';
import { usePageMeta } from '../hooks/usePageMeta';
import { MainLayout } from '../layouts/MainLayout';
import { toPersianDigits } from '../resources/formatters';
import { t } from '../resources/i18n';
import { navigateToHash } from '../router/HashRouter';
import { appContainer } from '../services/appContainer';
import { NotFoundPage } from './NotFoundPage';

export interface BooksPortalPageProps {
  currentRoute: string;
}

interface BookShowcaseCardProps {
  entry: BookPortalItem;
  thumbnailUrl?: string;
}

function BookShowcaseCard({ entry, thumbnailUrl }: BookShowcaseCardProps) {
  const [imgError, setImgError] = useState(false);
  const showFallback = !thumbnailUrl || imgError;
  const authorDisplay =
    entry.bookInfo.author.trim().length > 0
      ? t('books.portal.card.authorBy', { author: entry.bookInfo.author })
      : t('books.portal.card.authorUnset');
  const topicLabel = entry.primaryTopicName ?? t('catalog.generalTopic');

  return (
    <button
      type="button"
      onClick={() => navigateToHash(`/books/${encodeURIComponent(entry.item.slug)}`)}
      className="group w-full h-full text-right bg-[var(--color-surface)] border border-[var(--color-border)] hover:border-[var(--color-border-strong)] rounded-[var(--radius-card)] shadow-[var(--shadow-card)] overflow-hidden flex flex-col transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary)]"
    >
      <div className="p-4 sm:p-5 pb-0 flex justify-center bg-[var(--color-surface-alt)] border-b border-[var(--color-border)]">
        <div className="w-36 sm:w-40 aspect-[2/3] rounded-t-[var(--radius-control)] border border-b-0 border-[var(--color-border)] bg-[var(--color-surface)] overflow-hidden shadow-sm">
          {showFallback ? (
            <div className="w-full h-full flex flex-col items-center justify-center gap-2.5 p-3 text-center text-[var(--color-muted)] bg-[var(--color-surface)]">
              <BookOpen className="w-8 h-8 text-[var(--color-primary)] opacity-80" aria-hidden="true" />
              <span className="text-xs font-bold text-[var(--color-text)] line-clamp-3 leading-snug">
                {entry.item.title}
              </span>
              {entry.bookInfo.author.trim().length > 0 && (
                <span className="text-[11px] text-[var(--color-muted)] line-clamp-1">
                  {entry.bookInfo.author}
                </span>
              )}
            </div>
          ) : (
            <img
              src={thumbnailUrl}
              alt={entry.item.title}
              referrerPolicy="no-referrer"
              onError={() => setImgError(true)}
              className="w-full h-full object-cover transition-transform duration-200 group-hover:scale-[1.03]"
            />
          )}
        </div>
      </div>

      <div className="p-4 sm:p-5 flex-1 flex flex-col justify-between gap-3 text-right">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[var(--color-muted)] tabular-nums-strict">
            {entry.item.isFeatured && (
              <>
                <span className="inline-flex items-center gap-1 font-bold text-[var(--color-primary)]">
                  <Sparkles className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                  <span>{t('books.portal.featuredBadge')}</span>
                </span>
                <span aria-hidden="true">·</span>
              </>
            )}
            <span className="font-semibold text-[var(--color-text)]">{topicLabel}</span>
            {entry.bookInfo.publishYear !== null && (
              <>
                <span aria-hidden="true">·</span>
                <span>
                  {t('books.portal.card.yearValue', {
                    year: toPersianDigits(entry.bookInfo.publishYear),
                  })}
                </span>
              </>
            )}
          </div>

          <h3 className="text-base font-bold text-[var(--color-text)] leading-snug line-clamp-2">
            {entry.item.title}
          </h3>

          <p className="text-xs sm:text-sm font-medium text-[var(--color-primary)] line-clamp-1">
            {authorDisplay}
          </p>

          {entry.bookInfo.publisher && (
            <p className="text-xs text-[var(--color-muted)] line-clamp-1">
              {entry.bookInfo.publisher}
            </p>
          )}

          {entry.item.summary && (
            <p className="text-xs sm:text-sm text-[var(--color-muted)] leading-relaxed line-clamp-2">
              {entry.item.summary}
            </p>
          )}
        </div>

        <div className="pt-3 border-t border-[var(--color-border)] flex items-center justify-between gap-2 text-xs text-[var(--color-muted)] tabular-nums-strict">
          <span>
            {entry.bookInfo.pages !== null
              ? t('books.portal.card.pagesValue', {
                  pages: toPersianDigits(entry.bookInfo.pages),
                })
              : topicLabel}
          </span>
          <span className="inline-flex items-center gap-1 font-semibold text-[var(--color-primary)]">
            <BookOpen className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
            <span>{t('books.portal.viewBookAction')}</span>
          </span>
        </div>
      </div>
    </button>
  );
}

export function BooksPortalPage({ currentRoute }: BooksPortalPageProps) {
  const { siteTitle, isBooksEnabled, isAuthReady } = useAuth();
  const { effectiveAgeGroup, isAgeReady } = useAge();

  usePageMeta({
    currentRoute,
    siteTitle,
    description: t('books.portal.subtitle'),
  });

  const [portalData, setPortalData] = useState<BookPortalData | null>(null);
  const [isDisabled, setIsDisabled] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedTopicId, setSelectedTopicId] = useState<string>('all');
  const [searchInput, setSearchInput] = useState('');
  const [appliedQuery, setAppliedQuery] = useState('');
  const [thumbUrls, setThumbUrls] = useState<Record<number, string>>({});

  useEffect(() => {
    if (!isAgeReady || !isAuthReady) {
      return;
    }

    if (!isBooksEnabled) {
      setIsDisabled(true);
      setIsLoading(false);
      return;
    }

    let active = true;
    const loadPortal = async () => {
      setIsLoading(true);
      try {
        await appContainer.ensureInitializedAtStartup();
        const topicIdNum =
          selectedTopicId !== 'all' ? Number.parseInt(selectedTopicId, 10) : null;
        const res = await appContainer.bookPortalService.getBookPortalDataAsync(
          effectiveAgeGroup,
          {
            topicId:
              typeof topicIdNum === 'number' && Number.isFinite(topicIdNum)
                ? topicIdNum
                : null,
            query: appliedQuery,
          },
        );
        if (!active) return;

        if (!res.enabled) {
          setIsDisabled(true);
          setPortalData(null);
          return;
        }

        setIsDisabled(false);
        setPortalData(res.data);
      } finally {
        if (active) {
          setIsLoading(false);
        }
      }
    };

    void loadPortal();
    return () => {
      active = false;
    };
  }, [
    appliedQuery,
    effectiveAgeGroup,
    isAgeReady,
    isAuthReady,
    isBooksEnabled,
    selectedTopicId,
  ]);

  const thumbLoadKey = useMemo(() => {
    if (!portalData) return '';
    return portalData.items
      .map((entry) => `${entry.item.id}:${entry.item.thumbnailKey ?? ''}`)
      .join('|');
  }, [portalData]);

  useEffect(() => {
    if (!portalData || !thumbLoadKey) {
      setThumbUrls({});
      return;
    }

    let active = true;
    const createdUrls: string[] = [];

    const uniqueEntries = new Map<number, string>();
    for (const entry of portalData.items) {
      if (entry.item.thumbnailKey) {
        uniqueEntries.set(entry.item.id, entry.item.thumbnailKey);
      }
    }

    const loadThumbs = async () => {
      const next: Record<number, string> = {};
      await Promise.all(
        Array.from(uniqueEntries.entries()).map(async ([contentId, key]) => {
          const res = await appContainer.fileUploadService.openPublicMediaAsync(key);
          if (!active || !res.ok || !res.bytes || !res.metadata) return;
          const copy = new Uint8Array(res.bytes.byteLength);
          copy.set(res.bytes);
          const blob = new Blob([copy.buffer], { type: res.metadata.mimeType });
          const url = URL.createObjectURL(blob);
          createdUrls.push(url);
          next[contentId] = url;
        }),
      );
      if (active) {
        setThumbUrls(next);
      }
    };

    void loadThumbs();
    return () => {
      active = false;
      for (const url of createdUrls) {
        URL.revokeObjectURL(url);
      }
    };
  }, [portalData, thumbLoadKey]);

  const handleSearchSubmit = (e: FormEvent) => {
    e.preventDefault();
    setAppliedQuery(searchInput.trim());
  };

  const handleClearFilters = () => {
    setSelectedTopicId('all');
    setSearchInput('');
    setAppliedQuery('');
  };

  if (!isAgeReady || !isAuthReady) {
    return (
      <MainLayout currentRoute={currentRoute}>
        <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 py-10">
          <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-card)] p-8 text-center text-sm text-[var(--color-muted)]">
            {t('books.portal.loading')}
          </div>
        </div>
      </MainLayout>
    );
  }

  if (!isBooksEnabled || isDisabled) {
    return <NotFoundPage currentRoute={currentRoute} />;
  }

  const totalCount = portalData?.allAllowedBooksCount ?? 0;
  const featuredBooks = portalData?.featuredBooks ?? [];
  const availableTopics = portalData?.availableTopics ?? [];
  const hasFiltersActive = selectedTopicId !== 'all' || appliedQuery.length > 0;

  return (
    <MainLayout currentRoute={currentRoute}>
      <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 py-6 sm:py-8 space-y-6 sm:space-y-8">
        {/* Curatorial Library Heading */}
        <header className="pb-5 border-b border-[var(--color-border)] flex flex-wrap items-end justify-between gap-4">
          <div className="space-y-2 max-w-3xl">
            <div className="flex items-center gap-2 text-xs font-semibold text-[var(--color-primary)]">
              <BookOpen className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span>{t('books.portal.badge')}</span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-bold text-[var(--color-text)] text-balance">
              {t('books.portal.title')}
            </h1>
            <p className="text-sm sm:text-base text-[var(--color-muted)] leading-relaxed">
              {t('books.portal.subtitle')}
            </p>
          </div>
        </header>

        {isLoading && !portalData ? (
          <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-card)] p-8 text-center text-sm text-[var(--color-muted)]">
            {t('books.portal.loading')}
          </div>
        ) : (
          <>
            {/* Search & Topic Filter Toolbar */}
            <section className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-card)] p-4 sm:p-5 space-y-4">
              <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                <div className="flex flex-wrap items-center gap-2.5">
                  <label
                    htmlFor="books-topic-filter"
                    className="text-xs sm:text-sm font-semibold text-[var(--color-text)] whitespace-nowrap"
                  >
                    {t('books.portal.topicFilterLabel')}:
                  </label>
                  <select
                    id="books-topic-filter"
                    value={selectedTopicId}
                    onChange={(e) => setSelectedTopicId(e.target.value)}
                    className="min-h-[42px] px-3 py-2 text-xs sm:text-sm rounded-[var(--radius-control)] border border-[var(--color-border)] bg-[var(--color-surface-alt)] text-[var(--color-text)] focus:outline-2 focus:outline-[var(--color-primary)]"
                  >
                    <option value="all">
                      {t('books.portal.topicFilterAll', {
                        count: toPersianDigits(totalCount),
                      })}
                    </option>
                    {availableTopics.map((topic) => (
                      <option key={topic.id} value={String(topic.id)}>
                        {topic.name}
                      </option>
                    ))}
                  </select>
                </div>

                <form
                  onSubmit={handleSearchSubmit}
                  className="flex flex-wrap items-center gap-2 w-full lg:w-auto"
                >
                  <label htmlFor="books-portal-search" className="sr-only">
                    {t('books.portal.searchLabel')}
                  </label>
                  <div className="relative flex-1 min-w-[200px] sm:w-80">
                    <Search
                      className="w-4 h-4 text-[var(--color-muted)] absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none"
                      aria-hidden="true"
                    />
                    <input
                      id="books-portal-search"
                      type="search"
                      value={searchInput}
                      onChange={(e) => {
                        const val = e.target.value;
                        setSearchInput(val);
                        if (!val.trim()) {
                          setAppliedQuery('');
                        }
                      }}
                      placeholder={t('books.portal.searchPlaceholder')}
                      className="w-full min-h-[42px] pr-9 pl-3 py-2 text-xs sm:text-sm rounded-[var(--radius-control)] border border-[var(--color-border)] bg-[var(--color-surface-alt)] text-[var(--color-text)] focus:outline-2 focus:outline-[var(--color-primary)]"
                    />
                  </div>
                  <Button type="submit" variant="secondary" size="sm">
                    {t('liveSearch.button')}
                  </Button>
                  {hasFiltersActive && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={handleClearFilters}
                      startIcon={<X className="w-4 h-4" />}
                    >
                      {t('books.portal.searchClear')}
                    </Button>
                  )}
                </form>
              </div>

              <p className="text-xs text-[var(--color-muted)] tabular-nums-strict">
                {t('books.portal.resultsCount', {
                  count: toPersianDigits(portalData?.items.length ?? 0),
                })}
              </p>
            </section>

            {/* Empty State or Featured + Topic Shelves */}
            {!portalData || portalData.items.length === 0 ? (
              <section className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-card)] p-8 text-center space-y-4">
                <BookOpen className="w-10 h-10 text-[var(--color-muted)] mx-auto" aria-hidden="true" />
                <div className="space-y-1.5 max-w-md mx-auto">
                  <h2 className="text-base sm:text-lg font-bold text-[var(--color-text)]">
                    {t('books.portal.emptyTitle')}
                  </h2>
                  <p className="text-xs sm:text-sm text-[var(--color-muted)]">
                    {t('books.portal.emptyBody')}
                  </p>
                </div>
                <div className="flex flex-wrap items-center justify-center gap-2.5">
                  {hasFiltersActive && (
                    <Button variant="secondary" size="sm" onClick={handleClearFilters}>
                      {t('books.portal.searchClear')}
                    </Button>
                  )}
                  <Button variant="outline" size="sm" onClick={() => navigateToHash('/content')}>
                    {t('books.portal.emptyCatalogButton')}
                  </Button>
                </div>
              </section>
            ) : (
              <div className="space-y-9">
                {/* Featured Books Shelf */}
                {featuredBooks.length > 0 && (
                  <section className="space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-[var(--color-border)]">
                      <h2 className="text-lg sm:text-xl font-bold text-[var(--color-text)] flex items-center gap-2">
                        <Sparkles className="w-5 h-5 text-[var(--color-primary)] shrink-0" aria-hidden="true" />
                        <span>{t('books.portal.featuredSectionTitle')}</span>
                      </h2>
                      <span className="text-xs font-medium text-[var(--color-muted)] tabular-nums-strict">
                        {t('books.portal.shelf.countLabel', {
                          count: toPersianDigits(featuredBooks.length),
                        })}
                      </span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5 items-stretch">
                      {featuredBooks.map((entry) => (
                        <BookShowcaseCard
                          key={`featured-${entry.item.id}`}
                          entry={entry}
                          thumbnailUrl={thumbUrls[entry.item.id]}
                        />
                      ))}
                    </div>
                  </section>
                )}

                {/* Topic Shelves */}
                {portalData.shelves.map((shelf) => (
                  <section key={shelf.id} className="space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-[var(--color-border)]">
                      <h2 className="text-lg sm:text-xl font-bold text-[var(--color-text)]">
                        {t('books.portal.shelf.topicPrefix', { topic: shelf.topic.name })}
                      </h2>
                      <span className="text-xs font-medium text-[var(--color-muted)] tabular-nums-strict">
                        {t('books.portal.shelf.countLabel', {
                          count: toPersianDigits(shelf.items.length),
                        })}
                      </span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5 items-stretch">
                      {shelf.items.map((entry) => (
                        <BookShowcaseCard
                          key={`${shelf.id}-${entry.item.id}`}
                          entry={entry}
                          thumbnailUrl={thumbUrls[entry.item.id]}
                        />
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </MainLayout>
  );
}
