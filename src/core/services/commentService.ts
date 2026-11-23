import type { IClock } from '../abstractions/IClock';
import type { ILogger } from '../abstractions/ILogger';
import type { IAdminRepository } from '../abstractions/adminRepository';
import type { ICommentRepository } from '../abstractions/commentRepository';
import type { IContentRepository } from '../abstractions/contentRepository';
import type { ISearchNormalizer } from '../abstractions/searchNormalizer';
import type { ITaxonomyRepository } from '../abstractions/taxonomyRepository';
import type { AppUser } from '../domain/auth';
import {
  CommentStatus,
  type BlockedWord,
  type CommentItem,
  type CommentModerationReason,
  type CommentReport,
} from '../domain/comments';
import { ContentStatus } from '../domain/content';
import { isContentAllowedForAgeGroup } from './ageRuleService';
import { normalizeDigits } from './identifierService';
import { PermissionPolicyService } from './permissionPolicyService';

export const DEFAULT_COMMENT_MAX_LENGTH = 1000;
export const COMMENT_REPORT_MAX_LENGTH = 300;
export const COMMENT_RATE_LIMIT_MAX_PER_HOUR = 5;
export const COMMENT_RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;

export interface PublicCommentView {
  id: number;
  contentId: number;
  userId: number;
  authorDisplayName: string;
  isAuthorDeleted: boolean;
  body: string;
  status: CommentStatus;
  isOwnPending: boolean;
  createdAt: string;
}

export interface ListPublicCommentsResult {
  enabled: boolean;
  maxLength: number;
  comments: PublicCommentView[];
}

export type SubmitCommentErrorCode =
  | 'FEATURE_DISABLED'
  | 'AUTH_REQUIRED'
  | 'CONTENT_NOT_FOUND'
  | 'COMMENT_EMPTY'
  | 'COMMENT_TOO_LONG'
  | 'COMMENT_LINKS_NOT_ALLOWED'
  | 'COMMENT_RATE_LIMIT';

export interface SubmitCommentResult {
  ok: boolean;
  statusCode: 201 | 400 | 401 | 404 | 429;
  errorCode?: SubmitCommentErrorCode;
  messageKey?: string;
  comment?: CommentItem;
  maxLength?: number;
}

export type ReportCommentErrorCode =
  | 'FEATURE_DISABLED'
  | 'AUTH_REQUIRED'
  | 'COMMENT_NOT_FOUND'
  | 'INVALID_REPORT_REASON'
  | 'REPORT_REASON_TOO_LONG'
  | 'ALREADY_REPORTED';

export interface ReportCommentResult {
  ok: boolean;
  statusCode: 201 | 400 | 401 | 404 | 409;
  errorCode?: ReportCommentErrorCode;
  messageKey?: string;
  report?: CommentReport;
}

export interface AdminCommentRow {
  comment: CommentItem;
  authorDisplayName: string;
  isAuthorDeleted: boolean;
  authorAgeGroupName: string | null;
  contentTitle: string | null;
  contentSlug: string | null;
  reportCount: number;
  moderatedByDisplayName: string | null;
}

export interface AdminReportRow {
  report: CommentReport;
  reporterDisplayName: string;
  isReporterDeleted: boolean;
  comment: CommentItem | null;
  commentAuthorDisplayName: string;
  contentTitle: string | null;
  contentSlug: string | null;
}

export interface AdminListCommentsResult {
  ok: boolean;
  statusCode: 200 | 403 | 404;
  errorCode?: 'FEATURE_DISABLED' | 'FORBIDDEN' | 'NOT_FOUND';
  messageKey?: string;
  items?: AdminCommentRow[];
  pendingCount?: number;
}

export interface AdminListReportsResult {
  ok: boolean;
  statusCode: 200 | 403 | 404;
  errorCode?: 'FEATURE_DISABLED' | 'FORBIDDEN' | 'NOT_FOUND';
  messageKey?: string;
  items?: AdminReportRow[];
}

export interface AdminCommentActionResult {
  ok: boolean;
  statusCode: 200 | 403 | 404;
  errorCode?: 'FEATURE_DISABLED' | 'FORBIDDEN' | 'NOT_FOUND';
  messageKey?: string;
  comment?: CommentItem;
}

