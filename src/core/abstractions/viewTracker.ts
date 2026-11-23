import type { ViewEvent } from '../domain/analytics';

export interface TrackViewInput {
  contentId: number;
  userId: number | null;
  visitorId: string;
  userAgent: string;
  ageGroupId: number | null;
  primaryTopicId: number | null;
}

export interface TrackViewResult {
  event: ViewEvent | null;
  isCounted: boolean;
  skippedAsBot: boolean;
}

export interface IViewEventRepository {
  createViewEvent(event: Omit<ViewEvent, 'id'>): Promise<ViewEvent>;
  getViewEventsByContentId(contentId: number): Promise<ViewEvent[]>;
  getAllViewEvents(): Promise<ViewEvent[]>;
}

export interface IViewTracker {
  trackViewAsync(input: TrackViewInput): Promise<TrackViewResult>;
}
