import type { IAdminRepository } from '../abstractions/adminRepository';
import type { IFileStorage } from '../abstractions/fileStorage';
import type { ILogger } from '../abstractions/ILogger';
import type { AppUser } from '../domain/auth';
import type { PermissionKey } from '../domain/permissions';
import type {
  FileValidationErrorCode,
  FileValidationResult,
  FileVisibility,
  StoredFileMetadata,
} from '../domain/storage';
import {
  DEFAULT_MAX_OTHER_MB,
  DEFAULT_MAX_VIDEO_MB,
  getValidationErrorMessageKey,
  validateUploadedFile,
} from './fileValidationService';
import { normalizeDigits } from './identifierService';
import { PermissionPolicyService } from './permissionPolicyService';

export const STORAGE_TEST_REQUIRED_PERMISSIONS: readonly PermissionKey[] = [
  'content.manage',
  'settings.manage',
] as const;

export interface UploadLimits {
  maxVideoMb: number;
  maxOtherMb: number;
}

export interface UploadFileInput {
  originalFileName: string;
  bytes: Uint8Array;
  visibility: FileVisibility;
  overrideSizeBytes?: number;
}

export interface UploadFileResult {
  ok: boolean;
  statusCode: 200 | 400 | 403 | 404;
  metadata?: StoredFileMetadata;
  errorCode?: FileValidationErrorCode | 'NOT_FOUND' | 'FORBIDDEN';
  messageKey?: string;
  validation?: FileValidationResult;
}

export interface ListStoredFilesResult {
  ok: boolean;
  statusCode: 200 | 403 | 404;
  items?: StoredFileMetadata[];
  limits?: UploadLimits;
  messageKey?: string;
}

export interface DeleteStoredFileResult {
  ok: boolean;
  statusCode: 200 | 403 | 404;
  messageKey?: string;
}

export interface OpenPublicMediaResult {
  ok: boolean;
  statusCode: 200 | 403 | 404;
  bytes?: Uint8Array;
  metadata?: StoredFileMetadata;
  errorCode?: 'NOT_FOUND' | 'ACCESS_DENIED';
  messageKey?: string;
}

const PUBLIC_IMAGE_EXTENSIONS: ReadonlySet<string> = new Set([
  'png',
  'jpg',
  'jpeg',
  'webp',
]);

function parsePositiveLimitMb(raw: string | null | undefined, fallbackMb: number): number {
  if (!raw) {
    return fallbackMb;
  }
  const normalized = normalizeDigits(raw).trim();
  if (!/^\d+$/.test(normalized)) {
    return fallbackMb;
  }
  const parsed = Number(normalized);
  return parsed > 0 ? parsed : fallbackMb;
}

function isSafeStorageKeyFormat(storageKey: string): boolean {
  if (!storageKey || storageKey.includes('..') || storageKey.includes('\\')) {
    return false;
  }
  if (/[\x00-\x1f]/.test(storageKey)) {
    return false;
  }
  return true;
}

export class FileUploadService {
  private readonly fileStorage: IFileStorage;
  private readonly adminRepository: IAdminRepository;
  private readonly policyService: PermissionPolicyService;
  private readonly logger: ILogger;

  constructor(
    fileStorage: IFileStorage,
    adminRepository: IAdminRepository,
    policyService: PermissionPolicyService,
    logger: ILogger,
  ) {
    this.fileStorage = fileStorage;
    this.adminRepository = adminRepository;
    this.policyService = policyService;
    this.logger = logger;
  }

  public async getUploadLimitsAsync(): Promise<UploadLimits> {
    const [videoSetting, otherSetting] = await Promise.all([
      this.adminRepository.getSiteSettingByKey('Upload.MaxVideoMb'),
      this.adminRepository.getSiteSettingByKey('Upload.MaxOtherMb'),
    ]);

    return {
      maxVideoMb: parsePositiveLimitMb(videoSetting?.value, DEFAULT_MAX_VIDEO_MB),
      maxOtherMb: parsePositiveLimitMb(otherSetting?.value, DEFAULT_MAX_OTHER_MB),
    };
  }

