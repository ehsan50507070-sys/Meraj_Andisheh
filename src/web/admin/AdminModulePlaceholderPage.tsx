import { ArrowRight, ShieldCheck } from 'lucide-react';
import type { PermissionKey } from '../../core/domain/permissions';
import { Button, Tag } from '../components/ui';
import type { ResourceKey } from '../resources/fa';
import { t } from '../resources/i18n';
import { navigateToHash } from '../router/HashRouter';
import { AdminLayout } from './AdminLayout';
import { getPermissionLabelKey } from './adminNavConfig';

interface AdminModulePlaceholderPageProps {
  currentRoute: string;
  sectionTitleKey: ResourceKey;
  permissionKey: PermissionKey;
}

export function AdminModulePlaceholderPage({
  currentRoute,
  sectionTitleKey,
  permissionKey,
}: AdminModulePlaceholderPageProps) {
  return (
    <AdminLayout currentRoute={currentRoute}>
      <section className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-card)] shadow-[var(--shadow-card)] p-6 sm:p-8 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="inline-flex items-center gap-2 text-xs font-semibold text-[var(--color-primary)]">
            <ShieldCheck className="w-4 h-4 shrink-0" aria-hidden="true" />
            <span>{t('admin.placeholder.badge')}</span>
          </div>
          <Tag
            label={t('admin.placeholder.permissionTag', {
              key: t(getPermissionLabelKey(permissionKey)),
            })}
            variant="success"
          />
        </div>

        <div className="space-y-2 border-b border-[var(--color-border)] pb-4">
          <h1 className="text-xl sm:text-2xl font-bold text-[var(--color-text)]">
            {t('admin.placeholder.title', { section: t(sectionTitleKey) })}
          </h1>
          <p className="text-sm text-[var(--color-muted)] leading-relaxed">
            {t('admin.placeholder.description')}
          </p>
        </div>

        <div>
          <Button
            variant="primary"
            onClick={() => navigateToHash('/admin')}
            startIcon={<ArrowRight className="w-4 h-4" />}
          >
            {t('admin.placeholder.backToPanel')}
          </Button>
        </div>
      </section>
    </AdminLayout>
  );
}
