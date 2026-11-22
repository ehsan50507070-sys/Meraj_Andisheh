import type { IFileStorage } from '../../core/abstractions/fileStorage';
import type { IClock } from '../../core/abstractions/IClock';
import type { FileSaveRequest, StoredFileMetadata } from '../../core/domain/storage';
import {
  extractNormalizedExtension,
  getCategoryForExtension,
  getMimeTypeForExtension,
} from '../../core/services/fileValidationService';
import type { IndexedDbDataStore } from '../data/IndexedDbDataStore';
import { STORE_NAMES } from '../data/migrations';

interface StoredFileRecord extends StoredFileMetadata {
  data: ArrayBuffer;
}

function generateUuidV4(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  const bytes = new Uint8Array(16);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }

  // RFC 4122 version 4 & variant 1 bits
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function toMetadataOnly(record: StoredFileRecord): StoredFileMetadata {
  return {
    storageKey: record.storageKey,
    originalFileName: record.originalFileName,
    extension: record.extension,
    mimeType: record.mimeType,
    sizeBytes: record.sizeBytes,
    visibility: record.visibility,
    category: record.category,
    uploadedById: record.uploadedById ?? null,
    createdAt: record.createdAt,
  };
}

export class LocalIndexedDbFileStorage implements IFileStorage {
  private readonly dataStore: IndexedDbDataStore;
  private readonly clock: IClock;

  constructor(dataStore: IndexedDbDataStore, clock: IClock) {
    this.dataStore = dataStore;
    this.clock = clock;
  }

  public async saveAsync(request: FileSaveRequest): Promise<StoredFileMetadata> {
    const ext = extractNormalizedExtension(request.originalFileName) ?? 'bin';
    const uuid = generateUuidV4();
    const prefix = request.visibility === 'public' ? 'public/thumb' : 'private/vault';
    const storageKey = `${prefix}/${uuid}.${ext}`;

    const category = getCategoryForExtension(ext) ?? 'document';
    const mimeType = request.contentType || getMimeTypeForExtension(ext);
    const copy = new Uint8Array(request.bytes.byteLength);
    copy.set(request.bytes);

    const record: StoredFileRecord = {
      storageKey,
      originalFileName: request.originalFileName,
      extension: ext,
      mimeType,
      sizeBytes: request.bytes.byteLength,
      visibility: request.visibility,
      category,
      uploadedById: request.uploadedById ?? null,
      createdAt: this.clock.nowUtcIso(),
      data: copy.buffer,
    };

    await this.dataStore.putRecord(STORE_NAMES.STORED_FILES, record);
    return toMetadataOnly(record);
  }

  public async openReadAsync(
    storageKey: string,
  ): Promise<{ bytes: Uint8Array; metadata: StoredFileMetadata } | null> {
    const record = await this.dataStore.getByKey<StoredFileRecord>(
      STORE_NAMES.STORED_FILES,
      storageKey,
    );
    if (!record) {
      return null;
    }

    const bytes =
      record.data instanceof ArrayBuffer
        ? new Uint8Array(record.data)
        : new Uint8Array(record.data as ArrayBufferLike);

    return {
      bytes,
      metadata: toMetadataOnly(record),
    };
  }

  public async openReadRangeAsync(
    storageKey: string,
    startByte: number,
    endByte: number,
  ): Promise<{
    chunk: Uint8Array;
    totalBytes: number;
    startByte: number;
    endByte: number;
    mimeType: string;
  } | null> {
    const record = await this.dataStore.getByKey<StoredFileRecord>(
      STORE_NAMES.STORED_FILES,
      storageKey,
    );
    if (!record) {
      return null;
    }

    const bytesCopy =
      record.data instanceof ArrayBuffer
        ? new Uint8Array(record.data.slice(0))
        : new Uint8Array(record.data);
    const totalBytes = bytesCopy.byteLength;
    if (totalBytes === 0) {
      return {
        chunk: new Uint8Array(0),
        totalBytes: 0,
        startByte: 0,
        endByte: 0,
        mimeType: record.mimeType,
      };
    }

    const safeStart = Math.max(0, Math.min(Math.floor(startByte), totalBytes - 1));
    const safeEnd = Math.max(safeStart, Math.min(Math.floor(endByte), totalBytes - 1));

    if (typeof Blob !== 'undefined') {
      const blob = new Blob([bytesCopy.buffer as ArrayBuffer], { type: record.mimeType });
      const slicedBlob = blob.slice(safeStart, safeEnd + 1);
      const slicedBuffer = await slicedBlob.arrayBuffer();
      return {
        chunk: new Uint8Array(slicedBuffer),
        totalBytes,
        startByte: safeStart,
        endByte: safeEnd,
        mimeType: record.mimeType,
      };
    }

    const slice = bytesCopy.slice(safeStart, safeEnd + 1);
    return {
      chunk: slice,
      totalBytes,
      startByte: safeStart,
      endByte: safeEnd,
      mimeType: record.mimeType,
    };
  }

  public async getMetadataAsync(storageKey: string): Promise<StoredFileMetadata | null> {
    const record = await this.dataStore.getByKey<StoredFileRecord>(
      STORE_NAMES.STORED_FILES,
      storageKey,
    );
    return record ? toMetadataOnly(record) : null;
  }

  public async deleteAsync(storageKey: string): Promise<void> {
    await this.dataStore.deleteByKey(STORE_NAMES.STORED_FILES, storageKey);
  }

  public async existsAsync(storageKey: string): Promise<boolean> {
    const record = await this.dataStore.getByKey<StoredFileRecord>(
      STORE_NAMES.STORED_FILES,
      storageKey,
    );
    return record !== null;
  }

  public async listAllMetadataAsync(): Promise<StoredFileMetadata[]> {
    const records = await this.dataStore.getAll<StoredFileRecord>(STORE_NAMES.STORED_FILES);
    return records
      .map(toMetadataOnly)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
}
