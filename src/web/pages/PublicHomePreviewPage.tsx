import { BookOpen, SlidersHorizontal, Sparkles } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import {
  applyAgeGroupRulesWithMeta,
  type AgePriorityGroup,
} from '../../core/services/ageRuleService';
import type { PublicContentSummary } from '../../core/services/contentManagementService';
import { resolveThemeKey, type ThemeKey } from '../../core/services/themeService';
import { useAge } from '../context/AgeContext';
import { Alert, ContentCard, Button } from '../components/ui';
import { MainLayout } from '../layouts/MainLayout';
import { formatAgeGroupRange } from '../resources/ageGroupFormatters';
import { toPersianDigits } from '../resources/formatters';
import type { ResourceKey } from '../resources/fa';
import { t } from '../resources/i18n';
import { navigateToHash } from '../router/HashRouter';
import { appContainer } from '../services/appContainer';

interface PublicHomePreviewPageProps {
  currentRoute: string;
}

function getThemeNameKey(theme: ThemeKey): ResourceKey {
  switch (theme) {
    case 'playful':
      return 'theme.playful.name';
    case 'modern':
      return 'theme.modern.name';
    case 'editorial':
    default:
      return 'theme.editorial.name';
  }
}

function getPriorityLabelKey(priorityGroup: AgePriorityGroup): ResourceKey {
  switch (priorityGroup) {
    case 1:
      return 'homePreview.priorityGroup1';
    case 2:
      return 'homePreview.priorityGroup2';
    case 3:
    default:
      return 'homePreview.priorityGroup3';
  }
}

