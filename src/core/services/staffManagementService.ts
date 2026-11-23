import type { IAdminRepository } from '../abstractions/adminRepository';
import type { IClock } from '../abstractions/IClock';
import type { ILogger } from '../abstractions/ILogger';
import type { IPasswordHasher } from '../abstractions/passwordHasher';
import type { AppUser } from '../domain/auth';
import type { PermissionKey } from '../domain/permissions';
import {
  DISPLAY_NAME_MAX_LENGTH,
  isValidEmail,
  normalizeEmail,
} from './authService';
import { normalizeIranMobile } from './identifierService';
import {
  filterValidPermissionKeys,
  PermissionPolicyService,
} from './permissionPolicyService';

export interface StaffAccountWithPermissions {
  user: AppUser;
  permissions: PermissionKey[];
}

export interface CreateStaffInput {
  displayName: string;
  email?: string;
  phoneNumber?: string;
  permissions: readonly string[];
}

export type StaffActionErrorCode =
  | 'NOT_FOUND'
  | 'FORBIDDEN'
  | 'INVALID_DISPLAY_NAME'
  | 'MISSING_CONTACT'
  | 'INVALID_EMAIL'
  | 'INVALID_PHONE'
  | 'EMAIL_ALREADY_EXISTS'
  | 'PHONE_ALREADY_EXISTS'
  | 'TARGET_NOT_FOUND'
  | 'INVALID_TARGET_ROLE'
  | 'CANNOT_DEACTIVATE_SELF'
  | 'LAST_SUPERADMIN'
  | 'CANNOT_MODIFY_DELETED_USER';

export interface StaffListResult {
  ok: boolean;
  statusCode: 200 | 403 | 404;
  items?: StaffAccountWithPermissions[];
  errorCode?: StaffActionErrorCode;
  messageKey?: string;
}

export interface CreateStaffResult {
  ok: boolean;
  statusCode: 200 | 400 | 403 | 404;
  item?: StaffAccountWithPermissions;
  tempPassword?: string;
  errorCode?: StaffActionErrorCode;
  messageKey?: string;
}

export interface StaffMutationResult {
  ok: boolean;
  statusCode: 200 | 400 | 403 | 404;
  item?: StaffAccountWithPermissions;
  errorCode?: StaffActionErrorCode;
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

export class StaffManagementService {
  private readonly repository: IAdminRepository;
  private readonly passwordHasher: IPasswordHasher;
  private readonly clock: IClock;
  private readonly logger: ILogger;
  private readonly policyService: PermissionPolicyService;

  constructor(
    repository: IAdminRepository,
    passwordHasher: IPasswordHasher,
    clock: IClock,
    logger: ILogger,
    policyService: PermissionPolicyService,
  ) {
    this.repository = repository;
    this.passwordHasher = passwordHasher;
    this.clock = clock;
    this.logger = logger;
    this.policyService = policyService;
  }

  public async listStaffAccounts(actor: AppUser | null): Promise<StaffListResult> {
    const auth = this.policyService.authorizeSuperAdminOnly(actor, '#/admin/staff');
    if (!auth.allowed) {
      return {
        ok: false,
        statusCode: auth.statusCode,
        errorCode: auth.statusCode === 404 ? 'NOT_FOUND' : 'FORBIDDEN',
        messageKey: auth.statusCode === 404 ? 'notFound.title' : 'admin.forbidden.title',
      };
    }

    const allUsers = await this.repository.getAllUsers();
    const staffAndAdmins = allUsers
      .filter((u) => (u.role === 'SuperAdmin' || u.role === 'Staff') && !u.isDeleted)
      .sort((a, b) => {
        if (a.role !== b.role) {
          return a.role === 'SuperAdmin' ? -1 : 1;
        }
        return a.id - b.id;
      });

    const items: StaffAccountWithPermissions[] = await Promise.all(
      staffAndAdmins.map(async (user) => ({
        user,
        permissions: await this.policyService.getUserPermissions(user),
      })),
    );

    return {
      ok: true,
      statusCode: 200,
      items,
    };
  }

