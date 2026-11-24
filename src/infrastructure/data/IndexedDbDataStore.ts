import type {
  DataStoreHealthProbe,
  DataStoreMetadata,
  IDataStore,
  MetaRecord,
} from '../../core/abstractions/IDataStore';
import { envConfig } from '../config/envConfig';
import { applyMigrations } from './migrations';

export class IndexedDbDataStore implements IDataStore {
  private readonly databaseName: string;
  private readonly databaseVersion: number;
  private readonly metaStoreName: string;
  private dbInstance: IDBDatabase | null = null;
  private connectPromise: Promise<void> | null = null;

  constructor(
    databaseName: string = envConfig.databaseName,
    databaseVersion: number = envConfig.databaseVersion,
    metaStoreName: string = envConfig.metaStoreName,
  ) {
    this.databaseName = databaseName;
    this.databaseVersion = databaseVersion;
    this.metaStoreName = metaStoreName;
  }

  public getMetadata(): DataStoreMetadata {
    return {
      databaseName: this.databaseName,
      databaseVersion: this.databaseVersion,
      metaStoreName: this.metaStoreName,
    };
  }

  private ensureIndexedDbAvailable(): IDBFactory {
    if (typeof window === 'undefined' || !window.indexedDB) {
      throw new Error('INDEXEDDB_UNAVAILABLE');
    }
    return window.indexedDB;
  }

  public async connect(): Promise<void> {
    if (this.dbInstance) {
      return;
    }
    if (this.connectPromise) {
      return this.connectPromise;
    }

    const idb = this.ensureIndexedDbAvailable();

    this.connectPromise = new Promise<void>((resolve, reject) => {
      const request = idb.open(this.databaseName, this.databaseVersion);

      request.onupgradeneeded = (event) => {
        const db = request.result;
        const oldVersion = event.oldVersion ?? 0;
        const newVersion = event.newVersion ?? this.databaseVersion;
        applyMigrations(db, oldVersion, newVersion, request.transaction);
      };

      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => {
          db.close();
          this.dbInstance = null;
        };
        this.dbInstance = db;
        this.connectPromise = null;
        resolve();
      };

      request.onerror = () => {
        this.connectPromise = null;
        reject(request.error ?? new Error('INDEXEDDB_OPEN_FAILED'));
      };

      request.onblocked = () => {
        this.connectPromise = null;
        reject(new Error('INDEXEDDB_OPEN_BLOCKED'));
      };
    });

