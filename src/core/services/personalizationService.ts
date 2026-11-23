import type { IAdminRepository } from '../abstractions/adminRepository';
import type { IGuestAffinityStorage } from '../abstractions/affinityStorage';
import type { IClock } from '../abstractions/IClock';
import type { IContentRepository } from '../abstractions/contentRepository';
import type { ILogger } from '../abstractions/ILogger';
import type {
  IPersonalizationService,
  IUserTopicAffinityRepository,
  RecordCountedViewForPersonalizationInput,
} from '../abstractions/personalizationService';
import type { ITaxonomyRepository } from '../abstractions/taxonomyRepository';
import type { IViewEventRepository } from '../abstractions/viewTracker';
import type { AppUser } from '../domain/auth';
import {
  ContentStatus,
  type ContentAgeGroup,
  type ContentItem,
  type ContentPerson,
  type ContentTag,
  type ContentTopic,
} from '../domain/content';
import { DEFAULT_HOME_ITEMS_PER_SHELF } from '../domain/layout';
import type {
  PersonalizationStatus,
  PersonalizationTopicScore,
  PersonalizedContentEntry,
  PersonalizedRecommendationsResult,
  UserTopicAffinity,
} from '../domain/personalization';
import type { AgeGroup, Topic } from '../domain/taxonomy';
import { isContentAllowedForAgeGroup } from './ageRuleService';
import { expandTopicIdsWithDescendants } from './contentCatalogService';
import { normalizeDigits } from './identifierService';
import { resolveRootTopicId } from './viewTrackerService';

export const DEFAULT_PERSONALIZATION_MIN_VIEWS = 3;

export interface PersonalizationServiceDependencies {
  affinityRepository: IUserTopicAffinityRepository;
  guestAffinityStorage: IGuestAffinityStorage;
  adminRepository: IAdminRepository;
  contentRepository: IContentRepository;
  taxonomyRepository: ITaxonomyRepository;
  viewEventRepository: IViewEventRepository;
  clock: IClock;
  logger?: ILogger;
}

function buildLinkMap<T extends { contentId: number }>(
  links: readonly T[],
  readTargetId: (link: T) => number,
): Map<number, number[]> {
  const map = new Map<number, number[]>();
  for (const link of links) {
    const targetId = readTargetId(link);
    const list = map.get(link.contentId);
    if (list) {
      list.push(targetId);
    } else {
      map.set(link.contentId, [targetId]);
    }
  }
  return map;
}

function parseTimestampMs(iso: string | null | undefined): number {
  if (!iso) {
    return 0;
  }
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? 0 : ms;
}

function extractUtcDayKey(iso: string): string {
  const ms = Date.parse(iso);
  if (!Number.isNaN(ms)) {
    return new Date(ms).toISOString().slice(0, 10);
  }
  return iso.slice(0, 10);
}

export class PersonalizationService implements IPersonalizationService {
  private readonly affinityRepository: IUserTopicAffinityRepository;
  private readonly guestAffinityStorage: IGuestAffinityStorage;
  private readonly adminRepository: IAdminRepository;
  private readonly contentRepository: IContentRepository;
  private readonly taxonomyRepository: ITaxonomyRepository;
  private readonly viewEventRepository: IViewEventRepository;
  private readonly clock: IClock;
  private readonly logger?: ILogger;
  private readonly directDailyDedupKeys = new Set<string>();

  constructor(deps: PersonalizationServiceDependencies) {
    this.affinityRepository = deps.affinityRepository;
    this.guestAffinityStorage = deps.guestAffinityStorage;
    this.adminRepository = deps.adminRepository;
    this.contentRepository = deps.contentRepository;
    this.taxonomyRepository = deps.taxonomyRepository;
    this.viewEventRepository = deps.viewEventRepository;
    this.clock = deps.clock;
    this.logger = deps.logger;
  }

