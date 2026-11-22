import { useState, type FormEvent } from 'react';
import { useAuth } from '../../auth/AuthContext';
import { Alert, Button, FormField } from '../../components/ui';
import { MainLayout } from '../../layouts/MainLayout';
import type { ResourceKey } from '../../resources/fa';
import { t } from '../../resources/i18n';
import { navigateToHash } from '../../router/HashRouter';
import { appContainer } from '../../services/appContainer';

interface ChangePasswordPageProps {
  currentRoute: string;
}

export function ChangePasswordPage({ currentRoute }: ChangePasswordPageProps) {
  const { currentUser, refreshAuthState, logout } = useAuth();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSuccess, setIsSuccess] = useState(false);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!currentUser) {
      return;
    }

    setErrorMessage(null);

    if (newPassword !== confirmPassword) {
      setErrorMessage(t('auth.error.passwordMismatch'));
      return;
    }

    setIsSubmitting(true);
    try {
      const result = await appContainer.authService.changePassword({
        userId: currentUser.id,
        currentPassword,
        newPassword,
      });

      if (!result.ok) {
        setErrorMessage(
          t((result.messageKey ?? 'auth.error.currentPasswordInvalid') as ResourceKey),
        );
        return;
      }

      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setIsSuccess(true);
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
            <h1 className="text-xl sm:text-2xl font-bold text-[var(--color-text)]">
              {t('auth.change.title')}
            </h1>
            <p className="text-xs sm:text-sm text-[var(--color-muted)] leading-relaxed">
              {t('auth.change.subtitle')}
            </p>
          </div>

          {!currentUser ? (
            <div className="space-y-4">
              <Alert variant="warning" message={t('auth.change.loginRequired')} />
              <Button variant="primary" onClick={() => navigateToHash('/account/login')}>
                {t('auth.confirm.goToLogin')}
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              {currentUser.mustChangePassword && (
                <Alert
                  variant="warning"
                  title={t('auth.change.mustChangeTitle')}
                  message={t('auth.change.mustChangeBody')}
                />
              )}

              {isSuccess ? (
                <div className="space-y-4">
                  <Alert
                    variant="success"
                    title={t('auth.change.successTitle')}
                    message={t('auth.change.successBody')}
                  />
                  <Button variant="primary" onClick={() => navigateToHash('/health')}>
                    {t('router.goToHealth')}
                  </Button>
                </div>
              ) : (
                <form onSubmit={handleSubmit} className="space-y-4" noValidate>
                  {errorMessage && <Alert variant="error" message={errorMessage} />}

                  <FormField
                    id="change-current-password"
                    type="password"
                    label={t('auth.field.currentPasswordLabel')}
                    value={currentPassword}
                    onChange={setCurrentPassword}
                    required
                  />

                  <FormField
                    id="change-new-password"
                    type="password"
                    label={t('auth.field.newPasswordLabel')}
                    value={newPassword}
                    onChange={setNewPassword}
                    placeholder={t('auth.field.passwordPlaceholder')}
                    required
                  />

                  <FormField
                    id="change-confirm-password"
                    type="password"
                    label={t('auth.field.confirmPasswordLabel')}
                    value={confirmPassword}
                    onChange={setConfirmPassword}
                    placeholder={t('auth.field.passwordPlaceholder')}
                    required
                  />

                  <div className="flex flex-wrap items-center gap-3 pt-1">
                    <Button type="submit" variant="primary" disabled={isSubmitting}>
                      {isSubmitting ? t('auth.change.submitting') : t('auth.change.submit')}
                    </Button>

                    {currentUser.mustChangePassword && (
                      <Button variant="outline" onClick={() => void logout()}>
                        {t('layout.header.logoutAction')}
                      </Button>
                    )}
                  </div>
                </form>
              )}
            </div>
          )}
        </section>
      </div>
    </MainLayout>
  );
}
