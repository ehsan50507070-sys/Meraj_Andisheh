import type { IAuthRepository, ISessionTokenStore } from '../abstractions/authRepository';
import type { IClock } from '../abstractions/IClock';
import type { IEmailSender } from '../abstractions/emailSender';
import type { ILogger } from '../abstractions/ILogger';
import type { IPasswordHasher } from '../abstractions/passwordHasher';
import type { IPersonalizationService } from '../abstractions/personalizationService';
import type { AppUser, AuthToken, UserRole, UserSession } from '../domain/auth';
import {
  isValidEmailIdentifier,
  normalizeEmailIdentifier,
} from './identifierService';
import { RateLimiter } from './rateLimiter';

export const PASSWORD_MIN_LENGTH = 8;
export const DISPLAY_NAME_MAX_LENGTH = 60;
export const MAX_FAILED_LOGIN_ATTEMPTS = 5;
export const LOCKOUT_DURATION_MS = 15 * 60 * 1000;
export const EMAIL_CONFIRM_EXPIRY_MS = 24 * 60 * 60 * 1000;
export const PASSWORD_RESET_EXPIRY_MS = 60 * 60 * 1000;
export const MEMBER_SESSION_EXPIRY_MS = 30 * 24 * 60 * 60 * 1000;
export const PRIVILEGED_SESSION_EXPIRY_MS = 8 * 60 * 60 * 1000;

export interface AuthEmailTemplates {
  confirmSubject: string;
  confirmBody: string;
  resetSubject: string;
  resetBody: string;
}

export interface RegisterWithEmailInput {
  email: string;
  password: string;
  displayName: string;
  ageGroupId: number;
}

export interface ConfirmEmailInput {
  userId: number;
  rawToken: string;
}

export interface LoginWithEmailInput {
  email: string;
  password: string;
}

export interface ChangePasswordInput {
  userId: number;
  currentPassword: string;
  newPassword: string;
}

export interface ResetPasswordInput {
  userId: number;
  rawToken: string;
  newPassword: string;
}

export type AuthErrorCode =
  | 'INVALID_EMAIL'
  | 'EMAIL_ALREADY_EXISTS'
  | 'PASSWORD_TOO_SHORT'
  | 'PASSWORD_UNCHANGED'
  | 'INVALID_DISPLAY_NAME'
  | 'INVALID_AGE_GROUP'
  | 'INVALID_CREDENTIALS'
  | 'ACCOUNT_INACTIVE'
  | 'ACCOUNT_LOCKED'
  | 'EMAIL_NOT_CONFIRMED'
  | 'USER_NOT_FOUND'
  | 'INVALID_OR_EXPIRED_TOKEN'
  | 'RATE_LIMITED';

export interface AuthResult<T = undefined> {
  ok: boolean;
  data?: T;
  errorCode?: AuthErrorCode;
  messageKey?: string;
  remainingLockMinutes?: number;
  remainingSeconds?: number;
}

export function normalizeEmail(email: string): string {
  return normalizeEmailIdentifier(email);
}

export function isValidEmail(email: string): boolean {
  return isValidEmailIdentifier(email);
}

export function getSessionDurationMs(role: UserRole): number {
  return role === 'Member' ? MEMBER_SESSION_EXPIRY_MS : PRIVILEGED_SESSION_EXPIRY_MS;
}

export class AuthService {
  private readonly repository: IAuthRepository;
  private readonly passwordHasher: IPasswordHasher;
  private readonly emailSender: IEmailSender;
  private readonly clock: IClock;
  private readonly logger: ILogger;
  private readonly sessionTokenStore: ISessionTokenStore;
  private readonly templates: AuthEmailTemplates;
  private readonly rateLimiter: RateLimiter;
  private readonly personalizationService?: IPersonalizationService;

  constructor(
    repository: IAuthRepository,
    passwordHasher: IPasswordHasher,
    emailSender: IEmailSender,
    clock: IClock,
    logger: ILogger,
    sessionTokenStore: ISessionTokenStore,
    templates: AuthEmailTemplates = {
      confirmSubject: 'Confirm your email',
      confirmBody: 'Please confirm your email using the link below.',
      resetSubject: 'Reset your password',
      resetBody: 'Please reset your password using the link below.',
    },
    rateLimiter: RateLimiter = new RateLimiter(clock, 20, 60 * 1000),
    personalizationService?: IPersonalizationService,
  ) {
    this.repository = repository;
    this.passwordHasher = passwordHasher;
    this.emailSender = emailSender;
    this.clock = clock;
    this.logger = logger;
    this.sessionTokenStore = sessionTokenStore;
    this.templates = templates;
    this.rateLimiter = rateLimiter;
    this.personalizationService = personalizationService;
  }

