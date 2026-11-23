import {
  Archive,
  BarChart3,
  ExternalLink,
  FileText,
  FolderTree,
  Globe,
  HardDriveUpload,
  Home,
  Inbox,
  KeyRound,
  LayoutTemplate,
  LogOut,
  Menu,
  MessageSquare,
  Settings,
  ShieldCheck,
  UserCog,
  Users,
  X,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useAuth } from '../auth/AuthContext';
import { Button, Tag } from '../components/ui';
import type { ResourceKey } from '../resources/fa';
import { t } from '../resources/i18n';
import { navigateToHash } from '../router/HashRouter';
import { ADMIN_ROUTES, canSeeAdminNavItem } from './adminNavConfig';

interface AdminLayoutProps {
  currentRoute: string;
  children: ReactNode;
}

function renderNavIcon(id: string) {
  const iconClass = 'w-4 h-4 shrink-0';
  switch (id) {
    case 'home':
      return <Home className={iconClass} aria-hidden="true" />;
    case 'dashboard':
      return <BarChart3 className={iconClass} aria-hidden="true" />;
    case 'content':
      return <FileText className={iconClass} aria-hidden="true" />;
    case 'taxonomy':
      return <FolderTree className={iconClass} aria-hidden="true" />;
    case 'requests':
      return <Inbox className={iconClass} aria-hidden="true" />;
    case 'comments':
      return <MessageSquare className={iconClass} aria-hidden="true" />;
    case 'users':
      return <Users className={iconClass} aria-hidden="true" />;
    case 'layout':
      return <LayoutTemplate className={iconClass} aria-hidden="true" />;
    case 'portals':
      return <Globe className={iconClass} aria-hidden="true" />;
    case 'settings':
      return <Settings className={iconClass} aria-hidden="true" />;
    case 'storage-test':
      return <HardDriveUpload className={iconClass} aria-hidden="true" />;
    case 'backup':
      return <Archive className={iconClass} aria-hidden="true" />;
    case 'staff':
      return <UserCog className={iconClass} aria-hidden="true" />;
    default:
      return <ShieldCheck className={iconClass} aria-hidden="true" />;
  }
}

export function AdminLayout({ currentRoute, children }: AdminLayoutProps) {
  const {
    currentUser,
    userPermissions,
    siteTitle,
    isCommentsEnabled,
    isContentRequestsEnabled,
    logout,
  } = useAuth();
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);

  const normalizedPath = currentRoute.split('?')[0].replace(/^#/, '').toLowerCase() || '/admin';
  const visibleItems = ADMIN_ROUTES.filter(
    (item) =>
      !(item.id === 'comments' && !isCommentsEnabled) &&
      !(item.id === 'requests' && !isContentRequestsEnabled) &&
      canSeeAdminNavItem(currentUser, userPermissions, item.requirement),
  );

  const roleLabelKey: ResourceKey =
    currentUser?.role === 'SuperAdmin'
      ? 'admin.role.SuperAdmin'
      : currentUser?.role === 'Staff'
        ? 'admin.role.Staff'
        : 'admin.role.Member';

  const renderSidebarLinks = (closeOnClick: boolean) => (
    <nav aria-label={t('admin.sidebar.ariaLabel')} className="space-y-1">
      {visibleItems.map((item) => {
        const itemPath = item.path.toLowerCase();
        const isActive =
          normalizedPath === itemPath ||
          (item.id === 'content' && normalizedPath.startsWith('/admin/content/'));
        return (
          <a
            key={item.id}
            href={item.hash}
            onClick={() => {
              if (closeOnClick) {
                setMobileDrawerOpen(false);
              }
            }}
            aria-current={isActive ? 'page' : undefined}
            className={`flex items-center gap-2.5 px-3 py-2.5 text-xs sm:text-sm rounded-[var(--radius-control)] transition-colors ${
              isActive
                ? 'bg-[var(--color-primary-button)] text-[var(--color-on-primary)] font-semibold'
                : 'text-[var(--color-text)] hover:bg-[var(--color-surface-alt)]'
            }`}
          >
            {renderNavIcon(item.id)}
            <span className="truncate">{t(item.labelKey)}</span>
          </a>
        );
      })}
    </nav>
  );

  return (
    <div className="min-h-screen flex flex-col bg-[var(--color-bg)] text-[var(--color-text)]">
      {/* Top Bar */}
      <header className="sticky top-0 z-40 bg-[var(--color-surface)] border-b border-[var(--color-border)]">
        <div className="max-w-7xl mx-auto px-3 sm:px-6 h-14 sm:h-16 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <button
              type="button"
              onClick={() => setMobileDrawerOpen((prev) => !prev)}
              aria-expanded={mobileDrawerOpen}
              aria-label={t('admin.topbar.menuToggleAria')}
              className="lg:hidden inline-flex items-center justify-center w-9 h-9 rounded-[var(--radius-control)] border border-[var(--color-border)] text-[var(--color-text)] hover:bg-[var(--color-surface-alt)]"
            >
              {mobileDrawerOpen ? (
                <X className="w-4 h-4" aria-hidden="true" />
              ) : (
                <Menu className="w-4 h-4" aria-hidden="true" />
              )}
            </button>

            <a
              href="#/admin"
              className="flex items-center gap-2 min-w-0 font-bold text-sm sm:text-base text-[var(--color-text)]"
            >
              <ShieldCheck className="w-5 h-5 text-[var(--color-primary)] shrink-0" aria-hidden="true" />
              <span className="truncate">{siteTitle || t('app.name')}</span>
            </a>

            <Tag label={t('admin.brandBadge')} variant="primary" />
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {currentUser && (
              <div className="hidden sm:flex items-center gap-2 px-2.5 py-1 rounded-[var(--radius-control)] bg-[var(--color-surface-alt)] border border-[var(--color-border)] text-xs">
                <span className="font-semibold text-[var(--color-text)] max-w-[140px] truncate">
                  {currentUser.displayName}
                </span>
                <Tag
                  label={t(roleLabelKey)}
                  variant={currentUser.role === 'SuperAdmin' ? 'accent' : 'neutral'}
                />
              </div>
            )}

            <Button
              variant="outline"
              size="sm"
              onClick={() => navigateToHash('/')}
              startIcon={<ExternalLink className="w-3.5 h-3.5" />}
            >
              <span className="hidden md:inline">{t('admin.topbar.backToPublic')}</span>
            </Button>

            {currentUser?.passwordHash !== null && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => navigateToHash('/account/change-password')}
                startIcon={<KeyRound className="w-3.5 h-3.5" />}
                className="hidden sm:inline-flex"
              >
                <span>{t('admin.topbar.changePassword')}</span>
              </Button>
            )}

            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                void logout().then(() => navigateToHash('/'));
              }}
              startIcon={<LogOut className="w-3.5 h-3.5" />}
            >
              <span className="hidden sm:inline">{t('admin.topbar.logout')}</span>
            </Button>
          </div>
        </div>
      </header>

      {/* Mobile Drawer */}
      {mobileDrawerOpen && (
        <div className="lg:hidden border-b border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3">
          {renderSidebarLinks(true)}
        </div>
      )}

      {/* Main Shell Body */}
      <div className="flex-1 max-w-7xl w-full mx-auto px-3 sm:px-6 py-5 sm:py-6 flex flex-col lg:flex-row gap-6">
        <aside className="hidden lg:block w-64 shrink-0">
          <div className="sticky top-20 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-card)] shadow-[var(--shadow-card)] p-3">
            {renderSidebarLinks(false)}
          </div>
        </aside>

        <main className="flex-1 min-w-0">{children}</main>
      </div>
    </div>
  );
}
