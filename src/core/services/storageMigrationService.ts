import type { IClock } from '../abstractions/IClock';
import type { IContentRepository } from '../abstractions/contentRepository';
import type { IFileStorage } from '../abstractions/fileStorage';
import type { ILogger } from '../abstractions/ILogger';
import type {
  IS3FileStorage,
  IS3StorageConfigStore,
} from '../abstractions/s3Storage';
import type { AppUser } from '../domain/auth';
import { FileStorageType, type ContentFile } from '../domain/content';
import {
  DEFAULT_S3_STORAGE_CONFIG,
  isS3ConfigComplete,
  isS3EndpointValid,
  redactS3ConfigForLogs,
  type LocalCleanupResult,
  type S3ConnectionTestResult,
  type S3MigrationItemReport,
  type S3MigrationReport,
  type S3StorageConfig,
  type StorageInventorySummary,
} from '../domain/storage';
import { PermissionPolicyService } from './permissionPolicyService';

export type StorageServiceResult<T> =
  | {
      ok: true;
      statusCode: 200;
      data: T;
    }
  | {
      ok: false;
      statusCode: 400 | 403 | 404;
      errorCode: string;
      messageKey: string;
      fieldErrors?: Record<string, string>;
    };

function normalizePublicBaseUrl(raw: string): { isValid: boolean; value: string } {
  const trimmed = (raw ?? '').trim().replace(/\/+$/, '');
  if (!trimmed) {
    return { isValid: true, value: '' };
  }
  if (trimmed.startsWith('local-s3://')) {
    return { isValid: trimmed.length > 'local-s3://'.length, value: trimmed };
  }
  try {
    const parsed = new URL(trimmed);
    const valid = parsed.protocol === 'https:' || parsed.protocol === 'http:';
    return { isValid: valid, value: trimmed };
  } catch {
    return { isValid: false, value: trimmed };
  }
}

function normalizeS3ConfigInput(
  input: Partial<S3StorageConfig>,
  existing?: S3StorageConfig,
): S3StorageConfig {
  const incomingSecret = (input.secretAccessKey ?? '').trim();
  return {
    provider: input.provider === 's3' ? 's3' : 'local',
    endpoint: (input.endpoint ?? '').trim().replace(/\/+$/, ''),
    bucketName: (input.bucketName ?? '').trim(),
    region:
      (input.region ?? '').trim() || DEFAULT_S3_STORAGE_CONFIG.region,
    accessKeyId: (input.accessKeyId ?? '').trim(),
    secretAccessKey:
      incomingSecret || (input.secretAccessKey === '' ? '' : (existing?.secretAccessKey ?? '')),
    forcePathStyle:
      typeof input.forcePathStyle === 'boolean' ? input.forcePathStyle : true,
    publicBaseUrl: (input.publicBaseUrl ?? '').trim().replace(/\/+$/, ''),
    updatedAt: existing?.updatedAt ?? null,
  };
}

function validateS3Fields(config: S3StorageConfig): Record<string, string> {
  const errors: Record<string, string> = {};

  if (!isS3EndpointValid(config.endpoint)) {
    errors.endpoint = 'admin.settings.storage.error.invalidEndpoint';
  }
  if (!config.bucketName.trim()) {
    errors.bucketName = 'admin.settings.storage.error.bucketRequired';
  }
  if (!config.region.trim()) {
    errors.region = 'admin.settings.storage.error.regionRequired';
  }
  if (!config.accessKeyId.trim()) {
    errors.accessKeyId = 'admin.settings.storage.error.accessKeyRequired';
  }
  if (!config.secretAccessKey.trim()) {
    errors.secretAccessKey = 'admin.settings.storage.error.secretKeyRequired';
  }
  const pubCheck = normalizePublicBaseUrl(config.publicBaseUrl);
  if (!pubCheck.isValid) {
    errors.publicBaseUrl = 'admin.settings.storage.error.invalidPublicBaseUrl';
  }

  return errors;
}

