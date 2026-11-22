import type { AppUser, AuthToken, UserSession } from '../domain/auth';
import type { ContentItem } from '../domain/content';
import type { OtpCode } from '../domain/otp';
import type { AgeGroup } from '../domain/taxonomy';

export interface IAuthRepository {
  getUserById(id: number): Promise<AppUser | null>;
  getUserByNormalizedEmail(normalizedEmail: string): Promise<AppUser | null>;
  getUserByNormalizedPhoneNumber(normalizedPhoneNumber: string): Promise<AppUser | null>;
  getAllUsers(): Promise<AppUser[]>;
  countUsers(): Promise<number>;
  hasAnySuperAdmin(): Promise<boolean>;
  createUser(user: Omit<AppUser, 'id'>): Promise<AppUser>;
  updateUser(user: AppUser): Promise<void>;

  createOtpCode(otp: Omit<OtpCode, 'id'>): Promise<OtpCode>;
  getOtpCodesByPhoneNumber(phoneNumber: string): Promise<OtpCode[]>;
  updateOtpCode(otp: OtpCode): Promise<void>;

  createAuthToken(token: Omit<AuthToken, 'id'>): Promise<AuthToken>;
  getAuthTokenByHash(tokenHash: string): Promise<AuthToken | null>;
  updateAuthToken(token: AuthToken): Promise<void>;

  createSession(session: Omit<UserSession, 'id'>): Promise<UserSession>;
  getSessionByTokenHash(tokenHash: string): Promise<UserSession | null>;
  deleteSessionByTokenHash(tokenHash: string): Promise<void>;

  getActiveAgeGroups(): Promise<AgeGroup[]>;
  ageGroupExists(ageGroupId: number): Promise<boolean>;
  userExists(userId: number): Promise<boolean>;
  createContentItem(item: Omit<ContentItem, 'id'>): Promise<ContentItem>;
}

export interface ISessionTokenStore {
  getRawToken(): string | null;
  setRawToken(token: string): void;
  clearRawToken(): void;
}
