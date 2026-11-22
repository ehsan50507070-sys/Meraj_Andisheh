import type { IAuthRepository } from '../abstractions/authRepository';
import type { IClock } from '../abstractions/IClock';
import type { ILogger } from '../abstractions/ILogger';
import type { IPasswordHasher } from '../abstractions/passwordHasher';
import type { AppUser } from '../domain/auth';
import {
  DISPLAY_NAME_MAX_LENGTH,
  isValidEmail,
  normalizeEmail,
  PASSWORD_MIN_LENGTH,
} from './authService';

export interface SetupInitialSuperAdminInput {
  email: string;
  displayName: string;
}

export interface SetupInitialSuperAdminResult {
  ok: boolean;
  user?: AppUser;
  tempPassword?: string;
  errorCode?:
    | 'SUPERADMIN_ALREADY_EXISTS'
    | 'INVALID_EMAIL'
    | 'INVALID_DISPLAY_NAME'
    | 'EMAIL_ALREADY_EXISTS';
  messageKey?: string;
}

function generateSecureTemporaryPassword(
  passwordHasher: IPasswordHasher,
  length = 12,
): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%';
  const raw = passwordHasher.generateSecureRandomToken(length * 2);
  let output = '';

  for (let i = 0; i < length; i += 1) {
    const code = raw.charCodeAt(i % raw.length) + i * 17;
    output += alphabet[code % alphabet.length];
  }

  return output;
}

export class InitialSuperAdminService {
  private readonly repository: IAuthRepository;
  private readonly passwordHasher: IPasswordHasher;
  private readonly clock: IClock;
  private readonly logger: ILogger;

  constructor(
    repository: IAuthRepository,
    passwordHasher: IPasswordHasher,
    clock: IClock,
    logger: ILogger,
  ) {
    this.repository = repository;
    this.passwordHasher = passwordHasher;
    this.clock = clock;
    this.logger = logger;
  }

  public async hasSuperAdmin(): Promise<boolean> {
    return this.repository.hasAnySuperAdmin();
  }

  public async hasStaffUser(): Promise<boolean> {
    const allUsers = await this.repository.getAllUsers();
    return allUsers.some((u) => u.role === 'Staff');
  }

  /**
   * Method 1: Creates the initial SuperAdmin automatically when secret environment variables
   * are provided at build/runtime and no SuperAdmin exists yet. Never logs the password.
   */
  public async bootstrapFromEnvIfConfigured(
    envEmail?: string,
    envTempPassword?: string,
    defaultDisplayName = 'SuperAdmin',
  ): Promise<boolean> {
    if (!envEmail || !envTempPassword) {
      return false;
    }

    const trimmedEmail = envEmail.trim();
    if (!isValidEmail(trimmedEmail) || envTempPassword.length < PASSWORD_MIN_LENGTH) {
      return false;
    }

    if (await this.repository.hasAnySuperAdmin()) {
      return false;
    }

    const normalized = normalizeEmail(trimmedEmail);
    const existing = await this.repository.getUserByNormalizedEmail(normalized);
    if (existing) {
      return false;
    }

    const { hash, salt } = await this.passwordHasher.hashPassword(envTempPassword);
    const nowIso = this.clock.nowUtcIso();

    await this.repository.createUser({
      email: trimmedEmail,
      normalizedEmail: normalized,
      emailConfirmed: true,
      phoneNumber: null,
      normalizedPhoneNumber: null,
      phoneNumberConfirmed: false,
      passwordHash: hash,
      passwordSalt: salt,
      displayName: defaultDisplayName.slice(0, DISPLAY_NAME_MAX_LENGTH),
      ageGroupId: null,
      personalizationEnabled: true,
      mustChangePassword: true,
      isActive: true,
      role: 'SuperAdmin',
      failedLoginCount: 0,
      lockoutEnd: null,
      createdAt: nowIso,
      lastLoginAt: null,
    });

    this.logger.info('INITIAL_SUPERADMIN_ENV_CREATED');
    return true;
  }

