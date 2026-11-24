import type { IAnnouncementRepository } from '../../core/abstractions/announcementRepository';
import type { AnnouncementItem } from '../../core/domain/layout';
import type { IndexedDbDataStore } from './IndexedDbDataStore';
import { STORE_NAMES } from './migrations';

export class IndexedDbAnnouncementRepository implements IAnnouncementRepository {
  private readonly dataStore: IndexedDbDataStore;

  constructor(dataStore: IndexedDbDataStore) {
    this.dataStore = dataStore;
  }

  public async getAllAnnouncements(): Promise<AnnouncementItem[]> {
    return this.dataStore.getAll<AnnouncementItem>(STORE_NAMES.ANNOUNCEMENTS);
  }

  public async getAnnouncementById(id: number): Promise<AnnouncementItem | null> {
    return this.dataStore.getByKey<AnnouncementItem>(STORE_NAMES.ANNOUNCEMENTS, id);
  }

  public async createAnnouncement(
    item: Omit<AnnouncementItem, 'id'>,
  ): Promise<AnnouncementItem> {
    const id = await this.dataStore.addRecordWithAutoId(
      STORE_NAMES.ANNOUNCEMENTS,
      item,
    );
    return { ...item, id };
  }

  public async updateAnnouncement(
    item: AnnouncementItem,
  ): Promise<AnnouncementItem> {
    await this.dataStore.putRecord(STORE_NAMES.ANNOUNCEMENTS, item);
    return { ...item };
  }

  public async deleteAnnouncement(id: number): Promise<void> {
    await this.dataStore.deleteByKey(STORE_NAMES.ANNOUNCEMENTS, id);
  }
}
