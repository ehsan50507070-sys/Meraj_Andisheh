import {
  AlertTriangle,
  Archive,
  BookOpen,
  CheckCircle2,
  Clock,
  Download,
  FlaskConical,
  HardDrive,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Upload,
} from 'lucide-react';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
} from 'react';
import type {
  BackupLog,
  BackupRestoreReport,
  BackupSnapshotFile,
} from '../../../core/domain/backup';
import { MAX_RETAINED_BACKUPS } from '../../../core/services/backupService';
import { envConfig } from '../../../infrastructure/config/envConfig';
import { STORE_NAMES } from '../../../infrastructure/data/migrations';
import type { BackupSchedulerState } from '../../../infrastructure/jobs/BackupScheduler';
import { useAuth } from '../../auth/AuthContext';
import { Alert, Button, Modal } from '../../components/ui';
import type { ResourceKey } from '../../resources/fa';
import {
  formatFileSizeParts,
  formatJalaliDateTimePersian,
  toPersianDigits,
} from '../../resources/formatters';
import { t } from '../../resources/i18n';
import { appContainer } from '../../services/appContainer';
import { AdminLayout } from '../AdminLayout';

export interface AdminBackupPageProps {
  currentRoute: string;
}

function formatByteSizePersian(sizeBytes: number | null | undefined): string {
  const parts = formatFileSizeParts(sizeBytes);
  if (!parts) {
    return '—';
  }
  const unitKey = `contentDetail.sizeUnit.${parts.unit}` as ResourceKey;
  return t(unitKey, { value: parts.value });
}

function extractFileNameFromPath(filePath: string): string {
  const segments = filePath.split('/');
  return segments[segments.length - 1] || filePath;
}