export class StorageMigrationService {
  private readonly configStore: IS3StorageConfigStore;
  private readonly localStorage: IFileStorage;
  private readonly s3Storage: IS3FileStorage;
  private readonly contentRepository: IContentRepository;
  private readonly policyService: PermissionPolicyService;
  private readonly clock: IClock;
  private readonly logger: ILogger;

  constructor(params: {
    configStore: IS3StorageConfigStore;
    localStorage: IFileStorage;
    s3Storage: IS3FileStorage;
    contentRepository: IContentRepository;
    policyService: PermissionPolicyService;
    clock: IClock;
    logger: ILogger;
  }) {
    this.configStore = params.configStore;
    this.localStorage = params.localStorage;
    this.s3Storage = params.s3Storage;
    this.contentRepository = params.contentRepository;
    this.policyService = params.policyService;
    this.clock = params.clock;
    this.logger = params.logger;
  }

  private async authorizeSettingsManageAsync<T>(
    actor: AppUser | null,
  ): Promise<
    | { allowed: true }
    | { allowed: false; failure: StorageServiceResult<T> }
  > {
    const auth = await this.policyService.authorizePermission(
      actor,
      'settings.manage',
      '#/admin/settings',
    );
    if (!auth.allowed) {
      const failureStatusCode: 403 | 404 = auth.statusCode === 404 ? 404 : 403;
      return {
        allowed: false,
        failure: {
          ok: false,
          statusCode: failureStatusCode,
          errorCode: failureStatusCode === 404 ? 'NOT_FOUND' : 'FORBIDDEN',
          messageKey:
            failureStatusCode === 404 ? 'notFound.title' : 'admin.forbidden.title',
        },
      };
    }
    return { allowed: true };
  }

  public async getStorageConfigAsync(
    actor: AppUser | null,
  ): Promise<StorageServiceResult<S3StorageConfig>> {
    const gate = await this.authorizeSettingsManageAsync<S3StorageConfig>(actor);
    if (!gate.allowed) {
      return gate.failure;
    }

    const config = await this.configStore.getConfigAsync();
    return {
      ok: true,
      statusCode: 200,
      data: config,
    };
  }

  public async saveStorageConfigAsync(
    actor: AppUser | null,
    input: Partial<S3StorageConfig>,
  ): Promise<StorageServiceResult<S3StorageConfig>> {
    const gate = await this.authorizeSettingsManageAsync<S3StorageConfig>(actor);
    if (!gate.allowed) {
      return gate.failure;
    }

    const existing = await this.configStore.getConfigAsync();
    const normalized = normalizeS3ConfigInput(input, existing);
    const hasAnyS3Input = Boolean(
      normalized.endpoint ||
        normalized.bucketName ||
        normalized.accessKeyId ||
        normalized.secretAccessKey ||
        normalized.publicBaseUrl,
    );

    if (normalized.provider === 's3' || hasAnyS3Input) {
      const fieldErrors =
        normalized.provider === 's3'
          ? validateS3Fields(normalized)
          : (() => {
              const errs: Record<string, string> = {};
              if (normalized.endpoint && !isS3EndpointValid(normalized.endpoint)) {
                errs.endpoint = 'admin.settings.storage.error.invalidEndpoint';
              }
              const pub = normalizePublicBaseUrl(normalized.publicBaseUrl);
              if (!pub.isValid) {
                errs.publicBaseUrl =
                  'admin.settings.storage.error.invalidPublicBaseUrl';
              }
              return errs;
            })();

      if (Object.keys(fieldErrors).length > 0) {
        return {
          ok: false,
          statusCode: 400,
          errorCode: 'VALIDATION_FAILED',
          messageKey: 'admin.settings.storage.error.validationFailed',
          fieldErrors,
        };
      }
    }

    const saved = await this.configStore.saveConfigAsync({
      ...normalized,
      updatedAt: this.clock.nowUtcIso(),
    });

    this.logger.info('STORAGE_CONFIG_SAVED', {
      actorUserId: actor?.id ?? null,
      ...redactS3ConfigForLogs(saved),
    });

    return {
      ok: true,
      statusCode: 200,
      data: saved,
    };
  }

