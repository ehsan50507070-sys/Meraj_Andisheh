import type { IAuthRepository, ISessionTokenStore } from '../core/abstractions/authRepository';
import type { IClock } from '../core/abstractions/IClock';
import type { IEmailSender } from '../core/abstractions/emailSender';
import type { IPasswordHasher } from '../core/abstractions/passwordHasher';
import type { AppUser, AuthToken, UserSession } from '../core/domain/auth';
import type { ContentItem } from '../core/domain/content';
import type { OtpCode } from '../core/domain/otp';
import type { AgeGroup } from '../core/domain/taxonomy';
import { AuthService } from '../core/services/authService';
import { ContentIntegrityService } from '../core/services/contentIntegrityService';
import { InitialSuperAdminService } from '../core/services/initialSuperAdminService';
import { SystemClock } from '../infrastructure/clock/SystemClock';
import { INITIAL_AGE_GROUPS } from '../infrastructure/data/seed';
import { AppLogger } from '../infrastructure/logging/AppLogger';
import { BrowserPasswordHasher } from '../infrastructure/security/BrowserPasswordHasher';
import { assert, assertEqual, type UnitTestCase } from './testRunner';

class FakeClock implements IClock {
  private currentMs: number;
  private readonly helperClock = new SystemClock();

  constructor(initialIso = '2026-06-01T10:00:00.000Z') {
    this.currentMs = Date.parse(initialIso);
  }

  public advanceMinutes(minutes: number): void {
    this.currentMs += minutes * 60 * 1000;
  }

  public now(): Date {
    return new Date(this.currentMs);
  }

  public nowUtcIso(): string {
    return this.now().toISOString();
  }

  public nowJalali(): string {
    return this.helperClock.toJalali(this.now());
  }

  public toJalali(date: Date): string {
    return this.helperClock.toJalali(date);
  }
}

interface CapturedEmail {
  toEmail: string;
  subject: string;
  body: string;
  actionUrl?: string;
}

class MockEmailSender implements IEmailSender {
  public readonly sentEmails: CapturedEmail[] = [];

  public async sendAsync(
    toEmail: string,
    subject: string,
    body: string,
    actionUrl?: string,
  ): Promise<void> {
    this.sentEmails.push({ toEmail, subject, body, actionUrl });
  }
}

class MemorySessionTokenStore implements ISessionTokenStore {
  private token: string | null = null;
  public getRawToken(): string | null {
    return this.token;
  }
  public setRawToken(token: string): void {
    this.token = token;
  }
  public clearRawToken(): void {
    this.token = null;
  }
}

class MemoryAuthRepository implements IAuthRepository {
  private users: AppUser[] = [];
  private otps: OtpCode[] = [];
  private tokens: AuthToken[] = [];
  private sessions: UserSession[] = [];
  private contents: ContentItem[] = [];
  private nextUserId = 1;
  private nextOtpId = 1;
  private nextTokenId = 1;
  private nextSessionId = 1;
  private nextContentId = 1;

  public async getUserById(id: number): Promise<AppUser | null> {
    return this.users.find((u) => u.id === id) ?? null;
  }

  public async getUserByNormalizedEmail(normalizedEmail: string): Promise<AppUser | null> {
    return this.users.find((u) => u.normalizedEmail === normalizedEmail) ?? null;
  }

  public async getUserByNormalizedPhoneNumber(
    normalizedPhoneNumber: string,
  ): Promise<AppUser | null> {
    return (
      this.users.find((u) => u.normalizedPhoneNumber === normalizedPhoneNumber) ?? null
    );
  }

  public async getAllUsers(): Promise<AppUser[]> {
    return [...this.users];
  }

  public async countUsers(): Promise<number> {
    return this.users.length;
  }

  public async hasAnySuperAdmin(): Promise<boolean> {
    return this.users.some((u) => u.role === 'SuperAdmin');
  }