export function PublicHomePreviewPage({ currentRoute }: PublicHomePreviewPageProps) {
  const {
    activeAgeGroups,
    effectiveAgeGroup,
    ageSource,
    openAgeSelector,
  } = useAge();

  const [entries, setEntries] = useState<PublicContentSummary[]>([]);
  const [thumbnailUrls, setThumbnailUrls] = useState<Record<number, string>>({});
  const [isLoading, setIsLoading] = useState<boolean>(true);

  useEffect(() => {
    let active = true;
    const createdUrls: string[] = [];

    const loadPublished = async () => {
      setIsLoading(true);
      try {
        await appContainer.ensureInitializedAtStartup();
        const published =
          await appContainer.contentManagementService.listPublicPublishedWithAudience();
        if (!active) {
          return;
        }
        setEntries(published);

        const nextUrls: Record<number, string> = {};
        await Promise.all(
          published.map(async (entry) => {
            if (!entry.item.thumbnailKey) {
              return;
            }
            const media = await appContainer.fileUploadService.openPublicMediaAsync(
              entry.item.thumbnailKey,
            );
            if (!active || !media.ok || !media.bytes || !media.metadata) {
              return;
            }
            const copy = new Uint8Array(media.bytes.byteLength);
            copy.set(media.bytes);
            const blob = new Blob([copy.buffer], { type: media.metadata.mimeType });
            const url = URL.createObjectURL(blob);
            createdUrls.push(url);
            nextUrls[entry.item.id] = url;
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

    void loadPublished();

    return () => {
      active = false;
      for (const url of createdUrls) {
        URL.revokeObjectURL(url);
      }
    };
  }, []);

  const ageGroupNameById = useMemo(
    () => new Map<number, string>(activeAgeGroups.map((group) => [group.id, group.name])),
    [activeAgeGroups],
  );

  const prioritized = useMemo(() => {
    return applyAgeGroupRulesWithMeta(
      entries.map((entry) => ({
        item: entry,
        ageGroupIds: entry.ageGroupIds,
        publishedAt: entry.item.publishedAt,
        createdAt: entry.item.createdAt,
        id: entry.item.id,
      })),
      effectiveAgeGroup,
    );
  }, [entries, effectiveAgeGroup]);

  const activeThemeKey = resolveThemeKey(effectiveAgeGroup?.themeKey ?? 'editorial');
  const showAccountDeletedBanner = useMemo(() => {
    const qIdx = currentRoute.indexOf('?');
    if (qIdx === -1) {
      return false;
    }
    const params = new URLSearchParams(currentRoute.slice(qIdx + 1));
    return params.get('accountDeleted') === '1';
  }, [currentRoute]);

  const sourceText =
    ageSource === 'profile'
      ? t('homePreview.activeSourceProfile')
      : ageSource === 'cookie'
        ? t('homePreview.activeSourceCookie')
        : t('homePreview.activeSourceNone');

  return (
    <MainLayout currentRoute={currentRoute}>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8 space-y-6 sm:space-y-8">
        {showAccountDeletedBanner && (
          <Alert
            variant="success"
            title={t('home.accountDeletedBannerTitle')}
            message={t('home.accountDeletedBannerBody')}
            onDismiss={() => navigateToHash('/')}
          />
        )}

        {/* Public Hero & Effective Age Summary */}
        <section className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-card)] shadow-[var(--shadow-card)] p-5 sm:p-7 space-y-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="space-y-2 max-w-3xl">
              <p className="text-xs font-semibold text-[var(--color-primary)]">
                {t('homePreview.badge')}
              </p>
              <h1 className="text-xl sm:text-3xl font-bold text-[var(--color-text)] tracking-tight text-balance">
                {t('homePreview.title')}
              </h1>
              <p className="text-sm sm:text-base text-[var(--color-muted)] leading-relaxed">
                {t('homePreview.subtitle')}
              </p>
            </div>

            <Button
              variant="primary"
              onClick={openAgeSelector}
              startIcon={<Sparkles className="w-4 h-4" />}
            >
              {t('homePreview.changeAgeButton')}
            </Button>
          </div>

          <div className="pt-4 border-t border-[var(--color-border)] grid grid-cols-1 md:grid-cols-3 gap-4 text-xs sm:text-sm">
            <div className="p-3.5 rounded-[var(--radius-control)] bg-[var(--color-surface-alt)] border border-[var(--color-border)] space-y-1">
              <p className="text-[var(--color-muted)]">{t('homePreview.activeAgeLabel')}</p>
              <p className="font-bold text-[var(--color-text)] tabular-nums-strict">
                {effectiveAgeGroup
                  ? `${effectiveAgeGroup.name} (${formatAgeGroupRange(effectiveAgeGroup)})`
                  : t('homePreview.activeAgeUnset')}
              </p>
            </div>

            <div className="p-3.5 rounded-[var(--radius-control)] bg-[var(--color-surface-alt)] border border-[var(--color-border)] space-y-1">
              <p className="text-[var(--color-muted)]">{t('homePreview.activeThemeLabel')}</p>
              <p className="font-bold text-[var(--color-text)]">
                {t(getThemeNameKey(activeThemeKey))}
              </p>
            </div>

            <div className="p-3.5 rounded-[var(--radius-control)] bg-[var(--color-surface-alt)] border border-[var(--color-border)] space-y-1 flex flex-col justify-center">
              <p className="text-[var(--color-text)] font-medium leading-relaxed">{sourceText}</p>
            </div>
          </div>

          <div className="flex items-start gap-2.5 text-xs sm:text-sm text-[var(--color-muted)] leading-relaxed pt-1">
            <SlidersHorizontal
              className="w-4 h-4 text-[var(--color-primary)] mt-0.5 shrink-0"
              aria-hidden="true"
            />
            <p>
              {effectiveAgeGroup?.key === 'child'
                ? t('homePreview.childHardFilterNote')
                : t('homePreview.softPriorityNote')}
            </p>
          </div>
        </section>

        {/* Prioritized Published Content Preview */}
        <section className="space-y-4">
          <div className="flex flex-wrap items-end justify-between gap-3 border-b border-[var(--color-border)] pb-3">
            <div className="space-y-1">
              <h2 className="text-lg sm:text-xl font-bold text-[var(--color-text)] tabular-nums-strict">
                {t('homePreview.contentSectionTitle', {
                  count: toPersianDigits(prioritized.length),
                })}
              </h2>
              <p className="text-xs sm:text-sm text-[var(--color-muted)]">
                {t('homePreview.contentSectionDesc')}
              </p>
            </div>
          </div>

          {isLoading ? (
            <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-card)] p-8 text-center text-sm text-[var(--color-muted)]">
              {t('homePreview.loadingContent')}
            </div>
          ) : prioritized.length === 0 ? (
            <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-card)] p-8 sm:p-10 text-center space-y-2.5">
              <BookOpen className="w-8 h-8 mx-auto text-[var(--color-muted)]" aria-hidden="true" />
              <h3 className="text-base font-bold text-[var(--color-text)]">
                {t('homePreview.emptyContentTitle')}
              </h3>
              <p className="text-xs sm:text-sm text-[var(--color-muted)] max-w-xl mx-auto leading-relaxed">
                {t('homePreview.emptyContentDesc')}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5 items-stretch">
              {prioritized.map((entry) => {
                const { item, topicNames } = entry.item;
                const formatKey = `content.format.${item.format}` as ResourceKey;
                const targetNames = entry.ageGroupIds
                  .map((id) => ageGroupNameById.get(id))
                  .filter((name): name is string => Boolean(name));

                const targetLabel =
                  targetNames.length === 0
                    ? t('homePreview.targetAllAges')
                    : t('homePreview.targetLabels', {
                        names: targetNames.join(t('homePreview.targetListSeparator')),
                      });

                return (
                  <div key={item.id} className="flex flex-col gap-2">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[var(--color-muted)] px-0.5">
                      <span className="font-semibold text-[var(--color-primary)]">
                        {t(getPriorityLabelKey(entry.priorityGroup))}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span>{targetLabel}</span>
                    </div>

                    <div className="flex-1">
                      <ContentCard
                        title={item.title}
                        formatLabel={t(formatKey)}
                        durationMinutes={item.readWatchMinutes ?? 0}
                        topicLabel={topicNames[0] ?? t('homePreview.generalTopic')}
                        summary={item.summary}
                        thumbnailUrl={thumbnailUrls[item.id]}
                        thumbnailAlt={item.title}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </MainLayout>
  );
}
