import { ExternalLink, Film } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { formatFileSizeParts, toPersianDigits } from '../../resources/formatters';
import { t } from '../../resources/i18n';

export interface VideoPlayerBoxProps {
  blobUrl: string | null;
  externalUrl: string | null;
  embedUrl: string | null;
  title: string;
  fileName?: string;
  sizeBytes?: number | null;
  isLoading: boolean;
}

const SPEED_OPTIONS = [0.75, 1, 1.25, 1.5, 2] as const;

export function VideoPlayerBox({
  blobUrl,
  externalUrl,
  embedUrl,
  title,
  fileName,
  sizeBytes,
  isLoading,
}: VideoPlayerBoxProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [playbackRate, setPlaybackRate] = useState<number>(1);

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.playbackRate = playbackRate;
    }
  }, [playbackRate, blobUrl]);

  const sizeParts = formatFileSizeParts(sizeBytes);

  if (isLoading) {
    return (
      <div className="aspect-video w-full rounded-[var(--radius-card)] bg-[var(--color-surface-alt)] border border-[var(--color-border)] flex items-center justify-center p-6 text-sm text-[var(--color-muted)]">
        {t('contentDetail.player.loading')}
      </div>
    );
  }

  if (blobUrl) {
    return (
      <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] overflow-hidden shadow-[var(--shadow-card)]">
        <div className="aspect-video w-full bg-black">
          <video
            ref={videoRef}
            src={blobUrl}
            controls
            preload="metadata"
            playsInline
            aria-label={title}
            className="w-full h-full object-contain"
          />
        </div>

        <div className="px-4 py-3 bg-[var(--color-surface-alt)] border-t border-[var(--color-border)] flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[var(--color-muted)] min-w-0">
            {fileName && (
              <span dir="ltr" className="font-mono text-[var(--color-text)] truncate max-w-[220px]">
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

          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs text-[var(--color-muted)]">
              {t('contentDetail.player.speedLabel')}:
            </span>
            {SPEED_OPTIONS.map((rate) => {
              const active = playbackRate === rate;
              return (
                <button
                  key={rate}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setPlaybackRate(rate)}
                  className={`min-h-[34px] px-2.5 py-1 text-xs font-medium rounded-[var(--radius-control)] border transition-colors tabular-nums-strict whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--color-primary)] ${
                    active
                      ? 'bg-[var(--color-primary-button)] text-[var(--color-on-primary)] border-transparent'
                      : 'bg-[var(--color-surface)] text-[var(--color-text)] border-[var(--color-border)] hover:border-[var(--color-border-strong)]'
                  }`}
                >
                  {t('contentDetail.player.speedOption', { rate: toPersianDigits(rate) })}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  if (embedUrl) {
    return (
      <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] overflow-hidden shadow-[var(--shadow-card)]">
        <div className="aspect-video w-full bg-black">
          <iframe
            src={embedUrl}
            title={title}
            allowFullScreen
            loading="lazy"
            referrerPolicy="no-referrer"
            sandbox="allow-scripts allow-same-origin allow-presentation"
            className="w-full h-full border-0"
          />
        </div>
        {externalUrl && (
          <div className="px-4 py-2.5 bg-[var(--color-surface-alt)] border-t border-[var(--color-border)] flex flex-wrap items-center justify-between gap-2 text-xs">
            <span className="text-[var(--color-muted)]">
              {t('contentDetail.player.externalHostLabel')}
            </span>
            <a
              href={externalUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 font-semibold text-[var(--color-primary)] hover:underline underline-offset-4 whitespace-nowrap"
            >
              <span>{t('contentDetail.player.externalCta')}</span>
              <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
            </a>
          </div>
        )}
      </div>
    );
  }

  if (externalUrl) {
    return (
      <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface-alt)] p-6 sm:p-8 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-start gap-3 min-w-0">
          <Film className="w-6 h-6 text-[var(--color-primary)] shrink-0 mt-0.5" aria-hidden="true" />
          <div className="space-y-1 min-w-0">
            <p className="text-sm font-semibold text-[var(--color-text)]">
              {t('contentDetail.player.externalHostLabel')}
            </p>
            <p dir="ltr" className="text-xs font-mono text-[var(--color-muted)] truncate">
              {externalUrl}
            </p>
          </div>
        </div>
        <a
          href={externalUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center justify-center gap-2 min-h-[44px] px-5 py-2.5 text-sm font-semibold rounded-[var(--radius-control)] bg-[var(--color-primary-button)] text-[var(--color-on-primary)] whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary)]"
        >
          <span>{t('contentDetail.player.externalCta')}</span>
          <ExternalLink className="w-4 h-4" aria-hidden="true" />
        </a>
      </div>
    );
  }

  return (
    <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface-alt)] p-6 text-center text-sm text-[var(--color-muted)]">
      {t('contentDetail.player.noMedia')}
    </div>
  );
}
