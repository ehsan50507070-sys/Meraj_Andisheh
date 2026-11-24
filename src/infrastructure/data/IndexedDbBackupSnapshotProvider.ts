import type {
  ExportedDatabaseSnapshot,
  IBackupSnapshotProvider,
} from '../../core/abstractions/backupService';
import type {
  BackupRestoreReport,
  BackupSnapshotFile,
  BackupStoredFileEntry,
} from '../../core/domain/backup';
import type { StoredFileMetadata } from '../../core/domain/storage';
import { RESTORE_SANDBOX_DB_NAME } from '../../core/services/backupService';
import { IndexedDbDataStore } from './IndexedDbDataStore';
import { STORE_NAMES } from './migrations';

interface StoredFileRecord extends StoredFileMetadata {
  data: ArrayBuffer;
}

const EXCLUDED_SNAPSHOT_STORES = new Set<string>([
  STORE_NAMES.STORED_FILES,
  STORE_NAMES.S3_BUCKET_OBJECTS,
  STORE_NAMES.BACKUP_LOGS,
  STORE_NAMES.BACKUP_ARCHIVES,
]);

function uint8ArrayToBase64(bytes: Uint8Array): string {
  const chunkSize = 0x8000;
  const parts: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const slice = bytes.subarray(offset, offset + chunkSize);
    let chunkStr = '';
    for (let i = 0; i < slice.length; i += 1) {
      chunkStr += String.fromCharCode(slice[i]);
    }
    parts.push(chunkStr);
  }
  return btoa(parts.join(''));
}

function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function normalizeStoredFileBytes(rawData: unknown): Uint8Array {
  if (rawData instanceof ArrayBuffer) {
    return new Uint8Array(rawData);
  }
  if (rawData instanceof Uint8Array) {
    return rawData;
  }
  if (ArrayBuffer.isView(rawData)) {
    return new Uint8Array(rawData.buffer, rawData.byteOffset, rawData.byteLength);
  }
  return new Uint8Array(0);
}

async function deleteIndexedDatabaseAsync(databaseName: string): Promise<void> {
  if (typeof indexedDB === 'undefined') {
    return;
  }
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase(databaseName);
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();
    req.onblocked = () => resolve();
  });
}

export class IndexedDbBackupSnapshotProvider implements IBackupSnapshotProvider {
  private readonly dataStore: IndexedDbDataStore;

  constructor(dataStore: IndexedDbDataStore) {
    this.dataStore = dataStore;
  }

  public async exportFullSnapshotAsync(): Promise<ExportedDatabaseSnapshot> {
    const meta = this.dataStore.getMetadata();
    const storeNames = await this.dataStore.getObjectStoreNames();
    const tables: Record<string, unknown[]> = {};

    for (const storeName of storeNames.sort((a, b) => a.localeCompare(b))) {
      if (EXCLUDED_SNAPSHOT_STORES.has(storeName)) {
        continue;
      }
      tables[storeName] = await this.dataStore.getAll<unknown>(storeName);
    }

    const storedFiles: BackupStoredFileEntry[] = [];
    if (storeNames.includes(STORE_NAMES.STORED_FILES)) {
      const fileRecords = await this.dataStore.getAll<StoredFileRecord>(
        STORE_NAMES.STORED_FILES,
      );
      for (const rec of fileRecords.sort((a, b) =>
        a.storageKey.localeCompare(b.storageKey),
      )) {
        const bytes = normalizeStoredFileBytes(rec.data);
        const metadata: StoredFileMetadata = {
          storageKey: rec.storageKey,
          originalFileName: rec.originalFileName,
          extension: rec.extension,
          mimeType: rec.mimeType,
          sizeBytes: rec.sizeBytes,
          visibility: rec.visibility,
          category: rec.category,
          uploadedById: rec.uploadedById ?? null,
          createdAt: rec.createdAt,
        };
        storedFiles.push({
          metadata,
          base64Data: uint8ArrayToBase64(bytes),
        });
      }
    }

    return {
      databaseVersion: meta.databaseVersion,
      tables,
      storedFiles,
    };
  }