  public async registerWithEmail(
    input: RegisterWithEmailInput,
  ): Promise<AuthResult<{ user: AppUser }>> {
    const trimmedEmail = (input.email ?? '').trim();
    if (!isValidEmail(trimmedEmail)) {
      return {
        ok: false,
        errorCode: 'INVALID_EMAIL',
        messageKey: 'auth.error.invalidEmail',
      };
    }

    const normalized = normalizeEmail(trimmedEmail);
    const existing = await this.repository.getUserByNormalizedEmail(normalized);
    if (existing) {
      return {
        ok: false,
        errorCode: 'EMAIL_ALREADY_EXISTS',
        messageKey: 'auth.error.emailAlreadyExists',
      };
    }

    const password = input.password ?? '';
    if (password.length < PASSWORD_MIN_LENGTH) {
      return {
        ok: false,
        errorCode: 'PASSWORD_TOO_SHORT',
        messageKey: 'auth.error.passwordTooShort',
      };
    }

    const trimmedDisplayName = (input.displayName ?? '').trim();
    if (trimmedDisplayName.length === 0 || trimmedDisplayName.length > DISPLAY_NAME_MAX_LENGTH) {
      return {
        ok: false,
        errorCode: 'INVALID_DISPLAY_NAME',
        messageKey: 'auth.error.invalidDisplayName',
      };
    }

    const ageGroupValid =
      typeof input.ageGroupId === 'number' &&
      Number.isInteger(input.ageGroupId) &&
      input.ageGroupId > 0 &&
      (await this.repository.ageGroupExists(input.ageGroupId));

    if (!ageGroupValid) {
      return {
        ok: false,
        errorCode: 'INVALID_AGE_GROUP',
        messageKey: 'auth.error.invalidAgeGroup',
      };
    }

    const now = this.clock.now();
    const nowIso = now.toISOString();
    const { hash, salt } = await this.passwordHasher.hashPassword(password);

    const createdUser = await this.repository.createUser({
      email: trimmedEmail,
      normalizedEmail: normalized,
      emailConfirmed: false,
      phoneNumber: null,
      normalizedPhoneNumber: null,
      phoneNumberConfirmed: false,
      passwordHash: hash,
      passwordSalt: salt,
      displayName: trimmedDisplayName,
      ageGroupId: input.ageGroupId,
      personalizationEnabled: true,
      mustChangePassword: false,
      isActive: true,
      role: 'Member',
      failedLoginCount: 0,
      lockoutEnd: null,
      createdAt: nowIso,
      lastLoginAt: null,
    });

    await this.issueAndSendConfirmationToken(createdUser, now);

    this.logger.info('USER_REGISTERED', {
      userId: createdUser.id,
      role: createdUser.role,
    });

    return {
      ok: true,
      data: { user: createdUser },
    };
  }

  private async issueAndSendConfirmationToken(user: AppUser, now: Date): Promise<void> {
    if (!user.email) {
      return;
    }

    const rawToken = this.passwordHasher.generateSecureRandomToken(32);
    const tokenHash = await this.passwordHasher.hashToken(rawToken);
    const expiresAt = new Date(now.getTime() + EMAIL_CONFIRM_EXPIRY_MS).toISOString();

    await this.repository.createAuthToken({
      userId: user.id,
      type: 'EmailConfirmation',
      tokenHash,
      expiresAt,
      usedAt: null,
      createdAt: now.toISOString(),
    });

    const actionUrl = `#/account/confirm-email?uid=${user.id}&token=${encodeURIComponent(rawToken)}`;
    await this.emailSender.sendAsync(
      user.email,
      this.templates.confirmSubject,
      this.templates.confirmBody,
      actionUrl,
    );
  }

  public async resendConfirmationEmail(email: string): Promise<AuthResult> {
    const trimmedEmail = (email ?? '').trim();
    if (!isValidEmail(trimmedEmail)) {
      return {
        ok: false,
        errorCode: 'INVALID_EMAIL',
        messageKey: 'auth.error.invalidEmail',
      };
    }

    const user = await this.repository.getUserByNormalizedEmail(normalizeEmail(trimmedEmail));
    if (user && user.isActive && !user.emailConfirmed) {
      await this.issueAndSendConfirmationToken(user, this.clock.now());
    }

    return {
      ok: true,
      messageKey: 'auth.confirm.resentSuccess',
    };
  }