  public async createStaffAccount(
    actor: AppUser | null,
    input: CreateStaffInput,
  ): Promise<CreateStaffResult> {
    const auth = this.policyService.authorizeSuperAdminOnly(actor, '#/admin/staff');
    if (!auth.allowed || !actor) {
      return {
        ok: false,
        statusCode: auth.statusCode,
        errorCode: auth.statusCode === 404 ? 'NOT_FOUND' : 'FORBIDDEN',
        messageKey: auth.statusCode === 404 ? 'notFound.title' : 'admin.forbidden.title',
      };
    }

    const trimmedDisplayName = (input.displayName ?? '').trim();
    if (
      trimmedDisplayName.length === 0 ||
      trimmedDisplayName.length > DISPLAY_NAME_MAX_LENGTH
    ) {
      return {
        ok: false,
        statusCode: 400,
        errorCode: 'INVALID_DISPLAY_NAME',
        messageKey: 'auth.error.invalidDisplayName',
      };
    }

    const rawEmail = (input.email ?? '').trim();
    const rawPhone = (input.phoneNumber ?? '').trim();
    if (!rawEmail && !rawPhone) {
      return {
        ok: false,
        statusCode: 400,
        errorCode: 'MISSING_CONTACT',
        messageKey: 'admin.staff.error.missingContact',
      };
    }

    let email: string | null = null;
    let normalizedEmail: string | null = null;
    if (rawEmail) {
      if (!isValidEmail(rawEmail)) {
        return {
          ok: false,
          statusCode: 400,
          errorCode: 'INVALID_EMAIL',
          messageKey: 'auth.error.invalidEmail',
        };
      }
      email = rawEmail;
      normalizedEmail = normalizeEmail(rawEmail);
      const existingEmail = await this.repository.getUserByNormalizedEmail(normalizedEmail);
      if (existingEmail) {
        return {
          ok: false,
          statusCode: 400,
          errorCode: 'EMAIL_ALREADY_EXISTS',
          messageKey: 'auth.error.emailAlreadyExists',
        };
      }
    }

    let phoneNumber: string | null = null;
    let normalizedPhoneNumber: string | null = null;
    if (rawPhone) {
      const normalized = normalizeIranMobile(rawPhone);
      if (!normalized) {
        return {
          ok: false,
          statusCode: 400,
          errorCode: 'INVALID_PHONE',
          messageKey: 'auth.error.invalidPhone',
        };
      }
      phoneNumber = normalized;
      normalizedPhoneNumber = normalized;
      const existingPhone = await this.repository.getUserByNormalizedPhoneNumber(
        normalizedPhoneNumber,
      );
      if (existingPhone) {
        return {
          ok: false,
          statusCode: 400,
          errorCode: 'PHONE_ALREADY_EXISTS',
          messageKey: 'auth.otp.error.phoneAlreadyExists',
        };
      }
    }

    let tempPassword: string | undefined;
    let passwordHash: string | null = null;
    let passwordSalt: string | null = null;
    let mustChangePassword = false;

    if (normalizedEmail) {
      tempPassword = generateSecureTemporaryPassword(this.passwordHasher, 12);
      const hashed = await this.passwordHasher.hashPassword(tempPassword);
      passwordHash = hashed.hash;
      passwordSalt = hashed.salt;
      mustChangePassword = true;
    }

    const nowIso = this.clock.nowUtcIso();
    const createdUser = await this.repository.createUser({
      email,
      normalizedEmail,
      emailConfirmed: normalizedEmail !== null,
      phoneNumber,
      normalizedPhoneNumber,
      phoneNumberConfirmed: normalizedPhoneNumber !== null,
      passwordHash,
      passwordSalt,
      displayName: trimmedDisplayName,
      ageGroupId: null,
      personalizationEnabled: true,
      mustChangePassword,
      isActive: true,
      role: 'Staff',
      failedLoginCount: 0,
      lockoutEnd: null,
      createdAt: nowIso,
      lastLoginAt: null,
    });

    const validKeys = filterValidPermissionKeys(input.permissions);
    await this.repository.replaceStaffPermissions(
      createdUser.id,
      validKeys.map((permissionKey) => ({
        userId: createdUser.id,
        permissionKey,
        grantedAt: nowIso,
        grantedById: actor.id,
      })),
    );

    this.logger.info('ADMIN_STAFF_CREATED', {
      actorId: actor.id,
      targetUserId: createdUser.id,
      permissions: validKeys,
    });

    return {
      ok: true,
      statusCode: 200,
      item: {
        user: createdUser,
        permissions: validKeys,
      },
      tempPassword,
    };
  }

