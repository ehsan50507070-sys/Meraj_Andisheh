import type { ContentBookmark, ContentLike } from '../domain/interactions';

export interface IInteractionRepository {
  getLike(userId: number, contentId: number): Promise<ContentLike | null>;
  createLike(like: ContentLike): Promise<boolean>;
  deleteLike(userId: number, contentId: number): Promise<boolean>;
  getLikesByUserId(userId: number): Promise<ContentLike[]>;
  getLikesByContentId(contentId: number): Promise<ContentLike[]>;
  countLikesByContentId(contentId: number): Promise<number>;

  getBookmark(userId: number, contentId: number): Promise<ContentBookmark | null>;
  createBookmark(bookmark: ContentBookmark): Promise<boolean>;
  deleteBookmark(userId: number, contentId: number): Promise<boolean>;
  getBookmarksByUserId(userId: number): Promise<ContentBookmark[]>;
  countBookmarksByUserId(userId: number): Promise<number>;
}

export interface IAccountCleanupRepository {
  deleteSessionsByUserId(userId: number): Promise<number>;
  deleteAuthTokensByUserId(userId: number): Promise<number>;
  deleteOtpCodesByPhoneNumber(phoneNumber: string): Promise<number>;
  anonymizeViewEventsByUserId(userId: number): Promise<number>;
  anonymizeDownloadEventsByUserId(userId: number): Promise<number>;
  anonymizeOptionalCommentsByUserId(userId: number, deletedDisplayName: string): Promise<number>;
  deleteOptionalTopicAffinitiesByUserId(userId: number): Promise<number>;
}
