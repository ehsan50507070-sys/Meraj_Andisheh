import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react';
import { t } from '../../resources/i18n';

export type AlertVariant = 'info' | 'success' | 'warning' | 'error';

export interface AlertProps {
  variant?: AlertVariant;
  title?: string;
  message: string;
  onDismiss?: () => void;
}

const VARIANT_CLASSES: Record<AlertVariant, string> = {
  info: 'bg-[var(--color-info-bg)] text-[var(--color-info-text)] border-[var(--color-info-border)]',
  success:
    'bg-[var(--color-success-bg)] text-[var(--color-success-text)] border-[var(--color-success-border)]',
  warning:
    'bg-[var(--color-warning-bg)] text-[var(--color-warning-text)] border-[var(--color-warning-border)]',
  error:
    'bg-[var(--color-error-bg)] text-[var(--color-error-text)] border-[var(--color-error-border)]',
};

function renderVariantIcon(variant: AlertVariant) {
  switch (variant) {
    case 'success':
      return <CheckCircle2 className="w-5 h-5 shrink-0 mt-0.5" aria-hidden="true" />;
    case 'warning':
      return <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" aria-hidden="true" />;
    case 'error':
      return <XCircle className="w-5 h-5 shrink-0 mt-0.5" aria-hidden="true" />;
    case 'info':
    default:
      return <Info className="w-5 h-5 shrink-0 mt-0.5" aria-hidden="true" />;
  }
}

export function Alert({
  variant = 'info',
  title,
  message,
  onDismiss,
}: AlertProps) {
  return (
    <div
      role={variant === 'error' || variant === 'warning' ? 'alert' : 'status'}
      className={`w-full rounded-[var(--radius-control)] border px-4 py-3 flex items-start justify-between gap-3 ${VARIANT_CLASSES[variant]}`}
    >
      <div className="flex items-start gap-2.5 min-w-0">
        {renderVariantIcon(variant)}
        <div className="min-w-0 space-y-0.5 text-sm">
          {title && <p className="font-semibold leading-snug">{title}</p>}
          <p className="text-xs sm:text-sm leading-relaxed opacity-95">{message}</p>
        </div>
      </div>

      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label={t('ui.alert.dismissAria')}
          className="inline-flex items-center justify-center w-8 h-8 rounded-md shrink-0 opacity-80 hover:opacity-100 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-current transition-opacity"
        >
          <X className="w-4 h-4" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
