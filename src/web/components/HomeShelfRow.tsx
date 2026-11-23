import { ArrowLeft } from 'lucide-react';
import type { HomeShelfViewModel } from '../../core/services/homePageService';
import { ContentCard } from './ui';
import { toPersianDigits } from '../resources/formatters';
import type { ResourceKey } from '../resources/fa';
import { t } from '../resources/i18n';
import { navigateToHash } from '../router/HashRouter';

export interface HomeShelfRowProps {
  shelfModel: HomeShelfViewModel;
  thumbnailUrls: Record<number, string>;
}

export function HomeShelfRow({ shelfModel, thumbnailUrls }: HomeShelfRowProps) {
  if (shelfModel.items.length === 0) {
    return null;
  }

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--color-border)] pb-3">
        <div className="space-y-1 min-w-0">
          <h2 className="text-lg sm:text-xl font-bold text-[var(--color-text)] tracking-tight">
            {shelfModel.shelf.title}
          </h2>
          {shelfModel.shelf.type === 'Personalized' &&
            shelfModel.personalizedTopics &&
            shelfModel.personalizedTopics.length > 0 && (
              <p className="text-xs text-[var(--color-muted)]">
                {t('home.page.personalizedTopicsHint', {
                  topics: shelfModel.personalizedTopics
                    .map((topicScore) => topicScore.rootTopicName)
                    .join(t('home.page.topicSeparator')),
                })}
              </p>
            )}
        </div>

        <a
          href={shelfModel.viewAllHref}
          className="inline-flex items-center gap-1.5 text-xs sm:text-sm font-semibold text-[var(--color-primary)] hover:underline underline-offset-4 whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary)] rounded-sm"
        >
          <span>{t('home.page.viewAllShelf')}</span>
          <ArrowLeft className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
        </a>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5 items-stretch">
        {shelfModel.items.map((entry) => {
          const { item, primaryTopicName } = entry;
          const formatKey = `content.format.${item.format}` as ResourceKey;
          const trendingViews7d =
            shelfModel.trendingCountsByContentId?.[item.id] ?? undefined;

          return (
            <div key={item.id} className="flex flex-col gap-1.5">
              {trendingViews7d !== undefined && (
                <div className="px-0.5 text-xs font-medium text-[var(--color-primary)] tabular-nums-strict">
                  {t('home.page.trendingViewsBadge', {
                    count: toPersianDigits(trendingViews7d),
                  })}
                </div>
              )}

              <div className="flex-1">
                <ContentCard
                  title={item.title}
                  formatLabel={t(formatKey)}
                  durationMinutes={item.readWatchMinutes ?? 0}
                  topicLabel={primaryTopicName ?? t('home.page.generalTopic')}
                  summary={item.summary}
                  thumbnailUrl={thumbnailUrls[item.id]}
                  thumbnailAlt={item.title}
                  onSelect={() =>
                    navigateToHash(`/content/${encodeURIComponent(item.slug)}`)
                  }
                />
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
