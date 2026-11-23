import {
  Heart,
  KeyRound,
  LogOut,
  Menu,
  SlidersHorizontal,
  Sparkles,
  User,
  X,
} from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { resolveThemeKey, type ThemeKey } from '../../core/services/themeService';
import { envConfig } from '../../infrastructure/config/envConfig';
import { useAuth } from '../auth/AuthContext';
import { HeaderSearchBox } from '../components/HeaderSearchBox';
import { TopicMegaMenu, TopicMobileAccordion } from '../components/TopicMegaMenu';
import { useAge } from '../context/AgeContext';
import { toPersianDigits } from '../resources/formatters';
import type { ResourceKey } from '../resources/fa';
import { t } from '../resources/i18n';
import { navigateToHash } from '../router/HashRouter';
import { appContainer } from '../services/appContainer';
import { Alert, Button } from '../components/ui';

export interface MainLayoutProps {
  currentRoute: string;
  children: ReactNode;
  syncThemeToHash?: boolean;
}

function getThemeNameKey(theme: ThemeKey): ResourceKey {
  switch (theme) {
    case 'playful':
      return 'theme.playful.name';
    case 'modern':
      return 'theme.modern.name';
    case 'editorial':
    default:
      return 'theme.editorial.name';
  }
}

export function MainLayout({
  currentRoute,
  children,
}: MainLayoutProps) {
  const { currentUser, siteTitle, isContentRequestsEnabled, logout } = useAuth();
  const {
    effectiveAgeGroup,
    lastSwitchNotice,
    clearLastSwitchNotice,
    openAgeSelector,
  } = useAge();
  const [isPersonalized, setIsPersonalized] = useState(false);
  const [favoritesCount, setFavoritesCount] = useState(0);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [noticeMessage, setNoticeMessage] = useState<string | null>(null);

  useEffect(() => {
    if (lastSwitchNotice && effectiveAgeGroup) {
      const themeName = t(getThemeNameKey(resolveThemeKey(effectiveAgeGroup.themeKey)));
      setNoticeMessage(
        t('ageGate.switchedNotice', {
          name: effectiveAgeGroup.name,
          theme: themeName,
        }),
      );
      clearLastSwitchNotice();
    }
  }, [lastSwitchNotice, effectiveAgeGroup, clearLastSwitchNotice]);

  const normalizedPath = currentRoute.split('?')[0].replace(/^#/, '') || '/';
  const isContentBankActive =
    normalizedPath === '/content' || normalizedPath.startsWith('/content/');
  const isRequestsActive = normalizedPath === '/requests';

  useEffect(() => {
    let active = true;

    const refreshFavoritesCount = async () => {
      if (!currentUser || !currentUser.isActive) {
        if (active) {
          setFavoritesCount(0);
        }
        return;
      }
      await appContainer.ensureInitializedAtStartup();
      const count = await appContainer.interactionService.countUserBookmarksAsync(
        currentUser,
        effectiveAgeGroup,
      );
      if (active) {
        setFavoritesCount(count);
      }
    };

    void refreshFavoritesCount();

    const handleBookmarksChanged = () => {
      void refreshFavoritesCount();
    };
    window.addEventListener('meraj:bookmarks-changed', handleBookmarksChanged);
    return () => {
      active = false;
      window.removeEventListener('meraj:bookmarks-changed', handleBookmarksChanged);
    };
  }, [currentUser, effectiveAgeGroup, currentRoute]);

  const handleSampleAction = () => {
    setNoticeMessage(t('layout.nav.sampleNoticeDesc'));
  };

  const handleOpenFavorites = () => {
    if (currentUser && currentUser.isActive) {
      navigateToHash('/account/profile?tab=bookmarks');
    } else {
      navigateToHash(
        `/account/login?returnUrl=${encodeURIComponent('#/account/profile?tab=bookmarks')}`,
      );
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-[var(--color-bg)] text-[var(--color-text)] overflow-x-hidden">
      {/* Sticky Top Header (compact for mobile <= 15% viewport height) */}
      <header className="sticky top-0 z-40 bg-[var(--color-surface)] border-b border-[var(--color-border)]">
        <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 h-14 sm:h-16 flex items-center justify-between gap-2 sm:gap-4">
          {/* Right (RTL Start): Simple text logo + brand name */}
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen((prev) => !prev)}
              aria-expanded={mobileMenuOpen}
              aria-label={t('layout.header.menuToggleAria')}
              className="md:hidden inline-flex items-center justify-center w-10 h-10 rounded-[var(--radius-control)] text-[var(--color-text)] hover:bg-[var(--color-surface-alt)] transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--color-primary)]"
            >
              {mobileMenuOpen ? (
                <X className="w-5 h-5" aria-hidden="true" />
              ) : (
                <Menu className="w-5 h-5" aria-hidden="true" />
              )}
            </button>

            <a
              href="#/"
              className="text-base sm:text-lg font-bold tracking-tight text-[var(--color-text)] whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--color-primary)] rounded-sm"
            >
              {siteTitle || t('app.name')}
            </a>
          </div>

          {/* Center: Live Autocomplete Search Input (Desktop) */}
          <HeaderSearchBox
            currentRoute={currentRoute}
            inputId="header-search-input"
            className="hidden md:block flex-1 max-w-md"
          />

          {/* Left (RTL End): Age switcher, personalization, favorites, account */}
          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            <button
              type="button"
              onClick={openAgeSelector}
              title={t('ageGate.headerAriaLabel')}
              aria-label={t('ageGate.headerAriaLabel')}
              className="inline-flex items-center gap-1.5 min-h-[38px] max-w-[140px] sm:max-w-none px-2.5 sm:px-3 py-1.5 text-xs font-medium rounded-[var(--radius-control)] border border-[var(--color-border-strong)] bg-[var(--color-surface-alt)] text-[var(--color-text)] hover:border-[var(--color-muted)] transition-colors whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--color-primary)]"
            >
              <Sparkles className="w-3.5 h-3.5 shrink-0 text-[var(--color-primary)]" aria-hidden="true" />
              <span className="truncate">
                {effectiveAgeGroup
                  ? t('ageGate.headerSwitchLabel', { name: effectiveAgeGroup.name })
                  : t('ageGate.headerUnselectedLabel')}
              </span>
            </button>

            <button
              type="button"
              role="switch"
              aria-checked={isPersonalized}
              onClick={() => {
                setIsPersonalized((prev) => !prev);
                handleSampleAction();
              }}
              className={`hidden lg:inline-flex items-center gap-1.5 min-h-[38px] px-3 py-1.5 text-xs font-medium rounded-[var(--radius-control)] border transition-colors whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--color-primary)] ${
                isPersonalized
                  ? 'bg-[var(--color-accent)] text-[var(--color-on-accent)] border-transparent'
                  : 'bg-[var(--color-surface)] text-[var(--color-text)] border-[var(--color-border)] hover:bg-[var(--color-surface-alt)]'
              }`}
            >
              <SlidersHorizontal className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
              <span>
                {isPersonalized
                  ? t('layout.header.personalizeActive')
                  : t('layout.header.personalize')}
              </span>
            </button>

            <button
              type="button"
              onClick={handleOpenFavorites}
              aria-label={
                favoritesCount > 0
                  ? t('layout.header.favoritesCountAria', {
                      count: toPersianDigits(favoritesCount),
                    })
                  : t('layout.header.favoritesAriaLabel')
              }
              title={t('layout.header.favoritesAriaLabel')}
              className="inline-flex items-center justify-center gap-1 min-w-[38px] min-h-[38px] px-2 rounded-[var(--radius-control)] border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)] hover:bg-[var(--color-surface-alt)] transition-colors shrink-0 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--color-primary)]"
            >
              <Heart
                className={`w-4 h-4 shrink-0 ${favoritesCount > 0 ? 'fill-current text-[var(--color-primary)]' : ''}`}
                aria-hidden="true"
              />
              {favoritesCount > 0 && (
                <span className="text-xs font-semibold tabular-nums-strict">
                  {toPersianDigits(favoritesCount)}
                </span>
              )}
            </button>

            {currentUser ? (
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  onClick={() => navigateToHash('/account/profile')}
                  title={t('layout.header.profileAction')}
                  aria-label={t('layout.header.profileAction')}
                  className="inline-flex items-center gap-1.5 min-h-[38px] px-2.5 py-1.5 text-xs font-semibold rounded-[var(--radius-control)] bg-[var(--color-surface-alt)] border border-[var(--color-border)] text-[var(--color-text)] hover:border-[var(--color-primary)] transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--color-primary)]"
                >
                  <User className="w-3.5 h-3.5 text-[var(--color-primary)] shrink-0" aria-hidden="true" />
                  <span className="max-w-[84px] sm:max-w-[140px] truncate">
                    {currentUser.displayName}
                  </span>
                  <span className="hidden lg:inline text-[var(--color-muted)] font-normal">
                    ({t('layout.header.profileAction')})
                  </span>
                </button>

                {currentUser.passwordHash !== null && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => navigateToHash('/account/change-password')}
                    startIcon={<KeyRound className="w-3.5 h-3.5" />}
                    className="hidden sm:inline-flex px-2.5"
                  >
                    <span>{t('layout.header.changePasswordAction')}</span>
                  </Button>
                )}

                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    void logout().then(() => navigateToHash('/'));
                  }}
                  aria-label={t('layout.header.logoutAction')}
                  startIcon={<LogOut className="w-3.5 h-3.5" />}
                  className="px-2 sm:px-2.5"
                >
                  <span className="hidden sm:inline">{t('layout.header.logoutAction')}</span>
                </Button>
              </div>
            ) : (
              <Button
                variant="primary"
                size="sm"
                onClick={() => navigateToHash('/account/login')}
                startIcon={<User className="w-3.5 h-3.5" />}
                className="px-2.5 sm:px-3.5"
              >
                <span className="hidden sm:inline">{t('layout.header.accountAction')}</span>
                <span className="sm:hidden">{t('layout.header.accountAction').split(' ')[0]}</span>
              </Button>
            )}
          </div>
        </div>
      </header>

      {/* Secondary Navbar (non-sticky so mobile sticky height remains compact) */}
      <nav
        aria-label={t('layout.nav.categoriesButton')}
        className="bg-[var(--color-surface)] border-b border-[var(--color-border)]"
      >
        <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8">
          {/* Desktop / Tablet Nav Row */}
          <div className="hidden md:flex items-center justify-between gap-4 py-2.5">
            <div className="flex items-center gap-5 min-w-0">
              {/* Live Topics Mega Menu */}
              <TopicMegaMenu />

              <div className="flex items-center gap-5 text-sm">
                <a
                  href="#/"
                  className={`whitespace-nowrap shrink-0 py-1 hover:underline underline-offset-4 transition-colors ${
                    normalizedPath === '/'
                      ? 'font-bold text-[var(--color-text)] underline'
                      : 'text-[var(--color-muted)] hover:text-[var(--color-text)]'
                  }`}
                >
                  {t('layout.nav.home')}
                </a>

                <a
                  href="#/content"
                  className={`whitespace-nowrap shrink-0 py-1 hover:underline underline-offset-4 transition-colors ${
                    isContentBankActive
                      ? 'font-bold text-[var(--color-text)] underline'
                      : 'text-[var(--color-muted)] hover:text-[var(--color-text)]'
                  }`}
                >
                  {t('layout.nav.contentBank')}
                </a>

                {isContentRequestsEnabled && (
                  <a
                    href="#/requests"
                    className={`whitespace-nowrap shrink-0 py-1 hover:underline underline-offset-4 transition-colors ${
                      isRequestsActive
                        ? 'font-bold text-[var(--color-text)] underline'
                        : 'text-[var(--color-muted)] hover:text-[var(--color-text)]'
                    }`}
                  >
                    {t('layout.nav.requests')}
                  </a>
                )}

                <a
                  href="#/health"
                  className={`whitespace-nowrap shrink-0 py-1 hover:underline underline-offset-4 transition-colors ${
                    normalizedPath === '/health'
                      ? 'font-bold text-[var(--color-text)] underline'
                      : 'text-[var(--color-muted)] hover:text-[var(--color-text)]'
                  }`}
                >
                  {t('layout.nav.health')}
                </a>

                {envConfig.isDevPreview && (
                  <a
                    href="#/dev/components"
                    className={`whitespace-nowrap shrink-0 py-1 hover:underline underline-offset-4 transition-colors ${
                      normalizedPath === '/dev/components'
                        ? 'font-bold text-[var(--color-text)] underline'
                        : 'text-[var(--color-muted)] hover:text-[var(--color-text)]'
                    }`}
                  >
                    {t('layout.nav.devComponents')}
                  </a>
                )}
              </div>
            </div>

            <span className="text-xs text-[var(--color-muted)] whitespace-nowrap shrink-0 tabular-nums-strict">
              {t('app.stageLabel', {
                stage: toPersianDigits(envConfig.stageNumber),
                total: toPersianDigits(envConfig.totalStages),
              })}
            </span>
          </div>

          {/* Mobile Live Search + Compact Nav Links */}
          <div className="md:hidden py-2.5 space-y-2.5">
            <HeaderSearchBox
              currentRoute={currentRoute}
              inputId="mobile-search-input"
              onNavigate={() => setMobileMenuOpen(false)}
            />

            {mobileMenuOpen && (
              <div className="pt-2 border-t border-[var(--color-border)] space-y-2.5">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
                  <a
                    href="#/"
                    onClick={() => setMobileMenuOpen(false)}
                    className={`py-1 whitespace-nowrap ${
                      normalizedPath === '/'
                        ? 'font-bold text-[var(--color-text)] underline underline-offset-4'
                        : 'text-[var(--color-muted)]'
                    }`}
                  >
                    {t('layout.nav.home')}
                  </a>
                  <a
                    href="#/content"
                    onClick={() => setMobileMenuOpen(false)}
                    className={`py-1 whitespace-nowrap ${
                      isContentBankActive
                        ? 'font-bold text-[var(--color-text)] underline underline-offset-4'
                        : 'text-[var(--color-muted)]'
                    }`}
                  >
                    {t('layout.nav.contentBank')}
                  </a>
                  {isContentRequestsEnabled && (
                    <a
                      href="#/requests"
                      onClick={() => setMobileMenuOpen(false)}
                      className={`py-1 whitespace-nowrap ${
                        isRequestsActive
                          ? 'font-bold text-[var(--color-text)] underline underline-offset-4'
                          : 'text-[var(--color-muted)]'
                      }`}
                    >
                      {t('layout.nav.requests')}
                    </a>
                  )}
                  <a
                    href="#/health"
                    onClick={() => setMobileMenuOpen(false)}
                    className={`py-1 whitespace-nowrap ${
                      normalizedPath === '/health'
                        ? 'font-bold text-[var(--color-text)] underline underline-offset-4'
                        : 'text-[var(--color-muted)]'
                    }`}
                  >
                    {t('layout.nav.health')}
                  </a>
                  {envConfig.isDevPreview && (
                    <a
                      href="#/dev/components"
                      onClick={() => setMobileMenuOpen(false)}
                      className={`py-1 whitespace-nowrap ${
                        normalizedPath === '/dev/components'
                          ? 'font-bold text-[var(--color-text)] underline underline-offset-4'
                          : 'text-[var(--color-muted)]'
                      }`}
                    >
                      {t('layout.nav.devComponents')}
                    </a>
                  )}
                </div>

                <TopicMobileAccordion onNavigate={() => setMobileMenuOpen(false)} />

                {currentUser && (
                  <div className="pt-2 border-t border-[var(--color-border)] flex flex-wrap items-center gap-2">
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={() => {
                        setMobileMenuOpen(false);
                        navigateToHash('/account/profile');
                      }}
                      startIcon={<User className="w-3.5 h-3.5" />}
                    >
                      {t('layout.header.profileAction')}
                    </Button>
                    {currentUser.passwordHash !== null && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setMobileMenuOpen(false);
                          navigateToHash('/account/change-password');
                        }}
                        startIcon={<KeyRound className="w-3.5 h-3.5" />}
                      >
                        {t('layout.header.changePasswordAction')}
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setMobileMenuOpen(false);
                        void logout().then(() => navigateToHash('/'));
                      }}
                      startIcon={<LogOut className="w-3.5 h-3.5" />}
                    >
                      {t('layout.header.logoutAction')}
                    </Button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </nav>

      {/* Optional Sample Notice Banner */}
      {noticeMessage && (
        <div className="max-w-7xl w-full mx-auto px-3 sm:px-6 lg:px-8 pt-4">
          <Alert
            variant="info"
            title={t('layout.nav.sampleNoticeTitle')}
            message={noticeMessage}
            onDismiss={() => setNoticeMessage(null)}
          />
        </div>
      )}

      {/* Main Content */}
      <main className="flex-1 w-full">{children}</main>

      {/* 3-Column Footer */}
      <footer className="mt-12 bg-[var(--color-surface)] border-t border-[var(--color-border)]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-10">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {/* Column 1: Studio Intro */}
            <div className="space-y-2.5">
              <h2 className="text-base font-bold text-[var(--color-text)]">
                {t('layout.footer.studioTitle')}
              </h2>
              <p className="text-xs sm:text-sm text-[var(--color-muted)] leading-relaxed">
                {t('layout.footer.studioDesc')}
              </p>
            </div>

            {/* Column 2: Quick Access */}
            <div className="space-y-2.5">
              <h2 className="text-sm font-semibold text-[var(--color-text)]">
                {t('layout.footer.quickAccessTitle')}
              </h2>
              <ul className="space-y-2 text-xs sm:text-sm text-[var(--color-muted)]">
                <li>
                  <a href="#/" className="hover:text-[var(--color-text)] hover:underline underline-offset-4">
                    {t('layout.footer.linkHome')}
                  </a>
                </li>
                <li>
                  <a href="#/content" className="hover:text-[var(--color-text)] hover:underline underline-offset-4">
                    {t('layout.footer.linkContentBank')}
                  </a>
                </li>
                {isContentRequestsEnabled && (
                  <li>
                    <a href="#/requests" className="hover:text-[var(--color-text)] hover:underline underline-offset-4">
                      {t('layout.footer.linkRequests')}
                    </a>
                  </li>
                )}
                <li>
                  <a href="#/health" className="hover:text-[var(--color-text)] hover:underline underline-offset-4">
                    {t('layout.footer.linkHealth')}
                  </a>
                </li>
                {envConfig.isDevPreview && (
                  <li>
                    <a
                      href="#/dev/components"
                      className="hover:text-[var(--color-text)] hover:underline underline-offset-4"
                    >
                      {t('layout.footer.linkComponents')}
                    </a>
                  </li>
                )}
              </ul>
            </div>

            {/* Column 3: Contact, Terms & Privacy */}
            <div className="space-y-2.5">
              <h2 className="text-sm font-semibold text-[var(--color-text)]">
                {t('layout.footer.supportTitle')}
              </h2>
              <ul className="space-y-2 text-xs sm:text-sm text-[var(--color-muted)]">
                <li>
                  <button
                    type="button"
                    onClick={handleSampleAction}
                    className="hover:text-[var(--color-text)] hover:underline underline-offset-4"
                  >
                    {t('layout.footer.linkAbout')}
                  </button>
                </li>
                <li>
                  <button
                    type="button"
                    onClick={handleSampleAction}
                    className="hover:text-[var(--color-text)] hover:underline underline-offset-4"
                  >
                    {t('layout.footer.linkContact')}
                  </button>
                </li>
                <li>
                  <button
                    type="button"
                    onClick={handleSampleAction}
                    className="hover:text-[var(--color-text)] hover:underline underline-offset-4"
                  >
                    {t('layout.footer.linkTerms')}
                  </button>
                </li>
                <li>
                  <button
                    type="button"
                    onClick={handleSampleAction}
                    className="hover:text-[var(--color-text)] hover:underline underline-offset-4"
                  >
                    {t('layout.footer.linkPrivacy')}
                  </button>
                </li>
              </ul>
            </div>
          </div>

          <div className="mt-8 pt-5 border-t border-[var(--color-border)] flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--color-muted)]">
            <span>{t('app.footerNote')}</span>
            <span dir="ltr" className="font-mono">
              {currentRoute}
            </span>
          </div>
        </div>
      </footer>
    </div>
  );
}