  public async confirmEmail(input: ConfirmEmailInput): Promise<AuthResult> {
    if (
      typeof input.userId !== 'number' ||
      !Number.isInteger(input.userId) ||
      input.userId <= 0 ||
      !input.rawToken ||
      input.rawToken.trim().length === 0
    ) {
      return {
        ok: false,
        errorCode: 'INVALID_OR_EXPIRED_TOKEN',
        messageKey: 'auth.error.invalidOrExpiredToken',
      };
    }

    const tokenHash = await this.passwordHasher.hashToken(input.rawToken.trim());
    const tokenRecord = await this.repository.getAuthTokenByHash(tokenHash);

    if (!this.isTokenUsable(tokenRecord, input.userId, 'EmailConfirmation')) {
      return {
        ok: false,
        errorCode: 'INVALID_OR_EXPIRED_TOKEN',
        messageKey: 'auth.error.invalidOrExpiredToken',
      };
    }

    const user = await this.repository.getUserById(input.userId);
    if (!user) {
      return {
        ok: false,
        errorCode: 'USER_NOT_FOUND',
        messageKey: 'auth.error.invalidOrExpiredToken',
      };
    }

    const nowIso = this.clock.nowUtcIso();
    await this.repository.updateAuthToken({
      ...tokenRecord,
      usedAt: nowIso,
    });

    await this.repository.updateUser({
      ...user,
      emailConfirmed: true,
    });

    this.logger.info('EMAIL_CONFIRMED', { userId: user.id });

    return { ok: true };
  }

  private isTokenUsable(
    token: AuthToken | null,
    expectedUserId: number,
    expectedType: AuthToken['type'],
  ): token is AuthToken {
    if (!token) {
      return false;
    }
    if (token.userId !== expectedUserId || token.type !== expectedType) {
      return false;
    }
    if (token.usedAt !== null) {
      return false;
    }
    const nowMs = this.clock.now().getTime();
    const expiresAtMs = Date.parse(token.expiresAt);
    return !Number.isNaN(expiresAtMs) && nowMs <= expiresAtMs;
  }

  public async loginWithEmail(
    input: LoginWithEmailInput,
  ): Promise<AuthResult<{ user: AppUser }>> {
    const trimmedEmail = (input.email ?? '').trim();
    if (!isValidEmail(trimmedEmail)) {
      return {
        ok: false,
        errorCode: 'INVALID_CREDENTIALS',
        messageKey: 'auth.error.invalidCredentials',
      };
    }

    const normalizedEmail = normalizeEmail(trimmedEmail);
    const loginRate = this.rateLimiter.consume(`login_email:${normalizedEmail}`, 20, 60 * 1000);
    if (!loginRate.allowed) {
      return {
        ok: false,
        errorCode: 'RATE_LIMITED',
        messageKey: 'auth.error.rateLimited',
        remainingSeconds: loginRate.retryAfterSeconds,
      };
    }

    const user = await this.repository.getUserByNormalizedEmail(normalizedEmail);
    if (!user || !user.passwordHash || !user.passwordSalt) {
      return {
        ok: false,
        errorCode: 'INVALID_CREDENTIALS',
        messageKey: 'auth.error.invalidCredentials',
      };
    }

    if (!user.isActive) {
      return {
        ok: false,
        errorCode: 'ACCOUNT_INACTIVE',
        messageKey: 'auth.error.accountInactive',
      };
    }

    const now = this.clock.now();
    const nowMs = now.getTime();
    const nowIso = now.toISOString();

    if (user.lockoutEnd !== null) {
      const lockoutEndMs = Date.parse(user.lockoutEnd);
      if (!Number.isNaN(lockoutEndMs) && nowMs < lockoutEndMs) {
        const remainingLockMinutes = Math.max(1, Math.ceil((lockoutEndMs - nowMs) / 60000));
        return {
          ok: false,
          errorCode: 'ACCOUNT_LOCKED',
          messageKey: 'auth.error.accountLocked',
          remainingLockMinutes,
        };
      }
    }

    const passwordValid = await this.passwordHasher.verifyPassword(
      input.password ?? '',
      user.passwordHash,
      user.passwordSalt,
    );

    if (!passwordValid) {
      const lockPreviouslyExpired =
        user.lockoutEnd !== null && nowMs >= Date.parse(user.lockoutEnd);
      const nextFailedCount = lockPreviouslyExpired ? 1 : user.failedLoginCount + 1;

      if (nextFailedCount >= MAX_FAILED_LOGIN_ATTEMPTS) {
        const newLockoutEnd = new Date(nowMs + LOCKOUT_DURATION_MS).toISOString();
        await this.repository.updateUser({
          ...user,
          failedLoginCount: nextFailedCount,
          lockoutEnd: newLockoutEnd,
        });

        this.logger.warn('AUTH_ACCOUNT_LOCKED', {
          userId: user.id,
          failedLoginCount: nextFailedCount,
          lockoutEnd: newLockoutEnd,
        });

        return {
          ok: false,
          errorCode: 'ACCOUNT_LOCKED',
          messageKey: 'auth.error.accountLocked',
          remainingLockMinutes: 15,
        };
      }

      await this.repository.updateUser({
        ...user,
        failedLoginCount: nextFailedCount,
        lockoutEnd: null,
      });

      return {
        ok: false,
        errorCode: 'INVALID_CREDENTIALS',
        messageKey: 'auth.error.invalidCredentials',
      };
    }

    if (!user.emailConfirmed) {
      return {
        ok: false,
        errorCode: 'EMAIL_NOT_CONFIRMED',
        messageKey: 'auth.error.emailNotConfirmed',
      };
    }

    const updatedUser: AppUser = {
      ...user,
      failedLoginCount: 0,
      lockoutEnd: null,
      lastLoginAt: nowIso,
    };
    await this.repository.updateUser(updatedUser);

    const rawSessionToken = this.passwordHasher.generateSecureRandomToken(32);
    const sessionTokenHash = await this.passwordHasher.hashToken(rawSessionToken);
    const sessionExpiresAt = new Date(nowMs + getSessionDurationMs(updatedUser.role)).toISOString();

    await this.repository.createSession({
      userId: updatedUser.id,
      tokenHash: sessionTokenHash,
      expiresAt: sessionExpiresAt,
      createdAt: nowIso,
    });

    this.sessionTokenStore.setRawToken(rawSessionToken);

    if (this.personalizationService) {
      await this.personalizationService.mergeGuestAffinityOnLoginAsync(updatedUser);
    }

    this.logger.info('USER_LOGGED_IN', {
      userId: updatedUser.id,
      role: updatedUser.role,
    });

    return {
      ok: true,
      data: { user: updatedUser },
    };
  }

