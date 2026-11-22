import type { IClock } from '../abstractions/IClock';
import type { IContentRepository } from '../abstractions/contentRepository';
import type { ILogger } from '../abstractions/ILogger';
import type {
  IViewEventRepository,
  IViewTracker,
  TrackViewInput,
  TrackViewResult,
} from '../abstractions/viewTracker';
import type { Topic } from '../domain/taxonomy';

export const VIEW_DEDUP_WINDOW_MS = 30 * 60 * 1000;
export const VISITOR_COOKIE_NAME = 'ma_vid';
export const VISITOR_COOKIE_MAX_AGE_SECONDS = 365 * 24 * 60 * 60;

export const KNOWN_BOT_USER_AGENT_TOKENS: readonly string[] = [
  'bot',
  'crawler',
  'spider',
  'googlebot',
  'bingbot',
  'yandex',
  'baiduspider',
  'duckduckbot',
  'slurp',
  'facebookexternalhit',
  'telegrambot',
  'whatsapp',
  'curl',
  'wget',
  'python-requests',
  'headlesschrome',
  'lighthouse',
] as const;

export function isKnownBotUserAgent(userAgent: string | null | undefined): boolean {
  if (!userAgent || typeof userAgent !== 'string') {
    return false;
  }
  const lower = userAgent.trim().toLowerCase();
  if (!lower) {
    return false;
  }
  return KNOWN_BOT_USER_AGENT_TOKENS.some((token) => lower.includes(token));
}

/**
 * Resolves the root topic ID (parentId === null) from a content item's primary topic.
 * Returns null if the content has no valid linked topic.
 */
export function resolveRootTopicId(
  topicIds: readonly number[],
  topics: readonly Topic[],
): number | null {
  if (!topicIds || topicIds.length === 0 || topics.length === 0) {
    return null;
  }

  const topicById = new Map<number, Topic>(topics.map((topic) => [topic.id, topic]));
  let startTopic: Topic | undefined;
  for (const id of topicIds) {
    const candidate = topicById.get(id);
    if (candidate) {
      startTopic = candidate;
      break;
    }
  }
  if (!startTopic) {
    return null;
  }

  const visited = new Set<number>();
  let current: Topic = startTopic;
  while (current.parentId !== null && !visited.has(current.id)) {
    visited.add(current.id);
    const parent = topicById.get(current.parentId);
    if (!parent) {
      break;
    }
    current = parent;
  }

  return current.id;
}

export class ViewTrackerService implements IViewTracker {
  private readonly viewEventRepository: IViewEventRepository;
  private readonly contentRepository: IContentRepository;
  private readonly clock: IClock;
  private readonly logger?: ILogger;

  constructor(
    viewEventRepository: IViewEventRepository,
    contentRepository: IContentRepository,
    clock: IClock,
    logger?: ILogger,
  ) {
    this.viewEventRepository = viewEventRepository;
    this.contentRepository = contentRepository;
    this.clock = clock;
    this.logger = logger;
  }

  public async trackViewAsync(input: TrackViewInput): Promise<TrackViewResult> {
    if (isKnownBotUserAgent(input.userAgent)) {
      return {
        event: null,
        isCounted: false,
        skippedAsBot: true,
      };
    }

    const cleanVisitorId = (input.visitorId ?? '').trim();
    const existingEvents = await this.viewEventRepository.getViewEventsByContentId(input.contentId);

    const nowMs = this.clock.now().getTime();
    const nowIso = this.clock.nowUtcIso();

    let latestCountedMs: number | null = null;
    for (const ev of existingEvents) {
      if (!ev.isCounted) {
        continue;
      }

      const sameVisitor =
        input.userId !== null
          ? ev.userId === input.userId
          : ev.userId === null && ev.visitorId === cleanVisitorId && cleanVisitorId.length > 0;

      if (!sameVisitor) {
        continue;
      }

      const evMs = Date.parse(ev.occurredAt);
      if (!Number.isNaN(evMs) && (latestCountedMs === null || evMs > latestCountedMs)) {
        latestCountedMs = evMs;
      }
    }

    const shouldCount =
      latestCountedMs === null || nowMs - latestCountedMs >= VIEW_DEDUP_WINDOW_MS;

    const createdEvent = await this.viewEventRepository.createViewEvent({
      contentId: input.contentId,
      userId: input.userId,
      visitorId: cleanVisitorId,
      ageGroupId: input.ageGroupId,
      primaryTopicId: input.primaryTopicId,
      occurredAt: nowIso,
      isCounted: shouldCount,
    });

    if (shouldCount) {
      const contentItem = await this.contentRepository.getContentItemById(input.contentId);
      if (contentItem) {
        await this.contentRepository.updateContentItem({
          ...contentItem,
          viewCount: contentItem.viewCount + 1,
        });
      }
      this.logger?.info('CONTENT_VIEW_COUNTED', {
        contentId: input.contentId,
        userId: input.userId,
        ageGroupId: input.ageGroupId,
        primaryTopicId: input.primaryTopicId,
      });
    } else {
      this.logger?.debug('CONTENT_VIEW_DEDUPLICATED', {
        contentId: input.contentId,
        userId: input.userId,
      });
    }

    return {
      event: createdEvent,
      isCounted: shouldCount,
      skippedAsBot: false,
    };
  }
}
