import { ShieldCheck } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useAuth } from '../auth/AuthContext';
import { Alert, Button, FormField } from '../components/ui';
import { MainLayout } from '../layouts/MainLayout';
import type { ResourceKey } from '../resources/fa';
import { t } from '../resources/i18n';
import { navigateToHash } from '../router/HashRouter';
import { appContainer } from '../services/appContainer';

interface InitialAdminSetupPageProps {
  currentRoute: string;
}

export function InitialAdminSetupPage({ currentRoute }: InitialAdminSetupPageProps) {
  const { hasSuperAdmin, refreshAuthState } = useAuth();
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [issuedTempPassword, setIssuedTempPassword] = useState<string | null>(null);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setErrorMessage(null);
    setIsSubmitting(true);

    try {
      const result = await appContainer.initialSuperAdminService.setupInitialSuperAdmin(
        { email, displayName },
        t('setup.oneTimeLogMessage'),
      );

      if (!result.ok || !result.tempPassword) {
        setErrorMessage(t((result.messageKey ?? 'setup.error.alreadyExists') as ResourceKey));
        return;
      }

      setIssuedTempPassword(result.tempPassword);
      await refreshAuthState();
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <MainLayout currentRoute={currentRoute}>
      <div className="max-w-lg mx-auto px-4 py-8 sm:py-12">
        <section className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-card)] shadow-[var(--shadow-card)] p-6 sm:p-8 space-y-6">
          <div className="space-y-1.5 border-b border-[var(--color-border)] pb-4">
            <h1 className="text-xl sm:text-2xl font-bold text-[var(--color-text)] flex items-center gap-2">
              <ShieldCheck className="w-6 h-6 text-[var(--color-primary)] shrink-0" aria-hidden="true" />
              <span>{t('setup.title')}</span>
            </h1>
            <p className="text-xs sm:text-sm text-[var(--color-muted)] leading-relaxed">
              {t('setup.subtitle')}
            </p>
          </div>

          {issuedTempPassword ? (
            <div className="space-y-4">
              <Alert
                variant="success"
                title={t('setup.successTitle')}
                message={t('setup.successTempPasswordNotice')}
              />

              <div className="p-4 rounded-[var(--radius-control)] bg-[var(--color-surface-alt)] border border-[var(--color-border-strong)] space-y-1.5">
                <p className="text-xs font-medium text-[var(--color-muted)]">
                  {t('setup.tempPasswordLabel')}
                </p>
                <p
                  dir="ltr"
                  className="font-mono text-base sm:text-lg font-bold text-[var(--color-text)] select-all break-all"
                >
                  {issuedTempPassword}
                </p>
              </div>

              <Button variant="primary" onClick={() => navigateToHash('/account/login')}>
                {t('setup.goToLogin')}
              </Button>
            </div>
          ) : hasSuperAdmin ? (
            <div className="space-y-4">
              <Alert
                variant="info"
                title={t('setup.alreadyExistsTitle')}
                message={t('setup.alreadyExistsBody')}
              />
              <Button variant="primary" onClick={() => navigateToHash('/account/login')}>
                {t('auth.confirm.goToLogin')}
              </Button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4" noValidate>
              {errorMessage && <Alert variant="error" message={errorMessage} />}

              <FormField
                id="setup-email"
                type="email"
                label={t('setup.emailLabel')}
                value={email}
                onChange={setEmail}
                placeholder={t('auth.field.emailPlaceholder')}
                required
              />

              <FormField
                id="setup-display-name"
                label={t('setup.displayNameLabel')}
                value={displayName}
                onChange={setDisplayName}
                placeholder={t('setup.displayNamePlaceholder')}
                hint={t('auth.field.displayNameHint')}
                required
              />

              <Button type="submit" variant="primary" fullWidth disabled={isSubmitting}>
                {isSubmitting ? t('setup.submitting') : t('setup.submit')}
              </Button>
            </form>
          )}
        </section>
      </div>
    </MainLayout>
  );
}
