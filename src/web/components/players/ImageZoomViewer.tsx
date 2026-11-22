import { ExternalLink, Maximize2, X, ZoomIn, ZoomOut } from 'lucide-react';
import { useEffect, useState } from 'react';
import { formatFileSizeParts, toPersianDigits } from '../../resources/formatters';
import { t } from '../../resources/i18n';

export interface ImageZoomViewerProps {
  blobUrl: string | null;
  externalUrl: string | null;
  title: string;
  fileName?: string;
  sizeBytes?: number | null;
  isLoading: boolean;
}

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 2.5;
const ZOOM_STEP = 0.25;

export function ImageZoomViewer({
  blobUrl,
  externalUrl,
  title,
  fileName,
  sizeBytes,
  isLoading,
}: ImageZoomViewerProps) {
  const [zoom, setZoom] = useState(1);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const imageSrc = blobUrl ?? externalUrl;
  const sizeParts = formatFileSizeParts(sizeBytes);

  useEffect(() => {
    setZoom(1);
    setIsFullscreen(false);
  }, [imageSrc]);

  useEffect(() => {
    if (!isFullscreen) {
      return;
    }
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsFullscreen(false);
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [isFullscreen]);

  if (isLoading) {
    return (
      <div className="rounded-[var(--radius-card)] bg-[var(--color-surface-alt)] border border-[var(--color-border)] p-10 text-center text-sm text-[var(--color-muted)]">
        {t('contentDetail.player.loading')}
      </div>
    );
  }

  if (!imageSrc) {
    return (
      <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface-alt)] p-6 text-center text-sm text-[var(--color-muted)]">
        {t('contentDetail.player.noMedia')}
      </div>
    );
  }

  const zoomPercentLabel = t('contentDetail.image.zoomPercent', {
    percent: toPersianDigits(Math.round(zoom * 100)),
  });

  return (
    <>
      <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] overflow-hidden shadow-[var(--shadow-card)]">
        {/* Zoom Toolbar */}
        <div className="px-4 py-3 bg-[var(--color-surface-alt)] border-b border-[var(--color-border)] flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => setZoom((z) => Math.max(MIN_ZOOM, Number((z - ZOOM_STEP).toFixed(2))))}
              disabled={zoom <= MIN_ZOOM}
              aria-label={t('contentDetail.image.zoomOut')}
              className="inline-flex items-center gap-1 min-h-[38px] px-3 py-1.5 text-xs font-medium rounded-[var(--radius-control)] bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-text)] disabled:opacity-45 hover:border-[var(--color-border-strong)] whitespace-nowrap"
            >
              <ZoomOut className="w-4 h-4" aria-hidden="true" />
              <span>{t('contentDetail.image.zoomOut')}</span>
            </button>

            <button
              type="button"
              onClick={() => setZoom(1)}
              className="min-h-[38px] px-3 py-1.5 text-xs font-semibold rounded-[var(--radius-control)] bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-text)] hover:border-[var(--color-border-strong)] tabular-nums-strict whitespace-nowrap"
            >
              {t('contentDetail.image.zoomReset')}
            </button>

            <button
              type="button"
              onClick={() => setZoom((z) => Math.min(MAX_ZOOM, Number((z + ZOOM_STEP).toFixed(2))))}
              disabled={zoom >= MAX_ZOOM}
              aria-label={t('contentDetail.image.zoomIn')}
              className="inline-flex items-center gap-1 min-h-[38px] px-3 py-1.5 text-xs font-medium rounded-[var(--radius-control)] bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-text)] disabled:opacity-45 hover:border-[var(--color-border-strong)] whitespace-nowrap"
            >
              <ZoomIn className="w-4 h-4" aria-hidden="true" />
              <span>{t('contentDetail.image.zoomIn')}</span>
            </button>

            <span className="px-2 text-xs font-semibold text-[var(--color-primary)] tabular-nums-strict">
              {zoomPercentLabel}
            </span>
          </div>

          <div className="flex items-center gap-2">
            {externalUrl && !blobUrl && (
              <a
                href={externalUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 min-h-[38px] px-3 py-1.5 text-xs font-semibold text-[var(--color-primary)] hover:underline underline-offset-4 whitespace-nowrap"
              >
                <span>{t('contentDetail.player.externalCta')}</span>
                <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
              </a>
            )}
            <button
              type="button"
              onClick={() => setIsFullscreen(true)}
              className="inline-flex items-center gap-1.5 min-h-[38px] px-3 py-1.5 text-xs font-semibold rounded-[var(--radius-control)] bg-[var(--color-primary-button)] text-[var(--color-on-primary)] whitespace-nowrap"
            >
              <Maximize2 className="w-4 h-4" aria-hidden="true" />
              <span>{t('contentDetail.image.fullscreen')}</span>
            </button>
          </div>
        </div>

        {/* Scrollable Image Viewport */}
        <div className="max-h-[540px] overflow-auto bg-[var(--color-surface-alt)] p-4 flex items-center justify-center">
          <img
            src={imageSrc}
            alt={title}
            referrerPolicy="no-referrer"
            style={{
              width: `${Math.round(zoom * 100)}%`,
              maxWidth: zoom <= 1 ? '100%' : 'none',
            }}
            className="h-auto rounded-[var(--radius-control)] transition-[width] duration-150 select-none"
          />
        </div>

        {(fileName || sizeParts) && (
          <div className="px-4 py-2.5 bg-[var(--color-surface-alt)] border-t border-[var(--color-border)] flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[var(--color-muted)]">
            {fileName && (
              <span dir="ltr" className="font-mono text-[var(--color-text)] truncate max-w-[260px]">
                {fileName}
              </span>
            )}
            {fileName && sizeParts && <span aria-hidden="true">·</span>}
            {sizeParts && (
              <span className="tabular-nums-strict">
                {t(`contentDetail.sizeUnit.${sizeParts.unit}`, { value: sizeParts.value })}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Fullscreen Modal */}
      {isFullscreen && (
        <div
          className="fixed inset-0 z-50 bg-black/90 flex flex-col"
          role="dialog"
          aria-modal="true"
          aria-label={title}
        >
          <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-white/15 text-white">
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-sm font-semibold truncate">{title}</span>
              <span className="text-xs text-white/75 tabular-nums-strict shrink-0">
                {zoomPercentLabel}
              </span>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() =>
                  setZoom((z) => Math.max(MIN_ZOOM, Number((z - ZOOM_STEP).toFixed(2))))
                }
                aria-label={t('contentDetail.image.zoomOut')}
                className="min-h-[38px] px-2.5 py-1.5 rounded bg-white/10 hover:bg-white/20 text-xs font-medium"
              >
                <ZoomOut className="w-4 h-4" aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={() =>
                  setZoom((z) => Math.min(MAX_ZOOM, Number((z + ZOOM_STEP).toFixed(2))))
                }
                aria-label={t('contentDetail.image.zoomIn')}
                className="min-h-[38px] px-2.5 py-1.5 rounded bg-white/10 hover:bg-white/20 text-xs font-medium"
              >
                <ZoomIn className="w-4 h-4" aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={() => setIsFullscreen(false)}
                aria-label={t('contentDetail.image.closeFullscreen')}
                className="inline-flex items-center gap-1 min-h-[38px] px-3 py-1.5 rounded bg-white/15 hover:bg-white/25 text-xs font-semibold"
              >
                <X className="w-4 h-4" aria-hidden="true" />
                <span>{t('contentDetail.image.closeFullscreen')}</span>
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-auto p-4 flex items-center justify-center">
            <img
              src={imageSrc}
              alt={title}
              referrerPolicy="no-referrer"
              style={{
                width: `${Math.round(zoom * 100)}%`,
                maxWidth: zoom <= 1 ? '100%' : 'none',
              }}
              className="h-auto object-contain"
            />
          </div>
        </div>
      )}
    </>
  );
}
