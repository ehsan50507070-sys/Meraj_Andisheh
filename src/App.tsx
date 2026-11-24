import { useEffect } from 'react';
import { envConfig } from './infrastructure/config/envConfig';
import { AuthProvider } from './web/auth/AuthContext';
import { AgeGateModal } from './web/components/AgeGateModal';
import { ErrorBoundary } from './web/components/ErrorBoundary';
import { AgeProvider } from './web/context/AgeContext';
import { BooksPortalPage } from './web/pages/BooksPortalPage';
import { ComponentsLabPage } from './web/pages/ComponentsLabPage';
import { ContentBankPage } from './web/pages/ContentBankPage';
import { ContentRequestsPage } from './web/pages/ContentRequestsPage';
import { FilmsPortalPage } from './web/pages/FilmsPortalPage';
import { GamesPortalPage } from './web/pages/GamesPortalPage';
import { HealthPage } from './web/pages/HealthPage';
import { HomePage } from './web/pages/HomePage';
import { InitialAdminSetupPage } from './web/pages/InitialAdminSetupPage';
import { SearchResultsPage } from './web/pages/SearchResultsPage';
import { ChangePasswordPage } from './web/pages/account/ChangePasswordPage';
import { ConfirmEmailPage } from './web/pages/account/ConfirmEmailPage';
import { ForgotPasswordPage } from './web/pages/account/ForgotPasswordPage';
import { LoginPage } from './web/pages/account/LoginPage';
import { ProfilePage } from './web/pages/account/ProfilePage';
import { RegisterPage } from './web/pages/account/RegisterPage';
import { ResetPasswordPage } from './web/pages/account/ResetPasswordPage';
import { HashRouter, type HashRouteConfig } from './web/router/HashRouter';
import { appContainer } from './web/services/appContainer';
import { ThemeManager } from './web/theme/ThemeManager';

// Initialize age-adaptive theme tokens on <html>, record startup log, and ensure idempotent seed/bootstrap
ThemeManager.initialize();
appContainer.recordStartupLogOnce();
void appContainer.ensureInitializedAtStartup();

const routes: HashRouteConfig[] = [
  {
    path: '/',
    render: (currentRoute) => <HomePage currentRoute={currentRoute} />,
  },
  {
    path: '/content',
    render: (currentRoute) => <ContentBankPage currentRoute={currentRoute} />,
  },
  {
    path: '/films',
    render: (currentRoute) => <FilmsPortalPage currentRoute={currentRoute} />,
  },
  {
    path: '/books',
    render: (currentRoute) => <BooksPortalPage currentRoute={currentRoute} />,
  },
  {
    path: '/games',
    render: (currentRoute) => <GamesPortalPage currentRoute={currentRoute} />,
  },
  {
    path: '/search',
    render: (currentRoute) => <SearchResultsPage currentRoute={currentRoute} />,
  },
  {
    path: '/requests',
    render: (currentRoute) => <ContentRequestsPage currentRoute={currentRoute} />,
  },
  {
    path: '/health',
    render: (currentRoute) => <HealthPage currentRoute={currentRoute} />,
  },
  {
    path: '/account/register',
    render: (currentRoute) => <RegisterPage currentRoute={currentRoute} />,
  },
  {
    path: '/account/confirm-email',
    render: (currentRoute) => <ConfirmEmailPage currentRoute={currentRoute} />,
  },
  {
    path: '/account/login',
    render: (currentRoute) => <LoginPage currentRoute={currentRoute} />,
  },
  {
    path: '/account/profile',
    render: (currentRoute) => <ProfilePage currentRoute={currentRoute} />,
  },
  {
    path: '/account/forgot-password',
    render: (currentRoute) => <ForgotPasswordPage currentRoute={currentRoute} />,
  },
  {
    path: '/account/reset-password',
    render: (currentRoute) => <ResetPasswordPage currentRoute={currentRoute} />,
  },
  {
    path: '/account/change-password',
    render: (currentRoute) => <ChangePasswordPage currentRoute={currentRoute} />,
  },
  {
    path: '/setup/initial-admin',
    render: (currentRoute) => <InitialAdminSetupPage currentRoute={currentRoute} />,
  },
  ...(envConfig.isDevPreview
    ? [
        {
          path: '/dev/components',
          render: (currentRoute: string) => (
            <ComponentsLabPage currentRoute={currentRoute} />
          ),
        },
      ]
    : []),
];

export default function App() {
  useEffect(() => {
    let active = true;
    void appContainer.ensureInitializedAtStartup().then(() => {
      if (active) {
        appContainer.backupScheduler.start();
        appContainer.dailyStatsAggregationJob.start();
      }
    });
    return () => {
      active = false;
      appContainer.backupScheduler.stop();
      appContainer.dailyStatsAggregationJob.stop();
    };
  }, []);

  return (
    <AuthProvider>
      <AgeProvider>
        <ErrorBoundary>
          <HashRouter routes={routes} defaultRoute={envConfig.defaultHashRoute} />
          <AgeGateModal />
        </ErrorBoundary>
      </AgeProvider>
    </AuthProvider>
  );
}
