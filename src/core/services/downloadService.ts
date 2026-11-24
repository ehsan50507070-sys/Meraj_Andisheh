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
import {
  isS3ConfigComplete,
  type S3StorageConfig,
  type StorageProviderMode,
} from '../domain/storage';
import type { AgeGroup } from '../domain/taxonomy';
import { isContentAllowedForAgeGroup } from './ageRuleService';
import { sanitizeReturnHash } from './navigationGuardService';
import {
  DEFAULT_S3_PRESIGNED_EXPIRES_SECONDS,
  type S3PresignedUrlService,
} from './s3PresignedUrlService';

export const DOWNLOAD_TOKEN_TTL_MS = 5 * 60 * 1000;

export type DownloadErrorCode =
  | 'AUTH_REQUIRED'
  | 'CONTENT_NOT_AVAILABLE'
  | 'FILE_NOT_FOUND'
  | 'EXTERNAL_FILE_NO_DOWNLOAD'
  | 'FILE_NOT_DOWNLOADABLE'
  | 'TOKEN_INVALID'
  | 'TOKEN_USER_MISMATCH'
  | 'TOKEN_EXPIRED'
  | 'PRESIGNED_URL_EXPIRED'
  | 'INVALID_SIGNATURE';

export type CreateSignedDownloadLinkResult =
  | {
      ok: true;
      token: string;
      downloadUrl: string;
      expiresAt: string;
      expiresAtEpochMs: number;
      storageProvider: StorageProviderMode;
      presignedS3Url?: string;
      s3SignedExpiresInSeconds?: number;
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
      storageProvider: StorageProviderMode;
      presignedS3Url?: string;
      rangeMeta?: DownloadRangeMeta;
    }
  | {
      ok: false;
      errorCode: DownloadErrorCode;
      contentSlug?: string | null;
      redirectUrl?: string;
    };

export interface DownloadServiceS3Options {
  getStorageConfigAsync: () => Promise<S3StorageConfig>;
  presignedUrlService: S3PresignedUrlService;
}

export class DownloadService {
  private readonly contentRepository: IContentRepository;
  private readonly downloadEventRepository: IDownloadEventRepository;
  private readonly fileStorage: IFileStorage;
  private readonly tokenProtector: IDownloadTokenProtector;
  private readonly clock: IClock;
  private readonly logger?: ILogger;
  private readonly s3Options?: DownloadServiceS3Options;

  constructor(
    contentRepository: IContentRepository,
    downloadEventRepository: IDownloadEventRepository,
    fileStorage: IFileStorage,
    tokenProtector: IDownloadTokenProtector,
    clock: IClock,
    logger?: ILogger,
    s3Options?: DownloadServiceS3Options,
  ) {
    this.contentRepository = contentRepository;
    this.downloadEventRepository = downloadEventRepository;
    this.fileStorage = fileStorage;
    this.tokenProtector = tokenProtector;
    this.clock = clock;
    this.logger = logger;
    this.s3Options = s3Options;
  }

  private async resolveActiveS3ConfigAsync(): Promise<S3StorageConfig | null> {
    if (!this.s3Options) {
      return null;
    }
    const cfg = await this.s3Options.getStorageConfigAsync();
    if (cfg.provider === 's3' && isS3ConfigComplete(cfg)) {
      return cfg;
    }
    return null;
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
    let expiresAtEpochMs = nowMs + DOWNLOAD_TOKEN_TTL_MS;
    let storageProvider: StorageProviderMode = 'local';
    let presignedS3Url: string | undefined;
    let s3SignedExpiresInSeconds: number | undefined;

    const activeS3Config = await this.resolveActiveS3ConfigAsync();
    if (activeS3Config && this.s3Options) {
      const signed =
        await this.s3Options.presignedUrlService.createS3PresignedDownloadUrlAsync({
          config: activeS3Config,
          storageKey: file.storageKey,
          contentId: content.id,
          fileId: file.id,
          userId: input.currentUser.id,
          originalFileName: file.originalFileName,
          expiresInSeconds: DEFAULT_S3_PRESIGNED_EXPIRES_SECONDS,
        });
      storageProvider = 's3';
      presignedS3Url = signed.url;
      expiresAtEpochMs = signed.expiresAtEpochMs;
      s3SignedExpiresInSeconds = signed.expiresInSeconds;
    }

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
      storageProvider,
      presignedS3Url,
      s3SignedExpiresInSeconds,
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

    return this.streamVerifiedFileDownloadAsync({
      contentId: payload.contentId,
      fileId: payload.fileId,
      currentUser: input.currentUser,
      activeAgeGroup: input.activeAgeGroup,
      expiresAtEpochMs: payload.expiresAtEpochMs,
      range: input.range,
      forceProvider: null,
    });
  }

