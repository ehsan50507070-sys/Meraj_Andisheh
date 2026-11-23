import { BookOpen, MessageSquarePlus, Sparkles } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { HomePageData } from '../../core/services/homePageService';
import { useAuth } from '../auth/AuthContext';
import { HeroSlider } from '../components/HeroSlider';
import { HomeShelfRow } from '../components/HomeShelfRow';
import { Alert, Button } from '../components/ui';
import { useAge } from '../context/AgeContext';
import { MainLayout } from '../layouts/MainLayout';
import { t } from '../resources/i18n';
import { navigateToHash } from '../router/HashRouter';
import { appContainer } from '../services/appContainer';

export interface HomePageProps {
  currentRoute: string;
}

export function HomePage({ currentRoute }: HomePageProps) {
  const { isContentRequestsEnabled } = useAuth();
  const { activeAgeGroups, effectiveAgeGroup, isAgeReady, openAgeSelector } = useAge();

  const [homeData, setHomeData] = useState<HomePageData>({
    slides: [],
    shelves: [],
    itemsPerShelf: 12,
  });
  const [thumbnailUrls, setThumbnailUrls] = useState<Record<number, string>>({});
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!isAgeReady) {
      return;
    }

    let active = true;
    const createdUrls: string[] = [];

    const loadHomePage = async () => {
      setIsLoading(true);
      try {
        await appContainer.ensureInitializedAtStartup();
        const data = await appContainer.homePageService.getHomePageDataAsync(
          effectiveAgeGroup,
        );
        if (!active) {
          return;
        }
        setHomeData(data);

        const uniqueThumbItems = new Map<number, string>();
        for (const shelfModel of data.shelves) {
          for (const entry of shelfModel.items) {
            if (entry.item.thumbnailKey && !uniqueThumbItems.has(entry.item.id)) {
              uniqueThumbItems.set(entry.item.id, entry.item.thumbnailKey);
            }
          }
        }

        const nextUrls: Record<number, string> = {};
        await Promise.all(
          Array.from(uniqueThumbItems.entries()).map(async ([contentId, thumbKey]) => {
            const media = await appContainer.fileUploadService.openPublicMediaAsync(
              thumbKey,
            );
            if (!active || !media.ok || !media.bytes || !media.metadata) {
              return;
            }
            const copy = new Uint8Array(media.bytes.byteLength);
            copy.set(media.bytes);
            const blob = new Blob([copy.buffer], { type: media.metadata.mimeType });
            const objectUrl = URL.createObjectURL(blob);
            createdUrls.push(objectUrl);
            nextUrls[contentId] = objectUrl;
          }),
        );

        if (active) {
          setThumbnailUrls(nextUrls);
        }
      } finally {
        if (active) {
          setIsLoading(false);
        }
      }
    };

    void loadHomePage();

    return () => {
      active = false;
      for (const url of createdUrls) {
        URL.revokeObjectURL(url);
      }
    };
  }, [effectiveAgeGroup, isAgeReady]);

  const showAccountDeletedBanner = useMemo(() => {
    const qIdx = currentRoute.indexOf('?');
    if (qIdx === -1) {
      return false;
    }
    const params = new URLSearchParams(currentRoute.slice(qIdx + 1));
    return params.get('accountDeleted') === '1';
  }, [currentRoute]);

  return (
    <MainLayout currentRoute={currentRoute}>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8 space-y-8 sm:space-y-10">
        {showAccountDeletedBanner && (
          <Alert
            variant="success"
            title={t('home.accountDeletedBannerTitle')}
            message={t('home.accountDeletedBannerBody')}
            onDismiss={() => navigateToHash('/')}
          />
        )}

        {/* Active Age Context Strip */}
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 rounded-[var(--radius-control)] bg-[var(--color-surface)] border border-[var(--color-border)] text-xs sm:text-sm">
          <div className="flex items-center gap-2 text-[var(--color-text)] font-medium">
            <Sparkles
              className="w-4 h-4 text-[var(--color-primary)] shrink-0"
              aria-hidden="true"
            />
            <span>
              {effectiveAgeGroup
                ? t('home.page.activeAgeStrip', { age: effectiveAgeGroup.name })
                : t('home.page.unsetAgeStrip')}
            </span>
          </div>

          <button
            type="button"
            onClick={openAgeSelector}
            className="text-xs font-semibold text-[var(--color-primary)] hover:underline underline-offset-4 whitespace-nowrap"
          >
            {t('home.page.changeAgeLink')}
          </button>
        </div>

        {/* Hero Slider */}
        {!isLoading && homeData.slides.length > 0 && (
          <HeroSlider slides={homeData.slides} ageGroups={activeAgeGroups} />
        )}

        {/* Home Shelves */}
        {isLoading ? (
          <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-card)] p-8 text-center text-sm text-[var(--color-muted)]">
            {t('home.page.loading')}
          </div>
        ) : homeData.shelves.length === 0 ? (
          <section className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-card)] p-8 sm:p-10 text-center space-y-4">
            <BookOpen
              className="w-9 h-9 mx-auto text-[var(--color-muted)]"
              aria-hidden="true"
            />
            <div className="space-y-2 max-w-xl mx-auto">
              <h2 className="text-base sm:text-lg font-bold text-[var(--color-text)]">
                {t('home.page.emptyFallbackTitle')}
              </h2>
              <p className="text-xs sm:text-sm text-[var(--color-muted)] leading-relaxed">
                {t('home.page.emptyFallbackBody')}
              </p>
            </div>
            <div className="flex flex-wrap items-center justify-center gap-3 pt-1">
              <Button
                variant="primary"
                onClick={() => navigateToHash('/content')}
                startIcon={<BookOpen className="w-4 h-4" />}
              >
                {t('home.page.exploreCatalogButton')}
              </Button>
              {isContentRequestsEnabled && (
                <Button
                  variant="outline"
                  onClick={() => navigateToHash('/requests')}
                  startIcon={<MessageSquarePlus className="w-4 h-4" />}
                >
                  {t('home.page.requestContentButton')}
                </Button>
              )}
            </div>
          </section>
        ) : (
          <div className="space-y-9 sm:space-y-11">
            {homeData.shelves.map((shelfModel) => (
              <HomeShelfRow
                key={shelfModel.shelf.id}
                shelfModel={shelfModel}
                thumbnailUrls={thumbnailUrls}
              />
            ))}
          </div>
        )}
      </div>
    </MainLayout>
  );
}