  public async createUser(user: Omit<AppUser, 'id'>): Promise<AppUser> {
    const created: AppUser = { ...user, id: this.nextUserId++ };
    this.users.push(created);
    return created;
  }

  public async updateUser(user: AppUser): Promise<void> {
    const idx = this.users.findIndex((u) => u.id === user.id);
    if (idx !== -1) {
      this.users[idx] = { ...user };
    }
  }

  public async createOtpCode(otp: Omit<OtpCode, 'id'>): Promise<OtpCode> {
    const created: OtpCode = { ...otp, id: this.nextOtpId++ };
    this.otps.push(created);
    return created;
  }

  public async getOtpCodesByPhoneNumber(phoneNumber: string): Promise<OtpCode[]> {
    return this.otps.filter((o) => o.phoneNumber === phoneNumber);
  }

  public async updateOtpCode(otp: OtpCode): Promise<void> {
    const idx = this.otps.findIndex((o) => o.id === otp.id);
    if (idx !== -1) {
      this.otps[idx] = { ...otp };
    }
  }

  public async createAuthToken(token: Omit<AuthToken, 'id'>): Promise<AuthToken> {
    const created: AuthToken = { ...token, id: this.nextTokenId++ };
    this.tokens.push(created);
    return created;
  }

  public async getAuthTokenByHash(tokenHash: string): Promise<AuthToken | null> {
    return this.tokens.find((t) => t.tokenHash === tokenHash) ?? null;
  }

  public async updateAuthToken(token: AuthToken): Promise<void> {
    const idx = this.tokens.findIndex((t) => t.id === token.id);
    if (idx !== -1) {
      this.tokens[idx] = { ...token };
    }
  }

  public async createSession(session: Omit<UserSession, 'id'>): Promise<UserSession> {
    const created: UserSession = { ...session, id: this.nextSessionId++ };
    this.sessions.push(created);
    return created;
  }

  public async getSessionByTokenHash(tokenHash: string): Promise<UserSession | null> {
    return this.sessions.find((s) => s.tokenHash === tokenHash) ?? null;
  }

  public async deleteSessionByTokenHash(tokenHash: string): Promise<void> {
    this.sessions = this.sessions.filter((s) => s.tokenHash !== tokenHash);
  }

  public async getActiveAgeGroups(): Promise<AgeGroup[]> {
    return [...INITIAL_AGE_GROUPS];
  }

  public async ageGroupExists(ageGroupId: number): Promise<boolean> {
    return INITIAL_AGE_GROUPS.some((g) => g.id === ageGroupId && g.isActive);
  }

  public async userExists(userId: number): Promise<boolean> {
    return this.users.some((u) => u.id === userId);
  }

  public async createContentItem(item: Omit<ContentItem, 'id'>): Promise<ContentItem> {
    const created: ContentItem = { ...item, id: this.nextContentId++ };
    this.contents.push(created);
    return created;
  }
}

function createAuthTestHarness() {
  const clock = new FakeClock('2026-06-01T10:00:00.000Z');
  const repository = new MemoryAuthRepository();
  const hasher: IPasswordHasher = new BrowserPasswordHasher();
  const emailSender = new MockEmailSender();
  const sessionStore = new MemorySessionTokenStore();
  const logger = new AppLogger(clock, `meraj_test_auth_${Date.now()}_${Math.random()}`, 50);

  const authService = new AuthService(
    repository,
    hasher,
    emailSender,
    clock,
    logger,
    sessionStore,
  );

  const setupService = new InitialSuperAdminService(repository, hasher, clock, logger);
  const integrityService = new ContentIntegrityService(repository);

  return {
    clock,
    repository,
    hasher,
    emailSender,
    sessionStore,
    logger,
    authService,
    setupService,
    integrityService,
  };
}

function extractUidAndToken(actionUrl?: string): { uid: number; token: string } {
  assert(actionUrl && actionUrl.includes('?'), 'Expected email actionUrl with query params');
  const query = actionUrl.split('?')[1];
  const params = new URLSearchParams(query);
  return {
    uid: Number(params.get('uid')),
    token: params.get('token') ?? '',
  };
}

