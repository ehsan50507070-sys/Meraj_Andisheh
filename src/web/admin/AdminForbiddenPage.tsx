import { ArrowRight, ShieldAlert } from 'lucide-react';
import type { PermissionKey } from '../../core/domain/permissions';
import { Button, Tag } from '../components/ui';
import { t } from '../resources/i18n';
import { navigateToHash } from '../router/HashRouter';
import { AdminLayout } from './AdminLayout';
import { getPermissionLabelKey } from './adminNavConfig';

interface AdminForbiddenPageProps {
  currentRoute: string;
  requiredPermission: PermissionKey | readonly PermissionKey[] | 'SuperAdminOnly';
}

export function AdminForbiddenPage({
  currentRoute,
  requiredPermission,
}: AdminForbiddenPageProps) {
  let permissionText: string;
  if (requiredPermission === 'SuperAdminOnly') {
    permissionText = t('admin.forbidden.superAdminOnlyLabel');
  } else if (Array.isArray(requiredPermission)) {
    const labels = requiredPermission
      .map((key) => t(getPermissionLabelKey(key)))
      .join(' / ');
    permissionText = t('admin.forbidden.requiredPermissionLabel', {
      permission: labels,
    });
  } else {
    permissionText = t('admin.forbidden.requiredPermissionLabel', {
      permission: t(getPermissionLabelKey(requiredPermission as PermissionKey)),
    });
  }

  return (
    <AdminLayout currentRoute={currentRoute}>
      <section className="max-w-xl mx-auto my-8 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-card)] shadow-[var(--shadow-card)] p-6 sm:p-8 text-center space-y-5">
        <div className="mx-auto w-14 h-14 rounded-full bg-[var(--color-error-bg)] text-[var(--color-error-text)] flex items-center justify-center">
          <ShieldAlert className="w-7 h-7" aria-hidden="true" />
        </div>

        <div className="space-y-2">
          <p className="text-3xl font-extrabold text-[var(--color-error-text)] tabular-nums-strict">
            {t('admin.forbidden.code')}
          </p>
          <h1 className="text-lg sm:text-xl font-bold text-[var(--color-text)]">
            {t('admin.forbidden.title')}
          </h1>
          <p className="text-sm text-[var(--color-muted)] leading-relaxed">
            {t('admin.forbidden.description')}
          </p>
        </div>

        <div className="flex justify-center">
          <Tag label={permissionText} variant="warning" />
        </div>

        <div className="pt-2 flex justify-center">
          <Button
            variant="primary"
            onClick={() => navigateToHash('/admin')}
            startIcon={<ArrowRight className="w-4 h-4" />}
          >
            {t('admin.forbidden.backToPanel')}
          </Button>
        </div>
      </section>
    </AdminLayout>
  );
}
