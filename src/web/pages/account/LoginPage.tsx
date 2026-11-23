import { useEffect, useMemo, useState, type FormEvent } from 'react';
import type { AgeGroup } from '../../../core/domain/taxonomy';
import { detectLoginIdentifier } from '../../../core/services/identifierService';
import { resolvePostLoginRedirect } from '../../../core/services/navigationGuardService';
import { envConfig } from '../../../infrastructure/config/envConfig';
import { useAuth } from '../../auth/AuthContext';
import { Alert, Button, FormField } from '../../components/ui';
import { MainLayout } from '../../layouts/MainLayout';
import { formatAgeGroupWithRange } from '../../resources/ageGroupFormatters';
import { toPersianDigits } from '../../resources/formatters';
import type { ResourceKey } from '../../resources/fa';
import { t } from '../../resources/i18n';
import { navigateToHash } from '../../router/HashRouter';
import { appContainer } from '../../services/appContainer';

interface LoginPageProps {
  currentRoute: string;
}

type UnifiedLoginStep = 'identifier' | 'otp_verify' | 'otp_register' | 'email_password';

function extractReturnUrl(currentRoute: string): string | null {
  const queryIndex = currentRoute.indexOf('?');
  if (queryIndex === -1) {
    return null;
  }
  const params = new URLSearchParams(currentRoute.slice(queryIndex + 1));
  return params.get('returnUrl');
}

