import type { FileSaveRequest, StoredFileMetadata } from '../domain/storage';

export interface IFileStorage {
  saveAsync(request: FileSaveRequest): Promise<StoredFileMetadata>;
  openReadAsync(
    storageKey: string,
  ): Promise<{ bytes: Uint8Array; metadata: StoredFileMetadata } | null>;
  getMetadataAsync(storageKey: string): Promise<StoredFileMetadata | null>;
  deleteAsync(storageKey: string): Promise<void>;
  existsAsync(storageKey: string): Promise<boolean>;
  listAllMetadataAsync(): Promise<StoredFileMetadata[]>;
}
