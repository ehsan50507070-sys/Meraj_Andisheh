import {
  AlertTriangle,
  ArrowRightLeft,
  CheckCircle2,
  Cloud,
  Database,
  Eye,
  EyeOff,
  HardDrive,
  PlugZap,
  RefreshCw,
  Save,
  ShieldCheck,
  Trash2,
  Unplug,
} from 'lucide-react';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import {
  DEFAULT_S3_STORAGE_CONFIG,
  type S3ConnectionTestResult,
  type S3MigrationReport,
  type S3StorageConfig,
  type StorageInventorySummary,
} from '../../../core/domain/storage';
import { useAuth } from '../../auth/AuthContext';
import { Alert, Button, FormField, Modal, Tag } from '../../components/ui';
import type { ResourceKey } from '../../resources/fa';
import { formatFileSizeParts, toPersianDigits } from '../../resources/formatters';
import { t } from '../../resources/i18n';
import { appContainer } from '../../services/appContainer';

function formatBytesText(sizeBytes: number): string {
  const parts = formatFileSizeParts(sizeBytes);
  if (!parts) {
    return t('contentDetail.sizeUnit.bytes', { value: toPersianDigits(0) });
  }
  return t(`contentDetail.sizeUnit.${parts.unit}` as ResourceKey, {
    value: parts.value,
  });
}

