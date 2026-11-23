export enum CommentStatus {
  Pending = 1,
  Published = 2,
  Hidden = 3,
}

export type CommentModerationReason = 'child_author' | 'blocked_word';

export interface CommentItem {
  id: number;
  contentId: number;
  userId: number;
  /** Plain text only, max length governed by SiteSetting['Comments.MaxLength'] (default 1000) */
  body: string;
  status: CommentStatus;
  /** Snapshot of the author's profile ageGroupId captured at submission time */
  authorAgeGroupId: number | null;
  /** Automatic moderation reason when initially routed to Pending */
  moderationReason?: CommentModerationReason | null;
  /** ISO 8601 UTC timestamp */
  createdAt: string;
  moderatedById: number | null;
  moderatedAt: string | null;
}

export interface CommentReport {
  id: number;
  commentId: number;
  userId: number;
  /** Plain text reason, max 300 characters */
  reason: string;
  /** ISO 8601 UTC timestamp */
  createdAt: string;
}

export interface BlockedWord {
  id: number;
  /** Normalized with ISearchNormalizer; unique */
  word: string;
  /** ISO 8601 UTC timestamp */
  createdAt: string;
}
