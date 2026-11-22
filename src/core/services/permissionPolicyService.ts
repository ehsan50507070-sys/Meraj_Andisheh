import type { IAdminRepository } from '../abstractions/adminRepository';
import type { ILogger } from '../abstractions/ILogger';
import type { AppUser } from '../domain/auth';
import { ALL_PERMISSION_KEYS, type PermissionKey } from '../domain/permissions';

export interface PolicyAuthorizationResult {
  allowed: boolean;
  statusCode: 200 | 403 | 404;
}

export function isValidPermissionKey(key: string): key is PermissionKey {
  return (ALL_PERMISSION_KEYS as readonly string[]).includes(key);
}

export function filterValidPermissionKeys(keys: readonly string[]): PermissionKey[] {
  const seen = new Set<PermissionKey>();
  const result: PermissionKey[] = [];
  for (const key of keys) {
    if (isValidPermissionKey(key) && !seen.has(key)) {
      seen.add(key);
      result.push(key);
    }
  }
  return result;
}

export class PermissionPolicyService {
  private readonly repository: IAdminRepository;
  private readonly logger: ILogger;

  constructor(repository: IAdminRepository, logger: ILogger) {
    this.repository = repository;
    this.logger = logger;
  }

  public async getUserPermissions(user: AppUser | null): Promise<PermissionKey[]> {
    if (!user || !user.isActive) {
      return [];
    }

    if (user.role === 'SuperAdmin') {
      return [...ALL_PERMISSION_KEYS];
    }

    if (user.role !== 'Staff') {
      return [];
    }

    const records = await this.repository.getStaffPermissionsByUserId(user.id);
    return filterValidPermissionKeys(records.map((record) => record.permissionKey));
  }

  public authorizeAdminShell(user: AppUser | null): PolicyAuthorizationResult {
    if (!user || !user.isActive || user.role === 'Member') {
      return { allowed: false, statusCode: 404 };
    }
    return { allowed: true, statusCode: 200 };
  }

  public authorizeSuperAdminOnly(
    user: AppUser | null,
    routePath: string,
    options?: { logDenied?: boolean },
  ): PolicyAuthorizationResult {
    if (!user || !user.isActive || user.role === 'Member') {
      return { allowed: false, statusCode: 404 };
    }

    if (user.role === 'SuperAdmin') {
      return { allowed: true, statusCode: 200 };
    }

    if (options?.logDenied !== false) {
      this.logger.warn('ADMIN_ACCESS_DENIED', {
        userId: user.id,
        displayName: user.displayName,
        routePath,
        requiredPermission: 'SuperAdminOnly',
      });
    }

    return { allowed: false, statusCode: 403 };
  }

  public async authorizePermission(
    user: AppUser | null,
    requiredKey: PermissionKey,
    routePath: string,
    options?: { logDenied?: boolean },
  ): Promise<PolicyAuthorizationResult> {
    if (!user || !user.isActive || user.role === 'Member') {
      return { allowed: false, statusCode: 404 };
    }

    if (user.role === 'SuperAdmin') {
      return { allowed: true, statusCode: 200 };
    }

    const granted = await this.getUserPermissions(user);
    if (granted.includes(requiredKey)) {
      return { allowed: true, statusCode: 200 };
    }

    if (options?.logDenied !== false) {
      this.logger.warn('ADMIN_ACCESS_DENIED', {
        userId: user.id,
        displayName: user.displayName,
        routePath,
        requiredPermission: requiredKey,
      });
    }

    return { allowed: false, statusCode: 403 };
  }

  public async authorizeAnyPermission(
    user: AppUser | null,
    requiredKeys: readonly PermissionKey[],
    routePath: string,
    options?: { logDenied?: boolean },
  ): Promise<PolicyAuthorizationResult> {
    if (!user || !user.isActive || user.role === 'Member') {
      return { allowed: false, statusCode: 404 };
    }

    if (user.role === 'SuperAdmin') {
      return { allowed: true, statusCode: 200 };
    }

    const granted = await this.getUserPermissions(user);
    if (requiredKeys.some((key) => granted.includes(key))) {
      return { allowed: true, statusCode: 200 };
    }

    if (options?.logDenied !== false) {
      this.logger.warn('ADMIN_ACCESS_DENIED', {
        userId: user.id,
        displayName: user.displayName,
        routePath,
        requiredPermission: requiredKeys.join(' | '),
      });
    }

    return { allowed: false, statusCode: 403 };
  }
}
