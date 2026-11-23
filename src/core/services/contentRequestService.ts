import type { IClock } from '../abstractions/IClock';
import type { ILogger } from '../abstractions/ILogger';
import type { IAdminRepository } from '../abstractions/adminRepository';
import type { IContentRepository } from '../abstractions/contentRepository';
import type { IContentRequestRepository } from '../abstractions/contentRequestRepository';
import type { ISearchNormalizer } from '../abstractions/searchNormalizer';
import type { ITaxonomyRepository } from '../abstractions/taxonomyRepository';
import type { AppUser } from '../domain/auth';
import { ContentStatus, type ContentFormat } from '../domain/content';
import {
  ContentRequestStatus,
  type ContentRequestItem,
} from '../domain/requests';
import { isContentAllowedForAgeGroup } from './ageRuleService';
import { PermissionPolicyService } from './permissionPolicyService';

export const MAX_OPEN_CONTENT_REQUESTS = 3;
export const REQUEST_TITLE_MAX_LENGTH = 150;
export const REQUEST_DESCRIPTION_MAX_LENGTH = 2000;
export const REQUEST_LINK_MAX_LENGTH = 500;
export const REQUEST_ADMIN_NOTE_MAX_LENGTH = 1000;

export interface LinkedContentSummary {
  id: number;
  title: string;
  slug: string;
  format: ContentFormat;
}

export interface UserContentRequestView {
  request: ContentRequestItem;
  linkedContent: LinkedContentSummary | null;
}

export interface AdminContentRequestRow {
  request: ContentRequestItem;
  requesterDisplayName: string;
  isRequesterDeleted: boolean;
  linkedContent: LinkedContentSummary | null;
}

export interface ContentRequestStatusCounts {
  total: number;
  submitted: number;
  inProgress: number;
  done: number;
  rejected: number;
}

export type SubmitContentRequestErrorCode =
  | 'FEATURE_DISABLED'
  | 'AUTH_REQUIRED'
  | 'REQUEST_TITLE_INVALID'
  | 'REQUEST_DESCRIPTION_INVALID'
  | 'REQUEST_LINK_INVALID'
  | 'MAX_OPEN_REQUESTS_REACHED';

export interface SubmitContentRequestResult {
  ok: boolean;
  statusCode: 201 | 400 | 401 | 404 | 429;
  errorCode?: SubmitContentRequestErrorCode;
  messageKey?: string;
  request?: ContentRequestItem;
  openCount?: number;
  maxOpen?: number;
}

export interface ListUserContentRequestsResult {
  ok: boolean;
  statusCode: 200 | 403 | 404;
  errorCode?: 'FEATURE_DISABLED' | 'FORBIDDEN';
  messageKey?: string;
  items?: UserContentRequestView[];
  openCount?: number;
  maxOpen?: number;
}

export interface AdminListContentRequestsResult {
  ok: boolean;
  statusCode: 200 | 403 | 404;
  errorCode?: 'FEATURE_DISABLED' | 'FORBIDDEN' | 'NOT_FOUND';
  messageKey?: string;
  items?: AdminContentRequestRow[];
  counts?: ContentRequestStatusCounts;
}

export interface AdminUpdateContentRequestResult {
  ok: boolean;
  statusCode: 200 | 400 | 403 | 404;
  errorCode?:
    | 'FEATURE_DISABLED'
    | 'FORBIDDEN'
    | 'NOT_FOUND'
    | 'INVALID_STATUS'
    | 'ADMIN_NOTE_TOO_LONG'
    | 'LINKED_CONTENT_NOT_PUBLISHED';
  messageKey?: string;
  request?: ContentRequestItem;
  linkedContent?: LinkedContentSummary | null;
}

export interface AdminPublishedContentsForLinkingResult {
  ok: boolean;
  statusCode: 200 | 403 | 404;
  errorCode?: 'FEATURE_DISABLED' | 'FORBIDDEN' | 'NOT_FOUND';
  messageKey?: string;
  items?: LinkedContentSummary[];
}

export function isOpenContentRequestStatus(status: ContentRequestStatus): boolean {
  return (
    status === ContentRequestStatus.Submitted ||
    status === ContentRequestStatus.InProgress
  );
}

export function isValidContentRequestStatus(
  value: number,
): value is ContentRequestStatus {
  return (
    value === ContentRequestStatus.Submitted ||
    value === ContentRequestStatus.InProgress ||
    value === ContentRequestStatus.Done ||
    value === ContentRequestStatus.Rejected
  );
}

