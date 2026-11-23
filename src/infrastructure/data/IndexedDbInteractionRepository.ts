import type { IInteractionRepository } from '../../core/abstractions/interactionRepository';
import type { ContentBookmark, ContentLike } from '../../core/domain/interactions';
import { IndexedDbDataStore } from './IndexedDbDataStore';
import { STORE_NAMES } from './migrations';

export class IndexedDbInteractionRepository implements IInteractionRepository {
  private readonly dataStore: IndexedDbDataStore;

  constructor(dataStore: IndexedDbDataStore) {
    this.dataStore = dataStore;
  }

  public async getLike(userId: number, contentId: number): Promise<ContentLike | null> {
    return this.dataStore.getByKey<ContentLike>(STORE_NAMES.LIKES, [userId, contentId]);
  }

  public async createLike(like: ContentLike): Promise<boolean> {
    return this.dataStore.putIfAbsent<ContentLike>(
      STORE_NAMES.LIKES,
      [like.userId, like.contentId],
      like,
    );
  }

  public async deleteLike(userId: number, contentId: number): Promise<boolean> {
    const existing = await this.getLike(userId, contentId);
    if (!existing) {
      return false;
    }
    await this.dataStore.deleteByKey(STORE_NAMES.LIKES, [userId, contentId]);
    return true;
  }

  public async getLikesByUserId(userId: number): Promise<ContentLike[]> {
    return this.dataStore.getAllByIndex<ContentLike>(
      STORE_NAMES.LIKES,
      'by_userId',
      userId,
    );
  }

  public async getLikesByContentId(contentId: number): Promise<ContentLike[]> {
    return this.dataStore.getAllByIndex<ContentLike>(
      STORE_NAMES.LIKES,
      'by_contentId',
      contentId,
    );
  }

  public async countLikesByContentId(contentId: number): Promise<number> {
    const likes = await this.getLikesByContentId(contentId);
    return likes.length;
  }

  public async getBookmark(userId: number, contentId: number): Promise<ContentBookmark | null> {
    return this.dataStore.getByKey<ContentBookmark>(STORE_NAMES.BOOKMARKS, [
      userId,
      contentId,
    ]);
  }

  public async createBookmark(bookmark: ContentBookmark): Promise<boolean> {
    return this.dataStore.putIfAbsent<ContentBookmark>(
      STORE_NAMES.BOOKMARKS,
      [bookmark.userId, bookmark.contentId],
      bookmark,
    );
  }

  public async deleteBookmark(userId: number, contentId: number): Promise<boolean> {
    const existing = await this.getBookmark(userId, contentId);
    if (!existing) {
      return false;
    }
    await this.dataStore.deleteByKey(STORE_NAMES.BOOKMARKS, [userId, contentId]);
    return true;
  }

  public async getBookmarksByUserId(userId: number): Promise<ContentBookmark[]> {
    return this.dataStore.getAllByIndex<ContentBookmark>(
      STORE_NAMES.BOOKMARKS,
      'by_userId',
      userId,
    );
  }

  public async countBookmarksByUserId(userId: number): Promise<number> {
    const bookmarks = await this.getBookmarksByUserId(userId);
    return bookmarks.length;
  }
}