  private async isGlobalEnabledAsync(): Promise<boolean> {
    const setting = await this.adminRepository.getSiteSettingByKey(
      'Personalization.DefaultEnabled',
    );
    if (!setting) {
      return true;
    }
    return normalizeDigits(setting.value).trim() !== '0';
  }

  private async getMinViewsThresholdAsync(): Promise<number> {
    const setting = await this.adminRepository.getSiteSettingByKey(
      'Personalization.MinViews',
    );
    if (!setting) {
      return DEFAULT_PERSONALIZATION_MIN_VIEWS;
    }
    const normalized = normalizeDigits(setting.value).trim();
    if (!/^\d+$/.test(normalized)) {
      return DEFAULT_PERSONALIZATION_MIN_VIEWS;
    }
    const parsed = Number.parseInt(normalized, 10);
    return Number.isInteger(parsed) && parsed >= 1
      ? parsed
      : DEFAULT_PERSONALIZATION_MIN_VIEWS;
  }

  private async getItemsPerShelfLimitAsync(): Promise<number> {
    const setting = await this.adminRepository.getSiteSettingByKey('Home.ItemsPerShelf');
    if (!setting) {
      return DEFAULT_HOME_ITEMS_PER_SHELF;
    }
    const normalized = normalizeDigits(setting.value).trim();
    if (!/^\d+$/.test(normalized)) {
      return DEFAULT_HOME_ITEMS_PER_SHELF;
    }
    const parsed = Number.parseInt(normalized, 10);
    return Number.isInteger(parsed) && parsed >= 1 && parsed <= 100
      ? parsed
      : DEFAULT_HOME_ITEMS_PER_SHELF;
  }

  private async resolveFreshActiveUser(
    user: AppUser | null,
  ): Promise<AppUser | null> {
    if (!user || !user.isActive || user.isDeleted) {
      return null;
    }
    const stored = await this.adminRepository.getUserById(user.id);
    if (stored) {
      if (!stored.isActive || stored.isDeleted) {
        return null;
      }
      return stored;
    }
    return user;
  }

  private async resolveUserEnabledAsync(user: AppUser | null): Promise<boolean> {
    if (user === null) {
      return this.guestAffinityStorage.getGuestPersonalizationEnabled();
    }
    const fresh = await this.resolveFreshActiveUser(user);
    if (!fresh) {
      return false;
    }
    return fresh.personalizationEnabled;
  }

  private async resolveActiveRootTopicIdAsync(
    contentId: number,
    hintPrimaryTopicId: number | null,
  ): Promise<number | null> {
    const allTopics = await this.taxonomyRepository.getAllTopics();
    let candidateRootId: number | null = null;
    if (hintPrimaryTopicId !== null) {
      candidateRootId =
        resolveRootTopicId([hintPrimaryTopicId], allTopics) ?? hintPrimaryTopicId;
    } else {
      const contentTopicIds =
        await this.contentRepository.getTopicIdsByContentId(contentId);
      candidateRootId = resolveRootTopicId(contentTopicIds, allTopics);
    }
    if (candidateRootId === null) {
      return null;
    }
    const topic = allTopics.find((t) => t.id === candidateRootId);
    if (!topic || !topic.isActive || topic.parentId !== null) {
      return null;
    }
    return topic.id;
  }