/**
 * Validates optional user-provided external URLs so only strict `http://` or
 * `https://` URLs with a non-empty host are accepted (blocking `javascript:`,
 * `data:`, `vbscript:`, relative paths, and embedded whitespace).
 */
export function validateOptionalRequestLink(rawLink?: string | null): {
  ok: boolean;
  normalized: string | null;
} {
  if (rawLink === null || rawLink === undefined) {
    return { ok: true, normalized: null };
  }

  const trimmed = rawLink.trim();
  if (trimmed.length === 0) {
    return { ok: true, normalized: null };
  }

  if (trimmed.length > REQUEST_LINK_MAX_LENGTH || /\s/.test(trimmed)) {
    return { ok: false, normalized: null };
  }

  try {
    const parsed = new URL(trimmed);
    const protocol = parsed.protocol.toLowerCase();
    if (protocol !== 'http:' && protocol !== 'https:') {
      return { ok: false, normalized: null };
    }
    if (!parsed.hostname || parsed.hostname.trim().length === 0) {
      return { ok: false, normalized: null };
    }
    return { ok: true, normalized: trimmed };
  } catch {
    return { ok: false, normalized: null };
  }
}

export interface ContentRequestServiceDeps {
  contentRequestRepository: IContentRequestRepository;
  contentRepository: IContentRepository;
  adminRepository: IAdminRepository;
  taxonomyRepository: ITaxonomyRepository;
  permissionPolicyService: PermissionPolicyService;
  searchNormalizer: ISearchNormalizer;
  clock: IClock;
  logger: ILogger;
  deletedDisplayName?: string;
}

export class ContentRequestService {
  private readonly contentRequestRepository: IContentRequestRepository;
  private readonly contentRepository: IContentRepository;
  private readonly adminRepository: IAdminRepository;
  private readonly taxonomyRepository: ITaxonomyRepository;
  private readonly permissionPolicyService: PermissionPolicyService;
  private readonly searchNormalizer: ISearchNormalizer;
  private readonly clock: IClock;
  private readonly logger: ILogger;
  private readonly deletedDisplayName: string;

  constructor(deps: ContentRequestServiceDeps) {
    this.contentRequestRepository = deps.contentRequestRepository;
    this.contentRepository = deps.contentRepository;
    this.adminRepository = deps.adminRepository;
    this.taxonomyRepository = deps.taxonomyRepository;
    this.permissionPolicyService = deps.permissionPolicyService;
    this.searchNormalizer = deps.searchNormalizer;
    this.clock = deps.clock;
    this.logger = deps.logger;
    this.deletedDisplayName = deps.deletedDisplayName ?? 'کاربر حذف‌شده';
  }

  public async isContentRequestsFeatureEnabledAsync(): Promise<boolean> {
    const flags = await this.adminRepository.getAllFeatureFlags();
    return (
      flags.find((flag) => flag.key === 'ContentRequests')?.isEnabled === true
    );
  }

  private async resolveActiveActor(actor: AppUser | null): Promise<AppUser | null> {
    if (!actor || !actor.isActive || actor.isDeleted) {
      return null;
    }
    const stored = await this.adminRepository.getUserById(actor.id);
    if (!stored || !stored.isActive || stored.isDeleted) {
      return null;
    }
    return stored;
  }

  private async authorizeAdminRequestsModule(actor: AppUser | null): Promise<{
    allowed: boolean;
    statusCode: 200 | 403 | 404;
    errorCode?: 'FEATURE_DISABLED' | 'FORBIDDEN' | 'NOT_FOUND';
    messageKey?: string;
  }> {
    if (!(await this.isContentRequestsFeatureEnabledAsync())) {
      return {
        allowed: false,
        statusCode: 404,
        errorCode: 'FEATURE_DISABLED',
        messageKey: 'notFound.title',
      };
    }

    const auth = await this.permissionPolicyService.authorizePermission(
      actor,
      'requests.manage',
      '#/admin/requests',
    );
    if (!auth.allowed) {
      return {
        allowed: false,
        statusCode: auth.statusCode,
        errorCode: auth.statusCode === 404 ? 'NOT_FOUND' : 'FORBIDDEN',
        messageKey:
          auth.statusCode === 404 ? 'notFound.title' : 'admin.forbidden.title',
      };
    }

    return { allowed: true, statusCode: 200 };
  }

