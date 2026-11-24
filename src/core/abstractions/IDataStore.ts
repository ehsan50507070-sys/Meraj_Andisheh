export interface MetaRecord {
  key: string;
  value: string;
  updatedAtUtc: string;
}

export interface DataStoreMetadata {
  databaseName: string;
  databaseVersion: number;
  metaStoreName: string;
}

export interface DataStoreHealthProbe {
  connected: boolean;
  readWriteVerified: boolean;
  latencyMs: number;
  metadata: DataStoreMetadata;
  errorMessage?: string;
}

export type DataStoreKey = string | number | (string | number)[];

export interface IDataStore {
  getMetadata(): DataStoreMetadata;
  connect(): Promise<void>;
  getMeta(key: string): Promise<MetaRecord | null>;
  setMeta(record: MetaRecord): Promise<void>;
  deleteMeta(key: string): Promise<void>;
  getAll<T>(storeName: string): Promise<T[]>;
  putRecord<T>(storeName: string, record: T): Promise<void>;
  deleteByKey(storeName: string, key: DataStoreKey): Promise<void>;
  verifyConnection(): Promise<DataStoreHealthProbe>;
}
