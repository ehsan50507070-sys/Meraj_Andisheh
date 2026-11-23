import type { IAuthRepository, ISessionTokenStore } from '../abstractions/authRepository';
import type { IClock } from '../abstractions/IClock';
import type { ILogger } from '../abstractions/ILogger';
import type { IPasswordHasher } from '../abstractions/passwordHasher';
import type { ISmsSender } from '../abstractions/smsSender';
import type { IPersonalizationService } from '../abstractions/personalizationService';
import type { AppUser } from '../domain/auth';
import {
  DISPLAY_NAME_MAX_LENGTH,
  getSessionDurationMs,
} from './authService';
import { normalizeDigits, normalizeIranMobile } from './identifierService';
import { resolvePostLoginRedirect } from './navigationGuardService';
import { RateLimiter } from './rateLimiter';

export const OTP_LENGTH = 6;
export const OTP_EXPIRY_MS = 2 * 60 * 1000;
export const OTP_COOLDOWN_MS = 60 * 1000;
export const OTP_HOURLY_WINDOW_MS = 60 * 60 * 1000;
export const OTP_HOURLY_MAX_REQUESTS = 5;
export const OTP_MAX_ATTEMPTS = 5;
export const MOBILE_REG_TOKEN_EXPIRY_MS = 5 * 60 * 1000;

export type OtpErrorCode =
  | 'INVALID_PHONE'
  | 'OTP_COOLDOWN'
  | 'OTP_HOURLY_LIMIT'
  | 'RATE_LIMITED'
  | 'OTP_INVALID'
  | 'OTP_LOCKED'
  | 'OTP_EXPIRED'
  | 'OTP_NOT_FOUND'
  | 'ACCOUNT_INACTIVE'
  | 'INVALID_REGISTRATION_TOKEN'
  | 'INVALID_DISPLAY_NAME'
  | 'INVALID_AGE_GROUP'
  | 'PHONE_ALREADY_EXISTS';

export interface OtpResult<T = undefined> {
  ok: boolean;
  data?: T;
  errorCode?: OtpErrorCode;
  messageKey?: string;
  remainingSeconds?: number;
  remainingAttempts?: number;
}

export type VerifyOtpOutcome =
  | {
      status: 'logged_in';
      user: AppUser;
      redirectTo: string;
    }
  | {
      status: 'needs_registration';
      verifiedPhone: string;
      registrationToken: string;
    };

function generateSecureSixDigitCode(passwordHasher: IPasswordHasher): string {
  const cryptoObj = typeof globalThis !== 'undefined' ? globalThis.crypto : undefined;
  if (cryptoObj && typeof cryptoObj.getRandomValues === 'function') {
    const range = 900_000; // 100000..999999
    const maxUnbiased = Math.floor(0xffffffff / range) * range;
    const buffer = new Uint32Array(1);
    let value = 0;
    do {
      cryptoObj.getRandomValues(buffer);
      value = buffer[0];
    } while (value >= maxUnbiased);
    return String(100_000 + (value % range));
  }

  const fallbackRaw = passwordHasher.generateSecureRandomToken(8);
  let numeric = 0;
  for (let i = 0; i < fallbackRaw.length; i += 1) {
    numeric = (numeric * 31 + fallbackRaw.charCodeAt(i)) % 900_000;
  }
  return String(100_000 + numeric);
}

export class OtpService {
  private readonly repository: IAuthRepository;
  private readonly passwordHasher: IPasswordHasher;
  private readonly smsSender: ISmsSender;
  private readonly clock: IClock;
  private readonly logger: ILogger;
  private readonly sessionTokenStore: ISessionTokenStore;
  private readonly rateLimiter: RateLimiter;
  private readonly smsMessageTemplate: string;
  private readonly personalizationService?: IPersonalizationService;

  constructor(
    repository: IAuthRepository,
    passwordHasher: IPasswordHasher,
    smsSender: ISmsSender,
    clock: IClock,
    logger: ILogger,
    sessionTokenStore: ISessionTokenStore,
    rateLimiter: RateLimiter = new RateLimiter(clock, 15, 60 * 1000),
    smsMessageTemplate = 'OTP: {code}',
    personalizationService?: IPersonalizationService,
  ) {
    this.repository = repository;
    this.passwordHasher = passwordHasher;
    this.smsSender = smsSender;
    this.clock = clock;
    this.logger = logger;
    this.sessionTokenStore = sessionTokenStore;
    this.rateLimiter = rateLimiter;
    this.smsMessageTemplate = smsMessageTemplate;
    this.personalizationService = personalizationService;
  }