  public async executeS3PresignedDownloadAsync(input: {
    presignedUrl: string;
    currentUser: AppUser | null;
    activeAgeGroup: AgeGroup | null;
    range?: { startByte: number; endByte: number };
  }): Promise<ExecuteSignedDownloadResult> {
    if (!input.currentUser || !input.currentUser.isActive) {
      return {
        ok: false,
        errorCode: 'AUTH_REQUIRED',
      };
    }

    if (!this.s3Options) {
      return {
        ok: false,
        errorCode: 'INVALID_SIGNATURE',
      };
    }

    const config = await this.s3Options.getStorageConfigAsync();
    const verification =
      await this.s3Options.presignedUrlService.verifyS3PresignedUrlAsync(
        input.presignedUrl,
        config,
      );

    if (!verification.ok) {
      if (verification.errorCode === 'PRESIGNED_URL_EXPIRED') {
        this.logger?.info('S3_PRESIGNED_URL_EXPIRED', {
          userId: input.currentUser.id,
        });
        return {
          ok: false,
          errorCode: 'PRESIGNED_URL_EXPIRED',
        };
      }
      this.logger?.warn('S3_PRESIGNED_URL_INVALID_SIGNATURE', {
        userId: input.currentUser.id,
        reason: verification.errorCode,
      });
      return {
        ok: false,
        errorCode: 'INVALID_SIGNATURE',
      };
    }

    if (verification.meta.userId !== input.currentUser.id) {
      this.logger?.warn('S3_PRESIGNED_USER_MISMATCH', {
        tokenUserId: verification.meta.userId,
        actorUserId: input.currentUser.id,
        contentId: verification.meta.contentId,
        fileId: verification.meta.fileId,
      });
      return {
        ok: false,
        errorCode: 'TOKEN_USER_MISMATCH',
      };
    }

    return this.streamVerifiedFileDownloadAsync({
      contentId: verification.meta.contentId,
      fileId: verification.meta.fileId,
      currentUser: input.currentUser,
      activeAgeGroup: input.activeAgeGroup,
      expiresAtEpochMs: verification.expiresAtEpochMs,
      range: input.range,
      forceProvider: 's3',
      presignedS3Url: input.presignedUrl,
    });
  }

  private async streamVerifiedFileDownloadAsync(input: {
    contentId: number;
    fileId: number;
    currentUser: AppUser;
    activeAgeGroup: AgeGroup | null;
    expiresAtEpochMs: number;
    range?: { startByte: number; endByte: number };
    forceProvider: StorageProviderMode | null;
    presignedS3Url?: string;
  }): Promise<ExecuteSignedDownloadResult> {
    const content = await this.contentRepository.getContentItemById(input.contentId);
    const contentAgeIds = content
      ? await this.contentRepository.getAgeGroupIdsByContentId(content.id)
      : [];

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
    const file = files.find((f) => f.id === input.fileId);
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

    const activeS3Config =
      input.forceProvider === null ? await this.resolveActiveS3ConfigAsync() : null;
    const storageProvider: StorageProviderMode =
      input.forceProvider ?? (activeS3Config ? 's3' : 'local');

    let resolvedPresignedUrl = input.presignedS3Url;
    if (!resolvedPresignedUrl && activeS3Config && this.s3Options) {
      const signed =
        await this.s3Options.presignedUrlService.createS3PresignedDownloadUrlAsync({
          config: activeS3Config,
          storageKey: file.storageKey,
          contentId: content.id,
          fileId: file.id,
          userId: input.currentUser.id,
          originalFileName: file.originalFileName,
          expiresInSeconds: DEFAULT_S3_PRESIGNED_EXPIRES_SECONDS,
        });
      resolvedPresignedUrl = signed.url;
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
      storageProvider,
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
      expiresAtEpochMs: input.expiresAtEpochMs,
      event: recordedEvent,
      storageProvider,
      presignedS3Url: resolvedPresignedUrl,
      rangeMeta,
    };
  }
}
