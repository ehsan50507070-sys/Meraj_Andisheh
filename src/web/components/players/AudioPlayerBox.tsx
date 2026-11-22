import { ExternalLink, Headphones, Pause, Play, RotateCcw, RotateCw } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import {
  formatFileSizeParts,
  formatMediaSecondsPersian,
  toPersianDigits,
} from '../../resources/formatters';
import { t } from '../../resources/i18n';

export interface AudioPlayerBoxProps {
  blobUrl: string | null;
  externalUrl: string | null;
  title: string;
  fileName?: string;
  sizeBytes?: number | null;
  isLoading: boolean;
}

const SPEED_OPTIONS = [0.75, 1, 1.25, 1.5, 2] as const;

export function AudioPlayerBox({
  blobUrl,
  externalUrl,
  title,
  fileName,
  sizeBytes,
  isLoading,
}: AudioPlayerBoxProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playbackRate, setPlaybackRate] = useState(1);

  useEffect(() => {
    setIsPlaying(false);
    setCurrentTime(0);
    setDuration(0);
  }, [blobUrl]);

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.playbackRate = playbackRate;
    }
  }, [playbackRate, blobUrl]);

  const sizeParts = formatFileSizeParts(sizeBytes);

  const handleTogglePlay = async () => {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }
    if (audio.paused) {
      try {
        await audio.play();
        setIsPlaying(true);
      } catch {
        setIsPlaying(false);
      }
    } else {
      audio.pause();
      setIsPlaying(false);
    }
  };

  const handleSeekOffset = (deltaSeconds: number) => {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }
    const target = Math.max(
      0,
      Math.min(audio.currentTime + deltaSeconds, Number.isFinite(audio.duration) ? audio.duration : 0),
    );
    audio.currentTime = target;
    setCurrentTime(target);
  };

  const handleSliderChange = (value: string) => {
    const audio = audioRef.current;
    const nextSec = Number(value);
    if (!audio || !Number.isFinite(nextSec)) {
      return;
    }
    audio.currentTime = nextSec;
    setCurrentTime(nextSec);
  };

  if (isLoading) {
    return (
      <div className="rounded-[var(--radius-card)] bg-[var(--color-surface-alt)] border border-[var(--color-border)] p-6 text-center text-sm text-[var(--color-muted)]">
        {t('contentDetail.player.loading')}
      </div>
    );
  }

  if (blobUrl) {
    return (
      <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 sm:p-6 space-y-4 shadow-[var(--shadow-card)]">
        <audio
          ref={audioRef}
          src={blobUrl}
          preload="metadata"
          onLoadedMetadata={() => {
            if (audioRef.current && Number.isFinite(audioRef.current.duration)) {
              setDuration(audioRef.current.duration);
            }
          }}
          onTimeUpdate={() => {
            if (audioRef.current) {
              setCurrentTime(audioRef.current.currentTime);
            }
          }}
          onEnded={() => setIsPlaying(false)}
          onPause={() => setIsPlaying(false)}
          onPlay={() => setIsPlaying(true)}
        />

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-11 h-11 rounded-[var(--radius-control)] bg-[var(--color-surface-alt)] border border-[var(--color-border)] flex items-center justify-center shrink-0">
              <Headphones className="w-5 h-5 text-[var(--color-primary)]" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-bold text-[var(--color-text)] truncate">{title}</p>
              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-[var(--color-muted)]">
                {fileName && (
                  <span dir="ltr" className="font-mono truncate max-w-[200px]">
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
            </div>
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
                  className={`min-h-[34px] px-2.5 py-1 text-xs font-medium rounded-[var(--radius-control)] border transition-colors tabular-nums-strict whitespace-nowrap shrink-0 ${
                    active
                      ? 'bg-[var(--color-primary-button)] text-[var(--color-on-primary)] border-transparent'
                      : 'bg-[var(--color-surface-alt)] text-[var(--color-text)] border-[var(--color-border)] hover:border-[var(--color-border-strong)]'
                  }`}
                >
                  {t('contentDetail.player.speedOption', { rate: toPersianDigits(rate) })}
                </button>
              );
            })}
          </div>
        </div>

        {/* Scrubber & Time Readout */}
        <div className="space-y-2">
          <input
            type="range"
            min={0}
            max={duration > 0 ? duration : 0}
            step={0.5}
            value={Math.min(currentTime, duration || 0)}
            onChange={(e) => handleSliderChange(e.target.value)}
            aria-label={t('contentDetail.player.seekAria')}
            dir="ltr"
            className="w-full accent-[var(--color-primary)] cursor-pointer h-2 rounded-lg"
          />
          <div className="flex items-center justify-between text-xs text-[var(--color-muted)] tabular-nums-strict">
            <span>{formatMediaSecondsPersian(currentTime)}</span>
            <span>{formatMediaSecondsPersian(duration)}</span>
          </div>
        </div>

        {/* Primary Transport Controls */}
        <div className="flex flex-wrap items-center justify-center sm:justify-start gap-2 pt-1">
          <button
            type="button"
            onClick={() => void handleTogglePlay()}
            aria-label={isPlaying ? t('contentDetail.player.pause') : t('contentDetail.player.play')}
            className="inline-flex items-center justify-center gap-2 min-h-[44px] px-5 py-2 text-sm font-semibold rounded-[var(--radius-control)] bg-[var(--color-primary-button)] text-[var(--color-on-primary)] whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary)]"
          >
            {isPlaying ? (
              <Pause className="w-4 h-4" aria-hidden="true" />
            ) : (
              <Play className="w-4 h-4" aria-hidden="true" />
            )}
            <span>
              {isPlaying ? t('contentDetail.player.pause') : t('contentDetail.player.play')}
            </span>
          </button>

          <button
            type="button"
            onClick={() => handleSeekOffset(-15)}
            className="inline-flex items-center justify-center gap-1.5 min-h-[44px] px-3.5 py-2 text-xs sm:text-sm font-medium rounded-[var(--radius-control)] bg-[var(--color-surface-alt)] text-[var(--color-text)] border border-[var(--color-border)] hover:border-[var(--color-border-strong)] whitespace-nowrap shrink-0"
          >
            <RotateCw className="w-4 h-4" aria-hidden="true" />
            <span>{t('contentDetail.player.backward15')}</span>
          </button>

          <button
            type="button"
            onClick={() => handleSeekOffset(15)}
            className="inline-flex items-center justify-center gap-1.5 min-h-[44px] px-3.5 py-2 text-xs sm:text-sm font-medium rounded-[var(--radius-control)] bg-[var(--color-surface-alt)] text-[var(--color-text)] border border-[var(--color-border)] hover:border-[var(--color-border-strong)] whitespace-nowrap shrink-0"
          >
            <RotateCcw className="w-4 h-4" aria-hidden="true" />
            <span>{t('contentDetail.player.forward15')}</span>
          </button>
        </div>
      </div>
    );
  }

  if (externalUrl) {
    return (
      <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface-alt)] p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-start gap-3 min-w-0">
          <Headphones className="w-6 h-6 text-[var(--color-primary)] shrink-0 mt-0.5" aria-hidden="true" />
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
          className="inline-flex items-center justify-center gap-2 min-h-[44px] px-5 py-2.5 text-sm font-semibold rounded-[var(--radius-control)] bg-[var(--color-primary-button)] text-[var(--color-on-primary)] whitespace-nowrap shrink-0"
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
