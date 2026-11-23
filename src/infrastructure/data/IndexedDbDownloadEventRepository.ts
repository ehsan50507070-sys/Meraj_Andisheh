import type { IDownloadEventRepository } from '../../core/abstractions/downloadRepository';
import type { DownloadEvent } from '../../core/domain/analytics';
import { IndexedDbDataStore } from './IndexedDbDataStore';
import { STORE_NAMES } from './migrations';

export class IndexedDbDownloadEventRepository implements IDownloadEventRepository {
  private readonly dataStore: IndexedDbDataStore;

  constructor(dataStore: IndexedDbDataStore) {
    this.dataStore = dataStore;
  }

  public async createDownloadEvent(event: Omit<DownloadEvent, 'id'>): Promise<DownloadEvent> {
    const id = await this.dataStore.addRecordWithAutoId(STORE_NAMES.DOWNLOAD_EVENTS, event);
    return { ...event, id };
  }

  public async getDownloadEventsByContentId(contentId: number): Promise<DownloadEvent[]> {
    return this.dataStore.getAllByIndex<DownloadEvent>(
      STORE_NAMES.DOWNLOAD_EVENTS,
      'by_contentId',
      contentId,
    );
  }

  public async getDownloadEventsByUserId(userId: number): Promise<DownloadEvent[]> {
    return this.dataStore.getAllByIndex<DownloadEvent>(
      STORE_NAMES.DOWNLOAD_EVENTS,
      'by_userId',
      userId,
    );
  }

  public async getAllDownloadEvents(): Promise<DownloadEvent[]> {
    return this.dataStore.getAll<DownloadEvent>(STORE_NAMES.DOWNLOAD_EVENTS);
  }
}
