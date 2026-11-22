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

export interface IDataStore {
  getMetadata(): DataStoreMetadata;
  connect(): Promise<void>;
  getMeta(key: string): Promise<MetaRecord | null>;
  setMeta(record: MetaRecord): Promise<void>;
  deleteMeta(key: string): Promise<void>;
  verifyConnection(): Promise<DataStoreHealthProbe>;
}
