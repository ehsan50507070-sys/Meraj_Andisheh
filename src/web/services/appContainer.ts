import { AnalyticsDashboardService } from '../../core/services/analyticsDashboardService';
import { AuthService } from '../../core/services/authService';
import { BackupService } from '../../core/services/backupService';
import { CommentService } from '../../core/services/commentService';
import { ContentCatalogService } from '../../core/services/contentCatalogService';
import { ContentDetailService } from '../../core/services/contentDetailService';
import { ContentIntegrityService } from '../../core/services/contentIntegrityService';
import { ContentManagementService } from '../../core/services/contentManagementService';
import { ContentRequestService } from '../../core/services/contentRequestService';
import { DownloadService } from '../../core/services/downloadService';
import { FileUploadService } from '../../core/services/fileUploadService';
import { HealthCheckService } from '../../core/services/HealthCheckService';
import { HomePageService } from '../../core/services/homePageService';
import { InitialSuperAdminService } from '../../core/services/initialSuperAdminService';
import { InteractionService } from '../../core/services/interactionService';
import { LayoutManagementService } from '../../core/services/layoutManagementService';
import { OtpService } from '../../core/services/otpService';
import { PermissionPolicyService } from '../../core/services/permissionPolicyService';
import { PersonalizationService } from '../../core/services/personalizationService';
import { ProfileService } from '../../core/services/profileService';
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
import { IndexedDbAccountCleanupRepository } from '../../infrastructure/data/IndexedDbAccountCleanupRepository';
import { IndexedDbAdminRepository } from '../../infrastructure/data/IndexedDbAdminRepository';
import { IndexedDbAuthRepository } from '../../infrastructure/data/IndexedDbAuthRepository';
import { IndexedDbBackupRepository } from '../../infrastructure/data/IndexedDbBackupRepository';
import { IndexedDbBackupSnapshotProvider } from '../../infrastructure/data/IndexedDbBackupSnapshotProvider';
import { IndexedDbCommentRepository } from '../../infrastructure/data/IndexedDbCommentRepository';
import { IndexedDbContentRepository } from '../../infrastructure/data/IndexedDbContentRepository';
import { IndexedDbContentRequestRepository } from '../../infrastructure/data/IndexedDbContentRequestRepository';
import { IndexedDbDataStore } from '../../infrastructure/data/IndexedDbDataStore';
import { IndexedDbDownloadEventRepository } from '../../infrastructure/data/IndexedDbDownloadEventRepository';
import { IndexedDbInteractionRepository } from '../../infrastructure/data/IndexedDbInteractionRepository';
import { IndexedDbLayoutRepository } from '../../infrastructure/data/IndexedDbLayoutRepository';
import { IndexedDbTaxonomyRepository } from '../../infrastructure/data/IndexedDbTaxonomyRepository';
import { IndexedDbUserTopicAffinityRepository } from '../../infrastructure/data/IndexedDbUserTopicAffinityRepository';
import { IndexedDbViewEventRepository } from '../../infrastructure/data/IndexedDbViewEventRepository';
import { STORE_NAMES } from '../../infrastructure/data/migrations';
import { LocalSessionTokenStore } from '../../infrastructure/data/LocalSessionTokenStore';
import { DatabaseSeeder } from '../../infrastructure/data/seed';
import { ensureStage18LayoutSeededAsync } from '../../infrastructure/data/stage18LayoutSeed';
import { BackupScheduler } from '../../infrastructure/jobs/BackupScheduler';
import { AppLogger } from '../../infrastructure/logging/AppLogger';
import { DevEmailSender } from '../../infrastructure/messaging/DevEmailSender';
import { DevSmsSender } from '../../infrastructure/messaging/DevSmsSender';
import { BrowserPasswordHasher } from '../../infrastructure/security/BrowserPasswordHasher';
import { HmacDownloadTokenProtector } from '../../infrastructure/security/HmacDownloadTokenProtector';
import { BrowserAffinityCookieStorage } from '../../infrastructure/storage/BrowserAffinityCookieStorage';
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
  interactionRepository: IndexedDbInteractionRepository;
  commentRepository: IndexedDbCommentRepository;
  contentRequestRepository: IndexedDbContentRequestRepository;
  layoutRepository: IndexedDbLayoutRepository;
  userTopicAffinityRepository: IndexedDbUserTopicAffinityRepository;
  accountCleanupRepository: IndexedDbAccountCleanupRepository;
  backupRepository: IndexedDbBackupRepository;
  backupSnapshotProvider: IndexedDbBackupSnapshotProvider;
  downloadTokenProtector: HmacDownloadTokenProtector;
  fileStorage: LocalIndexedDbFileStorage;
  agePreferenceStorage: BrowserAgeCookieStorage;
  guestAffinityStorage: BrowserAffinityCookieStorage;
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
  interactionService: InteractionService;
  commentService: CommentService;
  contentRequestService: ContentRequestService;
  personalizationService: PersonalizationService;
  homePageService: HomePageService;
  layoutManagementService: LayoutManagementService;
  analyticsDashboardService: AnalyticsDashboardService;
  backupService: BackupService;
  backupScheduler: BackupScheduler;
  profileService: ProfileService;
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
const interactionRepository = new IndexedDbInteractionRepository(dataStore);
const commentRepository = new IndexedDbCommentRepository(dataStore);
const contentRequestRepository = new IndexedDbContentRequestRepository(dataStore);
const layoutRepository = new IndexedDbLayoutRepository(dataStore);
const userTopicAffinityRepository = new IndexedDbUserTopicAffinityRepository(dataStore);
const accountCleanupRepository = new IndexedDbAccountCleanupRepository(dataStore);
const backupRepository = new IndexedDbBackupRepository(dataStore, clock);
const backupSnapshotProvider = new IndexedDbBackupSnapshotProvider(dataStore);
const downloadTokenProtector = new HmacDownloadTokenProtector();
const fileStorage = new LocalIndexedDbFileStorage(dataStore, clock);
const agePreferenceStorage = new BrowserAgeCookieStorage();
const guestAffinityStorage = new BrowserAffinityCookieStorage();
const visitorIdStorage = new BrowserVisitorIdStorage();
const passwordHasher = new BrowserPasswordHasher();
const sessionTokenStore = new LocalSessionTokenStore(envConfig.sessionStorageKey);
const emailSender = new DevEmailSender(logger, t('logs.devEmailPrefix'));
const smsSender = new DevSmsSender(logger, t('logs.devSmsPrefix'));
const rateLimiter = new RateLimiter(clock, 20, 60 * 1000);
const searchNormalizer = new SearchNormalizer();