  public async submitContentRequestAsync(
    actor: AppUser | null,
    input: {
      title: string;
      description: string;
      link?: string | null;
    },
  ): Promise<SubmitContentRequestResult> {
    if (!(await this.isContentRequestsFeatureEnabledAsync())) {
      return {
        ok: false,
        statusCode: 404,
        errorCode: 'FEATURE_DISABLED',
        messageKey: 'requests.error.featureDisabled',
      };
    }

    const activeUser = await this.resolveActiveActor(actor);
    if (!activeUser) {
      return {
        ok: false,
        statusCode: 401,
        errorCode: 'AUTH_REQUIRED',
        messageKey: 'requests.error.authRequired',
      };
    }

    const trimmedTitle = (input.title ?? '').trim();
    if (
      trimmedTitle.length === 0 ||
      trimmedTitle.length > REQUEST_TITLE_MAX_LENGTH
    ) {
      return {
        ok: false,
        statusCode: 400,
        errorCode: 'REQUEST_TITLE_INVALID',
        messageKey: 'requests.error.titleInvalid',
      };
    }

    const trimmedDescription = (input.description ?? '').trim();
    if (
      trimmedDescription.length === 0 ||
      trimmedDescription.length > REQUEST_DESCRIPTION_MAX_LENGTH
    ) {
      return {
        ok: false,
        statusCode: 400,
        errorCode: 'REQUEST_DESCRIPTION_INVALID',
        messageKey: 'requests.error.descriptionInvalid',
      };
    }

    const linkCheck = validateOptionalRequestLink(input.link);
    if (!linkCheck.ok) {
      return {
        ok: false,
        statusCode: 400,
        errorCode: 'REQUEST_LINK_INVALID',
        messageKey: 'requests.error.linkInvalid',
      };
    }

    const existingUserRequests =
      await this.contentRequestRepository.getContentRequestsByUserId(
        activeUser.id,
      );
    const openCount = existingUserRequests.filter((item) =>
      isOpenContentRequestStatus(item.status),
    ).length;

    if (openCount >= MAX_OPEN_CONTENT_REQUESTS) {
      this.logger.warn('CONTENT_REQUEST_MAX_OPEN_REACHED', {
        userId: activeUser.id,
        openCount,
        maxOpen: MAX_OPEN_CONTENT_REQUESTS,
      });
      return {
        ok: false,
        statusCode: 429,
        errorCode: 'MAX_OPEN_REQUESTS_REACHED',
        messageKey: 'requests.error.maxOpenReached',
        openCount,
        maxOpen: MAX_OPEN_CONTENT_REQUESTS,
      };
    }

    const nowIso = this.clock.nowUtcIso();
    const created = await this.contentRequestRepository.createContentRequest({
      userId: activeUser.id,
      title: trimmedTitle,
      description: trimmedDescription,
      link: linkCheck.normalized,
      status: ContentRequestStatus.Submitted,
      adminNote: null,
      linkedContentId: null,
      createdAt: nowIso,
      updatedAt: nowIso,
    });

    this.logger.info('CONTENT_REQUEST_SUBMITTED', {
      requestId: created.id,
      userId: activeUser.id,
      openCount: openCount + 1,
    });

    return {
      ok: true,
      statusCode: 201,
      request: created,
      openCount: openCount + 1,
      maxOpen: MAX_OPEN_CONTENT_REQUESTS,
    };
  }

