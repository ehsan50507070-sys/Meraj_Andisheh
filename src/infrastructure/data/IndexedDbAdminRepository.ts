import type { IAdminRepository } from '../../core/abstractions/adminRepository';
import type { AppUser, UserSession } from '../../core/domain/auth';
import type { StaffPermission } from '../../core/domain/permissions';
import type { FeatureFlag, SiteSetting } from '../../core/domain/settings';
import type { AgeGroup } from '../../core/domain/taxonomy';
import {
  fromStoredUserRecord,
  toStoredUserRecord,
} from './IndexedDbAuthRepository';
import type { IndexedDbDataStore } from './IndexedDbDataStore';
import { STORE_NAMES } from './migrations';

export class IndexedDbAdminRepository implements IAdminRepository {
  private readonly dataStore: IndexedDbDataStore;

  constructor(dataStore: IndexedDbDataStore) {
    this.dataStore = dataStore;
  }

  public async getUserById(id: number): Promise<AppUser | null> {
    const raw = await this.dataStore.getByKey<AppUser>(STORE_NAMES.USERS, id);
    return fromStoredUserRecord(raw);
  }

  public async getUserByNormalizedEmail(normalizedEmail: string): Promise<AppUser | null> {
    if (!normalizedEmail) {
      return null;
    }
    const raw = await this.dataStore.getByIndex<AppUser>(
      STORE_NAMES.USERS,
      'by_normalizedEmail',
      normalizedEmail,
    );
    return fromStoredUserRecord(raw);
  }

  public async getUserByNormalizedPhoneNumber(
    normalizedPhoneNumber: string,
  ): Promise<AppUser | null> {
    if (!normalizedPhoneNumber) {
      return null;
    }
    const raw = await this.dataStore.getByIndex<AppUser>(
      STORE_NAMES.USERS,
      'by_normalizedPhoneNumber',
      normalizedPhoneNumber,
    );
    return fromStoredUserRecord(raw);
  }

  public async getAllUsers(): Promise<AppUser[]> {
    const all = await this.dataStore.getAll<AppUser>(STORE_NAMES.USERS);
    return all.map((u) => fromStoredUserRecord(u)!);
  }

  public async createUser(user: Omit<AppUser, 'id'>): Promise<AppUser> {
    const stored = toStoredUserRecord(user);
    const id = await this.dataStore.addRecordWithAutoId(STORE_NAMES.USERS, stored);
    return { ...user, id };
  }

  public async updateUser(user: AppUser): Promise<void> {
    const stored = toStoredUserRecord(user);
    await this.dataStore.putRecord(STORE_NAMES.USERS, stored);
  }

  public async deleteSessionsByUserId(userId: number): Promise<void> {
    const sessions = await this.dataStore.getAllByIndex<UserSession>(
      STORE_NAMES.SESSIONS,
      'by_userId',
      userId,
    );
    for (const session of sessions) {
      await this.dataStore.deleteByKey(STORE_NAMES.SESSIONS, session.id);
    }
  }

  public async getStaffPermissionsByUserId(userId: number): Promise<StaffPermission[]> {
    return this.dataStore.getAllByIndex<StaffPermission>(
      STORE_NAMES.STAFF_PERMISSIONS,
      'by_userId',
      userId,
    );
  }

  public async replaceStaffPermissions(
    userId: number,
    permissions: Omit<StaffPermission, 'id'>[],
  ): Promise<StaffPermission[]> {
    const existing = await this.getStaffPermissionsByUserId(userId);
    for (const item of existing) {
      if (item.id !== undefined) {
        await this.dataStore.deleteByKey(STORE_NAMES.STAFF_PERMISSIONS, item.id);
      }
    }

    const created: StaffPermission[] = [];
    for (const perm of permissions) {
      const id = await this.dataStore.addRecordWithAutoId(STORE_NAMES.STAFF_PERMISSIONS, perm);
      created.push({ ...perm, id });
    }
    return created;
  }

  public async getAllFeatureFlags(): Promise<FeatureFlag[]> {
    return this.dataStore.getAll<FeatureFlag>(STORE_NAMES.FEATURE_FLAGS);
  }

  public async upsertFeatureFlag(flag: FeatureFlag): Promise<void> {
    await this.dataStore.putRecord(STORE_NAMES.FEATURE_FLAGS, flag);
  }

  public async getAllSiteSettings(): Promise<SiteSetting[]> {
    return this.dataStore.getAll<SiteSetting>(STORE_NAMES.SITE_SETTINGS);
  }

  public async getSiteSettingByKey(key: string): Promise<SiteSetting | null> {
    return this.dataStore.getByKey<SiteSetting>(STORE_NAMES.SITE_SETTINGS, key);
  }

  public async upsertSiteSettings(settings: SiteSetting[]): Promise<void> {
    for (const setting of settings) {
      await this.dataStore.putRecord(STORE_NAMES.SITE_SETTINGS, setting);
    }
  }

  public async getActiveAgeGroups(): Promise<AgeGroup[]> {
    const all = await this.dataStore.getAll<AgeGroup>(STORE_NAMES.AGE_GROUPS);
    return all
      .filter((group) => group.isActive)
      .sort((a, b) => a.sortOrder - b.sortOrder);
  }
}