  public async disconnectS3Async(
    actor: AppUser | null,
  ): Promise<StorageServiceResult<S3StorageConfig>> {
    const gate = await this.authorizeSettingsManageAsync<S3StorageConfig>(actor);
    if (!gate.allowed) {
      return gate.failure;
    }

    const current = await this.configStore.getConfigAsync();
    const saved = await this.configStore.saveConfigAsync({
      ...current,
      provider: 'local',
      updatedAt: this.clock.nowUtcIso(),
    });

    this.logger.info('STORAGE_S3_DISCONNECTED_TO_LOCAL', {
      actorUserId: actor?.id ?? null,
      ...redactS3ConfigForLogs(saved),
    });

    return {
      ok: true,
      statusCode: 200,
      data: saved,
    };
  }

  public async testS3ConnectionAsync(
    actor: AppUser | null,
    candidateConfig?: Partial<S3StorageConfig>,
  ): Promise<StorageServiceResult<S3ConnectionTestResult>> {
    const gate =
      await this.authorizeSettingsManageAsync<S3ConnectionTestResult>(actor);
    if (!gate.allowed) {
      return gate.failure;
    }

    const existing = await this.configStore.getConfigAsync();
    const effective = candidateConfig
      ? normalizeS3ConfigInput(candidateConfig, existing)
      : existing;

    const fieldErrors = validateS3Fields(effective);
    if (Object.keys(fieldErrors).length > 0) {
      return {
        ok: false,
        statusCode: 400,
        errorCode: 'S3_NOT_CONFIGURED',
        messageKey: 'admin.settings.storage.error.S3_NOT_CONFIGURED',
        fieldErrors,
      };
    }

    const probeResult = await this.s3Storage.testConnectionAsync(effective);

    this.logger.info('STORAGE_S3_CONNECTION_TESTED', {
      actorUserId: actor?.id ?? null,
      ok: probeResult.ok,
      mode: probeResult.mode,
      latencyMs: probeResult.latencyMs,
      ...redactS3ConfigForLogs(effective),
    });

    return {
      ok: true,
      statusCode: 200,
      data: probeResult,
    };
  }

  public async getStorageInventoryAsync(
    actor: AppUser | null,
  ): Promise<StorageServiceResult<StorageInventorySummary>> {
    const gate =
      await this.authorizeSettingsManageAsync<StorageInventorySummary>(actor);
    if (!gate.allowed) {
      return gate.failure;
    }

    const [config, localItems, s3Items] = await Promise.all([
      this.configStore.getConfigAsync(),
      this.localStorage.listAllMetadataAsync(),
      this.s3Storage.listBucketObjectsMetadataAsync(),
    ]);

    const configured = isS3ConfigComplete(config);
    const activeBucket = config.bucketName.trim();
    const s3Map = new Map(s3Items.map((item) => [item.storageKey, item]));

    let localTotalBytes = 0;
    let matchingCount = 0;
    for (const item of localItems) {
      localTotalBytes += item.sizeBytes;
      const inS3 = s3Map.get(item.storageKey);
      if (
        inS3 &&
        inS3.sizeBytes === item.sizeBytes &&
        (!activeBucket || inS3.bucketName === activeBucket)
      ) {
        matchingCount += 1;
      }
    }

    let s3TotalBytes = 0;
    for (const item of s3Items) {
      s3TotalBytes += item.sizeBytes;
    }

    return {
      ok: true,
      statusCode: 200,
      data: {
        activeProvider: config.provider,
        isS3Configured: configured,
        bucketName: activeBucket,
        localFilesCount: localItems.length,
        localTotalBytes,
        s3FilesCount: s3Items.length,
        s3TotalBytes,
        migratedOrMatchingInS3Count: matchingCount,
        pendingMigrationCount: Math.max(0, localItems.length - matchingCount),
      },
    };
  }

