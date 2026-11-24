import type { IAdminRepository } from '../abstractions/adminRepository';
import type { IContentRepository } from '../abstractions/contentRepository';
import type { IFileStorage } from '../abstractions/fileStorage';
import type { IFilmRepository } from '../abstractions/filmRepository';
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
  DEFAULT_FILM_INFO_VALUES,
  DEFAULT_MAX_RELATED_FILMS,
  FILM_AGE_RATING_NOTE_MAX_LENGTH,
  FILM_KINDS,
  FILM_RELEASE_YEAR_MAX,
  FILM_RELEASE_YEAR_MIN,
  FILM_RUNTIME_MAX,
  FILM_RUNTIME_MIN,
  type AdminFilmListItem,
  type FilmInfo,
  type FilmKind,
  type FilmPortalDataResult,
  type FilmPortalItem,
  type FilmPortalShelf,
  type PublicFilmDetailResult,
} from '../domain/portals';
import type { AgeGroup, Person, Tag, Topic } from '../domain/taxonomy';
import {
  isContentAllowedForAgeGroup,
  type AgePriorityGroup,
} from './ageRuleService';
import { buildPrimaryTopicBreadcrumbChain } from './contentDetailService';
import { resolveAparatEmbedUrl, validateExternalUrl } from './externalLinkService';
import { sanitizeHtml } from './htmlSanitizer';
import { normalizeDigits } from './identifierService';
import { PermissionPolicyService } from './permissionPolicyService';
import { defaultSearchNormalizer, matchesNormalizedQuery } from './searchNormalizer';
import { resolveRootTopicId } from './viewTrackerService';

export const PORTALS_ROUTE_PATH = '#/admin/portals';
export const PORTALS_PERMISSION_KEY: PermissionKey = 'portals.manage';
export const CONTENT_FORM_ROUTE_PATH = '#/admin/content';

export type FilmPortalErrorCode =
  | 'NOT_FOUND'
  | 'FORBIDDEN'
  | 'ENTITY_NOT_FOUND'
  | 'INVALID_CONTENT_FORMAT'
  | 'VALIDATION_ERROR';

export interface FilmPortalServiceResult<T = void> {
  ok: boolean;
  statusCode: 200 | 400 | 403 | 404;
  data?: T;
  errorCode?: FilmPortalErrorCode;
  messageKey?: string;
}

export interface UpsertFilmInfoInput {
  contentId: number;
  kind: FilmKind | string;
  releaseYear?: number | string | null;
  runtimeMinutes?: number | string | null;
  ageRatingNote?: string | null;
  isWeeklyPick: boolean;
}

export interface UpsertFilmInfoOptions {
  sourceContext?: 'portals' | 'contentForm';
  routePath?: string;
}

