import { ArrowRight, Image as ImageIcon, ShieldOff } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { StoredFileMetadata } from '../../core/domain/storage';
import { Button, Tag } from '../components/ui';
import { MainLayout } from '../layouts/MainLayout';
import { toPersianDigits } from '../resources/formatters';
import type { ResourceKey } from '../resources/fa';
import { t } from '../resources/i18n';
import { navigateToHash } from '../router/HashRouter';
import { appContainer } from '../services/appContainer';

interface PublicMediaPageProps {
  currentRoute: string;
  storageKey: string;
}

function formatSizePersian(bytes: number): string {
  if (bytes >= 1024 * 1024) {
    return t('storage.size.mb', {
      value: toPersianDigits((bytes / (1024 * 1024)).toFixed(2)),
    });
  }
  if (bytes >= 1024) {
    return t('storage.size.kb', {
      value: toPersianDigits((bytes / 1024).toFixed(1)),
    });
  }
  return t('storage.size.bytes', { value: toPersianDigits(bytes) });
}

export function PublicMediaPage({ currentRoute, storageKey }: PublicMediaPageProps) {
  const [status, setStatus] = useState<'loading' | 'ready' | 'denied'>('loading');
  const [metadata, setMetadata] = useState<StoredFileMetadata | null>(null);
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [errorKey, setErrorKey] = useState<ResourceKey>('media.public.denied');

  useEffect(() => {
    let cancelled = false;
    let createdUrl: string | null = null;

    const loadMedia = async () => {
      setStatus('loading');
      await appContainer.ensureInitializedAtStartup();
      const res = await appContainer.fileUploadService.openPublicMediaAsync(storageKey);

      if (cancelled) {
        return;
      }

      if (!res.ok || !res.bytes || !res.metadata) {
        setMetadata(null);
        setObjectUrl(null);
        setErrorKey((res.messageKey as ResourceKey) ?? 'media.public.denied');
        setStatus('denied');
        return;
      }

      const payload = new Uint8Array(res.bytes.byteLength);
      payload.set(res.bytes);
      const blob = new Blob([payload], { type: res.metadata.mimeType });
      createdUrl = URL.createObjectURL(blob);

      setMetadata(res.metadata);
      setObjectUrl(createdUrl);
      setStatus('ready');
    };

    void loadMedia();

    return () => {
      cancelled = true;
      if (createdUrl) {
        URL.revokeObjectURL(createdUrl);
      }
    };
  }, [storageKey]);

  return (
    <MainLayout currentRoute={currentRoute}>
      <div className="max-w-3xl mx-auto px-4 py-10">
        {status === 'loading' ? (
          <div className="min-h-[30vh]" />
        ) : status === 'denied' || !metadata || !objectUrl ? (
          <section className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-card)] shadow-[var(--shadow-card)] p-6 sm:p-8 text-center space-y-5">
            <div className="mx-auto w-14 h-14 rounded-full bg-[var(--color-error-bg)] text-[var(--color-error-text)] flex items-center justify-center">
              <ShieldOff className="w-7 h-7" aria-hidden="true" />
            </div>

            <div className="space-y-2">
              <h1 className="text-lg sm:text-xl font-bold text-[var(--color-text)]">
                {t('media.public.deniedTitle')}
              </h1>
              <p className="text-sm text-[var(--color-muted)] leading-relaxed">
                {t(errorKey)}
              </p>
            </div>

            <div className="pt-2 flex justify-center">
              <Button
                variant="primary"
                onClick={() => navigateToHash('/')}
                startIcon={<ArrowRight className="w-4 h-4" />}
              >
                {t('media.public.backHome')}
              </Button>
            </div>
          </section>
        ) : (
          <section className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-card)] shadow-[var(--shadow-card)] p-5 sm:p-6 space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-2 pb-4 border-b border-[var(--color-border)]">
              <div className="flex items-center gap-2">
                <ImageIcon className="w-5 h-5 text-[var(--color-primary)] shrink-0" aria-hidden="true" />
                <h1 className="text-lg sm:text-xl font-bold text-[var(--color-text)]">
                  {t('media.public.title')}
                </h1>
              </div>
              <Tag label={t('media.public.badge')} variant="success" />
            </div>

            <div className="rounded-[var(--radius-control)] border border-[var(--color-border)] bg-[var(--color-surface-alt)] p-4 flex items-center justify-center min-h-[180px]">
              <img
                src={objectUrl}
                alt={metadata.storageKey}
                className="max-h-[420px] w-auto object-contain rounded-[var(--radius-control)]"
              />
            </div>

            <dl className="divide-y divide-[var(--color-border)] text-xs sm:text-sm border border-[var(--color-border)] rounded-[var(--radius-control)] px-4">
              <div className="py-2.5 flex items-center justify-between gap-3">
                <dt className="text-[var(--color-muted)]">{t('media.public.metaKey')}</dt>
                <dd dir="ltr" className="font-mono text-xs text-[var(--color-text)] break-all">
                  {metadata.storageKey}
                </dd>
              </div>
              <div className="py-2.5 flex items-center justify-between gap-3">
                <dt className="text-[var(--color-muted)]">{t('media.public.metaMime')}</dt>
                <dd dir="ltr" className="font-mono text-xs text-[var(--color-text)]">
                  {metadata.mimeType}
                </dd>
              </div>
              <div className="py-2.5 flex items-center justify-between gap-3">
                <dt className="text-[var(--color-muted)]">{t('media.public.metaSize')}</dt>
                <dd className="text-[var(--color-text)] tabular-nums-strict">
                  {formatSizePersian(metadata.sizeBytes)}
                </dd>
              </div>
              <div className="py-2.5 flex items-center justify-between gap-3">
                <dt className="text-[var(--color-muted)]">{t('media.public.metaCreatedAt')}</dt>
                <dd dir="ltr" className="font-mono text-xs text-[var(--color-muted)]">
                  {appContainer.clock.toJalali(new Date(metadata.createdAt))}
                </dd>
              </div>
            </dl>

            <div>
              <Button
                variant="outline"
                onClick={() => navigateToHash('/')}
                startIcon={<ArrowRight className="w-4 h-4" />}
              >
                {t('media.public.backHome')}
              </Button>
            </div>
          </section>
        )}
      </div>
    </MainLayout>
  );
}
