import { useEffect, useMemo, useState, type FormEvent } from 'react';
import type { AgeGroup } from '../../../core/domain/taxonomy';
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

interface RegisterPageProps {
  currentRoute: string;
}

type RegisterTab = 'mobile' | 'email';
type MobileStep = 'phone' | 'otp' | 'complete';

function extractReturnUrl(currentRoute: string): string | null {
  const queryIndex = currentRoute.indexOf('?');
  if (queryIndex === -1) {
    return null;
  }
  const params = new URLSearchParams(currentRoute.slice(queryIndex + 1));
  return params.get('returnUrl');
}

export function RegisterPage({ currentRoute }: RegisterPageProps) {
  const { currentUser, refreshAuthState } = useAuth();
  const returnUrl = useMemo(() => extractReturnUrl(currentRoute), [currentRoute]);
  const [activeTab, setActiveTab] = useState<RegisterTab>('mobile');

  // Shared age groups
  const [ageGroupId, setAgeGroupId] = useState<string>('1');
  const [ageGroups, setAgeGroups] = useState<AgeGroup[]>([]);

  // Mobile OTP state
  const [mobileStep, setMobileStep] = useState<MobileStep>('phone');
  const [phoneInput, setPhoneInput] = useState('');
  const [normalizedPhone, setNormalizedPhone] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [cooldownSeconds, setCooldownSeconds] = useState(0);
  const [otpSentNotice, setOtpSentNotice] = useState<string | null>(null);
  const [registrationToken, setRegistrationToken] = useState('');
  const [mobileDisplayName, setMobileDisplayName] = useState('');

  // Email registration state
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isEmailRegistered, setIsEmailRegistered] = useState(false);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

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
    return t((messageKey ?? 'auth.error.invalidPhone') as ResourceKey);
  };

  const handleSwitchTab = (tab: RegisterTab) => {
    setErrorMessage(null);
    setActiveTab(tab);
  };

  const handleRequestOtp = async (event?: FormEvent) => {
    if (event) {
      event.preventDefault();
    }
    setErrorMessage(null);
    setOtpSentNotice(null);
    setIsSubmitting(true);

    try {
      const targetPhone = mobileStep === 'phone' ? phoneInput : normalizedPhone;
      const result = await appContainer.otpService.requestOtp(targetPhone);
      if (!result.ok || !result.data) {
        if (result.errorCode === 'OTP_COOLDOWN' && result.remainingSeconds) {
          setCooldownSeconds(result.remainingSeconds);
          if (mobileStep === 'phone') {
            setNormalizedPhone(targetPhone);
            setMobileStep('otp');
          }
        }
        setErrorMessage(
          formatOtpError(result.errorCode, result.messageKey, result.remainingSeconds),
        );
        return;
      }

      setNormalizedPhone(result.data.phoneNumber);
      setCooldownSeconds(result.data.cooldownSeconds);
      setOtpSentNotice(
        t('auth.otp.sentSuccess', { phone: toPersianDigits(result.data.phoneNumber) }),
      );
      setMobileStep('otp');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleVerifyOtp = async (event: FormEvent) => {
    event.preventDefault();
    setErrorMessage(null);
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
      setMobileStep('complete');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCompleteMobileReg = async (event: FormEvent) => {
    event.preventDefault();
    setErrorMessage(null);
    setIsSubmitting(true);

    try {
      const result = await appContainer.otpService.completeMobileRegistration({
        verifiedPhone: normalizedPhone,
        registrationToken,
        displayName: mobileDisplayName,
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

  const handleEmailSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setErrorMessage(null);

    if (password !== confirmPassword) {
      setErrorMessage(t('auth.error.passwordMismatch'));
      return;
    }

    setIsSubmitting(true);
    try {
      const result = await appContainer.authService.registerWithEmail({
        email,
        password,
        displayName,
        ageGroupId: Number(ageGroupId),
      });

      if (!result.ok) {
        setErrorMessage(t((result.messageKey ?? 'auth.error.invalidEmail') as ResourceKey));
        return;
      }

      setIsEmailRegistered(true);
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
              {t('auth.register.title')}
            </h1>
            <p className="text-xs sm:text-sm text-[var(--color-muted)] leading-relaxed">
              {activeTab === 'mobile'
                ? t('auth.register.mobileSubtitle')
                : t('auth.register.subtitle')}
            </p>
          </div>

          {currentUser ? (
            <div className="space-y-4">
              <Alert
                variant="info"
                title={t('auth.login.alreadyLoggedInTitle')}
                message={t('auth.login.alreadyLoggedInBody', { name: currentUser.displayName })}
              />
              <Button
                variant="primary"
                onClick={() => navigateToHash(resolvePostLoginRedirect(currentUser, returnUrl))}
              >
                {t('auth.login.goToTarget')}
              </Button>
            </div>
          ) : (
            <>
              {/* Clean 2-tab selector */}
              <div
                role="tablist"
                aria-label={t('auth.register.title')}
                className="grid grid-cols-2 gap-2 p-1 rounded-[var(--radius-control)] bg-[var(--color-surface-alt)] border border-[var(--color-border)]"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeTab === 'mobile'}
                  onClick={() => handleSwitchTab('mobile')}
                  className={`min-h-[40px] px-3 py-1.5 text-xs sm:text-sm font-semibold rounded-[var(--radius-control)] transition-colors ${
                    activeTab === 'mobile'
                      ? 'bg-[var(--color-primary-button)] text-[var(--color-on-primary)]'
                      : 'text-[var(--color-muted)] hover:text-[var(--color-text)]'
                  }`}
                >
                  {t('auth.register.tabMobile')}
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeTab === 'email'}
                  onClick={() => handleSwitchTab('email')}
                  className={`min-h-[40px] px-3 py-1.5 text-xs sm:text-sm font-semibold rounded-[var(--radius-control)] transition-colors ${
                    activeTab === 'email'
                      ? 'bg-[var(--color-primary-button)] text-[var(--color-on-primary)]'
                      : 'text-[var(--color-muted)] hover:text-[var(--color-text)]'
                  }`}
                >
                  {t('auth.register.tabEmail')}
                </button>
              </div>

              {activeTab === 'mobile' ? (
                mobileStep === 'phone' ? (
                  <form onSubmit={handleRequestOtp} className="space-y-4" noValidate>
                    {errorMessage && <Alert variant="error" message={errorMessage} />}

                    <FormField
                      id="register-phone"
                      label={t('auth.field.phoneLabel')}
                      value={phoneInput}
                      onChange={setPhoneInput}
                      placeholder={t('auth.field.phonePlaceholder')}
                      hint={t('auth.field.phoneHint')}
                      required
                    />

                    <Button type="submit" variant="primary" fullWidth disabled={isSubmitting}>
                      {isSubmitting
                        ? t('auth.register.sendingOtp')
                        : t('auth.register.sendOtpButton')}
                    </Button>
                  </form>
                ) : mobileStep === 'otp' ? (
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
                        onClick={() => {
                          setErrorMessage(null);
                          setOtpCode('');
                          setMobileStep('phone');
                        }}
                        className="text-xs font-semibold text-[var(--color-primary)] hover:underline underline-offset-4"
                      >
                        {t('auth.login.changePhone')}
                      </button>
                    </div>

                    <FormField
                      id="register-otp-code"
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
                          onClick={() => void handleRequestOtp()}
                          disabled={isSubmitting}
                        >
                          {t('auth.otp.resendButton')}
                        </Button>
                      )}
                    </div>
                  </form>
                ) : (
                  <form onSubmit={handleCompleteMobileReg} className="space-y-4" noValidate>
                    {errorMessage && <Alert variant="error" message={errorMessage} />}

                    <Alert
                      variant="success"
                      title={t('auth.otp.completeRegTitle')}
                      message={t('auth.otp.completeRegSubtitle', {
                        phone: toPersianDigits(normalizedPhone),
                      })}
                    />

                    <FormField
                      id="register-mobile-display-name"
                      label={t('auth.field.displayNameLabel')}
                      value={mobileDisplayName}
                      onChange={setMobileDisplayName}
                      placeholder={t('auth.field.displayNamePlaceholder')}
                      hint={t('auth.field.displayNameHint')}
                      required
                    />

                    <FormField
                      id="register-mobile-age-group"
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
                )
              ) : isEmailRegistered ? (
                <div className="space-y-4">
                  <Alert
                    variant="success"
                    title={t('auth.register.successTitle')}
                    message={t('auth.register.successBody')}
                  />
                  <div className="flex flex-wrap items-center gap-3 pt-2">
                    <Button variant="primary" onClick={() => navigateToHash('/health')}>
                      {t('auth.register.goToHealthLogs')}
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() =>
                        navigateToHash(
                          returnUrl
                            ? `/account/login?returnUrl=${encodeURIComponent(returnUrl)}`
                            : '/account/login',
                        )
                      }
                    >
                      {t('auth.register.goToLogin')}
                    </Button>
                  </div>
                </div>
              ) : (
                <form onSubmit={handleEmailSubmit} className="space-y-4" noValidate>
                  {errorMessage && <Alert variant="error" message={errorMessage} />}

                  <FormField
                    id="register-display-name"
                    label={t('auth.field.displayNameLabel')}
                    value={displayName}
                    onChange={setDisplayName}
                    placeholder={t('auth.field.displayNamePlaceholder')}
                    hint={t('auth.field.displayNameHint')}
                    required
                  />

                  <FormField
                    id="register-email"
                    type="email"
                    label={t('auth.field.emailLabel')}
                    value={email}
                    onChange={setEmail}
                    placeholder={t('auth.field.emailPlaceholder')}
                    required
                  />

                  <FormField
                    id="register-age-group"
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

                  <FormField
                    id="register-password"
                    type="password"
                    label={t('auth.field.passwordLabel')}
                    value={password}
                    onChange={setPassword}
                    placeholder={t('auth.field.passwordPlaceholder')}
                    required
                  />

                  <FormField
                    id="register-confirm-password"
                    type="password"
                    label={t('auth.field.confirmPasswordLabel')}
                    value={confirmPassword}
                    onChange={setConfirmPassword}
                    placeholder={t('auth.field.passwordPlaceholder')}
                    required
                  />

                  <Button type="submit" variant="primary" fullWidth disabled={isSubmitting}>
                    {isSubmitting ? t('auth.register.submitting') : t('auth.register.submit')}
                  </Button>
                </form>
              )}
            </>
          )}

          <div className="pt-4 border-t border-[var(--color-border)] flex flex-wrap items-center justify-between gap-2 text-xs sm:text-sm">
            <span className="text-[var(--color-muted)]">{t('auth.register.hasAccount')}</span>
            <a
              href={
                returnUrl
                  ? `#/account/login?returnUrl=${encodeURIComponent(returnUrl)}`
                  : '#/account/login'
              }
              className="font-semibold text-[var(--color-primary)] hover:underline underline-offset-4"
            >
              {t('auth.register.goToLogin')}
            </a>
          </div>
        </section>
      </div>
    </MainLayout>
  );
}