  public async recordCountedViewAsync(
    input: RecordCountedViewForPersonalizationInput,
  ): Promise<{ incremented: boolean; rootTopicId: number | null }> {
    if (
      typeof input.contentId !== 'number' ||
      !Number.isInteger(input.contentId) ||
      input.contentId <= 0
    ) {
      return { incremented: false, rootTopicId: null };
    }

    const globalEnabled = await this.isGlobalEnabledAsync();
    if (!globalEnabled) {
      return { incremented: false, rootTopicId: null };
    }

    const cleanVisitorId = (input.visitorId ?? '').trim();
    let userEnabled = false;
    if (input.userId !== null) {
      const storedUser = await this.adminRepository.getUserById(input.userId);
      if (
        !storedUser ||
        !storedUser.isActive ||
        storedUser.isDeleted ||
        !storedUser.personalizationEnabled
      ) {
        return { incremented: false, rootTopicId: null };
      }
      userEnabled = true;
    } else {
      userEnabled = this.guestAffinityStorage.getGuestPersonalizationEnabled();
    }

    if (!userEnabled) {
      return { incremented: false, rootTopicId: null };
    }

    const rootTopicId = await this.resolveActiveRootTopicIdAsync(
      input.contentId,
      input.primaryTopicId,
    );
    if (rootTopicId === null) {
      return { incremented: false, rootTopicId: null };
    }

    const occurredAt = input.occurredAtIso || this.clock.nowUtcIso();
    const targetUtcDay = extractUtcDayKey(occurredAt);
    const actorDedupPrefix =
      input.userId !== null
        ? `u:${input.userId}`
        : `g:${cleanVisitorId || 'anonymous'}`;
    const directKey = `${actorDedupPrefix}:${input.contentId}:${targetUtcDay}`;

    if (input.currentEventId === undefined && this.directDailyDedupKeys.has(directKey)) {
      return { incremented: false, rootTopicId };
    }

    const existingEvents = await this.viewEventRepository.getViewEventsByContentId(
      input.contentId,
    );
    const alreadyCountedToday = existingEvents.some((ev) => {
      if (input.currentEventId !== undefined && ev.id === input.currentEventId) {
        return false;
      }
      if (!ev.isCounted) {
        return false;
      }
      if (extractUtcDayKey(ev.occurredAt) !== targetUtcDay) {
        return false;
      }
      if (input.userId !== null) {
        return (
          ev.userId === input.userId ||
          (ev.userId === null &&
            cleanVisitorId.length > 0 &&
            ev.visitorId === cleanVisitorId)
        );
      }
      return (
        ev.userId === null &&
        cleanVisitorId.length > 0 &&
        ev.visitorId === cleanVisitorId
      );
    });

    if (alreadyCountedToday) {
      return { incremented: false, rootTopicId };
    }

    if (input.userId !== null) {
      const existing = await this.affinityRepository.getAffinity(
        input.userId,
        rootTopicId,
      );
      const nextCount = (existing?.viewCount ?? 0) + 1;
      const latestAt =
        existing && existing.lastViewedAt > occurredAt
          ? existing.lastViewedAt
          : occurredAt;
      const updated: UserTopicAffinity = {
        userId: input.userId,
        rootTopicId,
        viewCount: nextCount,
        lastViewedAt: latestAt,
      };
      await this.affinityRepository.upsertAffinity(updated);
    } else {
      const currentEntries = this.guestAffinityStorage.getGuestAffinities();
      const idx = currentEntries.findIndex((e) => e.rootTopicId === rootTopicId);
      const nextEntries = [...currentEntries];
      if (idx === -1) {
        nextEntries.push({
          rootTopicId,
          viewCount: 1,
          lastViewedAt: occurredAt,
        });
      } else {
        const existing = nextEntries[idx];
        nextEntries[idx] = {
          rootTopicId,
          viewCount: existing.viewCount + 1,
          lastViewedAt:
            existing.lastViewedAt > occurredAt ? existing.lastViewedAt : occurredAt,
        };
      }
      this.guestAffinityStorage.setGuestAffinities(nextEntries);
    }

    if (input.currentEventId === undefined) {
      this.directDailyDedupKeys.add(directKey);
    }

    return { incremented: true, rootTopicId };
  }

