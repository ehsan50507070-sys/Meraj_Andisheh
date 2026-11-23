import { ArrowLeft, ShieldCheck } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { Alert, Button, Tag } from '../components/ui';
import { toPersianDigits } from '../resources/formatters';
import { t } from '../resources/i18n';
import { navigateToHash } from '../router/HashRouter';
import { AdminLayout } from './AdminLayout';
import { ADMIN_ROUTES, canSeeAdminNavItem } from './adminNavConfig';

interface AdminHomePageProps {
  currentRoute: string;
}

export function AdminHomePage({ currentRoute }: AdminHomePageProps) {
  const {
    currentUser,
    userPermissions,
    isCommentsEnabled,
    isContentRequestsEnabled,
  } = useAuth();

  const sectionCards = ADMIN_ROUTES.filter(
    (item) =>
      item.id !== 'home' &&
      !(item.id === 'comments' && !isCommentsEnabled) &&
      !(item.id === 'requests' && !isContentRequestsEnabled) &&
      canSeeAdminNavItem(currentUser, userPermissions, item.requirement),
  );

  return (
    <AdminLayout currentRoute={currentRoute}>
      <div className="space-y-6">
        <section className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-card)] shadow-[var(--shadow-card)] p-5 sm:p-6 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="space-y-1">
              <h1 className="text-xl sm:text-2xl font-bold text-[var(--color-text)]">
                {t('admin.home.title', {
                  name: currentUser?.displayName ?? '',
                })}
              </h1>
              <p className="text-xs sm:text-sm text-[var(--color-muted)]">
                {t('admin.home.subtitle')}
              </p>
            </div>

            <Tag
              label={t('admin.home.activePermissionsLabel', {
                count: toPersianDigits(userPermissions.length),
              })}
              variant="primary"
            />
          </div>
        </section>

        {sectionCards.length === 0 ? (
          <Alert
            variant="warning"
            title={t('admin.home.noPermissionsTitle')}
            message={t('admin.home.noPermissionsBody')}
          />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {sectionCards.map((item) => (
              <section
                key={item.id}
                className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-card)] shadow-[var(--shadow-card)] p-5 flex flex-col justify-between gap-4"
              >
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2 text-[var(--color-primary)]">
                    <ShieldCheck className="w-4 h-4 shrink-0" aria-hidden="true" />
                    <h2 className="text-base font-bold text-[var(--color-text)]">
                      {t(item.labelKey)}
                    </h2>
                  </div>
                  {item.permissionDescKey && (
                    <p className="text-xs sm:text-sm text-[var(--color-muted)] leading-relaxed">
                      {t(item.permissionDescKey)}
                    </p>
                  )}
                </div>

                <div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => navigateToHash(item.path)}
                    endIcon={<ArrowLeft className="w-3.5 h-3.5" />}
                  >
                    {t('admin.home.openSection')}
                  </Button>
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
    </AdminLayout>
  );
}
