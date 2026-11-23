import type { IAuthRepository, ISessionTokenStore } from '../abstractions/authRepository';
import type { IClock } from '../abstractions/IClock';
import type { IContentRepository } from '../abstractions/contentRepository';
import type { IDownloadEventRepository } from '../abstractions/downloadRepository';
import type { ILogger } from '../abstractions/ILogger';
import type {
  IAccountCleanupRepository,
  IInteractionRepository,
} from '../abstractions/interactionRepository';
import type { IPasswordHasher } from '../abstractions/passwordHasher';
import type { DownloadEvent } from '../domain/analytics';
import type { AppUser } from '../domain/auth';
import { ContentStatus, type ContentFormat } from '../domain/content';
import type { AgeGroup } from '../domain/taxonomy';
import { DISPLAY_NAME_MAX_LENGTH } from './authService';
import { normalizeDigits } from './identifierService';
import { OTP_MAX_ATTEMPTS } from './otpService';

export type ProfileUpdateErrorCode =
  | 'AUTH_REQUIRED'
  | 'INVALID_DISPLAY_NAME'
  | 'INVALID_AGE_GROUP';

export type UpdateProfileResult =
  | { ok: true; user: AppUser; ageGroup: AgeGroup }
  | { ok: false; errorCode: ProfileUpdateErrorCode };

export interface DownloadHistoryEntry {
  event: DownloadEvent;
  contentTitle: string;
  contentSlug: string | null;
  contentFormat: ContentFormat | null;
  contentStatus: ContentStatus | null;
  isPubliclyAccessible: boolean;
  fileName: string | null;
  fileSizeBytes: number | null;
}

export type GetUserDownloadHistoryResult =
  | { ok: true; entries: DownloadHistoryEntry[] }
  | { ok: false; errorCode: 'FORBIDDEN' };

export type DeleteAccountErrorCode =
  | 'AUTH_REQUIRED'
  | 'CANNOT_DELETE_LAST_SUPERADMIN'
  | 'INVALID_PASSWORD'
  | 'CONFIRMATION_REQUIRED'
  | 'INVALID_OTP'
  | 'OTP_EXPIRED'
  | 'OTP_LOCKED';

export interface DeleteAccountConfirmation {
  password?: string;
  otpCode?: string;
  confirmPhrase?: string;
}

export interface DeleteAccountOptions {
  anonymizeExternalComments?: (
    userId: number,
    anonymousLabel: string,
  ) => Promise<number>;
}

export type DeleteAccountResult =
  | {
      ok: true;
      deletedDisplayName: string;
      removedLikesCount: number;
      removedBookmarksCount: number;
      anonymizedViewsCount: number;
      anonymizedDownloadsCount: number;
      anonymizedCommentsCount: number;
    }
  | { ok: false; errorCode: DeleteAccountErrorCode };

function isActiveUser(user: AppUser | null): user is AppUser {
  return Boolean(user && user.isActive && !user.isDeleted);
}

export class ProfileService {
  private readonly authRepository: IAuthRepository;
  private readonly contentRepository: IContentRepository;
  private readonly interactionRepository: IInteractionRepository;
  private readonly downloadEventRepository: IDownloadEventRepository;
  private readonly cleanupRepository: IAccountCleanupRepository;
  private readonly passwordHasher: IPasswordHasher;
  private readonly sessionTokenStore: ISessionTokenStore;
  private readonly clock: IClock;
  private readonly logger: ILogger;
  private readonly deletedDisplayName: string;