  public async mergeGuestAffinityOnLoginAsync(
    user: AppUser,
  ): Promise<{ mergedTopicsCount: number }> {
    if (!user || !user.isActive || user.isDeleted) {
      return { mergedTopicsCount: 0 };
    }

    const guestEntries = this.guestAffinityStorage.getGuestAffinities();
    if (guestEntries.length === 0) {
      return { mergedTopicsCount: 0 };
    }

    const [existingAffinities, allTopics] = await Promise.all([
      this.affinityRepository.getAffinitiesByUserId(user.id),
      this.taxonomyRepository.getAllTopics(),
    ]);

    const validRootTopicIds = new Set(
      allTopics
        .filter((t) => t.parentId === null && t.isActive)
        .map((t) => t.id),
    );
    const existingByTopicId = new Map<number, UserTopicAffinity>(
      existingAffinities.map((a) => [a.rootTopicId, a]),
    );

    let mergedTopicsCount = 0;
    for (const guest of guestEntries) {
      if (!validRootTopicIds.has(guest.rootTopicId) || guest.viewCount <= 0) {
        continue;
      }
      const existing = existingByTopicId.get(guest.rootTopicId);
      const mergedViewCount = (existing?.viewCount ?? 0) + guest.viewCount;
      const latestAt =
        existing && existing.lastViewedAt > guest.lastViewedAt
          ? existing.lastViewedAt
          : guest.lastViewedAt;

      const updated: UserTopicAffinity = {
        userId: user.id,
        rootTopicId: guest.rootTopicId,
        viewCount: mergedViewCount,
        lastViewedAt: latestAt,
      };
      await this.affinityRepository.upsertAffinity(updated);
      existingByTopicId.set(guest.rootTopicId, updated);
      mergedTopicsCount += 1;
    }

    this.guestAffinityStorage.clearGuestAffinities();

    if (mergedTopicsCount > 0) {
      this.logger?.info('PERSONALIZATION_GUEST_AFFINITY_MERGED', {
        userId: user.id,
        mergedTopicsCount,
      });
    }

    return { mergedTopicsCount };
  }

  public async getPersonalizationStatusAsync(
    user: AppUser | null,
  ): Promise<PersonalizationStatus> {
    const activeUser = await this.resolveFreshActiveUser(user);
    const [globalEnabled, userEnabled, minViewsThreshold, allTopics] =
      await Promise.all([
        this.isGlobalEnabledAsync(),
        this.resolveUserEnabledAsync(activeUser),
        this.getMinViewsThresholdAsync(),
        this.taxonomyRepository.getAllTopics(),
      ]);

    const rawScores =
      activeUser !== null
        ? await this.affinityRepository.getAffinitiesByUserId(activeUser.id)
        : this.guestAffinityStorage.getGuestAffinities();

    const activeRootTopics = new Map<number, Topic>(
      allTopics
        .filter((t) => t.parentId === null && t.isActive)
        .map((t) => [t.id, t]),
    );

    const topTopics: PersonalizationTopicScore[] = rawScores
      .filter((entry) => entry.viewCount > 0 && activeRootTopics.has(entry.rootTopicId))
      .map((entry) => ({
        rootTopicId: entry.rootTopicId,
        rootTopicName: activeRootTopics.get(entry.rootTopicId)!.name,
        viewCount: entry.viewCount,
        lastViewedAt: entry.lastViewedAt,
      }))
      .sort(
        (a, b) =>
          b.viewCount - a.viewCount ||
          b.lastViewedAt.localeCompare(a.lastViewedAt) ||
          a.rootTopicId - b.rootTopicId,
      );

    const effectiveEnabled = globalEnabled && userEnabled;
    const qualifiesForRecommendations =
      effectiveEnabled &&
      topTopics.length > 0 &&
      topTopics[0].viewCount >= minViewsThreshold;

    return {
      globalEnabled,
      userEnabled,
      effectiveEnabled,
      minViewsThreshold,
      topTopics,
      qualifiesForRecommendations,
    };
  }

