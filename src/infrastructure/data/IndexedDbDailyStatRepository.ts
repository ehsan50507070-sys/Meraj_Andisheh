import type { IDailyStatRepository } from '../../core/abstractions/dailyStatRepository';
import type { DailyStatRecord } from '../../core/domain/analytics';
import { IndexedDbDataStore } from './IndexedDbDataStore';
import { STORE_NAMES } from './migrations';

export class IndexedDbDailyStatRepository implements IDailyStatRepository {
  private readonly dataStore: IndexedDbDataStore;

  constructor(dataStore: IndexedDbDataStore) {
    this.dataStore = dataStore;
  }

  public async getAllDailyStats(): Promise<DailyStatRecord[]> {
    return this.dataStore.getAll<DailyStatRecord>(STORE_NAMES.DAILY_STATS);
  }

  public async getDailyStatsByDate(dateKey: string): Promise<DailyStatRecord[]> {
    return this.dataStore.getAllByIndex<DailyStatRecord>(
      STORE_NAMES.DAILY_STATS,
      'date',
      dateKey,
    );
  }

  public async upsertDailyStat(record: DailyStatRecord): Promise<void> {
    await this.dataStore.putRecord<DailyStatRecord>(STORE_NAMES.DAILY_STATS, record);
  }

  public async deleteDailyStat(
    date: string,
    ageGroupId: number,
    rootTopicId: number,
  ): Promise<void> {
    await this.dataStore.deleteByKey(STORE_NAMES.DAILY_STATS, [
      date,
      ageGroupId,
      rootTopicId,
    ]);
  }
}