    return this.connectPromise;
  }

  private async getDatabase(): Promise<IDBDatabase> {
    if (!this.dbInstance) {
      await this.connect();
    }
    if (!this.dbInstance) {
      throw new Error('INDEXEDDB_NOT_INITIALIZED');
    }
    return this.dbInstance;
  }

  public close(): void {
    if (this.dbInstance) {
      this.dbInstance.close();
      this.dbInstance = null;
    }
    this.connectPromise = null;
  }

  public async resetDatabase(): Promise<void> {
    const idb = this.ensureIndexedDbAvailable();
    this.close();

    await new Promise<void>((resolve, reject) => {
      const request = idb.deleteDatabase(this.databaseName);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error ?? new Error('INDEXEDDB_DELETE_DB_FAILED'));
      request.onblocked = () => reject(new Error('INDEXEDDB_DELETE_DB_BLOCKED'));
    });

    await this.connect();
  }

  public async getObjectStoreNames(): Promise<string[]> {
    const db = await this.getDatabase();
    return Array.from(db.objectStoreNames);
  }

  public async getAll<T>(storeName: string): Promise<T[]> {
    const db = await this.getDatabase();

    return new Promise<T[]>((resolve, reject) => {
      const tx = db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const request = store.getAll();

      request.onsuccess = () => {
        resolve((request.result as T[]) ?? []);
      };
      request.onerror = () => reject(request.error ?? new Error('INDEXEDDB_READ_ALL_FAILED'));
    });
  }

  public async getByKey<T>(storeName: string, key: IDBValidKey): Promise<T | null> {
    const db = await this.getDatabase();

    return new Promise<T | null>((resolve, reject) => {
      const tx = db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const request = store.get(key);

      request.onsuccess = () => {
        resolve((request.result as T | undefined) ?? null);
      };
      request.onerror = () => reject(request.error ?? new Error('INDEXEDDB_READ_KEY_FAILED'));
    });
  }

  public async putRecord<T>(storeName: string, record: T): Promise<void> {
    const db = await this.getDatabase();

    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      store.put(record);

      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('INDEXEDDB_PUT_FAILED'));
      tx.onabort = () => reject(tx.error ?? new Error('INDEXEDDB_TX_ABORTED'));
    });
  }

  /**
   * Atomically updates matching existing records and upserts a target record in a single readwrite transaction.
   */
  public async updateAllAndPut<T>(
    storeName: string,
    transformExisting: (record: T) => T | null,
    upsertRecord: T,
  ): Promise<void> {
    const db = await this.getDatabase();

    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      const getAllReq = store.getAll();

      getAllReq.onsuccess = () => {
        const rows = (getAllReq.result as T[]) ?? [];
        for (const row of rows) {
          const modified = transformExisting(row);
          if (modified !== null) {
            store.put(modified);
          }
        }
        store.put(upsertRecord);
      };

      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('INDEXEDDB_ATOMIC_UPSERT_FAILED'));
      tx.onabort = () => reject(tx.error ?? new Error('INDEXEDDB_TX_ABORTED'));
    });
  }

  /**
   * Inserts a record atomically only when the primary key does not already exist.
   * Returns true if inserted, false if already present.
   */
  public async putIfAbsent<T>(
    storeName: string,
    key: IDBValidKey,
    record: T,
  ): Promise<boolean> {
    const db = await this.getDatabase();

    return new Promise<boolean>((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      const getReq = store.get(key);
      let inserted = false;

      getReq.onsuccess = () => {
        if (getReq.result === undefined) {
          store.add(record);
          inserted = true;
        }
      };

      tx.oncomplete = () => resolve(inserted);
      tx.onerror = () => reject(tx.error ?? new Error('INDEXEDDB_PUT_IF_ABSENT_FAILED'));
      tx.onabort = () => reject(tx.error ?? new Error('INDEXEDDB_TX_ABORTED'));
    });
  }

  public async count(storeName: string): Promise<number> {
    const db = await this.getDatabase();

    return new Promise<number>((resolve, reject) => {
      const tx = db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const request = store.count();

      request.onsuccess = () => resolve(request.result ?? 0);
      request.onerror = () => reject(request.error ?? new Error('INDEXEDDB_COUNT_FAILED'));
    });
  }

  public async getByIndex<T>(
    storeName: string,
    indexName: string,
    key: IDBValidKey,
  ): Promise<T | null> {
    const db = await this.getDatabase();

    return new Promise<T | null>((resolve, reject) => {
      const tx = db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const index = store.index(indexName);
      const request = index.get(key);

      request.onsuccess = () => resolve((request.result as T | undefined) ?? null);
      request.onerror = () => reject(request.error ?? new Error('INDEXEDDB_INDEX_GET_FAILED'));
    });
  }

  public async getAllByIndex<T>(
    storeName: string,
    indexName: string,
    key: IDBValidKey,
  ): Promise<T[]> {
    const db = await this.getDatabase();

    return new Promise<T[]>((resolve, reject) => {
      const tx = db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const index = store.index(indexName);
      const request = index.getAll(key);

      request.onsuccess = () => resolve((request.result as T[]) ?? []);
      request.onerror = () => reject(request.error ?? new Error('INDEXEDDB_INDEX_GETALL_FAILED'));
    });
  }

  public async addRecordWithAutoId<T extends object>(
    storeName: string,
    record: T,
  ): Promise<number> {
    const db = await this.getDatabase();

    return new Promise<number>((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      let assignedId = 0;

      if (store.autoIncrement) {
        const req = store.add(record);
        req.onsuccess = () => {
          assignedId = Number(req.result);
        };
      } else {
        const cursorReq = store.openCursor(null, 'prev');
        cursorReq.onsuccess = () => {
          const cursor = cursorReq.result;
          const maxId = cursor ? Number(cursor.key) : 0;
          assignedId = Number.isFinite(maxId) ? maxId + 1 : 1;
          store.add({ ...record, id: assignedId });
        };
      }

      tx.oncomplete = () => resolve(assignedId);
      tx.onerror = () => reject(tx.error ?? new Error('INDEXEDDB_ADD_FAILED'));
      tx.onabort = () => reject(tx.error ?? new Error('INDEXEDDB_TX_ABORTED'));
    });
  }

  public async deleteByKey(storeName: string, key: IDBValidKey): Promise<void> {
    const db = await this.getDatabase();

    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      store.delete(key);

      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('INDEXEDDB_DELETE_KEY_FAILED'));
      tx.onabort = () => reject(tx.error ?? new Error('INDEXEDDB_TX_ABORTED'));
    });
  }

  public async clearStore(storeName: string): Promise<void> {
    const db = await this.getDatabase();

    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      store.clear();

      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('INDEXEDDB_CLEAR_STORE_FAILED'));
      tx.onabort = () => reject(tx.error ?? new Error('INDEXEDDB_TX_ABORTED'));
    });
  }

  public async setMeta(record: MetaRecord): Promise<void> {
    await this.putRecord(this.metaStoreName, record);
  }

  public async getMeta(key: string): Promise<MetaRecord | null> {
    return this.getByKey<MetaRecord>(this.metaStoreName, key);
  }

  public async deleteMeta(key: string): Promise<void> {
    const db = await this.getDatabase();

    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(this.metaStoreName, 'readwrite');
      const store = tx.objectStore(this.metaStoreName);
      store.delete(key);

      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('INDEXEDDB_DELETE_FAILED'));
      tx.onabort = () => reject(tx.error ?? new Error('INDEXEDDB_TX_ABORTED'));
    });
  }

  public async verifyConnection(): Promise<DataStoreHealthProbe> {
    const startTime = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const metadata = this.getMetadata();

    try {
      await this.connect();

      const probeKey = 'health_probe';
      const probeValue = `ok_${Date.now()}`;
      const record: MetaRecord = {
        key: probeKey,
        value: probeValue,
        updatedAtUtc: new Date().toISOString(),
      };

      await this.setMeta(record);
      const readBack = await this.getMeta(probeKey);
      const readWriteVerified = readBack !== null && readBack.value === probeValue;

      const endTime = typeof performance !== 'undefined' ? performance.now() : Date.now();
      const latencyMs = Math.max(1, Math.round(endTime - startTime));

      return {
        connected: true,
        readWriteVerified,
        latencyMs,
        metadata,
      };
    } catch (error) {
      const endTime = typeof performance !== 'undefined' ? performance.now() : Date.now();
      const latencyMs = Math.max(1, Math.round(endTime - startTime));
      const errorMessage = error instanceof Error ? error.message : String(error);

      return {
        connected: false,
        readWriteVerified: false,
        latencyMs,
        metadata,
        errorMessage,
      };
    }
  }
}