  public async getPersonalizedRecommendationsAsync(input: {
    user: AppUser | null;
    activeAgeGroup: AgeGroup | null;
    visitorId?: string | null;
    limit?: number;
  }): Promise<PersonalizedRecommendationsResult> {
    const activeUser = await this.resolveFreshActiveUser(input.user);
    const status = await this.getPersonalizationStatusAsync(activeUser);

    if (!status.effectiveEnabled || !status.qualifiesForRecommendations) {
      return {
        isVisible: false,
        topTopics: [],
        items: [],
      };
    }

    const selectedTopTopics = status.topTopics.slice(0, 2);
    if (selectedTopTopics.length === 0) {
      return {
        isVisible: false,
        topTopics: [],
        items: [],
      };
    }

    const resolvedLimit =
      typeof input.limit === 'number' &&
      Number.isInteger(input.limit) &&
      input.limit >= 1
        ? input.limit
        : await this.getItemsPerShelfLimitAsync();

    const [
      allItems,
      allTopics,
      contentTopics,
      contentTags,
      contentPersons,
      contentAgeGroups,
      allViewEvents,
    ] = await Promise.all([
      this.contentRepository.getAllContentItems(),
      this.taxonomyRepository.getAllTopics(),
      this.contentRepository.getAllContentTopics(),
      this.contentRepository.getAllContentTags(),
      this.contentRepository.getAllContentPersons(),
      this.contentRepository.getAllContentAgeGroups(),
      this.viewEventRepository.getAllViewEvents(),
    ]);

    const cleanVisitorId = (input.visitorId ?? '').trim();
    const seenContentIds = new Set<number>();
    for (const ev of allViewEvents) {
      if (activeUser !== null) {
        const matchesUser = ev.userId === activeUser.id;
        const matchesGuestSession =
          ev.userId === null &&
          cleanVisitorId.length > 0 &&
          ev.visitorId === cleanVisitorId;
        if (matchesUser || matchesGuestSession) {
          seenContentIds.add(ev.contentId);
        }
      } else if (
        ev.userId === null &&
        cleanVisitorId.length > 0 &&
        ev.visitorId === cleanVisitorId
      ) {
        seenContentIds.add(ev.contentId);
      }
    }

    const topicsByContent = buildLinkMap(contentTopics, (l: ContentTopic) => l.topicId);
    const tagsByContent = buildLinkMap(contentTags, (l: ContentTag) => l.tagId);
    const personsByContent = buildLinkMap(
      contentPersons,
      (l: ContentPerson) => l.personId,
    );
    const ageGroupsByContent = buildLinkMap(
      contentAgeGroups,
      (l: ContentAgeGroup) => l.ageGroupId,
    );
    const topicNameById = new Map<number, string>(allTopics.map((t) => [t.id, t.name]));

    const eligibleItems: ContentItem[] = [];
    for (const item of allItems) {
      if (item.status !== ContentStatus.Published) {
        continue;
      }
      if (seenContentIds.has(item.id)) {
        continue;
      }
      const ageGroupIds = ageGroupsByContent.get(item.id) ?? [];
      if (!isContentAllowedForAgeGroup(ageGroupIds, input.activeAgeGroup)) {
        continue;
      }
      eligibleItems.push(item);
    }

    // Order strictly newest first (PublishedAt Desc, then CreatedAt Desc, then Id Desc)
    eligibleItems.sort((a, b) => {
      const pubDiff =
        parseTimestampMs(b.publishedAt ?? b.createdAt) -
        parseTimestampMs(a.publishedAt ?? a.createdAt);
      if (pubDiff !== 0) {
        return pubDiff;
      }
      const createdDiff =
        parseTimestampMs(b.createdAt) - parseTimestampMs(a.createdAt);
      if (createdDiff !== 0) {
        return createdDiff;
      }
      return b.id - a.id;
    });

    const selectedEntries: PersonalizedContentEntry[] = [];
    const addedIds = new Set<number>();

    for (const topTopic of selectedTopTopics) {
      if (selectedEntries.length >= resolvedLimit) {
        break;
      }
      const expandedTopicSet = new Set<number>(
        expandTopicIdsWithDescendants([topTopic.rootTopicId], allTopics),
      );
      if (expandedTopicSet.size === 0) {
        continue;
      }

      for (const item of eligibleItems) {
        if (selectedEntries.length >= resolvedLimit) {
          break;
        }
        if (addedIds.has(item.id)) {
          continue;
        }
        const itemTopicIds = topicsByContent.get(item.id) ?? [];
        if (!itemTopicIds.some((tid) => expandedTopicSet.has(tid))) {
          continue;
        }

        addedIds.add(item.id);
        selectedEntries.push({
          item,
          topicIds: itemTopicIds,
          tagIds: tagsByContent.get(item.id) ?? [],
          personIds: personsByContent.get(item.id) ?? [],
          ageGroupIds: ageGroupsByContent.get(item.id) ?? [],
          primaryTopicName:
            itemTopicIds.length > 0
              ? (topicNameById.get(itemTopicIds[0]) ?? null)
              : null,
        });
      }
    }

    if (selectedEntries.length === 0) {
      return {
        isVisible: false,
        topTopics: selectedTopTopics,
        items: [],
      };
    }

    return {
      isVisible: true,
      topTopics: selectedTopTopics,
      items: selectedEntries,
    };
  }

