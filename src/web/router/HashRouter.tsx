import { useEffect, useRef, useState, type ReactNode } from 'react';
import { canAccessAdminRoute } from '../../core/services/navigationGuardService';
import { AdminForbiddenPage } from '../admin/AdminForbiddenPage';
import { AdminHomePage } from '../admin/AdminHomePage';
import { AdminModulePlaceholderPage } from '../admin/AdminModulePlaceholderPage';
import { AdminSettingsPage } from '../admin/AdminSettingsPage';
import { AdminStaffPage } from '../admin/AdminStaffPage';
import { AdminStorageTestPage } from '../admin/AdminStorageTestPage';
import { AdminUsersPage } from '../admin/AdminUsersPage';
import { AdminContentFormPage } from '../admin/pages/AdminContentFormPage';
import { AdminContentListPage } from '../admin/pages/AdminContentListPage';
import { AdminBackupPage } from '../admin/pages/AdminBackupPage';
import { AdminCommentsPage } from '../admin/pages/AdminCommentsPage';
import { AdminDashboardPage } from '../admin/pages/AdminDashboardPage';
import { AdminLayoutPage } from '../admin/pages/AdminLayoutPage';
import { AdminPortalsPage } from '../admin/pages/AdminPortalsPage';
import { AdminRequestsPage } from '../admin/pages/AdminRequestsPage';
import { AdminSmartImportPage } from '../admin/pages/AdminSmartImportPage';
import { AdminTaxonomyPage } from '../admin/pages/AdminTaxonomyPage';
import { canSeeAdminNavItem, findAdminRouteSpec } from '../admin/adminNavConfig';
import { useAuth } from '../auth/AuthContext';
import { MainLayout } from '../layouts/MainLayout';
import { BookDetailPage } from '../pages/BookDetailPage';
import { ContentDetailPage } from '../pages/ContentDetailPage';
import { FilmDetailPage } from '../pages/FilmDetailPage';
import { GamePlayPage } from '../pages/GamePlayPage';
import { NotFoundPage } from '../pages/NotFoundPage';
import { PublicMediaPage } from '../pages/PublicMediaPage';
import { ServerErrorPage } from '../pages/ServerErrorPage';
import { SignedDownloadPage } from '../pages/SignedDownloadPage';
import { StaticPageView } from '../pages/StaticPageView';
import { ChangePasswordPage } from '../pages/account/ChangePasswordPage';
import { usePageMeta } from '../hooks/usePageMeta';
import { appContainer } from '../services/appContainer';
import { ThemeManager } from '../theme/ThemeManager';

export interface HashRouteConfig {
  path: string;
  render: (currentRoute: string) => ReactNode;
}

interface HashRouterProps {
  routes: HashRouteConfig[];
  defaultRoute: string;
}

function splitHashParts(rawHash: string): { path: string; query: string } {
  const trimmed = rawHash.trim();
  if (!trimmed || trimmed === '#' || trimmed === '#/') {
    return { path: '/', query: '' };
  }

  const withoutHash = trimmed.startsWith('#') ? trimmed.slice(1) : trimmed;
  const queryIndex = withoutHash.indexOf('?');
  const rawPath = queryIndex === -1 ? withoutHash : withoutHash.slice(0, queryIndex);
  const query = queryIndex === -1 ? '' : withoutHash.slice(queryIndex + 1);

  const withLeadingSlash = rawPath.startsWith('/') ? rawPath : `/${rawPath}`;
  const normalizedPath =
    withLeadingSlash.length > 1 && withLeadingSlash.endsWith('/')
      ? withLeadingSlash.slice(0, -1)
      : withLeadingSlash;

  return { path: normalizedPath || '/', query };
}

export function navigateToHash(path: string): void {
  const cleanTarget = path.startsWith('#') ? path.slice(1) : path;
  const normalized = cleanTarget.startsWith('/') ? cleanTarget : `/${cleanTarget}`;
  const targetHash = `#${normalized}`;
  if (typeof window !== 'undefined' && window.location.hash !== targetHash) {
    window.location.hash = targetHash;
  }
}

