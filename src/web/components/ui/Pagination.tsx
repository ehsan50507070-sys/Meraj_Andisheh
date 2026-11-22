import { ChevronLeft, ChevronRight } from 'lucide-react';
import { toPersianDigits } from '../../resources/formatters';
import { t } from '../../resources/i18n';

export interface PaginationProps {
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}

export function Pagination({
  currentPage,
  totalPages,
  onPageChange,
}: PaginationProps) {
  if (totalPages <= 1) {
    return null;
  }

  const pages = Array.from({ length: totalPages }, (_, index) => index + 1);
  const canGoPrev = currentPage > 1;
  const canGoNext = currentPage < totalPages;

  return (
    <nav
      aria-label={t('ui.pagination.ariaLabel')}
      className="flex flex-wrap items-center justify-between gap-3"
    >
      <div className="flex flex-wrap items-center gap-1.5 tabular-nums-strict">
        <button
          type="button"
          disabled={!canGoPrev}
          onClick={() => onPageChange(currentPage - 1)}
          className="inline-flex items-center justify-center gap-1 min-h-[40px] px-3 py-1.5 text-xs sm:text-sm font-medium rounded-[var(--radius-control)] border border-[var(--color-border-strong)] bg-[var(--color-surface)] text-[var(--color-text)] hover:bg-[var(--color-surface-alt)] disabled:opacity-45 disabled:cursor-not-allowed transition-colors whitespace-nowrap focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary)]"
        >
          <ChevronRight className="w-4 h-4 shrink-0" aria-hidden="true" />
          <span>{t('ui.pagination.prev')}</span>
        </button>

        {pages.map((page) => {
          const isActive = page === currentPage;
          return (
            <button
              key={page}
              type="button"
              aria-current={isActive ? 'page' : undefined}
              onClick={() => onPageChange(page)}
              className={`inline-flex items-center justify-center min-w-[40px] min-h-[40px] px-2.5 text-xs sm:text-sm font-medium rounded-[var(--radius-control)] border transition-colors whitespace-nowrap focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary)] ${
                isActive
                  ? 'bg-[var(--color-primary-button)] text-[var(--color-on-primary)] border-transparent'
                  : 'bg-[var(--color-surface)] text-[var(--color-text)] border-[var(--color-border)] hover:bg-[var(--color-surface-alt)]'
              }`}
            >
              {toPersianDigits(page)}
            </button>
          );
        })}

        <button
          type="button"
          disabled={!canGoNext}
          onClick={() => onPageChange(currentPage + 1)}
          className="inline-flex items-center justify-center gap-1 min-h-[40px] px-3 py-1.5 text-xs sm:text-sm font-medium rounded-[var(--radius-control)] border border-[var(--color-border-strong)] bg-[var(--color-surface)] text-[var(--color-text)] hover:bg-[var(--color-surface-alt)] disabled:opacity-45 disabled:cursor-not-allowed transition-colors whitespace-nowrap focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary)]"
        >
          <span>{t('ui.pagination.next')}</span>
          <ChevronLeft className="w-4 h-4 shrink-0" aria-hidden="true" />
        </button>
      </div>

      <span className="text-xs text-[var(--color-muted)] tabular-nums-strict">
        {t('ui.pagination.pageInfo', {
          current: toPersianDigits(currentPage),
          total: toPersianDigits(totalPages),
        })}
      </span>
    </nav>
  );
}
