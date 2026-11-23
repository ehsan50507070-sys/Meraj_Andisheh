import type { DownloadEvent } from '../domain/analytics';

export interface IDownloadEventRepository {
  createDownloadEvent(event: Omit<DownloadEvent, 'id'>): Promise<DownloadEvent>;
  getDownloadEventsByContentId(contentId: number): Promise<DownloadEvent[]>;
  getDownloadEventsByUserId(userId: number): Promise<DownloadEvent[]>;
  getAllDownloadEvents(): Promise<DownloadEvent[]>;
}
