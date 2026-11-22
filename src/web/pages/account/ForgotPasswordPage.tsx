import { useState, type FormEvent } from 'react';
import { Alert, Button, FormField } from '../../components/ui';
import { MainLayout } from '../../layouts/MainLayout';
import type { ResourceKey } from '../../resources/fa';
import { t } from '../../resources/i18n';
import { navigateToHash } from '../../router/HashRouter';
import { appContainer } from '../../services/appContainer';

interface ForgotPasswordPageProps {
  currentRoute: string;
}

export function ForgotPasswordPage({ currentRoute }: ForgotPasswordPageProps) {
  const [email, setEmail] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setErrorMessage(null);
    setSuccessMessage(null);
    setIsSubmitting(true);

    try {
      const result = await appContainer.authService.requestPasswordReset(email);
      if (!result.ok) {
        setErrorMessage(t((result.messageKey ?? 'auth.error.invalidEmail') as ResourceKey));
        return;
      }
      setSuccessMessage(t((result.messageKey ?? 'auth.forgot.neutralSuccess') as ResourceKey));
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
              {t('auth.forgot.title')}
            </h1>
            <p className="text-xs sm:text-sm text-[var(--color-muted)] leading-relaxed">
              {t('auth.forgot.subtitle')}
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4" noValidate>
            {errorMessage && <Alert variant="error" message={errorMessage} />}
            {successMessage && (
              <div className="space-y-3">
                <Alert variant="success" message={successMessage} />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => navigateToHash('/health')}
                >
                  {t('auth.register.goToHealthLogs')}
                </Button>
              </div>
            )}

            <FormField
              id="forgot-email"
              type="email"
              label={t('auth.field.emailLabel')}
              value={email}
              onChange={setEmail}
              placeholder={t('auth.field.emailPlaceholder')}
              required
            />

            <Button type="submit" variant="primary" fullWidth disabled={isSubmitting}>
              {isSubmitting ? t('auth.forgot.submitting') : t('auth.forgot.submit')}
            </Button>
          </form>

          <div className="pt-4 border-t border-[var(--color-border)] text-xs sm:text-sm">
            <a
              href="#/account/login"
              className="text-[var(--color-primary)] font-medium hover:underline underline-offset-4"
            >
              {t('auth.forgot.backToLogin')}
            </a>
          </div>
        </section>
      </div>
    </MainLayout>
  );
}
