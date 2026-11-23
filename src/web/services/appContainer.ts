import { AuthService } from '../../core/services/authService';
import { ContentCatalogService } from '../../core/services/contentCatalogService';
import { ContentDetailService } from '../../core/services/contentDetailService';
import { ContentIntegrityService } from '../../core/services/contentIntegrityService';
import { ContentManagementService } from '../../core/services/contentManagementService';
import { DownloadService } from '../../core/services/downloadService';
import { FileUploadService } from '../../core/services/fileUploadService';
import { HealthCheckService } from '../../core/services/HealthCheckService';
import { InitialSuperAdminService } from '../../core/services/initialSuperAdminService';
import { OtpService } from '../../core/services/otpService';
import { PermissionPolicyService } from '../../core/services/permissionPolicyService';
import { RateLimiter } from '../../core/services/rateLimiter';
import { SearchNormalizer } from '../../core/services/searchNormalizer';
import { SearchSuggestionService } from '../../core/services/searchSuggestionService';
import { SettingsManagementService } from '../../core/services/settingsManagementService';
import { SmartImportService } from '../../core/services/smartImportService';
import { StaffManagementService } from '../../core/services/staffManagementService';
import { TaxonomyService } from '../../core/services/taxonomyService';
import { UserManagementService } from '../../core/services/userManagementService';
import { ViewTrackerService } from '../../core/services/viewTrackerService';
import { SystemClock } from '../../infrastructure/clock/SystemClock';
import { envConfig } from '../../infrastructure/config/envConfig';
import { IndexedDbAdminRepository } from '../../infrastructure/data/IndexedDbAdminRepository';
import { IndexedDbAuthRepository } from '../../infrastructure/data/IndexedDbAuthRepository';
import { IndexedDbContentRepository } from '../../infrastructure/data/IndexedDbContentRepository';
import { IndexedDbDataStore } from '../../infrastructure/data/IndexedDbDataStore';
import { IndexedDbDownloadEventRepository } from '../../infrastructure/data/IndexedDbDownloadEventRepository';
import { IndexedDbTaxonomyRepository } from '../../infrastructure/data/IndexedDbTaxonomyRepository';
import { IndexedDbViewEventRepository } from '../../infrastructure/data/IndexedDbViewEventRepository';
import { LocalSessionTokenStore } from '../../infrastructure/data/LocalSessionTokenStore';
import { DatabaseSeeder } from '../../infrastructure/data/seed';
import { AppLogger } from '../../infrastructure/logging/AppLogger';
import { DevEmailSender } from '../../infrastructure/messaging/DevEmailSender';
import { DevSmsSender } from '../../infrastructure/messaging/DevSmsSender';
import { BrowserPasswordHasher } from '../../infrastructure/security/BrowserPasswordHasher';
import { HmacDownloadTokenProtector } from '../../infrastructure/security/HmacDownloadTokenProtector';
import { BrowserAgeCookieStorage } from '../../infrastructure/storage/BrowserAgeCookieStorage';
import { BrowserVisitorIdStorage } from '../../infrastructure/storage/BrowserVisitorIdStorage';
import { LocalIndexedDbFileStorage } from '../../infrastructure/storage/LocalIndexedDbFileStorage';
import { t } from '../resources/i18n';