  constructor(params: {
    authRepository: IAuthRepository;
    contentRepository: IContentRepository;
    interactionRepository: IInteractionRepository;
    downloadEventRepository: IDownloadEventRepository;
    cleanupRepository: IAccountCleanupRepository;
    passwordHasher: IPasswordHasher;
    sessionTokenStore: ISessionTokenStore;
    clock: IClock;
    logger: ILogger;
    deletedDisplayName: string;
  }) {
    this.authRepository = params.authRepository;
    this.contentRepository = params.contentRepository;
    this.interactionRepository = params.interactionRepository;
    this.downloadEventRepository = params.downloadEventRepository;
    this.cleanupRepository = params.cleanupRepository;
    this.passwordHasher = params.passwordHasher;
    this.sessionTokenStore = params.sessionTokenStore;
    this.clock = params.clock;
    this.logger = params.logger;
    this.deletedDisplayName = params.deletedDisplayName;
  }

  public async updateProfileAsync(
    actor: AppUser | null,
    input: { displayName: string; ageGroupId: number },
  ): Promise<UpdateProfileResult> {
    if (!isActiveUser(actor)) {
      return { ok: false, errorCode: 'AUTH_REQUIRED' };
    }

    const user = await this.authRepository.getUserById(actor.id);
    if (!isActiveUser(user)) {
      return { ok: false, errorCode: 'AUTH_REQUIRED' };
    }

    const trimmedDisplayName = (input.displayName ?? '').trim();
    if (
      trimmedDisplayName.length === 0 ||
      trimmedDisplayName.length > DISPLAY_NAME_MAX_LENGTH
    ) {
      return { ok: false, errorCode: 'INVALID_DISPLAY_NAME' };
    }

    const activeAgeGroups = await this.authRepository.getActiveAgeGroups();
    const targetAgeGroup =
      typeof input.ageGroupId === 'number' && Number.isInteger(input.ageGroupId)
        ? activeAgeGroups.find((g) => g.id === input.ageGroupId)
        : undefined;

    if (!targetAgeGroup) {
      return { ok: false, errorCode: 'INVALID_AGE_GROUP' };
    }

    const updatedUser: AppUser = {
      ...user,
      displayName: trimmedDisplayName,
      ageGroupId: targetAgeGroup.id,
    };

    await this.authRepository.updateUser(updatedUser);

    this.logger.info('USER_PROFILE_UPDATED', {
      userId: updatedUser.id,
      ageGroupId: targetAgeGroup.id,
    });

    return {
      ok: true,
      user: updatedUser,
      ageGroup: targetAgeGroup,
    };
  }

  public async getUserDownloadHistoryAsync(
    actor: AppUser | null,
    targetUserId: number,
  ): Promise<GetUserDownloadHistoryResult> {
    if (!isActiveUser(actor) || actor.id !== targetUserId) {
      this.logger.warn('DOWNLOAD_HISTORY_FORBIDDEN', {
        actorId: actor?.id ?? null,
        targetUserId,
      });
      return { ok: false, errorCode: 'FORBIDDEN' };
    }

    const [events, items, files] = await Promise.all([
      this.downloadEventRepository.getDownloadEventsByUserId(targetUserId),
      this.contentRepository.getAllContentItems(),
      this.contentRepository.getAllFiles(),
    ]);

    const itemById = new Map(items.map((it) => [it.id, it]));
    const fileById = new Map(files.map((f) => [f.id, f]));

    const sortedEvents = [...events].sort(
      (a, b) => b.occurredAt.localeCompare(a.occurredAt) || b.id - a.id,
    );

    const entries: DownloadHistoryEntry[] = sortedEvents.map((event) => {
      const item = itemById.get(event.contentId) ?? null;
      const file = event.fileId !== null ? (fileById.get(event.fileId) ?? null) : null;
      return {
        event,
        contentTitle: item?.title ?? '',
        contentSlug: item?.slug ?? null,
        contentFormat: item?.format ?? null,
        contentStatus: item?.status ?? null,
        isPubliclyAccessible: item?.status === ContentStatus.Published,
        fileName: file?.originalFileName ?? null,
        fileSizeBytes: file?.sizeBytes ?? null,
      };
    });

    return { ok: true, entries };
  }