  public async listUserContentRequestsAsync(
    actor: AppUser | null,
    targetUserId: number,
  ): Promise<ListUserContentRequestsResult> {
    if (!(await this.isContentRequestsFeatureEnabledAsync())) {
      return {
        ok: false,
        statusCode: 404,
        errorCode: 'FEATURE_DISABLED',
        messageKey: 'requests.error.featureDisabled',
      };
    }

    const activeUser = await this.resolveActiveActor(actor);
    if (!activeUser || activeUser.id !== targetUserId) {
      this.logger.warn('CONTENT_REQUESTS_FORBIDDEN_ACCESS', {
        actorId: actor?.id ?? null,
        targetUserId,
      });
      return {
        ok: false,
        statusCode: 403,
        errorCode: 'FORBIDDEN',
        messageKey: 'requests.error.forbidden',
      };
    }

    const [userRequests, allContent, ageGroups, contentAgeGroups] =
      await Promise.all([
        this.contentRequestRepository.getContentRequestsByUserId(activeUser.id),
        this.contentRepository.getAllContentItems(),
        this.taxonomyRepository.getAllAgeGroups(),
        this.contentRepository.getAllContentAgeGroups(),
      ]);

    const contentById = new Map(allContent.map((item) => [item.id, item]));
    const userAgeGroup =
      activeUser.ageGroupId !== null
        ? ageGroups.find((g) => g.id === activeUser.ageGroupId) ?? null
        : null;
    const isChildProfile = userAgeGroup?.key === 'child';

    const ageGroupIdsByContentId = new Map<number, number[]>();
    for (const rel of contentAgeGroups) {
      const list = ageGroupIdsByContentId.get(rel.contentId);
      if (list) {
        list.push(rel.ageGroupId);
      } else {
        ageGroupIdsByContentId.set(rel.contentId, [rel.ageGroupId]);
      }
    }

    const sorted = [...userRequests].sort(
      (a, b) =>
        Date.parse(b.createdAt) - Date.parse(a.createdAt) || b.id - a.id,
    );

    const items: UserContentRequestView[] = sorted.map((req) => {
      let linkedContent: LinkedContentSummary | null = null;
      if (req.linkedContentId !== null) {
        const candidate = contentById.get(req.linkedContentId);
        if (candidate && candidate.status === ContentStatus.Published) {
          const allowedForViewer = isChildProfile
            ? isContentAllowedForAgeGroup(
                ageGroupIdsByContentId.get(candidate.id) ?? [],
                userAgeGroup,
              )
            : true;
          if (allowedForViewer) {
            linkedContent = {
              id: candidate.id,
              title: candidate.title,
              slug: candidate.slug,
              format: candidate.format,
            };
          }
        }
      }
      return {
        request: req,
        linkedContent,
      };
    });

    const openCount = sorted.filter((item) =>
      isOpenContentRequestStatus(item.status),
    ).length;

    return {
      ok: true,
      statusCode: 200,
      items,
      openCount,
      maxOpen: MAX_OPEN_CONTENT_REQUESTS,
    };
  }

  public async listAdminContentRequestsAsync(
    actor: AppUser | null,
    filter?: {
      status?: ContentRequestStatus | 'all';
      search?: string;
    },
  ): Promise<AdminListContentRequestsResult> {
    const gate = await this.authorizeAdminRequestsModule(actor);
    if (!gate.allowed) {
      return {
        ok: false,
        statusCode: gate.statusCode,
        errorCode: gate.errorCode,
        messageKey: gate.messageKey,
      };
    }

    const [allRequests, allUsers, allContent] = await Promise.all([
      this.contentRequestRepository.getAllContentRequests(),
      this.adminRepository.getAllUsers(),
      this.contentRepository.getAllContentItems(),
    ]);

    const counts: ContentRequestStatusCounts = {
      total: allRequests.length,
      submitted: allRequests.filter(
        (r) => r.status === ContentRequestStatus.Submitted,
      ).length,
      inProgress: allRequests.filter(
        (r) => r.status === ContentRequestStatus.InProgress,
      ).length,
      done: allRequests.filter((r) => r.status === ContentRequestStatus.Done)
        .length,
      rejected: allRequests.filter(
        (r) => r.status === ContentRequestStatus.Rejected,
      ).length,
    };

    const userById = new Map(allUsers.map((u) => [u.id, u]));
    const contentById = new Map(allContent.map((c) => [c.id, c]));

    let rows: AdminContentRequestRow[] = allRequests.map((req) => {
      const requester = userById.get(req.userId);
      const isRequesterDeleted = !requester || requester.isDeleted === true;
      const requesterDisplayName = isRequesterDeleted
        ? this.deletedDisplayName
        : requester.displayName;
      const targetContent =
        req.linkedContentId !== null
          ? contentById.get(req.linkedContentId)
          : undefined;
      const linkedContent: LinkedContentSummary | null =
        targetContent && targetContent.status === ContentStatus.Published
          ? {
              id: targetContent.id,
              title: targetContent.title,
              slug: targetContent.slug,
              format: targetContent.format,
            }
          : null;

      return {
        request: req,
        requesterDisplayName,
        isRequesterDeleted,
        linkedContent,
      };
    });

    if (filter?.status !== undefined && filter.status !== 'all') {
      rows = rows.filter((row) => row.request.status === filter.status);
    }

    const normalizedSearch = filter?.search
      ? this.searchNormalizer.normalize(filter.search)
      : '';
    if (normalizedSearch) {
      rows = rows.filter((row) => {
        const haystack = this.searchNormalizer.normalize(
          `${row.request.title} ${row.request.description} ${row.requesterDisplayName} ${row.request.adminNote ?? ''} ${row.linkedContent?.title ?? ''}`,
        );
        return haystack.includes(normalizedSearch);
      });
    }

    rows.sort(
      (a, b) =>
        Date.parse(b.request.createdAt) - Date.parse(a.request.createdAt) ||
        b.request.id - a.request.id,
    );

    return {
      ok: true,
      statusCode: 200,
      items: rows,
      counts,
    };
  }