  public async requestOtp(
    rawPhone: string,
  ): Promise<OtpResult<{ phoneNumber: string; cooldownSeconds: number; expiresInSeconds: number }>> {
    const normalizedPhone = normalizeIranMobile(rawPhone);
    if (!normalizedPhone) {
      return {
        ok: false,
        errorCode: 'INVALID_PHONE',
        messageKey: 'auth.error.invalidPhone',
      };
    }

    const now = this.clock.now();
    const nowMs = now.getTime();
    const nowIso = now.toISOString();

    const existingOtps = await this.repository.getOtpCodesByPhoneNumber(normalizedPhone);
    const sortedDesc = [...existingOtps].sort(
      (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt) || b.id - a.id,
    );

    if (sortedDesc.length > 0) {
      const latestCreatedMs = Date.parse(sortedDesc[0].createdAt);
      const elapsedMs = nowMs - latestCreatedMs;
      if (elapsedMs < OTP_COOLDOWN_MS) {
        const remainingSeconds = Math.max(1, Math.ceil((OTP_COOLDOWN_MS - elapsedMs) / 1000));
        return {
          ok: false,
          errorCode: 'OTP_COOLDOWN',
          messageKey: 'auth.otp.error.cooldown',
          remainingSeconds,
        };
      }
    }

    const recentInHourCount = sortedDesc.filter((item) => {
      const createdMs = Date.parse(item.createdAt);
      return !Number.isNaN(createdMs) && nowMs - createdMs < OTP_HOURLY_WINDOW_MS;
    }).length;

    if (recentInHourCount >= OTP_HOURLY_MAX_REQUESTS) {
      return {
        ok: false,
        errorCode: 'OTP_HOURLY_LIMIT',
        messageKey: 'auth.otp.error.hourlyLimit',
      };
    }

    const rateCheck = this.rateLimiter.consume(`otp_req:${normalizedPhone}`, 10, 60 * 1000);
    if (!rateCheck.allowed) {
      return {
        ok: false,
        errorCode: 'RATE_LIMITED',
        messageKey: 'auth.error.rateLimited',
        remainingSeconds: rateCheck.retryAfterSeconds,
      };
    }

    const rawCode = generateSecureSixDigitCode(this.passwordHasher);
    const codeHash = await this.passwordHasher.hashToken(`${normalizedPhone}:${rawCode}`);
    const expiresAt = new Date(nowMs + OTP_EXPIRY_MS).toISOString();

    await this.repository.createOtpCode({
      phoneNumber: normalizedPhone,
      codeHash,
      expiresAt,
      attempts: 0,
      usedAt: null,
      createdAt: nowIso,
    });

    const smsText = this.smsMessageTemplate.replace('{code}', rawCode);
    await this.smsSender.sendOtpAsync(normalizedPhone, rawCode, smsText);

    this.logger.info('OTP_SENT', {
      phoneNumber: normalizedPhone,
      expiresAt,
    });

    return {
      ok: true,
      data: {
        phoneNumber: normalizedPhone,
        cooldownSeconds: 60,
        expiresInSeconds: 120,
      },
    };
  }