const personalizationService = new PersonalizationService({
  affinityRepository: userTopicAffinityRepository,
  guestAffinityStorage,
  adminRepository,
  contentRepository,
  taxonomyRepository,
  viewEventRepository,
  clock,
  logger,
});

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
  personalizationService,
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
  personalizationService,
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
  taxonomyRepository,
  personalizationService,
);
const downloadService = new DownloadService(
  contentRepository,
  downloadEventRepository,
  fileStorage,
  downloadTokenProtector,
  clock,
  logger,
);
const interactionService = new InteractionService(
  interactionRepository,
  contentRepository,
  taxonomyRepository,
  clock,
  logger,
);
const commentService = new CommentService({
  commentRepository,
  contentRepository,
  adminRepository,
  taxonomyRepository,
  permissionPolicyService,
  searchNormalizer,
  clock,
  logger,
  deletedDisplayName: t('user.deletedDisplayName'),
});
const contentRequestService = new ContentRequestService({
  contentRequestRepository,
  contentRepository,
  adminRepository,
  taxonomyRepository,
  permissionPolicyService,
  searchNormalizer,
  clock,
  logger,
  deletedDisplayName: t('user.deletedDisplayName'),
});
const homePageService = new HomePageService({
  layoutRepository,
  contentRepository,
  taxonomyRepository,
  adminRepository,
  viewEventRepository,
  clock,
  personalizationService,
});
const layoutManagementService = new LayoutManagementService({
  layoutRepository,
  taxonomyRepository,
  permissionPolicyService,
  fileUploadService,
  fileStorage,
  logger,
});
const analyticsDashboardService = new AnalyticsDashboardService({
  viewEventRepository,
  downloadEventRepository,
  contentRepository,
  permissionPolicyService,
  clock,
  logger,
});
const backupService = new BackupService({
  backupLogRepository: backupRepository,
  backupStorage: backupRepository,
  snapshotProvider: backupSnapshotProvider,
  permissionPolicyService,
  clock,
  logger,
});
const backupScheduler = new BackupScheduler({
  backupService,
  backupLogRepository: backupRepository,
  clock,
  logger,
});
const profileService = new ProfileService({
  authRepository,
  contentRepository,
  interactionRepository,
  downloadEventRepository,
  cleanupRepository: accountCleanupRepository,
  passwordHasher,
  sessionTokenStore,
  clock,
  logger,
  deletedDisplayName: t('user.deletedDisplayName'),
});
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

export const STAGE16_COMMENTS_FLAG_META_KEY = 'stage16_comments_default_enabled_v1';

export async function ensureStage16CommentsDefaultFlagAsync(
  store: IndexedDbDataStore = dataStore,
): Promise<void> {
  const existingMeta = await store.getMeta(STAGE16_COMMENTS_FLAG_META_KEY);
  if (existingMeta) {
    return;
  }
  await store.putRecord(STORE_NAMES.FEATURE_FLAGS, {
    key: 'Comments',
    isEnabled: true,
  });
  await store.setMeta({
    key: STAGE16_COMMENTS_FLAG_META_KEY,
    value: '1',
    updatedAtUtc: clock.nowUtcIso(),
  });
}

export const STAGE17_CONTENT_REQUESTS_FLAG_META_KEY =
  'stage17_content_requests_default_enabled_v1';

export async function ensureStage17ContentRequestsDefaultFlagAsync(
  store: IndexedDbDataStore = dataStore,
): Promise<void> {
  const existingMeta = await store.getMeta(
    STAGE17_CONTENT_REQUESTS_FLAG_META_KEY,
  );
  if (existingMeta) {
    return;
  }
  await store.putRecord(STORE_NAMES.FEATURE_FLAGS, {
    key: 'ContentRequests',
    isEnabled: true,
  });
  await store.setMeta({
    key: STAGE17_CONTENT_REQUESTS_FLAG_META_KEY,
    value: '1',
    updatedAtUtc: clock.nowUtcIso(),
  });
}

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
        await ensureStage16CommentsDefaultFlagAsync(dataStore);
        await ensureStage17ContentRequestsDefaultFlagAsync(dataStore);
        await ensureStage18LayoutSeededAsync(dataStore);
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
  interactionRepository,
  commentRepository,
  contentRequestRepository,
  layoutRepository,
  userTopicAffinityRepository,
  accountCleanupRepository,
  backupRepository,
  backupSnapshotProvider,
  downloadTokenProtector,
  fileStorage,
  agePreferenceStorage,
  guestAffinityStorage,
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
  interactionService,
  commentService,
  contentRequestService,
  personalizationService,
  homePageService,
  layoutManagementService,
  analyticsDashboardService,
  backupService,
  backupScheduler,
  profileService,
  searchSuggestionService,
  smartImportService,
  recordStartupLogOnce,
  ensureInitializedAtStartup,
};