export interface AdminDismissReportResult {
  ok: boolean;
  statusCode: 200 | 403 | 404;
  errorCode?: 'FEATURE_DISABLED' | 'FORBIDDEN' | 'NOT_FOUND';
  messageKey?: string;
}

export interface AdminBlockedWordsListResult {
  ok: boolean;
  statusCode: 200 | 403 | 404;
  errorCode?: 'FEATURE_DISABLED' | 'FORBIDDEN' | 'NOT_FOUND';
  messageKey?: string;
  items?: BlockedWord[];
}

export interface AdminBlockedWordActionResult {
  ok: boolean;
  statusCode: 200 | 201 | 400 | 403 | 404 | 409;
  errorCode?:
    | 'FEATURE_DISABLED'
    | 'FORBIDDEN'
    | 'NOT_FOUND'
    | 'INVALID_WORD'
    | 'DUPLICATE_WORD';
  messageKey?: string;
  word?: BlockedWord;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const KNOWN_LINK_SHORTENERS_OR_MESSENGERS =
  /(?:^|[\s(\["'«:/@])(?:t\.me|telegram\.me|eitaa\.com|ble\.ir|bale\.ai|rubika\.ir|igap\.net|splus\.ir|bit\.ly|tinyurl\.com|is\.gd|goo\.gl|youtu\.be|aparat\.com)(?:\/[^\s)\]"'»]*)?(?=$|[\s)\]"'».,!؟،؛])/i;

const COMMON_DOMAIN_WITH_TLD =
  /(?:^|[\s(\["'«:/@])(?:[a-z0-9-]+\.)+(?:com|ir|org|net|edu|gov|io|co|me|info|biz|tv|app|dev|xyz|online|site|club|live|shop|uk|de|fr|ru|ae|tr|in|ly|to|gg|ch|cc|ai|so|link|click|pro|news|press|media|academy)\b(?:\/[^\s)\]"'»]*)?/i;

const DOMAIN_WITH_EXPLICIT_PATH =
  /(?:^|[\s(\["'«])[a-z0-9-]{2,}\.[a-z]{2,10}\/[^\s]*/i;

/**
 * Detects external URLs and domain links while avoiding false positives on
 * normal Persian punctuation such as «سلام. خوبید».
 */
export function containsExternalOrWebLink(rawText: string): boolean {
  if (!rawText || typeof rawText !== 'string') {
    return false;
  }

  const trimmed = rawText.trim();
  if (!trimmed) {
    return false;
  }

  if (/(?:https?|ftp):\/\//i.test(trimmed)) {
    return true;
  }

  if (/(?:^|[\s(\["'«])www\.[a-z0-9\u0600-\u06FF-]+\.[a-z\u0600-\u06FF]{2,}/i.test(trimmed)) {
    return true;
  }

  if (KNOWN_LINK_SHORTENERS_OR_MESSENGERS.test(trimmed)) {
    return true;
  }

  if (COMMON_DOMAIN_WITH_TLD.test(trimmed)) {
    return true;
  }

  if (DOMAIN_WITH_EXPLICIT_PATH.test(trimmed)) {
    return true;
  }

  return false;
}

/**
 * Checks whether comment body contains any blocked word after applying
 * full Persian/Arabic normalization (Arabic yeh/kaf, diacritics, tatweel/kashida, ZWNJ, digits).
 */
export function containsBlockedWord(
  rawText: string,
  blockedWords: readonly BlockedWord[],
  normalizer: ISearchNormalizer,
): boolean {
  if (!rawText || blockedWords.length === 0) {
    return false;
  }

  const normalizedBody = normalizer.normalize(rawText);
  if (!normalizedBody) {
    return false;
  }

  const bodyTokens = normalizedBody.split(' ').filter((token) => token.length > 0);
  if (bodyTokens.length === 0) {
    return false;
  }

  for (const entry of blockedWords) {
    const normalizedWord = normalizer.normalize(entry.word);
    if (!normalizedWord) {
      continue;
    }

    if (!normalizedWord.includes(' ')) {
      if (bodyTokens.includes(normalizedWord)) {
        return true;
      }
    } else {
      const pattern = new RegExp(`(?:^|\\s)${escapeRegExp(normalizedWord)}(?:\\s|$)`);
      if (pattern.test(normalizedBody)) {
        return true;
      }
    }
  }

  return false;
}

export interface CommentServiceDeps {
  commentRepository: ICommentRepository;
  contentRepository: IContentRepository;
  adminRepository: IAdminRepository;
  taxonomyRepository: ITaxonomyRepository;
  permissionPolicyService: PermissionPolicyService;
  searchNormalizer: ISearchNormalizer;
  clock: IClock;
  logger: ILogger;
  deletedDisplayName?: string;
}

export class CommentService {
  private readonly commentRepository: ICommentRepository;
  private readonly contentRepository: IContentRepository;
  private readonly adminRepository: IAdminRepository;
  private readonly taxonomyRepository: ITaxonomyRepository;
  private readonly permissionPolicyService: PermissionPolicyService;
  private readonly searchNormalizer: ISearchNormalizer;
  private readonly clock: IClock;
  private readonly logger: ILogger;
  private readonly deletedDisplayName: string;

  constructor(deps: CommentServiceDeps) {
    this.commentRepository = deps.commentRepository;
    this.contentRepository = deps.contentRepository;
    this.adminRepository = deps.adminRepository;
    this.taxonomyRepository = deps.taxonomyRepository;
    this.permissionPolicyService = deps.permissionPolicyService;
    this.searchNormalizer = deps.searchNormalizer;
    this.clock = deps.clock;
    this.logger = deps.logger;
    this.deletedDisplayName = deps.deletedDisplayName ?? 'کاربر حذف‌شده';
  }

  public async isCommentsFeatureEnabledAsync(): Promise<boolean> {
    const flags = await this.adminRepository.getAllFeatureFlags();
    return flags.find((flag) => flag.key === 'Comments')?.isEnabled === true;
  }

  public async getMaxCommentLengthAsync(): Promise<number> {
    const setting = await this.adminRepository.getSiteSettingByKey('Comments.MaxLength');
    if (!setting) {
      return DEFAULT_COMMENT_MAX_LENGTH;
    }
    const parsed = Number.parseInt(normalizeDigits(setting.value).trim(), 10);
    if (!Number.isFinite(parsed) || parsed < 1) {
      return DEFAULT_COMMENT_MAX_LENGTH;
    }
    return parsed;
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

  public async submitCommentAsync(
    actor: AppUser | null,
    contentId: number,
    rawBody: string,
  ): Promise<SubmitCommentResult> {
    if (!(await this.isCommentsFeatureEnabledAsync())) {
      return {
        ok: false,
        statusCode: 404,
        errorCode: 'FEATURE_DISABLED',
        messageKey: 'comments.error.featureDisabled',
      };
    }

    const activeUser = await this.resolveActiveActor(actor);
    if (!activeUser) {
      return {
        ok: false,
        statusCode: 401,
        errorCode: 'AUTH_REQUIRED',
        messageKey: 'comments.error.authRequired',
      };
    }

    const content = await this.contentRepository.getContentItemById(contentId);
    if (!content || content.status !== ContentStatus.Published) {
      return {
        ok: false,
        statusCode: 404,
        errorCode: 'CONTENT_NOT_FOUND',
        messageKey: 'comments.error.contentNotFound',
      };
    }

    const ageGroups = await this.taxonomyRepository.getAllAgeGroups();
    const authorAgeGroupId = activeUser.ageGroupId ?? null;
    const authorAgeGroup =
      authorAgeGroupId !== null
        ? ageGroups.find((group) => group.id === authorAgeGroupId) ?? null
        : null;

    if (authorAgeGroup?.key === 'child') {
      const contentAgeGroupIds =
        await this.contentRepository.getAgeGroupIdsByContentId(content.id);
      if (!isContentAllowedForAgeGroup(contentAgeGroupIds, authorAgeGroup)) {
        return {
          ok: false,
          statusCode: 404,
          errorCode: 'CONTENT_NOT_FOUND',
          messageKey: 'comments.error.contentNotFound',
        };
      }
    }

    const maxLength = await this.getMaxCommentLengthAsync();
    const trimmedBody = (rawBody ?? '').trim();

    if (trimmedBody.length === 0) {
      return {
        ok: false,
        statusCode: 400,
        errorCode: 'COMMENT_EMPTY',
        messageKey: 'comments.error.empty',
        maxLength,
      };
    }

    if (trimmedBody.length > maxLength) {
      return {
        ok: false,
        statusCode: 400,
        errorCode: 'COMMENT_TOO_LONG',
        messageKey: 'comments.error.tooLong',
        maxLength,
      };
    }

    if (containsExternalOrWebLink(trimmedBody)) {
      return {
        ok: false,
        statusCode: 400,
        errorCode: 'COMMENT_LINKS_NOT_ALLOWED',
        messageKey: 'comments.error.linksNotAllowed',
        maxLength,
      };
    }

    // Rate limit: max 5 comments per user within the trailing 60-minute window
    const nowMs = this.clock.now().getTime();
    const userComments = await this.commentRepository.getCommentsByUserId(activeUser.id);
    const recentCount = userComments.filter((item) => {
      const createdMs = Date.parse(item.createdAt);
      if (Number.isNaN(createdMs)) {
        return false;
      }
      const elapsed = nowMs - createdMs;
      return elapsed >= 0 && elapsed < COMMENT_RATE_LIMIT_WINDOW_MS;
    }).length;

    if (recentCount >= COMMENT_RATE_LIMIT_MAX_PER_HOUR) {
      this.logger.warn('COMMENT_RATE_LIMIT_REACHED', {
        userId: activeUser.id,
        contentId: content.id,
        recentCount,
      });
      return {
        ok: false,
        statusCode: 429,
        errorCode: 'COMMENT_RATE_LIMIT',
        messageKey: 'comments.error.rateLimit',
        maxLength,
      };
    }

    // Section 3.12 initial status decision:
    // 1. Child profile author -> Pending (child safety)
    // 2. Contains blocked word (normalized) -> Pending
    // 3. Otherwise -> Published immediately
    const isChildAuthor = authorAgeGroup?.key === 'child';
    let initialStatus: CommentStatus = CommentStatus.Published;
    let moderationReason: CommentModerationReason | null = null;

    if (isChildAuthor) {
      initialStatus = CommentStatus.Pending;
      moderationReason = 'child_author';
    } else {
      const blockedWords = await this.commentRepository.getAllBlockedWords();
      if (containsBlockedWord(trimmedBody, blockedWords, this.searchNormalizer)) {
        initialStatus = CommentStatus.Pending;
        moderationReason = 'blocked_word';
      }
    }

    const created = await this.commentRepository.createComment({
      contentId: content.id,
      userId: activeUser.id,
      body: trimmedBody,
      status: initialStatus,
      authorAgeGroupId,
      moderationReason,
      createdAt: this.clock.nowUtcIso(),
      moderatedById: null,
      moderatedAt: null,
    });

    this.logger.info('COMMENT_SUBMITTED', {
      commentId: created.id,
      contentId: content.id,
      userId: activeUser.id,
      status: created.status,
      moderationReason: created.moderationReason ?? null,
    });

    return {
      ok: true,
      statusCode: 201,
      comment: created,
      maxLength,
    };
  }

  public async listPublicCommentsForContentAsync(
    contentId: number,
    viewer: AppUser | null,
  ): Promise<ListPublicCommentsResult> {
    const enabled = await this.isCommentsFeatureEnabledAsync();
    const maxLength = await this.getMaxCommentLengthAsync();

    if (!enabled) {
      return {
        enabled: false,
        maxLength,
        comments: [],
      };
    }

    const activeViewer = await this.resolveActiveActor(viewer);
    const viewerId = activeViewer?.id ?? null;

    const [contentComments, allUsers] = await Promise.all([
      this.commentRepository.getCommentsByContentId(contentId),
      this.adminRepository.getAllUsers(),
    ]);

    const userById = new Map(allUsers.map((user) => [user.id, user]));

    const visible = contentComments.filter((item) => {
      if (item.status === CommentStatus.Published) {
        return true;
      }
      if (
        item.status === CommentStatus.Pending &&
        viewerId !== null &&
        item.userId === viewerId
      ) {
        return true;
      }
      return false;
    });

    visible.sort((a, b) => {
      const diff = Date.parse(b.createdAt) - Date.parse(a.createdAt);
      if (diff !== 0) {
        return diff;
      }
      return b.id - a.id;
    });

    const views: PublicCommentView[] = visible.map((item) => {
      const author = userById.get(item.userId);
      const isAuthorDeleted = !author || author.isDeleted === true;
      return {
        id: item.id,
        contentId: item.contentId,
        userId: item.userId,
        authorDisplayName: isAuthorDeleted
          ? this.deletedDisplayName
          : author.displayName,
        isAuthorDeleted,
        body: item.body,
        status: item.status,
        isOwnPending:
          item.status === CommentStatus.Pending &&
          viewerId !== null &&
          item.userId === viewerId,
        createdAt: item.createdAt,
      };
    });

    return {
      enabled: true,
      maxLength,
      comments: views,
    };
  }

  public async reportCommentAsync(
    actor: AppUser | null,
    commentId: number,
    rawReason: string,
  ): Promise<ReportCommentResult> {
    if (!(await this.isCommentsFeatureEnabledAsync())) {
      return {
        ok: false,
        statusCode: 404,
        errorCode: 'FEATURE_DISABLED',
        messageKey: 'comments.error.featureDisabled',
      };
    }

    const activeUser = await this.resolveActiveActor(actor);
    if (!activeUser) {
      return {
        ok: false,
        statusCode: 401,
        errorCode: 'AUTH_REQUIRED',
        messageKey: 'comments.error.authRequired',
      };
    }

    const comment = await this.commentRepository.getCommentById(commentId);
    if (!comment || comment.status !== CommentStatus.Published) {
      return {
        ok: false,
        statusCode: 404,
        errorCode: 'COMMENT_NOT_FOUND',
        messageKey: 'comments.report.error.notFound',
      };
    }

    const reason = (rawReason ?? '').trim();
    if (reason.length === 0) {
      return {
        ok: false,
        statusCode: 400,
        errorCode: 'INVALID_REPORT_REASON',
        messageKey: 'comments.report.error.empty',
      };
    }
    if (reason.length > COMMENT_REPORT_MAX_LENGTH) {
      return {
        ok: false,
        statusCode: 400,
        errorCode: 'REPORT_REASON_TOO_LONG',
        messageKey: 'comments.report.error.tooLong',
      };
    }

    const existing = await this.commentRepository.getReportByCommentAndUser(
      comment.id,
      activeUser.id,
    );
    if (existing) {
      return {
        ok: false,
        statusCode: 409,
        errorCode: 'ALREADY_REPORTED',
        messageKey: 'comments.report.error.alreadyReported',
      };
    }

    const report = await this.commentRepository.createReport({
      commentId: comment.id,
      userId: activeUser.id,
      reason,
      createdAt: this.clock.nowUtcIso(),
    });

    this.logger.info('COMMENT_REPORTED', {
      reportId: report.id,
      commentId: comment.id,
      reporterUserId: activeUser.id,
    });

    return {
      ok: true,
      statusCode: 201,
      report,
    };
  }

  private async authorizeAdminCommentsModule(actor: AppUser | null): Promise<{
    allowed: boolean;
    statusCode: 200 | 403 | 404;
    errorCode?: 'FEATURE_DISABLED' | 'FORBIDDEN' | 'NOT_FOUND';
    messageKey?: string;
  }> {
    if (!(await this.isCommentsFeatureEnabledAsync())) {
      return {
        allowed: false,
        statusCode: 404,
        errorCode: 'FEATURE_DISABLED',
        messageKey: 'notFound.title',
      };
    }

    const auth = await this.permissionPolicyService.authorizePermission(
      actor,
      'comments.moderate',
      '#/admin/comments',
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

  public async listAdminCommentsAsync(
    actor: AppUser | null,
    filter?: {
      status?: CommentStatus | 'all';
      search?: string;
    },
  ): Promise<AdminListCommentsResult> {
    const gate = await this.authorizeAdminCommentsModule(actor);
    if (!gate.allowed) {
      return {
        ok: false,
        statusCode: gate.statusCode,
        errorCode: gate.errorCode,
        messageKey: gate.messageKey,
      };
    }

    const [allComments, allReports, allUsers, allContent, ageGroups] =
      await Promise.all([
        this.commentRepository.getAllComments(),
        this.commentRepository.getAllReports(),
        this.adminRepository.getAllUsers(),
        this.contentRepository.getAllContentItems(),
        this.taxonomyRepository.getAllAgeGroups(),
      ]);

    const pendingCount = allComments.filter(
      (c) => c.status === CommentStatus.Pending,
    ).length;

    const userById = new Map(allUsers.map((u) => [u.id, u]));
    const contentById = new Map(allContent.map((c) => [c.id, c]));
    const ageGroupById = new Map(ageGroups.map((g) => [g.id, g]));

    const reportCountByCommentId = new Map<number, number>();
    for (const report of allReports) {
      reportCountByCommentId.set(
        report.commentId,
        (reportCountByCommentId.get(report.commentId) ?? 0) + 1,
      );
    }

    let rows: AdminCommentRow[] = allComments.map((comment) => {
      const author = userById.get(comment.userId);
      const isAuthorDeleted = !author || author.isDeleted === true;
      const authorDisplayName = isAuthorDeleted
        ? this.deletedDisplayName
        : author.displayName;
      const authorAgeGroupName =
        comment.authorAgeGroupId !== null
          ? ageGroupById.get(comment.authorAgeGroupId)?.name ?? null
          : null;
      const content = contentById.get(comment.contentId);
      const moderator =
        comment.moderatedById !== null
          ? userById.get(comment.moderatedById)
          : undefined;

      return {
        comment,
        authorDisplayName,
        isAuthorDeleted,
        authorAgeGroupName,
        contentTitle: content?.title ?? null,
        contentSlug: content?.slug ?? null,
        reportCount: reportCountByCommentId.get(comment.id) ?? 0,
        moderatedByDisplayName: moderator ? moderator.displayName : null,
      };
    });

    if (filter?.status !== undefined && filter.status !== 'all') {
      rows = rows.filter((row) => row.comment.status === filter.status);
    }

    const normalizedSearch = filter?.search
      ? this.searchNormalizer.normalize(filter.search)
      : '';
    if (normalizedSearch) {
      rows = rows.filter((row) => {
        const haystack = this.searchNormalizer.normalize(
          `${row.comment.body} ${row.authorDisplayName} ${row.contentTitle ?? ''}`,
        );
        return haystack.includes(normalizedSearch);
      });
    }

    rows.sort((a, b) => {
      const diff =
        Date.parse(b.comment.createdAt) - Date.parse(a.comment.createdAt);
      if (diff !== 0) {
        return diff;
      }
      return b.comment.id - a.comment.id;
    });

    return {
      ok: true,
      statusCode: 200,
      items: rows,
      pendingCount,
    };
  }

  public async approveCommentAsync(
    actor: AppUser | null,
    commentId: number,
  ): Promise<AdminCommentActionResult> {
    const gate = await this.authorizeAdminCommentsModule(actor);
    if (!gate.allowed || !actor) {
      return {
        ok: false,
        statusCode: gate.statusCode,
        errorCode: gate.errorCode,
        messageKey: gate.messageKey,
      };
    }

    const existing = await this.commentRepository.getCommentById(commentId);
    if (!existing) {
      return {
        ok: false,
        statusCode: 404,
        errorCode: 'NOT_FOUND',
        messageKey: 'comments.report.error.notFound',
      };
    }

    const updated: CommentItem = {
      ...existing,
      status: CommentStatus.Published,
      moderatedById: actor.id,
      moderatedAt: this.clock.nowUtcIso(),
    };
    await this.commentRepository.updateComment(updated);

    this.logger.info('COMMENT_APPROVED', {
      commentId: updated.id,
      actorId: actor.id,
    });

    return {
      ok: true,
      statusCode: 200,
      comment: updated,
    };
  }

  public async hideCommentAsync(
    actor: AppUser | null,
    commentId: number,
  ): Promise<AdminCommentActionResult> {
    const gate = await this.authorizeAdminCommentsModule(actor);
    if (!gate.allowed || !actor) {
      return {
        ok: false,
        statusCode: gate.statusCode,
        errorCode: gate.errorCode,
        messageKey: gate.messageKey,
      };
    }

    const existing = await this.commentRepository.getCommentById(commentId);
    if (!existing) {
      return {
        ok: false,
        statusCode: 404,
        errorCode: 'NOT_FOUND',
        messageKey: 'comments.report.error.notFound',
      };
    }

    const updated: CommentItem = {
      ...existing,
      status: CommentStatus.Hidden,
      moderatedById: actor.id,
      moderatedAt: this.clock.nowUtcIso(),
    };
    await this.commentRepository.updateComment(updated);

    this.logger.info('COMMENT_HIDDEN', {
      commentId: updated.id,
      actorId: actor.id,
    });

    return {
      ok: true,
      statusCode: 200,
      comment: updated,
    };
  }

  /**
   * Rule 6.7 / Spec 3.12: Hard deletion of comments is strictly reserved for SuperAdmin.
   * Staff accounts (even with `comments.moderate`) receive 403 Forbidden + WARN log.
   */
  public async hardDeleteCommentAsync(
    actor: AppUser | null,
    commentId: number,
  ): Promise<AdminCommentActionResult> {
    if (!(await this.isCommentsFeatureEnabledAsync())) {
      return {
        ok: false,
        statusCode: 404,
        errorCode: 'FEATURE_DISABLED',
        messageKey: 'notFound.title',
      };
    }

    const auth = this.permissionPolicyService.authorizeSuperAdminOnly(
      actor,
      '#/admin/comments/hard-delete',
    );
    if (!auth.allowed || !actor) {
      return {
        ok: false,
        statusCode: auth.statusCode,
        errorCode: auth.statusCode === 404 ? 'NOT_FOUND' : 'FORBIDDEN',
        messageKey:
          auth.statusCode === 404 ? 'notFound.title' : 'admin.forbidden.title',
      };
    }

    const existing = await this.commentRepository.getCommentById(commentId);
    if (!existing) {
      return {
        ok: false,
        statusCode: 404,
        errorCode: 'NOT_FOUND',
        messageKey: 'comments.report.error.notFound',
      };
    }

    await this.commentRepository.deleteReportsByCommentId(existing.id);
    await this.commentRepository.deleteComment(existing.id);

    this.logger.info('COMMENT_HARD_DELETED', {
      commentId: existing.id,
      actorId: actor.id,
    });

    return {
      ok: true,
      statusCode: 200,
      comment: existing,
    };
  }

  public async listCommentReportsAsync(
    actor: AppUser | null,
  ): Promise<AdminListReportsResult> {
    const gate = await this.authorizeAdminCommentsModule(actor);
    if (!gate.allowed) {
      return {
        ok: false,
        statusCode: gate.statusCode,
        errorCode: gate.errorCode,
        messageKey: gate.messageKey,
      };
    }

    const [reports, allComments, allUsers, allContent] = await Promise.all([
      this.commentRepository.getAllReports(),
      this.commentRepository.getAllComments(),
      this.adminRepository.getAllUsers(),
      this.contentRepository.getAllContentItems(),
    ]);

    const commentById = new Map(allComments.map((c) => [c.id, c]));
    const userById = new Map(allUsers.map((u) => [u.id, u]));
    const contentById = new Map(allContent.map((c) => [c.id, c]));

    const rows: AdminReportRow[] = reports.map((report) => {
      const reporter = userById.get(report.userId);
      const isReporterDeleted = !reporter || reporter.isDeleted === true;
      const comment = commentById.get(report.commentId) ?? null;
      const commentAuthor = comment ? userById.get(comment.userId) : undefined;
      const isCommentAuthorDeleted = !commentAuthor || commentAuthor.isDeleted === true;
      const content = comment ? contentById.get(comment.contentId) : undefined;

      return {
        report,
        reporterDisplayName: isReporterDeleted
          ? this.deletedDisplayName
          : reporter.displayName,
        isReporterDeleted,
        comment,
        commentAuthorDisplayName: isCommentAuthorDeleted
          ? this.deletedDisplayName
          : commentAuthor.displayName,
        contentTitle: content?.title ?? null,
        contentSlug: content?.slug ?? null,
      };
    });

    rows.sort((a, b) => {
      const diff =
        Date.parse(b.report.createdAt) - Date.parse(a.report.createdAt);
      if (diff !== 0) {
        return diff;
      }
      return b.report.id - a.report.id;
    });

    return {
      ok: true,
      statusCode: 200,
      items: rows,
    };
  }

  public async dismissReportAsync(
    actor: AppUser | null,
    reportId: number,
  ): Promise<AdminDismissReportResult> {
    const gate = await this.authorizeAdminCommentsModule(actor);
    if (!gate.allowed || !actor) {
      return {
        ok: false,
        statusCode: gate.statusCode,
        errorCode: gate.errorCode,
        messageKey: gate.messageKey,
      };
    }

    const existing = await this.commentRepository.getReportById(reportId);
    if (!existing) {
      return {
        ok: false,
        statusCode: 404,
        errorCode: 'NOT_FOUND',
        messageKey: 'comments.report.error.notFound',
      };
    }

    await this.commentRepository.deleteReport(existing.id);

    this.logger.info('COMMENT_REPORT_DISMISSED', {
      reportId: existing.id,
      commentId: existing.commentId,
      actorId: actor.id,
    });

    return {
      ok: true,
      statusCode: 200,
    };
  }

  public async listBlockedWordsAsync(
    actor: AppUser | null,
  ): Promise<AdminBlockedWordsListResult> {
    const gate = await this.authorizeAdminCommentsModule(actor);
    if (!gate.allowed) {
      return {
        ok: false,
        statusCode: gate.statusCode,
        errorCode: gate.errorCode,
        messageKey: gate.messageKey,
      };
    }

    const words = await this.commentRepository.getAllBlockedWords();
    words.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt) || b.id - a.id);

    return {
      ok: true,
      statusCode: 200,
      items: words,
    };
  }

  public async addBlockedWordAsync(
    actor: AppUser | null,
    rawWord: string,
  ): Promise<AdminBlockedWordActionResult> {
    const gate = await this.authorizeAdminCommentsModule(actor);
    if (!gate.allowed || !actor) {
      return {
        ok: false,
        statusCode: gate.statusCode,
        errorCode: gate.errorCode,
        messageKey: gate.messageKey,
      };
    }

    const normalizedWord = this.searchNormalizer.normalize(rawWord);
    if (normalizedWord.length < 2 || normalizedWord.length > 80) {
      return {
        ok: false,
        statusCode: 400,
        errorCode: 'INVALID_WORD',
        messageKey: 'admin.comments.blockedWords.error.invalid',
      };
    }

    const existing = await this.commentRepository.getBlockedWordByNormalizedWord(
      normalizedWord,
    );
    if (existing) {
      return {
        ok: false,
        statusCode: 409,
        errorCode: 'DUPLICATE_WORD',
        messageKey: 'admin.comments.blockedWords.error.duplicate',
      };
    }

    const created = await this.commentRepository.createBlockedWord({
      word: normalizedWord,
      createdAt: this.clock.nowUtcIso(),
    });

    this.logger.info('BLOCKED_WORD_ADDED', {
      wordId: created.id,
      actorId: actor.id,
    });

    return {
      ok: true,
      statusCode: 201,
      word: created,
    };
  }

  public async deleteBlockedWordAsync(
    actor: AppUser | null,
    wordId: number,
  ): Promise<AdminBlockedWordActionResult> {
    const gate = await this.authorizeAdminCommentsModule(actor);
    if (!gate.allowed || !actor) {
      return {
        ok: false,
        statusCode: gate.statusCode,
        errorCode: gate.errorCode,
        messageKey: gate.messageKey,
      };
    }

    const existing = await this.commentRepository.getBlockedWordById(wordId);
    if (!existing) {
      return {
        ok: false,
        statusCode: 404,
        errorCode: 'NOT_FOUND',
        messageKey: 'notFound.title',
      };
    }

    await this.commentRepository.deleteBlockedWord(existing.id);

    this.logger.info('BLOCKED_WORD_DELETED', {
      wordId: existing.id,
      actorId: actor.id,
    });

    return {
      ok: true,
      statusCode: 200,
      word: existing,
    };
  }
}