export const stage4Tests: UnitTestCase[] = [
  {
    id: 'stage4-register-confirm-login-flow',
    nameKey: 'health.card.tests.stage4Case1Name',
    descriptionKey: 'health.card.tests.stage4Case1Desc',
    run: async () => {
      const h = createAuthTestHarness();
      try {
        const reg = await h.authService.registerWithEmail({
          email: 'Member1@Example.com',
          password: 'Password123',
          displayName: 'پژوهشگر جوان',
          ageGroupId: 3,
        });

        assertEqual(reg.ok, true, 'Registration must succeed');
        assert(reg.data?.user.id === 1, 'Expected assigned user ID 1');
        assertEqual(reg.data?.user.role, 'Member', 'Registered user role must be Member');
        assertEqual(reg.data?.user.emailConfirmed, false, 'Email must start unconfirmed');

        // Login before confirmation must fail with EMAIL_NOT_CONFIRMED
        const earlyLogin = await h.authService.loginWithEmail({
          email: 'member1@example.com',
          password: 'Password123',
        });
        assertEqual(earlyLogin.ok, false, 'Login before confirmation must fail');
        assertEqual(
          earlyLogin.errorCode,
          'EMAIL_NOT_CONFIRMED',
          'Expected EMAIL_NOT_CONFIRMED error code',
        );

        // Extract confirmation token from MockEmailSender
        assertEqual(h.emailSender.sentEmails.length, 1, 'Expected 1 confirmation email sent');
        const { uid, token } = extractUidAndToken(h.emailSender.sentEmails[0].actionUrl);

        const confirm = await h.authService.confirmEmail({ userId: uid, rawToken: token });
        assertEqual(confirm.ok, true, 'Email confirmation with valid token must succeed');

        // Login after confirmation must succeed and create session
        const login = await h.authService.loginWithEmail({
          email: 'member1@example.com',
          password: 'Password123',
        });
        assertEqual(login.ok, true, 'Login after email confirmation must succeed');

        const currentUser = await h.authService.getCurrentUser();
        assert(currentUser !== null, 'Current user session must be active');
        assertEqual(currentUser.emailConfirmed, true, 'User emailConfirmed must be true');
      } finally {
        h.logger.clearLogs();
      }
    },
  },
  {
    id: 'stage4-password-length-and-duplicate-email',
    nameKey: 'health.card.tests.stage4Case2Name',
    descriptionKey: 'health.card.tests.stage4Case2Desc',
    run: async () => {
      const h = createAuthTestHarness();
      try {
        const shortPass = await h.authService.registerWithEmail({
          email: 'short@example.com',
          password: '1234567',
          displayName: 'کاربر تست',
          ageGroupId: 1,
        });
        assertEqual(shortPass.ok, false, 'Password under 8 chars must be rejected');
        assertEqual(shortPass.errorCode, 'PASSWORD_TOO_SHORT', 'Expected PASSWORD_TOO_SHORT');

        const firstReg = await h.authService.registerWithEmail({
          email: 'unique@example.com',
          password: 'ValidPassword8',
          displayName: 'کاربر یک',
          ageGroupId: 1,
        });
        assertEqual(firstReg.ok, true, 'First registration must succeed');

        const dupReg = await h.authService.registerWithEmail({
          email: 'UNIQUE@example.com',
          password: 'ValidPassword9',
          displayName: 'کاربر دو',
          ageGroupId: 2,
        });
        assertEqual(dupReg.ok, false, 'Duplicate normalized email must be rejected');
        assertEqual(dupReg.errorCode, 'EMAIL_ALREADY_EXISTS', 'Expected EMAIL_ALREADY_EXISTS');
      } finally {
        h.logger.clearLogs();
      }
    },
  },
  {
    id: 'stage4-account-lockout-15-minutes',
    nameKey: 'health.card.tests.stage4Case3Name',
    descriptionKey: 'health.card.tests.stage4Case3Desc',
    run: async () => {
      const h = createAuthTestHarness();
      try {
        await h.authService.registerWithEmail({
          email: 'lock@example.com',
          password: 'CorrectPassword1',
          displayName: 'کاربر قفل',
          ageGroupId: 4,
        });
        const { uid, token } = extractUidAndToken(h.emailSender.sentEmails[0].actionUrl);
        await h.authService.confirmEmail({ userId: uid, rawToken: token });

        // 5 consecutive failed logins
        for (let attempt = 1; attempt <= 5; attempt += 1) {
          const fail = await h.authService.loginWithEmail({
            email: 'lock@example.com',
            password: 'WrongPassword!',
          });
          assertEqual(fail.ok, false, `Attempt ${attempt} must fail`);
          if (attempt === 5) {
            assertEqual(fail.errorCode, 'ACCOUNT_LOCKED', '5th failure must trigger lockout');
          }
        }

        // Advance FakeClock to minute 10 -> still locked even with correct password
        h.clock.advanceMinutes(10);
        const lockedAttempt = await h.authService.loginWithEmail({
          email: 'lock@example.com',
          password: 'CorrectPassword1',
        });
        assertEqual(lockedAttempt.ok, false, 'Attempt at minute 10 must be rejected');
        assertEqual(lockedAttempt.errorCode, 'ACCOUNT_LOCKED', 'Must remain ACCOUNT_LOCKED at min 10');

        // Advance FakeClock by 6 more minutes (minute 16 total) -> lockout expired
        h.clock.advanceMinutes(6);
        const unlockedAttempt = await h.authService.loginWithEmail({
          email: 'lock@example.com',
          password: 'CorrectPassword1',
        });
        assertEqual(unlockedAttempt.ok, true, 'Attempt at minute 16 with right password must succeed');
      } finally {
        h.logger.clearLogs();
      }
    },
  },
  {
    id: 'stage4-forgot-and-reset-password',
    nameKey: 'health.card.tests.stage4Case4Name',
    descriptionKey: 'health.card.tests.stage4Case4Desc',
    run: async () => {
      const h = createAuthTestHarness();
      try {
        await h.authService.registerWithEmail({
          email: 'reset@example.com',
          password: 'OldPassword123',
          displayName: 'کاربر بازیابی',
          ageGroupId: 2,
        });
        const confirmParams = extractUidAndToken(h.emailSender.sentEmails[0].actionUrl);
        await h.authService.confirmEmail({ userId: confirmParams.uid, rawToken: confirmParams.token });

        const reqReset = await h.authService.requestPasswordReset('reset@example.com');
        assertEqual(reqReset.ok, true, 'Password reset request must succeed');
        assertEqual(h.emailSender.sentEmails.length, 2, 'Expected reset email sent');

        const resetParams = extractUidAndToken(h.emailSender.sentEmails[1].actionUrl);
        const resetRes = await h.authService.resetPassword({
          userId: resetParams.uid,
          rawToken: resetParams.token,
          newPassword: 'NewPassword456',
        });
        assertEqual(resetRes.ok, true, 'resetPassword must succeed with valid token');

        const oldLogin = await h.authService.loginWithEmail({
          email: 'reset@example.com',
          password: 'OldPassword123',
        });
        assertEqual(oldLogin.ok, false, 'Old password must no longer work');

        const newLogin = await h.authService.loginWithEmail({
          email: 'reset@example.com',
          password: 'NewPassword456',
        });
        assertEqual(newLogin.ok, true, 'New password must log in successfully');
      } finally {
        h.logger.clearLogs();
      }
    },
  },
  {
    id: 'stage4-initial-superadmin-must-change-password',
    nameKey: 'health.card.tests.stage4Case5Name',
    descriptionKey: 'health.card.tests.stage4Case5Desc',
    run: async () => {
      const h = createAuthTestHarness();
      try {
        assertEqual(await h.setupService.hasSuperAdmin(), false, 'Initially no SuperAdmin');

        const setup = await h.setupService.setupInitialSuperAdmin({
          email: 'chief@meraj.example',
          displayName: 'سرپرست سامانه',
        });
        assertEqual(setup.ok, true, 'Initial SuperAdmin setup must succeed');
        assert(setup.tempPassword && setup.tempPassword.length === 12, 'Expected 12-char temp password');
        assertEqual(setup.user?.role, 'SuperAdmin', 'Role must be SuperAdmin');
        assertEqual(setup.user?.mustChangePassword, true, 'mustChangePassword must be true');

        // Second setup attempt must be blocked
        const secondSetup = await h.setupService.setupInitialSuperAdmin({
          email: 'second@meraj.example',
          displayName: 'تلاش دوم',
        });
        assertEqual(secondSetup.ok, false, 'Second SuperAdmin setup must be rejected');

        // Login with temporary password
        const login = await h.authService.loginWithEmail({
          email: 'chief@meraj.example',
          password: setup.tempPassword,
        });
        assertEqual(login.ok, true, 'SuperAdmin login with temp password must succeed');
        assertEqual(
          login.data?.user.mustChangePassword,
          true,
          'Logged in SuperAdmin must retain mustChangePassword=true until changed',
        );

        // Change password clears mustChangePassword
        const change = await h.authService.changePassword({
          userId: login.data!.user.id,
          currentPassword: setup.tempPassword,
          newPassword: 'StrongSuperPassword99!',
        });
        assertEqual(change.ok, true, 'Password change must succeed');
        assertEqual(
          change.data?.user.mustChangePassword,
          false,
          'mustChangePassword must become false after changing password',
        );
      } finally {
        h.logger.clearLogs();
      }
    },
  },
  {
    id: 'stage4-content-createdby-fk-integrity',
    nameKey: 'health.card.tests.stage4Case6Name',
    descriptionKey: 'health.card.tests.stage4Case6Desc',
    run: async () => {
      const h = createAuthTestHarness();
      try {
        const reg = await h.authService.registerWithEmail({
          email: 'author@example.com',
          password: 'AuthorPassword1',
          displayName: 'نویسنده',
          ageGroupId: 4,
        });
        const validUserId = reg.data!.user.id;
        const nowIso = h.clock.nowUtcIso();

        const baseItem = {
          title: 'مقاله تست یکپارچگی',
          slug: 'مقاله-تست-یکپارچگی',
          summary: 'خلاصه کوتاه برای تست کلید خارجی ایجادکننده محتوا.',
          body: 'متن نمونه',
          format: 'Article' as const,
          impactLevelId: 2,
          status: 1,
          publishedAt: null,
          readWatchMinutes: 5,
          thumbnailKey: 'thumbs/test.jpg',
          isFeatured: false,
          languageCode: 'fa',
          searchText: 'مقاله تست یکپارچگی',
          viewCount: 0,
          downloadCount: 0,
          likeCount: 0,
          createdAt: nowIso,
          updatedAt: nowIso,
        };

        const invalidRes = await h.integrityService.createContentItem({
          ...baseItem,
          createdById: 9999,
        });
        assertEqual(invalidRes.ok, false, 'Non-existent createdById must be rejected');
        assertEqual(
          invalidRes.errorCode,
          'INVALID_CREATED_BY_USER',
          'Expected INVALID_CREATED_BY_USER',
        );

        const validRes = await h.integrityService.createContentItem({
          ...baseItem,
          createdById: validUserId,
        });
        assertEqual(validRes.ok, true, 'Existing user createdById must be accepted');
        assertEqual(validRes.item?.createdById, validUserId, 'Saved item must reference creator ID');
      } finally {
        h.logger.clearLogs();
      }
    },
  },
];