export function HashRouter({ routes, defaultRoute }: HashRouterProps) {
  const {
    currentUser,
    siteTitle,
    userPermissions,
    isCommentsEnabled,
    isContentRequestsEnabled,
    isAuthReady,
  } = useAuth();
  const normalizedDefault = splitHashParts(defaultRoute).path;
  const mustForcePasswordChange = Boolean(isAuthReady && currentUser?.mustChangePassword);
  const lastDeniedLogKeyRef = useRef<string | null>(null);

  const [routeState, setRouteState] = useState<{ path: string; fullHash: string }>(() => {
    if (typeof window === 'undefined') {
      return { path: normalizedDefault, fullHash: `#${normalizedDefault}` };
    }
    const { path } = splitHashParts(window.location.hash);
    const hasRootRoute = routes.some((route) => splitHashParts(route.path).path === '/');
    const resolvedPath = path === '/' && !hasRootRoute ? normalizedDefault : path;
    return {
      path: resolvedPath,
      fullHash: window.location.hash || `#${resolvedPath}`,
    };
  });

  useEffect(() => {
    const syncRoute = () => {
      ThemeManager.syncFromCurrentHash();
      const { path } = splitHashParts(window.location.hash);
      const hasRootRoute = routes.some((route) => splitHashParts(route.path).path === '/');

      if (path === '/' && !hasRootRoute) {
        const targetHash = `#${normalizedDefault}`;
        if (window.location.hash !== targetHash) {
          window.history.replaceState(null, '', targetHash);
        }
        setRouteState({ path: normalizedDefault, fullHash: targetHash });
        return;
      }

      setRouteState({
        path,
        fullHash: window.location.hash || `#${path}`,
      });
    };

    syncRoute();
    window.addEventListener('hashchange', syncRoute);
    return () => window.removeEventListener('hashchange', syncRoute);
  }, [normalizedDefault, routes]);

  useEffect(() => {
    if (mustForcePasswordChange && routeState.path !== '/account/change-password') {
      const targetHash = '#/account/change-password';
      if (typeof window !== 'undefined' && window.location.hash !== targetHash) {
        window.history.replaceState(null, '', targetHash);
      }
      setRouteState({ path: '/account/change-password', fullHash: targetHash });
    }
  }, [mustForcePasswordChange, routeState.path]);

  usePageMeta({
    currentRoute: routeState.fullHash,
    siteTitle,
  });

  const normalizedRouteLower = routeState.path.toLowerCase();
  const isAdminRoute =
    normalizedRouteLower === '/admin' || normalizedRouteLower.startsWith('/admin/');
  const matchedAdminSpec = isAdminRoute ? findAdminRouteSpec(routeState.path) : null;
  const hasAdminShellAccess = isAuthReady && canAccessAdminRoute(currentUser);
  const isModuleDisabledAdminRoute =
    (matchedAdminSpec?.id === 'comments' && !isCommentsEnabled) ||
    (matchedAdminSpec?.id === 'requests' && !isContentRequestsEnabled);
  const isAdminAllowed =
    hasAdminShellAccess &&
    matchedAdminSpec !== null &&
    !isModuleDisabledAdminRoute &&
    canSeeAdminNavItem(currentUser, userPermissions, matchedAdminSpec.requirement);

  useEffect(() => {
    if (
      !isAdminRoute ||
      !isAuthReady ||
      !hasAdminShellAccess ||
      !matchedAdminSpec ||
      isModuleDisabledAdminRoute ||
      isAdminAllowed
    ) {
      lastDeniedLogKeyRef.current = null;
      return;
    }

    const reqId = Array.isArray(matchedAdminSpec.requirement)
      ? matchedAdminSpec.requirement.join('|')
      : matchedAdminSpec.requirement;
    const logKey = `${currentUser?.id ?? 'none'}:${matchedAdminSpec.path}:${reqId}`;
    if (lastDeniedLogKeyRef.current === logKey) {
      return;
    }
    lastDeniedLogKeyRef.current = logKey;

    if (matchedAdminSpec.requirement === 'superadmin') {
      appContainer.permissionPolicyService.authorizeSuperAdminOnly(
        currentUser,
        routeState.fullHash,
      );
    } else if (Array.isArray(matchedAdminSpec.requirement)) {
      void appContainer.permissionPolicyService.authorizeAnyPermission(
        currentUser,
        matchedAdminSpec.requirement,
        routeState.fullHash,
      );
    } else if (
      typeof matchedAdminSpec.requirement === 'string' &&
      matchedAdminSpec.requirement !== 'shell'
    ) {
      void appContainer.permissionPolicyService.authorizePermission(
        currentUser,
        matchedAdminSpec.requirement,
        routeState.fullHash,
      );
    }
  }, [
    currentUser,
    hasAdminShellAccess,
    isAdminAllowed,
    isAdminRoute,
    isAuthReady,
    matchedAdminSpec,
    routeState.fullHash,
  ]);

  if (mustForcePasswordChange) {
    return <ChangePasswordPage currentRoute="#/account/change-password" />;
  }

  // 500 Server Error Preview Route (#/error/500)
  if (normalizedRouteLower === '/error/500') {
    return <ServerErrorPage currentRoute={routeState.fullHash} />;
  }

  // Public Media Route (#/media/:storageKey)
  if (normalizedRouteLower.startsWith('/media/')) {
    const rawKey = routeState.path.slice('/media/'.length);
    let decodedKey = rawKey;
    try {
      decodedKey = decodeURIComponent(rawKey);
    } catch {
      decodedKey = rawKey;
    }
    return <PublicMediaPage currentRoute={routeState.fullHash} storageKey={decodedKey} />;
  }

  // Signed Download Route (#/download/:token)
  if (normalizedRouteLower.startsWith('/download/')) {
    const rawToken = routeState.path.slice('/download/'.length);
    let decodedToken = rawToken;
    try {
      decodedToken = decodeURIComponent(rawToken);
    } catch {
      decodedToken = rawToken;
    }
    if (!decodedToken.trim()) {
      return <NotFoundPage currentRoute={routeState.fullHash} />;
    }
    return (
      <SignedDownloadPage
        currentRoute={routeState.fullHash}
        token={decodedToken.trim()}
      />
    );
  }

  // Public Content Detail Route (#/content/:slug)
  if (normalizedRouteLower.startsWith('/content/')) {
    const rawSlug = routeState.path.slice('/content/'.length);
    let decodedSlug = rawSlug;
    try {
      decodedSlug = decodeURIComponent(rawSlug);
    } catch {
      decodedSlug = rawSlug;
    }
    if (!decodedSlug.trim()) {
      return <NotFoundPage currentRoute={routeState.fullHash} />;
    }
    return (
      <ContentDetailPage
        currentRoute={routeState.fullHash}
        slug={decodedSlug}
      />
    );
  }

  // Public Film Detail Route (#/films/:slug)
  if (normalizedRouteLower.startsWith('/films/')) {
    const rawSlug = routeState.path.slice('/films/'.length);
    let decodedSlug = rawSlug;
    try {
      decodedSlug = decodeURIComponent(rawSlug);
    } catch {
      decodedSlug = rawSlug;
    }
    if (!decodedSlug.trim()) {
      return <NotFoundPage currentRoute={routeState.fullHash} />;
    }
    return (
      <FilmDetailPage
        currentRoute={routeState.fullHash}
        slug={decodedSlug}
      />
    );
  }

  // Public Book Detail Route (#/books/:slug)
  if (normalizedRouteLower.startsWith('/books/')) {
    const rawSlug = routeState.path.slice('/books/'.length);
    let decodedSlug = rawSlug;
    try {
      decodedSlug = decodeURIComponent(rawSlug);
    } catch {
      decodedSlug = rawSlug;
    }
    if (!decodedSlug.trim()) {
      return <NotFoundPage currentRoute={routeState.fullHash} />;
    }
    return (
      <BookDetailPage
        currentRoute={routeState.fullHash}
        slug={decodedSlug}
      />
    );
  }

  // Public Game Play Route (#/games/:slug)
  if (normalizedRouteLower.startsWith('/games/')) {
    const rawSlug = routeState.path.slice('/games/'.length);
    let decodedSlug = rawSlug;
    try {
      decodedSlug = decodeURIComponent(rawSlug);
    } catch {
      decodedSlug = rawSlug;
    }
    if (!decodedSlug.trim()) {
      return <NotFoundPage currentRoute={routeState.fullHash} />;
    }
    return (
      <GamePlayPage
        currentRoute={routeState.fullHash}
        slug={decodedSlug}
      />
    );
  }

  // Public Static Page Route (#/p/:slug)
  if (normalizedRouteLower.startsWith('/p/')) {
    const rawSlug = routeState.path.slice('/p/'.length);
    let decodedSlug = rawSlug;
    try {
      decodedSlug = decodeURIComponent(rawSlug);
    } catch {
      decodedSlug = rawSlug;
    }
    if (!decodedSlug.trim()) {
      return <NotFoundPage currentRoute={routeState.fullHash} />;
    }
    return (
      <StaticPageView
        currentRoute={routeState.fullHash}
        slug={decodedSlug}
      />
    );
  }

  if (isAdminRoute) {
    if (!isAuthReady) {
      return (
        <MainLayout currentRoute={routeState.fullHash}>
          <div className="min-h-[40vh]" />
        </MainLayout>
      );
    }

    if (!hasAdminShellAccess) {
      return <NotFoundPage currentRoute={routeState.fullHash} />;
    }

    if (!matchedAdminSpec || isModuleDisabledAdminRoute) {
      return <NotFoundPage currentRoute={routeState.fullHash} />;
    }

    if (!isAdminAllowed) {
      return (
        <AdminForbiddenPage
          currentRoute={routeState.fullHash}
          requiredPermission={
            matchedAdminSpec.requirement === 'superadmin'
              ? 'SuperAdminOnly'
              : matchedAdminSpec.requirement === 'shell'
                ? 'dashboard.view'
                : matchedAdminSpec.requirement
          }
        />
      );
    }

    switch (matchedAdminSpec.id) {
      case 'home':
        return <AdminHomePage currentRoute={routeState.fullHash} />;
      case 'dashboard':
        return <AdminDashboardPage currentRoute={routeState.fullHash} />;
      case 'staff':
        return <AdminStaffPage currentRoute={routeState.fullHash} />;
      case 'users':
        return <AdminUsersPage currentRoute={routeState.fullHash} />;
      case 'settings':
        return <AdminSettingsPage currentRoute={routeState.fullHash} />;
      case 'taxonomy':
        return <AdminTaxonomyPage currentRoute={routeState.fullHash} />;
      case 'comments':
        return <AdminCommentsPage currentRoute={routeState.fullHash} />;
      case 'requests':
        return <AdminRequestsPage currentRoute={routeState.fullHash} />;
      case 'layout':
        return <AdminLayoutPage currentRoute={routeState.fullHash} />;
      case 'portals':
        return <AdminPortalsPage currentRoute={routeState.fullHash} />;
      case 'backup':
        return <AdminBackupPage currentRoute={routeState.fullHash} />;
      case 'content': {
        const lowerPath = routeState.path.toLowerCase();
        if (lowerPath === '/admin/content/smart-import') {
          return <AdminSmartImportPage currentRoute={routeState.fullHash} />;
        }
        if (lowerPath === '/admin/content/new') {
          return <AdminContentFormPage currentRoute={routeState.fullHash} />;
        }
        const editMatch = lowerPath.match(/^\/admin\/content\/edit\/(\d+)$/);
        if (editMatch) {
          const contentId = Number.parseInt(editMatch[1], 10);
          return <AdminContentFormPage currentRoute={routeState.fullHash} contentId={contentId} />;
        }
        return <AdminContentListPage currentRoute={routeState.fullHash} />;
      }
      case 'storage-test':
        return <AdminStorageTestPage currentRoute={routeState.fullHash} />;
      default:
        return (
          <AdminModulePlaceholderPage
            currentRoute={routeState.fullHash}
            sectionTitleKey={matchedAdminSpec.labelKey}
            permissionKey={
              typeof matchedAdminSpec.requirement === 'string' &&
              matchedAdminSpec.requirement !== 'shell' &&
              matchedAdminSpec.requirement !== 'superadmin'
                ? matchedAdminSpec.requirement
                : 'dashboard.view'
            }
          />
        );
    }
  }

  const matched = routes.find((route) => splitHashParts(route.path).path === routeState.path);

  if (matched) {
    return <>{matched.render(routeState.fullHash)}</>;
  }

  return <NotFoundPage currentRoute={routeState.fullHash} />;
}
