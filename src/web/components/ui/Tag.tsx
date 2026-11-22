import { X } from 'lucide-react';
import { t } from '../../resources/i18n';

export type TagVariant = 'neutral' | 'primary' | 'accent' | 'success' | 'warning';

export interface TagProps {
  label: string;
  variant?: TagVariant;
  removable?: boolean;
  onRemove?: () => void;
}

const VARIANT_CLASSES: Record<TagVariant, string> = {
  neutral:
    'bg-[var(--color-surface-alt)] text-[var(--color-text)] border-[var(--color-border)]',
  primary:
    'bg-[var(--color-primary-button)] text-[var(--color-on-primary)] border-transparent',
  accent:
    'bg-[var(--color-accent)] text-[var(--color-on-accent)] border-transparent',
  success:
    'bg-[var(--color-success-bg)] text-[var(--color-success-text)] border-[var(--color-success-border)]',
  warning:
    'bg-[var(--color-warning-bg)] text-[var(--color-warning-text)] border-[var(--color-warning-border)]',
};

export function Tag({
  label,
  variant = 'neutral',
  removable = false,
  onRemove,
}: TagProps) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-[var(--radius-tag)] border whitespace-nowrap ${VARIANT_CLASSES[variant]}`}
    >
      <span>{label}</span>
      {removable && onRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={t('ui.tag.removeAria', { label })}
          className="inline-flex items-center justify-center w-5 h-5 rounded-sm opacity-80 hover:opacity-100 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-current transition-opacity"
        >
          <X className="w-3.5 h-3.5" aria-hidden="true" />
        </button>
      )}
    </span>
  );
}
