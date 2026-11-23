import type { IAdminRepository } from '../abstractions/adminRepository';
import type { ILogger } from '../abstractions/ILogger';
import type { AppUser } from '../domain/auth';
import type { AgeGroup } from '../domain/taxonomy';
import { normalizeDigits } from './identifierService';
import { PermissionPolicyService } from './permissionPolicyService';

export interface MemberFilter {
  search?: string;
  status?: 'all' | 'active' | 'inactive';
  ageGroupId?: number | null;
}

export type MemberActionErrorCode =
  | 'NOT_FOUND'
  | 'FORBIDDEN'
  | 'MEMBER_NOT_FOUND'
  | 'INVALID_TARGET_ROLE'
  | 'CANNOT_MODIFY_DELETED_USER';

export interface ListMembersResult {
  ok: boolean;
  statusCode: 200 | 403 | 404;
  items?: AppUser[];
  ageGroups?: AgeGroup[];
  errorCode?: MemberActionErrorCode;
  messageKey?: string;
}

export interface ToggleMemberResult {
  ok: boolean;
  statusCode: 200 | 400 | 403 | 404;
  user?: AppUser;
  errorCode?: MemberActionErrorCode;
  messageKey?: string;
}

export class UserManagementService {
  private readonly repository: IAdminRepository;
  private readonly logger: ILogger;
  private readonly policyService: PermissionPolicyService;

  constructor(
    repository: IAdminRepository,
    logger: ILogger,
    policyService: PermissionPolicyService,
  ) {
    this.repository = repository;
    this.logger = logger;
    this.policyService = policyService;
  }

  public async listMembers(
    actor: AppUser | null,
    filter?: MemberFilter,
  ): Promise<ListMembersResult> {
    const auth = await this.policyService.authorizePermission(
      actor,
      'users.manage',
      '#/admin/users',
    );
    if (!auth.allowed) {
      return {
        ok: false,
        statusCode: auth.statusCode,
        errorCode: auth.statusCode === 404 ? 'NOT_FOUND' : 'FORBIDDEN',
        messageKey: auth.statusCode === 404 ? 'notFound.title' : 'admin.forbidden.title',
      };
    }

    const [allUsers, ageGroups] = await Promise.all([
      this.repository.getAllUsers(),
      this.repository.getActiveAgeGroups(),
    ]);

    const normalizedSearch = normalizeDigits(filter?.search ?? '')
      .trim()
      .toLowerCase();
    const statusFilter = filter?.status ?? 'all';
    const ageGroupFilter = filter?.ageGroupId ?? null;

    const members = allUsers
      .filter((user) => user.role === 'Member' && !user.isDeleted)
      .filter((user) => {
        if (statusFilter === 'active' && !user.isActive) return false;
        if (statusFilter === 'inactive' && user.isActive) return false;
        if (ageGroupFilter !== null && user.ageGroupId !== ageGroupFilter) return false;

        if (normalizedSearch) {
          const displayMatch = normalizeDigits(user.displayName)
            .toLowerCase()
            .includes(normalizedSearch);
          const emailMatch = (user.email ?? '').toLowerCase().includes(normalizedSearch);
          const phoneMatch = normalizeDigits(user.phoneNumber ?? '')
            .toLowerCase()
            .includes(normalizedSearch);
          return displayMatch || emailMatch || phoneMatch;
        }

        return true;
      })
      .sort((a, b) => b.id - a.id);

    return {
      ok: true,
      statusCode: 200,
      items: members,
      ageGroups,
    };
  }

  public async toggleMemberActive(
    actor: AppUser | null,
    memberId: number,
    isActive: boolean,
  ): Promise<ToggleMemberResult> {
    const auth = await this.policyService.authorizePermission(
      actor,
      'users.manage',
      '#/admin/users',
    );
    if (!auth.allowed || !actor) {
      return {
        ok: false,
        statusCode: auth.statusCode,
        errorCode: auth.statusCode === 404 ? 'NOT_FOUND' : 'FORBIDDEN',
        messageKey: auth.statusCode === 404 ? 'notFound.title' : 'admin.forbidden.title',
      };
    }

    const target = await this.repository.getUserById(memberId);
    if (!target) {
      return {
        ok: false,
        statusCode: 400,
        errorCode: 'MEMBER_NOT_FOUND',
        messageKey: 'admin.users.error.memberNotFound',
      };
    }

    if (target.isDeleted === true) {
      return {
        ok: false,
        statusCode: 400,
        errorCode: 'CANNOT_MODIFY_DELETED_USER',
        messageKey: 'admin.users.error.cannotModifyDeletedUser',
      };
    }

    if (target.role !== 'Member') {
      return {
        ok: false,
        statusCode: 403,
        errorCode: 'INVALID_TARGET_ROLE',
        messageKey: 'admin.users.error.onlyMembersEditable',
      };
    }

    const updated: AppUser = {
      ...target,
      isActive,
    };
    await this.repository.updateUser(updated);

    if (!isActive) {
      await this.repository.deleteSessionsByUserId(updated.id);
    }

    this.logger.info('ADMIN_MEMBER_STATUS_CHANGED', {
      actorId: actor.id,
      targetUserId: updated.id,
      isActive,
    });

    return {
      ok: true,
      statusCode: 200,
      user: updated,
    };
  }
}
