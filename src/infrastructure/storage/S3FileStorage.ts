import type { IClock } from '../../core/abstractions/IClock';
import type { FileReadRangeResult } from '../../core/abstractions/fileStorage';
import type {
  IS3FileStorage,
  IS3StorageConfigStore,
} from '../../core/abstractions/s3Storage';
import {
  isS3ConfigComplete,
  type FileSaveRequest,
  type S3BucketObjectMetadata,
  type S3ConnectionTestResult,
  type S3StorageConfig,
  type StoredFileMetadata,
} from '../../core/domain/storage';
import {
  extractNormalizedExtension,
  getCategoryForExtension,
  getMimeTypeForExtension,
} from '../../core/services/fileValidationService';
import { S3PresignedUrlService } from '../../core/services/s3PresignedUrlService';
import type { IndexedDbDataStore } from '../data/IndexedDbDataStore';
import { STORE_NAMES } from '../data/migrations';

interface S3BucketObjectRecord extends S3BucketObjectMetadata {
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
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

async function computeETagHexAsync(bytes: Uint8Array): Promise<string> {
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    const digest = await crypto.subtle.digest('SHA-256', copy.buffer);
    const arr = new Uint8Array(digest);
    let hex = '';
    for (let i = 0; i < 16; i += 1) {
      hex += arr[i].toString(16).padStart(2, '0');
    }
    return `"${hex}"`;
  }
  let acc = 2166136261;
  for (let i = 0; i < bytes.length; i += 1) {
    acc ^= bytes[i];
    acc = Math.imul(acc, 16777619);
  }
  return `"${(acc >>> 0).toString(16).padStart(8, '0')}-${bytes.byteLength.toString(16)}"`;
}

function toS3MetadataOnly(record: S3BucketObjectRecord): S3BucketObjectMetadata {
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
    bucketName: record.bucketName,
    eTag: record.eTag,
    migratedAt: record.migratedAt ?? null,
  };
}

