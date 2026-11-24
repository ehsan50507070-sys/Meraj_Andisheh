import {
  Clock,
  Film as FilmIcon,
  Play,
  Search,
  Sparkles,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import type {
  FilmKind,
  FilmPortalData,
  FilmPortalItem,
  FilmPortalShelf,
} from '../../core/domain/portals';
import { useAuth } from '../auth/AuthContext';
import { Button } from '../components/ui';
import { useAge } from '../context/AgeContext';
import { usePageMeta } from '../hooks/usePageMeta';
import { MainLayout } from '../layouts/MainLayout';
import type { ResourceKey } from '../resources/fa';
import { toPersianDigits } from '../resources/formatters';
import { t } from '../resources/i18n';
import { navigateToHash } from '../router/HashRouter';
import { appContainer } from '../services/appContainer';
import { NotFoundPage } from './NotFoundPage';

export interface FilmsPortalPageProps {
  currentRoute: string;
}

type KindFilterValue = 'all' | FilmKind;

function resolveDurationMinutes(entry: FilmPortalItem): number {
  if (typeof entry.filmInfo.runtimeMinutes === 'number' && entry.filmInfo.runtimeMinutes > 0) {
    return entry.filmInfo.runtimeMinutes;
  }
  if (typeof entry.item.readWatchMinutes === 'number' && entry.item.readWatchMinutes > 0) {
    return entry.item.readWatchMinutes;
  }
  return 0;
}

function getKindLabelKey(kind: FilmKind): ResourceKey {
  switch (kind) {
    case 'Documentary':
      return 'films.kind.Documentary';
    case 'Animation':
      return 'films.kind.Animation';
    case 'Film':
    default:
      return 'films.kind.Film';
  }
}

function getShelfTitle(shelf: FilmPortalShelf): string {
  if (shelf.shelfType === 'kind' && shelf.filmKind) {
    return t(`films.portal.shelf.kind.${shelf.filmKind}` as ResourceKey);
  }
  if (shelf.shelfType === 'topic' && shelf.topic) {
    return t('films.portal.shelf.topicPrefix', { topic: shelf.topic.name });
  }
  return '';
}

interface FilmShowcaseCardProps {
  entry: FilmPortalItem;
  thumbnailUrl?: string;
}

function FilmShowcaseCard({ entry, thumbnailUrl }: FilmShowcaseCardProps) {
  const [imgError, setImgError] = useState(false);
  const showFallback = !thumbnailUrl || imgError;
  const durationMinutes = resolveDurationMinutes(entry);
  const topicLabel = entry.primaryTopicName ?? t('catalog.generalTopic');

  return (
    <button
      type="button"
      onClick={() => navigateToHash(`/films/${encodeURIComponent(entry.item.slug)}`)}
      className="group w-full h-full text-right bg-[var(--color-surface)] border border-[var(--color-border)] hover:border-[var(--color-border-strong)] rounded-[var(--radius-card)] shadow-[var(--shadow-card)] overflow-hidden flex flex-col transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary)]"
    >
      <div className="aspect-video w-full overflow-hidden bg-[var(--color-surface-alt)] border-b border-[var(--color-border)] relative">
        {showFallback ? (
          <div className="w-full h-full flex flex-col items-center justify-center gap-2 p-4 text-[var(--color-muted)] bg-[var(--color-surface-alt)]">
            <FilmIcon className="w-8 h-8 opacity-75" aria-hidden="true" />
            <span className="text-xs font-medium text-center line-clamp-1">
              {t(getKindLabelKey(entry.filmInfo.kind))}
            </span>
          </div>
        ) : (
          <img
            src={thumbnailUrl}
            alt={entry.item.title}
            referrerPolicy="no-referrer"
            onError={() => setImgError(true)}
            className="w-full h-full object-cover transition-transform duration-200 group-hover:scale-[1.02]"
          />
        )}
      </div>

      <div className="p-4 sm:p-5 flex-1 flex flex-col justify-between gap-3 text-right">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[var(--color-muted)] tabular-nums-strict">
            <span className="font-semibold text-[var(--color-primary)]">
              {t(getKindLabelKey(entry.filmInfo.kind))}
            </span>
            {entry.filmInfo.releaseYear !== null && (
              <>
                <span aria-hidden="true">·</span>
                <span>
                  {t('films.portal.card.yearValue', {
                    year: toPersianDigits(entry.filmInfo.releaseYear),
                  })}
                </span>
              </>
            )}
            <span aria-hidden="true">·</span>
            <span>{topicLabel}</span>
          </div>

          <h3 className="text-base font-bold text-[var(--color-text)] leading-snug line-clamp-2">
            {entry.item.title}
          </h3>

          {entry.item.summary && (
            <p className="text-xs sm:text-sm text-[var(--color-muted)] leading-relaxed line-clamp-2">
              {entry.item.summary}
            </p>
          )}
        </div>

        <div className="pt-3 border-t border-[var(--color-border)] flex items-center justify-between gap-2 text-xs text-[var(--color-muted)] tabular-nums-strict">
          <span className="inline-flex items-center gap-1.5">
            <Clock className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
            <span>
              {t('films.portal.card.durationValue', {
                minutes: toPersianDigits(durationMinutes),
              })}
            </span>
          </span>
          <span className="inline-flex items-center gap-1 font-semibold text-[var(--color-primary)]">
            <Play className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
            <span>{t('films.portal.watchNowAction')}</span>
          </span>
        </div>
      </div>
    </button>
  );
}

export function FilmsPortalPage({ currentRoute }: FilmsPortalPageProps) {
  const { siteTitle, isFilmsEnabled, isAuthReady } = useAuth();
  const { effectiveAgeGroup, isAgeReady } = useAge();

  usePageMeta({
    currentRoute,
    siteTitle,
    description: t('films.portal.subtitle'),
  });

  const [portalData, setPortalData] = useState<FilmPortalData | null>(null);
  const [isDisabled, setIsDisabled] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedKind, setSelectedKind] = useState<KindFilterValue>('all');
  const [searchInput, setSearchInput] = useState('');
  const [appliedQuery, setAppliedQuery] = useState('');
  const [thumbUrls, setThumbUrls] = useState<Record<number, string>>({});

  useEffect(() => {
    if (!isAgeReady || !isAuthReady) {
      return;
    }

    if (!isFilmsEnabled) {
      setIsDisabled(true);
      setIsLoading(false);
      return;
    }

    let active = true;
    const loadPortal = async () => {
      setIsLoading(true);
      try {
        await appContainer.ensureInitializedAtStartup();
        const res = await appContainer.filmPortalService.getFilmPortalDataAsync(
          effectiveAgeGroup,
          {
            kind: selectedKind,
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
  }, [appliedQuery, effectiveAgeGroup, isAgeReady, isAuthReady, isFilmsEnabled, selectedKind]);

  const thumbLoadKey = useMemo(() => {
    if (!portalData) return '';
    const allEntries: FilmPortalItem[] = [
      ...(portalData.weeklyPick ? [portalData.weeklyPick] : []),
      ...portalData.items,
    ];
    return allEntries
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
    if (portalData.weeklyPick?.item.thumbnailKey) {
      uniqueEntries.set(portalData.weeklyPick.item.id, portalData.weeklyPick.item.thumbnailKey);
    }
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
    setSelectedKind('all');
    setSearchInput('');
    setAppliedQuery('');
  };

  if (!isAgeReady || !isAuthReady) {
    return (
      <MainLayout currentRoute={currentRoute}>
        <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 py-10">
          <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-card)] p-8 text-center text-sm text-[var(--color-muted)]">
            {t('films.portal.loading')}
          </div>
        </div>
      </MainLayout>
    );
  }

  if (!isFilmsEnabled || isDisabled) {
    return <NotFoundPage currentRoute={currentRoute} />;
  }

  const weeklyPick = portalData?.weeklyPick ?? null;
  const counts = portalData?.countsByKind ?? { Film: 0, Documentary: 0, Animation: 0 };
  const totalCount = portalData?.allAllowedFilmsCount ?? 0;

  const filterTabs: ReadonlyArray<{ id: KindFilterValue; label: string }> = [
    {
      id: 'all',
      label: t('films.portal.filterAll', { count: toPersianDigits(totalCount) }),
    },
    {
      id: 'Documentary',
      label: t('films.portal.filterDocumentary', {
        count: toPersianDigits(counts.Documentary),
      }),
    },
    {
      id: 'Film',
      label: t('films.portal.filterFilm', { count: toPersianDigits(counts.Film) }),
    },
    {
      id: 'Animation',
      label: t('films.portal.filterAnimation', { count: toPersianDigits(counts.Animation) }),
    },
  ];

  const weeklyDuration = weeklyPick ? resolveDurationMinutes(weeklyPick) : 0;

  return (
    <MainLayout currentRoute={currentRoute}>
      <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 py-6 sm:py-8 space-y-6 sm:space-y-8">
        {/* Page Heading */}
        <header className="pb-5 border-b border-[var(--color-border)] flex flex-wrap items-end justify-between gap-4">
          <div className="space-y-2 max-w-3xl">
            <div className="flex items-center gap-2 text-xs font-semibold text-[var(--color-primary)]">
              <FilmIcon className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span>{t('films.portal.badge')}</span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-bold text-[var(--color-text)] text-balance">
              {t('films.portal.title')}
            </h1>
            <p className="text-sm sm:text-base text-[var(--color-muted)] leading-relaxed">
              {t('films.portal.subtitle')}
            </p>
          </div>
        </header>

        {isLoading && !portalData ? (
          <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-card)] p-8 text-center text-sm text-[var(--color-muted)]">
            {t('films.portal.loading')}
          </div>
        ) : (
          <>
            {/* Weekly Pick Hero Card */}
            {weeklyPick && (
              <section
                aria-labelledby="weekly-pick-heading"
                className="bg-[var(--color-surface)] border border-[var(--color-border-strong)] rounded-[var(--radius-card)] shadow-[var(--shadow-card)] overflow-hidden"
              >
                <div className="grid grid-cols-1 lg:grid-cols-12 items-stretch">
                  <div className="lg:col-span-5 aspect-video lg:aspect-auto bg-[var(--color-surface-alt)] border-b lg:border-b-0 lg:border-l border-[var(--color-border)] overflow-hidden min-h-[220px]">
                    {thumbUrls[weeklyPick.item.id] ? (
                      <img
                        src={thumbUrls[weeklyPick.item.id]}
                        alt={weeklyPick.item.title}
                        referrerPolicy="no-referrer"
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full flex flex-col items-center justify-center gap-3 p-6 text-[var(--color-muted)]">
                        <FilmIcon className="w-12 h-12 opacity-70" aria-hidden="true" />
                        <span className="text-sm font-medium">
                          {t(getKindLabelKey(weeklyPick.filmInfo.kind))}
                        </span>
                      </div>
                    )}
                  </div>

                  <div className="lg:col-span-7 p-5 sm:p-8 flex flex-col justify-between gap-5">
                    <div className="space-y-3">
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs sm:text-sm text-[var(--color-muted)] tabular-nums-strict">
                        <span className="inline-flex items-center gap-1.5 font-bold text-[var(--color-primary)]">
                          <Sparkles className="w-4 h-4 shrink-0" aria-hidden="true" />
                          <span>{t('films.portal.weeklyPickLabel')}</span>
                        </span>
                        <span aria-hidden="true">·</span>
                        <span>{t(getKindLabelKey(weeklyPick.filmInfo.kind))}</span>
                        {weeklyPick.filmInfo.releaseYear !== null && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span>
                              {t('films.portal.card.yearValue', {
                                year: toPersianDigits(weeklyPick.filmInfo.releaseYear),
                              })}
                            </span>
                          </>
                        )}
                        <span aria-hidden="true">·</span>
                        <span>
                          {t('films.portal.card.durationValue', {
                            minutes: toPersianDigits(weeklyDuration),
                          })}
                        </span>
                        {weeklyPick.primaryTopicName && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span>{weeklyPick.primaryTopicName}</span>
                          </>
                        )}
                      </div>

                      <h2
                        id="weekly-pick-heading"
                        className="text-xl sm:text-2xl font-bold text-[var(--color-text)] leading-snug"
                      >
                        {weeklyPick.item.title}
                      </h2>

                      <p className="text-sm sm:text-base text-[var(--color-muted)] leading-relaxed">
                        {weeklyPick.item.summary}
                      </p>

                      {weeklyPick.filmInfo.ageRatingNote && (
                        <p className="text-xs sm:text-sm text-[var(--color-text)] bg-[var(--color-surface-alt)] border border-[var(--color-border)] rounded-[var(--radius-control)] px-3.5 py-2.5">
                          <span className="font-semibold text-[var(--color-primary)]">
                            {t('filmDetail.meta.ageNoteHeading')}:{' '}
                          </span>
                          <span>{weeklyPick.filmInfo.ageRatingNote}</span>
                        </p>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-3 pt-1">
                      <Button
                        variant="primary"
                        onClick={() =>
                          navigateToHash(`/films/${encodeURIComponent(weeklyPick.item.slug)}`)
                        }
                        startIcon={<Play className="w-4 h-4" />}
                      >
                        {t('films.portal.watchNowAction')}
                      </Button>
                    </div>
                  </div>
                </div>
              </section>
            )}

            {/* Filter Tabs & Search Bar */}
            <section className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-card)] p-4 sm:p-5 space-y-4">
              <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                <div
                  role="tablist"
                  aria-label={t('films.portal.filterAriaLabel')}
                  className="flex flex-wrap items-center gap-2"
                >
                  {filterTabs.map((tab) => {
                    const isActive = selectedKind === tab.id;
                    return (
                      <button
                        key={tab.id}
                        type="button"
                        role="tab"
                        aria-selected={isActive}
                        onClick={() => setSelectedKind(tab.id)}
                        className={`min-h-[40px] px-3.5 py-2 text-xs sm:text-sm font-semibold rounded-[var(--radius-control)] border transition-colors whitespace-nowrap tabular-nums-strict ${
                          isActive
                            ? 'bg-[var(--color-primary-button)] text-[var(--color-on-primary)] border-transparent'
                            : 'bg-[var(--color-surface-alt)] text-[var(--color-text)] border-[var(--color-border)] hover:border-[var(--color-border-strong)]'
                        }`}
                      >
                        {tab.label}
                      </button>
                    );
                  })}
                </div>

                <form
                  onSubmit={handleSearchSubmit}
                  className="flex flex-wrap items-center gap-2 w-full lg:w-auto"
                >
                  <label htmlFor="films-portal-search" className="sr-only">
                    {t('films.portal.searchLabel')}
                  </label>
                  <div className="relative flex-1 min-w-[200px] sm:w-72">
                    <Search
                      className="w-4 h-4 text-[var(--color-muted)] absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none"
                      aria-hidden="true"
                    />
                    <input
                      id="films-portal-search"
                      type="search"
                      value={searchInput}
                      onChange={(e) => {
                        const val = e.target.value;
                        setSearchInput(val);
                        if (!val.trim()) {
                          setAppliedQuery('');
                        }
                      }}
                      placeholder={t('films.portal.searchPlaceholder')}
                      className="w-full min-h-[42px] pr-9 pl-3 py-2 text-xs sm:text-sm rounded-[var(--radius-control)] border border-[var(--color-border)] bg-[var(--color-surface-alt)] text-[var(--color-text)] focus:outline-2 focus:outline-[var(--color-primary)]"
                    />
                  </div>
                  <Button type="submit" variant="secondary" size="sm">
                    {t('liveSearch.button')}
                  </Button>
                  {(selectedKind !== 'all' || appliedQuery.length > 0) && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={handleClearFilters}
                      startIcon={<X className="w-4 h-4" />}
                    >
                      {t('films.portal.searchClear')}
                    </Button>
                  )}
                </form>
              </div>

              <p className="text-xs text-[var(--color-muted)] tabular-nums-strict">
                {t('films.portal.resultsCount', {
                  count: toPersianDigits(portalData?.items.length ?? 0),
                })}
              </p>
            </section>

            {/* Empty State or Categorized Shelves */}
            {!portalData || portalData.items.length === 0 ? (
              <section className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-card)] p-8 text-center space-y-4">
                <FilmIcon className="w-10 h-10 text-[var(--color-muted)] mx-auto" aria-hidden="true" />
                <div className="space-y-1.5 max-w-md mx-auto">
                  <h2 className="text-base sm:text-lg font-bold text-[var(--color-text)]">
                    {t('films.portal.emptyTitle')}
                  </h2>
                  <p className="text-xs sm:text-sm text-[var(--color-muted)]">
                    {t('films.portal.emptyBody')}
                  </p>
                </div>
                <div className="flex flex-wrap items-center justify-center gap-2.5">
                  {(selectedKind !== 'all' || appliedQuery.length > 0) && (
                    <Button variant="secondary" size="sm" onClick={handleClearFilters}>
                      {t('films.portal.searchClear')}
                    </Button>
                  )}
                  <Button variant="outline" size="sm" onClick={() => navigateToHash('/content')}>
                    {t('films.portal.emptyCatalogButton')}
                  </Button>
                </div>
              </section>
            ) : (
              <div className="space-y-8">
                {portalData.shelves.map((shelf) => (
                  <section key={shelf.id} className="space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-[var(--color-border)]">
                      <h2 className="text-lg sm:text-xl font-bold text-[var(--color-text)]">
                        {getShelfTitle(shelf)}
                      </h2>
                      <span className="text-xs font-medium text-[var(--color-muted)] tabular-nums-strict">
                        {t('films.portal.shelf.countLabel', {
                          count: toPersianDigits(shelf.items.length),
                        })}
                      </span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5 items-stretch">
                      {shelf.items.map((entry) => (
                        <FilmShowcaseCard
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
