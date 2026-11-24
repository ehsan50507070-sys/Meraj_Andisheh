import type { IClock } from '../../core/abstractions/IClock';
import type {
  IBackupLogRepository,
  IBackupStorage,
} from '../../core/abstractions/backupService';
import type { BackupLog } from '../../core/domain/backup';
import type { IndexedDbDataStore } from './IndexedDbDataStore';
import { STORE_NAMES } from './migrations';

interface StoredBackupArchiveRecord {
  filePath: string;
  payloadText: string;
  sizeBytes: number;
  createdAt: string;
}

export class IndexedDbBackupRepository
  implements IBackupLogRepository, IBackupStorage
{
  private readonly dataStore: IndexedDbDataStore;
  private readonly clock: IClock;

  constructor(dataStore: IndexedDbDataStore, clock: IClock) {
    this.dataStore = dataStore;
    this.clock = clock;
  }

  public async createBackupLogAsync(
    entry: Omit<BackupLog, 'id'>,
  ): Promise<BackupLog> {
    const record: Omit<BackupLog, 'id'> = { ...entry };
    const id = await this.dataStore.addRecordWithAutoId(
      STORE_NAMES.BACKUP_LOGS,
      record,
    );
    return {
      ...record,
      id,
    };
  }

  public async updateBackupLogAsync(entry: BackupLog): Promise<void> {
    await this.dataStore.putRecord(STORE_NAMES.BACKUP_LOGS, { ...entry });
  }

  public async getBackupLogByIdAsync(id: number): Promise<BackupLog | null> {
    return this.dataStore.getByKey<BackupLog>(STORE_NAMES.BACKUP_LOGS, id);
  }

  public async listBackupLogsAsync(): Promise<BackupLog[]> {
    return this.dataStore.getAll<BackupLog>(STORE_NAMES.BACKUP_LOGS);
  }

  public async saveArchiveAsync(
    filePath: string,
    payloadText: string,
  ): Promise<{ sizeBytes: number }> {
    const sizeBytes = new TextEncoder().encode(payloadText).byteLength;
    const record: StoredBackupArchiveRecord = {
      filePath,
      payloadText,
      sizeBytes,
      createdAt: this.clock.nowUtcIso(),
    };
    await this.dataStore.putRecord(STORE_NAMES.BACKUP_ARCHIVES, record);
    return { sizeBytes };
  }

  public async readArchiveAsync(filePath: string): Promise<string | null> {
    const record = await this.dataStore.getByKey<StoredBackupArchiveRecord>(
      STORE_NAMES.BACKUP_ARCHIVES,
      filePath,
    );
    return record ? record.payloadText : null;
  }

  public async deleteArchiveAsync(filePath: string): Promise<void> {
    await this.dataStore.deleteByKey(STORE_NAMES.BACKUP_ARCHIVES, filePath);
  }

  public async listArchivePathsAsync(): Promise<string[]> {
    const records = await this.dataStore.getAll<StoredBackupArchiveRecord>(
      STORE_NAMES.BACKUP_ARCHIVES,
    );
    return [...records]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((item) => item.filePath);
  }
}