  public async changePassword(
    input: ChangePasswordInput,
  ): Promise<AuthResult<{ user: AppUser }>> {
    const user = await this.repository.getUserById(input.userId);
    if (!user || !user.passwordHash || !user.passwordSalt) {
      return {
        ok: false,
        errorCode: 'USER_NOT_FOUND',
        messageKey: 'auth.error.userNotFound',
      };
    }

    const currentPassword = input.currentPassword ?? '';
    const newPassword = input.newPassword ?? '';

    const currentValid = await this.passwordHasher.verifyPassword(
      currentPassword,
      user.passwordHash,
      user.passwordSalt,
    );
    if (!currentValid) {
      return {
        ok: false,
        errorCode: 'INVALID_CREDENTIALS',
        messageKey: 'auth.error.currentPasswordInvalid',
      };
    }

    if (newPassword.length < PASSWORD_MIN_LENGTH) {
      return {
        ok: false,
        errorCode: 'PASSWORD_TOO_SHORT',
        messageKey: 'auth.error.passwordTooShort',
      };
    }

    if (newPassword === currentPassword) {
      return {
        ok: false,
        errorCode: 'PASSWORD_UNCHANGED',
        messageKey: 'auth.error.passwordUnchanged',
      };
    }

    const { hash, salt } = await this.passwordHasher.hashPassword(newPassword);
    const updatedUser: AppUser = {
      ...user,
      passwordHash: hash,
      passwordSalt: salt,
      mustChangePassword: false,
    };
    await this.repository.updateUser(updatedUser);

    this.logger.info('USER_PASSWORD_CHANGED', { userId: user.id });

    return {
      ok: true,
      data: { user: updatedUser },
    };
  }

  public async requestPasswordReset(email: string): Promise<AuthResult> {
    const trimmedEmail = (email ?? '').trim();
    if (!isValidEmail(trimmedEmail)) {
      return {
        ok: false,
        errorCode: 'INVALID_EMAIL',
        messageKey: 'auth.error.invalidEmail',
      };
    }

    const user = await this.repository.getUserByNormalizedEmail(normalizeEmail(trimmedEmail));
    if (user && user.isActive && user.email) {
      const now = this.clock.now();
      const rawToken = this.passwordHasher.generateSecureRandomToken(32);
      const tokenHash = await this.passwordHasher.hashToken(rawToken);
      const expiresAt = new Date(now.getTime() + PASSWORD_RESET_EXPIRY_MS).toISOString();

      await this.repository.createAuthToken({
        userId: user.id,
        type: 'PasswordReset',
        tokenHash,
        expiresAt,
        usedAt: null,
        createdAt: now.toISOString(),
      });

      const actionUrl = `#/account/reset-password?uid=${user.id}&token=${encodeURIComponent(rawToken)}`;
      await this.emailSender.sendAsync(
        user.email,
        this.templates.resetSubject,
        this.templates.resetBody,
        actionUrl,
      );
    }

    return {
      ok: true,
      messageKey: 'auth.forgot.neutralSuccess',
    };
  }

