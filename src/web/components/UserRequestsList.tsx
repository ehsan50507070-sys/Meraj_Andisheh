import {
  BookOpen,
  ExternalLink,
  Inbox,
  Link2,
  MessageSquareQuote,
} from 'lucide-react';
import { ContentRequestStatus } from '../../core/domain/requests';
import {
  validateOptionalRequestLink,
  type UserContentRequestView,
} from '../../core/services/contentRequestService';
import { Button, Tag, type TagVariant } from './ui';
import { formatJalaliDateTimePersian, toPersianDigits } from '../resources/formatters';
import type { ResourceKey } from '../resources/fa';
import { t } from '../resources/i18n';
import { navigateToHash } from '../router/HashRouter';

export function getContentRequestStatusVariant(
  status: ContentRequestStatus,
): TagVariant {
  switch (status) {
    case ContentRequestStatus.InProgress:
      return 'warning';
    case ContentRequestStatus.Done:
      return 'success';
    case ContentRequestStatus.Rejected:
      return 'accent';
    case ContentRequestStatus.Submitted:
    default:
      return 'neutral';
  }
}

export function getContentRequestStatusLabelKey(
  status: ContentRequestStatus,
): ResourceKey {
  switch (status) {
    case ContentRequestStatus.InProgress:
      return 'requests.status.2';
    case ContentRequestStatus.Done:
      return 'requests.status.3';
    case ContentRequestStatus.Rejected:
      return 'requests.status.4';
    case ContentRequestStatus.Submitted:
    default:
      return 'requests.status.1';
  }
}

interface UserRequestsListProps {
  items: readonly UserContentRequestView[];
  isLoading: boolean;
}

export function UserRequestsList({ items, isLoading }: UserRequestsListProps) {
  if (isLoading) {
    return (
      <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-card)] p-6 text-center text-sm text-[var(--color-muted)]">
        {t('requests.list.loading')}
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-card)] p-8 text-center space-y-2">
        <Inbox
          className="w-8 h-8 mx-auto text-[var(--color-muted)]"
          aria-hidden="true"
        />
        <p className="text-sm font-semibold text-[var(--color-text)]">
          {t('requests.list.emptyTitle')}
        </p>
        <p className="text-xs sm:text-sm text-[var(--color-muted)] max-w-md mx-auto leading-relaxed">
          {t('requests.list.emptyBody')}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {items.map((entry, idx) => {
        const { request, linkedContent } = entry;
        const safeLinkCheck = validateOptionalRequestLink(request.link);
        const safeHref = safeLinkCheck.ok ? safeLinkCheck.normalized : null;

        return (
          <article
            key={request.id}
            className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-card)] shadow-[var(--shadow-card)] p-4 sm:p-5 space-y-3"
          >
            <div className="flex flex-wrap items-start justify-between gap-2.5">
              <div className="flex items-start gap-2 min-w-0">
                <span className="inline-flex items-center justify-center min-w-[26px] h-6 px-1.5 rounded-[var(--radius-control)] bg-[var(--color-surface-alt)] border border-[var(--color-border)] text-xs font-semibold text-[var(--color-muted)] tabular-nums-strict shrink-0">
                  {toPersianDigits(idx + 1)}
                </span>
                <h3 className="text-sm sm:text-base font-bold text-[var(--color-text)] break-words">
                  {request.title}
                </h3>
              </div>

              <Tag
                label={t(getContentRequestStatusLabelKey(request.status))}
                variant={getContentRequestStatusVariant(request.status)}
              />
            </div>

            <p className="text-xs sm:text-sm text-[var(--color-text)] leading-relaxed whitespace-pre-wrap break-words">
              {request.description}
            </p>

            {safeHref && (
              <div>
                <a
                  href={safeHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--color-primary)] hover:underline underline-offset-4 break-all"
                >
                  <Link2 className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                  <span>{t('requests.list.referenceLinkLabel')}:</span>
                  <span dir="ltr" className="font-mono">
                    {safeHref}
                  </span>
                  <ExternalLink
                    className="w-3 h-3 shrink-0"
                    aria-hidden="true"
                  />
                </a>
              </div>
            )}

            {request.adminNote && (
              <div className="p-3 sm:p-3.5 rounded-[var(--radius-control)] bg-[var(--color-surface-alt)] border border-[var(--color-border)] space-y-1.5">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-[var(--color-primary)]">
                  <MessageSquareQuote
                    className="w-4 h-4 shrink-0"
                    aria-hidden="true"
                  />
                  <span>{t('requests.list.adminNoteTitle')}</span>
                </div>
                <p className="text-xs sm:text-sm text-[var(--color-text)] leading-relaxed whitespace-pre-wrap break-words">
                  {request.adminNote}
                </p>
              </div>
            )}

            {request.status === ContentRequestStatus.Done && linkedContent && (
              <div className="pt-1 flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="primary"
                  size="sm"
                  startIcon={<BookOpen className="w-4 h-4" />}
                  onClick={() =>
                    navigateToHash(
                      `/content/${encodeURIComponent(linkedContent.slug)}`,
                    )
                  }
                >
                  {t('requests.list.openPublishedContent', {
                    title: linkedContent.title,
                  })}
                </Button>
              </div>
            )}

            <div className="pt-2 border-t border-[var(--color-border)] flex flex-wrap items-center justify-between gap-2 text-[11px] sm:text-xs text-[var(--color-muted)] tabular-nums-strict">
              <span>
                {t('requests.list.createdAtLabel', {
                  date: formatJalaliDateTimePersian(request.createdAt),
                })}
              </span>
              <span>
                {t('requests.list.updatedAtLabel', {
                  date: formatJalaliDateTimePersian(request.updatedAt),
                })}
              </span>
            </div>
          </article>
        );
      })}
    </div>
  );
}
