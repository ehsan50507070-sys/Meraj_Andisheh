import type {
  FileReadRangeResult,
  IFileStorage,
} from '../../core/abstractions/fileStorage';
import type {
  IS3FileStorage,
  IS3StorageConfigStore,
} from '../../core/abstractions/s3Storage';
import {
  isS3ConfigComplete,
  type FileSaveRequest,
  type StoredFileMetadata,
} from '../../core/domain/storage';

/**
 * Transparent storage router implementing IFileStorage.
 * - When active provider is 's3' and valid S3 credentials are configured:
 *   writes go to S3FileStorage; reads hit S3FileStorage first with seamless fallback to LocalIndexedDbFileStorage for unmigrated files.
 * - When active provider is 'local' (default or after disconnect):
 *   writes and reads use LocalIndexedDbFileStorage cleanly without touching S3.
 */
export class RoutingFileStorage implements IFileStorage {
  private readonly localStorage: IFileStorage;
  private readonly s3Storage: IS3FileStorage;
  private readonly configStore: IS3StorageConfigStore;

  constructor(params: {
    localStorage: IFileStorage;
    s3Storage: IS3FileStorage;
    configStore: IS3StorageConfigStore;
  }) {
    this.localStorage = params.localStorage;
    this.s3Storage = params.s3Storage;
    this.configStore = params.configStore;
  }

  private async isS3ActiveAsync(): Promise<boolean> {
    const config = await this.configStore.getConfigAsync();
    return config.provider === 's3' && isS3ConfigComplete(config);
  }

  public async saveAsync(request: FileSaveRequest): Promise<StoredFileMetadata> {
    if (await this.isS3ActiveAsync()) {
      return this.s3Storage.saveAsync(request);
    }
    return this.localStorage.saveAsync(request);
  }

  public async openReadAsync(
    storageKey: string,
  ): Promise<{ bytes: Uint8Array; metadata: StoredFileMetadata } | null> {
    if (await this.isS3ActiveAsync()) {
      const fromS3 = await this.s3Storage.openReadAsync(storageKey);
      if (fromS3) {
        return fromS3;
      }
    }
    return this.localStorage.openReadAsync(storageKey);
  }

  public async openReadRangeAsync(
    storageKey: string,
    startByte: number,
    endByte: number,
  ): Promise<FileReadRangeResult | null> {
    if (await this.isS3ActiveAsync()) {
      const fromS3 = await this.s3Storage.openReadRangeAsync(
        storageKey,
        startByte,
        endByte,
      );
      if (fromS3) {
        return fromS3;
      }
    }
    return this.localStorage.openReadRangeAsync(storageKey, startByte, endByte);
  }

  public async getMetadataAsync(
    storageKey: string,
  ): Promise<StoredFileMetadata | null> {
    if (await this.isS3ActiveAsync()) {
      const fromS3 = await this.s3Storage.getMetadataAsync(storageKey);
      if (fromS3) {
        return fromS3;
      }
    }
    return this.localStorage.getMetadataAsync(storageKey);
  }

  public async deleteAsync(storageKey: string): Promise<void> {
    if (await this.isS3ActiveAsync()) {
      await Promise.all([
        this.s3Storage.deleteAsync(storageKey),
        this.localStorage.deleteAsync(storageKey),
      ]);
      return;
    }
    await this.localStorage.deleteAsync(storageKey);
  }

  public async existsAsync(storageKey: string): Promise<boolean> {
    if (await this.isS3ActiveAsync()) {
      if (await this.s3Storage.existsAsync(storageKey)) {
        return true;
      }
    }
    return this.localStorage.existsAsync(storageKey);
  }

  public async listAllMetadataAsync(): Promise<StoredFileMetadata[]> {
    if (!(await this.isS3ActiveAsync())) {
      return this.localStorage.listAllMetadataAsync();
    }

    const [s3List, localList] = await Promise.all([
      this.s3Storage.listAllMetadataAsync(),
      this.localStorage.listAllMetadataAsync(),
    ]);
    const byKey = new Map<string, StoredFileMetadata>();
    for (const item of localList) {
      byKey.set(item.storageKey, item);
    }
    for (const item of s3List) {
      byKey.set(item.storageKey, item);
    }
    return Array.from(byKey.values()).sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt),
    );
  }
}
