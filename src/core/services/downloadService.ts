import type { IClock } from '../abstractions/IClock';
import type { IContentRepository } from '../abstractions/contentRepository';
import type { IDownloadEventRepository } from '../abstractions/downloadRepository';
import type { IDownloadTokenProtector } from '../abstractions/downloadTokenProtector';
import type { IFileStorage } from '../abstractions/fileStorage';
import type { ILogger } from '../abstractions/ILogger';
import {
  DownloadKind,
  type DownloadEvent,
  type DownloadTokenPayload,
} from '../domain/analytics';
import type { AppUser } from '../domain/auth';
import { ContentStatus, FileStorageType } from '../domain/content';
import type { AgeGroup } from '../domain/taxonomy';
import { isContentAllowedForAgeGroup } from './ageRuleService';
import { sanitizeReturnHash } from './navigationGuardService';

export const DOWNLOAD_TOKEN_TTL_MS = 5 * 60 * 1000;

export type DownloadErrorCode =
  | 'AUTH_REQUIRED'
  | 'CONTENT_NOT_AVAILABLE'
  | 'FILE_NOT_FOUND'
  | 'EXTERNAL_FILE_NO_DOWNLOAD'
  | 'FILE_NOT_DOWNLOADABLE'
  | 'TOKEN_INVALID'
  | 'TOKEN_USER_MISMATCH'
  | 'TOKEN_EXPIRED';

export type CreateSignedDownloadLinkResult =
  | {
      ok: true;
      token: string;
      downloadUrl: string;
      expiresAt: string;
      expiresAtEpochMs: number;
    }
  | {
      ok: false;
      errorCode: DownloadErrorCode;
      redirectUrl?: string;
    };

export interface DownloadRangeMeta {
  startByte: number;
  endByte: number;
  totalBytes: number;
}

export type ExecuteSignedDownloadResult =
  | {
      ok: true;
      bytes: Uint8Array;
      originalFileName: string;
      mimeType: string;
      sizeBytes: number;
      contentId: number;
      contentSlug: string;
      contentTitle: string;
      expiresAtEpochMs: number;
      event: DownloadEvent;
      rangeMeta?: DownloadRangeMeta;
    }
  | {
      ok: false;
      errorCode: DownloadErrorCode;
      contentSlug?: string | null;
      redirectUrl?: string;
    };

export class DownloadService {
  private readonly contentRepository: IContentRepository;
  private readonly downloadEventRepository: IDownloadEventRepository;
  private readonly fileStorage: IFileStorage;
  private readonly tokenProtector: IDownloadTokenProtector;
  private readonly clock: IClock;
  private readonly logger?: ILogger;

  constructor(
    contentRepository: IContentRepository,
    downloadEventRepository: IDownloadEventRepository,
    fileStorage: IFileStorage,
    tokenProtector: IDownloadTokenProtector,
    clock: IClock,
    logger?: ILogger,
  ) {
    this.contentRepository = contentRepository;
    this.downloadEventRepository = downloadEventRepository;
    this.fileStorage = fileStorage;
    this.tokenProtector = tokenProtector;
    this.clock = clock;
    this.logger = logger;
  }

