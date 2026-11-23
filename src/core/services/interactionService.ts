import type { IClock } from '../abstractions/IClock';
import type { IContentRepository } from '../abstractions/contentRepository';
import type { ILogger } from '../abstractions/ILogger';
import type { IInteractionRepository } from '../abstractions/interactionRepository';
import type { ITaxonomyRepository } from '../abstractions/taxonomyRepository';
import type { AppUser } from '../domain/auth';
import { ContentStatus, type ContentItem } from '../domain/content';
import type { ContentBookmark } from '../domain/interactions';
import type { AgeGroup } from '../domain/taxonomy';
import { isContentAllowedForAgeGroup } from './ageRuleService';

export type InteractionErrorCode =
  | 'AUTH_REQUIRED'
  | 'CONTENT_NOT_FOUND'
  | 'FORBIDDEN';

export type ToggleLikeResult =
  | { ok: true; liked: boolean; likeCount: number }
  | { ok: false; errorCode: InteractionErrorCode };

export type ToggleBookmarkResult =
  | { ok: true; bookmarked: boolean }
  | { ok: false; errorCode: InteractionErrorCode };

export interface UserContentInteractionState {
  liked: boolean;
  bookmarked: boolean;
  likeCount: number;
}

export interface BookmarkedContentEntry {
  bookmark: ContentBookmark;
  item: ContentItem;
  primaryTopicName: string | null;
}

export type GetUserBookmarksResult =
  | { ok: true; items: BookmarkedContentEntry[] }
  | { ok: false; errorCode: 'FORBIDDEN' };

function isActiveUser(user: AppUser | null): user is AppUser {
  return Boolean(user && user.isActive && !user.isDeleted);
}

export class InteractionService {
  private readonly interactionRepository: IInteractionRepository;
  private readonly contentRepository: IContentRepository;
  private readonly taxonomyRepository: ITaxonomyRepository;
  private readonly clock: IClock;
  private readonly logger: ILogger;

  constructor(
    interactionRepository: IInteractionRepository,
    contentRepository: IContentRepository,
    taxonomyRepository: ITaxonomyRepository,
    clock: IClock,
    logger: ILogger,
  ) {
    this.interactionRepository = interactionRepository;
    this.contentRepository = contentRepository;
    this.taxonomyRepository = taxonomyRepository;
    this.clock = clock;
    this.logger = logger;
  }

  public async toggleLikeAsync(
    currentUser: AppUser | null,
    contentId: number,
  ): Promise<ToggleLikeResult> {
    if (!isActiveUser(currentUser)) {
      return { ok: false, errorCode: 'AUTH_REQUIRED' };
    }

    const item = await this.contentRepository.getContentItemById(contentId);
    if (!item || item.status !== ContentStatus.Published) {
      return { ok: false, errorCode: 'CONTENT_NOT_FOUND' };
    }

    const existing = await this.interactionRepository.getLike(currentUser.id, contentId);
    let liked = false;

    if (!existing) {
      await this.interactionRepository.createLike({
        userId: currentUser.id,
        contentId,
        createdAt: this.clock.nowUtcIso(),
      });
      liked = true;
    } else {
      await this.interactionRepository.deleteLike(currentUser.id, contentId);
      liked = false;
    }

    const realCount = Math.max(
      0,
      await this.interactionRepository.countLikesByContentId(contentId),
    );
    if (item.likeCount !== realCount) {
      await this.contentRepository.updateContentItem({
        ...item,
        likeCount: realCount,
      });
    }

    this.logger.info(liked ? 'CONTENT_LIKED' : 'CONTENT_UNLIKED', {
      userId: currentUser.id,
      contentId,
      likeCount: realCount,
    });

    return { ok: true, liked, likeCount: realCount };
  }

