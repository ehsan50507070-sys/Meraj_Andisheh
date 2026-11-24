import type { IAdminRepository } from '../abstractions/adminRepository';
import type { IBookRepository } from '../abstractions/bookRepository';
import type { IContentRepository } from '../abstractions/contentRepository';
import type { IFileStorage } from '../abstractions/fileStorage';
import type { ILogger } from '../abstractions/ILogger';
import type { ISearchNormalizer } from '../abstractions/searchNormalizer';
import type { ITaxonomyRepository } from '../abstractions/taxonomyRepository';
import type { AppUser } from '../domain/auth';
import {
  ContentStatus,
  type ContentAgeGroup,
  type ContentItem,
  type ContentPerson,
  type ContentTag,
  type ContentTopic,
} from '../domain/content';
import type { PermissionKey } from '../domain/permissions';
import {
  BOOK_AUTHOR_MAX_LENGTH,
  BOOK_KEY_EXCERPTS_MAX_LENGTH,
  BOOK_PAGES_MAX,
  BOOK_PAGES_MIN,
  BOOK_PUBLISHER_MAX_LENGTH,
  BOOK_PUBLISH_YEAR_MAX,
  BOOK_PUBLISH_YEAR_MIN,
  BOOK_STUDIO_NOTE_MAX_LENGTH,
  DEFAULT_BOOK_INFO_VALUES,
  DEFAULT_MAX_RELATED_BOOKS,
  type AdminBookListItem,
  type BookInfo,
  type BookPortalDataResult,
  type BookPortalItem,
  type BookPortalShelf,
  type PublicBookDetailResult,
} from '../domain/portals';
import type { AgeGroup, Person, Tag, Topic } from '../domain/taxonomy';
import {
  isContentAllowedForAgeGroup,
  type AgePriorityGroup,
} from './ageRuleService';
import { buildPrimaryTopicBreadcrumbChain } from './contentDetailService';
import { validateExternalUrl } from './externalLinkService';
import { sanitizeHtml } from './htmlSanitizer';
import { normalizeDigits } from './identifierService';
import { PermissionPolicyService } from './permissionPolicyService';
import { defaultSearchNormalizer, matchesNormalizedQuery } from './searchNormalizer';
import { resolveRootTopicId } from './viewTrackerService';

export const BOOK_PORTALS_ROUTE_PATH = '#/admin/portals';
export const BOOK_PORTALS_PERMISSION_KEY: PermissionKey = 'portals.manage';
export const BOOK_CONTENT_FORM_ROUTE_PATH = '#/admin/content';

export type BookPortalErrorCode =
  | 'NOT_FOUND'
  | 'FORBIDDEN'
  | 'ENTITY_NOT_FOUND'
  | 'INVALID_CONTENT_FORMAT'
  | 'VALIDATION_ERROR';

export interface BookPortalServiceResult<T = void> {
  ok: boolean;
  statusCode: 200 | 400 | 403 | 404;
  data?: T;
  errorCode?: BookPortalErrorCode;
  messageKey?: string;
}

export interface UpsertBookInfoInput {
  contentId: number;
  author: string;
  publisher?: string | null;
  publishYear?: number | string | null;
  pages?: number | string | null;
  keyExcerpts?: string | null;
  studioNote?: string | null;
}

export interface UpsertBookInfoOptions {
  sourceContext?: 'portals' | 'contentForm';
  routePath?: string;
}

