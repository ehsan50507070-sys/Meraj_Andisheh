import { useEffect, useState } from 'react';
import { Alert, Button } from '../../components/ui';
import { MainLayout } from '../../layouts/MainLayout';
import type { ResourceKey } from '../../resources/fa';
import { t } from '../../resources/i18n';
import { navigateToHash } from '../../router/HashRouter';
import { appContainer } from '../../services/appContainer';

interface ConfirmEmailPageProps {
  currentRoute: string;
}

function parseQueryParamsFromHash(hashRoute: string): { uid: number; token: string } {
  const queryIndex = hashRoute.indexOf('?');
  if (queryIndex === -1) {
    return { uid: 0, token: '' };
  }
  const params = new URLSearchParams(hashRoute.slice(queryIndex + 1));
  const uid = Number(params.get('uid') ?? '0');
  const token = params.get('token') ?? '';
  return { uid, token };
}

export function ConfirmEmailPage({ currentRoute }: ConfirmEmailPageProps) {
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [errorMessage, setErrorMessage] = useState<string>('');

  useEffect(() => {
    let active = true;
    const { uid, token } = parseQueryParamsFromHash(currentRoute);

    void (async () => {
      await appContainer.ensureInitializedAtStartup();
      const result = await appContainer.authService.confirmEmail({
        userId: uid,
        rawToken: token,
      });

      if (!active) return;
      if (result.ok) {
        setStatus('success');
      } else {
        setStatus('error');
        setErrorMessage(t((result.messageKey ?? 'auth.error.invalidOrExpiredToken') as ResourceKey));
      }
    })();

    return () => {
      active = false;
    };
  }, [currentRoute]);

  return (
    <MainLayout currentRoute={currentRoute}>
      <div className="max-w-lg mx-auto px-4 py-8 sm:py-12">
        <section className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-card)] shadow-[var(--shadow-card)] p-6 sm:p-8 space-y-5">
          <h1 className="text-xl sm:text-2xl font-bold text-[var(--color-text)] border-b border-[var(--color-border)] pb-4">
            {t('auth.confirm.title')}
          </h1>

          {status === 'loading' && (
            <Alert variant="info" message={t('auth.confirm.checking')} />
          )}

          {status === 'success' && (
            <Alert
              variant="success"
              title={t('auth.confirm.successTitle')}
              message={t('auth.confirm.successBody')}
            />
          )}

          {status === 'error' && (
            <Alert
              variant="error"
              title={t('auth.confirm.errorTitle')}
              message={errorMessage}
            />
          )}

          <div className="pt-2 flex flex-wrap items-center gap-3">
            <Button variant="primary" onClick={() => navigateToHash('/account/login')}>
              {t('auth.confirm.goToLogin')}
            </Button>
          </div>
        </section>
      </div>
    </MainLayout>
  );
}
