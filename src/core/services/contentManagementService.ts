import type { IClock } from '../abstractions/IClock';
import type { ILogger } from '../abstractions/ILogger';
import type {
  ContentAggregate,
  IContentRepository,
} from '../abstractions/contentRepository';
import type { ISearchNormalizer } from '../abstractions/searchNormalizer';
import type { ITaxonomyRepository } from '../abstractions/taxonomyRepository';
import type { AppUser } from '../domain/auth';
import {
  CONTENT_FORMATS,
  ContentFileKind,
  ContentStatus,
  FileStorageType,
  type ContentFile,
  type ContentFormat,
  type ContentItem,
  type ContentSource,
} from '../domain/content';
import type { PermissionKey } from '../domain/permissions';
import type { StoredFileMetadata } from '../domain/storage';
import type {
  AgeGroup,
  ImpactLevel,
  Person,
  Tag,
  Topic,
} from '../domain/taxonomy';
import {
  CONTENT_SUMMARY_MAX_LENGTH,
  CONTENT_TITLE_MAX_LENGTH,
  SOURCE_TITLE_MAX_LENGTH,
  validateForPublish,
  type PublishValidationError,
} from './contentPublishValidator';
import { validateExternalUrl } from './externalLinkService';
import { FileUploadService, type UploadFileInput } from './fileUploadService';
import { sanitizeHtml } from './htmlSanitizer';
import { normalizeDigits } from './identifierService';
import { PermissionPolicyService } from './permissionPolicyService';
import { matchesNormalizedQuery } from './searchNormalizer';
import { ensureUniqueSlug } from './slugService';
import { buildTopicTree, type TopicTreeNode } from './taxonomyService';

export const CONTENT_ROUTE_PATH = '#/admin/content';
export const CONTENT_PERMISSION_KEY: PermissionKey = 'content.manage';
export const SOURCE_NOTE_MAX_LENGTH = 500;
export const MAX_READ_WATCH_MINUTES = 10000;

export type ContentManagementErrorCode =
  | 'NOT_FOUND'
  | 'FORBIDDEN'
  | 'ENTITY_NOT_FOUND'
  | 'VALIDATION_ERROR'
  | 'INVALID_CREATED_BY_USER'
  | 'PUBLISH_VALIDATION_FAILED'
  | 'FILE_UPLOAD_FAILED';

export interface ContentServiceResult<T = void> {
  ok: boolean;
  statusCode: 200 | 400 | 403 | 404;
  data?: T;
  errorCode?: ContentManagementErrorCode;
  messageKey?: string;
  validationErrors?: PublishValidationError[];
}

export interface AdminContentListFilter {
  search?: string;
  status?: 'all' | ContentStatus;
  format?: 'all' | ContentFormat;
  topicId?: 'all' | number;
  page?: number;
  pageSize?: number;
}

export interface AdminContentSummary {
  item: ContentItem;
  sourcesCount: number;
  filesCount: number;
  topicIds: number[];
  ageGroupIds: number[];
}