  public async setUserPersonalizationEnabledAsync(
    user: AppUser | null,
    enabled: boolean,
  ): Promise<{ ok: boolean; user?: AppUser; effectiveEnabled: boolean }> {
    const globalEnabled = await this.isGlobalEnabledAsync();

    if (user === null) {
      this.guestAffinityStorage.setGuestPersonalizationEnabled(enabled);
      this.logger?.info('GUEST_PERSONALIZATION_TOGGLED', { enabled });
      return {
        ok: true,
        effectiveEnabled: globalEnabled && enabled,
      };
    }

    const freshUser = await this.resolveFreshActiveUser(user);
    if (!freshUser) {
      return {
        ok: false,
        effectiveEnabled: false,
      };
    }

    const updatedUser: AppUser = {
      ...freshUser,
      personalizationEnabled: enabled,
    };
    await this.adminRepository.updateUser(updatedUser);

    this.logger?.info('USER_PERSONALIZATION_TOGGLED', {
      userId: updatedUser.id,
      enabled,
    });

    return {
      ok: true,
      user: updatedUser,
      effectiveEnabled: globalEnabled && enabled,
    };
  }

  public async clearPersonalizationHistoryAsync(
    user: AppUser | null,
  ): Promise<{ ok: boolean; deletedTopicsCount: number }> {
    const activeUser = await this.resolveFreshActiveUser(user);

    if (activeUser !== null) {
      const deletedCount = await this.affinityRepository.deleteAffinitiesByUserId(
        activeUser.id,
      );
      this.guestAffinityStorage.clearGuestAffinities();
      const prefix = `u:${activeUser.id}:`;
      for (const key of Array.from(this.directDailyDedupKeys)) {
        if (key.startsWith(prefix)) {
          this.directDailyDedupKeys.delete(key);
        }
      }
      this.logger?.info('PERSONALIZATION_HISTORY_CLEARED', {
        userId: activeUser.id,
        deletedTopicsCount: deletedCount,
      });
      return { ok: true, deletedTopicsCount: deletedCount };
    }

    const prevGuestCount = this.guestAffinityStorage.getGuestAffinities().length;
    this.guestAffinityStorage.clearGuestAffinities();
    for (const key of Array.from(this.directDailyDedupKeys)) {
      if (key.startsWith('g:')) {
        this.directDailyDedupKeys.delete(key);
      }
    }
    this.logger?.info('PERSONALIZATION_HISTORY_CLEARED', {
      userId: null,
      deletedTopicsCount: prevGuestCount,
    });
    return { ok: true, deletedTopicsCount: prevGuestCount };
  }
}
