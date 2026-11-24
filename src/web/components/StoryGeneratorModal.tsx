import { Download, Image as ImageIcon, Loader2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { AppUser } from '../../core/domain/auth';
import type { ContentItem } from '../../core/domain/content';
import {
  STORY_HEIGHT,
  STORY_QUOTE_MAX_LENGTH,
  STORY_TEMPLATE_KEYS,
  STORY_TITLE_MAX_LENGTH,
  STORY_WIDTH,
  type StoryRenderPayload,
  type StoryTemplateKey,
} from '../../core/domain/story';
import type { AgeGroup } from '../../core/domain/taxonomy';
import { toPersianDigits } from '../resources/formatters';
import type { ResourceKey } from '../resources/fa';
import { t } from '../resources/i18n';
import { appContainer } from '../services/appContainer';
import {
  renderStoryToCanvasAsync,
  renderStoryToPngBlobAsync,
} from '../services/storyCanvasRenderer';
import { Button, Modal } from './ui';

export interface StoryGeneratorModalProps {
  open: boolean;
  onClose: () => void;
  content: ContentItem;
  topicName: string | null;
  keyExcerpts?: string | null;
  currentUser: AppUser | null;
  activeAgeGroup: AgeGroup | null;
  siteTitle: string;
}

function bytesToDataUrlAsync(
  bytes: Uint8Array,
  mimeType: string,
): Promise<string | null> {
  return new Promise((resolve) => {
    try {
      const copy = new Uint8Array(bytes.byteLength);
      copy.set(bytes);
      const blob = new Blob([copy.buffer], { type: mimeType || 'image/jpeg' });
      const reader = new FileReader();
      reader.onload = () => {
        resolve(typeof reader.result === 'string' ? reader.result : null);
      };
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    } catch {
      resolve(null);
    }
  });
}

function resolveCurrentPublicHost(): string {
  if (typeof window === 'undefined') {
    return 'meraj-andisheh.ir';
  }
  return window.location.host || 'meraj-andisheh.ir';
}

export function StoryGeneratorModal({
  open,
  onClose,
  content,
  topicName,
  keyExcerpts,
  currentUser,
  activeAgeGroup,
  siteTitle,
}: StoryGeneratorModalProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const [template, setTemplate] = useState<StoryTemplateKey>('cinematic-dark');
  const [showTitle, setShowTitle] = useState<boolean>(true);
  const [title, setTitle] = useState<string>('');
  const [quote, setQuote] = useState<string>('');
  const [resolvedTopicName, setResolvedTopicName] = useState<string | null>(null);
  const [resolvedSiteTitle, setResolvedSiteTitle] = useState<string>(siteTitle);
  const [resolvedSiteUrl, setResolvedSiteUrl] = useState<string>('meraj-andisheh.ir');
  const [thumbnailDataUrl, setThumbnailDataUrl] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [feedback, setFeedback] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    const defaults = appContainer.storyService.prepareStoryDefaults({
      content,
      topicName,
      keyExcerpts,
      siteTitle,
      siteUrl: resolveCurrentPublicHost(),
    });

    setTemplate(defaults.template);
    setShowTitle(defaults.showTitle);
    setTitle(defaults.title);
    setQuote(defaults.quote);
    setResolvedTopicName(defaults.topicName);
    setResolvedSiteTitle(defaults.siteTitle);
    setResolvedSiteUrl(defaults.siteUrl);
    setFeedback(null);
  }, [open, content, topicName, keyExcerpts, siteTitle]);

  useEffect(() => {
    if (!open || !content.thumbnailKey) {
      setThumbnailDataUrl(null);
      return;
    }

    let active = true;
    void (async () => {
      const media = await appContainer.fileUploadService.openPublicMediaAsync(
        content.thumbnailKey!,
      );
      if (!active || !media.ok || !media.bytes || !media.metadata) {
        if (active) {
          setThumbnailDataUrl(null);
        }
        return;
      }
      const dataUrl = await bytesToDataUrlAsync(
        media.bytes,
        media.metadata.mimeType,
      );
      if (active) {
        setThumbnailDataUrl(dataUrl);
      }
    })();

    return () => {
      active = false;
    };
  }, [open, content.thumbnailKey]);

  const payload = useMemo<StoryRenderPayload>(
    () => ({
      template,
      showTitle,
      title,
      quote,
      topicName: resolvedTopicName,
      siteTitle: resolvedSiteTitle,
      siteUrl: resolvedSiteUrl,
      thumbnailDataUrl,
    }),
    [
      template,
      showTitle,
      title,
      quote,
      resolvedTopicName,
      resolvedSiteTitle,
      resolvedSiteUrl,
      thumbnailDataUrl,
    ],
  );

  useEffect(() => {
    if (!open || !canvasRef.current) {
      return;
    }

    let cancelled = false;
    const canvas = canvasRef.current;

    void renderStoryToCanvasAsync(canvas, payload).catch(() => {
      if (!cancelled) {
        setFeedback({
          type: 'error',
          text: t('story.modal.error.renderFailed'),
        });
      }
    });

    return () => {
      cancelled = true;
    };
  }, [open, payload]);

  const handleDownloadStoryPng = async () => {
    setIsGenerating(true);
    setFeedback(null);

    try {
      const rendered = await renderStoryToPngBlobAsync(payload);

      const recordResult =
        await appContainer.storyService.recordStoryDownloadAsync({
          currentUser,
          contentId: content.id,
          activeAgeGroup,
        });

      if (!recordResult.ok) {
        const errKey = `story.modal.error.${recordResult.errorCode}` as ResourceKey;
        setFeedback({
          type: 'error',
          text: t(errKey),
        });
        return;
      }

      if (typeof document !== 'undefined') {
        const downloadUrl = URL.createObjectURL(rendered.blob);
        try {
          const anchor = document.createElement('a');
          anchor.href = downloadUrl;
          anchor.download = `story-${content.slug || content.id}.png`;
          anchor.style.display = 'none';
          document.body.appendChild(anchor);
          anchor.click();
          document.body.removeChild(anchor);
        } finally {
          window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);
        }
      }

      setFeedback({
        type: 'success',
        text: t('story.modal.successMessage', {
          width: toPersianDigits(rendered.width),
          height: toPersianDigits(rendered.height),
        }),
      });
    } catch {
      setFeedback({
        type: 'error',
        text: t('story.modal.error.renderFailed'),
      });
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('story.modal.title')}
      maxWidthClass="max-w-4xl"
      footer={
        <>
          <Button variant="outline" size="sm" onClick={onClose} disabled={isGenerating}>
            {t('story.modal.closeButton')}
          </Button>
          <Button
            variant="primary"
            size="sm"
            disabled={isGenerating}
            onClick={() => void handleDownloadStoryPng()}
            startIcon={
              isGenerating ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Download className="w-4 h-4" />
              )
            }
          >
            {isGenerating
              ? t('story.modal.generatingButton')
              : t('story.modal.downloadButton')}
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-1 md:grid-cols-12 gap-5 items-start">
        {/* Controls Column */}
        <div className="md:col-span-7 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-[var(--color-border)] text-xs text-[var(--color-muted)] tabular-nums-strict">
            <span className="inline-flex items-center gap-1.5 font-medium text-[var(--color-text)]">
              <ImageIcon className="w-4 h-4 text-[var(--color-primary)] shrink-0" aria-hidden="true" />
              <span>{t('story.modal.templateLabel')}</span>
            </span>
            <span>
              {t('story.modal.dimensionsBadge', {
                width: toPersianDigits(STORY_WIDTH),
                height: toPersianDigits(STORY_HEIGHT),
              })}
            </span>
          </div>

          {/* 3 Template Selection Controls */}
          <div
            role="radiogroup"
            aria-label={t('story.modal.templateLabel')}
            className="grid grid-cols-1 sm:grid-cols-3 gap-2.5"
          >
            {STORY_TEMPLATE_KEYS.map((tplKey) => {
              const isSelected = template === tplKey;
              const nameKey = `story.template.${tplKey}.name` as ResourceKey;
              const descKey = `story.template.${tplKey}.desc` as ResourceKey;
              return (
                <button
                  key={tplKey}
                  type="button"
                  role="radio"
                  aria-checked={isSelected}
                  onClick={() => setTemplate(tplKey)}
                  className={`text-right p-3 rounded-[var(--radius-control)] border transition-colors min-h-[44px] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--color-primary)] ${
                    isSelected
                      ? 'border-[var(--color-primary)] bg-[var(--color-surface-alt)] text-[var(--color-text)]'
                      : 'border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)] hover:border-[var(--color-border-strong)]'
                  }`}
                >
                  <p className="text-xs sm:text-sm font-bold leading-snug">
                    {t(nameKey)}
                  </p>
                  <p className="text-[11px] text-[var(--color-muted)] mt-1 leading-relaxed">
                    {t(descKey)}
                  </p>
                </button>
              );
            })}
          </div>

          {/* Toggle Show/Hide Title */}
          <label className="flex items-center justify-between gap-3 p-3 rounded-[var(--radius-control)] border border-[var(--color-border)] bg-[var(--color-surface-alt)] cursor-pointer select-none min-h-[44px]">
            <span className="text-xs sm:text-sm font-semibold text-[var(--color-text)]">
              {t('story.modal.showTitleLabel')}
            </span>
            <input
              type="checkbox"
              checked={showTitle}
              onChange={(e) => setShowTitle(e.target.checked)}
              className="w-4 h-4 accent-[var(--color-primary)] cursor-pointer"
            />
          </label>

          {/* Editable Title Input */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2 text-xs">
              <label
                htmlFor="story-title-input"
                className="font-semibold text-[var(--color-text)]"
              >
                {t('story.modal.titleInputLabel')}
              </label>
              <span className="text-[var(--color-muted)] tabular-nums-strict">
                {t('story.modal.charCounter', {
                  current: toPersianDigits(title.length),
                  max: toPersianDigits(STORY_TITLE_MAX_LENGTH),
                })}
              </span>
            </div>
            <input
              id="story-title-input"
              type="text"
              value={title}
              maxLength={STORY_TITLE_MAX_LENGTH}
              disabled={!showTitle}
              placeholder={t('story.modal.titleInputPlaceholder')}
              onChange={(e) => setTitle(e.target.value.slice(0, STORY_TITLE_MAX_LENGTH))}
              className="w-full min-h-[42px] px-3 py-2 text-xs sm:text-sm rounded-[var(--radius-control)] border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)] placeholder:text-[var(--color-muted)] focus-visible:outline-2 focus-visible:outline-[var(--color-primary)] disabled:opacity-50"
            />
          </div>

          {/* Editable Quote / Excerpt Textarea */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2 text-xs">
              <label
                htmlFor="story-quote-input"
                className="font-semibold text-[var(--color-text)]"
              >
                {t('story.modal.quoteInputLabel')}
              </label>
              <span className="text-[var(--color-muted)] tabular-nums-strict">
                {t('story.modal.charCounter', {
                  current: toPersianDigits(quote.length),
                  max: toPersianDigits(STORY_QUOTE_MAX_LENGTH),
                })}
              </span>
            </div>
            <textarea
              id="story-quote-input"
              rows={4}
              value={quote}
              maxLength={STORY_QUOTE_MAX_LENGTH}
              placeholder={t('story.modal.quoteInputPlaceholder')}
              onChange={(e) => setQuote(e.target.value.slice(0, STORY_QUOTE_MAX_LENGTH))}
              className="w-full px-3 py-2 text-xs sm:text-sm rounded-[var(--radius-control)] border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)] placeholder:text-[var(--color-muted)] focus-visible:outline-2 focus-visible:outline-[var(--color-primary)] leading-relaxed resize-y"
            />
          </div>

          {feedback && (
            <p
              role="status"
              className={`p-3 rounded-[var(--radius-control)] border text-xs sm:text-sm font-medium ${
                feedback.type === 'success'
                  ? 'border-[var(--color-success-border)] bg-[var(--color-success-bg)] text-[var(--color-success-text)]'
                  : 'border-[var(--color-error-border)] bg-[var(--color-error-bg)] text-[var(--color-error-text)]'
              }`}
            >
              {feedback.text}
            </p>
          )}
        </div>

        {/* Live 9:16 Preview Column */}
        <div className="md:col-span-5 flex flex-col items-center space-y-2.5">
          <div className="w-full max-w-[260px] flex items-center justify-between text-xs text-[var(--color-muted)]">
            <span className="font-semibold text-[var(--color-text)]">
              {t('story.modal.previewHeading')}
            </span>
          </div>

          <canvas
            ref={canvasRef}
            width={STORY_WIDTH}
            height={STORY_HEIGHT}
            aria-label={t('story.modal.previewHeading')}
            className="w-full max-w-[260px] aspect-[9/16] rounded-[var(--radius-control)] border border-[var(--color-border-strong)] shadow-[var(--shadow-card)] bg-[#090E1A] block"
          />

          <p className="text-[11px] text-center text-[var(--color-muted)] max-w-[260px] tabular-nums-strict">
            {t('story.modal.previewHint', {
              width: toPersianDigits(STORY_WIDTH),
              height: toPersianDigits(STORY_HEIGHT),
            })}
          </p>
        </div>
      </div>
    </Modal>
  );
}
