import { UserCheck, Users, UserX } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import type { AppUser } from '../../core/domain/auth';
import type { AgeGroup } from '../../core/domain/taxonomy';
import { useAuth } from '../auth/AuthContext';
import {
  Alert,
  Button,
  FormField,
  Modal,
  Table,
  Tag,
  type SelectOption,
  type TableColumn,
} from '../components/ui';
import { formatAgeGroupWithRange } from '../resources/ageGroupFormatters';
import { toPersianDigits } from '../resources/formatters';
import type { ResourceKey } from '../resources/fa';
import { t } from '../resources/i18n';
import { appContainer } from '../services/appContainer';
import { AdminLayout } from './AdminLayout';

interface AdminUsersPageProps {
  currentRoute: string;
}

export function AdminUsersPage({ currentRoute }: AdminUsersPageProps) {
  const { currentUser } = useAuth();
  const [members, setMembers] = useState<AppUser[]>([]);
  const [ageGroups, setAgeGroups] = useState<AgeGroup[]>([]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');
  const [ageGroupFilter, setAgeGroupFilter] = useState<string>('all');
  const [isLoading, setIsLoading] = useState(true);
  const [feedback, setFeedback] = useState<{
    variant: 'success' | 'error';
    message: string;
  } | null>(null);
  const [confirmTarget, setConfirmTarget] = useState<AppUser | null>(null);
  const [isUpdating, setIsUpdating] = useState(false);

  const loadMembers = useCallback(async () => {
    setIsLoading(true);
    try {
      const parsedAgeGroup =
        ageGroupFilter === 'all' ? null : Number.parseInt(ageGroupFilter, 10);
      const result = await appContainer.userManagementService.listMembers(currentUser, {
        search,
        status: statusFilter,
        ageGroupId: Number.isFinite(parsedAgeGroup) ? parsedAgeGroup : null,
      });

      if (result.ok && result.items) {
        setMembers(result.items);
        if (result.ageGroups) {
          setAgeGroups(result.ageGroups);
        }
      }
    } finally {
      setIsLoading(false);
    }
  }, [ageGroupFilter, currentUser, search, statusFilter]);

  useEffect(() => {
    void loadMembers();
  }, [loadMembers]);

  const handleConfirmToggle = async () => {
    if (!confirmTarget) return;
    setIsUpdating(true);
    try {
      const res = await appContainer.userManagementService.toggleMemberActive(
        currentUser,
        confirmTarget.id,
        !confirmTarget.isActive,
      );
      if (!res.ok) {
        setFeedback({
          variant: 'error',
          message: res.messageKey ? t(res.messageKey as ResourceKey) : t('admin.forbidden.title'),
        });
      } else {
        setFeedback({
          variant: 'success',
          message: t('admin.users.feedback.toggled', {
            name: confirmTarget.displayName,
          }),
        });
        await loadMembers();
      }
      setConfirmTarget(null);
    } finally {
      setIsUpdating(false);
    }
  };

  const statusOptions: SelectOption[] = [
    { value: 'all', label: t('admin.users.filter.statusAll') },
    { value: 'active', label: t('admin.users.filter.statusActive') },
    { value: 'inactive', label: t('admin.users.filter.statusInactive') },
  ];

  const ageGroupOptions: SelectOption[] = [
    { value: 'all', label: t('admin.users.filter.ageGroupAll') },
    ...ageGroups.map((group) => ({
      value: String(group.id),
      label: formatAgeGroupWithRange(group),
    })),
  ];

  const getAgeGroupName = (ageGroupId: number | null): string => {
    if (ageGroupId === null) {
      return t('admin.users.noAgeGroup');
    }
    const found = ageGroups.find((g) => g.id === ageGroupId);
    return found ? formatAgeGroupWithRange(found) : t('admin.users.noAgeGroup');
  };

  const columns: TableColumn<AppUser>[] = [
    {
      key: 'displayName',
      header: t('admin.users.col.displayName'),
      render: (row) => (
        <span className="font-semibold text-[var(--color-text)]">{row.displayName}</span>
      ),
    },
    {
      key: 'contact',
      header: t('admin.users.col.contact'),
      render: (row) => (
        <div dir="ltr" className="font-mono text-xs text-[var(--color-muted)] text-left space-y-0.5">
          {row.email && <p>{row.email}</p>}
          {row.phoneNumber && <p>{row.phoneNumber}</p>}
        </div>
      ),
    },
    {
      key: 'ageGroup',
      header: t('admin.users.col.ageGroup'),
      render: (row) => (
        <span className="text-xs text-[var(--color-text)]">
          {getAgeGroupName(row.ageGroupId)}
        </span>
      ),
    },
    {
      key: 'createdAt',
      header: t('admin.users.col.createdAt'),
      numeric: true,
      render: (row) => (
        <span dir="ltr" className="font-mono text-xs text-[var(--color-muted)]">
          {appContainer.clock.toJalali(new Date(row.createdAt))}
        </span>
      ),
    },
    {
      key: 'status',
      header: t('admin.users.col.status'),
      render: (row) => (
        <Tag
          label={
            row.isActive
              ? t('admin.users.statusActive')
              : t('admin.users.statusInactive')
          }
          variant={row.isActive ? 'success' : 'warning'}
        />
      ),
    },
    {
      key: 'actions',
      header: t('admin.users.col.actions'),
      render: (row) => (
        <Button
          variant={row.isActive ? 'danger' : 'secondary'}
          size="sm"
          onClick={() => setConfirmTarget(row)}
          startIcon={
            row.isActive ? (
              <UserX className="w-3.5 h-3.5" />
            ) : (
              <UserCheck className="w-3.5 h-3.5" />
            )
          }
        >
          {row.isActive
            ? t('admin.users.deactivateAction')
            : t('admin.users.activateAction')}
        </Button>
      ),
    },
  ];

  return (
    <AdminLayout currentRoute={currentRoute}>
      <div className="space-y-6">
        <section className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-card)] shadow-[var(--shadow-card)] p-5 sm:p-6 space-y-4">
          <div className="space-y-1">
            <h1 className="text-xl sm:text-2xl font-bold text-[var(--color-text)] flex items-center gap-2">
              <Users className="w-6 h-6 text-[var(--color-primary)] shrink-0" aria-hidden="true" />
              <span>{t('admin.users.title')}</span>
            </h1>
            <p className="text-xs sm:text-sm text-[var(--color-muted)] leading-relaxed">
              {t('admin.users.subtitle')}
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2">
            <FormField
              id="users-filter-search"
              label={t('admin.users.filter.searchLabel')}
              type="search"
              value={search}
              onChange={setSearch}
              placeholder={t('admin.users.filter.searchPlaceholder')}
            />
            <FormField
              id="users-filter-status"
              label={t('admin.users.filter.statusLabel')}
              kind="select"
              value={statusFilter}
              onChange={(val) =>
                setStatusFilter(val as 'all' | 'active' | 'inactive')
              }
              options={statusOptions}
            />
            <FormField
              id="users-filter-ageGroup"
              label={t('admin.users.filter.ageGroupLabel')}
              kind="select"
              value={ageGroupFilter}
              onChange={setAgeGroupFilter}
              options={ageGroupOptions}
            />
          </div>

          <div className="text-xs text-[var(--color-muted)] tabular-nums-strict">
            {t('admin.users.countLabel', {
              count: toPersianDigits(members.filter((m) => !m.isDeleted).length),
            })}
          </div>
        </section>

        {feedback && (
          <Alert
            variant={feedback.variant}
            message={feedback.message}
            onDismiss={() => setFeedback(null)}
          />
        )}

        <Table
          columns={columns}
          rows={isLoading ? [] : members.filter((m) => !m.isDeleted)}
          getRowKey={(row) => String(row.id)}
          emptyText={t('admin.users.emptyText')}
        />
      </div>

      <Modal
        open={confirmTarget !== null}
        onClose={() => setConfirmTarget(null)}
        title={
          confirmTarget?.isActive
            ? t('admin.users.confirm.deactivateTitle')
            : t('admin.users.confirm.activateTitle')
        }
        footer={
          <>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setConfirmTarget(null)}
            >
              {t('admin.users.confirm.cancel')}
            </Button>
            <Button
              type="button"
              variant={confirmTarget?.isActive ? 'danger' : 'primary'}
              disabled={isUpdating}
              onClick={() => void handleConfirmToggle()}
            >
              {t('admin.users.confirm.submit')}
            </Button>
          </>
        }
      >
        <p>
          {confirmTarget?.isActive
            ? t('admin.users.confirm.deactivateBody', {
                name: confirmTarget.displayName,
              })
            : t('admin.users.confirm.activateBody', {
                name: confirmTarget?.displayName ?? '',
              })}
        </p>
      </Modal>
    </AdminLayout>
  );
}
