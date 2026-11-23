import type { IViewEventRepository } from '../../core/abstractions/viewTracker';
import type { ViewEvent } from '../../core/domain/analytics';
import type { IndexedDbDataStore } from './IndexedDbDataStore';
import { STORE_NAMES } from './migrations';

export class IndexedDbViewEventRepository implements IViewEventRepository {
  private readonly dataStore: IndexedDbDataStore;

  constructor(dataStore: IndexedDbDataStore) {
    this.dataStore = dataStore;
  }

  public async createViewEvent(event: Omit<ViewEvent, 'id'>): Promise<ViewEvent> {
    const id = await this.dataStore.addRecordWithAutoId(STORE_NAMES.VIEW_EVENTS, event);
    return { ...event, id };
  }

  public async getViewEventsByContentId(contentId: number): Promise<ViewEvent[]> {
    const events = await this.dataStore.getAllByIndex<ViewEvent>(
      STORE_NAMES.VIEW_EVENTS,
      'by_contentId',
      contentId,
    );
    return events.sort((a, b) => a.occurredAt.localeCompare(b.occurredAt) || a.id - b.id);
  }

  public async getAllViewEvents(): Promise<ViewEvent[]> {
    return this.dataStore.getAll<ViewEvent>(STORE_NAMES.VIEW_EVENTS);
  }
}
