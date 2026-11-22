export interface OtpCode {
  id: number;
  /** Normalized Iranian mobile in 09XXXXXXXXX format */
  phoneNumber: string;
  /** Only hashed OTP is stored; raw 6-digit code is never persisted */
  codeHash: string;
  /** ISO 8601 UTC timestamp (createdAt + 2 minutes) */
  expiresAt: string;
  /** Failed verification attempts (locks at 5) */
  attempts: number;
  /** ISO 8601 UTC timestamp when consumed, or null if unused */
  usedAt: string | null;
  /** ISO 8601 UTC timestamp */
  createdAt: string;
}