export function AdminS3StoragePanel() {
  const { currentUser } = useAuth();
  const [config, setConfig] = useState<S3StorageConfig>({
    ...DEFAULT_S3_STORAGE_CONFIG,
  });
  const [inventory, setInventory] = useState<StorageInventorySummary | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [showSecret, setShowSecret] = useState(false);

  const [isLoading, setIsLoading] = useState(true);
  const [isTesting, setIsTesting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const [isMigrating, setIsMigrating] = useState(false);
  const [isCleaning, setIsCleaning] = useState(false);

  const [testResult, setTestResult] = useState<S3ConnectionTestResult | null>(null);
  const [migrationReport, setMigrationReport] = useState<S3MigrationReport | null>(null);
  const [feedback, setFeedback] = useState<{
    variant: 'success' | 'error' | 'info' | 'warning';
    message: string;
  } | null>(null);

  const [cleanupModalOpen, setCleanupModalOpen] = useState(false);
  const [cleanupConfirmedCheck, setCleanupConfirmedCheck] = useState(false);

  const loadStorageState = useCallback(async () => {
    setIsLoading(true);
    try {
      const [cfgRes, invRes] = await Promise.all([
        appContainer.storageMigrationService.getStorageConfigAsync(currentUser),
        appContainer.storageMigrationService.getStorageInventoryAsync(currentUser),
      ]);
      if (cfgRes.ok) {
        setConfig(cfgRes.data);
      }
      if (invRes.ok) {
        setInventory(invRes.data);
      }
    } finally {
      setIsLoading(false);
    }
  }, [currentUser]);

  useEffect(() => {
    void loadStorageState();
  }, [loadStorageState]);

  const mapFieldErrors = (raw?: Record<string, string>) => {
    if (!raw) {
      setFieldErrors({});
      return;
    }
    const mapped: Record<string, string> = {};
    for (const [key, msgKey] of Object.entries(raw)) {
      mapped[key] = t(msgKey as ResourceKey);
    }
    setFieldErrors(mapped);
  };

  const handleInsertSamplePreset = () => {
    setFieldErrors({});
    setFeedback(null);
    setConfig((prev) => ({
      ...prev,
      provider: 's3',
      endpoint: prev.endpoint || 'https://s3.ir-thr-at1.arvanstorage.ir',
      bucketName: prev.bucketName || 'meraj-media',
      region: prev.region || 'ir-thr-at1',
      accessKeyId: prev.accessKeyId || 'MERAJ-S3-ACCESS-KEY',
      secretAccessKey: prev.secretAccessKey || 'meraj-demo-secret-key-2026',
      forcePathStyle: true,
    }));
  };

  const handleTestConnection = async () => {
    setFieldErrors({});
    setFeedback(null);
    setTestResult(null);
    setIsTesting(true);
    try {
      const res = await appContainer.storageMigrationService.testS3ConnectionAsync(
        currentUser,
        config,
      );
      if (!res.ok) {
        mapFieldErrors(res.fieldErrors);
        setFeedback({
          variant: 'error',
          message: t(res.messageKey as ResourceKey),
        });
        return;
      }
      setTestResult(res.data);
      if (res.data.ok) {
        setFeedback({
          variant: 'success',
          message: t('admin.settings.storage.testConnectionSuccess', {
            bucket: res.data.bucketName,
            ms: toPersianDigits(res.data.latencyMs),
            mode: t(`admin.settings.storage.mode.${res.data.mode}` as ResourceKey),
          }),
        });
      } else {
        setFeedback({
          variant: 'error',
          message: t(
            (res.data.messageKey ??
              'admin.settings.storage.error.connectionProbeFailed') as ResourceKey,
          ),
        });
      }
    } finally {
      setIsTesting(false);
    }
  };

  const handleSaveStorageConfig = async (event: FormEvent) => {
    event.preventDefault();
    setFieldErrors({});
    setFeedback(null);
    setIsSaving(true);
    try {
      const res = await appContainer.storageMigrationService.saveStorageConfigAsync(
        currentUser,
        config,
      );
      if (!res.ok) {
        mapFieldErrors(res.fieldErrors);
        setFeedback({
          variant: 'error',
          message: t(res.messageKey as ResourceKey),
        });
        return;
      }
      setConfig(res.data);
      setFeedback({
        variant: 'success',
        message: t('admin.settings.storage.saveSuccess'),
      });
      await loadStorageState();
    } finally {
      setIsSaving(false);
    }
  };

  const handleDisconnectToLocal = async () => {
    setFeedback(null);
    setIsDisconnecting(true);
    try {
      const res = await appContainer.storageMigrationService.disconnectS3Async(
        currentUser,
      );
      if (!res.ok) {
        setFeedback({
          variant: 'error',
          message: t(res.messageKey as ResourceKey),
        });
        return;
      }
      setConfig(res.data);
      setFeedback({
        variant: 'info',
        message: t('admin.settings.storage.disconnectSuccess'),
      });
      await loadStorageState();
    } finally {
      setIsDisconnecting(false);
    }
  };

  const handleMigrateToS3 = async () => {
    setFeedback(null);
    setIsMigrating(true);
    try {
      const res =
        await appContainer.storageMigrationService.migrateLocalFilesToS3Async(
          currentUser,
        );
      if (!res.ok) {
        setFeedback({
          variant: 'error',
          message: t(res.messageKey as ResourceKey),
        });
        return;
      }
      setMigrationReport(res.data);
      setFeedback({
        variant: 'success',
        message: t('admin.settings.storage.migrationSuccess', {
          migrated: toPersianDigits(res.data.migratedCount),
          skipped: toPersianDigits(res.data.skippedCount),
          updatedFiles: toPersianDigits(res.data.updatedContentFilesCount),
        }),
      });
      await loadStorageState();
    } finally {
      setIsMigrating(false);
    }
  };

  const handleConfirmCleanup = async () => {
    setFeedback(null);
    setIsCleaning(true);
    try {
      const res =
        await appContainer.storageMigrationService.confirmCleanupMigratedLocalFilesAsync(
          currentUser,
          { confirmed: cleanupConfirmedCheck },
        );
      if (!res.ok) {
        setFeedback({
          variant: 'error',
          message: t(res.messageKey as ResourceKey),
        });
        return;
      }
      setCleanupModalOpen(false);
      setCleanupConfirmedCheck(false);
      setFeedback({
        variant: 'success',
        message: t('admin.settings.storage.cleanupSuccess', {
          cleaned: toPersianDigits(res.data.cleanedCount),
          skipped: toPersianDigits(res.data.skippedUnverifiedCount),
        }),
      });
      await loadStorageState();
    } finally {
      setIsCleaning(false);
    }
  };

  return (
    <section className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-card)] shadow-[var(--shadow-card)] p-5 sm:p-6 space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3 pb-4 border-b border-[var(--color-border)]">
        <div className="space-y-1 min-w-0">
          <h2 className="text-base sm:text-lg font-bold text-[var(--color-text)] flex items-center gap-2">
            <Cloud className="w-5 h-5 text-[var(--color-primary)] shrink-0" aria-hidden="true" />
            <span>{t('admin.settings.storage.title')}</span>
          </h2>
          <p className="text-xs sm:text-sm text-[var(--color-muted)] leading-relaxed">
            {t('admin.settings.storage.subtitle')}
          </p>
        </div>

        <Tag
          label={t(
            `admin.settings.storage.activeProviderBadge.${config.provider}` as ResourceKey,
          )}
          variant={config.provider === 's3' ? 'primary' : 'neutral'}
        />
      </div>

      {feedback && (
        <Alert
          variant={feedback.variant}
          message={feedback.message}
          onDismiss={() => setFeedback(null)}
        />
      )}

      {/* Subsection 1: Storage Provider Mode & S3 Credentials */}
      <form onSubmit={(e) => void handleSaveStorageConfig(e)} className="space-y-5">
        <div className="space-y-2.5">
          <span className="block text-sm font-semibold text-[var(--color-text)]">
            {t('admin.settings.storage.providerLabel')}
          </span>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <label
              className={`flex items-start gap-3 p-3.5 rounded-[var(--radius-control)] border cursor-pointer transition-colors ${
                config.provider === 'local'
                  ? 'border-[var(--color-primary)] bg-[var(--color-surface-alt)]'
                  : 'border-[var(--color-border)] bg-[var(--color-surface)] hover:border-[var(--color-border-strong)]'
              }`}
            >
              <input
                type="radio"
                name="storage-provider"
                value="local"
                checked={config.provider === 'local'}
                onChange={() =>
                  setConfig((prev) => ({ ...prev, provider: 'local' }))
                }
                className="mt-1 accent-[var(--color-primary)] shrink-0"
              />
              <div className="space-y-1 min-w-0">
                <div className="flex items-center gap-1.5 text-sm font-semibold text-[var(--color-text)]">
                  <HardDrive className="w-4 h-4 text-[var(--color-primary)] shrink-0" aria-hidden="true" />
                  <span>{t('admin.settings.storage.provider.localTitle')}</span>
                </div>
                <p className="text-xs text-[var(--color-muted)] leading-relaxed">
                  {t('admin.settings.storage.provider.localDesc')}
                </p>
              </div>
            </label>

            <label
              className={`flex items-start gap-3 p-3.5 rounded-[var(--radius-control)] border cursor-pointer transition-colors ${
                config.provider === 's3'
                  ? 'border-[var(--color-primary)] bg-[var(--color-surface-alt)]'
                  : 'border-[var(--color-border)] bg-[var(--color-surface)] hover:border-[var(--color-border-strong)]'
              }`}
            >
              <input
                type="radio"
                name="storage-provider"
                value="s3"
                checked={config.provider === 's3'}
                onChange={() => setConfig((prev) => ({ ...prev, provider: 's3' }))}
                className="mt-1 accent-[var(--color-primary)] shrink-0"
              />
              <div className="space-y-1 min-w-0">
                <div className="flex items-center gap-1.5 text-sm font-semibold text-[var(--color-text)]">
                  <Cloud className="w-4 h-4 text-[var(--color-primary)] shrink-0" aria-hidden="true" />
                  <span>{t('admin.settings.storage.provider.s3Title')}</span>
                </div>
                <p className="text-xs text-[var(--color-muted)] leading-relaxed">
                  {t('admin.settings.storage.provider.s3Desc')}
                </p>
              </div>
            </label>
          </div>
        </div>

        <div className="rounded-[var(--radius-control)] border border-[var(--color-border)] bg-[var(--color-surface-alt)] p-4 sm:p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-bold text-[var(--color-text)]">
              {t('admin.settings.storage.s3FormTitle')}
            </h3>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleInsertSamplePreset}
            >
              {t('admin.settings.storage.fillArvanSampleButton')}
            </Button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FormField
              id="s3-endpoint"
              label={t('admin.settings.storage.endpointLabel')}
              value={config.endpoint}
              onChange={(val) =>
                setConfig((prev) => ({ ...prev, endpoint: val }))
              }
              placeholder={t('admin.settings.storage.endpointPlaceholder')}
              hint={t('admin.settings.storage.endpointHint')}
              error={fieldErrors.endpoint}
            />

            <FormField
              id="s3-bucketName"
              label={t('admin.settings.storage.bucketNameLabel')}
              value={config.bucketName}
              onChange={(val) =>
                setConfig((prev) => ({ ...prev, bucketName: val }))
              }
              placeholder={t('admin.settings.storage.bucketNamePlaceholder')}
              error={fieldErrors.bucketName}
            />

            <FormField
              id="s3-region"
              label={t('admin.settings.storage.regionLabel')}
              value={config.region}
              onChange={(val) =>
                setConfig((prev) => ({ ...prev, region: val }))
              }
              placeholder={t('admin.settings.storage.regionPlaceholder')}
              error={fieldErrors.region}
            />

            <FormField
              id="s3-accessKeyId"
              label={t('admin.settings.storage.accessKeyLabel')}
              value={config.accessKeyId}
              onChange={(val) =>
                setConfig((prev) => ({ ...prev, accessKeyId: val }))
              }
              placeholder={t('admin.settings.storage.accessKeyPlaceholder')}
              error={fieldErrors.accessKeyId}
            />

            <div className="space-y-1.5 w-full">
              <label
                htmlFor="s3-secretAccessKey"
                className="block text-sm font-medium text-[var(--color-text)]"
              >
                {t('admin.settings.storage.secretKeyLabel')}
              </label>
              <div className="relative flex items-center">
                <input
                  id="s3-secretAccessKey"
                  type={showSecret ? 'text' : 'password'}
                  dir="ltr"
                  autoComplete="off"
                  value={config.secretAccessKey}
                  onChange={(e) =>
                    setConfig((prev) => ({
                      ...prev,
                      secretAccessKey: e.target.value,
                    }))
                  }
                  placeholder={t('admin.settings.storage.secretKeyPlaceholder')}
                  aria-invalid={Boolean(fieldErrors.secretAccessKey)}
                  className={`w-full rounded-[var(--radius-control)] bg-[var(--color-surface)] text-[var(--color-text)] placeholder:text-[var(--color-muted)] border transition-colors duration-150 pr-3.5 pl-11 py-2.5 text-sm min-h-[42px] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--color-primary)] ${
                    fieldErrors.secretAccessKey
                      ? 'border-[var(--color-error-text)]'
                      : 'border-[var(--color-border-strong)] hover:border-[var(--color-muted)]'
                  }`}
                />
                <button
                  type="button"
                  onClick={() => setShowSecret((prev) => !prev)}
                  aria-label={
                    showSecret
                      ? t('admin.settings.storage.hideSecretButton')
                      : t('admin.settings.storage.showSecretButton')
                  }
                  className="absolute left-2 p-1.5 rounded text-[var(--color-muted)] hover:text-[var(--color-text)] focus-visible:outline-2 focus-visible:outline-[var(--color-primary)]"
                >
                  {showSecret ? (
                    <EyeOff className="w-4 h-4" aria-hidden="true" />
                  ) : (
                    <Eye className="w-4 h-4" aria-hidden="true" />
                  )}
                </button>
              </div>
              {fieldErrors.secretAccessKey ? (
                <p role="alert" className="text-xs font-medium text-[var(--color-error-text)]">
                  {fieldErrors.secretAccessKey}
                </p>
              ) : (
                <p className="text-xs text-[var(--color-muted)]">
                  {t('admin.settings.storage.secretKeyHint')}
                </p>
              )}
            </div>

            <FormField
              id="s3-publicBaseUrl"
              label={t('admin.settings.storage.publicBaseUrlLabel')}
              value={config.publicBaseUrl}
              onChange={(val) =>
                setConfig((prev) => ({ ...prev, publicBaseUrl: val }))
              }
              placeholder={t('admin.settings.storage.publicBaseUrlPlaceholder')}
              error={fieldErrors.publicBaseUrl}
            />
          </div>

          <label className="flex items-start gap-2.5 pt-1 cursor-pointer">
            <input
              type="checkbox"
              checked={config.forcePathStyle}
              onChange={(e) =>
                setConfig((prev) => ({
                  ...prev,
                  forcePathStyle: e.target.checked,
                }))
              }
              className="mt-1 accent-[var(--color-primary)] shrink-0"
            />
            <span className="space-y-0.5 text-xs sm:text-sm">
              <span className="font-medium text-[var(--color-text)] block">
                {t('admin.settings.storage.forcePathStyleLabel')}
              </span>
              <span className="text-xs text-[var(--color-muted)] block">
                {t('admin.settings.storage.forcePathStyleHint')}
              </span>
            </span>
          </label>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="secondary"
              disabled={isTesting || isLoading}
              onClick={() => void handleTestConnection()}
              startIcon={<PlugZap className="w-4 h-4" />}
            >
              {isTesting
                ? t('admin.settings.storage.testingConnectionButton')
                : t('admin.settings.storage.testConnectionButton')}
            </Button>

            {config.provider === 's3' && (
              <Button
                type="button"
                variant="outline"
                disabled={isDisconnecting}
                onClick={() => void handleDisconnectToLocal()}
                startIcon={<Unplug className="w-4 h-4" />}
              >
                {t('admin.settings.storage.disconnectS3Button')}
              </Button>
            )}
          </div>

          <Button
            type="submit"
            variant="primary"
            disabled={isSaving || isLoading}
            startIcon={<Save className="w-4 h-4" />}
          >
            {isSaving
              ? t('admin.settings.storage.savingStorageButton')
              : t('admin.settings.storage.saveStorageButton')}
          </Button>
        </div>

        {testResult && testResult.ok && (
          <p className="text-xs text-[var(--color-success-text)] flex items-center gap-1.5">
            <CheckCircle2 className="w-4 h-4 shrink-0" aria-hidden="true" />
            <span>
              {t('admin.settings.storage.testConnectionSuccess', {
                bucket: testResult.bucketName,
                ms: toPersianDigits(testResult.latencyMs),
                mode: t(
                  `admin.settings.storage.mode.${testResult.mode}` as ResourceKey,
                ),
              })}
            </span>
          </p>
        )}
      </form>

      {/* Subsection 2: One-Time Migration & Verified Manual Cleanup */}
      <div className="pt-5 border-t border-[var(--color-border)] space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1 min-w-0">
            <h3 className="text-sm sm:text-base font-bold text-[var(--color-text)] flex items-center gap-2">
              <ArrowRightLeft className="w-4 h-4 text-[var(--color-primary)] shrink-0" aria-hidden="true" />
              <span>{t('admin.settings.storage.migrationTitle')}</span>
            </h3>
            <p className="text-xs text-[var(--color-muted)] leading-relaxed">
              {t('admin.settings.storage.migrationSubtitle')}
            </p>
          </div>

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void loadStorageState()}
            disabled={isLoading}
            startIcon={
              <RefreshCw
                className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`}
              />
            }
          >
            {t('admin.settings.storage.refreshInventoryButton')}
          </Button>
        </div>

        {/* Inventory KPI Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 tabular-nums-strict">
          <div className="rounded-[var(--radius-control)] border border-[var(--color-border)] bg-[var(--color-surface-alt)] p-3 space-y-1">
            <span className="text-[11px] text-[var(--color-muted)] block">
              {t('admin.settings.storage.stat.localCount')}
            </span>
            <p className="text-sm sm:text-base font-bold text-[var(--color-text)]">
              {inventory
                ? t('admin.settings.storage.stat.filesCountValue', {
                    count: toPersianDigits(inventory.localFilesCount),
                  })
                : '—'}
            </p>
          </div>

          <div className="rounded-[var(--radius-control)] border border-[var(--color-border)] bg-[var(--color-surface-alt)] p-3 space-y-1">
            <span className="text-[11px] text-[var(--color-muted)] block">
              {t('admin.settings.storage.stat.localSize')}
            </span>
            <p className="text-sm sm:text-base font-bold text-[var(--color-text)]">
              {inventory ? formatBytesText(inventory.localTotalBytes) : '—'}
            </p>
          </div>

          <div className="rounded-[var(--radius-control)] border border-[var(--color-border)] bg-[var(--color-surface-alt)] p-3 space-y-1">
            <span className="text-[11px] text-[var(--color-muted)] block">
              {t('admin.settings.storage.stat.s3Count')}
            </span>
            <p className="text-sm sm:text-base font-bold text-[var(--color-text)]">
              {inventory
                ? t('admin.settings.storage.stat.filesCountValue', {
                    count: toPersianDigits(inventory.s3FilesCount),
                  })
                : '—'}
            </p>
          </div>

          <div className="rounded-[var(--radius-control)] border border-[var(--color-border)] bg-[var(--color-surface-alt)] p-3 space-y-1">
            <span className="text-[11px] text-[var(--color-muted)] block">
              {t('admin.settings.storage.stat.s3Size')}
            </span>
            <p className="text-sm sm:text-base font-bold text-[var(--color-text)]">
              {inventory ? formatBytesText(inventory.s3TotalBytes) : '—'}
            </p>
          </div>

          <div className="rounded-[var(--radius-control)] border border-[var(--color-border)] bg-[var(--color-surface-alt)] p-3 space-y-1">
            <span className="text-[11px] text-[var(--color-muted)] block">
              {t('admin.settings.storage.stat.pendingMigration')}
            </span>
            <p className="text-sm sm:text-base font-bold text-[var(--color-primary)]">
              {inventory
                ? t('admin.settings.storage.stat.filesCountValue', {
                    count: toPersianDigits(inventory.pendingMigrationCount),
                  })
                : '—'}
            </p>
          </div>
        </div>

        <Alert
          variant="info"
          message={t('admin.settings.storage.preservedNotice')}
        />

        <div className="flex flex-wrap items-center justify-between gap-3">
          <Button
            type="button"
            variant="primary"
            disabled={isMigrating || isLoading}
            onClick={() => void handleMigrateToS3()}
            startIcon={<Database className="w-4 h-4" />}
          >
            {isMigrating
              ? t('admin.settings.storage.migratingButton')
              : t('admin.settings.storage.migrateButton')}
          </Button>

          <p className="text-xs text-[var(--color-muted)]">
            {t('admin.settings.storage.guideHint')}
          </p>
        </div>

        {migrationReport && migrationReport.items.length > 0 && (
          <div className="overflow-x-auto rounded-[var(--radius-control)] border border-[var(--color-border)]">
            <table className="w-full text-right text-xs">
              <thead className="bg-[var(--color-surface-alt)] text-[var(--color-muted)] border-b border-[var(--color-border)]">
                <tr>
                  <th className="py-2.5 px-3 font-semibold">
                    {t('admin.settings.storage.report.colFile')}
                  </th>
                  <th className="py-2.5 px-3 font-semibold whitespace-nowrap">
                    {t('admin.settings.storage.report.colSize')}
                  </th>
                  <th className="py-2.5 px-3 font-semibold whitespace-nowrap">
                    {t('admin.settings.storage.report.colStatus')}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-border)]">
                {migrationReport.items.map((item) => (
                  <tr key={item.storageKey}>
                    <td className="py-2 px-3">
                      <div className="font-medium text-[var(--color-text)]">
                        {item.originalFileName}
                      </div>
                      <code dir="ltr" className="text-[11px] font-mono text-[var(--color-muted)] break-all">
                        {item.storageKey}
                      </code>
                    </td>
                    <td className="py-2 px-3 whitespace-nowrap tabular-nums-strict">
                      {formatBytesText(item.sizeBytes)}
                    </td>
                    <td className="py-2 px-3 whitespace-nowrap">
                      <Tag
                        label={t(
                          `admin.settings.storage.report.status.${item.status}` as ResourceKey,
                        )}
                        variant={
                          item.status === 'migrated'
                            ? 'success'
                            : item.status === 'already_in_s3'
                              ? 'primary'
                              : 'warning'
                        }
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Separate Explicit Verified Cleanup Section */}
        <div className="rounded-[var(--radius-control)] border border-[var(--color-border)] bg-[var(--color-surface-alt)] p-4 flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-1 min-w-0 flex-1">
            <h4 className="text-xs sm:text-sm font-bold text-[var(--color-text)] flex items-center gap-1.5">
              <ShieldCheck className="w-4 h-4 text-[var(--color-warning-text)] shrink-0" aria-hidden="true" />
              <span>{t('admin.settings.storage.cleanupSectionTitle')}</span>
            </h4>
            <p className="text-xs text-[var(--color-muted)] leading-relaxed">
              {t('admin.settings.storage.cleanupSectionDesc')}
            </p>
          </div>

          <Button
            type="button"
            variant="danger"
            size="sm"
            disabled={
              isCleaning ||
              !inventory ||
              !inventory.isS3Configured ||
              inventory.migratedOrMatchingInS3Count === 0
            }
            onClick={() => {
              setCleanupConfirmedCheck(false);
              setCleanupModalOpen(true);
            }}
            startIcon={<Trash2 className="w-4 h-4" />}
          >
            {t('admin.settings.storage.openCleanupModalButton')}
          </Button>
        </div>
      </div>

      {/* Explicit Double Confirmation Modal for Verified Local Cleanup */}
      <Modal
        open={cleanupModalOpen}
        onClose={() => setCleanupModalOpen(false)}
        title={t('admin.settings.storage.cleanupModalTitle')}
        footer={
          <>
            <Button
              variant="outline"
              onClick={() => setCleanupModalOpen(false)}
              disabled={isCleaning}
            >
              {t('admin.settings.storage.cleanupCancelButton')}
            </Button>
            <Button
              variant="danger"
              disabled={!cleanupConfirmedCheck || isCleaning}
              onClick={() => void handleConfirmCleanup()}
              startIcon={<Trash2 className="w-4 h-4" />}
            >
              {t('admin.settings.storage.cleanupConfirmButton')}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="flex items-start gap-2.5 p-3 rounded-[var(--radius-control)] bg-[var(--color-warning-bg)] text-[var(--color-warning-text)] text-xs sm:text-sm leading-relaxed">
            <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" aria-hidden="true" />
            <p>
              {t('admin.settings.storage.cleanupModalWarning', {
                bucket: config.bucketName || 'S3',
              })}
            </p>
          </div>

          <label className="flex items-start gap-2.5 cursor-pointer text-xs sm:text-sm text-[var(--color-text)]">
            <input
              type="checkbox"
              checked={cleanupConfirmedCheck}
              onChange={(e) => setCleanupConfirmedCheck(e.target.checked)}
              className="mt-1 accent-[var(--color-primary)] shrink-0"
            />
            <span>{t('admin.settings.storage.cleanupModalCheckboxLabel')}</span>
          </label>
        </div>
      </Modal>
    </section>
  );
}
