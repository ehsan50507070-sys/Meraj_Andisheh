export type FileVisibility = 'public' | 'private';

export type FileCategory =
  | 'video'
  | 'audio'
  | 'image'
  | 'document'
  | 'presentation'
  | 'archive';

export type FileValidationErrorCode =
  | 'EMPTY_FILE'
  | 'MISSING_EXTENSION'
  | 'FORBIDDEN_EXTENSION'
  | 'UNSUPPORTED_EXTENSION'
  | 'FILE_SIGNATURE_MISMATCH'
  | 'FILE_TOO_LARGE'
  | 'PUBLIC_ONLY_IMAGES_ALLOWED';

export interface StoredFileMetadata {
  storageKey: string;
  originalFileName: string;
  extension: string;
  mimeType: string;
  sizeBytes: number;
  visibility: FileVisibility;
  category: FileCategory;
  uploadedById: number | null;
  /** ISO 8601 UTC timestamp */
  createdAt: string;
}

export interface FileSaveRequest {
  bytes: Uint8Array;
  originalFileName: string;
  contentType: string;
  visibility: FileVisibility;
  uploadedById?: number | null;
}

export interface FileValidationResult {
  isValid: boolean;
  errorCode?: FileValidationErrorCode;
  category?: FileCategory;
  normalizedExtension?: string;
  detectedMimeType?: string;
  maxAllowedBytes?: number;
}

export type StorageProviderMode = 'local' | 's3';

export interface S3StorageConfig {
  provider: StorageProviderMode;
  endpoint: string;
  bucketName: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
  publicBaseUrl: string;
  updatedAt: string | null;
}

export const DEFAULT_S3_STORAGE_CONFIG: Readonly<S3StorageConfig> = Object.freeze({
  provider: 'local',
  endpoint: '',
  bucketName: '',
  region: 'ir-thr-at1',
  accessKeyId: '',
  secretAccessKey: '',
  forcePathStyle: true,
  publicBaseUrl: '',
  updatedAt: null,
});

export interface S3BucketObjectMetadata extends StoredFileMetadata {
  bucketName: string;
  eTag: string;
  migratedAt: string | null;
}

export interface S3ConnectionTestResult {
  ok: boolean;
  latencyMs: number;
  bucketName: string;
  endpoint: string;
  mode: 'simulated' | 'remote';
  errorCode?: string;
  messageKey?: string;
}

export type S3MigrationItemStatus = 'migrated' | 'already_in_s3' | 'error';

export interface S3MigrationItemReport {
  storageKey: string;
  originalFileName: string;
  sizeBytes: number;
  status: S3MigrationItemStatus;
  eTag?: string;
  errorCode?: string;
}

export interface S3MigrationReport {
  ok: true;
  bucketName: string;
  migratedCount: number;
  skippedCount: number;
  failedCount: number;
  totalProcessed: number;
  totalBytesMigrated: number;
  updatedContentFilesCount: number;
  localFilesPreserved: true;
  completedAt: string;
  items: S3MigrationItemReport[];
}

export interface LocalCleanupResult {
  ok: true;
  cleanedCount: number;
  cleanedBytes: number;
  verifiedInS3Count: number;
  skippedUnverifiedCount: number;
  remainingLocalCount: number;
  cleanedAt: string;
}

export interface StorageInventorySummary {
  activeProvider: StorageProviderMode;
  isS3Configured: boolean;
  bucketName: string;
  localFilesCount: number;
  localTotalBytes: number;
  s3FilesCount: number;
  s3TotalBytes: number;
  migratedOrMatchingInS3Count: number;
  pendingMigrationCount: number;
}

export function isS3EndpointValid(rawEndpoint: string): boolean {
  const trimmed = (rawEndpoint ?? '').trim();
  if (!trimmed) {
    return false;
  }
  if (trimmed.startsWith('local-s3://') && trimmed.length > 'local-s3://'.length) {
    return true;
  }
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

export function isS3ConfigComplete(
  config: Partial<S3StorageConfig> | null | undefined,
): boolean {
  if (!config) {
    return false;
  }
  return (
    isS3EndpointValid(config.endpoint ?? '') &&
    Boolean((config.bucketName ?? '').trim()) &&
    Boolean((config.region ?? '').trim()) &&
    Boolean((config.accessKeyId ?? '').trim()) &&
    Boolean((config.secretAccessKey ?? '').trim())
  );
}

/**
 * Produces a log-safe summary of S3 storage config that NEVER exposes secretAccessKey.
 */
export function redactS3ConfigForLogs(
  config: Partial<S3StorageConfig>,
): Record<string, string | boolean> {
  const rawAccessKey = (config.accessKeyId ?? '').trim();
  const maskedAccessKey =
    rawAccessKey.length <= 4
      ? rawAccessKey
        ? '****'
        : ''
      : `${rawAccessKey.slice(0, 2)}****${rawAccessKey.slice(-2)}`;

  return {
    provider: config.provider ?? 'local',
    endpoint: (config.endpoint ?? '').trim(),
    bucketName: (config.bucketName ?? '').trim(),
    region: (config.region ?? '').trim(),
    accessKeyPreview: maskedAccessKey,
    hasSecretAccessKey: Boolean((config.secretAccessKey ?? '').trim()),
    forcePathStyle: Boolean(config.forcePathStyle),
  };
}

