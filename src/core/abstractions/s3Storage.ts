import type {
  S3BucketObjectMetadata,
  S3ConnectionTestResult,
  S3StorageConfig,
  StoredFileMetadata,
} from '../domain/storage';
import type { IFileStorage } from './fileStorage';

export interface IS3StorageConfigStore {
  getConfigAsync(): Promise<S3StorageConfig>;
  saveConfigAsync(config: S3StorageConfig): Promise<S3StorageConfig>;
}

export interface IS3FileStorage extends IFileStorage {
  saveExistingKeyAsync(
    metadata: StoredFileMetadata,
    bytes: Uint8Array,
    bucketName: string,
    migratedAt: string | null,
  ): Promise<S3BucketObjectMetadata>;
  getBucketObjectMetadataAsync(
    storageKey: string,
  ): Promise<S3BucketObjectMetadata | null>;
  listBucketObjectsMetadataAsync(): Promise<S3BucketObjectMetadata[]>;
  testConnectionAsync(config: S3StorageConfig): Promise<S3ConnectionTestResult>;
}
