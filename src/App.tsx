import { envConfig } from './infrastructure/config/envConfig';
import { AuthProvider } from './web/auth/AuthContext';
import { AgeGateModal } from './web/components/AgeGateModal';
import { AgeProvider } from './web/context/AgeContext';
import { ComponentsLabPage } from './web/pages/ComponentsLabPage';
import { HealthPage } from './web/pages/HealthPage';
import { InitialAdminSetupPage } from './web/pages/InitialAdminSetupPage';
import { PublicHomePreviewPage } from './web/pages/PublicHomePreviewPage';
import { ChangePasswordPage } from './web/pages/account/ChangePasswordPage';
import { ConfirmEmailPage } from './web/pages/account/ConfirmEmailPage';
import { ForgotPasswordPage } from './web/pages/account/ForgotPasswordPage';
import { LoginPage } from './web/pages/account/LoginPage';
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
    render: (currentRoute) => <PublicHomePreviewPage currentRoute={currentRoute} />,
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
  return (
    <AuthProvider>
      <AgeProvider>
        <HashRouter routes={routes} defaultRoute={envConfig.defaultHashRoute} />
        <AgeGateModal />
      </AgeProvider>
    </AuthProvider>
  );
}
