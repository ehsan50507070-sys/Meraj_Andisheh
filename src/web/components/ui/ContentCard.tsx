import { BookOpen, Clock } from 'lucide-react';
import { useState } from 'react';
import { toPersianDigits } from '../../resources/formatters';
import { t } from '../../resources/i18n';

export interface ContentCardProps {
  title: string;
  formatLabel: string;
  durationMinutes: number;
  topicLabel: string;
  summary?: string;
  thumbnailUrl?: string;
  thumbnailAlt?: string;
  onSelect?: () => void;
}

export function ContentCard({
  title,
  formatLabel,
  durationMinutes,
  topicLabel,
  summary,
  thumbnailUrl,
  thumbnailAlt,
  onSelect,
}: ContentCardProps) {
  const [imageError, setImageError] = useState(false);
  const showFallback = !thumbnailUrl || imageError;

  const formattedDuration = t('ui.contentCard.durationMinutes', {
    minutes: toPersianDigits(durationMinutes),
  });

  const cardContent = (
    <>
      <div className="aspect-video w-full overflow-hidden bg-[var(--color-surface-alt)] border-b border-[var(--color-border)] relative">
        {showFallback ? (
          <div className="w-full h-full flex flex-col items-center justify-center gap-2 p-4 text-[var(--color-muted)] bg-[var(--color-surface-alt)]">
            <BookOpen className="w-8 h-8 opacity-75" aria-hidden="true" />
            <span className="text-xs font-medium text-center line-clamp-1">{topicLabel}</span>
          </div>
        ) : (
          <img
            src={thumbnailUrl}
            alt={thumbnailAlt ?? title}
            referrerPolicy="no-referrer"
            onError={() => setImageError(true)}
            className="w-full h-full object-cover transition-transform duration-200 group-hover:scale-[1.02]"
          />
        )}
      </div>

      <div className="p-4 sm:p-5 flex-1 flex flex-col justify-between gap-3 text-right">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[var(--color-muted)]">
            <span className="font-semibold text-[var(--color-text)]">{formatLabel}</span>
            <span aria-hidden="true">·</span>
            <span>{topicLabel}</span>
          </div>

          <h3 className="text-base font-bold text-[var(--color-text)] leading-snug line-clamp-2">
            {title}
          </h3>

          {summary && (
            <p className="text-xs sm:text-sm text-[var(--color-muted)] leading-relaxed line-clamp-2">
              {summary}
            </p>
          )}
        </div>

        <div className="pt-3 border-t border-[var(--color-border)] flex items-center justify-between gap-2 text-xs text-[var(--color-muted)] tabular-nums-strict">
          <span className="inline-flex items-center gap-1.5">
            <Clock className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
            <span>{formattedDuration}</span>
          </span>
          <span className="font-medium text-[var(--color-text)]">{topicLabel}</span>
        </div>
      </div>
    </>
  );

  if (onSelect) {
    return (
      <button
        type="button"
        onClick={onSelect}
        className="group w-full h-full text-right bg-[var(--color-surface)] border border-[var(--color-border)] hover:border-[var(--color-border-strong)] rounded-[var(--radius-card)] shadow-[var(--shadow-card)] overflow-hidden flex flex-col transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary)]"
      >
        {cardContent}
      </button>
    );
  }

  return (
    <article className="group w-full h-full bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-card)] shadow-[var(--shadow-card)] overflow-hidden flex flex-col">
      {cardContent}
    </article>
  );
}