  public async deleteAccountAsync(
    actor: AppUser | null,
    confirmation: DeleteAccountConfirmation,
    options?: DeleteAccountOptions,
  ): Promise<DeleteAccountResult> {
    if (!isActiveUser(actor)) {
      return { ok: false, errorCode: 'AUTH_REQUIRED' };
    }

    const user = await this.authRepository.getUserById(actor.id);
    if (!isActiveUser(user)) {
      return { ok: false, errorCode: 'AUTH_REQUIRED' };
    }

    if (user.role === 'SuperAdmin') {
      const allUsers = await this.authRepository.getAllUsers();
      const activeSuperAdminCount = allUsers.filter(
        (u) => u.role === 'SuperAdmin' && u.isActive && !u.isDeleted,
      ).length;
      if (activeSuperAdminCount <= 1) {
        this.logger.warn('ACCOUNT_DELETE_LAST_SUPERADMIN_BLOCKED', {
          userId: user.id,
        });
        return { ok: false, errorCode: 'CANNOT_DELETE_LAST_SUPERADMIN' };
      }
    }

    // Identity confirmation prior to destructive anonymization
    if (user.passwordHash && user.passwordSalt) {
      const passwordOk = await this.passwordHasher.verifyPassword(
        confirmation.password ?? '',
        user.passwordHash,
        user.passwordSalt,
      );
      if (!passwordOk) {
        this.logger.warn('ACCOUNT_DELETE_INVALID_PASSWORD', { userId: user.id });
        return { ok: false, errorCode: 'INVALID_PASSWORD' };
      }
    } else if (user.normalizedPhoneNumber) {
      if (confirmation.otpCode !== undefined) {
        const normalizedCode = normalizeDigits(confirmation.otpCode).trim();
        if (!/^\d{6}$/.test(normalizedCode)) {
          return { ok: false, errorCode: 'INVALID_OTP' };
        }
        const otpRecords = await this.authRepository.getOtpCodesByPhoneNumber(
          user.normalizedPhoneNumber,
        );
        const latestUnused = [...otpRecords]
          .filter((otp) => otp.usedAt === null)
          .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt) || b.id - a.id)[0];

        if (!latestUnused) {
          return { ok: false, errorCode: 'INVALID_OTP' };
        }
        if (latestUnused.attempts >= OTP_MAX_ATTEMPTS) {
          return { ok: false, errorCode: 'OTP_LOCKED' };
        }
        const nowMs = this.clock.now().getTime();
        const expiresAtMs = Date.parse(latestUnused.expiresAt);
        if (Number.isNaN(expiresAtMs) || nowMs > expiresAtMs) {
          return { ok: false, errorCode: 'OTP_EXPIRED' };
        }

        const expectedHash = await this.passwordHasher.hashToken(
          `${user.normalizedPhoneNumber}:${normalizedCode}`,
        );
        if (expectedHash !== latestUnused.codeHash) {
          const nextAttempts = latestUnused.attempts + 1;
          await this.authRepository.updateOtpCode({
            ...latestUnused,
            attempts: nextAttempts,
          });
          return {
            ok: false,
            errorCode: nextAttempts >= OTP_MAX_ATTEMPTS ? 'OTP_LOCKED' : 'INVALID_OTP',
          };
        }

        await this.authRepository.updateOtpCode({
          ...latestUnused,
          usedAt: this.clock.nowUtcIso(),
        });
      } else {
        const phrase = (confirmation.confirmPhrase ?? '').trim();
        if (phrase.length < 3) {
          return { ok: false, errorCode: 'CONFIRMATION_REQUIRED' };
        }
      }
    } else {
      const phrase = (confirmation.confirmPhrase ?? '').trim();
      if (phrase.length < 3) {
        return { ok: false, errorCode: 'CONFIRMATION_REQUIRED' };
      }
    }

    // Rule 6.7 Step 1: Delete all user likes and recalculate content likeCount
    const userLikes = await this.interactionRepository.getLikesByUserId(user.id);
    const affectedContentIds = Array.from(new Set(userLikes.map((l) => l.contentId)));
    let removedLikesCount = 0;
    for (const like of userLikes) {
      const removed = await this.interactionRepository.deleteLike(user.id, like.contentId);
      if (removed) {
        removedLikesCount += 1;
      }
    }
    for (const contentId of affectedContentIds) {
      const item = await this.contentRepository.getContentItemById(contentId);
      if (item) {
        const nextCount = Math.max(
          0,
          await this.interactionRepository.countLikesByContentId(contentId),
        );
        if (item.likeCount !== nextCount) {
          await this.contentRepository.updateContentItem({
            ...item,
            likeCount: nextCount,
          });
        }
      }
    }

    // Rule 6.7 Step 2: Delete all user bookmarks
    const userBookmarks = await this.interactionRepository.getBookmarksByUserId(user.id);
    let removedBookmarksCount = 0;
    for (const bookmark of userBookmarks) {
      const removed = await this.interactionRepository.deleteBookmark(
        user.id,
        bookmark.contentId,
      );
      if (removed) {
        removedBookmarksCount += 1;
      }
    }

    // Rule 6.7 Step 3: Clear sessions, authTokens, otpCodes, and active browser session
    await this.cleanupRepository.deleteSessionsByUserId(user.id);
    await this.cleanupRepository.deleteAuthTokensByUserId(user.id);
    if (user.normalizedPhoneNumber) {
      await this.cleanupRepository.deleteOtpCodesByPhoneNumber(user.normalizedPhoneNumber);
    }
    this.sessionTokenStore.clearRawToken();

    // Rule 6.7 Step 4: Anonymize ViewEvent and DownloadEvent records (userId = null)
    const [anonymizedViewsCount, anonymizedDownloadsCount] = await Promise.all([
      this.cleanupRepository.anonymizeViewEventsByUserId(user.id),
      this.cleanupRepository.anonymizeDownloadEventsByUserId(user.id),
    ]);

    // Rule 6.7 Step 5: Preserve comments with anonymous display name & purge topic affinities
    const storeCommentsAnonymized =
      await this.cleanupRepository.anonymizeOptionalCommentsByUserId(
        user.id,
        this.deletedDisplayName,
      );
    await this.cleanupRepository.deleteOptionalTopicAffinitiesByUserId(user.id);

    const externalCommentsAnonymized = options?.anonymizeExternalComments
      ? await options.anonymizeExternalComments(user.id, this.deletedDisplayName)
      : 0;
    const anonymizedCommentsCount = storeCommentsAnonymized + externalCommentsAnonymized;

    // Rule 6.7 Step 6: Anonymize AppUser record while keeping foreign-key integrity
    const nowIso = this.clock.nowUtcIso();
    await this.authRepository.updateUser({
      ...user,
      email: null,
      normalizedEmail: null,
      emailConfirmed: false,
      phoneNumber: null,
      normalizedPhoneNumber: null,
      phoneNumberConfirmed: false,
      passwordHash: null,
      passwordSalt: null,
      displayName: this.deletedDisplayName,
      ageGroupId: null,
      personalizationEnabled: false,
      mustChangePassword: false,
      isActive: false,
      isDeleted: true,
      deletedAt: nowIso,
      failedLoginCount: 0,
      lockoutEnd: null,
    });

    // Rule 6.7 Step 7: Audit log without any PII
    this.logger.info('ACCOUNT_DELETED', {
      userId: user.id,
      removedLikesCount,
      removedBookmarksCount,
      anonymizedViewsCount,
      anonymizedDownloadsCount,
      anonymizedCommentsCount,
    });

    return {
      ok: true,
      deletedDisplayName: this.deletedDisplayName,
      removedLikesCount,
      removedBookmarksCount,
      anonymizedViewsCount,
      anonymizedDownloadsCount,
      anonymizedCommentsCount,
    };
  }
}
