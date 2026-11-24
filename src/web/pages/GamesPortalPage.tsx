import {
  Gamepad2,
  Play,
  Search,
  Trophy,
  Users,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import type {
  GamePortalData,
  GamePortalItemSummary,
} from '../../core/domain/games';
import type { AgeGroup } from '../../core/domain/taxonomy';
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

export interface GamesPortalPageProps {
  currentRoute: string;
}

interface GameShowcaseCardProps {
  entry: GamePortalItemSummary;
  thumbnailUrl?: string;
  ageNameById: ReadonlyMap<number, string>;
}

function GameShowcaseCard({
  entry,
  thumbnailUrl,
  ageNameById,
}: GameShowcaseCardProps) {
  const [imgError, setImgError] = useState(false);
  const showFallback = !thumbnailUrl || imgError;
  const topicLabel = entry.topicName ?? t('catalog.generalTopic');

  const ageLabel = useMemo(() => {
    if (entry.ageGroupIds.length === 0) {
      return t('games.portal.allAgesBadge');
    }
    return entry.ageGroupIds
      .map((id) => ageNameById.get(id))
      .filter((name): name is string => Boolean(name))
      .join(t('homePreview.targetListSeparator'));
  }, [ageNameById, entry.ageGroupIds]);

  return (
    <button
      type="button"
      onClick={() =>
        navigateToHash(`/games/${encodeURIComponent(entry.game.slug)}`)
      }
      className="group w-full h-full text-right bg-[var(--color-surface)] border border-[var(--color-border)] hover:border-[var(--color-border-strong)] rounded-[var(--radius-card)] shadow-[var(--shadow-card)] overflow-hidden flex flex-col transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary)]"
    >
      <div className="aspect-video w-full overflow-hidden bg-[var(--color-surface-alt)] border-b border-[var(--color-border)] relative">
        {showFallback ? (
          <div className="w-full h-full flex flex-col items-center justify-center gap-2 p-4 text-[var(--color-muted)] bg-[var(--color-surface-alt)]">
            <Gamepad2 className="w-10 h-10 text-[var(--color-primary)] opacity-85" aria-hidden="true" />
            <span className="text-xs font-medium text-center line-clamp-1">
              {topicLabel}
            </span>
          </div>
        ) : (
          <img
            src={thumbnailUrl}
            alt={entry.game.title}
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
              {topicLabel}
            </span>
            <span aria-hidden="true">·</span>
            <span>{ageLabel}</span>
            <span aria-hidden="true">·</span>
            <span>
              {t('games.portal.maxScoreBadge', {
                score: toPersianDigits(entry.game.maxScore),
              })}
            </span>
          </div>

          <h3 className="text-base font-bold text-[var(--color-text)] leading-snug line-clamp-2">
            {entry.game.title}
          </h3>

          {entry.game.description && (
            <p className="text-xs sm:text-sm text-[var(--color-muted)] leading-relaxed line-clamp-2">
              {entry.game.description}
            </p>
          )}
        </div>

        <div className="pt-3 border-t border-[var(--color-border)] flex items-center justify-between gap-2 text-xs text-[var(--color-muted)] tabular-nums-strict">
          <div className="flex items-center gap-3 min-w-0">
            <span className="inline-flex items-center gap-1">
              <Users className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
              <span>
                {t('games.portal.playersCountLabel', {
                  count: toPersianDigits(entry.playersCount),
                })}
              </span>
            </span>
            <span className="inline-flex items-center gap-1 truncate">
              <Trophy className="w-3.5 h-3.5 shrink-0 text-[var(--color-accent)]" aria-hidden="true" />
              <span className="truncate">
                {entry.topScore !== null
                  ? t('games.portal.topScoreLabel', {
                      score: toPersianDigits(entry.topScore),
                    })
                  : t('games.portal.noRecordYet')}
              </span>
            </span>
          </div>

          <span className="inline-flex items-center gap-1 font-semibold text-[var(--color-primary)] shrink-0">
            <Play className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
            <span>{t('games.portal.openAction')}</span>
          </span>
        </div>
      </div>
    </button>
  );
}

export function GamesPortalPage({ currentRoute }: GamesPortalPageProps) {
  const { siteTitle, isGamesEnabled, isAuthReady } = useAuth();
  const { effectiveAgeGroup, activeAgeGroups, isAgeReady } = useAge();

  usePageMeta({
    currentRoute,
    siteTitle,
    description: t('games.portal.subtitle'),
  });

  const [portalData, setPortalData] = useState<GamePortalData | null>(null);
  const [isDisabled, setIsDisabled] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedTopicId, setSelectedTopicId] = useState<'all' | number>('all');
  const [selectedAgeFilterId, setSelectedAgeFilterId] = useState<'all' | number>('all');
  const [searchInput, setSearchInput] = useState('');
  const [appliedQuery, setAppliedQuery] = useState('');
  const [thumbUrls, setThumbUrls] = useState<Record<number, string>>({});

  const isChildActive = effectiveAgeGroup?.key === 'child';

  useEffect(() => {
    if (isChildActive && selectedAgeFilterId !== 'all') {
      setSelectedAgeFilterId('all');
    }
  }, [isChildActive, selectedAgeFilterId]);

  const ageNameById = useMemo(() => {
    const map = new Map<number, string>();
    for (const ag of activeAgeGroups) {
      map.set(ag.id, ag.name);
    }
    return map;
  }, [activeAgeGroups]);

  const selectableAgeGroups: AgeGroup[] = useMemo(() => {
    if (isChildActive && effectiveAgeGroup) {
      return [effectiveAgeGroup];
    }
    return activeAgeGroups;
  }, [activeAgeGroups, effectiveAgeGroup, isChildActive]);

  useEffect(() => {
    if (!isAgeReady || !isAuthReady) {
      return;
    }

    if (!isGamesEnabled) {
      setIsDisabled(true);
      setIsLoading(false);
      return;
    }

    let active = true;
    const loadGamesPortal = async () => {
      setIsLoading(true);
      try {
        await appContainer.ensureInitializedAtStartup();
        const res = await appContainer.gamePortalService.getGamesPortalDataAsync(
          effectiveAgeGroup,
          {
            topicId: selectedTopicId,
            ageGroupId: selectedAgeFilterId,
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

    void loadGamesPortal();
    return () => {
      active = false;
    };
  }, [
    appliedQuery,
    effectiveAgeGroup,
    isAgeReady,
    isAuthReady,
    isGamesEnabled,
    selectedAgeFilterId,
    selectedTopicId,
  ]);

  const thumbLoadKey = useMemo(() => {
    if (!portalData) return '';
    return portalData.items
      .map((entry) => `${entry.game.id}:${entry.game.thumbnailKey ?? ''}`)
      .join('|');
  }, [portalData]);

  useEffect(() => {
    if (!portalData || !thumbLoadKey) {
      setThumbUrls({});
      return;
    }

    let active = true;
    const createdUrls: string[] = [];

    const loadThumbs = async () => {
      const next: Record<number, string> = {};
      await Promise.all(
        portalData.items.map(async (entry) => {
          const key = entry.game.thumbnailKey;
          if (!key) return;
          const res = await appContainer.fileUploadService.openPublicMediaAsync(key);
          if (!active || !res.ok || !res.bytes || !res.metadata) return;
          const copy = new Uint8Array(res.bytes.byteLength);
          copy.set(res.bytes);
          const blob = new Blob([copy.buffer], { type: res.metadata.mimeType });
          const url = URL.createObjectURL(blob);
          createdUrls.push(url);
          next[entry.game.id] = url;
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
    setSelectedAgeFilterId('all');
    setSearchInput('');
    setAppliedQuery('');
  };

  if (!isAgeReady || !isAuthReady) {
    return (
      <MainLayout currentRoute={currentRoute}>
        <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 py-10">
          <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-card)] p-8 text-center text-sm text-[var(--color-muted)]">
            {t('games.portal.loading')}
          </div>
        </div>
      </MainLayout>
    );
  }

  if (!isGamesEnabled || isDisabled) {
    return <NotFoundPage currentRoute={currentRoute} />;
  }

  const hasFilters =
    selectedTopicId !== 'all' ||
    selectedAgeFilterId !== 'all' ||
    appliedQuery.length > 0;

  return (
    <MainLayout currentRoute={currentRoute}>
      <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 py-6 sm:py-8 space-y-6 sm:space-y-8">
        <header className="pb-5 border-b border-[var(--color-border)] flex flex-wrap items-end justify-between gap-4">
          <div className="space-y-2 max-w-3xl">
            <div className="flex items-center gap-2 text-xs font-semibold text-[var(--color-primary)]">
              <Gamepad2 className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span>{t('games.portal.badge')}</span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-bold text-[var(--color-text)] text-balance">
              {t('games.portal.title')}
            </h1>
            <p className="text-sm sm:text-base text-[var(--color-muted)] leading-relaxed">
              {t('games.portal.subtitle')}
            </p>
          </div>
        </header>

        {/* Filter Bar */}
        <section className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-card)] p-4 sm:p-5 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end">
            <div className="md:col-span-3 space-y-1">
              <label
                htmlFor="games-portal-topic-filter"
                className="block text-xs font-medium text-[var(--color-muted)]"
              >
                {t('games.portal.topicFilterLabel')}
              </label>
              <select
                id="games-portal-topic-filter"
                value={selectedTopicId === 'all' ? 'all' : String(selectedTopicId)}
                onChange={(e) => {
                  const val = e.target.value;
                  setSelectedTopicId(val === 'all' ? 'all' : Number(val));
                }}
                className="w-full min-h-[42px] px-3 py-2 text-xs sm:text-sm rounded-[var(--radius-control)] border border-[var(--color-border)] bg-[var(--color-surface-alt)] text-[var(--color-text)] focus:outline-2 focus:outline-[var(--color-primary)]"
              >
                <option value="all">{t('games.portal.allTopicsFilter')}</option>
                {(portalData?.availableTopics ?? []).map((topic) => (
                  <option key={topic.id} value={String(topic.id)}>
                    {topic.name}
                  </option>
                ))}
              </select>
            </div>

            {!isChildActive && selectableAgeGroups.length > 0 && (
              <div className="md:col-span-3 space-y-1">
                <label
                  htmlFor="games-portal-age-filter"
                  className="block text-xs font-medium text-[var(--color-muted)]"
                >
                  {t('games.portal.ageFilterLabel')}
                </label>
                <select
                  id="games-portal-age-filter"
                  value={
                    selectedAgeFilterId === 'all'
                      ? 'all'
                      : String(selectedAgeFilterId)
                  }
                  onChange={(e) => {
                    const val = e.target.value;
                    setSelectedAgeFilterId(val === 'all' ? 'all' : Number(val));
                  }}
                  className="w-full min-h-[42px] px-3 py-2 text-xs sm:text-sm rounded-[var(--radius-control)] border border-[var(--color-border)] bg-[var(--color-surface-alt)] text-[var(--color-text)] focus:outline-2 focus:outline-[var(--color-primary)]"
                >
                  <option value="all">{t('games.portal.allAgeGroupsFilter')}</option>
                  {selectableAgeGroups.map((ag) => (
                    <option key={ag.id} value={String(ag.id)}>
                      {ag.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <form
              onSubmit={handleSearchSubmit}
              className={`${
                isChildActive ? 'md:col-span-9' : 'md:col-span-6'
              } flex flex-wrap items-center gap-2`}
            >
              <label htmlFor="games-portal-search" className="sr-only">
                {t('games.portal.searchLabel')}
              </label>
              <div className="relative flex-1 min-w-[200px]">
                <Search
                  className="w-4 h-4 text-[var(--color-muted)] absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none"
                  aria-hidden="true"
                />
                <input
                  id="games-portal-search"
                  type="search"
                  value={searchInput}
                  onChange={(e) => {
                    const val = e.target.value;
                    setSearchInput(val);
                    if (!val.trim()) {
                      setAppliedQuery('');
                    }
                  }}
                  placeholder={t('games.portal.searchPlaceholder')}
                  className="w-full min-h-[42px] pr-9 pl-3 py-2 text-xs sm:text-sm rounded-[var(--radius-control)] border border-[var(--color-border)] bg-[var(--color-surface-alt)] text-[var(--color-text)] focus:outline-2 focus:outline-[var(--color-primary)]"
                />
              </div>
              <Button type="submit" variant="secondary" size="sm">
                {t('liveSearch.button')}
              </Button>
              {hasFilters && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={handleClearFilters}
                  startIcon={<X className="w-4 h-4" />}
                >
                  {t('games.portal.searchClear')}
                </Button>
              )}
            </form>
          </div>

          <p className="text-xs text-[var(--color-muted)] tabular-nums-strict">
            {t('games.portal.resultsCount', {
              count: toPersianDigits(portalData?.items.length ?? 0),
            })}
          </p>
        </section>

        {/* Games Grid */}
        {isLoading && !portalData ? (
          <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-card)] p-8 text-center text-sm text-[var(--color-muted)]">
            {t('games.portal.loading')}
          </div>
        ) : !portalData || portalData.items.length === 0 ? (
          <section className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-card)] p-8 text-center space-y-4">
            <Gamepad2 className="w-10 h-10 text-[var(--color-muted)] mx-auto" aria-hidden="true" />
            <div className="space-y-1.5 max-w-md mx-auto">
              <h2 className="text-base sm:text-lg font-bold text-[var(--color-text)]">
                {t('games.portal.emptyTitle')}
              </h2>
              <p className="text-xs sm:text-sm text-[var(--color-muted)]">
                {t('games.portal.emptyBody')}
              </p>
            </div>
            <div className="flex flex-wrap items-center justify-center gap-2.5">
              {hasFilters && (
                <Button variant="secondary" size="sm" onClick={handleClearFilters}>
                  {t('games.portal.searchClear')}
                </Button>
              )}
              <Button variant="outline" size="sm" onClick={() => navigateToHash('/content')}>
                {t('games.portal.emptyCatalogButton')}
              </Button>
            </div>
          </section>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5 items-stretch">
            {portalData.items.map((entry) => (
              <GameShowcaseCard
                key={entry.game.id}
                entry={entry}
                thumbnailUrl={thumbUrls[entry.game.id]}
                ageNameById={ageNameById}
              />
            ))}
          </div>
        )}
      </div>
    </MainLayout>
  );
}