function triggerTextFileDownload(fileName: string, content: string): void {
  const blob = new Blob([content], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

function getBackupErrorMessage(errorCode: string | undefined): string {
  switch (errorCode) {
    case 'FORBIDDEN':
      return t('admin.backup.error.FORBIDDEN');
    case 'ARCHIVE_NOT_FOUND':
      return t('admin.backup.error.ARCHIVE_NOT_FOUND');
    case 'BACKUP_CORRUPTED':
      return t('admin.backup.error.BACKUP_CORRUPTED');
    case 'CONFIRMATION_REQUIRED':
      return t('admin.backup.error.CONFIRMATION_REQUIRED');
    case 'RESTORE_FAILED':
      return t('admin.backup.error.RESTORE_FAILED');
    case 'BACKUP_FAILED':
    default:
      return t('admin.backup.error.BACKUP_FAILED');
  }
}

export function AdminBackupPage({ currentRoute }: AdminBackupPageProps) {
  const { currentUser } = useAuth();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [logs, setLogs] = useState<BackupLog[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isRunningManual, setIsRunningManual] = useState<boolean>(false);
  const [testingLogId, setTestingLogId] = useState<number | null>(null);
  const [schedulerState, setSchedulerState] = useState<BackupSchedulerState>(() =>
    appContainer.backupScheduler.getState(),
  );
  const [countdownSeconds, setCountdownSeconds] = useState<number | null>(null);

  const [feedbackSuccess, setFeedbackSuccess] = useState<string | null>(null);
  const [feedbackError, setFeedbackError] = useState<string | null>(null);
  const [reloadPromptReady, setReloadPromptReady] = useState<boolean>(false);

  // Uploaded .bak file preview & restore state
  const [uploadedFileName, setUploadedFileName] = useState<string | null>(null);
  const [uploadedRawText, setUploadedRawText] = useState<string | null>(null);
  const [parsedSnapshot, setParsedSnapshot] = useState<BackupSnapshotFile | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isTestingUploadedSandbox, setIsTestingUploadedSandbox] = useState<boolean>(false);
  const [sandboxReport, setSandboxReport] = useState<BackupRestoreReport | null>(null);

  // Primary restore two-step modal
  const [confirmModalOpen, setConfirmModalOpen] = useState<boolean>(false);
  const [confirmCheckbox, setConfirmCheckbox] = useState<boolean>(false);
  const [isRestoringPrimary, setIsRestoringPrimary] = useState<boolean>(false);

  const loadLogs = useCallback(
    async (silent = false) => {
      if (!silent) {
        setIsLoading(true);
      }
      try {
        const res = await appContainer.backupService.listBackupLogsAsync(
          currentUser,
          currentRoute,
        );
        if (res.ok && res.logs) {
          setLogs(res.logs);
        } else if (!silent) {
          setFeedbackError(getBackupErrorMessage(res.errorCode));
        }
      } finally {
        if (!silent) {
          setIsLoading(false);
        }
      }
    },
    [currentRoute, currentUser],
  );

  useEffect(() => {
    void loadLogs(false);
  }, [loadLogs]);

  // Subscribe to scheduler ticks so live 1-minute dev tests auto-refresh the table
  useEffect(() => {
    const syncState = () => {
      setSchedulerState(appContainer.backupScheduler.getState());
      void loadLogs(true);
    };
    const unsubscribe = appContainer.backupScheduler.subscribe(syncState);
    return () => {
      unsubscribe();
    };
  }, [loadLogs]);

  // Live countdown display when Dev 1-minute mode is enabled
  useEffect(() => {
    if (!schedulerState.isRunning || !schedulerState.isDevOneMinuteMode) {
      setCountdownSeconds(null);
      return;
    }

    const updateCountdown = () => {
      const nextMs = Date.parse(appContainer.backupScheduler.getState().nextRunAtIso);
      const remainingSec = Math.max(0, Math.ceil((nextMs - Date.now()) / 1000));
      setCountdownSeconds(remainingSec);
    };

    updateCountdown();
    const timer = setInterval(updateCountdown, 1000);
    return () => clearInterval(timer);
  }, [schedulerState.isRunning, schedulerState.isDevOneMinuteMode, schedulerState.nextRunAtIso]);

  const retainedLogs = useMemo(
    () => logs.filter((item) => item.status === 'Succeeded' && item.isRetained),
    [logs],
  );

  const lastSucceededLog = useMemo(
    () => logs.find((item) => item.status === 'Succeeded') ?? null,
    [logs],
  );

  const totalRetainedBytes = useMemo(
    () => retainedLogs.reduce((acc, item) => acc + (item.sizeBytes ?? 0), 0),
    [retainedLogs],
  );

  const handleManualBackup = async () => {
    setFeedbackSuccess(null);
    setFeedbackError(null);
    setIsRunningManual(true);
    try {
      const res = await appContainer.backupService.runBackupAsync(
        currentUser,
        'Manual',
        { routePath: currentRoute },
      );
      if (!res.ok || !res.backupLog) {
        setFeedbackError(getBackupErrorMessage(res.errorCode));
        return;
      }

      const fileName = extractFileNameFromPath(res.backupLog.filePath);
      if (res.prunedCount && res.prunedCount > 0) {
        setFeedbackSuccess(
          t('admin.backup.feedback.manualPruned', {
            fileName,
            count: toPersianDigits(res.prunedCount),
          }),
        );
      } else {
        setFeedbackSuccess(
          t('admin.backup.feedback.manualSuccess', { fileName }),
        );
      }
      await loadLogs(true);
    } finally {
      setIsRunningManual(false);
    }
  };

  const handleToggleDevOneMinuteMode = () => {
    if (!envConfig.isDevelopment) {
      return;
    }
    const nextEnabled = !schedulerState.isDevOneMinuteMode;
    appContainer.backupScheduler.setDevOneMinuteMode(nextEnabled);
    setSchedulerState(appContainer.backupScheduler.getState());
  };

  const handleDownloadArchive = async (logId: number) => {
    setFeedbackSuccess(null);
    setFeedbackError(null);
    const res = await appContainer.backupService.downloadBackupArchiveAsync(
      currentUser,
      logId,
      currentRoute,
    );
    if (!res.ok || !res.fileName || typeof res.payloadText !== 'string') {
      setFeedbackError(getBackupErrorMessage(res.errorCode));
      return;
    }
    triggerTextFileDownload(res.fileName, res.payloadText);
    setFeedbackSuccess(
      t('admin.backup.feedback.downloadStarted', { fileName: res.fileName }),
    );
  };

  const handleTestRestoreFromLog = async (logId: number) => {
    setFeedbackSuccess(null);
    setFeedbackError(null);
    setTestingLogId(logId);
    try {
      const res = await appContainer.backupService.testRestoreOnSandboxAsync(
        currentUser,
        { backupLogId: logId },
        currentRoute,
      );
      if (!res.ok || !res.report) {
        setFeedbackError(getBackupErrorMessage(res.errorCode));
        return;
      }
      setSandboxReport(res.report);
      setFeedbackSuccess(
        t('admin.backup.feedback.sandboxSuccess', {
          dbName: res.report.targetDatabaseName,
          tables: toPersianDigits(res.report.restoredTablesCount),
          records: toPersianDigits(res.report.restoredRecordsCount),
          files: toPersianDigits(res.report.restoredFilesCount),
          contents: toPersianDigits(res.report.verifiedContentsCount),
          users: toPersianDigits(res.report.verifiedUsersCount),
          topics: toPersianDigits(res.report.verifiedTopicsCount),
        }),
      );
    } finally {
      setTestingLogId(null);
    }
  };

  const handleClearUploadedFile = () => {
    setUploadedFileName(null);
    setUploadedRawText(null);
    setParsedSnapshot(null);
    setUploadError(null);
    setSandboxReport(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleSelectRestoreFile = async (event: ChangeEvent<HTMLInputElement>) => {
    setUploadError(null);
    setParsedSnapshot(null);
    setUploadedRawText(null);
    setSandboxReport(null);
    setFeedbackSuccess(null);
    setFeedbackError(null);

    const file = event.target.files?.[0];
    if (!file) {
      setUploadedFileName(null);
      return;
    }

    setUploadedFileName(file.name);
    try {
      const text = await file.text();
      const parsed = await appContainer.backupService.parseAndValidateBackupFileAsync(
        text,
      );
      if (!parsed.ok || !parsed.snapshot) {
        setUploadError(t('admin.backup.error.BACKUP_CORRUPTED'));
        return;
      }
      setUploadedRawText(text);
      setParsedSnapshot(parsed.snapshot);
    } catch {
      setUploadError(t('admin.backup.error.fileReadFailed'));
    }
  };

  const handleTestUploadedSandbox = async () => {
    if (!uploadedRawText) {
      return;
    }
    setFeedbackSuccess(null);
    setFeedbackError(null);
    setIsTestingUploadedSandbox(true);
    try {
      const res = await appContainer.backupService.testRestoreOnSandboxAsync(
        currentUser,
        { rawContent: uploadedRawText },
        currentRoute,
      );
      if (!res.ok || !res.report) {
        setFeedbackError(getBackupErrorMessage(res.errorCode));
        return;
      }
      setSandboxReport(res.report);
      setFeedbackSuccess(
        t('admin.backup.feedback.sandboxSuccess', {
          dbName: res.report.targetDatabaseName,
          tables: toPersianDigits(res.report.restoredTablesCount),
          records: toPersianDigits(res.report.restoredRecordsCount),
          files: toPersianDigits(res.report.restoredFilesCount),
          contents: toPersianDigits(res.report.verifiedContentsCount),
          users: toPersianDigits(res.report.verifiedUsersCount),
          topics: toPersianDigits(res.report.verifiedTopicsCount),
        }),
      );
    } finally {
      setIsTestingUploadedSandbox(false);
    }
  };

  const openConfirmPrimaryModal = () => {
    if (!uploadedRawText || !parsedSnapshot) {
      return;
    }
    setConfirmCheckbox(false);
    setConfirmModalOpen(true);
  };

  const handleConfirmPrimaryRestore = async () => {
    if (!uploadedRawText || !confirmCheckbox) {
      return;
    }
    setFeedbackSuccess(null);
    setFeedbackError(null);
    setIsRestoringPrimary(true);
    try {
      const res = await appContainer.backupService.restoreFullDatabaseAsync(
        currentUser,
        { rawContent: uploadedRawText, confirmed: true },
        currentRoute,
      );
      setConfirmModalOpen(false);
      if (!res.ok || !res.report) {
        setFeedbackError(getBackupErrorMessage(res.errorCode));
        return;
      }
      setReloadPromptReady(true);
      setFeedbackSuccess(
        t('admin.backup.feedback.primaryRestoreSuccess', {
          dbName: res.report.targetDatabaseName,
          tables: toPersianDigits(res.report.restoredTablesCount),
          records: toPersianDigits(res.report.restoredRecordsCount),
          files: toPersianDigits(res.report.restoredFilesCount),
        }),
      );
      await loadLogs(true);
    } finally {
      setIsRestoringPrimary(false);
    }
  };

  const previewContentsCount =
    parsedSnapshot?.counts.byTable[STORE_NAMES.CONTENT_ITEMS] ?? 0;
  const previewUsersCount =
    parsedSnapshot?.counts.byTable[STORE_NAMES.USERS] ?? 0;
  const previewTopicsCount =
    parsedSnapshot?.counts.byTable[STORE_NAMES.TOPICS] ?? 0;

  return (
    <AdminLayout currentRoute={currentRoute}>
      <div className="space-y-6">
        {/* Page Heading */}
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
          <div className="space-y-1.5 min-w-0">
            <h1 className="text-xl sm:text-2xl font-bold text-[var(--color-text)] flex items-center gap-2.5">
              <Archive
                className="w-6 h-6 text-[var(--color-primary)] shrink-0"
                aria-hidden="true"
              />
              <span>{t('admin.backup.title')}</span>
            </h1>
            <p className="text-sm text-[var(--color-muted)] leading-relaxed">
              {t('admin.backup.subtitle')}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void loadLogs(false)}
              disabled={isLoading || isRunningManual}
              startIcon={
                <RefreshCw
                  className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`}
                />
              }
            >
              {t('admin.backup.refreshButton')}
            </Button>
            <Button
              variant="primary"
              onClick={() => void handleManualBackup()}
              disabled={isRunningManual}
              startIcon={
                <Archive
                  className={`w-4 h-4 ${isRunningManual ? 'animate-pulse' : ''}`}
                />
              }
            >
              {isRunningManual
                ? t('admin.backup.manualBackupRunning')
                : t('admin.backup.manualBackupButton')}
            </Button>
          </div>
        </div>

        {/* Alerts */}
        {feedbackError && (
          <Alert
            variant="error"
            message={feedbackError}
            onDismiss={() => setFeedbackError(null)}
          />
        )}

        {feedbackSuccess && (
          <div className="space-y-2">
            <Alert
              variant="success"
              message={feedbackSuccess}
              onDismiss={() => setFeedbackSuccess(null)}
            />
            {reloadPromptReady && (
              <div className="flex justify-end">
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => window.location.reload()}
                  startIcon={<RotateCcw className="w-4 h-4" />}
                >
                  {t('admin.backup.feedback.reloadPageButton')}
                </Button>
              </div>
            )}
          </div>
        )}

        {/* Top Status Overview Cards */}
        <section className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-card)] p-4 shadow-[var(--shadow-card)] space-y-2">
            <div className="flex items-center justify-between gap-2 text-xs text-[var(--color-muted)]">
              <span>{t('admin.backup.status.schedulerLabel')}</span>
              <Clock className="w-4 h-4 text-[var(--color-primary)] shrink-0" aria-hidden="true" />
            </div>
            <p className="text-sm font-semibold text-[var(--color-text)]">
              {!schedulerState.isRunning
                ? t('admin.backup.status.schedulerStopped')
                : schedulerState.isDevOneMinuteMode
                  ? t('admin.backup.status.schedulerDev1Min')
                  : t('admin.backup.status.schedulerWeekly')}
            </p>
            <p className="text-xs text-[var(--color-muted)] tabular-nums-strict">
              {schedulerState.isDevOneMinuteMode && countdownSeconds !== null
                ? countdownSeconds === 0
                  ? t('admin.backup.status.nextRunImminent')
                  : t('admin.backup.status.nextRunCountdown', {
                      seconds: toPersianDigits(countdownSeconds),
                    })
                : t('admin.backup.status.nextRunWeeklyAt', {
                    date: formatJalaliDateTimePersian(schedulerState.nextRunAtIso),
                  })}
            </p>
          </div>

          <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-card)] p-4 shadow-[var(--shadow-card)] space-y-2">
            <div className="flex items-center justify-between gap-2 text-xs text-[var(--color-muted)]">
              <span>{t('admin.backup.status.lastSuccessLabel')}</span>
              <CheckCircle2
                className="w-4 h-4 text-[var(--color-success-text)] shrink-0"
                aria-hidden="true"
              />
            </div>
            <p className="text-sm font-semibold text-[var(--color-text)] tabular-nums-strict">
              {lastSucceededLog
                ? formatJalaliDateTimePersian(lastSucceededLog.startedAt)
                : t('admin.backup.status.noSuccessYet')}
            </p>
            {lastSucceededLog && (
              <p className="text-xs text-[var(--color-muted)] font-mono truncate" dir="ltr">
                {extractFileNameFromPath(lastSucceededLog.filePath)}
              </p>
            )}
          </div>

          <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-card)] p-4 shadow-[var(--shadow-card)] space-y-2">
            <div className="flex items-center justify-between gap-2 text-xs text-[var(--color-muted)]">
              <span>{t('admin.backup.status.retainedCountLabel')}</span>
              <Archive
                className="w-4 h-4 text-[var(--color-primary)] shrink-0"
                aria-hidden="true"
              />
            </div>
            <p className="text-lg font-bold text-[var(--color-text)] tabular-nums-strict">
              {t('admin.backup.status.retainedCountValue', {
                count: toPersianDigits(retainedLogs.length),
                max: toPersianDigits(MAX_RETAINED_BACKUPS),
              })}
            </p>
          </div>

          <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-card)] p-4 shadow-[var(--shadow-card)] space-y-2">
            <div className="flex items-center justify-between gap-2 text-xs text-[var(--color-muted)]">
              <span>{t('admin.backup.status.totalSizeLabel')}</span>
              <HardDrive
                className="w-4 h-4 text-[var(--color-primary)] shrink-0"
                aria-hidden="true"
              />
            </div>
            <p className="text-lg font-bold text-[var(--color-text)] tabular-nums-strict">
              {formatByteSizePersian(totalRetainedBytes)}
            </p>
          </div>
        </section>

        {/* Dev-Only Scheduler 1-Minute Test Mode Switch */}
        {envConfig.isDevelopment && (
          <section className="bg-[var(--color-surface-alt)] border border-[var(--color-border)] rounded-[var(--radius-card)] p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div className="space-y-1 min-w-0">
              <h2 className="text-sm font-semibold text-[var(--color-text)]">
                {t('admin.backup.devMode.title')}
              </h2>
              <p className="text-xs text-[var(--color-muted)] leading-relaxed">
                {t('admin.backup.devMode.desc')}
              </p>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <span className="text-xs font-medium text-[var(--color-text)]">
                {t('admin.backup.devMode.toggleLabel')}
              </span>
              <button
                type="button"
                role="switch"
                aria-checked={schedulerState.isDevOneMinuteMode}
                aria-label={t('admin.backup.devMode.toggleAria')}
                onClick={handleToggleDevOneMinuteMode}
                className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary)] ${
                  schedulerState.isDevOneMinuteMode
                    ? 'bg-[var(--color-primary)]'
                    : 'bg-[var(--color-border)]'
                }`}
              >
                <span
                  aria-hidden="true"
                  className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow transition ${
                    schedulerState.isDevOneMinuteMode
                      ? '-translate-x-5'
                      : 'translate-x-0'
                  }`}
                />
              </button>
            </div>
          </section>
        )}

        {/* BackupLog History */}
        <section className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-card)] shadow-[var(--shadow-card)] p-5 space-y-4">
          <div className="space-y-1 pb-3 border-b border-[var(--color-border)]">
            <h2 className="text-base sm:text-lg font-semibold text-[var(--color-text)]">
              {t('admin.backup.history.title')}
            </h2>
            <p className="text-xs sm:text-sm text-[var(--color-muted)]">
              {t('admin.backup.history.subtitle')}
            </p>
          </div>

          {isLoading ? (
            <p className="py-8 text-center text-sm text-[var(--color-muted)]">
              {t('admin.backup.loading')}
            </p>
          ) : logs.length === 0 ? (
            <div className="py-10 text-center space-y-1.5">
              <p className="text-sm font-semibold text-[var(--color-text)]">
                {t('admin.backup.history.emptyTitle')}
              </p>
              <p className="text-xs text-[var(--color-muted)]">
                {t('admin.backup.history.emptyDesc')}
              </p>
            </div>
          ) : (
            <>
              {/* Desktop Table */}
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-right border-collapse text-xs sm:text-sm">
                  <thead>
                    <tr className="border-b border-[var(--color-border)] text-[var(--color-muted)]">
                      <th className="py-2.5 px-3 font-medium">
                        {t('admin.backup.table.colDate')}
                      </th>
                      <th className="py-2.5 px-3 font-medium">
                        {t('admin.backup.table.colKind')}
                      </th>
                      <th className="py-2.5 px-3 font-medium">
                        {t('admin.backup.table.colStatus')}
                      </th>
                      <th className="py-2.5 px-3 font-medium">
                        {t('admin.backup.table.colFile')}
                      </th>
                      <th className="py-2.5 px-3 font-medium">
                        {t('admin.backup.table.colSize')}
                      </th>
                      <th className="py-2.5 px-3 font-medium">
                        {t('admin.backup.table.colRetention')}
                      </th>
                      <th className="py-2.5 px-3 font-medium">
                        {t('admin.backup.table.colActions')}
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--color-border)]">
                    {logs.map((entry) => {
                      const fileName = extractFileNameFromPath(entry.filePath);
                      const statusKey =
                        `admin.backup.logStatus.${entry.status}` as ResourceKey;
                      const kindKey =
                        `admin.backup.kind.${entry.kind}` as ResourceKey;
                      const statusColor =
                        entry.status === 'Succeeded'
                          ? 'bg-[var(--color-success-bg)] text-[var(--color-success-text)]'
                          : entry.status === 'Failed'
                            ? 'bg-[var(--color-error-bg)] text-[var(--color-error-text)]'
                            : 'bg-[var(--color-info-bg)] text-[var(--color-info-text)]';

                      return (
                        <tr key={entry.id} className="align-middle">
                          <td className="py-3 px-3 tabular-nums-strict whitespace-nowrap text-[var(--color-text)]">
                            {formatJalaliDateTimePersian(entry.startedAt)}
                          </td>
                          <td className="py-3 px-3 whitespace-nowrap text-[var(--color-text)]">
                            {t(kindKey)}
                          </td>
                          <td className="py-3 px-3 whitespace-nowrap">
                            <span
                              className={`inline-flex items-center px-2 py-0.5 rounded-[var(--radius-control)] text-xs font-medium ${statusColor}`}
                            >
                              {t(statusKey)}
                            </span>
                          </td>
                          <td className="py-3 px-3 font-mono text-xs text-[var(--color-text)] max-w-[220px] truncate" dir="ltr">
                            {fileName}
                          </td>
                          <td className="py-3 px-3 whitespace-nowrap tabular-nums-strict text-[var(--color-text)]">
                            {formatByteSizePersian(entry.sizeBytes)}
                          </td>
                          <td className="py-3 px-3 whitespace-nowrap text-xs">
                            {entry.status === 'Succeeded' ? (
                              entry.isRetained ? (
                                <span className="text-[var(--color-success-text)] font-medium">
                                  {t('admin.backup.retention.retained')}
                                </span>
                              ) : (
                                <span className="text-[var(--color-muted)]">
                                  {t('admin.backup.retention.pruned')}
                                </span>
                              )
                            ) : (
                              '—'
                            )}
                          </td>
                          <td className="py-3 px-3 whitespace-nowrap">
                            {entry.status === 'Succeeded' && entry.isRetained ? (
                              <div className="flex items-center gap-2">
                                <Button
                                  variant="secondary"
                                  size="sm"
                                  onClick={() => void handleDownloadArchive(entry.id)}
                                  startIcon={<Download className="w-3.5 h-3.5" />}
                                >
                                  {t('admin.backup.actions.download')}
                                </Button>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  disabled={testingLogId === entry.id}
                                  onClick={() =>
                                    void handleTestRestoreFromLog(entry.id)
                                  }
                                  startIcon={
                                    <FlaskConical className="w-3.5 h-3.5" />
                                  }
                                >
                                  {testingLogId === entry.id
                                    ? t('admin.backup.actions.testingRestore')
                                    : t('admin.backup.actions.testRestore')}
                                </Button>
                              </div>
                            ) : (
                              <span className="text-xs text-[var(--color-muted)]">
                                {t('admin.backup.actions.noArchive')}
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Mobile Stacked Cards */}
              <ul className="md:hidden divide-y divide-[var(--color-border)]">
                {logs.map((entry) => {
                  const fileName = extractFileNameFromPath(entry.filePath);
                  const statusKey =
                    `admin.backup.logStatus.${entry.status}` as ResourceKey;
                  const kindKey =
                    `admin.backup.kind.${entry.kind}` as ResourceKey;

                  return (
                    <li key={entry.id} className="py-3.5 space-y-2">
                      <div className="flex items-center justify-between gap-2 text-xs">
                        <span className="font-semibold text-[var(--color-text)] tabular-nums-strict">
                          {formatJalaliDateTimePersian(entry.startedAt)}
                        </span>
                        <span className="font-medium text-[var(--color-primary)]">
                          {t(statusKey)} · {t(kindKey)}
                        </span>
                      </div>
                      <p
                        dir="ltr"
                        className="font-mono text-xs text-[var(--color-muted)] break-all"
                      >
                        {fileName}
                      </p>
                      <div className="flex items-center justify-between gap-2 text-xs text-[var(--color-muted)]">
                        <span className="tabular-nums-strict">
                          {formatByteSizePersian(entry.sizeBytes)}
                        </span>
                        <span>
                          {entry.status === 'Succeeded'
                            ? entry.isRetained
                              ? t('admin.backup.retention.retained')
                              : t('admin.backup.retention.pruned')
                            : '—'}
                        </span>
                      </div>
                      {entry.status === 'Succeeded' && entry.isRetained && (
                        <div className="flex flex-wrap gap-2 pt-1">
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => void handleDownloadArchive(entry.id)}
                            startIcon={<Download className="w-3.5 h-3.5" />}
                          >
                            {t('admin.backup.actions.download')}
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={testingLogId === entry.id}
                            onClick={() => void handleTestRestoreFromLog(entry.id)}
                            startIcon={<FlaskConical className="w-3.5 h-3.5" />}
                          >
                            {testingLogId === entry.id
                              ? t('admin.backup.actions.testingRestore')
                              : t('admin.backup.actions.testRestore')}
                          </Button>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </section>

        {/* Restore Upload & Step-by-Step Guide */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
          {/* Card 1: Restore From .bak File */}
          <section className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-card)] shadow-[var(--shadow-card)] p-5 space-y-4">
            <div className="space-y-1 pb-3 border-b border-[var(--color-border)]">
              <h2 className="text-base sm:text-lg font-semibold text-[var(--color-text)] flex items-center gap-2">
                <Upload
                  className="w-5 h-5 text-[var(--color-primary)] shrink-0"
                  aria-hidden="true"
                />
                <span>{t('admin.backup.restore.title')}</span>
              </h2>
              <p className="text-xs sm:text-sm text-[var(--color-muted)] leading-relaxed">
                {t('admin.backup.restore.subtitle')}
              </p>
            </div>

            <div className="space-y-3">
              <label className="block text-xs font-medium text-[var(--color-text)]">
                {t('admin.backup.restore.fileInputLabel')}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".bak,.json,application/json"
                  onChange={(e) => void handleSelectRestoreFile(e)}
                  className="mt-2 block w-full text-xs text-[var(--color-muted)] file:ml-3 file:py-2 file:px-3 file:rounded-[var(--radius-control)] file:border file:border-[var(--color-border)] file:bg-[var(--color-surface-alt)] file:text-[var(--color-text)] file:font-medium hover:file:bg-[var(--color-border)] cursor-pointer"
                />
              </label>

              {uploadedFileName && (
                <div className="flex items-center justify-between gap-2 text-xs text-[var(--color-muted)]">
                  <span className="truncate">
                    {t('admin.backup.restore.selectedFileName', {
                      name: uploadedFileName,
                    })}
                  </span>
                  <button
                    type="button"
                    onClick={handleClearUploadedFile}
                    className="text-[var(--color-primary)] font-medium hover:underline shrink-0"
                  >
                    {t('admin.backup.restore.clearFileButton')}
                  </button>
                </div>
              )}

              {uploadError && (
                <Alert
                  variant="error"
                  message={uploadError}
                  onDismiss={() => setUploadError(null)}
                />
              )}

              {parsedSnapshot && (
                <div className="rounded-[var(--radius-control)] border border-[var(--color-border)] bg-[var(--color-surface-alt)] p-4 space-y-2.5 text-xs sm:text-sm">
                  <div className="flex items-center gap-2 text-[var(--color-success-text)] font-semibold">
                    <ShieldCheck className="w-4 h-4 shrink-0" aria-hidden="true" />
                    <span>{t('admin.backup.restore.checksumValidBadge')}</span>
                  </div>
                  <p className="text-[var(--color-text)] tabular-nums-strict">
                    {t('admin.backup.restore.previewCreatedAt', {
                      date: formatJalaliDateTimePersian(parsedSnapshot.createdAt),
                    })}
                  </p>
                  <p className="text-[var(--color-muted)] tabular-nums-strict">
                    {t('admin.backup.restore.previewDbVersion', {
                      version: toPersianDigits(parsedSnapshot.databaseVersion),
                    })}
                  </p>
                  <p className="text-[var(--color-text)] tabular-nums-strict">
                    {t('admin.backup.restore.previewSummary', {
                      tables: toPersianDigits(parsedSnapshot.counts.tablesCount),
                      records: toPersianDigits(parsedSnapshot.counts.totalRecords),
                      files: toPersianDigits(parsedSnapshot.counts.storedFilesCount),
                    })}
                  </p>
                  <p className="text-xs text-[var(--color-muted)] tabular-nums-strict">
                    {t('admin.backup.restore.previewEntities', {
                      contents: toPersianDigits(previewContentsCount),
                      users: toPersianDigits(previewUsersCount),
                      topics: toPersianDigits(previewTopicsCount),
                    })}
                  </p>

                  <div className="pt-2 flex flex-col gap-2">
                    <Button
                      variant="secondary"
                      onClick={() => void handleTestUploadedSandbox()}
                      disabled={isTestingUploadedSandbox || isRestoringPrimary}
                      startIcon={<FlaskConical className="w-4 h-4" />}
                    >
                      {isTestingUploadedSandbox
                        ? t('admin.backup.restore.sandboxRunning')
                        : t('admin.backup.restore.sandboxButton')}
                    </Button>

                    <Button
                      variant="danger"
                      onClick={openConfirmPrimaryModal}
                      disabled={isTestingUploadedSandbox || isRestoringPrimary}
                      startIcon={<AlertTriangle className="w-4 h-4" />}
                    >
                      {t('admin.backup.restore.primaryButton')}
                    </Button>
                  </div>
                </div>
              )}

              {sandboxReport && (
                <div className="rounded-[var(--radius-control)] border border-[var(--color-success-text)]/30 bg-[var(--color-success-bg)] p-3.5 text-xs text-[var(--color-success-text)] space-y-1 tabular-nums-strict">
                  <p className="font-semibold">
                    {t('admin.backup.feedback.sandboxSuccess', {
                      dbName: sandboxReport.targetDatabaseName,
                      tables: toPersianDigits(sandboxReport.restoredTablesCount),
                      records: toPersianDigits(sandboxReport.restoredRecordsCount),
                      files: toPersianDigits(sandboxReport.restoredFilesCount),
                      contents: toPersianDigits(sandboxReport.verifiedContentsCount),
                      users: toPersianDigits(sandboxReport.verifiedUsersCount),
                      topics: toPersianDigits(sandboxReport.verifiedTopicsCount),
                    })}
                  </p>
                </div>
              )}
            </div>
          </section>

          {/* Card 2: Step-by-Step Restore Guide */}
          <section className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-card)] shadow-[var(--shadow-card)] p-5 space-y-4">
            <div className="space-y-1 pb-3 border-b border-[var(--color-border)]">
              <h2 className="text-base sm:text-lg font-semibold text-[var(--color-text)] flex items-center gap-2">
                <BookOpen
                  className="w-5 h-5 text-[var(--color-primary)] shrink-0"
                  aria-hidden="true"
                />
                <span>{t('admin.backup.guide.title')}</span>
              </h2>
              <p className="text-xs sm:text-sm text-[var(--color-muted)] leading-relaxed">
                {t('admin.backup.guide.subtitle')}
              </p>
            </div>

            <ol className="space-y-3 text-xs sm:text-sm">
              <li className="space-y-1">
                <h3 className="font-semibold text-[var(--color-text)]">
                  {t('admin.backup.guide.step1Title')}
                </h3>
                <p className="text-[var(--color-muted)] leading-relaxed">
                  {t('admin.backup.guide.step1Desc')}
                </p>
              </li>
              <li className="space-y-1">
                <h3 className="font-semibold text-[var(--color-text)]">
                  {t('admin.backup.guide.step2Title')}
                </h3>
                <p className="text-[var(--color-muted)] leading-relaxed">
                  {t('admin.backup.guide.step2Desc')}
                </p>
              </li>
              <li className="space-y-1">
                <h3 className="font-semibold text-[var(--color-text)]">
                  {t('admin.backup.guide.step3Title')}
                </h3>
                <p className="text-[var(--color-muted)] leading-relaxed">
                  {t('admin.backup.guide.step3Desc')}
                </p>
              </li>
              <li className="space-y-1">
                <h3 className="font-semibold text-[var(--color-text)]">
                  {t('admin.backup.guide.step4Title')}
                </h3>
                <p className="text-[var(--color-muted)] leading-relaxed">
                  {t('admin.backup.guide.step4Desc')}
                </p>
              </li>
            </ol>

            <div className="rounded-[var(--radius-control)] border border-[var(--color-border)] bg-[var(--color-surface-alt)] p-3.5 space-y-1 text-xs">
              <p className="font-semibold text-[var(--color-text)]">
                {t('admin.backup.guide.futureNoteTitle')}
              </p>
              <p className="text-[var(--color-muted)] leading-relaxed">
                {t('admin.backup.guide.futureNoteDesc')}
              </p>
            </div>
          </section>
        </div>
      </div>

      {/* Two-Step Primary Database Restore Confirmation Modal */}
      <Modal
        open={confirmModalOpen}
        onClose={() => {
          if (!isRestoringPrimary) {
            setConfirmModalOpen(false);
          }
        }}
        closeOnBackdrop={!isRestoringPrimary}
        title={t('admin.backup.confirmModal.title')}
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => setConfirmModalOpen(false)}
              disabled={isRestoringPrimary}
            >
              {t('admin.backup.confirmModal.cancelButton')}
            </Button>
            <Button
              variant="danger"
              disabled={!confirmCheckbox || isRestoringPrimary}
              onClick={() => void handleConfirmPrimaryRestore()}
            >
              {isRestoringPrimary
                ? t('admin.backup.confirmModal.confirmRunning')
                : t('admin.backup.confirmModal.confirmButton')}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="flex items-start gap-2.5 p-3 rounded-[var(--radius-control)] bg-[var(--color-error-bg)] text-[var(--color-error-text)] text-xs sm:text-sm leading-relaxed">
            <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" aria-hidden="true" />
            <p>
              {t('admin.backup.confirmModal.warningBody', {
                date: parsedSnapshot
                  ? formatJalaliDateTimePersian(parsedSnapshot.createdAt)
                  : '—',
              })}
            </p>
          </div>

          <label className="flex items-start gap-2.5 text-xs sm:text-sm text-[var(--color-text)] cursor-pointer select-none">
            <input
              type="checkbox"
              checked={confirmCheckbox}
              onChange={(e) => setConfirmCheckbox(e.target.checked)}
              className="mt-1 h-4 w-4 rounded border-[var(--color-border)] accent-[var(--color-primary)] shrink-0"
            />
            <span>{t('admin.backup.confirmModal.checkboxLabel')}</span>
          </label>
        </div>
      </Modal>
    </AdminLayout>
  );
}
