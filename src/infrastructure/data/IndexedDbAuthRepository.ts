import type { IAuthRepository } from '../../core/abstractions/authRepository';
import type { AppUser, AuthToken, UserSession } from '../../core/domain/auth';
import type { ContentItem } from '../../core/domain/content';
import type { OtpCode } from '../../core/domain/otp';
import type { AgeGroup } from '../../core/domain/taxonomy';
import type { IndexedDbDataStore } from './IndexedDbDataStore';
import { STORE_NAMES } from './migrations';

/**
 * IndexedDB rejects `null` values in unique indexes when multiple records lack that field
 * (or treats `null` as invalid key). Omitting undefined properties keeps both
 * `by_normalizedEmail` and `by_normalizedPhoneNumber` unique indexes sparse and error-free.
 */
export function toStoredUserRecord<T extends Omit<AppUser, 'id'>>(
  user: T,
): Record<string, unknown> {
  const record: Record<string, unknown> = { ...user };
  if (record.normalizedEmail === null || record.normalizedEmail === undefined) {
    delete record.normalizedEmail;
  }
  if (record.normalizedPhoneNumber === null || record.normalizedPhoneNumber === undefined) {
    delete record.normalizedPhoneNumber;
  }
  return record;
}

export function fromStoredUserRecord(raw: AppUser | null): AppUser | null {
  if (!raw) {
    return null;
  }
  return {
    ...raw,
    email: raw.email ?? null,
    normalizedEmail: raw.normalizedEmail ?? null,
    phoneNumber: raw.phoneNumber ?? null,
    normalizedPhoneNumber: raw.normalizedPhoneNumber ?? null,
    passwordHash: raw.passwordHash ?? null,
    passwordSalt: raw.passwordSalt ?? null,
  };
}

export class IndexedDbAuthRepository implements IAuthRepository {
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

  public async countUsers(): Promise<number> {
    return this.dataStore.count(STORE_NAMES.USERS);
  }

  public async hasAnySuperAdmin(): Promise<boolean> {
    const superAdmins = await this.dataStore.getAllByIndex<AppUser>(
      STORE_NAMES.USERS,
      'by_role',
      'SuperAdmin',
    );
    return superAdmins.length > 0;
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

  public async createOtpCode(otp: Omit<OtpCode, 'id'>): Promise<OtpCode> {
    const id = await this.dataStore.addRecordWithAutoId(STORE_NAMES.OTP_CODES, otp);
    return { ...otp, id };
  }

  public async getOtpCodesByPhoneNumber(phoneNumber: string): Promise<OtpCode[]> {
    return this.dataStore.getAllByIndex<OtpCode>(
      STORE_NAMES.OTP_CODES,
      'by_phoneNumber',
      phoneNumber,
    );
  }

  public async updateOtpCode(otp: OtpCode): Promise<void> {
    await this.dataStore.putRecord(STORE_NAMES.OTP_CODES, otp);
  }

  public async createAuthToken(token: Omit<AuthToken, 'id'>): Promise<AuthToken> {
    const id = await this.dataStore.addRecordWithAutoId(STORE_NAMES.AUTH_TOKENS, token);
    return { ...token, id };
  }

  public async getAuthTokenByHash(tokenHash: string): Promise<AuthToken | null> {
    return this.dataStore.getByIndex<AuthToken>(
      STORE_NAMES.AUTH_TOKENS,
      'by_tokenHash',
      tokenHash,
    );
  }

  public async updateAuthToken(token: AuthToken): Promise<void> {
    await this.dataStore.putRecord(STORE_NAMES.AUTH_TOKENS, token);
  }

  public async createSession(session: Omit<UserSession, 'id'>): Promise<UserSession> {
    const id = await this.dataStore.addRecordWithAutoId(STORE_NAMES.SESSIONS, session);
    return { ...session, id };
  }

  public async getSessionByTokenHash(tokenHash: string): Promise<UserSession | null> {
    return this.dataStore.getByIndex<UserSession>(
      STORE_NAMES.SESSIONS,
      'by_tokenHash',
      tokenHash,
    );
  }

  public async deleteSessionByTokenHash(tokenHash: string): Promise<void> {
    const existing = await this.getSessionByTokenHash(tokenHash);
    if (existing) {
      await this.dataStore.deleteByKey(STORE_NAMES.SESSIONS, existing.id);
    }
  }

  public async getActiveAgeGroups(): Promise<AgeGroup[]> {
    const all = await this.dataStore.getAll<AgeGroup>(STORE_NAMES.AGE_GROUPS);
    return all
      .filter((group) => group.isActive)
      .sort((a, b) => a.sortOrder - b.sortOrder);
  }

  public async ageGroupExists(ageGroupId: number): Promise<boolean> {
    const group = await this.dataStore.getByKey<AgeGroup>(STORE_NAMES.AGE_GROUPS, ageGroupId);
    return group !== null && group.isActive;
  }

  public async userExists(userId: number): Promise<boolean> {
    const user = await this.getUserById(userId);
    return user !== null;
  }

  public async createContentItem(item: Omit<ContentItem, 'id'>): Promise<ContentItem> {
    const creatorExists = await this.userExists(item.createdById);
    if (!creatorExists) {
      throw new Error(`FOREIGN_KEY_VIOLATION: createdById=${item.createdById} not found in users`);
    }
    const id = await this.dataStore.addRecordWithAutoId(STORE_NAMES.CONTENT_ITEMS, item);
    return { ...item, id };
  }
}