  public async migrateLocalFilesToS3Async(
    actor: AppUser | null,
  ): Promise<StorageServiceResult<S3MigrationReport>> {
    const gate = await this.authorizeSettingsManageAsync<S3MigrationReport>(actor);
    if (!gate.allowed) {
      return gate.failure;
    }

    const config = await this.configStore.getConfigAsync();
    if (!isS3ConfigComplete(config)) {
      return {
        ok: false,
        statusCode: 400,
        errorCode: 'S3_NOT_CONFIGURED',
        messageKey: 'admin.settings.storage.error.S3_NOT_CONFIGURED',
      };
    }

    const bucketName = config.bucketName.trim();
    const completedAt = this.clock.nowUtcIso();
    const localItems = await this.localStorage.listAllMetadataAsync();

    let migratedCount = 0;
    let skippedCount = 0;
    let failedCount = 0;
    let totalBytesMigrated = 0;
    const items: S3MigrationItemReport[] = [];
    const s3PresentKeys = new Set<string>();

    for (const localMeta of localItems) {
      const existingInS3 = await this.s3Storage.getBucketObjectMetadataAsync(
        localMeta.storageKey,
      );
      if (
        existingInS3 &&
        existingInS3.bucketName === bucketName &&
        existingInS3.sizeBytes === localMeta.sizeBytes
      ) {
        skippedCount += 1;
        s3PresentKeys.add(localMeta.storageKey);
        items.push({
          storageKey: localMeta.storageKey,
          originalFileName: localMeta.originalFileName,
          sizeBytes: localMeta.sizeBytes,
          status: 'already_in_s3',
          eTag: existingInS3.eTag,
        });
        continue;
      }

      const opened = await this.localStorage.openReadAsync(localMeta.storageKey);
      if (!opened) {
        failedCount += 1;
        items.push({
          storageKey: localMeta.storageKey,
          originalFileName: localMeta.originalFileName,
          sizeBytes: localMeta.sizeBytes,
          status: 'error',
          errorCode: 'LOCAL_READ_FAILED',
        });
        continue;
      }

      const savedObj = await this.s3Storage.saveExistingKeyAsync(
        opened.metadata,
        opened.bytes,
        bucketName,
        completedAt,
      );
      migratedCount += 1;
      totalBytesMigrated += opened.metadata.sizeBytes;
      s3PresentKeys.add(localMeta.storageKey);
      items.push({
        storageKey: localMeta.storageKey,
        originalFileName: localMeta.originalFileName,
        sizeBytes: opened.metadata.sizeBytes,
        status: 'migrated',
        eTag: savedObj.eTag,
      });
    }

    const updatedContentFilesCount =
      await this.syncContentFileStorageTypesToS3Async(s3PresentKeys);

    this.logger.info('STORAGE_LOCAL_TO_S3_MIGRATED', {
      actorUserId: actor?.id ?? null,
      bucketName,
      migratedCount,
      skippedCount,
      failedCount,
      updatedContentFilesCount,
      localFilesPreserved: true,
    });

    return {
      ok: true,
      statusCode: 200,
      data: {
        ok: true,
        bucketName,
        migratedCount,
        skippedCount,
        failedCount,
        totalProcessed: localItems.length,
        totalBytesMigrated,
        updatedContentFilesCount,
        localFilesPreserved: true,
        completedAt,
        items,
      },
    };
  }

