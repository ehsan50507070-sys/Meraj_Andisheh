import type { IAdminRepository } from '../abstractions/adminRepository';
import type { IClock } from '../abstractions/IClock';
import type { IContentRepository } from '../abstractions/contentRepository';
import type { ILayoutRepository } from '../abstractions/layoutRepository';
import type { ITaxonomyRepository } from '../abstractions/taxonomyRepository';
import type { IViewEventRepository } from '../abstractions/viewTracker';
import {
  ContentStatus,
  type ContentAgeGroup,
  type ContentItem,
  type ContentPerson,
  type ContentTag,
  type ContentTopic,
} from '../domain/content';
import {
  DEFAULT_HOME_ITEMS_PER_SHELF,
  type HeroSlide,
  type HomeShelf,
} from '../domain/layout';
import type { AgeGroup, Topic } from '../domain/taxonomy';
import {
  applyAgeGroupRulesWithMeta,
  isContentAllowedForAgeGroup,
  type AgePriorityGroup,
} from './ageRuleService';
import {
  expandTopicIdsWithDescendants,
  type CatalogContentCardItem,
} from './contentCatalogService';
import { normalizeDigits } from './identifierService';

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

export interface HomePageServiceDependencies {
  layoutRepository: ILayoutRepository;
  contentRepository: IContentRepository;
  taxonomyRepository: ITaxonomyRepository;
  adminRepository: IAdminRepository;
  viewEventRepository: IViewEventRepository;
  clock: IClock;
}

export interface HomePageOptions {
  enablePersonalizedInStage20?: boolean;
}

export interface HomeShelfViewModel {
  shelf: HomeShelf;
  viewAllHref: string;
  items: CatalogContentCardItem[];
  trendingCountsByContentId?: Record<number, number>;
}

export interface HomePageData {
  slides: HeroSlide[];
  shelves: HomeShelfViewModel[];
  itemsPerShelf: number;
}

interface AllowedPublishedCandidate {
  item: ContentItem;
  topicIds: number[];
  tagIds: number[];
  personIds: number[];
  ageGroupIds: number[];
  primaryTopicName: string | null;
  priorityGroup: AgePriorityGroup;
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

function computePriorityGroup(
  itemAgeGroupIds: readonly number[],
  activeAgeGroup: AgeGroup | null,
): AgePriorityGroup {
  if (!activeAgeGroup) {
    return itemAgeGroupIds.length === 0 ? 2 : 3;
  }
  if (itemAgeGroupIds.includes(activeAgeGroup.id)) {
    return 1;
  }
  if (itemAgeGroupIds.length === 0) {
    return 2;
  }
  return 3;
}

function sortWithAgeRules(
  candidates: readonly AllowedPublishedCandidate[],
  activeAgeGroup: AgeGroup | null,
  limit: number,
): CatalogContentCardItem[] {
  if (candidates.length === 0) {
    return [];
  }
  const prioritized = applyAgeGroupRulesWithMeta(
    candidates.map((c) => ({
      item: c,
      ageGroupIds: c.ageGroupIds,
      publishedAt: c.item.publishedAt,
      createdAt: c.item.createdAt,
      id: c.item.id,
    })),
    activeAgeGroup,
  );
  return prioritized.slice(0, limit).map((entry) => ({
    item: entry.item.item,
    topicIds: entry.item.topicIds,
    tagIds: entry.item.tagIds,
    personIds: entry.item.personIds,
    ageGroupIds: entry.item.ageGroupIds,
    primaryTopicName: entry.item.primaryTopicName,
    priorityGroup: entry.priorityGroup,
  }));
}

function resolveShelfViewAllHref(shelf: HomeShelf): string {
  switch (shelf.type) {
    case 'Trending':
      return '#/content?sort=most_viewed';
    case 'Latest':
      return '#/content?sort=latest';
    case 'ByTopic':
      return shelf.topicId !== null
        ? `#/content?topics=${shelf.topicId}`
        : '#/content';
    case 'Featured':
    case 'Personalized':
    default:
      return '#/content';
  }
}

export class HomePageService {
  private readonly layoutRepository: ILayoutRepository;
  private readonly contentRepository: IContentRepository;
  private readonly taxonomyRepository: ITaxonomyRepository;
  private readonly adminRepository: IAdminRepository;
  private readonly viewEventRepository: IViewEventRepository;
  private readonly clock: IClock;

