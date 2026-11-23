import {
  CheckCircle2,
  Database,
  Download,
  ExternalLink,
  FileText,
  Layers,
  LogIn,
  Play,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Trash2,
  UserPlus,
  Users,
  XCircle,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import type { HealthStatus } from '../../core/domain/HealthStatus';
import type { LogEntry, LogLevel } from '../../core/domain/LogEntry';
import type { TestSuiteResult } from '../../core/domain/TestResult';
import { envConfig } from '../../infrastructure/config/envConfig';
import { seedDevAllFormatsSamplesAsync } from '../../infrastructure/data/devStage13Samples';
import type { SeedSummary } from '../../infrastructure/data/seed';
import { stage1Tests } from '../../tests/stage1.tests';
import { stage2Tests } from '../../tests/stage2.tests';
import { stage3Tests } from '../../tests/stage3.tests';
import { stage4Tests } from '../../tests/stage4.tests';
import { stage5Tests } from '../../tests/stage5.tests';
import { stage6Tests } from '../../tests/stage6.tests';
import { stage7Tests } from '../../tests/stage7.tests';
import { stage8Tests } from '../../tests/stage8.tests';
import { stage9Tests } from '../../tests/stage9.tests';
import { stage10Tests } from '../../tests/stage10.tests';
import { stage11Tests } from '../../tests/stage11.tests';
import { stage12Tests } from '../../tests/stage12.tests';
import { stage13Tests } from '../../tests/stage13.tests';
import { stage14Tests } from '../../tests/stage14.tests';
import { runUnitTests } from '../../tests/testRunner';
import { useAuth } from '../auth/AuthContext';
import { useAge } from '../context/AgeContext';
import { Alert, Button } from '../components/ui';
import { MainLayout } from '../layouts/MainLayout';
import { toPersianDigits } from '../resources/formatters';
import type { ResourceKey } from '../resources/fa';
import { t } from '../resources/i18n';
import { navigateToHash } from '../router/HashRouter';
import { appContainer } from '../services/appContainer';

interface HealthPageProps {
  currentRoute: string;
}

const ALL_UNIT_TESTS = [
  ...stage1Tests,
  ...stage2Tests,
  ...stage3Tests,
  ...stage4Tests,
  ...stage5Tests,
  ...stage6Tests,
  ...stage7Tests,
  ...stage8Tests,
  ...stage9Tests,
  ...stage10Tests,
  ...stage11Tests,
  ...stage12Tests,
  ...stage13Tests,
  ...stage14Tests,
];

const ARCHITECTURE_LAYERS: ReadonlyArray<{
  id: string;
  titleKey: ResourceKey;
  descKey: ResourceKey;
  folder: string;
}> = [
  {
    id: 'core',
    titleKey: 'health.card.architecture.core.title',
    descKey: 'health.card.architecture.core.desc',
    folder: 'src/core/',
  },
  {
    id: 'infrastructure',
    titleKey: 'health.card.architecture.infrastructure.title',
    descKey: 'health.card.architecture.infrastructure.desc',
    folder: 'src/infrastructure/',
  },
  {
    id: 'web',
    titleKey: 'health.card.architecture.web.title',
    descKey: 'health.card.architecture.web.desc',
    folder: 'src/web/',
  },
  {
    id: 'tests',
    titleKey: 'health.card.architecture.tests.title',
    descKey: 'health.card.architecture.tests.desc',
    folder: 'src/tests/',
  },
];

function getLogLevelTextClass(level: LogLevel): string {
  switch (level) {
    case 'ERROR':
      return 'text-[var(--color-error-text)]';
    case 'WARN':
      return 'text-[var(--color-warning-text)]';
    case 'DEBUG':
      return 'text-[var(--color-muted)]';
    case 'INFO':
    default:
      return 'text-[var(--color-info-text)]';
  }
}

function getLogLevelKey(level: LogLevel): ResourceKey {
  switch (level) {
    case 'DEBUG':
      return 'health.card.logs.level.DEBUG';
    case 'WARN':
      return 'health.card.logs.level.WARN';
    case 'ERROR':
      return 'health.card.logs.level.ERROR';
    case 'INFO':
    default:
      return 'health.card.logs.level.INFO';
  }
}

function extractSafeHashActionUrl(entry: LogEntry): string | null {
  const detailUrl = entry.details?.actionUrl;
  if (typeof detailUrl === 'string' && detailUrl.startsWith('#/')) {
    return detailUrl;
  }
  const match = entry.message.match(/(#\/[^\s|]+)/);
  if (match && match[1].startsWith('#/')) {
    return match[1];
  }
  return null;
}

export function HealthPage({ currentRoute }: HealthPageProps) {
  const { currentUser, siteTitle, hasSuperAdmin, hasStaffUser, refreshAuthState } = useAuth();
  const { clearVisitorAgeCookie } = useAge();
  const [healthStatus, setHealthStatus] = useState<HealthStatus | null>(null);
  const [isCheckingHealth, setIsCheckingHealth] = useState<boolean>(true);
  const [testSuite, setTestSuite] = useState<TestSuiteResult | null>(null);
  const [isRunningTests, setIsRunningTests] = useState<boolean>(false);
  const [logs, setLogs] = useState<LogEntry[]>(() => appContainer.logger.getLogs());
  const [seedSummary, setSeedSummary] = useState<SeedSummary | null>(null);
  const [usersCount, setUsersCount] = useState<number | null>(null);
  const [isReseeding, setIsReseeding] = useState<boolean>(false);
  const [isResettingDb, setIsResettingDb] = useState<boolean>(false);
  const [isCreatingDevStaff, setIsCreatingDevStaff] = useState<boolean>(false);
  const [isSeedingSamples, setIsSeedingSamples] = useState<boolean>(false);
  const [seedFeedback, setSeedFeedback] = useState<string | null>(null);
  const [devStaffFeedback, setDevStaffFeedback] = useState<string | null>(null);

  const refreshLogs = useCallback(() => {
    setLogs(appContainer.logger.getLogs());
  }, []);

  const refreshSeedSummary = useCallback(async () => {
    await appContainer.ensureInitializedAtStartup();
    const [summary, totalUsers] = await Promise.all([
      appContainer.databaseSeeder.getSummary(),
      appContainer.authRepository.countUsers(),
    ]);
    setSeedSummary(summary);
    setUsersCount(totalUsers);
    await refreshAuthState();
  }, [refreshAuthState]);

  const performHealthCheck = useCallback(
    async (shouldLogOutcome: boolean) => {
      setIsCheckingHealth(true);
      try {
        const result = await appContainer.healthCheckService.checkHealth(
          shouldLogOutcome ? t('logs.healthCheckSuccess') : undefined,
          shouldLogOutcome ? t('logs.healthCheckFailed') : undefined,
        );
        setHealthStatus(result);
      } finally {
        setIsCheckingHealth(false);
        refreshLogs();
      }
    },
    [refreshLogs],
  );

  useEffect(() => {
    refreshLogs();
    void performHealthCheck(false).then(() => refreshSeedSummary());
  }, [performHealthCheck, refreshLogs, refreshSeedSummary]);

  const handleManualRecheck = () => {
    void performHealthCheck(true).then(() => refreshSeedSummary());
  };

  const handleRunTests = async () => {
    setIsRunningTests(true);
    try {
      const suiteResult = await runUnitTests(ALL_UNIT_TESTS, appContainer.clock);
      setTestSuite(suiteResult);
      appContainer.logger.info(t('logs.testsCompleted'), {
        total: suiteResult.total,
        passed: suiteResult.passed,
        failed: suiteResult.failed,
        durationMs: suiteResult.durationMs,
      });
    } finally {
      setIsRunningTests(false);
      refreshLogs();
    }
  };

  const handleReseed = async () => {
    setIsReseeding(true);
    try {
      const result = await appContainer.databaseSeeder.seed(t('logs.seedManualExecuted'));
      setSeedSummary(result.summary);
      setSeedFeedback(
        t('health.card.seed.actionFeedback', {
          inserted: toPersianDigits(result.insertedCount),
        }),
      );
    } finally {
      setIsReseeding(false);
      refreshLogs();
    }
  };

  const handleResetDatabase = async () => {
    setIsResettingDb(true);
    try {
      await appContainer.authService.logout();
      await appContainer.dataStore.resetDatabase();
      const result = await appContainer.databaseSeeder.seed(t('logs.databaseResetExecuted'));
      await appContainer.initialSuperAdminService.bootstrapFromEnvIfConfigured(
        envConfig.initialSuperAdminEmail,
        envConfig.initialSuperAdminTempPassword,
        t('setup.defaultSuperAdminDisplayName'),
      );
      const totalUsers = await appContainer.authRepository.countUsers();
      setSeedSummary(result.summary);
      setUsersCount(totalUsers);
      setSeedFeedback(
        t('health.card.seed.resetFeedback', {
          inserted: toPersianDigits(result.insertedCount),
        }),
      );
      await refreshAuthState();
      await performHealthCheck(false);
    } finally {
      setIsResettingDb(false);
      refreshLogs();
    }
  };

  const handleClearAgeCookie = () => {
    clearVisitorAgeCookie();
    setSeedFeedback(t('health.card.seed.clearAgeCookieDone'));
  };

  const handleSeedDevSamples = async () => {
    if (!envConfig.isDevelopment) {
      return;
    }
    setIsSeedingSamples(true);
    try {
      const result = await seedDevAllFormatsSamplesAsync({
        authRepository: appContainer.authRepository,
        contentRepository: appContainer.contentRepository,
        taxonomyRepository: appContainer.taxonomyRepository,
        fileStorage: appContainer.fileStorage,
        searchNormalizer: appContainer.searchNormalizer,
        clock: appContainer.clock,
      });
      await refreshSeedSummary();
      setSeedFeedback(
        result.insertedCount > 0
          ? t('health.card.seed.devSamplesSuccess', {
              count: toPersianDigits(result.insertedCount),
            })
          : t('health.card.seed.devSamplesAlreadySeeded'),
      );
    } finally {
      setIsSeedingSamples(false);
      refreshLogs();
    }
  };

  const handleDownloadLogs = () => {
    const content = appContainer.logger.formatLogsForExport();
    if (!content) {
      return;
    }

    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = t('logs.exportFileName');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleClearLogs = () => {
    appContainer.logger.clearLogs();
    refreshLogs();
  };

  const handleCreateDevStaff = async () => {
    setIsCreatingDevStaff(true);
    try {
      const res = await appContainer.initialSuperAdminService.createDevStaffForTesting(
        envConfig.isDevelopment,
        t('health.card.auth.devStaffDisplayName'),
        t('health.card.auth.devStaffLogMessage'),
      );
      if (res.ok && res.user?.email) {
        setDevStaffFeedback(
          t('health.card.auth.devStaffCreated', { email: res.user.email }),
        );
        const totalUsers = await appContainer.authRepository.countUsers();
        setUsersCount(totalUsers);
        await refreshAuthState();
      }
    } finally {
      setIsCreatingDevStaff(false);
      refreshLogs();
    }
  };

  const environmentText = envConfig.isProduction
    ? t('health.card.architecture.envProduction')
    : t('health.card.architecture.envDevelopment');

  const isAppHealthy = healthStatus ? healthStatus.appHealthy : true;
  const isDbConnected = healthStatus?.database.state === 'connected';

  return (
    <MainLayout currentRoute={currentRoute}>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
        {/* Page Heading */}
        <section className="mb-6 sm:mb-8 pb-6 border-b border-[var(--color-border)] flex flex-wrap items-end justify-between gap-4">
          <div className="space-y-2 max-w-3xl">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[var(--color-muted)] tabular-nums-strict">
              <span>{t('app.subtitle')}</span>
              <span aria-hidden="true">·</span>
              <span>
                {t('app.stageLabel', {
                  stage: toPersianDigits(envConfig.stageNumber),
                  total: toPersianDigits(envConfig.totalStages),
                })}
              </span>
              <span aria-hidden="true">·</span>
              <span>{t('app.stageName')}</span>
            </div>

            <h1 className="text-2xl sm:text-3xl font-bold text-[var(--color-text)] tracking-tight text-balance">
              {t('health.pageTitle')}
            </h1>

            <p className="text-sm sm:text-base text-[var(--color-muted)] leading-relaxed">
              {t('health.pageDescription')}
            </p>

            <div className="pt-1 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-[var(--color-muted)]">
              <span className="inline-flex items-center gap-1.5">
                <span>{t('health.metaRouteLabel')}:</span>
                <span dir="ltr" className="font-mono text-[var(--color-text)]">
                  {currentRoute}
                </span>
              </span>
              <span aria-hidden="true">·</span>
              <span className="inline-flex items-center gap-1.5">
                <span>{t('health.metaDatabaseLabel')}:</span>
                <span dir="ltr" className="font-mono text-[var(--color-text)] tabular-nums-strict">
                  {envConfig.databaseName} v{envConfig.databaseVersion}
                </span>
              </span>
              <span aria-hidden="true">·</span>
              <span className="inline-flex items-center gap-1.5">
                <span>{t('health.metaEnvironmentLabel')}:</span>
                <span className="text-[var(--color-text)] font-medium">{environmentText}</span>
              </span>
            </div>
          </div>

          <Button
            variant="primary"
            onClick={handleManualRecheck}
            disabled={isCheckingHealth}
            startIcon={
              <RefreshCw
                className={`w-4 h-4 ${isCheckingHealth ? 'animate-spin' : ''}`}
              />
            }
          >
            {isCheckingHealth ? t('nav.recheckingAction') : t('nav.recheckAction')}
          </Button>
        </section>

        {/* 4-Card Responsive Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-stretch">
          {/* Card 1: System Status */}
          <section className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-card)] shadow-[var(--shadow-card)] p-5 sm:p-6 flex flex-col justify-between">
            <div>
              <div className="flex items-start justify-between gap-3 pb-4 border-b border-[var(--color-border)]">
                <div className="min-w-0">
                  <h2 className="text-base sm:text-lg font-semibold text-[var(--color-text)] flex items-center gap-2">
                    <ShieldCheck className="w-5 h-5 text-[var(--color-primary)] shrink-0" aria-hidden="true" />
                    <span>{t('health.card.system.title')}</span>
                  </h2>
                  <p className="mt-1 text-xs sm:text-sm text-[var(--color-muted)]">
                    {t('health.card.system.subtitle')}
                  </p>
                </div>
              </div>

              {/* Primary Health Indicators */}
              <div className="py-4 space-y-3 border-b border-[var(--color-border)]">
                <div className="flex items-center justify-between gap-3 py-1">
                  <div className="flex items-center gap-2.5 min-w-0">
                    {isAppHealthy ? (
                      <CheckCircle2 className="w-5 h-5 text-[var(--color-success-text)] shrink-0" aria-hidden="true" />
                    ) : (
                      <XCircle className="w-5 h-5 text-[var(--color-error-text)] shrink-0" aria-hidden="true" />
                    )}
                    <span
                      className={`text-sm sm:text-base font-semibold ${
                        isAppHealthy ? 'text-[var(--color-success-text)]' : 'text-[var(--color-error-text)]'
                      }`}
                    >
                      {isAppHealthy
                        ? t('health.card.system.appHealthy')
                        : t('health.card.system.appUnhealthy')}
                    </span>
                  </div>
                </div>

                <div className="flex items-center justify-between gap-3 py-1">
                  <div className="flex items-center gap-2.5 min-w-0">
                    {isCheckingHealth && !healthStatus ? (
                      <RefreshCw
                        className="w-5 h-5 text-[var(--color-muted)] animate-spin shrink-0"
                        aria-hidden="true"
                      />
                    ) : isDbConnected ? (
                      <Database className="w-5 h-5 text-[var(--color-success-text)] shrink-0" aria-hidden="true" />
                    ) : (
                      <XCircle className="w-5 h-5 text-[var(--color-error-text)] shrink-0" aria-hidden="true" />
                    )}
                    <span
                      className={`text-sm sm:text-base font-semibold ${
                        isCheckingHealth && !healthStatus
                          ? 'text-[var(--color-muted)]'
                          : isDbConnected
                            ? 'text-[var(--color-success-text)]'
                            : 'text-[var(--color-error-text)]'
                      }`}
                    >
                      {isCheckingHealth && !healthStatus
                        ? t('health.card.system.dbChecking')
                        : isDbConnected
                          ? t('health.card.system.dbConnected')
                          : t('health.card.system.dbDisconnected')}
                    </span>
                  </div>
                </div>

                {healthStatus?.database.errorMessage && (
                  <p className="text-xs text-[var(--color-error-text)] bg-[var(--color-error-bg)] rounded-[var(--radius-control)] px-3 py-2 break-words">
                    {t('health.card.system.errorPrefix')}: {healthStatus.database.errorMessage}
                  </p>
                )}
              </div>

              {/* Technical Key-Value Breakdown */}
              <dl className="divide-y divide-[var(--color-border)] text-xs sm:text-sm">
                <div className="py-2.5 flex items-center justify-between gap-3">
                  <dt className="text-[var(--color-muted)]">{t('health.card.system.dbNameLabel')}</dt>
                  <dd dir="ltr" className="font-mono text-[var(--color-text)] truncate">
                    {healthStatus?.database.databaseName ?? envConfig.databaseName}
                  </dd>
                </div>
                <div className="py-2.5 flex items-center justify-between gap-3">
                  <dt className="text-[var(--color-muted)]">{t('health.card.system.dbVersionLabel')}</dt>
                  <dd dir="ltr" className="font-mono text-[var(--color-text)] tabular-nums-strict">
                    v{healthStatus?.database.databaseVersion ?? envConfig.databaseVersion}
                  </dd>
                </div>
                <div className="py-2.5 flex items-center justify-between gap-3">
                  <dt className="text-[var(--color-muted)]">{t('health.card.system.metaStoreLabel')}</dt>
                  <dd dir="ltr" className="font-mono text-[var(--color-text)]">
                    {healthStatus?.database.metaStoreName ?? envConfig.metaStoreName}
                  </dd>
                </div>
                <div className="py-2.5 flex items-center justify-between gap-3">
                  <dt className="text-[var(--color-muted)]">{t('health.card.system.readWriteLabel')}</dt>
                  <dd
                    className={`font-medium ${
                      healthStatus?.database.readWriteVerified
                        ? 'text-[var(--color-success-text)]'
                        : 'text-[var(--color-muted)]'
                    }`}
                  >
                    {healthStatus
                      ? healthStatus.database.readWriteVerified
                        ? t('health.card.system.readWriteVerified')
                        : t('health.card.system.readWriteFailed')
                      : '—'}
                  </dd>
                </div>
                <div className="py-2.5 flex items-center justify-between gap-3">
                  <dt className="text-[var(--color-muted)]">{t('health.card.system.latencyLabel')}</dt>
                  <dd className="text-[var(--color-text)] tabular-nums-strict">
                    {healthStatus
                      ? t('health.card.system.latencyUnit', {
                          ms: toPersianDigits(healthStatus.database.latencyMs),
                        })
                      : '—'}
                  </dd>
                </div>
                <div className="py-2.5 flex items-center justify-between gap-3">
                  <dt className="text-[var(--color-muted)]">{t('health.card.system.lastCheckedJalaliLabel')}</dt>
                  <dd dir="ltr" className="font-mono text-xs text-[var(--color-text)] tabular-nums-strict">
                    {healthStatus?.checkedAtJalali ?? '—'}
                  </dd>
                </div>
                <div className="py-2.5 flex items-center justify-between gap-3">
                  <dt className="text-[var(--color-muted)]">{t('health.card.system.lastCheckedUtcLabel')}</dt>
                  <dd dir="ltr" className="font-mono text-xs text-[var(--color-muted)] tabular-nums-strict truncate">
                    {healthStatus?.checkedAtUtc ?? '—'}
                  </dd>
                </div>
              </dl>
            </div>

            <div className="pt-4 mt-4 border-t border-[var(--color-border)] flex items-center justify-end">
              <Button
                variant="secondary"
                onClick={handleManualRecheck}
                disabled={isCheckingHealth}
                startIcon={
                  <RefreshCw
                    className={`w-4 h-4 ${isCheckingHealth ? 'animate-spin' : ''}`}
                  />
                }
              >
                {isCheckingHealth ? t('nav.recheckingAction') : t('nav.recheckAction')}
              </Button>
            </div>
          </section>

          {/* Card 2: 4-Layer Architecture */}
          <section className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-card)] shadow-[var(--shadow-card)] p-5 sm:p-6 flex flex-col justify-between">
            <div>
              <div className="pb-4 border-b border-[var(--color-border)]">
                <h2 className="text-base sm:text-lg font-semibold text-[var(--color-text)] flex items-center gap-2">
                  <Layers className="w-5 h-5 text-[var(--color-primary)] shrink-0" aria-hidden="true" />
                  <span>{t('health.card.architecture.title')}</span>
                </h2>
                <p className="mt-1 text-xs sm:text-sm text-[var(--color-muted)]">
                  {t('health.card.architecture.subtitle')}
                </p>
              </div>

              <ul className="divide-y divide-[var(--color-border)] mt-1">
                {ARCHITECTURE_LAYERS.map((layer) => (
                  <li key={layer.id} className="py-3.5 flex items-start justify-between gap-3">
                    <div className="flex items-start gap-2.5 min-w-0">
                      <CheckCircle2
                        className="w-4 h-4 text-[var(--color-success-text)] mt-0.5 shrink-0"
                        aria-hidden="true"
                      />
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                          <span dir="ltr" className="text-sm font-semibold text-[var(--color-text)]">
                            {t(layer.titleKey)}
                          </span>
                          <span aria-hidden="true" className="text-[var(--color-muted)] text-xs">
                            ·
                          </span>
                          <span dir="ltr" className="font-mono text-xs text-[var(--color-muted)]">
                            {layer.folder}
                          </span>
                        </div>
                        <p className="mt-1 text-xs text-[var(--color-muted)] leading-relaxed">
                          {t(layer.descKey)}
                        </p>
                      </div>
                    </div>
                    <span className="text-xs font-medium text-[var(--color-success-text)] whitespace-nowrap shrink-0">
                      {t('health.card.architecture.layerReady')}
                    </span>
                  </li>
                ))}
              </ul>
            </div>

            {/* Runtime Environment Summary */}
            <dl className="mt-4 pt-4 border-t border-[var(--color-border)] space-y-2 text-xs sm:text-sm">
              <div className="flex items-center justify-between gap-3">
                <dt className="text-[var(--color-muted)]">{t('health.card.architecture.envLabel')}</dt>
                <dd className="font-medium text-[var(--color-text)] text-left">{environmentText}</dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-[var(--color-muted)]">{t('health.card.architecture.routingLabel')}</dt>
                <dd dir="ltr" className="font-mono text-xs text-[var(--color-text)] truncate">
                  {t('health.card.architecture.routingValue')}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-[var(--color-muted)]">{t('health.card.architecture.i18nLabel')}</dt>
                <dd className="text-xs text-[var(--color-text)] text-left">
                  {t('health.card.architecture.i18nValue')}
                </dd>
              </div>
            </dl>
          </section>

          {/* Card 3: Unit Tests (Stage 1 + Stage 2) */}
          <section className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-card)] shadow-[var(--shadow-card)] p-5 sm:p-6 flex flex-col justify-between">
            <div>
              <div className="flex flex-wrap items-start justify-between gap-3 pb-4 border-b border-[var(--color-border)]">
                <div className="min-w-0">
                  <h2 className="text-base sm:text-lg font-semibold text-[var(--color-text)] flex items-center gap-2">
                    <Play className="w-5 h-5 text-[var(--color-primary)] shrink-0" aria-hidden="true" />
                    <span>{t('health.card.tests.title')}</span>
                  </h2>
                  <p className="mt-1 text-xs sm:text-sm text-[var(--color-muted)]">
                    {t('health.card.tests.subtitle')}
                  </p>
                </div>

                <Button
                  variant="primary"
                  onClick={handleRunTests}
                  disabled={isRunningTests}
                  startIcon={<Play className="w-4 h-4" />}
                >
                  {isRunningTests
                    ? t('health.card.tests.runningButton')
                    : t('health.card.tests.runButton')}
                </Button>
              </div>

              {/* Test Suite Summary Line */}
              <div className="py-3 border-b border-[var(--color-border)] text-xs text-[var(--color-muted)] tabular-nums-strict">
                {testSuite ? (
                  <span
                    className={
                      testSuite.failed === 0
                        ? 'font-semibold text-[var(--color-success-text)]'
                        : 'font-semibold text-[var(--color-error-text)]'
                    }
                  >
                    {t('health.card.tests.summary', {
                      passed: toPersianDigits(testSuite.passed),
                      total: toPersianDigits(testSuite.total),
                      ms: toPersianDigits(testSuite.durationMs),
                    })}
                  </span>
                ) : (
                  <span>{t('health.card.tests.idleHint')}</span>
                )}
              </div>

              {/* Test Cases List */}
              <ul className="divide-y divide-[var(--color-border)] max-h-[420px] overflow-y-auto pl-1">
                {ALL_UNIT_TESTS.map((testCase) => {
                  const outcome = testSuite?.results.find((item) => item.id === testCase.id);
                  const isPassed = outcome?.status === 'passed';
                  const isFailed = outcome?.status === 'failed';

                  return (
                    <li key={testCase.id} className="py-3.5 space-y-1.5">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-start gap-2.5 min-w-0">
                          {isPassed ? (
                            <CheckCircle2
                              className="w-4 h-4 text-[var(--color-success-text)] mt-0.5 shrink-0"
                              aria-hidden="true"
                            />
                          ) : isFailed ? (
                            <XCircle
                              className="w-4 h-4 text-[var(--color-error-text)] mt-0.5 shrink-0"
                              aria-hidden="true"
                            />
                          ) : (
                            <span
                              aria-hidden="true"
                              className="w-4 h-4 mt-0.5 shrink-0 inline-flex items-center justify-center text-[var(--color-muted)] text-xs font-mono"
                            >
                              —
                            </span>
                          )}
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-[var(--color-text)]">
                              {t(testCase.nameKey as ResourceKey)}
                            </p>
                            <p className="mt-0.5 text-xs text-[var(--color-muted)] leading-relaxed">
                              {t(testCase.descriptionKey as ResourceKey)}
                            </p>
                          </div>
                        </div>

                        <div className="flex flex-col items-end shrink-0 text-xs tabular-nums-strict">
                          <span
                            className={`font-medium whitespace-nowrap ${
                              isPassed
                                ? 'text-[var(--color-success-text)]'
                                : isFailed
                                  ? 'text-[var(--color-error-text)]'
                                  : 'text-[var(--color-muted)]'
                            }`}
                          >
                            {isPassed
                              ? t('health.card.tests.statusPassed')
                              : isFailed
                                ? t('health.card.tests.statusFailed')
                                : t('health.card.tests.statusPending')}
                          </span>
                          {outcome && (
                            <span className="text-[var(--color-muted)] mt-0.5">
                              {t('health.card.system.latencyUnit', {
                                ms: toPersianDigits(outcome.durationMs),
                              })}
                            </span>
                          )}
                        </div>
                      </div>

                      {outcome?.errorMessage && (
                        <p
                          dir="ltr"
                          className="text-xs font-mono text-[var(--color-error-text)] bg-[var(--color-error-bg)] rounded-[var(--radius-control)] px-3 py-2 break-all"
                        >
                          {outcome.errorMessage}
                        </p>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          </section>

          {/* Card 4: Logs */}
          <section className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-card)] shadow-[var(--shadow-card)] p-5 sm:p-6 flex flex-col justify-between">
            <div className="flex flex-col h-full">
              <div className="flex flex-wrap items-start justify-between gap-3 pb-4 border-b border-[var(--color-border)]">
                <div className="min-w-0">
                  <h2 className="text-base sm:text-lg font-semibold text-[var(--color-text)] flex items-center gap-2">
                    <FileText className="w-5 h-5 text-[var(--color-primary)] shrink-0" aria-hidden="true" />
                    <span>{t('health.card.logs.title')}</span>
                  </h2>
                  <p className="mt-1 text-xs sm:text-sm text-[var(--color-muted)]">
                    {t('health.card.logs.subtitle')}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={handleDownloadLogs}
                    disabled={logs.length === 0}
                    startIcon={<Download className="w-4 h-4" />}
                  >
                    {t('health.card.logs.downloadButton')}
                  </Button>

                  <Button
                    variant="danger"
                    size="sm"
                    onClick={handleClearLogs}
                    disabled={logs.length === 0}
                    startIcon={<Trash2 className="w-4 h-4" />}
                  >
                    {t('health.card.logs.clearButton')}
                  </Button>
                </div>
              </div>

              {/* Log Count Line */}
              <div className="py-3 border-b border-[var(--color-border)] text-xs text-[var(--color-muted)] tabular-nums-strict">
                {t('health.card.logs.countLabel', { count: toPersianDigits(logs.length) })}
              </div>

              {/* Log Entries */}
              {logs.length === 0 ? (
                <div className="py-10 text-center space-y-1.5 flex-1 flex flex-col items-center justify-center">
                  <p className="text-sm font-medium text-[var(--color-text)]">
                    {t('health.card.logs.emptyTitle')}
                  </p>
                  <p className="text-xs text-[var(--color-muted)] max-w-sm leading-relaxed">
                    {t('health.card.logs.emptyHint')}
                  </p>
                </div>
              ) : (
                <ul className="divide-y divide-[var(--color-border)] max-h-[420px] overflow-y-auto pl-1">
                  {logs.map((entry) => {
                    const safeHashUrl = extractSafeHashActionUrl(entry);
                    const otpCode =
                      typeof entry.details?.otpCode === 'string'
                        ? entry.details.otpCode
                        : null;

                    return (
                      <li key={entry.id} className="py-3 space-y-1.5">
                        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs">
                          <span className={`font-semibold ${getLogLevelTextClass(entry.level)}`}>
                            {t(getLogLevelKey(entry.level))}
                          </span>
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[var(--color-muted)] tabular-nums-strict">
                            <span>{t('health.card.logs.jalaliPrefix')}:</span>
                            <span dir="ltr" className="font-mono text-[var(--color-text)]">
                              {entry.jalaliTimestamp}
                            </span>
                            <span aria-hidden="true">·</span>
                            <span>{t('health.card.logs.utcPrefix')}:</span>
                            <span dir="ltr" className="font-mono text-[var(--color-muted)]">
                              {entry.utcTimestamp}
                            </span>
                          </div>
                        </div>

                        <p className="text-xs sm:text-sm text-[var(--color-text)] leading-relaxed break-words">
                          {entry.message}
                        </p>

                        {otpCode && (
                          <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-[var(--radius-control)] bg-[var(--color-info-bg)] text-[var(--color-info-text)] text-xs">
                            <span className="font-medium">{t('health.card.logs.otpCodeLabel')}:</span>
                            <code dir="ltr" className="font-mono font-bold tracking-widest select-all">
                              {otpCode}
                            </code>
                          </div>
                        )}

                        {safeHashUrl && (
                          <div className="pt-0.5">
                            <a
                              href={safeHashUrl}
                              className="inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--color-primary)] hover:underline underline-offset-4"
                            >
                              <ExternalLink className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                              <span>{t('health.card.logs.openLinkLabel')}</span>
                            </a>
                          </div>
                        )}

                        {entry.details && Object.keys(entry.details).length > 0 && (
                          <div className="text-[11px] text-[var(--color-muted)] flex flex-wrap items-baseline gap-1.5">
                            <span className="shrink-0">{t('health.card.logs.detailsLabel')}:</span>
                            <code
                              dir="ltr"
                              className="font-mono text-[var(--color-text)] bg-[var(--color-surface-alt)] px-1.5 py-0.5 rounded break-all"
                            >
                              {JSON.stringify(entry.details)}
                            </code>
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </section>
        </div>

        {/* Stage 3 Card: Base Seed Data & Migration Verification */}
        <section className="mt-6 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-card)] shadow-[var(--shadow-card)] p-5 sm:p-6 space-y-5">
          <div className="flex flex-wrap items-start justify-between gap-4 pb-4 border-b border-[var(--color-border)]">
            <div className="min-w-0">
              <h2 className="text-base sm:text-lg font-semibold text-[var(--color-text)] flex items-center gap-2">
                <Database className="w-5 h-5 text-[var(--color-primary)] shrink-0" aria-hidden="true" />
                <span>{t('health.card.seed.title')}</span>
              </h2>
              <p className="mt-1 text-xs sm:text-sm text-[var(--color-muted)]">
                {t('health.card.seed.subtitle')}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="primary"
                size="sm"
                onClick={handleReseed}
                disabled={isReseeding || isResettingDb}
                startIcon={<RefreshCw className={`w-4 h-4 ${isReseeding ? 'animate-spin' : ''}`} />}
              >
                {isReseeding
                  ? t('health.card.seed.reseedingButton')
                  : t('health.card.seed.reseedButton')}
              </Button>

              <Button
                variant="outline"
                size="sm"
                onClick={handleResetDatabase}
                disabled={isReseeding || isResettingDb}
                startIcon={<RotateCcw className={`w-4 h-4 ${isResettingDb ? 'animate-spin' : ''}`} />}
              >
                {isResettingDb
                  ? t('health.card.seed.resettingButton')
                  : t('health.card.seed.resetButton')}
              </Button>

              <Button
                variant="secondary"
                size="sm"
                onClick={handleClearAgeCookie}
                disabled={isReseeding || isResettingDb || isSeedingSamples}
                startIcon={<Trash2 className="w-4 h-4" />}
              >
                {t('health.card.seed.clearAgeCookieButton')}
              </Button>

              {envConfig.isDevelopment && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleSeedDevSamples}
                  disabled={isReseeding || isResettingDb || isSeedingSamples}
                  startIcon={<FileText className="w-4 h-4" />}
                >
                  {isSeedingSamples
                    ? t('health.card.seed.devSamplesRunning')
                    : t('health.card.seed.devSamplesButton')}
                </Button>
              )}
            </div>
          </div>

          {seedFeedback && (
            <Alert
              variant="success"
              message={seedFeedback}
              onDismiss={() => setSeedFeedback(null)}
            />
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Seeded Table Counts */}
            <dl className="divide-y divide-[var(--color-border)] text-xs sm:text-sm border border-[var(--color-border)] rounded-[var(--radius-control)] px-4">
              <div className="py-3 flex items-center justify-between gap-3">
                <dt className="text-[var(--color-muted)]">{t('health.card.seed.table.ageGroup')}</dt>
                <dd className="font-semibold text-[var(--color-text)] tabular-nums-strict">
                  {seedSummary
                    ? t('health.card.seed.recordCount', {
                        count: toPersianDigits(seedSummary.ageGroups),
                      })
                    : '—'}
                </dd>
              </div>
              <div className="py-3 flex items-center justify-between gap-3">
                <dt className="text-[var(--color-muted)]">{t('health.card.seed.table.impactLevel')}</dt>
                <dd className="font-semibold text-[var(--color-text)] tabular-nums-strict">
                  {seedSummary
                    ? t('health.card.seed.recordCount', {
                        count: toPersianDigits(seedSummary.impactLevels),
                      })
                    : '—'}
                </dd>
              </div>
              <div className="py-3 flex items-center justify-between gap-3">
                <dt className="text-[var(--color-muted)]">{t('health.card.seed.table.topic')}</dt>
                <dd className="font-semibold text-[var(--color-text)] tabular-nums-strict">
                  {seedSummary
                    ? t('health.card.seed.recordCount', {
                        count: toPersianDigits(seedSummary.topics),
                      })
                    : '—'}
                </dd>
              </div>
              <div className="py-3 flex items-center justify-between gap-3">
                <dt className="text-[var(--color-muted)]">{t('health.card.seed.table.featureFlag')}</dt>
                <dd className="font-semibold text-[var(--color-text)] tabular-nums-strict">
                  {seedSummary
                    ? t('health.card.seed.recordCount', {
                        count: toPersianDigits(seedSummary.featureFlags),
                      })
                    : '—'}
                </dd>
              </div>
              <div className="py-3 flex items-center justify-between gap-3">
                <dt className="text-[var(--color-muted)]">{t('health.card.seed.table.siteSetting')}</dt>
                <dd className="font-semibold text-[var(--color-text)] tabular-nums-strict">
                  {seedSummary
                    ? t('health.card.seed.recordCount', {
                        count: toPersianDigits(seedSummary.siteSettings),
                      })
                    : '—'}
                </dd>
              </div>
              <div className="py-3 flex items-center justify-between gap-3">
                <dt className="text-[var(--color-muted)]">{t('health.card.seed.siteTitleLabel')}</dt>
                <dd className="font-semibold text-[var(--color-primary)] truncate">
                  {siteTitle}
                </dd>
              </div>
            </dl>

            {/* FeatureFlags Off-by-Default Breakdown */}
            <div className="border border-[var(--color-border)] rounded-[var(--radius-control)] p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-[var(--color-border)]">
                <span className="text-xs sm:text-sm font-medium text-[var(--color-muted)]">
                  {t('health.card.seed.modulesStatusLabel')}
                </span>
                <span
                  className={`text-xs font-semibold tabular-nums-strict ${
                    seedSummary?.allModulesDisabled
                      ? 'text-[var(--color-success-text)]'
                      : 'text-[var(--color-warning-text)]'
                  }`}
                >
                  {seedSummary
                    ? seedSummary.allModulesDisabled
                      ? t('health.card.seed.modulesAllOff', {
                          count: toPersianDigits(seedSummary.featureFlags),
                        })
                      : t('health.card.seed.modulesSomeOn')
                    : '—'}
                </span>
              </div>

              <ul className="divide-y divide-[var(--color-border)] text-xs sm:text-sm">
                {(seedSummary?.featureFlagItems ?? []).map((flag) => (
                  <li key={flag.key} className="py-2 flex items-center justify-between gap-3">
                    <span dir="ltr" className="font-mono text-xs text-[var(--color-text)]">
                      {flag.key}
                    </span>
                    <span
                      className={`text-xs font-medium ${
                        flag.isEnabled
                          ? 'text-[var(--color-warning-text)]'
                          : 'text-[var(--color-muted)]'
                      }`}
                    >
                      {flag.isEnabled
                        ? t('health.card.seed.flagOnLabel')
                        : t('health.card.seed.flagOffLabel')}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        {/* Stage 4 Card: Users, Auth & Initial SuperAdmin Status */}
        <section className="mt-6 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-card)] shadow-[var(--shadow-card)] p-5 sm:p-6 space-y-5">
          <div className="flex flex-wrap items-start justify-between gap-4 pb-4 border-b border-[var(--color-border)]">
            <div className="min-w-0">
              <h2 className="text-base sm:text-lg font-semibold text-[var(--color-text)] flex items-center gap-2">
                <Users className="w-5 h-5 text-[var(--color-primary)] shrink-0" aria-hidden="true" />
                <span>{t('health.card.auth.title')}</span>
              </h2>
              <p className="mt-1 text-xs sm:text-sm text-[var(--color-muted)]">
                {t('health.card.auth.subtitle')}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {!hasSuperAdmin && (
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => navigateToHash('/setup/initial-admin')}
                  startIcon={<ShieldCheck className="w-4 h-4" />}
                >
                  {t('health.card.auth.setupButton')}
                </Button>
              )}

              {envConfig.isDevelopment && !hasStaffUser && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void handleCreateDevStaff()}
                  disabled={isCreatingDevStaff}
                  startIcon={<UserPlus className="w-4 h-4" />}
                >
                  {t('health.card.auth.createDevStaffButton')}
                </Button>
              )}

              <Button
                variant="outline"
                size="sm"
                onClick={() => navigateToHash('/account/login')}
                startIcon={<LogIn className="w-4 h-4" />}
              >
                {t('health.card.auth.loginButton')}
              </Button>

              <Button
                variant="secondary"
                size="sm"
                onClick={() => navigateToHash('/account/register')}
                startIcon={<UserPlus className="w-4 h-4" />}
              >
                {t('health.card.auth.registerButton')}
              </Button>
            </div>
          </div>

          {devStaffFeedback && (
            <Alert
              variant="info"
              message={devStaffFeedback}
              onDismiss={() => setDevStaffFeedback(null)}
            />
          )}

          <dl className="divide-y divide-[var(--color-border)] text-xs sm:text-sm border border-[var(--color-border)] rounded-[var(--radius-control)] px-4">
            <div className="py-3 flex items-center justify-between gap-3">
              <dt className="text-[var(--color-muted)]">{t('health.card.auth.usersCountLabel')}</dt>
              <dd className="font-semibold text-[var(--color-text)] tabular-nums-strict">
                {usersCount !== null
                  ? t('health.card.seed.recordCount', {
                      count: toPersianDigits(usersCount),
                    })
                  : '—'}
              </dd>
            </div>

            <div className="py-3 flex items-center justify-between gap-3">
              <dt className="text-[var(--color-muted)]">
                {t('health.card.auth.superAdminStatusLabel')}
              </dt>
              <dd
                className={`font-semibold ${
                  hasSuperAdmin
                    ? 'text-[var(--color-success-text)]'
                    : 'text-[var(--color-warning-text)]'
                }`}
              >
                {hasSuperAdmin
                  ? t('health.card.auth.superAdminReady')
                  : t('health.card.auth.superAdminPending')}
              </dd>
            </div>

            <div className="py-3 flex items-center justify-between gap-3">
              <dt className="text-[var(--color-muted)]">
                {t('health.card.auth.staffStatusLabel')}
              </dt>
              <dd
                className={`font-semibold ${
                  hasStaffUser
                    ? 'text-[var(--color-success-text)]'
                    : 'text-[var(--color-muted)]'
                }`}
              >
                {hasStaffUser
                  ? t('health.card.auth.staffReady')
                  : t('health.card.auth.staffPending')}
              </dd>
            </div>

            <div className="py-3 flex items-center justify-between gap-3">
              <dt className="text-[var(--color-muted)]">
                {t('health.card.auth.currentSessionLabel')}
              </dt>
              <dd className="font-medium text-[var(--color-text)]">
                {currentUser
                  ? t('health.card.auth.sessionActive', { name: currentUser.displayName })
                  : t('health.card.auth.sessionGuest')}
              </dd>
            </div>
          </dl>
        </section>
      </div>
    </MainLayout>
  );
}
