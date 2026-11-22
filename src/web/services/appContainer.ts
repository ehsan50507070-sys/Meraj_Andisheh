import { AuthService } from '../../core/services/authService';
import { ContentIntegrityService } from '../../core/services/contentIntegrityService';
import { HealthCheckService } from '../../core/services/HealthCheckService';
import { InitialSuperAdminService } from '../../core/services/initialSuperAdminService';
import { OtpService } from '../../core/services/otpService';
import { PermissionPolicyService } from '../../core/services/permissionPolicyService';
import { RateLimiter } from '../../core/services/rateLimiter';
import { SettingsManagementService } from '../../core/services/settingsManagementService';
import { StaffManagementService } from '../../core/services/staffManagementService';
import { UserManagementService } from '../../core/services/userManagementService';
import { SystemClock } from '../../infrastructure/clock/SystemClock';
import { envConfig } from '../../infrastructure/config/envConfig';
import { IndexedDbAdminRepository } from '../../infrastructure/data/IndexedDbAdminRepository';
import { IndexedDbAuthRepository } from '../../infrastructure/data/IndexedDbAuthRepository';
import { IndexedDbDataStore } from '../../infrastructure/data/IndexedDbDataStore';
import { LocalSessionTokenStore } from '../../infrastructure/data/LocalSessionTokenStore';
import { DatabaseSeeder } from '../../infrastructure/data/seed';
import { AppLogger } from '../../infrastructure/logging/AppLogger';
import { DevEmailSender } from '../../infrastructure/messaging/DevEmailSender';
import { DevSmsSender } from '../../infrastructure/messaging/DevSmsSender';
import { BrowserPasswordHasher } from '../../infrastructure/security/BrowserPasswordHasher';
import { t } from '../resources/i18n';

export interface AppContainer {
  clock: SystemClock;
  logger: AppLogger;
  dataStore: IndexedDbDataStore;
  healthCheckService: HealthCheckService;
  databaseSeeder: DatabaseSeeder;
  authRepository: IndexedDbAuthRepository;
  adminRepository: IndexedDbAdminRepository;
  passwordHasher: BrowserPasswordHasher;
  emailSender: DevEmailSender;
  smsSender: DevSmsSender;
  rateLimiter: RateLimiter;
  authService: AuthService;
  otpService: OtpService;
  initialSuperAdminService: InitialSuperAdminService;
  contentIntegrityService: ContentIntegrityService;
  permissionPolicyService: PermissionPolicyService;
  staffManagementService: StaffManagementService;
  userManagementService: UserManagementService;
  settingsManagementService: SettingsManagementService;
  recordStartupLogOnce: () => void;
  ensureInitializedAtStartup: () => Promise<void>;
}

const clock = new SystemClock();
const logger = new AppLogger(clock, envConfig.logStorageKey, envConfig.maxStoredLogs);
const dataStore = new IndexedDbDataStore(
  envConfig.databaseName,
  envConfig.databaseVersion,
  envConfig.metaStoreName,
);
const healthCheckService = new HealthCheckService(dataStore, logger, clock);
const databaseSeeder = new DatabaseSeeder(dataStore, logger);
const authRepository = new IndexedDbAuthRepository(dataStore);
const adminRepository = new IndexedDbAdminRepository(dataStore);
const passwordHasher = new BrowserPasswordHasher();
const sessionTokenStore = new LocalSessionTokenStore(envConfig.sessionStorageKey);
const emailSender = new DevEmailSender(logger, t('logs.devEmailPrefix'));
const smsSender = new DevSmsSender(logger, t('logs.devSmsPrefix'));
const rateLimiter = new RateLimiter(clock, 20, 60 * 1000);

const authService = new AuthService(
  authRepository,
  passwordHasher,
  emailSender,
  clock,
  logger,
  sessionTokenStore,
  {
    confirmSubject: t('auth.email.confirmSubject'),
    confirmBody: t('auth.email.confirmBody'),
    resetSubject: t('auth.email.resetSubject'),
    resetBody: t('auth.email.resetBody'),
  },
  rateLimiter,
);

const otpService = new OtpService(
  authRepository,
  passwordHasher,
  smsSender,
  clock,
  logger,
  sessionTokenStore,
  rateLimiter,
  t('auth.otp.smsTemplate'),
);

const initialSuperAdminService = new InitialSuperAdminService(
  authRepository,
  passwordHasher,
  clock,
  logger,
);

const contentIntegrityService = new ContentIntegrityService(authRepository);

const permissionPolicyService = new PermissionPolicyService(adminRepository, logger);
const staffManagementService = new StaffManagementService(
  adminRepository,
  passwordHasher,
  clock,
  logger,
  permissionPolicyService,
);
const userManagementService = new UserManagementService(
  adminRepository,
  logger,
  permissionPolicyService,
);
const settingsManagementService = new SettingsManagementService(
  adminRepository,
  logger,
  permissionPolicyService,
);

let startupRecordedInSession = false;
let startupInitPromise: Promise<void> | null = null;

function recordStartupLogOnce(): void {
  if (startupRecordedInSession) {
    return;
  }
  startupRecordedInSession = true;

  logger.info(t('logs.startupMessage'), {
    stage: envConfig.stageNumber,
    environment: envConfig.environment,
    database: envConfig.databaseName,
    databaseVersion: envConfig.databaseVersion,
    route:
      typeof window !== 'undefined'
        ? window.location.hash || envConfig.defaultHashRoute
        : envConfig.defaultHashRoute,
  });
}

function ensureInitializedAtStartup(): Promise<void> {
  if (!startupInitPromise) {
    startupInitPromise = (async () => {
      try {
        await databaseSeeder.seed(t('logs.seedExecuted'));
        await initialSuperAdminService.bootstrapFromEnvIfConfigured(
          envConfig.initialSuperAdminEmail,
          envConfig.initialSuperAdminTempPassword,
          t('setup.defaultSuperAdminDisplayName'),
        );
      } catch (error) {
        logger.error(t('logs.seedFailed'), {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    })();
  }
  return startupInitPromise;
}

export const appContainer: AppContainer = {
  clock,
  logger,
  dataStore,
  healthCheckService,
  databaseSeeder,
  authRepository,
  adminRepository,
  passwordHasher,
  emailSender,
  smsSender,
  rateLimiter,
  authService,
  otpService,
  initialSuperAdminService,
  contentIntegrityService,
  permissionPolicyService,
  staffManagementService,
  userManagementService,
  settingsManagementService,
  recordStartupLogOnce,
  ensureInitializedAtStartup,
};
