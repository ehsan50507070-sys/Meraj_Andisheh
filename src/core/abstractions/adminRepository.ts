import type { AppUser } from '../domain/auth';
import type { StaffPermission } from '../domain/permissions';
import type { FeatureFlag, SiteSetting } from '../domain/settings';
import type { AgeGroup } from '../domain/taxonomy';

export interface IAdminRepository {
  getUserById(id: number): Promise<AppUser | null>;
  getUserByNormalizedEmail(normalizedEmail: string): Promise<AppUser | null>;
  getUserByNormalizedPhoneNumber(normalizedPhoneNumber: string): Promise<AppUser | null>;
  getAllUsers(): Promise<AppUser[]>;
  createUser(user: Omit<AppUser, 'id'>): Promise<AppUser>;
  updateUser(user: AppUser): Promise<void>;
  deleteSessionsByUserId(userId: number): Promise<void>;

  getStaffPermissionsByUserId(userId: number): Promise<StaffPermission[]>;
  replaceStaffPermissions(
    userId: number,
    permissions: Omit<StaffPermission, 'id'>[],
  ): Promise<StaffPermission[]>;

  getAllFeatureFlags(): Promise<FeatureFlag[]>;
  upsertFeatureFlag(flag: FeatureFlag): Promise<void>;

  getAllSiteSettings(): Promise<SiteSetting[]>;
  getSiteSettingByKey(key: string): Promise<SiteSetting | null>;
  upsertSiteSettings(settings: SiteSetting[]): Promise<void>;

  getActiveAgeGroups(): Promise<AgeGroup[]>;
}
