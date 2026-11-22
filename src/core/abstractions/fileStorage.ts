import type { FileSaveRequest, StoredFileMetadata } from '../domain/storage';

export interface FileReadRangeResult {
  chunk: Uint8Array;
  totalBytes: number;
  startByte: number;
  endByte: number;
  mimeType: string;
}

export interface IFileStorage {
  saveAsync(request: FileSaveRequest): Promise<StoredFileMetadata>;
  openReadAsync(
    storageKey: string,
  ): Promise<{ bytes: Uint8Array; metadata: StoredFileMetadata } | null>;
  openReadRangeAsync(
    storageKey: string,
    startByte: number,
    endByte: number,
  ): Promise<FileReadRangeResult | null>;
  getMetadataAsync(storageKey: string): Promise<StoredFileMetadata | null>;
  deleteAsync(storageKey: string): Promise<void>;
  existsAsync(storageKey: string): Promise<boolean>;
  listAllMetadataAsync(): Promise<StoredFileMetadata[]>;
}