  public async toggleBookmarkAsync(
    currentUser: AppUser | null,
    contentId: number,
  ): Promise<ToggleBookmarkResult> {
    if (!isActiveUser(currentUser)) {
      return { ok: false, errorCode: 'AUTH_REQUIRED' };
    }

    const item = await this.contentRepository.getContentItemById(contentId);
    if (!item || item.status !== ContentStatus.Published) {
      return { ok: false, errorCode: 'CONTENT_NOT_FOUND' };
    }

    const existing = await this.interactionRepository.getBookmark(currentUser.id, contentId);
    let bookmarked = false;

    if (!existing) {
      await this.interactionRepository.createBookmark({
        userId: currentUser.id,
        contentId,
        createdAt: this.clock.nowUtcIso(),
      });
      bookmarked = true;
    } else {
      await this.interactionRepository.deleteBookmark(currentUser.id, contentId);
      bookmarked = false;
    }

    this.logger.info(bookmarked ? 'CONTENT_BOOKMARKED' : 'CONTENT_UNBOOKMARKED', {
      userId: currentUser.id,
      contentId,
    });

    return { ok: true, bookmarked };
  }

  public async getUserContentInteractionStateAsync(
    currentUser: AppUser | null,
    contentId: number,
  ): Promise<UserContentInteractionState> {
    const item = await this.contentRepository.getContentItemById(contentId);
    const likeCount = item ? Math.max(0, item.likeCount) : 0;

    if (!isActiveUser(currentUser)) {
      return {
        liked: false,
        bookmarked: false,
        likeCount,
      };
    }

    const [like, bookmark] = await Promise.all([
      this.interactionRepository.getLike(currentUser.id, contentId),
      this.interactionRepository.getBookmark(currentUser.id, contentId),
    ]);

    return {
      liked: like !== null,
      bookmarked: bookmark !== null,
      likeCount,
    };
  }

  public async getUserBookmarksAsync(
    actor: AppUser | null,
    targetUserId: number,
    activeAgeGroup: AgeGroup | null,
  ): Promise<GetUserBookmarksResult> {
    if (!isActiveUser(actor) || actor.id !== targetUserId) {
      this.logger.warn('BOOKMARKS_ACCESS_FORBIDDEN', {
        actorId: actor?.id ?? null,
        targetUserId,
      });
      return { ok: false, errorCode: 'FORBIDDEN' };
    }

    const [bookmarks, allItems, allTopics, allContentTopics, allContentAgeGroups] =
      await Promise.all([
        this.interactionRepository.getBookmarksByUserId(targetUserId),
        this.contentRepository.getAllContentItems(),
        this.taxonomyRepository.getAllTopics(),
        this.contentRepository.getAllContentTopics(),
        this.contentRepository.getAllContentAgeGroups(),
      ]);

    const itemById = new Map(allItems.map((it) => [it.id, it]));
    const topicNameById = new Map(allTopics.map((tp) => [tp.id, tp.name]));

    const topicsByContent = new Map<number, number[]>();
    for (const link of allContentTopics) {
      const list = topicsByContent.get(link.contentId);
      if (list) {
        list.push(link.topicId);
      } else {
        topicsByContent.set(link.contentId, [link.topicId]);
      }
    }

    const ageGroupsByContent = new Map<number, number[]>();
    for (const link of allContentAgeGroups) {
      const list = ageGroupsByContent.get(link.contentId);
      if (list) {
        list.push(link.ageGroupId);
      } else {
        ageGroupsByContent.set(link.contentId, [link.ageGroupId]);
      }
    }

    const sortedBookmarks = [...bookmarks].sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt),
    );

    const results: BookmarkedContentEntry[] = [];
    for (const bookmark of sortedBookmarks) {
      const item = itemById.get(bookmark.contentId);
      if (!item || item.status !== ContentStatus.Published) {
        continue;
      }
      const itemAgeIds = ageGroupsByContent.get(item.id) ?? [];
      if (!isContentAllowedForAgeGroup(itemAgeIds, activeAgeGroup)) {
        continue;
      }
      const itemTopicIds = topicsByContent.get(item.id) ?? [];
      const primaryTopicName =
        itemTopicIds.length > 0 ? (topicNameById.get(itemTopicIds[0]) ?? null) : null;

      results.push({
        bookmark,
        item,
        primaryTopicName,
      });
    }

    return { ok: true, items: results };
  }

  public async countUserBookmarksAsync(
    currentUser: AppUser | null,
    activeAgeGroup: AgeGroup | null,
  ): Promise<number> {
    if (!isActiveUser(currentUser)) {
      return 0;
    }
    const res = await this.getUserBookmarksAsync(
      currentUser,
      currentUser.id,
      activeAgeGroup,
    );
    return res.ok ? res.items.length : 0;
  }
}
