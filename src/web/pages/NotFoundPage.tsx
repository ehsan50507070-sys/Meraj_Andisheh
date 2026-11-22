import { MainLayout } from '../layouts/MainLayout';
import { Button } from '../components/ui';
import { t } from '../resources/i18n';
import { navigateToHash } from '../router/HashRouter';

interface NotFoundPageProps {
  currentRoute: string;
}

export function NotFoundPage({ currentRoute }: NotFoundPageProps) {
  return (
    <MainLayout currentRoute={currentRoute}>
      <div className="max-w-lg mx-auto px-4 py-16">
        <section className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-card)] shadow-[var(--shadow-card)] p-6 sm:p-8 text-center space-y-4">
          <p className="text-4xl sm:text-5xl font-extrabold text-[var(--color-primary)] tabular-nums-strict">
            {t('notFound.code')}
          </p>
          <h1 className="text-lg sm:text-xl font-bold text-[var(--color-text)]">
            {t('notFound.title')}
          </h1>
          <p className="text-sm text-[var(--color-muted)] leading-relaxed">
            {t('notFound.description')}
          </p>
          <div className="pt-2 flex flex-wrap items-center justify-center gap-3">
            <Button variant="primary" onClick={() => navigateToHash('/')}>
              {t('notFound.backHome')}
            </Button>
            <Button variant="outline" onClick={() => navigateToHash('/health')}>
              {t('notFound.backHealth')}
            </Button>
          </div>
        </section>
      </div>
    </MainLayout>
  );
}