export interface AppContainer {
  clock: SystemClock;
  logger: AppLogger;
  dataStore: IndexedDbDataStore;
  healthCheckService: HealthCheckService;
  databaseSeeder: DatabaseSeeder;
  authRepository: IndexedDbAuthRepository;
  adminRepository: IndexedDbAdminRepository;
  taxonomyRepository: IndexedDbTaxonomyRepository;
  contentRepository: IndexedDbContentRepository;
  viewEventRepository: IndexedDbViewEventRepository;
  downloadEventRepository: IndexedDbDownloadEventRepository;
  downloadTokenProtector: HmacDownloadTokenProtector;
  fileStorage: LocalIndexedDbFileStorage;
  agePreferenceStorage: BrowserAgeCookieStorage;
  visitorIdStorage: BrowserVisitorIdStorage;
  passwordHasher: BrowserPasswordHasher;
  emailSender: DevEmailSender;
  smsSender: DevSmsSender;
  rateLimiter: RateLimiter;
  searchNormalizer: SearchNormalizer;
  authService: AuthService;
  otpService: OtpService;
  initialSuperAdminService: InitialSuperAdminService;
  contentIntegrityService: ContentIntegrityService;
  permissionPolicyService: PermissionPolicyService;
  staffManagementService: StaffManagementService;
  userManagementService: UserManagementService;
  settingsManagementService: SettingsManagementService;
  fileUploadService: FileUploadService;
  taxonomyService: TaxonomyService;
  contentManagementService: ContentManagementService;
  contentCatalogService: ContentCatalogService;
  contentDetailService: ContentDetailService;
  viewTrackerService: ViewTrackerService;
  downloadService: DownloadService;
  searchSuggestionService: SearchSuggestionService;
  smartImportService: SmartImportService;
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
const taxonomyRepository = new IndexedDbTaxonomyRepository(dataStore);
const contentRepository = new IndexedDbContentRepository(dataStore);
const viewEventRepository = new IndexedDbViewEventRepository(dataStore);
const downloadEventRepository = new IndexedDbDownloadEventRepository(dataStore);
const downloadTokenProtector = new HmacDownloadTokenProtector();
const fileStorage = new LocalIndexedDbFileStorage(dataStore, clock);
const agePreferenceStorage = new BrowserAgeCookieStorage();
const visitorIdStorage = new BrowserVisitorIdStorage();
const passwordHasher = new BrowserPasswordHasher();
const sessionTokenStore = new LocalSessionTokenStore(envConfig.sessionStorageKey);
const emailSender = new DevEmailSender(logger, t('logs.devEmailPrefix'));
const smsSender = new DevSmsSender(logger, t('logs.devSmsPrefix'));
const rateLimiter = new RateLimiter(clock, 20, 60 * 1000);
const searchNormalizer = new SearchNormalizer();

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
const fileUploadService = new FileUploadService(
  fileStorage,
  adminRepository,
  permissionPolicyService,
  logger,
);
const taxonomyService = new TaxonomyService(
  taxonomyRepository,
  permissionPolicyService,
  fileUploadService,
  logger,
);
const contentManagementService = new ContentManagementService(
  contentRepository,
  taxonomyRepository,
  permissionPolicyService,
  fileUploadService,
  searchNormalizer,
  clock,
  logger,
);
const contentCatalogService = new ContentCatalogService(
  contentRepository,
  taxonomyRepository,
  adminRepository,
  searchNormalizer,
);
const contentDetailService = new ContentDetailService(
  contentRepository,
  taxonomyRepository,
  fileStorage,
);
const viewTrackerService = new ViewTrackerService(
  viewEventRepository,
  contentRepository,
  clock,
  logger,
);
const downloadService = new DownloadService(
  contentRepository,
  downloadEventRepository,
  fileStorage,
  downloadTokenProtector,
  clock,
  logger,
);
const searchSuggestionService = new SearchSuggestionService(
  contentRepository,
  taxonomyRepository,
  searchNormalizer,
);
const smartImportService = new SmartImportService(
  taxonomyRepository,
  permissionPolicyService,
  searchNormalizer,
  logger,
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
  taxonomyRepository,
  contentRepository,
  viewEventRepository,
  downloadEventRepository,
  downloadTokenProtector,
  fileStorage,
  agePreferenceStorage,
  visitorIdStorage,
  passwordHasher,
  emailSender,
  smsSender,
  rateLimiter,
  searchNormalizer,
  authService,
  otpService,
  initialSuperAdminService,
  contentIntegrityService,
  permissionPolicyService,
  staffManagementService,
  userManagementService,
  settingsManagementService,
  fileUploadService,
  taxonomyService,
  contentManagementService,
  contentCatalogService,
  contentDetailService,
  viewTrackerService,
  downloadService,
  searchSuggestionService,
  smartImportService,
  recordStartupLogOnce,
  ensureInitializedAtStartup,
};
