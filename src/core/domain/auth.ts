export type UserRole = 'SuperAdmin' | 'Staff' | 'Member';

export type AuthTokenType = 'EmailConfirmation' | 'PasswordReset' | 'MobileRegistration';

export interface AppUser {
  id: number;
  email: string | null;
  normalizedEmail: string | null;
  emailConfirmed: boolean;
  phoneNumber: string | null;
  normalizedPhoneNumber: string | null;
  phoneNumberConfirmed: boolean;
  passwordHash: string | null;
  passwordSalt: string | null;
  /** Nickname / display alias (max 60 chars, not real legal name) */
  displayName: string;
  ageGroupId: number | null;
  /** Default true */
  personalizationEnabled: boolean;
  mustChangePassword: boolean;
  /** Default true */
  isActive: boolean;
  /** True after account deletion & PII erasure per Rule 6.7 */
  isDeleted?: boolean;
  role: UserRole;
  failedLoginCount: number;
  /** ISO 8601 UTC timestamp */
  lockoutEnd: string | null;
  /** ISO 8601 UTC timestamp */
  createdAt: string;
  /** ISO 8601 UTC timestamp */
  lastLoginAt: string | null;
  /** ISO 8601 UTC timestamp */
  deletedAt?: string | null;
}

export interface AuthToken {
  id: number;
  userId: number;
  type: AuthTokenType;
  /** Only hashed token is stored; raw token is never persisted */
  tokenHash: string;
  /** Optional bound metadata (e.g., verified phone number for MobileRegistration) */
  metadata?: string | null;
  /** ISO 8601 UTC timestamp */
  expiresAt: string;
  /** ISO 8601 UTC timestamp */
  usedAt: string | null;
  /** ISO 8601 UTC timestamp */
  createdAt: string;
}

export interface UserSession {
  id: number;
  userId: number;
  /** Only hashed session token is stored */
  tokenHash: string;
  /** ISO 8601 UTC timestamp (30 days for Member, 8 hours for Staff/SuperAdmin) */
  expiresAt: string;
  /** ISO 8601 UTC timestamp */
  createdAt: string;
}
