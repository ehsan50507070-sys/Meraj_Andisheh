import type { IContentRequestRepository } from '../../core/abstractions/contentRequestRepository';
import type { ContentRequestItem } from '../../core/domain/requests';
import type { IndexedDbDataStore } from './IndexedDbDataStore';
import { STORE_NAMES } from './migrations';

export class IndexedDbContentRequestRepository implements IContentRequestRepository {
  private readonly dataStore: IndexedDbDataStore;

  constructor(dataStore: IndexedDbDataStore) {
    this.dataStore = dataStore;
  }

  public async getContentRequestById(
    id: number,
  ): Promise<ContentRequestItem | null> {
    return this.dataStore.getByKey<ContentRequestItem>(
      STORE_NAMES.CONTENT_REQUESTS,
      id,
    );
  }

  public async getContentRequestsByUserId(
    userId: number,
  ): Promise<ContentRequestItem[]> {
    return this.dataStore.getAllByIndex<ContentRequestItem>(
      STORE_NAMES.CONTENT_REQUESTS,
      'by_userId',
      userId,
    );
  }

  public async getAllContentRequests(): Promise<ContentRequestItem[]> {
    return this.dataStore.getAll<ContentRequestItem>(
      STORE_NAMES.CONTENT_REQUESTS,
    );
  }

  public async createContentRequest(
    request: Omit<ContentRequestItem, 'id'>,
  ): Promise<ContentRequestItem> {
    const id = await this.dataStore.addRecordWithAutoId(
      STORE_NAMES.CONTENT_REQUESTS,
      request,
    );
    return { ...request, id };
  }

  public async updateContentRequest(
    request: ContentRequestItem,
  ): Promise<void> {
    await this.dataStore.putRecord(STORE_NAMES.CONTENT_REQUESTS, request);
  }

  public async deleteContentRequest(id: number): Promise<void> {
    await this.dataStore.deleteByKey(STORE_NAMES.CONTENT_REQUESTS, id);
  }
}