export interface PublicFilmPortalQuery {
  kind?: 'all' | FilmKind;
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

export function isValidFilmKind(value: unknown): value is FilmKind {
  return typeof value === 'string' && (FILM_KINDS as readonly string[]).includes(value);
}

export function normalizeFilmInfoRecord(
  contentId: number,
  stored: FilmInfo | null | undefined,
): FilmInfo {
  if (!stored) {
    return {
      contentId,
      ...DEFAULT_FILM_INFO_VALUES,
    };
  }
  return {
    contentId,
    kind: isValidFilmKind(stored.kind) ? stored.kind : DEFAULT_FILM_INFO_VALUES.kind,
    releaseYear:
      typeof stored.releaseYear === 'number' && Number.isSafeInteger(stored.releaseYear)
        ? stored.releaseYear
        : null,
    runtimeMinutes:
      typeof stored.runtimeMinutes === 'number' && Number.isSafeInteger(stored.runtimeMinutes)
        ? stored.runtimeMinutes
        : null,
    ageRatingNote:
      typeof stored.ageRatingNote === 'string' && stored.ageRatingNote.trim().length > 0
        ? stored.ageRatingNote.trim()
        : null,
    isWeeklyPick: Boolean(stored.isWeeklyPick),
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

function sortFilmPortalItems(items: FilmPortalItem[]): FilmPortalItem[] {
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

export interface FilmPortalServiceDependencies {
  filmRepository: IFilmRepository;
  contentRepository: IContentRepository;
  taxonomyRepository: ITaxonomyRepository;
  adminRepository: IAdminRepository;
  policyService: PermissionPolicyService;
  logger: ILogger;
  searchNormalizer?: ISearchNormalizer;
  fileStorage?: IFileStorage;
}

export class FilmPortalService {
  private readonly filmRepository: IFilmRepository;
  private readonly contentRepository: IContentRepository;
  private readonly taxonomyRepository: ITaxonomyRepository;
  private readonly adminRepository: IAdminRepository;
  private readonly policyService: PermissionPolicyService;
  private readonly logger: ILogger;
  private readonly searchNormalizer: ISearchNormalizer;
  private readonly fileStorage?: IFileStorage;

  constructor(deps: FilmPortalServiceDependencies) {
    this.filmRepository = deps.filmRepository;
    this.contentRepository = deps.contentRepository;
    this.taxonomyRepository = deps.taxonomyRepository;
    this.adminRepository = deps.adminRepository;
    this.policyService = deps.policyService;
    this.logger = deps.logger;
    this.searchNormalizer = deps.searchNormalizer ?? defaultSearchNormalizer;
    this.fileStorage = deps.fileStorage;
  }

  private async isFilmsModuleEnabledAsync(): Promise<boolean> {
    const flags = await this.adminRepository.getAllFeatureFlags();
    const flag = flags.find((item) => item.key === 'Films');
    return flag?.isEnabled === true;
  }

  private async authorizePortalsManage<T>(
    actor: AppUser | null,
    routePath: string = PORTALS_ROUTE_PATH,
  ): Promise<FilmPortalServiceResult<T> | null> {
    const auth = await this.policyService.authorizePermission(
      actor,
      PORTALS_PERMISSION_KEY,
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
    options?: UpsertFilmInfoOptions,
  ): Promise<FilmPortalServiceResult<T> | null> {
    if (options?.sourceContext === 'contentForm') {
      const auth = await this.policyService.authorizeAnyPermission(
        actor,
        ['content.manage', PORTALS_PERMISSION_KEY],
        options.routePath ?? CONTENT_FORM_ROUTE_PATH,
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

    return this.authorizePortalsManage<T>(actor, options?.routePath ?? PORTALS_ROUTE_PATH);
  }

  public async getFilmInfoByContentIdForAdminAsync(
    actor: AppUser | null,
    contentId: number,
  ): Promise<FilmPortalServiceResult<FilmInfo>> {
    const denied = await this.authorizeContentOrPortals<FilmInfo>(actor, {
      sourceContext: 'contentForm',
      routePath: `${CONTENT_FORM_ROUTE_PATH}/edit/${contentId}`,
    });
    if (denied) return denied;

    const stored = await this.filmRepository.getFilmInfoByContentIdAsync(contentId);
    return {
      ok: true,
      statusCode: 200,
      data: normalizeFilmInfoRecord(contentId, stored),
    };
  }

  public async upsertFilmInfoAsync(
    actor: AppUser | null,
    input: UpsertFilmInfoInput,
    options?: UpsertFilmInfoOptions,
  ): Promise<FilmPortalServiceResult<FilmInfo>> {
    const denied = await this.authorizeContentOrPortals<FilmInfo>(actor, options);
    if (denied || !actor) return denied!;

    const content = await this.contentRepository.getContentItemById(input.contentId);
    if (!content) {
      return {
        ok: false,
        statusCode: 400,
        errorCode: 'ENTITY_NOT_FOUND',
        messageKey: 'admin.portals.film.error.contentNotFound',
      };
    }
    if (content.format !== 'Film') {
      return {
        ok: false,
        statusCode: 400,
        errorCode: 'INVALID_CONTENT_FORMAT',
        messageKey: 'admin.portals.film.error.invalidContentFormat',
      };
    }

    if (!isValidFilmKind(input.kind)) {
      return {
        ok: false,
        statusCode: 400,
        errorCode: 'VALIDATION_ERROR',
        messageKey: 'admin.portals.film.error.invalidKind',
      };
    }

    const releaseYearCheck = parseOptionalIntRange(
      input.releaseYear,
      FILM_RELEASE_YEAR_MIN,
      FILM_RELEASE_YEAR_MAX,
    );
    if (!releaseYearCheck.valid) {
      return {
        ok: false,
        statusCode: 400,
        errorCode: 'VALIDATION_ERROR',
        messageKey: 'admin.portals.film.error.invalidReleaseYear',
      };
    }

    const runtimeCheck = parseOptionalIntRange(
      input.runtimeMinutes,
      FILM_RUNTIME_MIN,
      FILM_RUNTIME_MAX,
    );
    if (!runtimeCheck.valid) {
      return {
        ok: false,
        statusCode: 400,
        errorCode: 'VALIDATION_ERROR',
        messageKey: 'admin.portals.film.error.invalidRuntimeMinutes',
      };
    }

    const trimmedNote = (input.ageRatingNote ?? '').trim();
    if (trimmedNote.length > FILM_AGE_RATING_NOTE_MAX_LENGTH) {
      return {
        ok: false,
        statusCode: 400,
        errorCode: 'VALIDATION_ERROR',
        messageKey: 'admin.portals.film.error.ageNoteTooLong',
      };
    }

    const recordToSave: FilmInfo = {
      contentId: content.id,
      kind: input.kind,
      releaseYear: releaseYearCheck.parsed,
      runtimeMinutes: runtimeCheck.parsed,
      ageRatingNote: trimmedNote.length > 0 ? trimmedNote : null,
      isWeeklyPick: Boolean(input.isWeeklyPick),
    };

    const saved = recordToSave.isWeeklyPick
      ? await this.filmRepository.setWeeklyPickExclusiveAsync(content.id, recordToSave)
      : await this.filmRepository.upsertFilmInfoAsync(recordToSave);

    this.logger.info('PORTAL_FILM_INFO_SAVED', {
      actorId: actor.id,
      contentId: content.id,
      kind: saved.kind,
      isWeeklyPick: saved.isWeeklyPick,
    });

    return {
      ok: true,
      statusCode: 200,
      data: saved,
    };
  }

  public async setWeeklyPickAsync(
    actor: AppUser | null,
    contentId: number,
  ): Promise<FilmPortalServiceResult<FilmInfo>> {
    const denied = await this.authorizePortalsManage<FilmInfo>(actor, PORTALS_ROUTE_PATH);
    if (denied || !actor) return denied!;

    const content = await this.contentRepository.getContentItemById(contentId);
    if (!content) {
      return {
        ok: false,
        statusCode: 400,
        errorCode: 'ENTITY_NOT_FOUND',
        messageKey: 'admin.portals.film.error.contentNotFound',
      };
    }
    if (content.format !== 'Film') {
      return {
        ok: false,
        statusCode: 400,
        errorCode: 'INVALID_CONTENT_FORMAT',
        messageKey: 'admin.portals.film.error.invalidContentFormat',
      };
    }

    const existing = await this.filmRepository.getFilmInfoByContentIdAsync(content.id);
    const normalizedBase = normalizeFilmInfoRecord(content.id, existing);
    const updated = await this.filmRepository.setWeeklyPickExclusiveAsync(content.id, {
      ...normalizedBase,
      isWeeklyPick: true,
    });

    this.logger.info('PORTAL_FILM_WEEKLY_PICK_UPDATED', {
      actorId: actor.id,
      contentId: content.id,
      title: content.title,
    });

    return {
      ok: true,
      statusCode: 200,
      data: updated,
    };
  }

  public async listAdminFilmsAsync(
    actor: AppUser | null,
    search?: string,
  ): Promise<FilmPortalServiceResult<AdminFilmListItem[]>> {
    const denied = await this.authorizePortalsManage<AdminFilmListItem[]>(
      actor,
      PORTALS_ROUTE_PATH,
    );
    if (denied) return denied;

    const [allItems, allFilmInfos, allTopics, allContentTopics, allSources, allFiles] =
      await Promise.all([
        this.contentRepository.getAllContentItems(),
        this.filmRepository.getAllFilmInfosAsync(),
        this.taxonomyRepository.getAllTopics(),
        this.contentRepository.getAllContentTopics(),
        this.contentRepository.getAllSources(),
        this.contentRepository.getAllFiles(),
      ]);

    const filmInfoById = new Map<number, FilmInfo>(
      allFilmInfos.map((info) => [info.contentId, info]),
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
    const rows: AdminFilmListItem[] = [];

    for (const item of allItems) {
      if (item.format !== 'Film') {
        continue;
      }
      const storedInfo = filmInfoById.get(item.id) ?? null;
      const filmInfo = normalizeFilmInfoRecord(item.id, storedInfo);
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
            filmInfo.ageRatingNote,
            filmInfo.releaseYear !== null ? String(filmInfo.releaseYear) : '',
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
        filmInfo,
        hasExplicitFilmInfo: storedInfo !== null,
        primaryTopicName,
        sourcesCount: sourcesCountMap.get(item.id) ?? 0,
        filesCount: filesCountMap.get(item.id) ?? 0,
      });
    }

    rows.sort((a, b) => {
      if (a.filmInfo.isWeeklyPick !== b.filmInfo.isWeeklyPick) {
        return a.filmInfo.isWeeklyPick ? -1 : 1;
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

  public async getFilmPortalDataAsync(
    activeAgeGroup: AgeGroup | null,
    filter?: PublicFilmPortalQuery,
  ): Promise<FilmPortalDataResult> {
    const enabled = await this.isFilmsModuleEnabledAsync();
    if (!enabled) {
      return { enabled: false };
    }

    const [
      allItems,
      allFilmInfos,
      allTopics,
      contentTopics,
      contentTags,
      contentPersons,
      contentAgeGroups,
    ] = await Promise.all([
      this.contentRepository.getAllContentItems(),
      this.filmRepository.getAllFilmInfosAsync(),
      this.taxonomyRepository.getAllTopics(),
      this.contentRepository.getAllContentTopics(),
      this.contentRepository.getAllContentTags(),
      this.contentRepository.getAllContentPersons(),
      this.contentRepository.getAllContentAgeGroups(),
    ]);

    const filmInfoById = new Map<number, FilmInfo>(
      allFilmInfos.map((info) => [info.contentId, info]),
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

    const countsByKind: Record<FilmKind, number> = {
      Film: 0,
      Documentary: 0,
      Animation: 0,
    };

    const allowedFilms: FilmPortalItem[] = [];

    for (const item of allItems) {
      if (item.status !== ContentStatus.Published || item.format !== 'Film') {
        continue;
      }
      const ageGroupIds = ageGroupsByContent.get(item.id) ?? [];
      if (!isContentAllowedForAgeGroup(ageGroupIds, activeAgeGroup)) {
        continue;
      }

      const filmInfo = normalizeFilmInfoRecord(item.id, filmInfoById.get(item.id));
      countsByKind[filmInfo.kind] += 1;

      const tIds = topicsByContent.get(item.id) ?? [];
      allowedFilms.push({
        item,
        filmInfo,
        topicIds: tIds,
        tagIds: tagsByContent.get(item.id) ?? [],
        personIds: personsByContent.get(item.id) ?? [],
        ageGroupIds,
        primaryTopicName: tIds.length > 0 ? (topicNameById.get(tIds[0]) ?? null) : null,
        priorityGroup: computePriorityGroup(ageGroupIds, activeAgeGroup),
      });
    }

    const sortedAllAllowed = sortFilmPortalItems(allowedFilms);
    const weeklyPick = sortedAllAllowed.find((entry) => entry.filmInfo.isWeeklyPick) ?? null;

    const kindFilter = filter?.kind && filter.kind !== 'all' ? filter.kind : null;
    const rawQuery = (filter?.query ?? '').trim();

    const filteredItems = sortedAllAllowed.filter((entry) => {
      if (kindFilter && entry.filmInfo.kind !== kindFilter) {
        return false;
      }
      if (rawQuery.length > 0) {
        return matchesNormalizedQuery(
          this.searchNormalizer,
          [
            entry.item.searchText,
            entry.item.title,
            entry.item.summary,
            entry.filmInfo.ageRatingNote,
            entry.filmInfo.releaseYear !== null ? String(entry.filmInfo.releaseYear) : '',
            entry.primaryTopicName,
          ],
          rawQuery,
        );
      }
      return true;
    });

    const shelves: FilmPortalShelf[] = [];
    const orderedShelfKinds: readonly FilmKind[] = ['Documentary', 'Film', 'Animation'];

    for (const kind of orderedShelfKinds) {
      const kindItems = filteredItems.filter((entry) => entry.filmInfo.kind === kind);
      if (kindItems.length > 0) {
        shelves.push({
          id: `kind:${kind}`,
          shelfType: 'kind',
          filmKind: kind,
          items: kindItems,
        });
      }
    }

    // Topic shelves grouped by active root topics present among filtered films
    const rootTopicBuckets = new Map<number, FilmPortalItem[]>();
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

    const topicEntries = Array.from(rootTopicBuckets.entries())
      .map(([rootId, items]) => ({
        topic: topicById.get(rootId),
        items,
      }))
      .filter((entry): entry is { topic: Topic; items: FilmPortalItem[] } =>
        Boolean(entry.topic && entry.items.length > 0),
      )
      .sort(
        (a, b) =>
          a.topic.sortOrder - b.topic.sortOrder || a.topic.id - b.topic.id,
      );

    for (const topicShelf of topicEntries) {
      shelves.push({
        id: `topic:${topicShelf.topic.id}`,
        shelfType: 'topic',
        topic: topicShelf.topic,
        items: topicShelf.items,
      });
    }

    return {
      enabled: true,
      data: {
        items: filteredItems,
        allAllowedFilmsCount: sortedAllAllowed.length,
        weeklyPick,
        shelves,
        countsByKind,
      },
    };
  }

  public async getPublicFilmDetailAsync(
    rawSlug: string,
    activeAgeGroup: AgeGroup | null,
  ): Promise<PublicFilmDetailResult> {
    const enabled = await this.isFilmsModuleEnabledAsync();
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

    if (!item || item.status !== ContentStatus.Published || item.format !== 'Film') {
      return { status: 'not_found' };
    }

    const ageGroupIds = await this.contentRepository.getAgeGroupIdsByContentId(item.id);
    if (!isContentAllowedForAgeGroup(ageGroupIds, activeAgeGroup)) {
      return { status: 'not_found' };
    }

    const [
      storedFilmInfo,
      allFilmInfos,
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
      this.filmRepository.getFilmInfoByContentIdAsync(item.id),
      this.filmRepository.getAllFilmInfosAsync(),
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

    const filmInfo = normalizeFilmInfoRecord(item.id, storedFilmInfo);
    const filmInfoById = new Map<number, FilmInfo>(
      allFilmInfos.map((info) => [info.contentId, info]),
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

    // Related films (published format === 'Film', allowed for activeAgeGroup, max 6)
    const currentTopicSet = new Set<number>(topicIds);
    const topicsByContent = buildLinkMap<ContentTopic>(allContentTopics, (l) => l.topicId);
    const tagsByContent = buildLinkMap<ContentTag>(allContentTags, (l) => l.tagId);
    const personsByContent = buildLinkMap<ContentPerson>(allContentPersons, (l) => l.personId);
    const agesByContent = buildLinkMap<ContentAgeGroup>(allContentAgeGroups, (l) => l.ageGroupId);

    const relatedCandidates: Array<{
      portalItem: FilmPortalItem;
      sharedTopics: number;
      sameKind: boolean;
    }> = [];

    for (const candidate of allItems) {
      if (
        candidate.id === item.id ||
        candidate.status !== ContentStatus.Published ||
        candidate.format !== 'Film'
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
      const candFilmInfo = normalizeFilmInfoRecord(
        candidate.id,
        filmInfoById.get(candidate.id),
      );
      const sameKind = candFilmInfo.kind === filmInfo.kind;
      if (sharedTopics === 0 && !sameKind) {
        continue;
      }

      relatedCandidates.push({
        portalItem: {
          item: candidate,
          filmInfo: candFilmInfo,
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
        sameKind,
      });
    }

    relatedCandidates.sort((a, b) => {
      if (b.sharedTopics !== a.sharedTopics) {
        return b.sharedTopics - a.sharedTopics;
      }
      if (a.sameKind !== b.sameKind) {
        return a.sameKind ? -1 : 1;
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

    const relatedFilms = relatedCandidates
      .slice(0, DEFAULT_MAX_RELATED_FILMS)
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
        filmInfo,
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
        relatedFilms,
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

    const enabled = await this.isFilmsModuleEnabledAsync();
    if (!enabled) {
      return null;
    }

    const item = await this.contentRepository.getContentItemById(contentId);
    if (!item || item.status !== ContentStatus.Published || item.format !== 'Film') {
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
