import { useState, type FormEvent } from 'react';
import { Alert, Button, FormField } from '../../components/ui';
import { MainLayout } from '../../layouts/MainLayout';
import type { ResourceKey } from '../../resources/fa';
import { t } from '../../resources/i18n';
import { navigateToHash } from '../../router/HashRouter';
import { appContainer } from '../../services/appContainer';

interface ResetPasswordPageProps {
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

export function ResetPasswordPage({ currentRoute }: ResetPasswordPageProps) {
  const { uid, token } = parseQueryParamsFromHash(currentRoute);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSuccess, setIsSuccess] = useState(false);

  const hasParams = uid > 0 && token.trim().length > 0;

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setErrorMessage(null);

    if (newPassword !== confirmPassword) {
      setErrorMessage(t('auth.error.passwordMismatch'));
      return;
    }

    setIsSubmitting(true);
    try {
      const result = await appContainer.authService.resetPassword({
        userId: uid,
        rawToken: token,
        newPassword,
      });

      if (!result.ok) {
        setErrorMessage(
          t((result.messageKey ?? 'auth.error.invalidOrExpiredToken') as ResourceKey),
        );
        return;
      }

      setIsSuccess(true);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <MainLayout currentRoute={currentRoute}>
      <div className="max-w-lg mx-auto px-4 py-8 sm:py-12">
        <section className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-card)] shadow-[var(--shadow-card)] p-6 sm:p-8 space-y-6">
          <div className="space-y-1.5 border-b border-[var(--color-border)] pb-4">
            <h1 className="text-xl sm:text-2xl font-bold text-[var(--color-text)]">
              {t('auth.reset.title')}
            </h1>
            <p className="text-xs sm:text-sm text-[var(--color-muted)] leading-relaxed">
              {t('auth.reset.subtitle')}
            </p>
          </div>

          {!hasParams ? (
            <Alert variant="error" message={t('auth.reset.missingParams')} />
          ) : isSuccess ? (
            <div className="space-y-4">
              <Alert
                variant="success"
                title={t('auth.reset.successTitle')}
                message={t('auth.reset.successBody')}
              />
              <Button variant="primary" onClick={() => navigateToHash('/account/login')}>
                {t('auth.confirm.goToLogin')}
              </Button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4" noValidate>
              {errorMessage && <Alert variant="error" message={errorMessage} />}

              <FormField
                id="reset-new-password"
                type="password"
                label={t('auth.field.newPasswordLabel')}
                value={newPassword}
                onChange={setNewPassword}
                placeholder={t('auth.field.passwordPlaceholder')}
                required
              />

              <FormField
                id="reset-confirm-password"
                type="password"
                label={t('auth.field.confirmPasswordLabel')}
                value={confirmPassword}
                onChange={setConfirmPassword}
                placeholder={t('auth.field.passwordPlaceholder')}
                required
              />

              <Button type="submit" variant="primary" fullWidth disabled={isSubmitting}>
                {isSubmitting ? t('auth.reset.submitting') : t('auth.reset.submit')}
              </Button>
            </form>
          )}
        </section>
      </div>
    </MainLayout>
  );
}