  public async updateStaffPermissions(
    actor: AppUser | null,
    staffUserId: number,
    permissions: readonly string[],
  ): Promise<StaffMutationResult> {
    const auth = this.policyService.authorizeSuperAdminOnly(actor, '#/admin/staff');
    if (!auth.allowed || !actor) {
      return {
        ok: false,
        statusCode: auth.statusCode,
        errorCode: auth.statusCode === 404 ? 'NOT_FOUND' : 'FORBIDDEN',
        messageKey: auth.statusCode === 404 ? 'notFound.title' : 'admin.forbidden.title',
      };
    }

    const target = await this.repository.getUserById(staffUserId);
    if (!target) {
      return {
        ok: false,
        statusCode: 400,
        errorCode: 'TARGET_NOT_FOUND',
        messageKey: 'admin.staff.error.targetNotFound',
      };
    }

    if (target.isDeleted === true) {
      return {
        ok: false,
        statusCode: 400,
        errorCode: 'CANNOT_MODIFY_DELETED_USER',
        messageKey: 'admin.staff.error.cannotModifyDeletedUser',
      };
    }

    if (target.role !== 'Staff') {
      return {
        ok: false,
        statusCode: 400,
        errorCode: 'INVALID_TARGET_ROLE',
        messageKey: 'admin.staff.error.onlyStaffPermissionsEditable',
      };
    }

    const validKeys = filterValidPermissionKeys(permissions);
    const nowIso = this.clock.nowUtcIso();

    await this.repository.replaceStaffPermissions(
      target.id,
      validKeys.map((permissionKey) => ({
        userId: target.id,
        permissionKey,
        grantedAt: nowIso,
        grantedById: actor.id,
      })),
    );

    this.logger.info('ADMIN_STAFF_PERMISSIONS_UPDATED', {
      actorId: actor.id,
      targetUserId: target.id,
      permissions: validKeys,
    });

    return {
      ok: true,
      statusCode: 200,
      item: {
        user: target,
        permissions: validKeys,
      },
    };
  }

  public async toggleStaffActive(
    actor: AppUser | null,
    targetUserId: number,
    isActive: boolean,
  ): Promise<StaffMutationResult> {
    const auth = this.policyService.authorizeSuperAdminOnly(actor, '#/admin/staff');
    if (!auth.allowed || !actor) {
      return {
        ok: false,
        statusCode: auth.statusCode,
        errorCode: auth.statusCode === 404 ? 'NOT_FOUND' : 'FORBIDDEN',
        messageKey: auth.statusCode === 404 ? 'notFound.title' : 'admin.forbidden.title',
      };
    }

    const target = await this.repository.getUserById(targetUserId);
    if (!target) {
      return {
        ok: false,
        statusCode: 400,
        errorCode: 'TARGET_NOT_FOUND',
        messageKey: 'admin.staff.error.targetNotFound',
      };
    }

    if (target.isDeleted === true) {
      return {
        ok: false,
        statusCode: 400,
        errorCode: 'CANNOT_MODIFY_DELETED_USER',
        messageKey: 'admin.staff.error.cannotModifyDeletedUser',
      };
    }

    if (target.role !== 'Staff' && target.role !== 'SuperAdmin') {
      return {
        ok: false,
        statusCode: 400,
        errorCode: 'INVALID_TARGET_ROLE',
        messageKey: 'admin.staff.error.invalidRoleTarget',
      };
    }

    if (!isActive && actor.id === target.id) {
      return {
        ok: false,
        statusCode: 400,
        errorCode: 'CANNOT_DEACTIVATE_SELF',
        messageKey: 'admin.staff.error.cannotDeactivateSelf',
      };
    }

    if (!isActive && target.role === 'SuperAdmin') {
      const allUsers = await this.repository.getAllUsers();
      const otherActiveSuperAdmins = allUsers.filter(
        (u) => u.role === 'SuperAdmin' && u.isActive && !u.isDeleted && u.id !== target.id,
      );
      if (otherActiveSuperAdmins.length === 0) {
        return {
          ok: false,
          statusCode: 400,
          errorCode: 'LAST_SUPERADMIN',
          messageKey: 'admin.staff.error.lastSuperAdmin',
        };
      }
    }

    const updatedUser: AppUser = {
      ...target,
      isActive,
    };
    await this.repository.updateUser(updatedUser);

    if (!isActive) {
      await this.repository.deleteSessionsByUserId(updatedUser.id);
    }

    this.logger.info('ADMIN_STAFF_STATUS_CHANGED', {
      actorId: actor.id,
      targetUserId: updatedUser.id,
      isActive,
    });

    return {
      ok: true,
      statusCode: 200,
      item: {
        user: updatedUser,
        permissions: await this.policyService.getUserPermissions(updatedUser),
      },
    };
  }
}
