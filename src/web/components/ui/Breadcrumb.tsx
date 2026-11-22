import { ChevronLeft } from 'lucide-react';

export interface BreadcrumbItem {
  label: string;
  href?: string;
}

export interface BreadcrumbProps {
  items: readonly BreadcrumbItem[];
  ariaLabel: string;
}

export function Breadcrumb({ items, ariaLabel }: BreadcrumbProps) {
  return (
    <nav aria-label={ariaLabel} className="w-full overflow-x-auto">
      <ol className="flex items-center gap-1.5 text-xs sm:text-sm text-[var(--color-muted)] whitespace-nowrap">
        {items.map((item, index) => {
          const isLast = index === items.length - 1;
          return (
            <li key={`${item.label}-${index}`} className="inline-flex items-center gap-1.5">
              {index > 0 && (
                <ChevronLeft
                  className="w-4 h-4 text-[var(--color-muted)] shrink-0"
                  aria-hidden="true"
                />
              )}
              {item.href && !isLast ? (
                <a
                  href={item.href}
                  className="hover:text-[var(--color-text)] hover:underline underline-offset-4 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary)] rounded-sm"
                >
                  {item.label}
                </a>
              ) : (
                <span
                  aria-current={isLast ? 'page' : undefined}
                  className={isLast ? 'font-semibold text-[var(--color-text)]' : undefined}
                >
                  {item.label}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