export interface AdminContentListResult {
  items: AdminContentSummary[];
  totalCount: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface SaveContentSourceInput {
  title: string;
  url?: string | null;
  note?: string | null;
  sortOrder?: number;
}

export interface SaveContentFileInput {
  kind: ContentFileKind;
  storageType: FileStorageType;
  storageKey?: string | null;
  externalUrl?: string | null;
  originalFileName: string;
  mimeType: string;
  sizeBytes?: number | null;
  isDownloadable: boolean;
  sortOrder?: number;
}

export interface SaveContentDraftInput {
  id?: number | null;
  title: string;
  slug?: string;
  summary: string;
  body?: string | null;
  format: ContentFormat;
  impactLevelId?: number | null;
  readWatchMinutes?: number | string | null;
  thumbnailKey?: string | null;
  isFeatured: boolean;
  sources: SaveContentSourceInput[];
  files: SaveContentFileInput[];
  topicIds: number[];
  tagIds: number[];
  personIds: number[];
  ageGroupIds: number[];
}

export interface ContentTaxonomyOptions {
  topics: Topic[];
  topicTree: TopicTreeNode[];
  tags: Tag[];
  persons: Person[];
  impactLevels: ImpactLevel[];
  activeAgeGroups: AgeGroup[];
}

function parseOptionalPositiveMinutes(
  value: number | string | null | undefined,
): { valid: boolean; parsed: number | null } {
  if (value === null || value === undefined || String(value).trim() === '') {
    return { valid: true, parsed: null };
  }
  const normalized = normalizeDigits(String(value)).trim();
  if (!/^\d+$/.test(normalized)) {
    return { valid: false, parsed: null };
  }
  const num = Number(normalized);
  if (!Number.isSafeInteger(num) || num <= 0 || num > MAX_READ_WATCH_MINUTES) {
    return { valid: false, parsed: null };
  }
  return { valid: true, parsed: num };
}

function isValidFormat(value: unknown): value is ContentFormat {
  return typeof value === 'string' && (CONTENT_FORMATS as readonly string[]).includes(value);
}

export class ContentManagementService {
  private readonly contentRepository: IContentRepository;
  private readonly taxonomyRepository: ITaxonomyRepository;
  private readonly policyService: PermissionPolicyService;
  private readonly fileUploadService: FileUploadService;
  private readonly searchNormalizer: ISearchNormalizer;
  private readonly clock: IClock;
  private readonly logger: ILogger;

  constructor(
    contentRepository: IContentRepository,
    taxonomyRepository: ITaxonomyRepository,
    policyService: PermissionPolicyService,
    fileUploadService: FileUploadService,
    searchNormalizer: ISearchNormalizer,
    clock: IClock,
    logger: ILogger,
  ) {
    this.contentRepository = contentRepository;
    this.taxonomyRepository = taxonomyRepository;
    this.policyService = policyService;
    this.fileUploadService = fileUploadService;
    this.searchNormalizer = searchNormalizer;
    this.clock = clock;
    this.logger = logger;
  }