  public async createSignedDownloadLinkAsync(input: {
    currentUser: AppUser | null;
    contentId: number;
    fileId: number;
    activeAgeGroup: AgeGroup | null;
    returnUrl?: string | null;
  }): Promise<CreateSignedDownloadLinkResult> {
    const content = await this.contentRepository.getContentItemById(input.contentId);
    const defaultReturnHash =
      content && content.slug
        ? `#/content/${encodeURIComponent(content.slug)}`
        : '#/';
    const safeReturn = sanitizeReturnHash(input.returnUrl) ?? defaultReturnHash;

    if (!input.currentUser || !input.currentUser.isActive) {
      return {
        ok: false,
        errorCode: 'AUTH_REQUIRED',
        redirectUrl: `#/account/login?returnUrl=${encodeURIComponent(safeReturn)}`,
      };
    }

    if (!content || content.status !== ContentStatus.Published) {
      return {
        ok: false,
        errorCode: 'CONTENT_NOT_AVAILABLE',
      };
    }

    const ageGroupIds = await this.contentRepository.getAgeGroupIdsByContentId(content.id);
    if (!isContentAllowedForAgeGroup(ageGroupIds, input.activeAgeGroup)) {
      return {
        ok: false,
        errorCode: 'CONTENT_NOT_AVAILABLE',
      };
    }

    const files = await this.contentRepository.getFilesByContentId(content.id);
    const file = files.find((f) => f.id === input.fileId);
    if (!file) {
      return {
        ok: false,
        errorCode: 'FILE_NOT_FOUND',
      };
    }

    if (file.storageType === FileStorageType.External) {
      return {
        ok: false,
        errorCode: 'EXTERNAL_FILE_NO_DOWNLOAD',
      };
    }

    if (!file.isDownloadable) {
      return {
        ok: false,
        errorCode: 'FILE_NOT_DOWNLOADABLE',
      };
    }

    if (!file.storageKey || !(await this.fileStorage.existsAsync(file.storageKey))) {
      return {
        ok: false,
        errorCode: 'FILE_NOT_FOUND',
      };
    }

    const nowMs = this.clock.now().getTime();
    const expiresAtEpochMs = nowMs + DOWNLOAD_TOKEN_TTL_MS;
    const payload: DownloadTokenPayload = {
      userId: input.currentUser.id,
      contentId: content.id,
      fileId: file.id,
      issuedAtEpochMs: nowMs,
      expiresAtEpochMs,
    };

    const token = await this.tokenProtector.protectAsync(payload);

    return {
      ok: true,
      token,
      downloadUrl: `#/download/${token}`,
      expiresAt: new Date(expiresAtEpochMs).toISOString(),
      expiresAtEpochMs,
    };
  }

