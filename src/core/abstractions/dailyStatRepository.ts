import type { DailyStatRecord } from '../domain/analytics';

export interface IDailyStatRepository {
  getAllDailyStats(): Promise<DailyStatRecord[]>;
  getDailyStatsByDate(dateKey: string): Promise<DailyStatRecord[]>;
  upsertDailyStat(record: DailyStatRecord): Promise<void>;
  deleteDailyStat(date: string, ageGroupId: number, rootTopicId: number): Promise<void>;
}
