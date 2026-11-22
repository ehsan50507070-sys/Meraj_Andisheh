export interface ViewEvent {
  id: number;
  contentId: number;
  userId: number | null;
  visitorId: string;
  ageGroupId: number | null;
  primaryTopicId: number | null;
  /** ISO 8601 UTC timestamp */
  occurredAt: string;
  isCounted: boolean;
}
