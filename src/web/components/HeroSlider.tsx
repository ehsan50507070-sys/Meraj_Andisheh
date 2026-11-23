import { ArrowLeft, ChevronLeft, ChevronRight, Sparkles } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { HeroSlide } from '../../core/domain/layout';
import type { AgeGroup } from '../../core/domain/taxonomy';
import { toPersianDigits } from '../resources/formatters';
import { t } from '../resources/i18n';
import { appContainer } from '../services/appContainer';

export interface HeroSliderProps {
  slides: readonly HeroSlide[];
  ageGroups: readonly AgeGroup[];
}

export function HeroSlider({ slides, ageGroups }: HeroSliderProps) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [slideImageUrls, setSlideImageUrls] = useState<Record<number, string>>({});

  useEffect(() => {
    setActiveIndex(0);
  }, [slides.length]);

  useEffect(() => {
    if (slides.length <= 1 || isPaused) {
      return;
    }
    const timer = window.setInterval(() => {
      setActiveIndex((prev) => (prev + 1) % slides.length);
    }, 6500);
    return () => window.clearInterval(timer);
  }, [slides.length, isPaused]);

  useEffect(() => {
    let active = true;
    const createdUrls: string[] = [];

    const loadSlideImages = async () => {
      const nextUrls: Record<number, string> = {};
      await Promise.all(
        slides.map(async (slide) => {
          if (!slide.imageKey) {
            return;
          }
          const res = await appContainer.fileUploadService.openPublicMediaAsync(
            slide.imageKey,
          );
          if (!active || !res.ok || !res.bytes || !res.metadata) {
            return;
          }
          const copy = new Uint8Array(res.bytes.byteLength);
          copy.set(res.bytes);
          const blob = new Blob([copy.buffer], { type: res.metadata.mimeType });
          const objectUrl = URL.createObjectURL(blob);
          createdUrls.push(objectUrl);
          nextUrls[slide.id] = objectUrl;
        }),
      );

      if (active) {
        setSlideImageUrls(nextUrls);
      }
    };

    void loadSlideImages();

    return () => {
      active = false;
      for (const url of createdUrls) {
        URL.revokeObjectURL(url);
      }
    };
  }, [slides]);

  if (slides.length === 0) {
    return null;
  }

  const safeIndex = activeIndex < slides.length ? activeIndex : 0;
  const activeSlide = slides[safeIndex];
  const imageUrl = slideImageUrls[activeSlide.id];
  const targetAgeGroup =
    activeSlide.ageGroupId !== null
      ? ageGroups.find((g) => g.id === activeSlide.ageGroupId)
      : undefined;
  const isInternalLink = activeSlide.linkUrl.startsWith('#/');

  const handlePrev = () => {
    setActiveIndex((prev) => (prev - 1 + slides.length) % slides.length);
  };

  const handleNext = () => {
    setActiveIndex((prev) => (prev + 1) % slides.length);
  };

  return (
    <section
      aria-label={t('home.slider.ariaLabel')}
      onMouseEnter={() => setIsPaused(true)}
      onMouseLeave={() => setIsPaused(false)}
      onFocus={() => setIsPaused(true)}
      onBlur={() => setIsPaused(false)}
      className="relative overflow-hidden rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-[var(--shadow-card)]"
    >
      <div className="relative min-h-[240px] sm:min-h-[300px] lg:min-h-[340px] flex flex-col justify-between p-5 sm:p-8 lg:p-10">
        {/* Background Layer:Uploaded Public Image or Subtle Theme Surface Accent */}
        {imageUrl ? (
          <>
            <img
              src={imageUrl}
              alt={activeSlide.title}
              referrerPolicy="no-referrer"
              className="absolute inset-0 w-full h-full object-cover"
            />
            <div
              aria-hidden="true"
              className="absolute inset-0 bg-gradient-to-l from-[var(--color-surface)]/95 via-[var(--color-surface)]/80 to-[var(--color-surface)]/35"
            />
          </>
        ) : (
          <div
            aria-hidden="true"
            className="absolute inset-0 bg-gradient-to-bl from-[var(--color-surface-alt)] via-[var(--color-surface)] to-[var(--color-surface-alt)]"
          />
        )}

        {/* Foreground Slide Content */}
        <div className="relative z-10 max-w-2xl space-y-3 sm:space-y-4">
          {targetAgeGroup && (
            <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-[var(--radius-control)] bg-[var(--color-surface)]/90 border border-[var(--color-border)] text-xs font-semibold text-[var(--color-primary)]">
              <Sparkles className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
              <span>{t('home.slider.ageTargetBadge', { age: targetAgeGroup.name })}</span>
            </div>
          )}

          <h1 className="text-xl sm:text-3xl lg:text-4xl font-bold text-[var(--color-text)] leading-tight tracking-tight text-balance">
            {activeSlide.title}
          </h1>

          {activeSlide.subtitle && (
            <p className="text-sm sm:text-base text-[var(--color-muted)] leading-relaxed max-w-xl">
              {activeSlide.subtitle}
            </p>
          )}
        </div>

        {/* Bottom Bar: CTA Link & Slider Navigation */}
        <div className="relative z-10 mt-6 pt-4 flex flex-wrap items-center justify-between gap-4">
          <a
            href={activeSlide.linkUrl}
            target={isInternalLink ? undefined : '_blank'}
            rel={isInternalLink ? undefined : 'noopener noreferrer'}
            className="inline-flex items-center gap-2 min-h-[42px] px-4 sm:px-5 py-2 rounded-[var(--radius-control)] bg-[var(--color-primary)] text-[var(--color-on-primary)] text-sm font-semibold hover:opacity-90 transition-opacity focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary)]"
          >
            <span>{t('home.slider.ctaLabel')}</span>
            <ArrowLeft className="w-4 h-4 shrink-0" aria-hidden="true" />
          </a>

          {slides.length > 1 && (
            <div className="flex items-center gap-2 sm:gap-3">
              <div className="flex items-center gap-1.5" role="tablist" aria-label={t('home.slider.ariaLabel')}>
                {slides.map((slide, idx) => {
                  const isCurrent = idx === safeIndex;
                  return (
                    <button
                      key={slide.id}
                      type="button"
                      role="tab"
                      aria-selected={isCurrent}
                      aria-label={t('home.slider.dotAria', {
                        index: toPersianDigits(idx + 1),
                      })}
                      onClick={() => setActiveIndex(idx)}
                      className={`h-2.5 rounded-full transition-all focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary)] ${
                        isCurrent
                          ? 'w-7 bg-[var(--color-primary)]'
                          : 'w-2.5 bg-[var(--color-border-strong)] hover:bg-[var(--color-muted)]'
                      }`}
                    />
                  );
                })}
              </div>

              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={handlePrev}
                  aria-label={t('home.slider.prevAria')}
                  className="inline-flex items-center justify-center w-9 h-9 rounded-[var(--radius-control)] border border-[var(--color-border-strong)] bg-[var(--color-surface)]/90 text-[var(--color-text)] hover:bg-[var(--color-surface-alt)] transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--color-primary)]"
                >
                  <ChevronRight className="w-4 h-4" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  onClick={handleNext}
                  aria-label={t('home.slider.nextAria')}
                  className="inline-flex items-center justify-center w-9 h-9 rounded-[var(--radius-control)] border border-[var(--color-border-strong)] bg-[var(--color-surface)]/90 text-[var(--color-text)] hover:bg-[var(--color-surface-alt)] transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--color-primary)]"
                >
                  <ChevronLeft className="w-4 h-4" aria-hidden="true" />
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
