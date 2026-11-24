import { ArrowRight, BookOpen, FileText } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { StaticPage } from '../../core/domain/layout';
import { SanitizedArticleBody } from '../components/players/SanitizedArticleBody';
import { Breadcrumb, Button, type BreadcrumbItem } from '../components/ui';
import { useAuth } from '../auth/AuthContext';
import { usePageMeta } from '../hooks/usePageMeta';
import { MainLayout } from '../layouts/MainLayout';
import { t } from '../resources/i18n';
import { navigateToHash } from '../router/HashRouter';
import { appContainer } from '../services/appContainer';
import { NotFoundPage } from './NotFoundPage';

export interface StaticPageViewProps {
  currentRoute: string;
  slug: string;
}

export function StaticPageView({ currentRoute, slug }: StaticPageViewProps) {
  const { siteTitle } = useAuth();
  const [page, setPage] = useState<StaticPage | null>(null);
  const [isNotFound, setIsNotFound] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  usePageMeta({
    currentRoute,
    siteTitle,
    pageTitle: page?.title ?? null,
  });

  useEffect(() => {
    let active = true;

    const loadPage = async () => {
      setIsLoading(true);
      setIsNotFound(false);
      try {
        await appContainer.ensureInitializedAtStartup();
        const found = await appContainer.layoutManagementService.getPublicStaticPageBySlug(
          slug,
        );
        if (!active) {
          return;
        }
        if (!found) {
          setPage(null);
          setIsNotFound(true);
          return;
        }
        setPage(found);
        setIsNotFound(false);
      } finally {
        if (active) {
          setIsLoading(false);
        }
      }
    };

    void loadPage();

    return () => {
      active = false;
    };
  }, [slug]);

  if (isNotFound && !isLoading) {
    return <NotFoundPage currentRoute={currentRoute} />;
  }

  const breadcrumbItems: BreadcrumbItem[] = [
    { label: t('staticPage.breadcrumbHome'), href: '#/' },
    { label: page?.title ?? '...' },
  ];

  return (
    <MainLayout currentRoute={currentRoute}>
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8 space-y-6">
        {isLoading ? (
          <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-card)] p-8 text-center text-sm text-[var(--color-muted)]">
            {t('staticPage.loading')}
          </div>
        ) : (
          page && (
            <>
              <Breadcrumb
                items={breadcrumbItems}
                ariaLabel={t('staticPage.breadcrumbHome')}
              />

              <article className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-card)] shadow-[var(--shadow-card)] p-5 sm:p-8 space-y-6">
                <header className="space-y-2.5 border-b border-[var(--color-border)] pb-5">
                  <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--color-primary)]">
                    <FileText className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                    <span>{t('staticPage.badge')}</span>
                  </div>
                  <h1 className="text-xl sm:text-3xl font-bold text-[var(--color-text)] leading-snug tracking-tight">
                    {page.title}
                  </h1>
                </header>

                <div className="pt-1">
                  <SanitizedArticleBody html={page.body} />
                </div>

                <footer className="pt-6 border-t border-[var(--color-border)] flex flex-wrap items-center gap-3">
                  <Button
                    variant="outline"
                    onClick={() => navigateToHash('/')}
                    startIcon={<ArrowRight className="w-4 h-4" />}
                  >
                    {t('staticPage.backHomeButton')}
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => navigateToHash('/content')}
                    startIcon={<BookOpen className="w-4 h-4" />}
                  >
                    {t('staticPage.browseCatalogButton')}
                  </Button>
                </footer>
              </article>
            </>
          )
        )}
      </div>
    </MainLayout>
  );
}
