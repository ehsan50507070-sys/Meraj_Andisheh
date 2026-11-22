import { Edit3, ShieldCheck, UserCheck, UserPlus, UserX } from 'lucide-react';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ALL_PERMISSION_KEYS, type PermissionKey } from '../../core/domain/permissions';
import type { StaffAccountWithPermissions } from '../../core/services/staffManagementService';
import { useAuth } from '../auth/AuthContext';
import {
  Alert,
  Button,
  FormField,
  Modal,
  Table,
  Tag,
  type TableColumn,
} from '../components/ui';
import { toPersianDigits } from '../resources/formatters';
import type { ResourceKey } from '../resources/fa';
import { t } from '../resources/i18n';
import { appContainer } from '../services/appContainer';
import { AdminLayout } from './AdminLayout';
import { getPermissionDescKey, getPermissionLabelKey } from './adminNavConfig';

interface AdminStaffPageProps {
  currentRoute: string;
}

export function AdminStaffPage({ currentRoute }: AdminStaffPageProps) {
  const { currentUser } = useAuth();
  const [items, setItems] = useState<StaffAccountWithPermissions[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [feedback, setFeedback] = useState<{
    variant: 'success' | 'error' | 'info';
    title?: string;
    message: string;
    tempPassword?: string;
  } | null>(null);

  // Create Staff Modal
  const [createOpen, setCreateOpen] = useState(false);
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [selectedPermissions, setSelectedPermissions] = useState<PermissionKey[]>([]);
  const [createError, setCreateError] = useState<string | null>(null);
  const [isSubmittingCreate, setIsSubmittingCreate] = useState(false);

  // Edit Permissions Modal
  const [editingTarget, setEditingTarget] = useState<StaffAccountWithPermissions | null>(null);
  const [editPermissions, setEditPermissions] = useState<PermissionKey[]>([]);
  const [editError, setEditError] = useState<string | null>(null);
  const [isSubmittingEdit, setIsSubmittingEdit] = useState(false);

  const loadStaff = useCallback(async () => {
    setIsLoading(true);
    try {
      const result = await appContainer.staffManagementService.listStaffAccounts(currentUser);
      if (result.ok && result.items) {
        setItems(result.items);
      }
    } finally {
      setIsLoading(false);
    }
  }, [currentUser]);

  useEffect(() => {
    void loadStaff();
  }, [loadStaff]);

  const togglePermissionInList = (
    list: PermissionKey[],
    key: PermissionKey,
  ): PermissionKey[] =>
    list.includes(key) ? list.filter((item) => item !== key) : [...list, key];

  const handleOpenCreate = () => {
    setDisplayName('');
    setEmail('');
    setPhoneNumber('');
    setSelectedPermissions([]);
    setCreateError(null);
    setCreateOpen(true);
  };

  const handleCreateSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setCreateError(null);
    setIsSubmittingCreate(true);

    try {
      const res = await appContainer.staffManagementService.createStaffAccount(currentUser, {
        displayName,
        email,
        phoneNumber,
        permissions: selectedPermissions,
      });

      if (!res.ok || !res.item) {
        setCreateError(
          res.messageKey ? t(res.messageKey as ResourceKey) : t('admin.forbidden.title'),
        );
        return;
      }

      setCreateOpen(false);
      if (res.tempPassword && res.item.user.email) {
        setFeedback({
          variant: 'success',
          title: t('admin.staff.tempPasswordAlertTitle'),
          message: t('admin.staff.tempPasswordAlertBody', {
            email: res.item.user.email,
          }),
          tempPassword: res.tempPassword,
        });
      } else {
        setFeedback({
          variant: 'success',
          message: t('admin.staff.tempPasswordPhoneCreated'),
        });
      }
      await loadStaff();
    } finally {
      setIsSubmittingCreate(false);
    }
  };

  const handleOpenEditPermissions = (row: StaffAccountWithPermissions) => {
    setEditingTarget(row);
    setEditPermissions([...row.permissions]);
    setEditError(null);
  };

  const handleSavePermissions = async () => {
    if (!editingTarget) return;
    setEditError(null);
    setIsSubmittingEdit(true);

    try {
      const res = await appContainer.staffManagementService.updateStaffPermissions(
        currentUser,
        editingTarget.user.id,
        editPermissions,
      );
      if (!res.ok) {
        setEditError(
          res.messageKey ? t(res.messageKey as ResourceKey) : t('admin.forbidden.title'),
        );
        return;
      }

      setEditingTarget(null);
      setFeedback({
        variant: 'success',
        message: t('admin.staff.feedback.permissionsUpdated'),
      });
      await loadStaff();
    } finally {
      setIsSubmittingEdit(false);
    }
  };

  const handleToggleActive = async (row: StaffAccountWithPermissions) => {
    const res = await appContainer.staffManagementService.toggleStaffActive(
      currentUser,
      row.user.id,
      !row.user.isActive,
    );
    if (!res.ok) {
      setFeedback({
        variant: 'error',
        message: res.messageKey ? t(res.messageKey as ResourceKey) : t('admin.forbidden.title'),
      });
      return;
    }

    setFeedback({
      variant: 'success',
      message: t('admin.staff.feedback.statusUpdated'),
    });
    await loadStaff();
  };

  const columns: TableColumn<StaffAccountWithPermissions>[] = [
    {
      key: 'displayName',
      header: t('admin.staff.col.displayName'),
      render: (row) => (
        <div className="space-y-0.5">
          <p className="font-semibold text-[var(--color-text)]">{row.user.displayName}</p>
          {row.user.id === currentUser?.id && (
            <span className="text-[11px] text-[var(--color-primary)]">
              {t('admin.staff.protectedSelfHint')}
            </span>
          )}
        </div>
      ),
    },
    {
      key: 'contact',
      header: t('admin.staff.col.contact'),
      render: (row) => (
        <div dir="ltr" className="font-mono text-xs text-[var(--color-muted)] space-y-0.5 text-left">
          {row.user.email && <p>{row.user.email}</p>}
          {row.user.phoneNumber && <p>{row.user.phoneNumber}</p>}
        </div>
      ),
    },
    {
      key: 'role',
      header: t('admin.staff.col.role'),
      render: (row) => (
        <Tag
          label={
            row.user.role === 'SuperAdmin'
              ? t('admin.role.SuperAdmin')
              : t('admin.role.Staff')
          }
          variant={row.user.role === 'SuperAdmin' ? 'accent' : 'primary'}
        />
      ),
    },
    {
      key: 'permissions',
      header: t('admin.staff.col.permissions'),
      render: (row) => {
        if (row.user.role === 'SuperAdmin') {
          return (
            <Tag
              label={t('admin.staff.allPermissionsTag', {
                count: toPersianDigits(ALL_PERMISSION_KEYS.length),
              })}
              variant="success"
            />
          );
        }
        if (row.permissions.length === 0) {
          return <Tag label={t('admin.staff.noPermissionsTag')} variant="warning" />;
        }
        return (
          <div className="flex flex-wrap gap-1.5 max-w-xs">
            <Tag
              label={t('admin.staff.permissionsCountTag', {
                count: toPersianDigits(row.permissions.length),
              })}
              variant="neutral"
            />
            {row.permissions.slice(0, 3).map((perm) => (
              <Tag key={perm} label={t(getPermissionLabelKey(perm))} variant="neutral" />
            ))}
          </div>
        );
      },
    },
    {
      key: 'status',
      header: t('admin.staff.col.status'),
      render: (row) => (
        <Tag
          label={
            row.user.isActive
              ? t('admin.staff.statusActive')
              : t('admin.staff.statusInactive')
          }
          variant={row.user.isActive ? 'success' : 'warning'}
        />
      ),
    },
    {
      key: 'actions',
      header: t('admin.staff.col.actions'),
      render: (row) => (
        <div className="flex flex-wrap items-center gap-1.5">
          {row.user.role === 'Staff' && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleOpenEditPermissions(row)}
              startIcon={<Edit3 className="w-3.5 h-3.5" />}
            >
              {t('admin.staff.editPermissionsAction')}
            </Button>
          )}
          {row.user.id !== currentUser?.id && (
            <Button
              variant={row.user.isActive ? 'danger' : 'secondary'}
              size="sm"
              onClick={() => void handleToggleActive(row)}
              startIcon={
                row.user.isActive ? (
                  <UserX className="w-3.5 h-3.5" />
                ) : (
                  <UserCheck className="w-3.5 h-3.5" />
                )
              }
            >
              {row.user.isActive
                ? t('admin.staff.deactivateAction')
                : t('admin.staff.activateAction')}
            </Button>
          )}
        </div>
      ),
    },
  ];

  const renderPermissionChecklist = (
    selected: PermissionKey[],
    onChange: (next: PermissionKey[]) => void,
    idPrefix: string,
  ) => (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-semibold text-[var(--color-text)]">
          {t('admin.staff.field.permissionsLabel')}
        </span>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onChange([...ALL_PERMISSION_KEYS])}
          >
            {t('admin.staff.field.selectAll')}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onChange([])}
          >
            {t('admin.staff.field.clearAll')}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-64 overflow-y-auto p-1">
        {ALL_PERMISSION_KEYS.map((key) => {
          const checked = selected.includes(key);
          const inputId = `${idPrefix}-${key}`;
          return (
            <label
              key={key}
              htmlFor={inputId}
              className={`flex items-start gap-2.5 p-2.5 rounded-[var(--radius-control)] border cursor-pointer transition-colors ${
                checked
                  ? 'border-[var(--color-primary)] bg-[var(--color-surface-alt)]'
                  : 'border-[var(--color-border)] bg-[var(--color-surface)] hover:bg-[var(--color-surface-alt)]'
              }`}
            >
              <input
                id={inputId}
                type="checkbox"
                checked={checked}
                onChange={() => onChange(togglePermissionInList(selected, key))}
                className="mt-1 w-4 h-4 accent-[var(--color-primary)]"
              />
              <div className="min-w-0 space-y-0.5">
                <p className="text-xs font-semibold text-[var(--color-text)]">
                  {t(getPermissionLabelKey(key))}
                </p>
                <p className="text-[11px] text-[var(--color-muted)] leading-snug">
                  {t(getPermissionDescKey(key))}
                </p>
              </div>
            </label>
          );
        })}
      </div>
    </div>
  );

  return (
    <AdminLayout currentRoute={currentRoute}>
      <div className="space-y-6">
        <section className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-card)] shadow-[var(--shadow-card)] p-5 sm:p-6 flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1 max-w-2xl">
            <h1 className="text-xl sm:text-2xl font-bold text-[var(--color-text)] flex items-center gap-2">
              <ShieldCheck className="w-6 h-6 text-[var(--color-primary)] shrink-0" aria-hidden="true" />
              <span>{t('admin.staff.title')}</span>
            </h1>
            <p className="text-xs sm:text-sm text-[var(--color-muted)] leading-relaxed">
              {t('admin.staff.subtitle')}
            </p>
          </div>

          <Button
            variant="primary"
            onClick={handleOpenCreate}
            startIcon={<UserPlus className="w-4 h-4" />}
          >
            {t('admin.staff.createButton')}
          </Button>
        </section>

        {feedback && (
          <div className="space-y-2">
            <Alert
              variant={feedback.variant}
              title={feedback.title}
              message={feedback.message}
              onDismiss={() => setFeedback(null)}
            />
            {feedback.tempPassword && (
              <div className="p-4 rounded-[var(--radius-control)] border border-[var(--color-border-strong)] bg-[var(--color-surface)] flex flex-wrap items-center justify-between gap-3">
                <span className="text-xs sm:text-sm font-semibold text-[var(--color-text)]">
                  {t('setup.tempPasswordLabel')}:
                </span>
                <code
                  dir="ltr"
                  className="px-3 py-1.5 rounded-[var(--radius-control)] bg-[var(--color-surface-alt)] font-mono text-sm font-bold text-[var(--color-primary)] select-all"
                >
                  {feedback.tempPassword}
                </code>
              </div>
            )}
          </div>
        )}

        <Table
          columns={columns}
          rows={isLoading ? [] : items}
          getRowKey={(row) => String(row.user.id)}
        />
      </div>

      {/* Create Staff Modal */}
      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title={t('admin.staff.modal.createTitle')}
      >
        <form onSubmit={(e) => void handleCreateSubmit(e)} className="space-y-4">
          {createError && <Alert variant="error" message={createError} />}

          <FormField
            id="staff-create-displayName"
            label={t('admin.staff.field.displayName')}
            value={displayName}
            onChange={setDisplayName}
            placeholder={t('admin.staff.field.displayNamePlaceholder')}
            required
          />

          <FormField
            id="staff-create-email"
            label={t('admin.staff.field.email')}
            type="email"
            value={email}
            onChange={setEmail}
            placeholder={t('admin.staff.field.emailPlaceholder')}
          />

          <FormField
            id="staff-create-phone"
            label={t('admin.staff.field.phone')}
            value={phoneNumber}
            onChange={setPhoneNumber}
            placeholder={t('admin.staff.field.phonePlaceholder')}
            hint={t('admin.staff.field.contactHint')}
          />

          {renderPermissionChecklist(
            selectedPermissions,
            setSelectedPermissions,
            'create-perm',
          )}

          <div className="pt-2 flex flex-wrap items-center justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setCreateOpen(false)}
            >
              {t('admin.staff.modal.cancel')}
            </Button>
            <Button
              type="submit"
              variant="primary"
              disabled={isSubmittingCreate}
            >
              {t('admin.staff.modal.submitCreate')}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Edit Staff Permissions Modal */}
      <Modal
        open={editingTarget !== null}
        onClose={() => setEditingTarget(null)}
        title={t('admin.staff.modal.editTitle', {
          name: editingTarget?.user.displayName ?? '',
        })}
        footer={
          <>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setEditingTarget(null)}
            >
              {t('admin.staff.modal.cancel')}
            </Button>
            <Button
              type="button"
              variant="primary"
              disabled={isSubmittingEdit}
              onClick={() => void handleSavePermissions()}
            >
              {t('admin.staff.modal.submitSave')}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {editError && <Alert variant="error" message={editError} />}
          {renderPermissionChecklist(editPermissions, setEditPermissions, 'edit-perm')}
        </div>
      </Modal>
    </AdminLayout>
  );
}
