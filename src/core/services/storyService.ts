import type { IClock } from '../abstractions/IClock';
import type { ILogger } from '../abstractions/ILogger';
import type { IAdminRepository } from '../abstractions/adminRepository';
import type { IContentRepository } from '../abstractions/contentRepository';
import type { IDownloadEventRepository } from '../abstractions/downloadRepository';
import { DownloadKind, type DownloadEvent } from '../domain/analytics';
import type { AppUser } from '../domain/auth';
import { ContentStatus, type ContentItem } from '../domain/content';
import {
  STORY_QUOTE_MAX_LENGTH,
  STORY_TITLE_MAX_LENGTH,
  type StoryTemplateKey,
} from '../domain/story';
import type { AgeGroup } from '../domain/taxonomy';
import { isContentAllowedForAgeGroup } from './ageRuleService';

export const DEFAULT_STORY_TEMPLATE: StoryTemplateKey = 'cinematic-dark';
export const DEFAULT_PUBLIC_SITE_URL = 'meraj-andisheh.ir';

export interface StoryServiceDependencies {
  contentRepository: IContentRepository;
  adminRepository: IAdminRepository;
  downloadEventRepository: IDownloadEventRepository;
  clock: IClock;
  logger?: ILogger;
}

export interface PrepareStoryDefaultsInput {
  content: Pick<ContentItem, 'title' | 'summary'>;
  topicName?: string | null;
  keyExcerpts?: string | null;
  siteTitle: string;
  siteUrl?: string | null;
}

export interface StoryDefaultsData {
  template: StoryTemplateKey;
  showTitle: boolean;
  title: string;
  quote: string;
  topicName: string | null;
  siteTitle: string;
  siteUrl: string;
}

export interface RecordStoryDownloadInput {
  currentUser: AppUser | null;
  contentId: number;
  activeAgeGroup: AgeGroup | null;
}

export type StoryRecordErrorCode =
  | 'FEATURE_DISABLED'
  | 'AUTH_REQUIRED'
  | 'CONTENT_NOT_AVAILABLE';

export type RecordStoryDownloadResult =
  | { ok: true; event: DownloadEvent }
  | { ok: false; errorCode: StoryRecordErrorCode };

function normalizeAndTruncateStoryText(
  raw: string | null | undefined,
  maxLength: number,
): string {
  if (!raw || maxLength <= 0) {
    return '';
  }
  const normalized = raw
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{2,}/g, '\n')
    .trim();

  if (!normalized) {
    return '';
  }
  if (normalized.length <= maxLength) {
    return normalized;
  }
  if (maxLength <= 1) {
    return normalized.slice(0, maxLength);
  }
  const sliced = normalized.slice(0, maxLength - 1).trimEnd();
  return `${sliced}…`;
}

export function sanitizePublicSiteUrl(rawUrl: string | null | undefined): string {
  const trimmed = (rawUrl ?? '').trim();
  if (!trimmed) {
    return DEFAULT_PUBLIC_SITE_URL;
  }

  let candidate = trimmed
    .replace(/^https?:\/\//i, '')
    .replace(/#.*$/, '')
    .split('?')[0]
    .replace(/\/+$/, '');

  // Never allow any /admin segment to appear in public story footer metadata
  const adminIdx = candidate.toLowerCase().indexOf('/admin');
  if (adminIdx !== -1) {
    candidate = candidate.slice(0, adminIdx).replace(/\/+$/, '');
  }

  if (!candidate || candidate.toLowerCase() === 'admin') {
    return DEFAULT_PUBLIC_SITE_URL;
  }

  return candidate;
}

export class StoryService {
  private readonly contentRepository: IContentRepository;
  private readonly adminRepository: IAdminRepository;
  private readonly downloadEventRepository: IDownloadEventRepository;
  private readonly clock: IClock;
  private readonly logger?: ILogger;

  constructor(deps: StoryServiceDependencies) {
    this.contentRepository = deps.contentRepository;
    this.adminRepository = deps.adminRepository;
    this.downloadEventRepository = deps.downloadEventRepository;
    this.clock = deps.clock;
    this.logger = deps.logger;
  }

  public canUserGenerateStory(
    currentUser: AppUser | null,
    isFeatureEnabled: boolean,
  ): boolean {
    if (!isFeatureEnabled) {
      return false;
    }
    if (!currentUser || !currentUser.isActive || currentUser.isDeleted) {
      return false;
    }
    return true;
  }

  public prepareStoryDefaults(
    input: PrepareStoryDefaultsInput,
  ): StoryDefaultsData {
    const title = normalizeAndTruncateStoryText(
      input.content.title,
      STORY_TITLE_MAX_LENGTH,
    );
    const trimmedExcerpt = (input.keyExcerpts ?? '').trim();
    const rawQuote = trimmedExcerpt.length > 0 ? trimmedExcerpt : input.content.summary;
    const quote = normalizeAndTruncateStoryText(rawQuote, STORY_QUOTE_MAX_LENGTH);

    const normalizedTopic = (input.topicName ?? '').trim();
    const normalizedSiteTitle = (input.siteTitle ?? '').trim() || 'معراج اندیشه';

    return {
      template: DEFAULT_STORY_TEMPLATE,
      showTitle: true,
      title,
      quote,
      topicName: normalizedTopic.length > 0 ? normalizedTopic : null,
      siteTitle: normalizedSiteTitle,
      siteUrl: sanitizePublicSiteUrl(input.siteUrl),
    };
  }

  public async recordStoryDownloadAsync(
    input: RecordStoryDownloadInput,
  ): Promise<RecordStoryDownloadResult> {
    const flags = await this.adminRepository.getAllFeatureFlags();
    const storyFlag = flags.find((flag) => flag.key === 'StoryGenerator');
    if (!storyFlag || !storyFlag.isEnabled) {
      return { ok: false, errorCode: 'FEATURE_DISABLED' };
    }

    if (
      !input.currentUser ||
      !input.currentUser.isActive ||
      input.currentUser.isDeleted
    ) {
      return { ok: false, errorCode: 'AUTH_REQUIRED' };
    }

    const content = await this.contentRepository.getContentItemById(input.contentId);
    if (!content || content.status !== ContentStatus.Published) {
      return { ok: false, errorCode: 'CONTENT_NOT_AVAILABLE' };
    }

    const ageGroupIds = await this.contentRepository.getAgeGroupIdsByContentId(
      content.id,
    );
    if (!isContentAllowedForAgeGroup(ageGroupIds, input.activeAgeGroup)) {
      return { ok: false, errorCode: 'CONTENT_NOT_AVAILABLE' };
    }

    const event = await this.downloadEventRepository.createDownloadEvent({
      kind: DownloadKind.Story,
      contentId: content.id,
      fileId: null,
      userId: input.currentUser.id,
      ageGroupId:
        input.activeAgeGroup?.id ?? input.currentUser.ageGroupId ?? null,
      occurredAt: this.clock.nowUtcIso(),
    });

    this.logger?.info('Story PNG export event recorded', {
      contentId: content.id,
      downloadEventId: event.id,
      kind: DownloadKind.Story,
    });

    return { ok: true, event };
  }
}
