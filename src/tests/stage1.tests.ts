import { HealthCheckService } from '../core/services/HealthCheckService';
import { SystemClock } from '../infrastructure/clock/SystemClock';
import { envConfig } from '../infrastructure/config/envConfig';
import { IndexedDbDataStore } from '../infrastructure/data/IndexedDbDataStore';
import { AppLogger } from '../infrastructure/logging/AppLogger';
import { t } from '../web/resources/i18n';
import { assert, assertEqual, type UnitTestCase } from './testRunner';

export const stage1Tests: UnitTestCase[] = [
  {
    id: 'stage1-health-indexeddb',
    nameKey: 'health.card.tests.case1Name',
    descriptionKey: 'health.card.tests.case1Desc',
    run: async () => {
      const clock = new SystemClock();
      const isolatedLogKey = `meraj_test_health_${Date.now()}`;
      const logger = new AppLogger(clock, isolatedLogKey, 20);
      const store = new IndexedDbDataStore(
        envConfig.databaseName,
        envConfig.databaseVersion,
        envConfig.metaStoreName,
      );

      try {
        const service = new HealthCheckService(store, logger, clock);
        const status = await service.checkHealth();

        assertEqual(status.appHealthy, true, 'App health flag must be true');
        assertEqual(status.overallState, 'healthy', 'Overall system state must be healthy');
        assertEqual(status.database.state, 'connected', 'IndexedDB connection must be connected');
        assertEqual(status.database.readWriteVerified, true, 'IndexedDB _meta read/write must succeed');
        assertEqual(status.database.databaseName, 'MerajAndishehDB', 'Database name mismatch');
        assertEqual(
          status.database.databaseVersion,
          envConfig.databaseVersion,
          'Database version must match envConfig',
        );
        assertEqual(status.database.metaStoreName, '_meta', 'Meta store name must be _meta');
      } finally {
        logger.clearLogs();
      }
    },
  },
  {
    id: 'stage1-logger-persistence',
    nameKey: 'health.card.tests.case2Name',
    descriptionKey: 'health.card.tests.case2Desc',
    run: () => {
      const clock = new SystemClock();
      const testStorageKey = `meraj_test_logger_${Date.now()}`;
      const writerLogger = new AppLogger(clock, testStorageKey, 25);

      try {
        writerLogger.clearLogs();
        const sampleMessage = `stage1_logger_probe_${Date.now()}`;
        const created = writerLogger.info(sampleMessage, { probe: true, stage: 1 });

        const readerLogger = new AppLogger(clock, testStorageKey, 25);
        const logs = readerLogger.getLogs();

        assert(logs.length === 1, 'Expected exactly one persisted log entry');
        assertEqual(logs[0].id, created.id, 'Persisted log ID mismatch');
        assertEqual(logs[0].message, sampleMessage, 'Persisted log message mismatch');
        assertEqual(logs[0].level, 'INFO', 'Persisted log level mismatch');
        assert(logs[0].utcTimestamp.endsWith('Z'), 'UTC timestamp must be valid ISO format');
        assert(logs[0].jalaliTimestamp.includes('/'), 'Jalali timestamp must contain date separators');

        const exportedText = readerLogger.formatLogsForExport();
        assert(exportedText.includes(sampleMessage), 'Exported log text must include the message');
      } finally {
        writerLogger.clearLogs();
      }
    },
  },
  {
    id: 'stage1-i18n-translation',
    nameKey: 'health.card.tests.case3Name',
    descriptionKey: 'health.card.tests.case3Desc',
    run: () => {
      const essentialKeys = [
        'app.name',
        'health.pageTitle',
        'health.card.system.appHealthy',
        'health.card.system.dbConnected',
        'health.card.tests.runButton',
        'health.card.logs.downloadButton',
        'logs.startupMessage',
      ] as const;

      for (const key of essentialKeys) {
        const translated = t(key);
        assert(
          typeof translated === 'string' && translated.trim().length > 0,
          `Translation for key "${key}" must not be empty`,
        );
        assert(
          translated !== key,
          `Translation for key "${key}" must resolve to localized text`,
        );
      }

      const missingKey = 'non.existent.resource.key';
      assertEqual(t(missingKey), missingKey, 'Missing key must safely fall back to the key string');
    },
  },
  {
    id: 'stage1-clock-jalali-utc',
    nameKey: 'health.card.tests.case4Name',
    descriptionKey: 'health.card.tests.case4Desc',
    run: () => {
      const clock = new SystemClock();
      const utc = clock.nowUtcIso();
      const jalali = clock.nowJalali();

      assert(!Number.isNaN(Date.parse(utc)), 'UTC ISO timestamp must be parseable');
      assert(/^\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2}$/.test(jalali), `Invalid Jalali format: ${jalali}`);

      const jalaliYear = Number(jalali.slice(0, 4));
      assert(jalaliYear >= 1400 && jalaliYear <= 1500, `Unexpected Jalali year: ${jalaliYear}`);
    },
  },
];