  public async executeSignedDownloadAsync(input: {
    token: string;
    currentUser: AppUser | null;
    activeAgeGroup: AgeGroup | null;
    range?: { startByte: number; endByte: number };
  }): Promise<ExecuteSignedDownloadResult> {
    const rawToken = (input.token ?? '').trim();
    const loginRedirect = `#/account/login?returnUrl=${encodeURIComponent(`#/download/${rawToken}`)}`;

    if (!input.currentUser || !input.currentUser.isActive) {
      return {
        ok: false,
        errorCode: 'AUTH_REQUIRED',
        redirectUrl: loginRedirect,
      };
    }

    const unprotectResult = await this.tokenProtector.unprotectAsync(rawToken);
    if (!unprotectResult.isValid || !unprotectResult.payload) {
      this.logger?.warn('DOWNLOAD_TOKEN_INVALID', {
        reason: unprotectResult.reason ?? 'INVALID_FORMAT',
        userId: input.currentUser.id,
      });
      return {
        ok: false,
        errorCode: 'TOKEN_INVALID',
      };
    }

    const payload = unprotectResult.payload;

    if (payload.userId !== input.currentUser.id) {
      this.logger?.warn('DOWNLOAD_TOKEN_USER_MISMATCH', {
        tokenUserId: payload.userId,
        actorUserId: input.currentUser.id,
        contentId: payload.contentId,
        fileId: payload.fileId,
      });
      return {
        ok: false,
        errorCode: 'TOKEN_USER_MISMATCH',
      };
    }

    const content = await this.contentRepository.getContentItemById(payload.contentId);
    const contentAgeIds = content
      ? await this.contentRepository.getAgeGroupIdsByContentId(content.id)
      : [];
    const safeSlug =
      content &&
      content.status === ContentStatus.Published &&
      isContentAllowedForAgeGroup(contentAgeIds, input.activeAgeGroup)
        ? content.slug
        : null;

    const nowMs = this.clock.now().getTime();
    if (nowMs > payload.expiresAtEpochMs) {
      this.logger?.info('DOWNLOAD_TOKEN_EXPIRED', {
        userId: input.currentUser.id,
        contentId: payload.contentId,
        fileId: payload.fileId,
      });
      return {
        ok: false,
        errorCode: 'TOKEN_EXPIRED',
        contentSlug: safeSlug,
      };
    }

    if (
      !content ||
      content.status !== ContentStatus.Published ||
      !isContentAllowedForAgeGroup(contentAgeIds, input.activeAgeGroup)
    ) {
      return {
        ok: false,
        errorCode: 'CONTENT_NOT_AVAILABLE',
      };
    }

    const files = await this.contentRepository.getFilesByContentId(content.id);
    const file = files.find((f) => f.id === payload.fileId);
    if (!file) {
      return {
        ok: false,
        errorCode: 'FILE_NOT_FOUND',
        contentSlug: content.slug,
      };
    }

    if (file.storageType === FileStorageType.External) {
      return {
        ok: false,
        errorCode: 'EXTERNAL_FILE_NO_DOWNLOAD',
        contentSlug: content.slug,
      };
    }

    if (!file.isDownloadable) {
      return {
        ok: false,
        errorCode: 'FILE_NOT_DOWNLOADABLE',
        contentSlug: content.slug,
      };
    }

    if (!file.storageKey) {
      return {
        ok: false,
        errorCode: 'FILE_NOT_FOUND',
        contentSlug: content.slug,
      };
    }

    let bytes: Uint8Array;
    let resolvedMimeType = file.mimeType;
    let totalBytes: number;
    let rangeMeta: DownloadRangeMeta | undefined;

    if (input.range) {
      const rangeResult = await this.fileStorage.openReadRangeAsync(
        file.storageKey,
        input.range.startByte,
        input.range.endByte,
      );
      if (!rangeResult) {
        return {
          ok: false,
          errorCode: 'FILE_NOT_FOUND',
          contentSlug: content.slug,
        };
      }
      bytes = rangeResult.chunk;
      resolvedMimeType = rangeResult.mimeType || file.mimeType;
      totalBytes = rangeResult.totalBytes;
      rangeMeta = {
        startByte: rangeResult.startByte,
        endByte: rangeResult.endByte,
        totalBytes: rangeResult.totalBytes,
      };
    } else {
      const opened = await this.fileStorage.openReadAsync(file.storageKey);
      if (!opened) {
        return {
          ok: false,
          errorCode: 'FILE_NOT_FOUND',
          contentSlug: content.slug,
        };
      }
      bytes = opened.bytes;
      resolvedMimeType = opened.metadata.mimeType || file.mimeType;
      totalBytes = opened.metadata.sizeBytes;
    }

    const recordedEvent = await this.downloadEventRepository.createDownloadEvent({
      kind: DownloadKind.File,
      contentId: content.id,
      fileId: file.id,
      userId: input.currentUser.id,
      ageGroupId: input.activeAgeGroup?.id ?? input.currentUser.ageGroupId ?? null,
      occurredAt: this.clock.nowUtcIso(),
    });

    await this.contentRepository.updateContentItem({
      ...content,
      downloadCount: content.downloadCount + 1,
    });

    this.logger?.info('FILE_DOWNLOADED', {
      contentId: content.id,
      fileId: file.id,
      userId: input.currentUser.id,
      isRange: Boolean(input.range),
    });

    return {
      ok: true,
      bytes,
      originalFileName: file.originalFileName,
      mimeType: resolvedMimeType,
      sizeBytes: totalBytes,
      contentId: content.id,
      contentSlug: content.slug,
      contentTitle: content.title,
      expiresAtEpochMs: payload.expiresAtEpochMs,
      event: recordedEvent,
      rangeMeta,
    };
  }
}
