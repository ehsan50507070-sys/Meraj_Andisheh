import { Activity, ArrowLeft, Layers } from 'lucide-react';
import { envConfig } from '../../infrastructure/config/envConfig';
import { MainLayout } from '../layouts/MainLayout';
import { t } from '../resources/i18n';
import { navigateToHash } from '../router/HashRouter';
import { Button } from '../components/ui';

interface HomePageProps {
  currentRoute: string;
}

export function HomePage({ currentRoute }: HomePageProps) {
  return (
    <MainLayout currentRoute={currentRoute}>
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-12 space-y-8">
        <section className="space-y-3 border-b border-[var(--color-border)] pb-6">
          <p className="text-xs font-medium text-[var(--color-muted)]">{t('home.badge')}</p>
          <h1 className="text-2xl sm:text-3xl font-bold text-[var(--color-text)] text-balance">
            {t('home.title')}
          </h1>
          <p className="text-sm sm:text-base text-[var(--color-muted)] max-w-2xl leading-relaxed">
            {t('home.description')}
          </p>
        </section>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-stretch">
          <section className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-card)] shadow-[var(--shadow-card)] p-6 flex flex-col justify-between gap-5">
            <div className="space-y-2.5">
              <div className="inline-flex items-center gap-2 text-[var(--color-text)]">
                <Activity className="w-5 h-5 text-[var(--color-primary)] shrink-0" aria-hidden="true" />
                <h2 className="text-lg font-bold">{t('home.card.healthTitle')}</h2>
              </div>
              <p className="text-sm text-[var(--color-muted)] leading-relaxed">
                {t('home.card.healthDesc')}
              </p>
            </div>

            <div>
              <Button
                variant="primary"
                onClick={() => navigateToHash('/health')}
                endIcon={<ArrowLeft className="w-4 h-4" />}
              >
                {t('home.card.healthAction')}
              </Button>
            </div>
          </section>

          {envConfig.isDevPreview && (
            <section className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-card)] shadow-[var(--shadow-card)] p-6 flex flex-col justify-between gap-5">
              <div className="space-y-2.5">
                <div className="inline-flex items-center gap-2 text-[var(--color-text)]">
                  <Layers className="w-5 h-5 text-[var(--color-accent)] shrink-0" aria-hidden="true" />
                  <h2 className="text-lg font-bold">{t('home.card.labTitle')}</h2>
                </div>
                <p className="text-sm text-[var(--color-muted)] leading-relaxed">
                  {t('home.card.labDesc')}
                </p>
              </div>

              <div>
                <Button
                  variant="secondary"
                  onClick={() => navigateToHash('/dev/components')}
                  endIcon={<ArrowLeft className="w-4 h-4" />}
                >
                  {t('home.card.labAction')}
                </Button>
              </div>
            </section>
          )}
        </div>
      </div>
    </MainLayout>
  );
}