  private async authorizeContent<T>(
    actor: AppUser | null,
    routePath: string = CONTENT_ROUTE_PATH,
  ): Promise<ContentServiceResult<T> | null> {
    const auth = await this.policyService.authorizePermission(
      actor,
      CONTENT_PERMISSION_KEY,
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

  private async loadAggregateInternal(contentId: number): Promise<ContentAggregate | null> {
    const item = await this.contentRepository.getContentItemById(contentId);
    if (!item) {
      return null;
    }
    const [sources, files, topicIds, tagIds, personIds, ageGroupIds] = await Promise.all([
      this.contentRepository.getSourcesByContentId(contentId),
      this.contentRepository.getFilesByContentId(contentId),
      this.contentRepository.getTopicIdsByContentId(contentId),
      this.contentRepository.getTagIdsByContentId(contentId),
      this.contentRepository.getPersonIdsByContentId(contentId),
      this.contentRepository.getAgeGroupIdsByContentId(contentId),
    ]);

    return {
      item,
      sources,
      files,
      topicIds,
      tagIds,
      personIds,
      ageGroupIds,
    };
  }

  private async buildNormalizedSearchTextFor(params: {
    title: string;
    summary: string;
    bodyHtml: string | null;
    topicIds: readonly number[];
    tagIds: readonly number[];
    personIds: readonly number[];
    sources: readonly Pick<ContentSource, 'title'>[];
  }): Promise<string> {
    const [allTopics, allTags, allPersons] = await Promise.all([
      this.taxonomyRepository.getAllTopics(),
      this.taxonomyRepository.getAllTags(),
      this.taxonomyRepository.getAllPersons(),
    ]);

    const topicSet = new Set(params.topicIds);
    const tagSet = new Set(params.tagIds);
    const personSet = new Set(params.personIds);

    return this.searchNormalizer.buildSearchText({
      title: params.title,
      summary: params.summary,
      bodyHtml: params.bodyHtml,
      topicNames: allTopics.filter((x) => topicSet.has(x.id)).map((x) => x.name),
      tagNames: allTags.filter((x) => tagSet.has(x.id)).map((x) => x.name),
      personNames: allPersons.filter((x) => personSet.has(x.id)).map((x) => x.name),
      sourceTitles: params.sources.map((s) => s.title),
    });
  }

  public async getTaxonomyOptionsForContent(
    actor: AppUser | null,
  ): Promise<ContentServiceResult<ContentTaxonomyOptions>> {
    const denied = await this.authorizeContent<ContentTaxonomyOptions>(actor);
    if (denied) return denied;

    const [topics, tags, persons, impactLevels, allAgeGroups] = await Promise.all([
      this.taxonomyRepository.getAllTopics(),
      this.taxonomyRepository.getAllTags(),
      this.taxonomyRepository.getAllPersons(),
      this.taxonomyRepository.getAllImpactLevels(),
      this.taxonomyRepository.getAllAgeGroups(),
    ]);

    const sortedTopics = [...topics].sort(
      (a, b) => a.sortOrder - b.sortOrder || a.id - b.id,
    );
    const topicTree = buildTopicTree(sortedTopics, new Map());
    const sortedTags = [...tags].sort((a, b) => a.name.localeCompare(b.name, 'fa'));
    const sortedPersons = [...persons].sort((a, b) => a.name.localeCompare(b.name, 'fa'));
    const sortedImpacts = [...impactLevels].sort(
      (a, b) => a.sortOrder - b.sortOrder || a.id - b.id,
    );
    const activeAgeGroups = allAgeGroups
      .filter((group) => group.isActive)
      .sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);

    return {
      ok: true,
      statusCode: 200,
      data: {
        topics: sortedTopics,
        topicTree,
        tags: sortedTags,
        persons: sortedPersons,
        impactLevels: sortedImpacts,
        activeAgeGroups,
      },
    };
  }

  public async listAdminContents(
    actor: AppUser | null,
    filter: AdminContentListFilter = {},
  ): Promise<ContentServiceResult<AdminContentListResult>> {
    const denied = await this.authorizeContent<AdminContentListResult>(actor);
    if (denied) return denied;

    const [allItems, allSources, allFiles, allContentTopics, allContentAgeGroups] =
      await Promise.all([
        this.contentRepository.getAllContentItems(),
        this.contentRepository.getAllSources(),
        this.contentRepository.getAllFiles(),
        this.contentRepository.getAllContentTopics(),
        this.contentRepository.getAllContentAgeGroups(),
      ]);

    const sourcesCountMap = new Map<number, number>();
    for (const s of allSources) {
      sourcesCountMap.set(s.contentId, (sourcesCountMap.get(s.contentId) ?? 0) + 1);
    }

    const filesCountMap = new Map<number, number>();
    for (const f of allFiles) {
      filesCountMap.set(f.contentId, (filesCountMap.get(f.contentId) ?? 0) + 1);
    }

    const topicIdsMap = new Map<number, number[]>();
    for (const ct of allContentTopics) {
      const arr = topicIdsMap.get(ct.contentId) ?? [];
      arr.push(ct.topicId);
      topicIdsMap.set(ct.contentId, arr);
    }

    const ageGroupIdsMap = new Map<number, number[]>();
    for (const cag of allContentAgeGroups) {
      const arr = ageGroupIdsMap.get(cag.contentId) ?? [];
      arr.push(cag.ageGroupId);
      ageGroupIdsMap.set(cag.contentId, arr);
    }

    const filtered = allItems
      .filter((item) => {
        if (filter.status && filter.status !== 'all' && item.status !== filter.status) {
          return false;
        }
        if (filter.format && filter.format !== 'all' && item.format !== filter.format) {
          return false;
        }
        if (filter.topicId && filter.topicId !== 'all') {
          const itemTopics = topicIdsMap.get(item.id) ?? [];
          if (!itemTopics.includes(filter.topicId)) {
            return false;
          }
        }
        if (filter.search && filter.search.trim().length > 0) {
          return matchesNormalizedQuery(
            this.searchNormalizer,
            [item.searchText, item.title, item.summary, item.slug],
            filter.search,
          );
        }
        return true;
      })
      .sort((a, b) => {
        const dateCompare = b.updatedAt.localeCompare(a.updatedAt);
        return dateCompare !== 0 ? dateCompare : b.id - a.id;
      });

    const pageSize = Math.max(1, filter.pageSize ?? 10);
    const totalCount = filtered.length;
    const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
    const page = Math.min(Math.max(1, filter.page ?? 1), totalPages);
    const startIdx = (page - 1) * pageSize;

    const pagedItems: AdminContentSummary[] = filtered
      .slice(startIdx, startIdx + pageSize)
      .map((item) => ({
        item,
        sourcesCount: sourcesCountMap.get(item.id) ?? 0,
        filesCount: filesCountMap.get(item.id) ?? 0,
        topicIds: topicIdsMap.get(item.id) ?? [],
        ageGroupIds: ageGroupIdsMap.get(item.id) ?? [],
      }));

    return {
      ok: true,
      statusCode: 200,
      data: {
        items: pagedItems,
        totalCount,
        page,
        pageSize,
        totalPages,
      },
    };
  }

  public async getContentAggregate(
    actor: AppUser | null,
    contentId: number,
  ): Promise<ContentServiceResult<ContentAggregate>> {
    const denied = await this.authorizeContent<ContentAggregate>(
      actor,
      `${CONTENT_ROUTE_PATH}/edit/${contentId}`,
    );
    if (denied) return denied;

    const aggregate = await this.loadAggregateInternal(contentId);
    if (!aggregate) {
      return {
        ok: false,
        statusCode: 400,
        errorCode: 'ENTITY_NOT_FOUND',
        messageKey: 'admin.content.error.notFound',
      };
    }

    return {
      ok: true,
      statusCode: 200,
      data: aggregate,
    };
  }

  public async uploadThumbnailAsync(
    actor: AppUser | null,
    fileInput: Omit<UploadFileInput, 'visibility'>,
  ): Promise<ContentServiceResult<StoredFileMetadata>> {
    const res = await this.fileUploadService.uploadFileAsync(
      actor,
      {
        ...fileInput,
        visibility: 'public',
      },
      {
        allowedPermissions: [CONTENT_PERMISSION_KEY],
        routePath: CONTENT_ROUTE_PATH,
      },
    );

    if (!res.ok || !res.metadata) {
      return {
        ok: false,
        statusCode: res.statusCode,
        errorCode:
          res.statusCode === 404
            ? 'NOT_FOUND'
            : res.statusCode === 403
              ? 'FORBIDDEN'
              : 'FILE_UPLOAD_FAILED',
        messageKey: res.messageKey ?? 'storage.error.generic',
      };
    }

    return {
      ok: true,
      statusCode: 200,
      data: res.metadata,
    };
  }

  public async uploadContentFileAsync(
    actor: AppUser | null,
    fileInput: Omit<UploadFileInput, 'visibility'>,
  ): Promise<ContentServiceResult<StoredFileMetadata>> {
    const res = await this.fileUploadService.uploadFileAsync(
      actor,
      {
        ...fileInput,
        visibility: 'private',
      },
      {
        allowedPermissions: [CONTENT_PERMISSION_KEY],
        routePath: CONTENT_ROUTE_PATH,
      },
    );

    if (!res.ok || !res.metadata) {
      return {
        ok: false,
        statusCode: res.statusCode,
        errorCode:
          res.statusCode === 404
            ? 'NOT_FOUND'
            : res.statusCode === 403
              ? 'FORBIDDEN'
              : 'FILE_UPLOAD_FAILED',
        messageKey: res.messageKey ?? 'storage.error.generic',
      };
    }

    return {
      ok: true,
      statusCode: 200,
      data: res.metadata,
    };
  }

  public async deleteStoredFileAsync(
    actor: AppUser | null,
    storageKey: string,
  ): Promise<ContentServiceResult<void>> {
    const res = await this.fileUploadService.deleteFileAsync(actor, storageKey, {
      allowedPermissions: [CONTENT_PERMISSION_KEY],
      routePath: CONTENT_ROUTE_PATH,
    });
    if (!res.ok) {
      return {
        ok: false,
        statusCode: res.statusCode,
        errorCode: res.statusCode === 404 ? 'NOT_FOUND' : 'FORBIDDEN',
        messageKey: res.messageKey,
      };
    }
    return {
      ok: true,
      statusCode: 200,
    };
  }

  public async saveDraft(
    actor: AppUser | null,
    input: SaveContentDraftInput,
  ): Promise<ContentServiceResult<ContentAggregate>> {
    const isEdit = typeof input.id === 'number' && input.id > 0;
    const denied = await this.authorizeContent<ContentAggregate>(
      actor,
      isEdit ? `${CONTENT_ROUTE_PATH}/edit/${input.id}` : `${CONTENT_ROUTE_PATH}/new`,
    );
    if (denied || !actor) return denied!;

    const creatorExists = await this.contentRepository.userExists(actor.id);
    if (!creatorExists) {
      return {
        ok: false,
        statusCode: 400,
        errorCode: 'INVALID_CREATED_BY_USER',
        messageKey: 'content.error.invalidCreatedByUser',
      };
    }

    const trimmedTitle = (input.title ?? '').trim();
    if (!trimmedTitle) {
      return {
        ok: false,
        statusCode: 400,
        errorCode: 'VALIDATION_ERROR',
        messageKey: 'publish.error.titleRequired',
      };
    }
    if (trimmedTitle.length > CONTENT_TITLE_MAX_LENGTH) {
      return {
        ok: false,
        statusCode: 400,
        errorCode: 'VALIDATION_ERROR',
        messageKey: 'publish.error.titleTooLong',
      };
    }

    const trimmedSummary = (input.summary ?? '').trim();
    if (trimmedSummary.length > CONTENT_SUMMARY_MAX_LENGTH) {
      return {
        ok: false,
        statusCode: 400,
        errorCode: 'VALIDATION_ERROR',
        messageKey: 'publish.error.summaryTooLong',
      };
    }

    if (!isValidFormat(input.format)) {
      return {
        ok: false,
        statusCode: 400,
        errorCode: 'VALIDATION_ERROR',
        messageKey: 'publish.error.invalidFormat',
      };
    }

    const minutesCheck = parseOptionalPositiveMinutes(input.readWatchMinutes);
    if (!minutesCheck.valid) {
      return {
        ok: false,
        statusCode: 400,
        errorCode: 'VALIDATION_ERROR',
        messageKey: 'admin.content.error.invalidMinutes',
      };
    }

    // Validate sources
    const normalizedSources: Omit<ContentSource, 'id'>[] = [];
    for (let i = 0; i < (input.sources ?? []).length; i += 1) {
      const src = input.sources[i];
      const srcTitle = (src.title ?? '').trim();
      if (!srcTitle || srcTitle.length > SOURCE_TITLE_MAX_LENGTH) {
        return {
          ok: false,
          statusCode: 400,
          errorCode: 'VALIDATION_ERROR',
          messageKey: 'admin.content.error.invalidSourceTitle',
        };
      }

      const srcNote = (src.note ?? '').trim();
      if (srcNote.length > SOURCE_NOTE_MAX_LENGTH) {
        return {
          ok: false,
          statusCode: 400,
          errorCode: 'VALIDATION_ERROR',
          messageKey: 'admin.content.error.invalidSourceNote',
        };
      }

      let normalizedSourceUrl: string | null = null;
      const rawUrl = (src.url ?? '').trim();
      if (rawUrl) {
        const urlCheck = validateExternalUrl(rawUrl);
        if (!urlCheck.isValid || !urlCheck.normalizedUrl) {
          return {
            ok: false,
            statusCode: 400,
            errorCode: 'VALIDATION_ERROR',
            messageKey: 'admin.content.error.invalidUrl',
          };
        }
        normalizedSourceUrl = urlCheck.normalizedUrl;
      }

      normalizedSources.push({
        contentId: input.id ?? 0,
        title: srcTitle,
        url: normalizedSourceUrl,
        note: srcNote || null,
        sortOrder: src.sortOrder ?? i + 1,
      });
    }

    // Validate files (enforce Rule 3.6: external links always have isDownloadable = false)
    const normalizedFiles: Omit<ContentFile, 'id'>[] = [];
    for (let i = 0; i < (input.files ?? []).length; i += 1) {
      const f = input.files[i];
      if (f.storageType === FileStorageType.External) {
        const urlCheck = validateExternalUrl(f.externalUrl);
        if (!urlCheck.isValid || !urlCheck.normalizedUrl) {
          return {
            ok: false,
            statusCode: 400,
            errorCode: 'VALIDATION_ERROR',
            messageKey: 'admin.content.error.invalidExternalFileUrl',
          };
        }
        const fileName = (f.originalFileName ?? '').trim();
        if (!fileName) {
          return {
            ok: false,
            statusCode: 400,
            errorCode: 'VALIDATION_ERROR',
            messageKey: 'admin.content.error.externalFileNameRequired',
          };
        }

        normalizedFiles.push({
          contentId: input.id ?? 0,
          kind: f.kind,
          storageType: FileStorageType.External,
          storageKey: null,
          externalUrl: urlCheck.normalizedUrl,
          originalFileName: fileName,
          mimeType: f.mimeType || 'text/html',
          sizeBytes: null,
          isDownloadable: false, // Rule 3.6: never downloadable for external links
          sortOrder: f.sortOrder ?? i + 1,
        });
      } else {
        const key = (f.storageKey ?? '').trim();
        if (!key) {
          return {
            ok: false,
            statusCode: 400,
            errorCode: 'VALIDATION_ERROR',
            messageKey: 'admin.content.error.localFileMissingKey',
          };
        }
        normalizedFiles.push({
          contentId: input.id ?? 0,
          kind: f.kind,
          storageType: FileStorageType.Local,
          storageKey: key,
          externalUrl: null,
          originalFileName: (f.originalFileName ?? '').trim() || key,
          mimeType: f.mimeType || 'application/octet-stream',
          sizeBytes: f.sizeBytes ?? null,
          isDownloadable: Boolean(f.isDownloadable),
          sortOrder: f.sortOrder ?? i + 1,
        });
      }
    }

    const sanitizedBody = sanitizeHtml(input.body);
    const cleanedBody = sanitizedBody.length > 0 ? sanitizedBody : null;
    const cleanedThumbnail =
      typeof input.thumbnailKey === 'string' && input.thumbnailKey.trim().length > 0
        ? input.thumbnailKey.trim()
        : null;

    let existingItem: ContentItem | null = null;
    if (isEdit) {
      existingItem = await this.contentRepository.getContentItemById(input.id!);
      if (!existingItem) {
        return {
          ok: false,
          statusCode: 400,
          errorCode: 'ENTITY_NOT_FOUND',
          messageKey: 'admin.content.error.notFound',
        };
      }
    }

    // If editing already-Published content, preserve publish integrity
    if (existingItem && existingItem.status === ContentStatus.Published) {
      const check = validateForPublish({
        item: {
          title: trimmedTitle,
          summary: trimmedSummary,
          body: cleanedBody,
          format: input.format,
          thumbnailKey: cleanedThumbnail,
        },
        topicIds: input.topicIds ?? [],
        sources: normalizedSources,
        files: normalizedFiles,
      });

      if (!check.isValid) {
        return {
          ok: false,
          statusCode: 400,
          errorCode: 'PUBLISH_VALIDATION_FAILED',
          messageKey: check.errors[0]?.messageKey,
          validationErrors: check.errors,
        };
      }
    }

    const allItems = await this.contentRepository.getAllContentItems();
    const otherSlugs = allItems
      .filter((item) => !existingItem || item.id !== existingItem.id)
      .map((item) => item.slug);
    const slugSource = (input.slug ?? '').trim() || trimmedTitle;
    const uniqueSlug = ensureUniqueSlug(slugSource, otherSlugs);

    const uniqueTopicIds = Array.from(new Set(input.topicIds ?? []));
    const uniqueTagIds = Array.from(new Set(input.tagIds ?? []));
    const uniquePersonIds = Array.from(new Set(input.personIds ?? []));
    const uniqueAgeGroupIds = Array.from(new Set(input.ageGroupIds ?? []));

    const searchText = await this.buildNormalizedSearchTextFor({
      title: trimmedTitle,
      summary: trimmedSummary,
      bodyHtml: cleanedBody,
      topicIds: uniqueTopicIds,
      tagIds: uniqueTagIds,
      personIds: uniquePersonIds,
      sources: normalizedSources,
    });

    const nowIso = this.clock.nowUtcIso();
    let savedItem: ContentItem;

    if (!existingItem) {
      savedItem = await this.contentRepository.createContentItem({
        title: trimmedTitle,
        slug: uniqueSlug,
        summary: trimmedSummary,
        body: cleanedBody,
        format: input.format,
        impactLevelId: input.impactLevelId ?? null,
        status: ContentStatus.Draft,
        publishedAt: null,
        readWatchMinutes: minutesCheck.parsed,
        thumbnailKey: cleanedThumbnail,
        isFeatured: Boolean(input.isFeatured),
        languageCode: 'fa',
        searchText,
        viewCount: 0,
        downloadCount: 0,
        likeCount: 0,
        createdById: actor.id,
        createdAt: nowIso,
        updatedAt: nowIso,
      });
    } else {
      savedItem = {
        ...existingItem,
        title: trimmedTitle,
        slug: uniqueSlug,
        summary: trimmedSummary,
        body: cleanedBody,
        format: input.format,
        impactLevelId: input.impactLevelId ?? null,
        readWatchMinutes: minutesCheck.parsed,
        thumbnailKey: cleanedThumbnail,
        isFeatured: Boolean(input.isFeatured),
        searchText,
        updatedAt: nowIso,
      };
      await this.contentRepository.updateContentItem(savedItem);
    }

    const [savedSources, savedFiles] = await Promise.all([
      this.contentRepository.replaceSources(
        savedItem.id,
        normalizedSources.map((s) => ({ ...s, contentId: savedItem.id })),
      ),
      this.contentRepository.replaceFiles(
        savedItem.id,
        normalizedFiles.map((f) => ({ ...f, contentId: savedItem.id })),
      ),
      this.contentRepository.replaceContentTopics(savedItem.id, uniqueTopicIds),
      this.contentRepository.replaceContentTags(savedItem.id, uniqueTagIds),
      this.contentRepository.replaceContentPersons(savedItem.id, uniquePersonIds),
      this.contentRepository.replaceContentAgeGroups(savedItem.id, uniqueAgeGroupIds),
    ]);

    this.logger.info(isEdit ? 'ADMIN_CONTENT_UPDATED' : 'ADMIN_CONTENT_CREATED', {
      actorId: actor.id,
      contentId: savedItem.id,
      slug: savedItem.slug,
      status: savedItem.status,
    });

    return {
      ok: true,
      statusCode: 200,
      data: {
        item: savedItem,
        sources: savedSources,
        files: savedFiles,
        topicIds: uniqueTopicIds,
        tagIds: uniqueTagIds,
        personIds: uniquePersonIds,
        ageGroupIds: uniqueAgeGroupIds,
      },
    };
  }

  public async publishContent(
    actor: AppUser | null,
    contentId: number,
  ): Promise<ContentServiceResult<ContentAggregate>> {
    const denied = await this.authorizeContent<ContentAggregate>(actor);
    if (denied || !actor) return denied!;

    const aggregate = await this.loadAggregateInternal(contentId);
    if (!aggregate) {
      return {
        ok: false,
        statusCode: 400,
        errorCode: 'ENTITY_NOT_FOUND',
        messageKey: 'admin.content.error.notFound',
      };
    }

    const validation = validateForPublish({
      item: aggregate.item,
      topicIds: aggregate.topicIds,
      sources: aggregate.sources,
      files: aggregate.files,
    });

    if (!validation.isValid) {
      this.logger.warn('ADMIN_CONTENT_PUBLISH_REJECTED', {
        actorId: actor.id,
        contentId,
        errorCodes: validation.errors.map((e) => e.code),
      });
      return {
        ok: false,
        statusCode: 400,
        errorCode: 'PUBLISH_VALIDATION_FAILED',
        messageKey: validation.errors[0]?.messageKey,
        validationErrors: validation.errors,
      };
    }

    const nowIso = this.clock.nowUtcIso();
    const updatedSearchText = await this.buildNormalizedSearchTextFor({
      title: aggregate.item.title,
      summary: aggregate.item.summary,
      bodyHtml: aggregate.item.body,
      topicIds: aggregate.topicIds,
      tagIds: aggregate.tagIds,
      personIds: aggregate.personIds,
      sources: aggregate.sources,
    });

    const updatedItem: ContentItem = {
      ...aggregate.item,
      status: ContentStatus.Published,
      publishedAt: aggregate.item.publishedAt ?? nowIso,
      updatedAt: nowIso,
      searchText: updatedSearchText,
    };

    await this.contentRepository.updateContentItem(updatedItem);

    this.logger.info('ADMIN_CONTENT_PUBLISHED', {
      actorId: actor.id,
      contentId: updatedItem.id,
      slug: updatedItem.slug,
      publishedAt: updatedItem.publishedAt,
    });

    return {
      ok: true,
      statusCode: 200,
      data: {
        ...aggregate,
        item: updatedItem,
      },
    };
  }

  public async archiveContent(
    actor: AppUser | null,
    contentId: number,
  ): Promise<ContentServiceResult<ContentItem>> {
    const denied = await this.authorizeContent<ContentItem>(actor);
    if (denied || !actor) return denied!;

    const existing = await this.contentRepository.getContentItemById(contentId);
    if (!existing) {
      return {
        ok: false,
        statusCode: 400,
        errorCode: 'ENTITY_NOT_FOUND',
        messageKey: 'admin.content.error.notFound',
      };
    }

    const updated: ContentItem = {
      ...existing,
      status: ContentStatus.Archived,
      updatedAt: this.clock.nowUtcIso(),
    };
    await this.contentRepository.updateContentItem(updated);

    this.logger.info('ADMIN_CONTENT_ARCHIVED', {
      actorId: actor.id,
      contentId: updated.id,
      slug: updated.slug,
    });

    return {
      ok: true,
      statusCode: 200,
      data: updated,
    };
  }

  public async restoreToDraft(
    actor: AppUser | null,
    contentId: number,
  ): Promise<ContentServiceResult<ContentItem>> {
    const denied = await this.authorizeContent<ContentItem>(actor);
    if (denied || !actor) return denied!;

    const existing = await this.contentRepository.getContentItemById(contentId);
    if (!existing) {
      return {
        ok: false,
        statusCode: 400,
        errorCode: 'ENTITY_NOT_FOUND',
        messageKey: 'admin.content.error.notFound',
      };
    }

    const updated: ContentItem = {
      ...existing,
      status: ContentStatus.Draft,
      updatedAt: this.clock.nowUtcIso(),
    };
    await this.contentRepository.updateContentItem(updated);

    this.logger.info('ADMIN_CONTENT_RESTORED_TO_DRAFT', {
      actorId: actor.id,
      contentId: updated.id,
      slug: updated.slug,
    });

    return {
      ok: true,
      statusCode: 200,
      data: updated,
    };
  }

  // ==================== Public Published-Only Read Queries ====================

  public async getPublicPublishedBySlug(slug: string): Promise<ContentAggregate | null> {
    const normalizedSlug = (slug ?? '').trim();
    if (!normalizedSlug) {
      return null;
    }

    const item = await this.contentRepository.getContentItemBySlug(normalizedSlug);
    if (!item || item.status !== ContentStatus.Published) {
      return null;
    }

    return this.loadAggregateInternal(item.id);
  }

  public async listPublicPublished(): Promise<ContentItem[]> {
    const all = await this.contentRepository.getAllContentItems();
    return all
      .filter((item) => item.status === ContentStatus.Published)
      .sort((a, b) => (b.publishedAt ?? b.createdAt).localeCompare(a.publishedAt ?? a.createdAt));
  }
}