  private async applySnapshotAndVerifyAsync(
    targetStore: IndexedDbDataStore,
    snapshot: BackupSnapshotFile,
    targetDatabaseName: string,
  ): Promise<BackupRestoreReport> {
    const startMs = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const errors: string[] = [];
    const availableStores = new Set(await targetStore.getObjectStoreNames());
    let restoredTablesCount = 0;
    let restoredRecordsCount = 0;

    for (const storeName of Object.keys(snapshot.tables)) {
      if (EXCLUDED_SNAPSHOT_STORES.has(storeName) || !availableStores.has(storeName)) {
        continue;
      }
      await targetStore.clearStore(storeName);
      const rows = snapshot.tables[storeName] ?? [];
      for (const row of rows) {
        await targetStore.putRecord(storeName, row);
        restoredRecordsCount += 1;
      }
      restoredTablesCount += 1;
    }

    let restoredFilesCount = 0;
    let verifiedFilesOk = true;
    if (availableStores.has(STORE_NAMES.STORED_FILES)) {
      await targetStore.clearStore(STORE_NAMES.STORED_FILES);
      for (const fileEntry of snapshot.storedFiles) {
        const bytes = base64ToUint8Array(fileEntry.base64Data);
        const copy = new Uint8Array(bytes.byteLength);
        copy.set(bytes);
        const record: StoredFileRecord = {
          ...fileEntry.metadata,
          data: copy.buffer,
        };
        await targetStore.putRecord(STORE_NAMES.STORED_FILES, record);
        restoredFilesCount += 1;
      }

      for (const fileEntry of snapshot.storedFiles) {
        const readBack = await targetStore.getByKey<StoredFileRecord>(
          STORE_NAMES.STORED_FILES,
          fileEntry.metadata.storageKey,
        );
        if (!readBack) {
          verifiedFilesOk = false;
          errors.push(`MISSING_RESTORED_FILE:${fileEntry.metadata.storageKey}`);
          break;
        }
        const readBytes = normalizeStoredFileBytes(readBack.data);
        if (readBytes.byteLength !== fileEntry.metadata.sizeBytes) {
          verifiedFilesOk = false;
          errors.push(`SIZE_MISMATCH:${fileEntry.metadata.storageKey}`);
          break;
        }
      }
    }

    const [verifiedContentsCount, verifiedUsersCount, verifiedTopicsCount] =
      await Promise.all([
        availableStores.has(STORE_NAMES.CONTENT_ITEMS)
          ? targetStore.count(STORE_NAMES.CONTENT_ITEMS)
          : Promise.resolve(0),
        availableStores.has(STORE_NAMES.USERS)
          ? targetStore.count(STORE_NAMES.USERS)
          : Promise.resolve(0),
        availableStores.has(STORE_NAMES.TOPICS)
          ? targetStore.count(STORE_NAMES.TOPICS)
          : Promise.resolve(0),
      ]);

    const endMs = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const durationMs = Math.max(0, Math.round(endMs - startMs));

    return {
      ok: verifiedFilesOk && errors.length === 0,
      targetDatabaseName,
      restoredTablesCount,
      restoredRecordsCount,
      restoredFilesCount,
      verifiedContentsCount,
      verifiedUsersCount,
      verifiedTopicsCount,
      durationMs,
      errors,
    };
  }

  public async restoreIntoSandboxDatabaseAsync(
    snapshot: BackupSnapshotFile,
  ): Promise<BackupRestoreReport> {
    const meta = this.dataStore.getMetadata();
    const sandboxStore = new IndexedDbDataStore(
      RESTORE_SANDBOX_DB_NAME,
      meta.databaseVersion,
      meta.metaStoreName,
    );

    try {
      await sandboxStore.resetDatabase();
      return await this.applySnapshotAndVerifyAsync(
        sandboxStore,
        snapshot,
        RESTORE_SANDBOX_DB_NAME,
      );
    } finally {
      sandboxStore.close();
      await deleteIndexedDatabaseAsync(RESTORE_SANDBOX_DB_NAME);
    }
  }

  public async restoreIntoPrimaryDatabaseAsync(
    snapshot: BackupSnapshotFile,
  ): Promise<BackupRestoreReport> {
    const meta = this.dataStore.getMetadata();
    return this.applySnapshotAndVerifyAsync(
      this.dataStore,
      snapshot,
      meta.databaseName,
    );
  }
}