export interface PublicBookPortalQuery {
  topicId?: number | null;
  query?: string;
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

function collectTopicSubtreeIds(rootTopicId: number, allTopics: readonly Topic[]): Set<number> {
  const result = new Set<number>([rootTopicId]);
  let expanded = true;
  while (expanded) {
    expanded = false;
    for (const topic of allTopics) {
      if (topic.parentId !== null && result.has(topic.parentId) && !result.has(topic.id)) {
        result.add(topic.id);
        expanded = true;
      }
    }
  }
  return result;
}

export function normalizeBookInfoRecord(
  contentId: number,
  stored: BookInfo | null | undefined,
): BookInfo {
  if (!stored) {
    return {
      contentId,
      ...DEFAULT_BOOK_INFO_VALUES,
    };
  }
  return {
    contentId,
    author: typeof stored.author === 'string' ? stored.author.trim() : '',
    publisher:
      typeof stored.publisher === 'string' && stored.publisher.trim().length > 0
        ? stored.publisher.trim()
        : null,
    publishYear:
      typeof stored.publishYear === 'number' && Number.isSafeInteger(stored.publishYear)
        ? stored.publishYear
        : null,
    pages:
      typeof stored.pages === 'number' && Number.isSafeInteger(stored.pages)
        ? stored.pages
        : null,
    keyExcerpts:
      typeof stored.keyExcerpts === 'string' && stored.keyExcerpts.trim().length > 0
        ? stored.keyExcerpts.trim()
        : null,
    studioNote:
      typeof stored.studioNote === 'string' && stored.studioNote.trim().length > 0
        ? stored.studioNote.trim()
        : null,
  };
}

function parseOptionalIntRange(
  raw: number | string | null | undefined,
  min: number,
  max: number,
): { valid: boolean; parsed: number | null } {
  if (raw === null || raw === undefined || String(raw).trim() === '') {
    return { valid: true, parsed: null };
  }
  const normalized = normalizeDigits(String(raw)).trim();
  if (!/^\d+$/.test(normalized)) {
    return { valid: false, parsed: null };
  }
  const num = Number.parseInt(normalized, 10);
  if (!Number.isSafeInteger(num) || num < min || num > max) {
    return { valid: false, parsed: null };
  }
  return { valid: true, parsed: num };
}

function sortBookPortalItems(items: BookPortalItem[]): BookPortalItem[] {
  return [...items].sort((a, b) => {
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
}

export interface BookPortalServiceDependencies {
  bookRepository: IBookRepository;
  contentRepository: IContentRepository;
  taxonomyRepository: ITaxonomyRepository;
  adminRepository: IAdminRepository;
  policyService: PermissionPolicyService;
  logger: ILogger;
  searchNormalizer?: ISearchNormalizer;
  fileStorage?: IFileStorage;
}

export class BookPortalService {
  private readonly bookRepository: IBookRepository;
  private readonly contentRepository: IContentRepository;
  private readonly taxonomyRepository: ITaxonomyRepository;
  private readonly adminRepository: IAdminRepository;
  private readonly policyService: PermissionPolicyService;
  private readonly logger: ILogger;
  private readonly searchNormalizer: ISearchNormalizer;
  private readonly fileStorage?: IFileStorage;

  constructor(deps: BookPortalServiceDependencies) {
    this.bookRepository = deps.bookRepository;
    this.contentRepository = deps.contentRepository;
    this.taxonomyRepository = deps.taxonomyRepository;
    this.adminRepository = deps.adminRepository;
    this.policyService = deps.policyService;
    this.logger = deps.logger;
    this.searchNormalizer = deps.searchNormalizer ?? defaultSearchNormalizer;
    this.fileStorage = deps.fileStorage;
  }

  private async isBooksModuleEnabledAsync(): Promise<boolean> {
    const flags = await this.adminRepository.getAllFeatureFlags();
    const flag = flags.find((item) => item.key === 'Books');
    return flag?.isEnabled === true;
  }

  private async authorizePortalsManage<T>(
    actor: AppUser | null,
    routePath: string = BOOK_PORTALS_ROUTE_PATH,
  ): Promise<BookPortalServiceResult<T> | null> {
    const auth = await this.policyService.authorizePermission(
      actor,
      BOOK_PORTALS_PERMISSION_KEY,
      routePath,
    );
    if (auth.allowed) {
      return null;
    }
    return {
      ok: false,
      statusCode: auth.statusCode,
      errorCode: auth.statusCode === 404 ? 'NOT_FOUND' : 'FORBIDDEN',
      messageKey: auth.statusCode === 404 ? 'notFound.title' : 'admin.forbidden.title',
    };
  }

  private async authorizeContentOrPortals<T>(
    actor: AppUser | null,
    options?: UpsertBookInfoOptions,
  ): Promise<BookPortalServiceResult<T> | null> {
    if (options?.sourceContext === 'contentForm') {
      const auth = await this.policyService.authorizeAnyPermission(
        actor,
        ['content.manage', BOOK_PORTALS_PERMISSION_KEY],
        options.routePath ?? BOOK_CONTENT_FORM_ROUTE_PATH,
      );
      if (auth.allowed) {
        return null;
      }
      return {
        ok: false,
        statusCode: auth.statusCode,
        errorCode: auth.statusCode === 404 ? 'NOT_FOUND' : 'FORBIDDEN',
        messageKey: auth.statusCode === 404 ? 'notFound.title' : 'admin.forbidden.title',
      };
    }

    return this.authorizePortalsManage<T>(
      actor,
      options?.routePath ?? BOOK_PORTALS_ROUTE_PATH,
    );
  }

  public async getBookInfoByContentIdForAdminAsync(
    actor: AppUser | null,
    contentId: number,
  ): Promise<BookPortalServiceResult<BookInfo>> {
    const denied = await this.authorizeContentOrPortals<BookInfo>(actor, {
      sourceContext: 'contentForm',
      routePath: `${BOOK_CONTENT_FORM_ROUTE_PATH}/edit/${contentId}`,
    });
    if (denied) return denied;

    const stored = await this.bookRepository.getBookInfoByContentIdAsync(contentId);
    return {
      ok: true,
      statusCode: 200,
      data: normalizeBookInfoRecord(contentId, stored),
    };
  }

  public async upsertBookInfoAsync(
    actor: AppUser | null,
    input: UpsertBookInfoInput,
    options?: UpsertBookInfoOptions,
  ): Promise<BookPortalServiceResult<BookInfo>> {
    const denied = await this.authorizeContentOrPortals<BookInfo>(actor, options);
    if (denied || !actor) return denied!;

    const content = await this.contentRepository.getContentItemById(input.contentId);
    if (!content) {
      return {
        ok: false,
        statusCode: 400,
        errorCode: 'ENTITY_NOT_FOUND',
        messageKey: 'admin.portals.book.error.contentNotFound',
      };
    }
    if (content.format !== 'Book') {
      return {
        ok: false,
        statusCode: 400,
        errorCode: 'INVALID_CONTENT_FORMAT',
        messageKey: 'admin.portals.book.error.invalidContentFormat',
      };
    }

    const trimmedAuthor = (input.author ?? '').trim();
    if (trimmedAuthor.length === 0) {
      return {
        ok: false,
        statusCode: 400,
        errorCode: 'VALIDATION_ERROR',
        messageKey: 'admin.portals.book.error.authorRequired',
      };
    }
    if (trimmedAuthor.length > BOOK_AUTHOR_MAX_LENGTH) {
      return {
        ok: false,
        statusCode: 400,
        errorCode: 'VALIDATION_ERROR',
        messageKey: 'admin.portals.book.error.authorTooLong',
      };
    }

    const trimmedPublisher = (input.publisher ?? '').trim();
    if (trimmedPublisher.length > BOOK_PUBLISHER_MAX_LENGTH) {
      return {
        ok: false,
        statusCode: 400,
        errorCode: 'VALIDATION_ERROR',
        messageKey: 'admin.portals.book.error.publisherTooLong',
      };
    }

    const publishYearCheck = parseOptionalIntRange(
      input.publishYear,
      BOOK_PUBLISH_YEAR_MIN,
      BOOK_PUBLISH_YEAR_MAX,
    );
    if (!publishYearCheck.valid) {
      return {
        ok: false,
        statusCode: 400,
        errorCode: 'VALIDATION_ERROR',
        messageKey: 'admin.portals.book.error.invalidPublishYear',
      };
    }

    const pagesCheck = parseOptionalIntRange(
      input.pages,
      BOOK_PAGES_MIN,
      BOOK_PAGES_MAX,
    );
    if (!pagesCheck.valid) {
      return {
        ok: false,
        statusCode: 400,
        errorCode: 'VALIDATION_ERROR',
        messageKey: 'admin.portals.book.error.invalidPages',
      };
    }

    const trimmedExcerpts = (input.keyExcerpts ?? '').trim();
    if (trimmedExcerpts.length > BOOK_KEY_EXCERPTS_MAX_LENGTH) {
      return {
        ok: false,
        statusCode: 400,
        errorCode: 'VALIDATION_ERROR',
        messageKey: 'admin.portals.book.error.keyExcerptsTooLong',
      };
    }

    const trimmedStudioNote = (input.studioNote ?? '').trim();
    if (trimmedStudioNote.length > BOOK_STUDIO_NOTE_MAX_LENGTH) {
      return {
        ok: false,
        statusCode: 400,
        errorCode: 'VALIDATION_ERROR',
        messageKey: 'admin.portals.book.error.studioNoteTooLong',
      };
    }

    const recordToSave: BookInfo = {
      contentId: content.id,
      author: trimmedAuthor,
      publisher: trimmedPublisher.length > 0 ? trimmedPublisher : null,
      publishYear: publishYearCheck.parsed,
      pages: pagesCheck.parsed,
      keyExcerpts: trimmedExcerpts.length > 0 ? trimmedExcerpts : null,
      studioNote: trimmedStudioNote.length > 0 ? trimmedStudioNote : null,
    };

    const saved = await this.bookRepository.upsertBookInfoAsync(recordToSave);

    this.logger.info('PORTAL_BOOK_INFO_SAVED', {
      actorId: actor.id,
      contentId: content.id,
      author: saved.author,
    });

    return {
      ok: true,
      statusCode: 200,
      data: saved,
    };
  }

  public async listAdminBooksAsync(
    actor: AppUser | null,
    search?: string,
  ): Promise<BookPortalServiceResult<AdminBookListItem[]>> {
    const denied = await this.authorizePortalsManage<AdminBookListItem[]>(
      actor,
      BOOK_PORTALS_ROUTE_PATH,
    );
    if (denied) return denied;

    const [allItems, allBookInfos, allTopics, allContentTopics, allSources, allFiles] =
      await Promise.all([
        this.contentRepository.getAllContentItems(),
        this.bookRepository.getAllBookInfosAsync(),
        this.taxonomyRepository.getAllTopics(),
        this.contentRepository.getAllContentTopics(),
        this.contentRepository.getAllSources(),
        this.contentRepository.getAllFiles(),
      ]);

    const bookInfoById = new Map<number, BookInfo>(
      allBookInfos.map((info) => [info.contentId, info]),
    );
    const topicNameById = new Map<number, string>(
      allTopics.map((topic) => [topic.id, topic.name]),
    );
    const topicIdsMap = buildLinkMap<ContentTopic>(allContentTopics, (l) => l.topicId);

    const sourcesCountMap = new Map<number, number>();
    for (const s of allSources) {
      sourcesCountMap.set(s.contentId, (sourcesCountMap.get(s.contentId) ?? 0) + 1);
    }

    const filesCountMap = new Map<number, number>();
    for (const f of allFiles) {
      filesCountMap.set(f.contentId, (filesCountMap.get(f.contentId) ?? 0) + 1);
    }

    const trimmedQuery = (search ?? '').trim();
    const rows: AdminBookListItem[] = [];

    for (const item of allItems) {
      if (item.format !== 'Book') {
        continue;
      }
      const storedInfo = bookInfoById.get(item.id) ?? null;
      const bookInfo = normalizeBookInfoRecord(item.id, storedInfo);
      const tIds = topicIdsMap.get(item.id) ?? [];
      const primaryTopicName = tIds.length > 0 ? (topicNameById.get(tIds[0]) ?? null) : null;

      if (trimmedQuery.length > 0) {
        const matched = matchesNormalizedQuery(
          this.searchNormalizer,
          [
            item.searchText,
            item.title,
            item.summary,
            item.slug,
            bookInfo.author,
            bookInfo.publisher,
            bookInfo.publishYear !== null ? String(bookInfo.publishYear) : '',
            primaryTopicName,
          ],
          trimmedQuery,
        );
        if (!matched) {
          continue;
        }
      }

      rows.push({
        item,
        bookInfo,
        hasExplicitBookInfo: storedInfo !== null,
        primaryTopicName,
        sourcesCount: sourcesCountMap.get(item.id) ?? 0,
        filesCount: filesCountMap.get(item.id) ?? 0,
      });
    }

    rows.sort((a, b) => {
      if (a.item.isFeatured !== b.item.isFeatured) {
        return a.item.isFeatured ? -1 : 1;
      }
      const upd = b.item.updatedAt.localeCompare(a.item.updatedAt);
      return upd !== 0 ? upd : b.item.id - a.item.id;
    });

    return {
      ok: true,
      statusCode: 200,
      data: rows,
    };
  }

  public async getBookPortalDataAsync(
    activeAgeGroup: AgeGroup | null,
    filter?: PublicBookPortalQuery,
  ): Promise<BookPortalDataResult> {
    const enabled = await this.isBooksModuleEnabledAsync();
    if (!enabled) {
      return { enabled: false };
    }

    const [
      allItems,
      allBookInfos,
      allTopics,
      contentTopics,
      contentTags,
      contentPersons,
      contentAgeGroups,
    ] = await Promise.all([
      this.contentRepository.getAllContentItems(),
      this.bookRepository.getAllBookInfosAsync(),
      this.taxonomyRepository.getAllTopics(),
      this.contentRepository.getAllContentTopics(),
      this.contentRepository.getAllContentTags(),
      this.contentRepository.getAllContentPersons(),
      this.contentRepository.getAllContentAgeGroups(),
    ]);

    const bookInfoById = new Map<number, BookInfo>(
      allBookInfos.map((info) => [info.contentId, info]),
    );
    const topicById = new Map<number, Topic>(allTopics.map((topic) => [topic.id, topic]));
    const topicNameById = new Map<number, string>(
      allTopics.map((topic) => [topic.id, topic.name]),
    );

    const topicsByContent = buildLinkMap<ContentTopic>(contentTopics, (l) => l.topicId);
    const tagsByContent = buildLinkMap<ContentTag>(contentTags, (l) => l.tagId);
    const personsByContent = buildLinkMap<ContentPerson>(contentPersons, (l) => l.personId);
    const ageGroupsByContent = buildLinkMap<ContentAgeGroup>(
      contentAgeGroups,
      (l) => l.ageGroupId,
    );

    const allowedBooks: BookPortalItem[] = [];
    const availableRootTopicIds = new Set<number>();

    for (const item of allItems) {
      if (item.status !== ContentStatus.Published || item.format !== 'Book') {
        continue;
      }
      const ageGroupIds = ageGroupsByContent.get(item.id) ?? [];
      if (!isContentAllowedForAgeGroup(ageGroupIds, activeAgeGroup)) {
        continue;
      }

      const bookInfo = normalizeBookInfoRecord(item.id, bookInfoById.get(item.id));
      const tIds = topicsByContent.get(item.id) ?? [];
      for (const tid of tIds) {
        const rootId = resolveRootTopicId([tid], allTopics);
        if (rootId !== null) {
          availableRootTopicIds.add(rootId);
        }
      }

      allowedBooks.push({
        item,
        bookInfo,
        topicIds: tIds,
        tagIds: tagsByContent.get(item.id) ?? [],
        personIds: personsByContent.get(item.id) ?? [],
        ageGroupIds,
        primaryTopicName: tIds.length > 0 ? (topicNameById.get(tIds[0]) ?? null) : null,
        priorityGroup: computePriorityGroup(ageGroupIds, activeAgeGroup),
      });
    }

    const sortedAllAllowed = sortBookPortalItems(allowedBooks);
    const availableTopics = Array.from(availableRootTopicIds)
      .map((id) => topicById.get(id))
      .filter((topic): topic is Topic => Boolean(topic && topic.isActive))
      .sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);

    const selectedTopicSubtree =
      typeof filter?.topicId === 'number' && filter.topicId > 0
        ? collectTopicSubtreeIds(filter.topicId, allTopics)
        : null;
    const rawQuery = (filter?.query ?? '').trim();

    const filteredItems = sortedAllAllowed.filter((entry) => {
      if (
        selectedTopicSubtree &&
        !entry.topicIds.some((tid) => selectedTopicSubtree.has(tid))
      ) {
        return false;
      }
      if (rawQuery.length > 0) {
        return matchesNormalizedQuery(
          this.searchNormalizer,
          [
            entry.item.searchText,
            entry.item.title,
            entry.item.summary,
            entry.bookInfo.author,
            entry.bookInfo.publisher,
            entry.bookInfo.keyExcerpts,
            entry.bookInfo.studioNote,
            entry.bookInfo.publishYear !== null ? String(entry.bookInfo.publishYear) : '',
            entry.primaryTopicName,
          ],
          rawQuery,
        );
      }
      return true;
    });

    const featuredBooks = filteredItems.filter((entry) => entry.item.isFeatured);

    // Build non-empty Topic shelves grouped by active root topics present in filtered books
    const rootTopicBuckets = new Map<number, BookPortalItem[]>();
    for (const entry of filteredItems) {
      const rootIdsForEntry = new Set<number>();
      for (const tid of entry.topicIds) {
        const rootId = resolveRootTopicId([tid], allTopics);
        if (rootId !== null) {
          rootIdsForEntry.add(rootId);
        }
      }
      for (const rootId of rootIdsForEntry) {
        const list = rootTopicBuckets.get(rootId) ?? [];
        list.push(entry);
        rootTopicBuckets.set(rootId, list);
      }
    }

    const shelves: BookPortalShelf[] = Array.from(rootTopicBuckets.entries())
      .map(([rootId, items]) => ({
        id: `topic:${rootId}`,
        topic: topicById.get(rootId),
        items,
      }))
      .filter((entry): entry is { id: string; topic: Topic; items: BookPortalItem[] } =>
        Boolean(entry.topic && entry.topic.isActive && entry.items.length > 0),
      )
      .sort(
        (a, b) => a.topic.sortOrder - b.topic.sortOrder || a.topic.id - b.topic.id,
      );

    return {
      enabled: true,
      data: {
        items: filteredItems,
        featuredBooks,
        allAllowedBooksCount: sortedAllAllowed.length,
        shelves,
        availableTopics,
      },
    };
  }

  public async getPublicBookDetailAsync(
    rawSlug: string,
    activeAgeGroup: AgeGroup | null,
  ): Promise<PublicBookDetailResult> {
    const enabled = await this.isBooksModuleEnabledAsync();
    if (!enabled) {
      return { status: 'not_found' };
    }

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

    if (!item || item.status !== ContentStatus.Published || item.format !== 'Book') {
      return { status: 'not_found' };
    }

    const ageGroupIds = await this.contentRepository.getAgeGroupIdsByContentId(item.id);
    if (!isContentAllowedForAgeGroup(ageGroupIds, activeAgeGroup)) {
      return { status: 'not_found' };
    }

    const [
      storedBookInfo,
      allBookInfos,
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
      allContentTags,
      allContentPersons,
      allContentAgeGroups,
    ] = await Promise.all([
      this.bookRepository.getBookInfoByContentIdAsync(item.id),
      this.bookRepository.getAllBookInfosAsync(),
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
      this.contentRepository.getAllContentTags(),
      this.contentRepository.getAllContentPersons(),
      this.contentRepository.getAllContentAgeGroups(),
    ]);

    const bookInfo = normalizeBookInfoRecord(item.id, storedBookInfo);
    const bookInfoById = new Map<number, BookInfo>(
      allBookInfos.map((info) => [info.contentId, info]),
    );

    const topicById = new Map(allTopics.map((t) => [t.id, t]));
    const topicNameById = new Map(allTopics.map((t) => [t.id, t.name]));
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

    // Related books (published format === 'Book', allowed for activeAgeGroup, max 6)
    const currentTopicSet = new Set<number>(topicIds);
    const currentAuthorLower = bookInfo.author.trim().toLowerCase();
    const topicsByContent = buildLinkMap<ContentTopic>(allContentTopics, (l) => l.topicId);
    const tagsByContent = buildLinkMap<ContentTag>(allContentTags, (l) => l.tagId);
    const personsByContent = buildLinkMap<ContentPerson>(allContentPersons, (l) => l.personId);
    const agesByContent = buildLinkMap<ContentAgeGroup>(allContentAgeGroups, (l) => l.ageGroupId);

    const relatedCandidates: Array<{
      portalItem: BookPortalItem;
      sharedTopics: number;
      sameAuthor: boolean;
    }> = [];

    for (const candidate of allItems) {
      if (
        candidate.id === item.id ||
        candidate.status !== ContentStatus.Published ||
        candidate.format !== 'Book'
      ) {
        continue;
      }
      const candAges = agesByContent.get(candidate.id) ?? [];
      if (!isContentAllowedForAgeGroup(candAges, activeAgeGroup)) {
        continue;
      }
      const candTopics = topicsByContent.get(candidate.id) ?? [];
      let sharedTopics = 0;
      let firstSharedTopicName: string | null = null;
      for (const tid of candTopics) {
        if (currentTopicSet.has(tid)) {
          sharedTopics += 1;
          if (!firstSharedTopicName) {
            firstSharedTopicName = topicNameById.get(tid) ?? null;
          }
        }
      }
      const candBookInfo = normalizeBookInfoRecord(
        candidate.id,
        bookInfoById.get(candidate.id),
      );
      const sameAuthor =
        currentAuthorLower.length > 0 &&
        candBookInfo.author.trim().toLowerCase() === currentAuthorLower;

      if (sharedTopics === 0 && !sameAuthor) {
        continue;
      }

      relatedCandidates.push({
        portalItem: {
          item: candidate,
          bookInfo: candBookInfo,
          topicIds: candTopics,
          tagIds: tagsByContent.get(candidate.id) ?? [],
          personIds: personsByContent.get(candidate.id) ?? [],
          ageGroupIds: candAges,
          primaryTopicName:
            firstSharedTopicName ??
            (candTopics.length > 0 ? (topicNameById.get(candTopics[0]) ?? null) : null),
          priorityGroup: computePriorityGroup(candAges, activeAgeGroup),
        },
        sharedTopics,
        sameAuthor,
      });
    }

    relatedCandidates.sort((a, b) => {
      if (b.sharedTopics !== a.sharedTopics) {
        return b.sharedTopics - a.sharedTopics;
      }
      if (a.sameAuthor !== b.sameAuthor) {
        return a.sameAuthor ? -1 : 1;
      }
      if (a.portalItem.priorityGroup !== b.portalItem.priorityGroup) {
        return a.portalItem.priorityGroup - b.portalItem.priorityGroup;
      }
      const pubDiff =
        parseTimestampMs(b.portalItem.item.publishedAt) -
        parseTimestampMs(a.portalItem.item.publishedAt);
      if (pubDiff !== 0) {
        return pubDiff;
      }
      return b.portalItem.item.id - a.portalItem.item.id;
    });

    const relatedBooks = relatedCandidates
      .slice(0, DEFAULT_MAX_RELATED_BOOKS)
      .map((entry) => entry.portalItem);

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
        bookInfo,
        sanitizedBodyHtml: sanitizeHtml(item.body),
        sources: safeSources,
        files: sortedFiles,
        topics: resolvedTopics,
        topicBreadcrumbChain,
        primaryRootTopicId,
        tags: resolvedTags,
        persons: resolvedPersons,
        impactLevel:
          item.impactLevelId !== null ? (impactById.get(item.impactLevelId) ?? null) : null,
        targetAgeGroups: resolvedAges,
        relatedBooks,
      },
    };
  }

  public async openPreviewMediaAsync(
    contentId: number,
    storageKey: string,
    activeAgeGroup: AgeGroup | null,
  ): Promise<{ bytes: Uint8Array; mimeType: string } | null> {
    if (!this.fileStorage || !storageKey) {
      return null;
    }

    const enabled = await this.isBooksModuleEnabledAsync();
    if (!enabled) {
      return null;
    }

    const item = await this.contentRepository.getContentItemById(contentId);
    if (!item || item.status !== ContentStatus.Published || item.format !== 'Book') {
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
}