  /**
   * Method 2: One-time setup flow for preview/GitHub Pages when no SuperAdmin exists yet.
   * Generates a 12-char random temporary password, stores only its hash + salt,
   * sets mustChangePassword=true, and returns the temp password once.
   */
  public async setupInitialSuperAdmin(
    input: SetupInitialSuperAdminInput,
    oneTimeLogMessage = 'INITIAL_SUPERADMIN_SETUP_CREATED',
  ): Promise<SetupInitialSuperAdminResult> {
    if (await this.repository.hasAnySuperAdmin()) {
      return {
        ok: false,
        errorCode: 'SUPERADMIN_ALREADY_EXISTS',
        messageKey: 'setup.error.alreadyExists',
      };
    }

    const trimmedEmail = (input.email ?? '').trim();
    if (!isValidEmail(trimmedEmail)) {
      return {
        ok: false,
        errorCode: 'INVALID_EMAIL',
        messageKey: 'auth.error.invalidEmail',
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

    const normalized = normalizeEmail(trimmedEmail);
    const existing = await this.repository.getUserByNormalizedEmail(normalized);
    if (existing) {
      return {
        ok: false,
        errorCode: 'EMAIL_ALREADY_EXISTS',
        messageKey: 'auth.error.emailAlreadyExists',
      };
    }

    const tempPassword = generateSecureTemporaryPassword(this.passwordHasher, 12);
    const { hash, salt } = await this.passwordHasher.hashPassword(tempPassword);
    const nowIso = this.clock.nowUtcIso();

    const user = await this.repository.createUser({
      email: trimmedEmail,
      normalizedEmail: normalized,
      emailConfirmed: true,
      phoneNumber: null,
      normalizedPhoneNumber: null,
      phoneNumberConfirmed: false,
      passwordHash: hash,
      passwordSalt: salt,
      displayName: trimmedDisplayName,
      ageGroupId: null,
      personalizationEnabled: true,
      mustChangePassword: true,
      isActive: true,
      role: 'SuperAdmin',
      failedLoginCount: 0,
      lockoutEnd: null,
      createdAt: nowIso,
      lastLoginAt: null,
    });

    this.logger.warn(oneTimeLogMessage, {
      userId: user.id,
      email: user.email,
      tempPassword,
      mustChangePassword: true,
    });

    return {
      ok: true,
      user,
      tempPassword,
    };
  }

  /**
   * Dev-only helper to create a test Staff user with a freshly generated random password
   * (zero hardcoded credentials) so Staff -> #/admin redirect can be tested live in HealthPage.
   */
  public async createDevStaffForTesting(
    isDevelopment: boolean,
    defaultDisplayName = 'Dev Staff',
    logMessage = 'DEV_STAFF_CREATED',
  ): Promise<{ ok: boolean; user?: AppUser; tempPassword?: string }> {
    if (!isDevelopment) {
      return { ok: false };
    }

    if (await this.hasStaffUser()) {
      return { ok: false };
    }

    const shortId = this.passwordHasher
      .generateSecureRandomToken(4)
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '')
      .slice(0, 6) || 'dev';
    const staffEmail = `staff.${shortId}@example.local`;
    const tempPassword = generateSecureTemporaryPassword(this.passwordHasher, 12);
    const { hash, salt } = await this.passwordHasher.hashPassword(tempPassword);
    const nowIso = this.clock.nowUtcIso();

    const user = await this.repository.createUser({
      email: staffEmail,
      normalizedEmail: normalizeEmail(staffEmail),
      emailConfirmed: true,
      phoneNumber: null,
      normalizedPhoneNumber: null,
      phoneNumberConfirmed: false,
      passwordHash: hash,
      passwordSalt: salt,
      displayName: defaultDisplayName.slice(0, DISPLAY_NAME_MAX_LENGTH),
      ageGroupId: null,
      personalizationEnabled: true,
      mustChangePassword: false,
      isActive: true,
      role: 'Staff',
      failedLoginCount: 0,
      lockoutEnd: null,
      createdAt: nowIso,
      lastLoginAt: null,
    });

    this.logger.warn(logMessage, {
      userId: user.id,
      role: user.role,
      email: staffEmail,
      tempPassword,
    });

    return {
      ok: true,
      user,
      tempPassword,
    };
  }
}
