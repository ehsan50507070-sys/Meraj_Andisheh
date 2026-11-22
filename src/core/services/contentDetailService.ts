import type { IContentRepository } from '../abstractions/contentRepository';
import type { IFileStorage } from '../abstractions/fileStorage';
import type { ITaxonomyRepository } from '../abstractions/taxonomyRepository';
import {
  ContentStatus,
  type ContentAgeGroup,
  type ContentFile,
  type ContentItem,
  type ContentSource,
  type ContentTopic,
} from '../domain/content';
import type {
  AgeGroup,
  ImpactLevel,
  Person,
  Tag,
  Topic,
} from '../domain/taxonomy';
import {
  isContentAllowedForAgeGroup,
  type AgePriorityGroup,
} from './ageRuleService';
import { resolveAparatEmbedUrl, validateExternalUrl } from './externalLinkService';
import { sanitizeHtml } from './htmlSanitizer';
import { resolveRootTopicId } from './viewTrackerService';

export const DEFAULT_MAX_RELATED_CONTENTS = 6;

export interface RelatedContentSummary {
  item: ContentItem;
  primaryTopicName: string | null;
  sharedTopicCount: number;
  priorityGroup: AgePriorityGroup;
}

export interface ContentDetailData {
  item: ContentItem;
  sanitizedBodyHtml: string;
  sources: ContentSource[];
  files: ContentFile[];
  topics: Topic[];
  topicBreadcrumbChain: Topic[];
  primaryRootTopicId: number | null;
  tags: Tag[];
  persons: Person[];
  impactLevel: ImpactLevel | null;
  targetAgeGroups: AgeGroup[];
  relatedContents: RelatedContentSummary[];
}

export type PublicContentDetailResult =
  | { status: 'not_found' }
  | { status: 'ok'; data: ContentDetailData };

function parseTimestampMs(iso: string | null | undefined): number {
  if (!iso) {
    return 0;
  }
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? 0 : ms;
}