  public async updateContentRequestByAdminAsync(
    actor: AppUser | null,
    requestId: number,
    input: {
      status: ContentRequestStatus;
      adminNote?: string | null;
      linkedContentId?: number | null;
    },
  ): Promise<AdminUpdateContentRequestResult> {
    const gate = await this.authorizeAdminRequestsModule(actor);
    if (!gate.allowed || !actor) {
      return {
        ok: false,
        statusCode: gate.statusCode,
        errorCode: gate.errorCode,
        messageKey: gate.messageKey,
      };
    }

    const existing =
      await this.contentRequestRepository.getContentRequestById(requestId);
    if (!existing) {
      return {
        ok: false,
        statusCode: 404,
        errorCode: 'NOT_FOUND',
        messageKey: 'requests.admin.error.notFound',
      };
    }

    if (!isValidContentRequestStatus(input.status)) {
      return {
        ok: false,
        statusCode: 400,
        errorCode: 'INVALID_STATUS',
        messageKey: 'requests.admin.error.invalidStatus',
      };
    }

    const trimmedNote = (input.adminNote ?? '').trim();
    if (trimmedNote.length > REQUEST_ADMIN_NOTE_MAX_LENGTH) {
      return {
        ok: false,
        statusCode: 400,
        errorCode: 'ADMIN_NOTE_TOO_LONG',
        messageKey: 'requests.admin.error.noteTooLong',
      };
    }
    const nextAdminNote = trimmedNote.length > 0 ? trimmedNote : null;

    let nextLinkedContentId: number | null = null;
    let linkedContentSummary: LinkedContentSummary | null = null;
    if (
      input.linkedContentId !== null &&
      input.linkedContentId !== undefined
    ) {
      const targetContent =
        await this.contentRepository.getContentItemById(input.linkedContentId);
      if (
        !targetContent ||
        targetContent.status !== ContentStatus.Published
      ) {
        return {
          ok: false,
          statusCode: 400,
          errorCode: 'LINKED_CONTENT_NOT_PUBLISHED',
          messageKey: 'requests.admin.error.linkedContentNotPublished',
        };
      }
      nextLinkedContentId = targetContent.id;
      linkedContentSummary = {
        id: targetContent.id,
        title: targetContent.title,
        slug: targetContent.slug,
        format: targetContent.format,
      };
    }

    const updated: ContentRequestItem = {
      ...existing,
      status: input.status,
      adminNote: nextAdminNote,
      linkedContentId: nextLinkedContentId,
      updatedAt: this.clock.nowUtcIso(),
    };

    await this.contentRequestRepository.updateContentRequest(updated);

    this.logger.info('CONTENT_REQUEST_UPDATED', {
      requestId: updated.id,
      actorId: actor.id,
      previousStatus: existing.status,
      nextStatus: updated.status,
      linkedContentId: updated.linkedContentId,
    });

    return {
      ok: true,
      statusCode: 200,
      request: updated,
      linkedContent: linkedContentSummary,
    };
  }

  public async listPublishedContentsForLinkingAsync(
    actor: AppUser | null,
    searchQuery?: string,
  ): Promise<AdminPublishedContentsForLinkingResult> {
    const gate = await this.authorizeAdminRequestsModule(actor);
    if (!gate.allowed) {
      return {
        ok: false,
        statusCode: gate.statusCode,
        errorCode: gate.errorCode,
        messageKey: gate.messageKey,
      };
    }

    const allContent = await this.contentRepository.getAllContentItems();
    let published = allContent.filter(
      (item) => item.status === ContentStatus.Published,
    );

    const normalizedSearch = searchQuery
      ? this.searchNormalizer.normalize(searchQuery)
      : '';
    if (normalizedSearch) {
      published = published.filter((item) => {
        const haystack = this.searchNormalizer.normalize(
          `${item.title} ${item.slug}`,
        );
        return haystack.includes(normalizedSearch);
      });
    }

    published.sort((a, b) => {
      const aTime = Date.parse(a.publishedAt ?? a.updatedAt);
      const bTime = Date.parse(b.publishedAt ?? b.updatedAt);
      return bTime - aTime || b.id - a.id;
    });

    return {
      ok: true,
      statusCode: 200,
      items: published.map((item) => ({
        id: item.id,
        title: item.title,
        slug: item.slug,
        format: item.format,
      })),
    };
  }
}