function toStoredMetadataOnly(record: S3BucketObjectRecord): StoredFileMetadata {
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

export class S3FileStorage implements IS3FileStorage {
  private readonly dataStore: IndexedDbDataStore;
  private readonly configStore: IS3StorageConfigStore;
  private readonly clock: IClock;

  constructor(
    dataStore: IndexedDbDataStore,
    configStore: IS3StorageConfigStore,
    clock: IClock,
  ) {
    this.dataStore = dataStore;
    this.configStore = configStore;
    this.clock = clock;
  }

  public async saveAsync(request: FileSaveRequest): Promise<StoredFileMetadata> {
    const ext = extractNormalizedExtension(request.originalFileName) ?? 'bin';
    const uuid = generateUuidV4();
    const prefix = request.visibility === 'public' ? 'public/thumb' : 'private/vault';
    const storageKey = `${prefix}/${uuid}.${ext}`;

    const config = await this.configStore.getConfigAsync();
    const bucketName = config.bucketName.trim() || 'meraj-default-bucket';

    const category = getCategoryForExtension(ext) ?? 'document';
    const mimeType = request.contentType || getMimeTypeForExtension(ext);
    const copy = new Uint8Array(request.bytes.byteLength);
    copy.set(request.bytes);
    const eTag = await computeETagHexAsync(request.bytes);

    const record: S3BucketObjectRecord = {
      storageKey,
      originalFileName: request.originalFileName,
      extension: ext,
      mimeType,
      sizeBytes: request.bytes.byteLength,
      visibility: request.visibility,
      category,
      uploadedById: request.uploadedById ?? null,
      createdAt: this.clock.nowUtcIso(),
      bucketName,
      eTag,
      migratedAt: null,
      data: copy.buffer,
    };

    await this.dataStore.putRecord(STORE_NAMES.S3_BUCKET_OBJECTS, record);
    return toStoredMetadataOnly(record);
  }

  public async saveExistingKeyAsync(
    metadata: StoredFileMetadata,
    bytes: Uint8Array,
    bucketName: string,
    migratedAt: string | null,
  ): Promise<S3BucketObjectMetadata> {
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    const eTag = await computeETagHexAsync(bytes);

    const record: S3BucketObjectRecord = {
      storageKey: metadata.storageKey,
      originalFileName: metadata.originalFileName,
      extension: metadata.extension,
      mimeType: metadata.mimeType,
      sizeBytes: bytes.byteLength,
      visibility: metadata.visibility,
      category: metadata.category,
      uploadedById: metadata.uploadedById ?? null,
      createdAt: metadata.createdAt,
      bucketName: bucketName.trim() || 'meraj-default-bucket',
      eTag,
      migratedAt,
      data: copy.buffer,
    };

    await this.dataStore.putRecord(STORE_NAMES.S3_BUCKET_OBJECTS, record);
    return toS3MetadataOnly(record);
  }

  public async openReadAsync(
    storageKey: string,
  ): Promise<{ bytes: Uint8Array; metadata: StoredFileMetadata } | null> {
    const record = await this.dataStore.getByKey<S3BucketObjectRecord>(
      STORE_NAMES.S3_BUCKET_OBJECTS,
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
      metadata: toStoredMetadataOnly(record),
    };
  }

  public async openReadRangeAsync(
    storageKey: string,
    startByte: number,
    endByte: number,
  ): Promise<FileReadRangeResult | null> {
    const record = await this.dataStore.getByKey<S3BucketObjectRecord>(
      STORE_NAMES.S3_BUCKET_OBJECTS,
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
      const blob = new Blob([bytesCopy.buffer as ArrayBuffer], {
        type: record.mimeType,
      });
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

  public async getMetadataAsync(
    storageKey: string,
  ): Promise<StoredFileMetadata | null> {
    const record = await this.dataStore.getByKey<S3BucketObjectRecord>(
      STORE_NAMES.S3_BUCKET_OBJECTS,
      storageKey,
    );
    return record ? toStoredMetadataOnly(record) : null;
  }

  public async getBucketObjectMetadataAsync(
    storageKey: string,
  ): Promise<S3BucketObjectMetadata | null> {
    const record = await this.dataStore.getByKey<S3BucketObjectRecord>(
      STORE_NAMES.S3_BUCKET_OBJECTS,
      storageKey,
    );
    return record ? toS3MetadataOnly(record) : null;
  }

  public async deleteAsync(storageKey: string): Promise<void> {
    await this.dataStore.deleteByKey(STORE_NAMES.S3_BUCKET_OBJECTS, storageKey);
  }

  public async existsAsync(storageKey: string): Promise<boolean> {
    const record = await this.dataStore.getByKey<S3BucketObjectRecord>(
      STORE_NAMES.S3_BUCKET_OBJECTS,
      storageKey,
    );
    return record !== null;
  }

  public async listAllMetadataAsync(): Promise<StoredFileMetadata[]> {
    const records = await this.dataStore.getAll<S3BucketObjectRecord>(
      STORE_NAMES.S3_BUCKET_OBJECTS,
    );
    return records
      .map(toStoredMetadataOnly)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  public async listBucketObjectsMetadataAsync(): Promise<S3BucketObjectMetadata[]> {
    const records = await this.dataStore.getAll<S3BucketObjectRecord>(
      STORE_NAMES.S3_BUCKET_OBJECTS,
    );
    return records
      .map(toS3MetadataOnly)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  public async testConnectionAsync(
    config: S3StorageConfig,
  ): Promise<S3ConnectionTestResult> {
    const startMs =
      typeof performance !== 'undefined' ? performance.now() : Date.now();
    const bucketName = config.bucketName.trim();
    const endpoint = config.endpoint.trim();

    if (!isS3ConfigComplete(config)) {
      return {
        ok: false,
        latencyMs: 0,
        bucketName,
        endpoint,
        mode: 'simulated',
        errorCode: 'S3_NOT_CONFIGURED',
        messageKey: 'admin.settings.storage.error.S3_NOT_CONFIGURED',
      };
    }

    const probeKey = `_health_probe/probe-${generateUuidV4()}.txt`;
    const probeBytes = new TextEncoder().encode(`meraj-s3-probe:${this.clock.nowUtcIso()}`);

    try {
      // 1. Verify AWS4 HMAC-SHA256 signing & verification with supplied credentials
      const signer = new S3PresignedUrlService(this.clock);
      const signedProbe = await signer.createS3PresignedDownloadUrlAsync({
        config,
        storageKey: probeKey,
        contentId: 0,
        fileId: 0,
        userId: 0,
        expiresInSeconds: 60,
      });
      const verifyProbe = await signer.verifyS3PresignedUrlAsync(
        signedProbe.url,
        config,
      );
      if (!verifyProbe.ok) {
        return {
          ok: false,
          latencyMs: 0,
          bucketName,
          endpoint,
          mode: 'simulated',
          errorCode: verifyProbe.errorCode,
          messageKey: 'admin.settings.storage.error.connectionProbeFailed',
        };
      }

      // 2. Write, read back, verify integrity, and clean up probe object in IndexedDB S3 bucket
      const probeMeta: StoredFileMetadata = {
        storageKey: probeKey,
        originalFileName: 'probe.txt',
        extension: 'txt',
        mimeType: 'text/plain',
        sizeBytes: probeBytes.byteLength,
        visibility: 'private',
        category: 'document',
        uploadedById: null,
        createdAt: this.clock.nowUtcIso(),
      };
      await this.saveExistingKeyAsync(probeMeta, probeBytes, bucketName, null);
      const readBack = await this.openReadAsync(probeKey);
      if (!readBack || readBack.bytes.byteLength !== probeBytes.byteLength) {
        await this.deleteAsync(probeKey);
        return {
          ok: false,
          latencyMs: 0,
          bucketName,
          endpoint,
          mode: 'simulated',
          errorCode: 'PROBE_READBACK_MISMATCH',
          messageKey: 'admin.settings.storage.error.connectionProbeFailed',
        };
      }
      await this.deleteAsync(probeKey);

      const endMs =
        typeof performance !== 'undefined' ? performance.now() : Date.now();
      return {
        ok: true,
        latencyMs: Math.max(1, Math.round(endMs - startMs)),
        bucketName,
        endpoint,
        mode: 'simulated',
      };
    } catch {
      try {
        await this.deleteAsync(probeKey);
      } catch {
        // Ignore cleanup failure
      }
      const endMs =
        typeof performance !== 'undefined' ? performance.now() : Date.now();
      return {
        ok: false,
        latencyMs: Math.max(1, Math.round(endMs - startMs)),
        bucketName,
        endpoint,
        mode: 'simulated',
        errorCode: 'PROBE_EXCEPTION',
        messageKey: 'admin.settings.storage.error.connectionProbeFailed',
      };
    }
  }
}
