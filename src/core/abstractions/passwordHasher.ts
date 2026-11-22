export interface PasswordHashResult {
  hash: string;
  salt: string;
}

export interface IPasswordHasher {
  hashPassword(password: string): Promise<PasswordHashResult>;
  verifyPassword(password: string, hash: string, salt: string): Promise<boolean>;
  hashToken(rawToken: string): Promise<string>;
  generateSecureRandomToken(length?: number): string;
}
