import type { AnnouncementItem } from '../domain/layout';

export interface IAnnouncementRepository {
  getAllAnnouncements(): Promise<AnnouncementItem[]>;
  getAnnouncementById(id: number): Promise<AnnouncementItem | null>;
  createAnnouncement(
    item: Omit<AnnouncementItem, 'id'>,
  ): Promise<AnnouncementItem>;
  updateAnnouncement(item: AnnouncementItem): Promise<AnnouncementItem>;
  deleteAnnouncement(id: number): Promise<void>;
}