  private async syncContentFileStorageTypesToS3Async(
    migratedKeys: ReadonlySet<string>,
  ): Promise<number> {
    if (migratedKeys.size === 0) {
      return 0;
    }

    const allFiles = await this.contentRepository.getAllFiles();
    const byContent = new Map<number, ContentFile[]>();
    let updatedCount = 0;

    for (const file of allFiles) {
      if (
        file.storageKey &&
        migratedKeys.has(file.storageKey) &&
        file.storageType === FileStorageType.Local
      ) {
        if (this.contentRepository.updateFile) {
          await this.contentRepository.updateFile({
            ...file,
            storageType: FileStorageType.S3,
          });
          updatedCount += 1;
        } else {
          const group = byContent.get(file.contentId) ?? [];
          group.push(file);
          byContent.set(file.contentId, group);
        }
      }
    }

    if (!this.contentRepository.updateFile && byContent.size > 0) {
      for (const [contentId] of byContent) {
        const contentFiles = await this.contentRepository.getFilesByContentId(
          contentId,
        );
        const mapped = contentFiles.map((f) => {
          const shouldFlip =
            Boolean(f.storageKey && migratedKeys.has(f.storageKey)) &&
            f.storageType === FileStorageType.Local;
          if (shouldFlip) {
            updatedCount += 1;
          }
          return {
            contentId: f.contentId,
            kind: f.kind,
            storageType: shouldFlip ? FileStorageType.S3 : f.storageType,
            storageKey: f.storageKey,
            externalUrl: f.externalUrl,
            originalFileName: f.originalFileName,
            mimeType: f.mimeType,
            sizeBytes: f.sizeBytes,
            isDownloadable: f.isDownloadable,
            sortOrder: f.sortOrder,
          };
        });
        await this.contentRepository.replaceFiles(contentId, mapped);
      }
    }

    return updatedCount;
  }

  public async confirmCleanupMigratedLocalFilesAsync(
    actor: AppUser | null,
    confirmation: { confirmed: boolean },
  ): Promise<StorageServiceResult<LocalCleanupResult>> {
    const gate =
      await this.authorizeSettingsManageAsync<LocalCleanupResult>(actor);
    if (!gate.allowed) {
      return gate.failure;
    }

    if (!confirmation?.confirmed) {
      return {
        ok: false,
        statusCode: 400,
        errorCode: 'CLEANUP_CONFIRMATION_REQUIRED',
        messageKey: 'admin.settings.storage.error.cleanupConfirmationRequired',
      };
    }

    const config = await this.configStore.getConfigAsync();
    if (!isS3ConfigComplete(config)) {
      return {
        ok: false,
        statusCode: 400,
        errorCode: 'S3_NOT_CONFIGURED',
        messageKey: 'admin.settings.storage.error.S3_NOT_CONFIGURED',
      };
    }

    const bucketName = config.bucketName.trim();
    const localItems = await this.localStorage.listAllMetadataAsync();
    const cleanedAt = this.clock.nowUtcIso();

    let cleanedCount = 0;
    let cleanedBytes = 0;
    let verifiedInS3Count = 0;
    let skippedUnverifiedCount = 0;

    for (const localMeta of localItems) {
      const [existsInS3, s3Meta] = await Promise.all([
        this.s3Storage.existsAsync(localMeta.storageKey),
        this.s3Storage.getBucketObjectMetadataAsync(localMeta.storageKey),
      ]);

      if (
        existsInS3 &&
        s3Meta &&
        s3Meta.bucketName === bucketName &&
        s3Meta.sizeBytes === localMeta.sizeBytes
      ) {
        verifiedInS3Count += 1;
        await this.localStorage.deleteAsync(localMeta.storageKey);
        cleanedCount += 1;
        cleanedBytes += localMeta.sizeBytes;
      } else {
        skippedUnverifiedCount += 1;
      }
    }

    const remainingLocal = await this.localStorage.listAllMetadataAsync();

    this.logger.info('STORAGE_VERIFIED_LOCAL_FILES_CLEANED', {
      actorUserId: actor?.id ?? null,
      bucketName,
      cleanedCount,
      verifiedInS3Count,
      skippedUnverifiedCount,
      remainingLocalCount: remainingLocal.length,
    });

    return {
      ok: true,
      statusCode: 200,
      data: {
        ok: true,
        cleanedCount,
        cleanedBytes,
        verifiedInS3Count,
        skippedUnverifiedCount,
        remainingLocalCount: remainingLocal.length,
        cleanedAt,
      },
    };
  }
}