function computePriorityTier(
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

/**
 * Builds the root -> ... -> primaryTopic breadcrumb chain for the content's primary topic.
 */
export function buildPrimaryTopicBreadcrumbChain(
  topicIds: readonly number[],
  topics: readonly Topic[],
): Topic[] {
  if (!topicIds || topicIds.length === 0 || topics.length === 0) {
    return [];
  }

  const topicById = new Map<number, Topic>(topics.map((t) => [t.id, t]));
  let startTopic: Topic | undefined;
  for (const id of topicIds) {
    const candidate = topicById.get(id);
    if (candidate && candidate.isActive) {
      startTopic = candidate;
      break;
    }
  }
  if (!startTopic) {
    for (const id of topicIds) {
      const candidate = topicById.get(id);
      if (candidate) {
        startTopic = candidate;
        break;
      }
    }
  }
  if (!startTopic) {
    return [];
  }

  const chain: Topic[] = [];
  const visited = new Set<number>();
  let cursor: Topic | undefined = startTopic;

  while (cursor && !visited.has(cursor.id)) {
    visited.add(cursor.id);
    chain.push(cursor);
    cursor = cursor.parentId !== null ? topicById.get(cursor.parentId) : undefined;
  }

  return chain.reverse();
}

/**
 * Pure computation for Section 4 related content cards:
 * - Published only, excluding current item
 * - Enforces active age-group rules (hard filter for child, soft priority otherwise)
 * - Requires at least 1 shared topic
 * - Ordered by shared topics count desc, age priority tier asc, newest publishedAt desc
 * - Capped at maxCount (default 6); returns [] when none match so UI hides section
 */
export function getRelatedContents(params: {
  currentItemId: number;
  currentTopicIds: readonly number[];
  allItems: readonly ContentItem[];
  contentTopics: readonly ContentTopic[];
  contentAgeGroups: readonly ContentAgeGroup[];
  topics: readonly Topic[];
  activeAgeGroup: AgeGroup | null;
  maxCount?: number;
}): RelatedContentSummary[] {
  const {
    currentItemId,
    currentTopicIds,
    allItems,
    contentTopics,
    contentAgeGroups,
    topics,
    activeAgeGroup,
    maxCount = DEFAULT_MAX_RELATED_CONTENTS,
  } = params;

  if (currentTopicIds.length === 0 || maxCount <= 0) {
    return [];
  }

  const currentTopicSet = new Set<number>(currentTopicIds);
  const topicNameById = new Map<number, string>(topics.map((t) => [t.id, t.name]));

  const topicsByContent = new Map<number, number[]>();
  for (const link of contentTopics) {
    const arr = topicsByContent.get(link.contentId);
    if (arr) {
      arr.push(link.topicId);
    } else {
      topicsByContent.set(link.contentId, [link.topicId]);
    }
  }

  const ageGroupsByContent = new Map<number, number[]>();
  for (const link of contentAgeGroups) {
    const arr = ageGroupsByContent.get(link.contentId);
    if (arr) {
      arr.push(link.ageGroupId);
    } else {
      ageGroupsByContent.set(link.contentId, [link.ageGroupId]);
    }
  }

  const candidates: RelatedContentSummary[] = [];
  for (const item of allItems) {
    if (item.id === currentItemId || item.status !== ContentStatus.Published) {
      continue;
    }

    const itemAgeIds = ageGroupsByContent.get(item.id) ?? [];
    if (!isContentAllowedForAgeGroup(itemAgeIds, activeAgeGroup)) {
      continue;
    }

    const itemTopicIds = topicsByContent.get(item.id) ?? [];
    let sharedTopicCount = 0;
    let firstSharedTopicName: string | null = null;
    for (const tid of itemTopicIds) {
      if (currentTopicSet.has(tid)) {
        sharedTopicCount += 1;
        if (!firstSharedTopicName) {
          firstSharedTopicName = topicNameById.get(tid) ?? null;
        }
      }
    }

    if (sharedTopicCount === 0) {
      continue;
    }

    const fallbackTopicName =
      firstSharedTopicName ??
      (itemTopicIds.length > 0 ? (topicNameById.get(itemTopicIds[0]) ?? null) : null);

    candidates.push({
      item,
      primaryTopicName: fallbackTopicName,
      sharedTopicCount,
      priorityGroup: computePriorityTier(itemAgeIds, activeAgeGroup),
    });
  }

  candidates.sort((a, b) => {
    if (b.sharedTopicCount !== a.sharedTopicCount) {
      return b.sharedTopicCount - a.sharedTopicCount;
    }
    if (a.priorityGroup !== b.priorityGroup) {
      return a.priorityGroup - b.priorityGroup;
    }
    const pubDiff = parseTimestampMs(b.item.publishedAt) - parseTimestampMs(a.item.publishedAt);
    if (pubDiff !== 0) {
      return pubDiff;
    }
    const createdDiff = parseTimestampMs(b.item.createdAt) - parseTimestampMs(a.item.createdAt);
    if (createdDiff !== 0) {
      return createdDiff;
    }
    return b.item.id - a.item.id;
  });

  return candidates.slice(0, maxCount);
}

export class ContentDetailService {
  private readonly contentRepository: IContentRepository;
  private readonly taxonomyRepository: ITaxonomyRepository;
  private readonly fileStorage?: IFileStorage;

  constructor(
    contentRepository: IContentRepository,
    taxonomyRepository: ITaxonomyRepository,
    fileStorage?: IFileStorage,
  ) {
    this.contentRepository = contentRepository;
    this.taxonomyRepository = taxonomyRepository;
    this.fileStorage = fileStorage;
  }

  public async getPublicContentDetailAsync(
    rawSlug: string,
    activeAgeGroup: AgeGroup | null,
  ): Promise<PublicContentDetailResult> {
    const trimmedRaw = (rawSlug ?? '').trim();
    if (!trimmedRaw) {
      return { status: 'not_found' };
    }

    let decodedSlug = trimmedRaw;
    try {
      decodedSlug = decodeURIComponent(trimmedRaw).trim();
    } catch {
      decodedSlug = trimmedRaw;
    }

    let item = await this.contentRepository.getContentItemBySlug(decodedSlug);
    if (!item && decodedSlug !== trimmedRaw) {
      item = await this.contentRepository.getContentItemBySlug(trimmedRaw);
    }

    if (!item || item.status !== ContentStatus.Published) {
      return { status: 'not_found' };
    }

    const ageGroupIds = await this.contentRepository.getAgeGroupIdsByContentId(item.id);
    if (!isContentAllowedForAgeGroup(ageGroupIds, activeAgeGroup)) {
      return { status: 'not_found' };
    }

    const [
      sources,
      files,
      topicIds,
      tagIds,
      personIds,
      allTopics,
      allTags,
      allPersons,
      allImpactLevels,
      allAgeGroups,
      allItems,
      allContentTopics,
      allContentAgeGroups,
    ] = await Promise.all([
      this.contentRepository.getSourcesByContentId(item.id),
      this.contentRepository.getFilesByContentId(item.id),
      this.contentRepository.getTopicIdsByContentId(item.id),
      this.contentRepository.getTagIdsByContentId(item.id),
      this.contentRepository.getPersonIdsByContentId(item.id),
      this.taxonomyRepository.getAllTopics(),
      this.taxonomyRepository.getAllTags(),
      this.taxonomyRepository.getAllPersons(),
      this.taxonomyRepository.getAllImpactLevels(),
      this.taxonomyRepository.getAllAgeGroups(),
      this.contentRepository.getAllContentItems(),
      this.contentRepository.getAllContentTopics(),
      this.contentRepository.getAllContentAgeGroups(),
    ]);

    const topicById = new Map(allTopics.map((t) => [t.id, t]));
    const tagById = new Map(allTags.map((tg) => [tg.id, tg]));
    const personById = new Map(allPersons.map((p) => [p.id, p]));
    const impactById = new Map(allImpactLevels.map((im) => [im.id, im]));
    const ageById = new Map(allAgeGroups.map((ag) => [ag.id, ag]));

    const resolvedTopics = topicIds
      .map((id) => topicById.get(id))
      .filter((t): t is Topic => Boolean(t));
    const resolvedTags = tagIds
      .map((id) => tagById.get(id))
      .filter((tg): tg is Tag => Boolean(tg));
    const resolvedPersons = personIds
      .map((id) => personById.get(id))
      .filter((p): p is Person => Boolean(p));
    const resolvedAges = ageGroupIds
      .map((id) => ageById.get(id))
      .filter((ag): ag is AgeGroup => Boolean(ag));

    const topicBreadcrumbChain = buildPrimaryTopicBreadcrumbChain(topicIds, allTopics);
    const primaryRootTopicId = resolveRootTopicId(topicIds, allTopics);

    const relatedContents = getRelatedContents({
      currentItemId: item.id,
      currentTopicIds: topicIds,
      allItems,
      contentTopics: allContentTopics,
      contentAgeGroups: allContentAgeGroups,
      topics: allTopics,
      activeAgeGroup,
      maxCount: DEFAULT_MAX_RELATED_CONTENTS,
    });

    // Sanitize sources URLs for presentation safety
    const safeSources = [...sources]
      .sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id)
      .map((src) => {
        if (!src.url) {
          return src;
        }
        const validation = validateExternalUrl(src.url);
        return {
          ...src,
          url: validation.isValid ? validation.normalizedUrl : null,
        };
      });

    // Normalize file sizes if missing while stored in IFileStorage
    const sortedFiles = [...files].sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);
    if (this.fileStorage) {
      for (let i = 0; i < sortedFiles.length; i += 1) {
        const file = sortedFiles[i];
        if (file.sizeBytes === null && file.storageKey) {
          const meta = await this.fileStorage.getMetadataAsync(file.storageKey);
          if (meta) {
            sortedFiles[i] = { ...file, sizeBytes: meta.sizeBytes };
          }
        }
      }
    }

    return {
      status: 'ok',
      data: {
        item,
        sanitizedBodyHtml: sanitizeHtml(item.body),
        sources: safeSources,
        files: sortedFiles,
        topics: resolvedTopics,
        topicBreadcrumbChain,
        primaryRootTopicId,
        tags: resolvedTags,
        persons: resolvedPersons,
        impactLevel: item.impactLevelId !== null ? (impactById.get(item.impactLevelId) ?? null) : null,
        targetAgeGroups: resolvedAges,
        relatedContents,
      },
    };
  }

  public async openPlaybackMediaAsync(
    contentId: number,
    storageKey: string,
    activeAgeGroup: AgeGroup | null,
  ): Promise<{ bytes: Uint8Array; mimeType: string } | null> {
    if (!this.fileStorage || !storageKey) {
      return null;
    }

    const item = await this.contentRepository.getContentItemById(contentId);
    if (!item || item.status !== ContentStatus.Published) {
      return null;
    }

    const ageGroupIds = await this.contentRepository.getAgeGroupIdsByContentId(contentId);
    if (!isContentAllowedForAgeGroup(ageGroupIds, activeAgeGroup)) {
      return null;
    }

    const files = await this.contentRepository.getFilesByContentId(contentId);
    const isThumbnail = item.thumbnailKey === storageKey;
    const isLinkedFile = files.some((f) => f.storageKey === storageKey);
    if (!isThumbnail && !isLinkedFile) {
      return null;
    }

    const opened = await this.fileStorage.openReadAsync(storageKey);
    if (!opened) {
      return null;
    }

    return {
      bytes: opened.bytes,
      mimeType: opened.metadata.mimeType,
    };
  }

  public resolveEmbedUrl(rawUrl: string | null | undefined): string | null {
    return resolveAparatEmbedUrl(rawUrl);
  }
}