  public async uploadFileAsync(
    actor: AppUser | null,
    input: UploadFileInput,
    options?: {
      allowedPermissions?: readonly PermissionKey[];
      routePath?: string;
    },
  ): Promise<UploadFileResult> {
    const allowedPermissions = options?.allowedPermissions ?? STORAGE_TEST_REQUIRED_PERMISSIONS;
    const routePath = options?.routePath ?? '#/admin/storage-test';
    const auth = await this.policyService.authorizeAnyPermission(
      actor,
      allowedPermissions,
      routePath,
    );
    if (!auth.allowed || !actor) {
      return {
        ok: false,
        statusCode: auth.statusCode,
        errorCode: auth.statusCode === 404 ? 'NOT_FOUND' : 'FORBIDDEN',
        messageKey: auth.statusCode === 404 ? 'notFound.title' : 'admin.forbidden.title',
      };
    }

    const limits = await this.getUploadLimitsAsync();
    const validation = validateUploadedFile({
      originalFileName: input.originalFileName,
      bytes: input.bytes,
      visibility: input.visibility,
      maxVideoMb: limits.maxVideoMb,
      maxOtherMb: limits.maxOtherMb,
      overrideSizeBytes: input.overrideSizeBytes,
    });

    if (!validation.isValid || !validation.detectedMimeType) {
      this.logger.warn('FILE_UPLOAD_REJECTED', {
        userId: actor.id,
        errorCode: validation.errorCode ?? 'UNKNOWN',
        extension: validation.normalizedExtension ?? null,
        visibility: input.visibility,
      });

      return {
        ok: false,
        statusCode: 400,
        errorCode: validation.errorCode,
        messageKey: getValidationErrorMessageKey(validation.errorCode),
        validation,
      };
    }

    const metadata = await this.fileStorage.saveAsync({
      bytes: input.bytes,
      originalFileName: input.originalFileName,
      contentType: validation.detectedMimeType,
      visibility: input.visibility,
      uploadedById: actor.id,
    });

    this.logger.info('FILE_UPLOAD_SAVED', {
      userId: actor.id,
      storageKey: metadata.storageKey,
      visibility: metadata.visibility,
      category: metadata.category,
      sizeBytes: metadata.sizeBytes,
    });

    return {
      ok: true,
      statusCode: 200,
      metadata,
      validation,
    };
  }

  public async listFilesAsync(actor: AppUser | null): Promise<ListStoredFilesResult> {
    const auth = await this.policyService.authorizeAnyPermission(
      actor,
      STORAGE_TEST_REQUIRED_PERMISSIONS,
      '#/admin/storage-test',
    );
    if (!auth.allowed) {
      return {
        ok: false,
        statusCode: auth.statusCode,
        messageKey: auth.statusCode === 404 ? 'notFound.title' : 'admin.forbidden.title',
      };
    }

    const [items, limits] = await Promise.all([
      this.fileStorage.listAllMetadataAsync(),
      this.getUploadLimitsAsync(),
    ]);

    return {
      ok: true,
      statusCode: 200,
      items,
      limits,
    };
  }

  public async deleteFileAsync(
    actor: AppUser | null,
    storageKey: string,
    options?: {
      allowedPermissions?: readonly PermissionKey[];
      routePath?: string;
    },
  ): Promise<DeleteStoredFileResult> {
    const allowedPermissions = options?.allowedPermissions ?? STORAGE_TEST_REQUIRED_PERMISSIONS;
    const routePath = options?.routePath ?? '#/admin/storage-test';
    const auth = await this.policyService.authorizeAnyPermission(
      actor,
      allowedPermissions,
      routePath,
    );
    if (!auth.allowed || !actor) {
      return {
        ok: false,
        statusCode: auth.statusCode,
        messageKey: auth.statusCode === 404 ? 'notFound.title' : 'admin.forbidden.title',
      };
    }

    await this.fileStorage.deleteAsync(storageKey);
    this.logger.info('FILE_DELETED', {
      userId: actor.id,
      storageKey,
    });

    return {
      ok: true,
      statusCode: 200,
    };
  }

  /**
   * Public media serving guard (equivalent to public thumbnail route isolated from private vault).
   * Allows ONLY `public/` keys with `visibility === 'public'` and `category === 'image'`.
   * Blocks all `private/` keys and non-image formats and logs unauthorized attempts.
   */
  public async openPublicMediaAsync(rawStorageKey: string): Promise<OpenPublicMediaResult> {
    const storageKey = (rawStorageKey ?? '').trim().replace(/^\/+/, '');
    if (!isSafeStorageKeyFormat(storageKey) || !storageKey.startsWith('public/')) {
      this.logger.warn('PUBLIC_MEDIA_ACCESS_DENIED', {
        storageKey,
        reason: 'NON_PUBLIC_OR_UNSAFE_KEY',
      });
      return {
        ok: false,
        statusCode: 403,
        errorCode: 'ACCESS_DENIED',
        messageKey: 'media.public.denied',
      };
    }

    const fileResult = await this.fileStorage.openReadAsync(storageKey);
    if (!fileResult) {
      return {
        ok: false,
        statusCode: 404,
        errorCode: 'NOT_FOUND',
        messageKey: 'media.public.notFound',
      };
    }

    const { metadata, bytes } = fileResult;
    if (
      metadata.visibility !== 'public' ||
      metadata.category !== 'image' ||
      !PUBLIC_IMAGE_EXTENSIONS.has(metadata.extension.toLowerCase())
    ) {
      this.logger.warn('PUBLIC_MEDIA_ACCESS_DENIED', {
        storageKey,
        reason: 'PRIVATE_OR_NON_IMAGE_METADATA',
        visibility: metadata.visibility,
        category: metadata.category,
      });
      return {
        ok: false,
        statusCode: 403,
        errorCode: 'ACCESS_DENIED',
        messageKey: 'media.public.denied',
      };
    }

    return {
      ok: true,
      statusCode: 200,
      bytes,
      metadata,
    };
  }
}