  constructor(deps: HomePageServiceDependencies) {
    this.layoutRepository = deps.layoutRepository;
    this.contentRepository = deps.contentRepository;
    this.taxonomyRepository = deps.taxonomyRepository;
    this.adminRepository = deps.adminRepository;
    this.viewEventRepository = deps.viewEventRepository;
    this.clock = deps.clock;
  }

  public async getItemsPerShelfAsync(): Promise<number> {
    const setting = await this.adminRepository.getSiteSettingByKey('Home.ItemsPerShelf');
    if (!setting) {
      return DEFAULT_HOME_ITEMS_PER_SHELF;
    }
    const normalized = normalizeDigits(setting.value).trim();
    if (!/^\d+$/.test(normalized)) {
      return DEFAULT_HOME_ITEMS_PER_SHELF;
    }
    const parsed = Number.parseInt(normalized, 10);
    if (Number.isInteger(parsed) && parsed >= 1 && parsed <= 100) {
      return parsed;
    }
    return DEFAULT_HOME_ITEMS_PER_SHELF;
  }

  public async getHomePageDataAsync(
    activeAgeGroup: AgeGroup | null,
    options?: HomePageOptions,
  ): Promise<HomePageData> {
    const [
      allSlides,
      allShelves,
      itemsPerShelf,
      allItems,
      topics,
      contentTopics,
      contentTags,
      contentPersons,
      contentAgeGroups,
      allViewEvents,
    ] = await Promise.all([
      this.layoutRepository.getAllHeroSlides(),
      this.layoutRepository.getAllHomeShelves(),
      this.getItemsPerShelfAsync(),
      this.contentRepository.getAllContentItems(),
      this.taxonomyRepository.getAllTopics(),
      this.contentRepository.getAllContentTopics(),
      this.contentRepository.getAllContentTags(),
      this.contentRepository.getAllContentPersons(),
      this.contentRepository.getAllContentAgeGroups(),
      this.viewEventRepository.getAllViewEvents(),
    ]);

    const slides = allSlides
      .filter((slide) => {
        if (!slide.isActive) {
          return false;
        }
        if (slide.ageGroupId === null) {
          return true;
        }
        return activeAgeGroup !== null && slide.ageGroupId === activeAgeGroup.id;
      })
      .sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);

    const visibleShelves = allShelves
      .filter((shelf) => shelf.isVisible)
      .sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);

    const topicsByContent = buildLinkMap(contentTopics, (l: ContentTopic) => l.topicId);
    const tagsByContent = buildLinkMap(contentTags, (l: ContentTag) => l.tagId);
    const personsByContent = buildLinkMap(contentPersons, (l: ContentPerson) => l.personId);
    const ageGroupsByContent = buildLinkMap(contentAgeGroups, (l: ContentAgeGroup) => l.ageGroupId);
    const topicNameById = new Map<number, string>(topics.map((topic) => [topic.id, topic.name]));

    const allowedCandidates: AllowedPublishedCandidate[] = [];
    for (const item of allItems) {
      if (item.status !== ContentStatus.Published) {
        continue;
      }
      const ageGroupIds = ageGroupsByContent.get(item.id) ?? [];
      if (!isContentAllowedForAgeGroup(ageGroupIds, activeAgeGroup)) {
        continue;
      }
      const topicIds = topicsByContent.get(item.id) ?? [];
      allowedCandidates.push({
        item,
        topicIds,
        tagIds: tagsByContent.get(item.id) ?? [],
        personIds: personsByContent.get(item.id) ?? [],
        ageGroupIds,
        primaryTopicName: topicIds.length > 0 ? (topicNameById.get(topicIds[0]) ?? null) : null,
        priorityGroup: computePriorityGroup(ageGroupIds, activeAgeGroup),
      });
    }