  public async verifyOtp(
    rawPhone: string,
    rawCode: string,
    returnUrl?: string | null,
  ): Promise<OtpResult<VerifyOtpOutcome>> {
    const normalizedPhone = normalizeIranMobile(rawPhone);
    if (!normalizedPhone) {
      return {
        ok: false,
        errorCode: 'INVALID_PHONE',
        messageKey: 'auth.error.invalidPhone',
      };
    }

    const verifyRate = this.rateLimiter.consume(`otp_verify:${normalizedPhone}`, 20, 60 * 1000);
    if (!verifyRate.allowed) {
      return {
        ok: false,
        errorCode: 'RATE_LIMITED',
        messageKey: 'auth.error.rateLimited',
        remainingSeconds: verifyRate.retryAfterSeconds,
      };
    }

    const normalizedCode = normalizeDigits(rawCode ?? '').trim();
    if (!/^\d{6}$/.test(normalizedCode)) {
      return {
        ok: false,
        errorCode: 'OTP_INVALID',
        messageKey: 'auth.otp.error.invalidFormat',
      };
    }

    const existingOtps = await this.repository.getOtpCodesByPhoneNumber(normalizedPhone);
    const latestUnused = [...existingOtps]
      .filter((otp) => otp.usedAt === null)
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt) || b.id - a.id)[0];

    if (!latestUnused) {
      return {
        ok: false,
        errorCode: 'OTP_NOT_FOUND',
        messageKey: 'auth.otp.error.notFound',
      };
    }

    if (latestUnused.attempts >= OTP_MAX_ATTEMPTS) {
      return {
        ok: false,
        errorCode: 'OTP_LOCKED',
        messageKey: 'auth.otp.error.locked',
        remainingAttempts: 0,
      };
    }

    const now = this.clock.now();
    const nowMs = now.getTime();
    const nowIso = now.toISOString();
    const expiresAtMs = Date.parse(latestUnused.expiresAt);

    if (Number.isNaN(expiresAtMs) || nowMs > expiresAtMs) {
      return {
        ok: false,
        errorCode: 'OTP_EXPIRED',
        messageKey: 'auth.otp.error.expired',
      };
    }

    const candidateHash = await this.passwordHasher.hashToken(
      `${normalizedPhone}:${normalizedCode}`,
    );

    if (candidateHash !== latestUnused.codeHash) {
      const nextAttempts = latestUnused.attempts + 1;
      await this.repository.updateOtpCode({
        ...latestUnused,
        attempts: nextAttempts,
      });

      if (nextAttempts >= OTP_MAX_ATTEMPTS) {
        this.logger.warn('OTP_LOCKED', {
          phoneNumber: normalizedPhone,
          attempts: nextAttempts,
        });
        return {
          ok: false,
          errorCode: 'OTP_LOCKED',
          messageKey: 'auth.otp.error.locked',
          remainingAttempts: 0,
        };
      }

      return {
        ok: false,
        errorCode: 'OTP_INVALID',
        messageKey: 'auth.otp.error.invalid',
        remainingAttempts: OTP_MAX_ATTEMPTS - nextAttempts,
      };
    }

    await this.repository.updateOtpCode({
      ...latestUnused,
      usedAt: nowIso,
    });

    const existingUser = await this.repository.getUserByNormalizedPhoneNumber(normalizedPhone);
    if (existingUser) {
      if (!existingUser.isActive || existingUser.isDeleted) {
        return {
          ok: false,
          errorCode: 'ACCOUNT_INACTIVE',
          messageKey: 'auth.error.accountInactive',
        };
      }

      const updatedUser: AppUser = {
        ...existingUser,
        phoneNumberConfirmed: true,
        failedLoginCount: 0,
        lockoutEnd: null,
        lastLoginAt: nowIso,
      };
      await this.repository.updateUser(updatedUser);

      await this.createUserSession(updatedUser, nowMs, nowIso);

      if (this.personalizationService) {
        await this.personalizationService.mergeGuestAffinityOnLoginAsync(updatedUser);
      }

      this.logger.info('USER_LOGGED_IN_OTP', {
        userId: updatedUser.id,
        role: updatedUser.role,
      });

      return {
        ok: true,
        data: {
          status: 'logged_in',
          user: updatedUser,
          redirectTo: resolvePostLoginRedirect(updatedUser, returnUrl),
        },
      };
    }

    const rawRegToken = this.passwordHasher.generateSecureRandomToken(32);
    const regTokenHash = await this.passwordHasher.hashToken(rawRegToken);
    const regExpiresAt = new Date(nowMs + MOBILE_REG_TOKEN_EXPIRY_MS).toISOString();

    await this.repository.createAuthToken({
      userId: 0,
      type: 'MobileRegistration',
      tokenHash: regTokenHash,
      metadata: normalizedPhone,
      expiresAt: regExpiresAt,
      usedAt: null,
      createdAt: nowIso,
    });

    return {
      ok: true,
      data: {
        status: 'needs_registration',
        verifiedPhone: normalizedPhone,
        registrationToken: rawRegToken,
      },
    };
  }

  public async completeMobileRegistration(input: {
    verifiedPhone: string;
    registrationToken: string;
    displayName: string;
    ageGroupId: number;
    returnUrl?: string | null;
  }): Promise<OtpResult<{ user: AppUser; redirectTo: string }>> {
    const normalizedPhone = normalizeIranMobile(input.verifiedPhone);
    if (!normalizedPhone) {
      return {
        ok: false,
        errorCode: 'INVALID_PHONE',
        messageKey: 'auth.error.invalidPhone',
      };
    }

    if (!input.registrationToken || input.registrationToken.trim().length === 0) {
      return {
        ok: false,
        errorCode: 'INVALID_REGISTRATION_TOKEN',
        messageKey: 'auth.error.invalidOrExpiredToken',
      };
    }

    const tokenHash = await this.passwordHasher.hashToken(input.registrationToken.trim());
    const tokenRecord = await this.repository.getAuthTokenByHash(tokenHash);
    const now = this.clock.now();
    const nowMs = now.getTime();
    const nowIso = now.toISOString();

    if (
      !tokenRecord ||
      tokenRecord.type !== 'MobileRegistration' ||
      tokenRecord.usedAt !== null ||
      tokenRecord.metadata !== normalizedPhone ||
      Number.isNaN(Date.parse(tokenRecord.expiresAt)) ||
      nowMs > Date.parse(tokenRecord.expiresAt)
    ) {
      return {
        ok: false,
        errorCode: 'INVALID_REGISTRATION_TOKEN',
        messageKey: 'auth.error.invalidOrExpiredToken',
      };
    }

    const trimmedDisplayName = (input.displayName ?? '').trim();
    if (
      trimmedDisplayName.length === 0 ||
      trimmedDisplayName.length > DISPLAY_NAME_MAX_LENGTH
    ) {
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

    const existing = await this.repository.getUserByNormalizedPhoneNumber(normalizedPhone);
    if (existing) {
      return {
        ok: false,
        errorCode: 'PHONE_ALREADY_EXISTS',
        messageKey: 'auth.otp.error.phoneAlreadyExists',
      };
    }

    await this.repository.updateAuthToken({
      ...tokenRecord,
      usedAt: nowIso,
    });

    const createdUser = await this.repository.createUser({
      email: null,
      normalizedEmail: null,
      emailConfirmed: false,
      phoneNumber: normalizedPhone,
      normalizedPhoneNumber: normalizedPhone,
      phoneNumberConfirmed: true,
      passwordHash: null,
      passwordSalt: null,
      displayName: trimmedDisplayName,
      ageGroupId: input.ageGroupId,
      personalizationEnabled: true,
      mustChangePassword: false,
      isActive: true,
      role: 'Member',
      failedLoginCount: 0,
      lockoutEnd: null,
      createdAt: nowIso,
      lastLoginAt: nowIso,
    });

    await this.createUserSession(createdUser, nowMs, nowIso);

    if (this.personalizationService) {
      await this.personalizationService.mergeGuestAffinityOnLoginAsync(createdUser);
    }

    this.logger.info('USER_REGISTERED_OTP', {
      userId: createdUser.id,
      role: createdUser.role,
    });

    return {
      ok: true,
      data: {
        user: createdUser,
        redirectTo: resolvePostLoginRedirect(createdUser, input.returnUrl),
      },
    };
  }

  private async createUserSession(
    user: AppUser,
    nowMs: number,
    nowIso: string,
  ): Promise<void> {
    const rawSessionToken = this.passwordHasher.generateSecureRandomToken(32);
    const sessionTokenHash = await this.passwordHasher.hashToken(rawSessionToken);
    const sessionExpiresAt = new Date(
      nowMs + getSessionDurationMs(user.role),
    ).toISOString();

    await this.repository.createSession({
      userId: user.id,
      tokenHash: sessionTokenHash,
      expiresAt: sessionExpiresAt,
      createdAt: nowIso,
    });

    this.sessionTokenStore.setRawToken(rawSessionToken);
  }
}
