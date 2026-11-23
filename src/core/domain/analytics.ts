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

export enum DownloadKind {
  File = 1,
  Story = 2,
}

export interface DownloadEvent {
  id: number;
  kind: DownloadKind;
  contentId: number;
  fileId: number | null;
  userId: number | null;
  ageGroupId: number | null;
  /** ISO 8601 UTC timestamp */
  occurredAt: string;
}

export interface DownloadTokenPayload {
  userId: number;
  contentId: number;
  fileId: number;
  issuedAtEpochMs: number;
  expiresAtEpochMs: number;
}
