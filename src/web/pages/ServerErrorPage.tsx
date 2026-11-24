import {
  AlertTriangle,
  Check,
  Copy,
  Home,
  RotateCcw,
  Terminal,
} from 'lucide-react';
import { useState } from 'react';
import {
  buildSafeErrorReport,
  type SafeErrorReport,
} from '../../core/services/securityAuditService';
import { envConfig } from '../../infrastructure/config/envConfig';
import { Button } from '../components/ui';
import { usePageMeta } from '../hooks/usePageMeta';
import { toPersianDigits } from '../resources/formatters';
import { t } from '../resources/i18n';
import { navigateToHash } from '../router/HashRouter';
import { appContainer } from '../services/appContainer';

export interface ServerErrorPageProps {
  currentRoute?: string;
  report?: SafeErrorReport | null;
  onReset?: () => void;
}

export function ServerErrorPage({
  currentRoute = '#/error/500',
  report,
  onReset,
}: ServerErrorPageProps) {
  usePageMeta({
    currentRoute,
    pageTitle: t('meta.title.error500'),
  });

  const [fallbackReport] = useState<SafeErrorReport>(
    () =>
      report ??
      buildSafeErrorReport(
        new Error('PREVIEW_500_TEMPLATE'),
        envConfig.isDevelopment,
        appContainer.clock,
      ),
  );
  const activeReport = report ?? fallbackReport;

  const [copiedId, setCopiedId] = useState(false);

  const handleCopyErrorId = async () => {
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(activeReport.errorId);
        setCopiedId(true);
        window.setTimeout(() => setCopiedId(false), 2000);
      }
    } catch {
      // Clipboard unavailable
    }
  };

  const handleBackHome = () => {
    if (onReset) {
      onReset();
    }
    navigateToHash('/');
  };

  const handleReload = () => {
    if (onReset) {
      onReset();
      return;
    }
    window.location.reload();
  };

  return (
    <div
      dir="rtl"
      className="min-h-screen bg-[var(--color-bg)] text-[var(--color-text)] flex items-center justify-center px-4 py-10"
    >
      <section
        role="alert"
        aria-labelledby="server-error-heading"
        className="w-full max-w-xl bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-card)] shadow-[var(--shadow-card)] p-6 sm:p-8 space-y-6 text-center"
      >
        <div className="mx-auto w-14 h-14 rounded-full bg-[var(--color-error-bg)] text-[var(--color-error-text)] flex items-center justify-center">
          <AlertTriangle className="w-7 h-7" aria-hidden="true" />
        </div>

        <div className="space-y-2">
          <p className="text-3xl font-bold text-[var(--color-error-text)] tabular-nums-strict">
            {toPersianDigits(500)}
          </p>
          <h1
            id="server-error-heading"
            className="text-xl sm:text-2xl font-bold text-[var(--color-text)]"
          >
            {t('error500.title')}
          </h1>
          <p className="text-sm text-[var(--color-muted)] leading-relaxed">
            {t('error500.safeBody')}
          </p>
        </div>

        <div className="rounded-[var(--radius-control)] border border-[var(--color-border)] bg-[var(--color-surface-alt)] p-3.5 space-y-2 text-xs sm:text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-[var(--color-muted)]">
              {t('error500.trackingCodeLabel')}
            </span>
            <div className="flex items-center gap-2">
              <code
                dir="ltr"
                className="font-mono font-semibold text-[var(--color-text)] bg-[var(--color-surface)] border border-[var(--color-border)] px-2 py-0.5 rounded"
              >
                {activeReport.errorId}
              </code>
              <button
                type="button"
                onClick={() => void handleCopyErrorId()}
                className="inline-flex items-center gap-1 px-2 py-1 rounded-[var(--radius-control)] border border-[var(--color-border)] bg-[var(--color-surface)] text-xs text-[var(--color-text)] hover:bg-[var(--color-border)] transition-colors"
              >
                {copiedId ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-[var(--color-success-text)]" />
                    <span>{t('error500.copiedButton')}</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" />
                    <span>{t('error500.copyButton')}</span>
                  </>
                )}
              </button>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--color-muted)]">
            <span>{t('error500.occurredAtLabel')}</span>
            <span dir="ltr" className="font-mono tabular-nums-strict">
              {toPersianDigits(activeReport.occurredAtJalali)}
            </span>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-center gap-3">
          <Button
            variant="primary"
            onClick={handleBackHome}
            startIcon={<Home className="w-4 h-4" />}
          >
            {t('error500.backHomeButton')}
          </Button>
          <Button
            variant="secondary"
            onClick={handleReload}
            startIcon={<RotateCcw className="w-4 h-4" />}
          >
            {t('error500.retryButton')}
          </Button>
        </div>

        {activeReport.isDevelopment && activeReport.technicalDetails && (
          <details className="text-right rounded-[var(--radius-control)] border border-[var(--color-border)] bg-[var(--color-surface-alt)] p-3.5">
            <summary className="cursor-pointer text-xs font-semibold text-[var(--color-warning-text)] flex items-center gap-1.5">
              <Terminal className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span>{t('error500.devDetailsSummary')}</span>
            </summary>
            <pre
              dir="ltr"
              className="mt-3 text-left text-[11px] font-mono text-[var(--color-error-text)] whitespace-pre-wrap break-all overflow-x-auto max-h-56"
            >
              {activeReport.technicalDetails}
            </pre>
          </details>
        )}
      </section>
    </div>
  );
}