export function LoginPage({ currentRoute }: LoginPageProps) {
  const { currentUser, refreshAuthState } = useAuth();
  const returnUrl = useMemo(() => extractReturnUrl(currentRoute), [currentRoute]);

  const [step, setStep] = useState<UnifiedLoginStep>('identifier');
  const [identifier, setIdentifier] = useState('');
  const [normalizedPhone, setNormalizedPhone] = useState('');
  const [normalizedEmail, setNormalizedEmail] = useState('');
  const [password, setPassword] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [cooldownSeconds, setCooldownSeconds] = useState(0);
  const [otpSentNotice, setOtpSentNotice] = useState<string | null>(null);

  const [registrationToken, setRegistrationToken] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [ageGroupId, setAgeGroupId] = useState('1');
  const [ageGroups, setAgeGroups] = useState<AgeGroup[]>([]);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showResendConfirmation, setShowResendConfirmation] = useState(false);
  const [resendFeedback, setResendFeedback] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      await appContainer.ensureInitializedAtStartup();
      const groups = await appContainer.authRepository.getActiveAgeGroups();
      if (active && groups.length > 0) {
        setAgeGroups(groups);
        setAgeGroupId(String(groups[0].id));
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (cooldownSeconds <= 0) {
      return;
    }
    const timer = window.setInterval(() => {
      setCooldownSeconds((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [cooldownSeconds]);

  const resetFeedback = () => {
    setErrorMessage(null);
    setResendFeedback(null);
    setShowResendConfirmation(false);
  };

  const formatOtpError = (
    errorCode: string | undefined,
    messageKey: string | undefined,
    remainingSeconds?: number,
    remainingAttempts?: number,
  ): string => {
    if (errorCode === 'OTP_COOLDOWN' && remainingSeconds) {
      return t('auth.otp.error.cooldown', {
        seconds: toPersianDigits(remainingSeconds),
      });
    }
    if (errorCode === 'RATE_LIMITED' && remainingSeconds) {
      return t('auth.error.rateLimited', {
        seconds: toPersianDigits(remainingSeconds),
      });
    }
    if (errorCode === 'OTP_INVALID' && typeof remainingAttempts === 'number') {
      return t('auth.otp.error.invalid', {
        remaining: toPersianDigits(remainingAttempts),
      });
    }
    return t((messageKey ?? 'auth.otp.error.invalidFormat') as ResourceKey);
  };

  const requestOtpForPhone = async (phone: string): Promise<'sent' | 'cooldown' | 'error'> => {
    const result = await appContainer.otpService.requestOtp(phone);
    if (!result.ok) {
      if (result.errorCode === 'OTP_COOLDOWN' && result.remainingSeconds) {
        setCooldownSeconds(result.remainingSeconds);
        setErrorMessage(
          formatOtpError(result.errorCode, result.messageKey, result.remainingSeconds),
        );
        return 'cooldown';
      }
      setErrorMessage(
        formatOtpError(result.errorCode, result.messageKey, result.remainingSeconds),
      );
      return 'error';
    }

    setCooldownSeconds(result.data?.cooldownSeconds ?? 60);
    setOtpSentNotice(
      t('auth.otp.sentSuccess', { phone: toPersianDigits(result.data?.phoneNumber ?? phone) }),
    );
    return 'sent';
  };

  const handleIdentifierContinue = async (event: FormEvent) => {
    event.preventDefault();
    resetFeedback();
    setOtpSentNotice(null);

    const detected = detectLoginIdentifier(identifier);
    if (detected.type === 'invalid') {
      setErrorMessage(t('auth.login.error.invalidIdentifier'));
      return;
    }

    if (detected.type === 'email') {
      setNormalizedEmail(detected.normalized);
      setPassword('');
      setStep('email_password');
      return;
    }

    setNormalizedPhone(detected.normalized);
    setOtpCode('');
    setIsSubmitting(true);
    try {
      const status = await requestOtpForPhone(detected.normalized);
      if (status === 'sent' || status === 'cooldown') {
        setStep('otp_verify');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleOtpResend = async () => {
    resetFeedback();
    setIsSubmitting(true);
    try {
      await requestOtpForPhone(normalizedPhone);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleVerifyOtp = async (event: FormEvent) => {
    event.preventDefault();
    resetFeedback();
    setIsSubmitting(true);

    try {
      const result = await appContainer.otpService.verifyOtp(
        normalizedPhone,
        otpCode,
        returnUrl,
      );

      if (!result.ok || !result.data) {
        setErrorMessage(
          formatOtpError(
            result.errorCode,
            result.messageKey,
            result.remainingSeconds,
            result.remainingAttempts,
          ),
        );
        return;
      }

      if (result.data.status === 'logged_in') {
        await refreshAuthState();
        navigateToHash(result.data.redirectTo);
        return;
      }

      setNormalizedPhone(result.data.verifiedPhone);
      setRegistrationToken(result.data.registrationToken);
      setStep('otp_register');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCompleteRegistration = async (event: FormEvent) => {
    event.preventDefault();
    resetFeedback();
    setIsSubmitting(true);

    try {
      const result = await appContainer.otpService.completeMobileRegistration({
        verifiedPhone: normalizedPhone,
        registrationToken,
        displayName,
        ageGroupId: Number(ageGroupId),
        returnUrl,
      });

      if (!result.ok || !result.data) {
        setErrorMessage(
          t((result.messageKey ?? 'auth.error.invalidOrExpiredToken') as ResourceKey),
        );
        return;
      }

      await refreshAuthState();
      navigateToHash(result.data.redirectTo);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleEmailLoginSubmit = async (event: FormEvent) => {
    event.preventDefault();
    resetFeedback();
    setIsSubmitting(true);

    try {
      const result = await appContainer.authService.loginWithEmail({
        email: normalizedEmail,
        password,
      });

      if (!result.ok || !result.data) {
        if (result.errorCode === 'EMAIL_NOT_CONFIRMED') {
          setShowResendConfirmation(true);
        }

        if (result.errorCode === 'ACCOUNT_LOCKED' && result.remainingLockMinutes) {
          setErrorMessage(
            t('auth.error.accountLocked', {
              minutes: toPersianDigits(result.remainingLockMinutes),
            }),
          );
        } else if (result.errorCode === 'RATE_LIMITED' && result.remainingSeconds) {
          setErrorMessage(
            t('auth.error.rateLimited', {
              seconds: toPersianDigits(result.remainingSeconds),
            }),
          );
        } else {
          setErrorMessage(t((result.messageKey ?? 'auth.error.invalidCredentials') as ResourceKey));
        }
        return;
      }

      await refreshAuthState();
      const target = resolvePostLoginRedirect(result.data.user, returnUrl);
      navigateToHash(target);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleResendConfirmation = async () => {
    const result = await appContainer.authService.resendConfirmationEmail(normalizedEmail);
    setResendFeedback(
      t((result.messageKey ?? 'auth.confirm.resentSuccess') as ResourceKey),
    );
  };

  const handleResetToIdentifier = () => {
    resetFeedback();
    setOtpSentNotice(null);
    setOtpCode('');
    setPassword('');
    setRegistrationToken('');
    setStep('identifier');
  };

  return (
    <MainLayout currentRoute={currentRoute}>
      <div className="max-w-lg mx-auto px-4 py-8 sm:py-12">
        <section className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-card)] shadow-[var(--shadow-card)] p-6 sm:p-8 space-y-6">
          <div className="space-y-1.5 border-b border-[var(--color-border)] pb-4">
            <h1 className="text-xl sm:text-2xl font-bold text-[var(--color-text)]">
              {t('auth.login.title')}
            </h1>
            <p className="text-xs sm:text-sm text-[var(--color-muted)] leading-relaxed">
              {t('auth.login.unifiedSubtitle')}
            </p>
          </div>

          {currentUser ? (
            <div className="space-y-4">
              <Alert
                variant="info"
                title={t('auth.login.alreadyLoggedInTitle')}
                message={t('auth.login.alreadyLoggedInBody', { name: currentUser.displayName })}
              />
              <div className="flex flex-wrap gap-3">
                <Button
                  variant="primary"
                  onClick={() => navigateToHash(resolvePostLoginRedirect(currentUser, returnUrl))}
                >
                  {t('auth.login.goToTarget')}
                </Button>
                <Button variant="outline" onClick={() => navigateToHash('/health')}>
                  {t('router.goToHealth')}
                </Button>
              </div>
            </div>
          ) : step === 'identifier' ? (
            <form onSubmit={handleIdentifierContinue} className="space-y-4" noValidate>
              {errorMessage && <Alert variant="error" message={errorMessage} />}

              <FormField
                id="login-identifier"
                label={t('auth.login.identifierLabel')}
                value={identifier}
                onChange={setIdentifier}
                placeholder={t('auth.login.identifierPlaceholder')}
                hint={t('auth.login.identifierHint')}
                required
              />

              <Button type="submit" variant="primary" fullWidth disabled={isSubmitting}>
                {isSubmitting ? t('auth.login.submitting') : t('auth.login.continueAction')}
              </Button>
            </form>
          ) : step === 'otp_verify' ? (
            <form onSubmit={handleVerifyOtp} className="space-y-4" noValidate>
              {errorMessage && <Alert variant="error" message={errorMessage} />}
              {otpSentNotice && (
                <Alert
                  variant="info"
                  title={envConfig.isDevelopment ? otpSentNotice : undefined}
                  message={
                    envConfig.isDevelopment ? t('auth.otp.sentDevHint') : otpSentNotice
                  }
                />
              )}

              <div className="flex items-center justify-between gap-3 p-3 rounded-[var(--radius-control)] bg-[var(--color-surface-alt)] border border-[var(--color-border)] text-xs sm:text-sm">
                <span dir="ltr" className="font-mono font-semibold text-[var(--color-text)] tabular-nums-strict">
                  {toPersianDigits(normalizedPhone)}
                </span>
                <button
                  type="button"
                  onClick={handleResetToIdentifier}
                  className="text-xs font-semibold text-[var(--color-primary)] hover:underline underline-offset-4"
                >
                  {t('auth.login.changePhone')}
                </button>
              </div>

              <FormField
                id="login-otp-code"
                label={t('auth.otp.codeLabel')}
                value={otpCode}
                onChange={setOtpCode}
                placeholder={t('auth.otp.codePlaceholder')}
                hint={t('auth.otp.codeHint')}
                required
              />

              <Button type="submit" variant="primary" fullWidth disabled={isSubmitting}>
                {isSubmitting ? t('auth.otp.verifying') : t('auth.otp.verifySubmit')}
              </Button>

              <div className="flex items-center justify-between gap-3 pt-1 text-xs">
                {cooldownSeconds > 0 ? (
                  <span className="text-[var(--color-muted)] tabular-nums-strict">
                    {t('auth.otp.resendCountdown', {
                      seconds: toPersianDigits(cooldownSeconds),
                    })}
                  </span>
                ) : (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => void handleOtpResend()}
                    disabled={isSubmitting}
                  >
                    {t('auth.otp.resendButton')}
                  </Button>
                )}
              </div>
            </form>
          ) : step === 'otp_register' ? (
            <form onSubmit={handleCompleteRegistration} className="space-y-4" noValidate>
              {errorMessage && <Alert variant="error" message={errorMessage} />}

              <Alert
                variant="success"
                title={t('auth.otp.completeRegTitle')}
                message={t('auth.otp.completeRegSubtitle', {
                  phone: toPersianDigits(normalizedPhone),
                })}
              />

              <FormField
                id="otp-register-display-name"
                label={t('auth.field.displayNameLabel')}
                value={displayName}
                onChange={setDisplayName}
                placeholder={t('auth.field.displayNamePlaceholder')}
                hint={t('auth.field.displayNameHint')}
                required
              />

              <FormField
                id="otp-register-age-group"
                kind="select"
                label={t('auth.field.ageGroupLabel')}
                value={ageGroupId}
                onChange={setAgeGroupId}
                options={ageGroups.map((group) => ({
                  value: String(group.id),
                  label: formatAgeGroupWithRange(group),
                }))}
                required
              />

              <Button type="submit" variant="primary" fullWidth disabled={isSubmitting}>
                {isSubmitting ? t('auth.otp.completingReg') : t('auth.otp.completeRegSubmit')}
              </Button>
            </form>
          ) : (
            <form onSubmit={handleEmailLoginSubmit} className="space-y-4" noValidate>
              {errorMessage && <Alert variant="error" message={errorMessage} />}
              {resendFeedback && <Alert variant="success" message={resendFeedback} />}

              {showResendConfirmation && (
                <div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void handleResendConfirmation()}
                  >
                    {t('auth.login.resendConfirmButton')}
                  </Button>
                </div>
              )}

              <div className="flex items-center justify-between gap-3 p-3 rounded-[var(--radius-control)] bg-[var(--color-surface-alt)] border border-[var(--color-border)] text-xs sm:text-sm">
                <span dir="ltr" className="font-mono text-[var(--color-text)] truncate">
                  {normalizedEmail}
                </span>
                <button
                  type="button"
                  onClick={handleResetToIdentifier}
                  className="text-xs font-semibold text-[var(--color-primary)] hover:underline underline-offset-4 shrink-0"
                >
                  {t('auth.login.changeIdentifier')}
                </button>
              </div>

              <FormField
                id="login-password"
                type="password"
                label={t('auth.field.passwordLabel')}
                value={password}
                onChange={setPassword}
                placeholder={t('auth.field.passwordPlaceholder')}
                required
              />

              <Button type="submit" variant="primary" fullWidth disabled={isSubmitting}>
                {isSubmitting ? t('auth.login.submitting') : t('auth.login.submit')}
              </Button>
            </form>
          )}

          <div className="pt-4 border-t border-[var(--color-border)] flex flex-wrap items-center justify-between gap-3 text-xs sm:text-sm">
            <a
              href="#/account/forgot-password"
              className="text-[var(--color-muted)] hover:text-[var(--color-text)] hover:underline underline-offset-4"
            >
              {t('auth.login.forgotLink')}
            </a>
            <a
              href={
                returnUrl
                  ? `#/account/register?returnUrl=${encodeURIComponent(returnUrl)}`
                  : '#/account/register'
              }
              className="font-semibold text-[var(--color-primary)] hover:underline underline-offset-4"
            >
              {t('auth.login.registerLink')}
            </a>
          </div>
        </section>
      </div>
    </MainLayout>
  );
}