    const nowMs = this.clock.now().getTime();
    const cutoffMs = nowMs - SEVEN_DAYS_MS;
    const countedViews7dByContentId = new Map<number, number>();
    for (const event of allViewEvents) {
      if (!event.isCounted) {
        continue;
      }
      const occurredMs = Date.parse(event.occurredAt);
      if (Number.isNaN(occurredMs) || occurredMs < cutoffMs || occurredMs > nowMs) {
        continue;
      }
      countedViews7dByContentId.set(
        event.contentId,
        (countedViews7dByContentId.get(event.contentId) ?? 0) + 1,
      );
    }

    const shelfViewModels: HomeShelfViewModel[] = [];

    for (const shelf of visibleShelves) {
      if (shelf.type === 'Personalized') {
        // Stage 18 strict scope: Personalized shelf stays empty and hidden until Stage 20.
        if (!options?.enablePersonalizedInStage20) {
          continue;
        }
        continue;
      }

      if (shelf.type === 'Latest') {
        const items = sortWithAgeRules(allowedCandidates, activeAgeGroup, itemsPerShelf);
        if (items.length > 0) {
          shelfViewModels.push({
            shelf,
            viewAllHref: resolveShelfViewAllHref(shelf),
            items,
          });
        }
        continue;
      }

      if (shelf.type === 'Featured') {
        const featuredCandidates = allowedCandidates.filter((c) => c.item.isFeatured);
        const items = sortWithAgeRules(featuredCandidates, activeAgeGroup, itemsPerShelf);
        if (items.length > 0) {
          shelfViewModels.push({
            shelf,
            viewAllHref: resolveShelfViewAllHref(shelf),
            items,
          });
        }
        continue;
      }

      if (shelf.type === 'ByTopic') {
        if (shelf.topicId === null) {
          continue;
        }
        const expandedSet = new Set<number>(
          expandTopicIdsWithDescendants([shelf.topicId], topics as readonly Topic[]),
        );
        if (expandedSet.size === 0) {
          continue;
        }
        const topicCandidates = allowedCandidates.filter((c) =>
          c.topicIds.some((tid) => expandedSet.has(tid)),
        );
        const items = sortWithAgeRules(topicCandidates, activeAgeGroup, itemsPerShelf);
        if (items.length > 0) {
          shelfViewModels.push({
            shelf,
            viewAllHref: resolveShelfViewAllHref(shelf),
            items,
          });
        }
        continue;
      }

      if (shelf.type === 'Trending') {
        const trendingScored = allowedCandidates
          .map((c) => ({
            candidate: c,
            views7d: countedViews7dByContentId.get(c.item.id) ?? 0,
          }))
          .filter((entry) => entry.views7d >= 1)
          .sort((a, b) => {
            if (b.views7d !== a.views7d) {
              return b.views7d - a.views7d;
            }
            if (a.candidate.priorityGroup !== b.candidate.priorityGroup) {
              return a.candidate.priorityGroup - b.candidate.priorityGroup;
            }
            const pubDiff =
              parseTimestampMs(b.candidate.item.publishedAt) -
              parseTimestampMs(a.candidate.item.publishedAt);
            if (pubDiff !== 0) {
              return pubDiff;
            }
            const createdDiff =
              parseTimestampMs(b.candidate.item.createdAt) -
              parseTimestampMs(a.candidate.item.createdAt);
            if (createdDiff !== 0) {
              return createdDiff;
            }
            return b.candidate.item.id - a.candidate.item.id;
          })
          .slice(0, itemsPerShelf);

        if (trendingScored.length > 0) {
          const trendingCountsByContentId: Record<number, number> = {};
          const items: CatalogContentCardItem[] = trendingScored.map(({ candidate, views7d }) => {
            trendingCountsByContentId[candidate.item.id] = views7d;
            return {
              item: candidate.item,
              topicIds: candidate.topicIds,
              tagIds: candidate.tagIds,
              personIds: candidate.personIds,
              ageGroupIds: candidate.ageGroupIds,
              primaryTopicName: candidate.primaryTopicName,
              priorityGroup: candidate.priorityGroup,
            };
          });
          shelfViewModels.push({
            shelf,
            viewAllHref: resolveShelfViewAllHref(shelf),
            items,
            trendingCountsByContentId,
          });
        }
      }
    }

    return {
      slides,
      shelves: shelfViewModels,
      itemsPerShelf,
    };
  }
}
