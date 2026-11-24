export interface IAnnouncementDismissStorage {
  getDismissedIds(): number[];
  dismissAnnouncement(id: number): void;
  isDismissed(id: number): boolean;
  clearDismissed(): void;
}
