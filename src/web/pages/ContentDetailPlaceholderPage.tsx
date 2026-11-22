import { ArrowRight, BookOpen, Clock, FileText, Layers } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { ContentAggregate } from '../../core/abstractions/contentRepository';
import { ContentStatus } from '../../core/domain/content';
import type { Topic } from '../../core/domain/taxonomy';
import { isContentAllowedForAgeGroup } from '../../core/services/ageRuleService';
import { useAuth } from '../auth/AuthContext';
import {
  Alert,
  Breadcrumb,
  Button,
  type BreadcrumbItem,
} from '../components/ui';
import { useAge } from '../context/AgeContext';
import { MainLayout } from '../layouts/MainLayout';
import { toPersianDigits } from '../resources/formatters';
import type { ResourceKey } from '../resources/fa';
import { t } from '../resources/i18n';
import { navigateToHash } from '../router/HashRouter';
import { appContainer } from '../services/appContainer';
import { NotFoundPage } from './NotFoundPage';

export interface ContentDetailPlaceholderPageProps {
  currentRoute: string;
  slug: string;
}

export function ContentDetailPlaceholderPage({
  currentRoute,
  slug,
}: ContentDetailPlaceholderPageProps) {
  const { isAuthReady } = useAuth();
  const { effectiveAgeGroup, isAgeReady } = useAge();
  const [aggregate, setAggregate] = useState<ContentAggregate | null>(null);
  const [topics, setTopics] = useState<Topic[]>([]);
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  useEffect(() => {
    let active = true;

    const loadItem = async () => {
      setIsLoading(true);
      setAggregate(null);
      try {
        await appContainer.ensureInitializedAtStartup();
        const [loadedAggregate, loadedTopics] = await Promise.all([
          appContainer.contentManagementService.getPublicPublishedBySlug(slug),
          appContainer.taxonomyRepository.getAllTopics(),
        ]);

        if (!active) {
          return;
        }
        setAggregate(loadedAggregate);
        setTopics(loadedTopics);
      } finally {
        if (active) {
          setIsLoading(false);
        }
      }
    };

    void loadItem();

    return () => {
      active = false;
    };
  }, [slug]);

  const isVisibleForActiveAge = useMemo(() => {
    if (!aggregate || aggregate.item.status !== ContentStatus.Published) {
      return false;
    }
    return isContentAllowedForAgeGroup(aggregate.ageGroupIds, effectiveAgeGroup);
  }, [aggregate, effectiveAgeGroup]);

  useEffect(() => {
    let active = true;
    let createdUrl: string | null = null;

    const loadThumb = async () => {
      setThumbnailUrl(null);
      if (
        !isAgeReady ||
        !isAuthReady ||
        !aggregate ||
        !isVisibleForActiveAge ||
        !aggregate.item.thumbnailKey
      ) {
        return;
      }
      const media = await appContainer.fileUploadService.openPublicMediaAsync(
        aggregate.item.thumbnailKey,
      );
      if (!active || !media.ok || !media.bytes || !media.metadata) {
        return;
      }
      const copy = new Uint8Array(media.bytes.byteLength);
      copy.set(media.bytes);
      const blob = new Blob([copy.buffer], { type: media.metadata.mimeType });
      createdUrl = URL.createObjectURL(blob);
      setThumbnailUrl(createdUrl);
    };

    void loadThumb();

    return () => {
      active = false;
      if (createdUrl) {
        URL.revokeObjectURL(createdUrl);
      }
    };
  }, [aggregate, isAgeReady, isAuthReady, isVisibleForActiveAge]);

  const topicLabels = useMemo(() => {
    if (!aggregate) {
      return [];
    }
    const topicById = new Map<number, string>(topics.map((tp) => [tp.id, tp.name]));
    return aggregate.topicIds
      .map((id) => topicById.get(id))
      .filter((name): name is string => Boolean(name));
  }, [aggregate, topics]);

  if (!isAgeReady || !isAuthReady || isLoading) {
    return (
      <MainLayout currentRoute={currentRoute}>
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
          <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-card)] p-8 text-center text-sm text-[var(--color-muted)]">
            {t('catalog.loading')}
          </div>
        </div>
      </MainLayout>
    );
  }

  if (!aggregate || !isVisibleForActiveAge) {
    return <NotFoundPage currentRoute={currentRoute} />;
  }

  const formatKey = `catalog.format.${aggregate.item.format}` as ResourceKey;
  const breadcrumbItems: BreadcrumbItem[] = [
    { label: t('catalog.breadcrumb.home'), href: '#/' },
    { label: t('catalog.breadcrumb.bank'), href: '#/content' },
    { label: aggregate.item.title },
  ];

  return (
    <MainLayout currentRoute={currentRoute}>
      <div className="max-w-4xl mx-auto px-3 sm:px-6 lg:px-8 py-6 sm:py-8 space-y-5">
        <Breadcrumb
          items={breadcrumbItems}
          ariaLabel={t('catalog.breadcrumb.ariaLabel')}
        />

        <article className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-card)] shadow-[var(--shadow-card)] overflow-hidden">
          {thumbnailUrl ? (
            <div className="aspect-[16/9] max-h-[340px] w-full bg-[var(--color-surface-alt)] border-b border-[var(--color-border)] overflow-hidden">
              <img
                src={thumbnailUrl}
                alt={aggregate.item.title}
                className="w-full h-full object-cover"
              />
            </div>
          ) : (
            <div className="py-10 bg-[var(--color-surface-alt)] border-b border-[var(--color-border)] flex items-center justify-center">
              <BookOpen
                className="w-10 h-10 text-[var(--color-muted)]"
                aria-hidden="true"
              />
            </div>
          )}

          <div className="p-5 sm:p-8 space-y-5">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--color-muted)]">
              <span className="font-semibold text-[var(--color-primary)]">
                {t('contentDetailPlaceholder.badge')}
              </span>
              <span aria-hidden="true">·</span>
              <span className="inline-flex items-center gap-1 font-medium text-[var(--color-text)]">
                <FileText className="w-3.5 h-3.5 text-[var(--color-primary)]" aria-hidden="true" />
                <span>{t(formatKey)}</span>
              </span>
              {typeof aggregate.item.readWatchMinutes === 'number' &&
                aggregate.item.readWatchMinutes > 0 && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span className="inline-flex items-center gap-1 tabular-nums-strict">
                      <Clock className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>
                        {t('contentDetailPlaceholder.durationLabel')}:{' '}
                        {toPersianDigits(aggregate.item.readWatchMinutes)}
                      </span>
                    </span>
                  </>
                )}
            </div>

            <h1 className="text-xl sm:text-2xl font-bold text-[var(--color-text)] leading-snug text-balance">
              {aggregate.item.title}
            </h1>

            <p className="text-sm sm:text-base text-[var(--color-muted)] leading-relaxed">
              {aggregate.item.summary}
            </p>

            {topicLabels.length > 0 && (
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs sm:text-sm text-[var(--color-muted)] pt-1">
                <Layers className="w-4 h-4 text-[var(--color-primary)] shrink-0" aria-hidden="true" />
                <span className="font-medium text-[var(--color-text)]">
                  {t('contentDetailPlaceholder.topicsLabel')}:
                </span>
                <span>
                  {topicLabels.join(t('homePreview.targetListSeparator'))}
                </span>
              </div>
            )}

            <Alert
              variant="info"
              title={t('contentDetailPlaceholder.noticeTitle')}
              message={t('contentDetailPlaceholder.noticeDesc')}
            />

            <div className="pt-2 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--color-border)]">
              <Button
                variant="outline"
                onClick={() => navigateToHash('/content')}
                startIcon={<ArrowRight className="w-4 h-4" />}
              >
                {t('contentDetailPlaceholder.backToBank')}
              </Button>
            </div>
          </div>
        </article>
      </div>
    </MainLayout>
  );
}