  public async resetPassword(input: ResetPasswordInput): Promise<AuthResult> {
    if (
      typeof input.userId !== 'number' ||
      !Number.isInteger(input.userId) ||
      input.userId <= 0 ||
      !input.rawToken ||
      input.rawToken.trim().length === 0
    ) {
      return {
        ok: false,
        errorCode: 'INVALID_OR_EXPIRED_TOKEN',
        messageKey: 'auth.error.invalidOrExpiredToken',
      };
    }

    const newPassword = input.newPassword ?? '';
    if (newPassword.length < PASSWORD_MIN_LENGTH) {
      return {
        ok: false,
        errorCode: 'PASSWORD_TOO_SHORT',
        messageKey: 'auth.error.passwordTooShort',
      };
    }

    const tokenHash = await this.passwordHasher.hashToken(input.rawToken.trim());
    const tokenRecord = await this.repository.getAuthTokenByHash(tokenHash);
    if (!this.isTokenUsable(tokenRecord, input.userId, 'PasswordReset')) {
      return {
        ok: false,
        errorCode: 'INVALID_OR_EXPIRED_TOKEN',
        messageKey: 'auth.error.invalidOrExpiredToken',
      };
    }

    const user = await this.repository.getUserById(input.userId);
    if (!user) {
      return {
        ok: false,
        errorCode: 'USER_NOT_FOUND',
        messageKey: 'auth.error.invalidOrExpiredToken',
      };
    }

    const { hash, salt } = await this.passwordHasher.hashPassword(newPassword);
    const nowIso = this.clock.nowUtcIso();

    await this.repository.updateAuthToken({
      ...tokenRecord,
      usedAt: nowIso,
    });

    await this.repository.updateUser({
      ...user,
      passwordHash: hash,
      passwordSalt: salt,
      failedLoginCount: 0,
      lockoutEnd: null,
      mustChangePassword: false,
    });

    this.logger.info('USER_PASSWORD_RESET', { userId: user.id });

    return { ok: true };
  }

  public async logout(): Promise<void> {
    const rawToken = this.sessionTokenStore.getRawToken();
    if (rawToken) {
      const tokenHash = await this.passwordHasher.hashToken(rawToken);
      await this.repository.deleteSessionByTokenHash(tokenHash);
    }
    this.sessionTokenStore.clearRawToken();
    this.logger.info('USER_LOGGED_OUT');
  }

  public async getCurrentUser(): Promise<AppUser | null> {
    const rawToken = this.sessionTokenStore.getRawToken();
    if (!rawToken) {
      return null;
    }

    const tokenHash = await this.passwordHasher.hashToken(rawToken);
    const session: UserSession | null = await this.repository.getSessionByTokenHash(tokenHash);
    if (!session) {
      this.sessionTokenStore.clearRawToken();
      return null;
    }

    const nowMs = this.clock.now().getTime();
    const expiresAtMs = Date.parse(session.expiresAt);
    if (Number.isNaN(expiresAtMs) || nowMs > expiresAtMs) {
      await this.repository.deleteSessionByTokenHash(tokenHash);
      this.sessionTokenStore.clearRawToken();
      return null;
    }

    const user = await this.repository.getUserById(session.userId);
    if (!user || !user.isActive || user.isDeleted) {
      await this.repository.deleteSessionByTokenHash(tokenHash);
      this.sessionTokenStore.clearRawToken();
      return null;
    }

    return user;
  }

  public async updateUserAgeGroup(userId: number, ageGroupId: number): Promise<AppUser | null> {
    const user = await this.repository.getUserById(userId);
    if (!user || !user.isActive) {
      return null;
    }

    const validAgeGroup = await this.repository.ageGroupExists(ageGroupId);
    if (!validAgeGroup) {
      return null;
    }

    const updated: AppUser = {
      ...user,
      ageGroupId,
    };
    await this.repository.updateUser(updated);
    this.logger.info('USER_AGE_GROUP_UPDATED', {
      userId: updated.id,
      ageGroupId,
    });
    return updated;
  }
}
