import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import type { AppUser } from '../../core/domain/auth';
import type { PermissionKey } from '../../core/domain/permissions';
import { t } from '../resources/i18n';
import { appContainer } from '../services/appContainer';

export interface AuthContextValue {
  currentUser: AppUser | null;
  userPermissions: PermissionKey[];
  siteTitle: string;
  siteSubtitle: string;
  isCommentsEnabled: boolean;
  isContentRequestsEnabled: boolean;
  isFilmsEnabled: boolean;
  hasSuperAdmin: boolean;
  hasStaffUser: boolean;
  isAuthReady: boolean;
  refreshAuthState: () => Promise<void>;
  refreshSiteTitle: () => Promise<void>;
  refreshFeatureFlags: () => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [currentUser, setCurrentUser] = useState<AppUser | null>(null);
  const [userPermissions, setUserPermissions] = useState<PermissionKey[]>([]);
  const [siteTitle, setSiteTitle] = useState<string>(() => t('app.name'));
  const [siteSubtitle, setSiteSubtitle] = useState<string>(() => t('app.subtitle'));
  const [isCommentsEnabled, setIsCommentsEnabled] = useState<boolean>(false);
  const [isContentRequestsEnabled, setIsContentRequestsEnabled] =
    useState<boolean>(false);
  const [isFilmsEnabled, setIsFilmsEnabled] = useState<boolean>(false);
  const [hasSuperAdmin, setHasSuperAdmin] = useState<boolean>(true);
  const [hasStaffUser, setHasStaffUser] = useState<boolean>(true);
  const [isAuthReady, setIsAuthReady] = useState<boolean>(false);

  const refreshSiteTitle = useCallback(async () => {
    await appContainer.ensureInitializedAtStartup();
    const [resolvedTitle, resolvedSubtitle] = await Promise.all([
      appContainer.settingsManagementService.getPublicSiteTitle(t('app.name')),
      appContainer.settingsManagementService.getPublicSiteSubtitle(t('app.subtitle')),
    ]);
    setSiteTitle(resolvedTitle);
    setSiteSubtitle(resolvedSubtitle);
  }, []);

  const refreshFeatureFlags = useCallback(async () => {
    await appContainer.ensureInitializedAtStartup();
    const [commentsEnabled, contentRequestsEnabled, filmsEnabled] = await Promise.all([
      appContainer.settingsManagementService.getPublicFeatureFlagState('Comments'),
      appContainer.settingsManagementService.getPublicFeatureFlagState(
        'ContentRequests',
      ),
      appContainer.settingsManagementService.getPublicFeatureFlagState('Films'),
    ]);
    setIsCommentsEnabled(commentsEnabled);
    setIsContentRequestsEnabled(contentRequestsEnabled);
    setIsFilmsEnabled(filmsEnabled);
  }, []);

  const refreshAuthState = useCallback(async () => {
    await appContainer.ensureInitializedAtStartup();
    const [
      user,
      superAdminExists,
      staffExists,
      resolvedTitle,
      resolvedSubtitle,
      commentsEnabled,
      contentRequestsEnabled,
      filmsEnabled,
    ] = await Promise.all([
      appContainer.authService.getCurrentUser(),
      appContainer.initialSuperAdminService.hasSuperAdmin(),
      appContainer.initialSuperAdminService.hasStaffUser(),
      appContainer.settingsManagementService.getPublicSiteTitle(t('app.name')),
      appContainer.settingsManagementService.getPublicSiteSubtitle(t('app.subtitle')),
      appContainer.settingsManagementService.getPublicFeatureFlagState('Comments'),
      appContainer.settingsManagementService.getPublicFeatureFlagState(
        'ContentRequests',
      ),
      appContainer.settingsManagementService.getPublicFeatureFlagState('Films'),
    ]);
    const permissions = await appContainer.permissionPolicyService.getUserPermissions(user);
    setCurrentUser(user);
    setUserPermissions(permissions);
    setHasSuperAdmin(superAdminExists);
    setHasStaffUser(staffExists);
    setSiteTitle(resolvedTitle);
    setSiteSubtitle(resolvedSubtitle);
    setIsCommentsEnabled(commentsEnabled);
    setIsContentRequestsEnabled(contentRequestsEnabled);
    setIsFilmsEnabled(filmsEnabled);
    setIsAuthReady(true);
  }, []);

  useEffect(() => {
    void refreshAuthState();
  }, [refreshAuthState]);

  const logout = useCallback(async () => {
    await appContainer.authService.logout();
    await refreshAuthState();
  }, [refreshAuthState]);

  return (
    <AuthContext.Provider
      value={{
        currentUser,
        userPermissions,
        siteTitle,
        siteSubtitle,
        isCommentsEnabled,
        isContentRequestsEnabled,
        isFilmsEnabled,
        hasSuperAdmin,
        hasStaffUser,
        isAuthReady,
        refreshAuthState,
        refreshSiteTitle,
        refreshFeatureFlags,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used inside AuthProvider');
  }
  return context;
}
