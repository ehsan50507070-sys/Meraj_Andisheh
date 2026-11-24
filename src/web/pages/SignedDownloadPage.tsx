import {
  AlertTriangle,
  ArrowRight,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  Download,
  FileCheck2,
  Lock,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ExecuteSignedDownloadResult } from '../../core/services/downloadService';
import { useAuth } from '../auth/AuthContext';
import { Alert, Button } from '../components/ui';
import { useAge } from '../context/AgeContext';
import { MainLayout } from '../layouts/MainLayout';
import { formatFileSizeParts } from '../resources/formatters';
import type { ResourceKey } from '../resources/fa';
import { t } from '../resources/i18n';
import { navigateToHash } from '../router/HashRouter';
import { appContainer } from '../services/appContainer';

export interface SignedDownloadPageProps {
  currentRoute: string;
  token: string;
}

function triggerBrowserFileDownload(bytes: Uint8Array, mimeType: string, fileName: string): void {
  if (typeof document === 'undefined' || typeof URL === 'undefined') {
    return;
  }
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const blob = new Blob([copy.buffer], {
    type: mimeType || 'application/octet-stream',
  });
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = fileName || 'download';
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1500);
}

export function SignedDownloadPage({ currentRoute, token }: SignedDownloadPageProps) {
  const { currentUser, isAuthReady } = useAuth();
  const { effectiveAgeGroup, isAgeReady } = useAge();

  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [outcome, setOutcome] = useState<ExecuteSignedDownloadResult | null>(null);
  const [copiedUrl, setCopiedUrl] = useState<boolean>(false);
  const [copiedS3Url, setCopiedS3Url] = useState<boolean>(false);
  const [isRedownloading, setIsRedownloading] = useState<boolean>(false);

  // StrictMode & age-switch guard: executes initial auto-download at most once per (token, user)
  const executedGuardRef = useRef<string | null>(null);
  const activeAgeGroupRef = useRef(effectiveAgeGroup);
  activeAgeGroupRef.current = effectiveAgeGroup;
  const currentUserRef = useRef(currentUser);
  currentUserRef.current = currentUser;

  const runDownload = useCallback(
    async (triggerSave: boolean) => {
      await appContainer.ensureInitializedAtStartup();
      const result = await appContainer.downloadService.executeSignedDownloadAsync({
        token,
        currentUser: currentUserRef.current,
        activeAgeGroup: activeAgeGroupRef.current,
      });
      if (result.ok && triggerSave) {
        triggerBrowserFileDownload(result.bytes, result.mimeType, result.originalFileName);
      }
      return result;
    },
    [token],
  );

  useEffect(() => {
    if (!isAuthReady || !isAgeReady) {
      return;
    }

    const guardKey = `${token}:${currentUser?.id ?? 'guest'}`;
    if (executedGuardRef.current === guardKey) {
      return;
    }
    executedGuardRef.current = guardKey;

    let active = true;
    setIsLoading(true);
    setCopiedUrl(false);
    setCopiedS3Url(false);

    void (async () => {
      try {
        const res = await runDownload(true);
        if (active) {
          setOutcome(res);
        }
      } finally {
        if (active) {
          setIsLoading(false);
        }
      }
    })();

    return () => {
      active = false;
    };
  }, [token, currentUser?.id, isAuthReady, isAgeReady, runDownload]);

  const handleManualRedownload = async () => {
    setIsRedownloading(true);
    try {
      const res = await runDownload(true);
      setOutcome(res);
    } finally {
      setIsRedownloading(false);
    }
  };

  const fullSignedShareUrl =
    typeof window !== 'undefined'
      ? `${window.location.origin}${window.location.pathname}#/download/${token}`
      : `#/download/${token}`;

  const handleCopySignedUrl = async () => {
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(fullSignedShareUrl);
        setCopiedUrl(true);
        return;
      }
      if (typeof document !== 'undefined') {
        const textarea = document.createElement('textarea');
        textarea.value = fullSignedShareUrl;
        textarea.setAttribute('readonly', '');
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        const ok = document.execCommand('copy');
        document.body.removeChild(textarea);
        if (ok) {
          setCopiedUrl(true);
        }
      }
    } catch {
      // Ignore clipboard failure
    }
  };

  const handleCopyS3PresignedUrl = async (s3Url: string) => {
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(s3Url);
        setCopiedS3Url(true);
        return;
      }
      if (typeof document !== 'undefined') {
        const textarea = document.createElement('textarea');
        textarea.value = s3Url;
        textarea.setAttribute('readonly', '');
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        const ok = document.execCommand('copy');
        document.body.removeChild(textarea);
        if (ok) {
          setCopiedS3Url(true);
        }
      }
    } catch {
      // Ignore clipboard failure
    }
  };

  const loginReturnTarget = `#/account/login?returnUrl=${encodeURIComponent(`#/download/${token}`)}`;

  return (
    <MainLayout currentRoute={currentRoute}>
      <div className="max-w-2xl mx-auto px-3 sm:px-6 lg:px-8 py-8 sm:py-12">
        <section className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-card)] shadow-[var(--shadow-card)] p-6 sm:p-8 space-y-6">
          <header className="space-y-1.5 pb-4 border-b border-[var(--color-border)]">
            <h1 className="text-xl sm:text-2xl font-bold text-[var(--color-text)]">
              {t('signedDownload.pageTitle')}
            </h1>
            <p className="text-xs sm:text-sm text-[var(--color-muted)] leading-relaxed">
              {t('signedDownload.subtitle')}
            </p>
          </header>

          {!isAuthReady || !isAgeReady || isLoading ? (
            <div className="py-8 text-center text-sm text-[var(--color-muted)]">
              {t('signedDownload.loading')}
            </div>
          ) : !currentUser || (outcome && !outcome.ok && outcome.errorCode === 'AUTH_REQUIRED') ? (
            <div className="space-y-5">
              <div className="flex items-start gap-3 p-4 rounded-[var(--radius-control)] bg-[var(--color-surface-alt)] border border-[var(--color-border)]">
                <Lock className="w-5 h-5 text-[var(--color-primary)] shrink-0 mt-0.5" aria-hidden="true" />
                <div className="space-y-1">
                  <p className="text-sm font-bold text-[var(--color-text)]">
                    {t('signedDownload.authRequiredTitle')}
                  </p>
                  <p className="text-xs sm:text-sm text-[var(--color-muted)] leading-relaxed">
                    {t('signedDownload.authRequiredBody')}
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <Button variant="primary" onClick={() => navigateToHash(loginReturnTarget)}>
                  {t('signedDownload.loginButton')}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => navigateToHash('/content')}
                  startIcon={<ArrowRight className="w-4 h-4" />}
                >
                  {t('signedDownload.actions.backToBank')}
                </Button>
              </div>
            </div>
          ) : outcome && outcome.ok ? (
            <div className="space-y-5">
              <Alert
                variant="success"
                title={t('signedDownload.successTitle')}
                message={t('signedDownload.successBody', { fileName: outcome.originalFileName })}
              />

              <div className="rounded-[var(--radius-control)] border border-[var(--color-border)] bg-[var(--color-surface-alt)] p-4 sm:p-5 space-y-3 text-xs sm:text-sm">
                <div className="flex items-center gap-2 font-bold text-[var(--color-text)]">
                  <FileCheck2 className="w-4 h-4 text-[var(--color-success-text)] shrink-0" aria-hidden="true" />
                  <span>{outcome.contentTitle}</span>
                </div>

                <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-[var(--color-border)]">
                  <div className="space-y-0.5">
                    <dt className="text-[11px] text-[var(--color-muted)]">
                      {t('signedDownload.meta.fileNameLabel')}
                    </dt>
                    <dd dir="ltr" className="font-mono text-xs text-[var(--color-text)] break-all">
                      {outcome.originalFileName}
                    </dd>
                  </div>

                  <div className="space-y-0.5 tabular-nums-strict">
                    <dt className="text-[11px] text-[var(--color-muted)]">
                      {t('signedDownload.meta.fileSizeLabel')}
                    </dt>
                    <dd className="font-semibold text-[var(--color-text)]">
                      {(() => {
                        const parts = formatFileSizeParts(outcome.sizeBytes);
                        return parts
                          ? t(`contentDetail.sizeUnit.${parts.unit}`, { value: parts.value })
                          : '—';
                      })()}
                    </dd>
                  </div>

                  <div className="space-y-0.5 sm:col-span-2">
                    <dt className="text-[11px] text-[var(--color-muted)] flex items-center gap-1">
                      <Clock className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>{t('signedDownload.meta.validityLabel')}</span>
                    </dt>
                    <dd className="font-medium text-[var(--color-text)]">
                      {t('signedDownload.meta.validityValue')}
                    </dd>
                  </div>

                  <div className="space-y-0.5 sm:col-span-2">
                    <dt className="text-[11px] text-[var(--color-muted)]">
                      {t('signedDownload.meta.providerLabel')}
                    </dt>
                    <dd className="font-medium text-[var(--color-text)]">
                      {outcome.storageProvider === 's3'
                        ? t('signedDownload.meta.providerS3')
                        : t('signedDownload.meta.providerLocal')}
                    </dd>
                  </div>

                  {outcome.presignedS3Url ? (
                    <div className="space-y-1 sm:col-span-2 pt-1">
                      <dt className="text-[11px] text-[var(--color-muted)]">
                        {t('signedDownload.meta.presignedS3Label')}
                      </dt>
                      <dd className="flex items-center gap-2">
                        <code
                          dir="ltr"
                          className="flex-1 text-left text-[11px] font-mono bg-[var(--color-surface)] border border-[var(--color-border)] rounded px-2 py-1 truncate text-[var(--color-text)]"
                        >
                          {outcome.presignedS3Url}
                        </code>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() =>
                            void handleCopyS3PresignedUrl(outcome.presignedS3Url!)
                          }
                          startIcon={
                            copiedS3Url ? (
                              <Check className="w-3.5 h-3.5" />
                            ) : (
                              <Copy className="w-3.5 h-3.5" />
                            )
                          }
                        >
                          {copiedS3Url
                            ? t('signedDownload.actions.copiedS3Url')
                            : t('signedDownload.actions.copyS3Url')}
                        </Button>
                      </dd>
                    </div>
                  ) : null}
                </dl>
              </div>

              <div className="flex flex-wrap items-center gap-2.5 pt-1">
                <Button
                  variant="primary"
                  onClick={() => void handleManualRedownload()}
                  disabled={isRedownloading}
                  startIcon={<Download className="w-4 h-4" />}
                >
                  {t('signedDownload.actions.downloadAgain')}
                </Button>

                <Button
                  variant="outline"
                  onClick={() => void handleCopySignedUrl()}
                  startIcon={copiedUrl ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                >
                  {copiedUrl
                    ? t('signedDownload.actions.copied')
                    : t('signedDownload.actions.copyLink')}
                </Button>

                <Button
                  variant="secondary"
                  onClick={() =>
                    navigateToHash(`/content/${encodeURIComponent(outcome.contentSlug)}`)
                  }
                  startIcon={<ArrowRight className="w-4 h-4" />}
                >
                  {t('signedDownload.actions.backToContent')}
                </Button>
              </div>

              {copiedUrl && (
                <p role="status" className="text-xs font-medium text-[var(--color-success-text)] flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                  <span>{t('signedDownload.actions.copied')}</span>
                </p>
              )}
            </div>
          ) : (
            <div className="space-y-5">
              <div className="flex items-start gap-3 p-4 rounded-[var(--radius-control)] bg-[var(--color-error-bg)] border border-[var(--color-border)] text-[var(--color-error-text)]">
                <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" aria-hidden="true" />
                <p className="text-sm font-semibold leading-relaxed">
                  {outcome && !outcome.ok
                    ? t(`signedDownload.error.${outcome.errorCode}` as ResourceKey)
                    : t('signedDownload.error.TOKEN_INVALID')}
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                {outcome && !outcome.ok && outcome.contentSlug ? (
                  <Button
                    variant="primary"
                    onClick={() =>
                      navigateToHash(`/content/${encodeURIComponent(outcome.contentSlug!)}`)
                    }
                    startIcon={<ArrowRight className="w-4 h-4" />}
                  >
                    {t('signedDownload.actions.backToContent')}
                  </Button>
                ) : null}

                <Button
                  variant="outline"
                  onClick={() => navigateToHash('/content')}
                  startIcon={<ArrowRight className="w-4 h-4" />}
                >
                  {t('signedDownload.actions.backToBank')}
                </Button>
              </div>
            </div>
          )}
        </section>
      </div>
    </MainLayout>
  );
}
