import type { IUserTopicAffinityRepository } from '../../core/abstractions/personalizationService';
import type { UserTopicAffinity } from '../../core/domain/personalization';
import { IndexedDbDataStore } from './IndexedDbDataStore';
import { STORE_NAMES } from './migrations';

export class IndexedDbUserTopicAffinityRepository implements IUserTopicAffinityRepository {
  private readonly dataStore: IndexedDbDataStore;

  constructor(dataStore: IndexedDbDataStore) {
    this.dataStore = dataStore;
  }

  public async getAffinity(
    userId: number,
    rootTopicId: number,
  ): Promise<UserTopicAffinity | null> {
    return this.dataStore.getByKey<UserTopicAffinity>(
      STORE_NAMES.USER_TOPIC_AFFINITIES,
      [userId, rootTopicId],
    );
  }

  public async getAffinitiesByUserId(userId: number): Promise<UserTopicAffinity[]> {
    return this.dataStore.getAllByIndex<UserTopicAffinity>(
      STORE_NAMES.USER_TOPIC_AFFINITIES,
      'by_userId',
      userId,
    );
  }

  public async upsertAffinity(affinity: UserTopicAffinity): Promise<void> {
    await this.dataStore.putRecord<UserTopicAffinity>(
      STORE_NAMES.USER_TOPIC_AFFINITIES,
      affinity,
    );
  }

  public async deleteAffinitiesByUserId(userId: number): Promise<number> {
    const records = await this.getAffinitiesByUserId(userId);
    for (const record of records) {
      await this.dataStore.deleteByKey(STORE_NAMES.USER_TOPIC_AFFINITIES, [
        record.userId,
        record.rootTopicId,
      ]);
    }
    return records.length;
  }
}
