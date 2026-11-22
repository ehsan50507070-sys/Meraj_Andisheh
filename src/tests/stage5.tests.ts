import type { IAuthRepository, ISessionTokenStore } from '../core/abstractions/authRepository';
import type { IClock } from '../core/abstractions/IClock';
import type { IPasswordHasher } from '../core/abstractions/passwordHasher';
import type { ISmsSender } from '../core/abstractions/smsSender';
import type { AppUser, AuthToken, UserSession } from '../core/domain/auth';
import type { ContentItem } from '../core/domain/content';
import type { OtpCode } from '../core/domain/otp';
import type { AgeGroup } from '../core/domain/taxonomy';
import {
  detectLoginIdentifier,
  normalizeDigits,
  normalizeIranMobile,
} from '../core/services/identifierService';
import {
  canAccessAdminRoute,
  resolvePostLoginRedirect,
} from '../core/services/navigationGuardService';
import { OtpService } from '../core/services/otpService';
import { RateLimiter } from '../core/services/rateLimiter';
import { SystemClock } from '../infrastructure/clock/SystemClock';
import { INITIAL_AGE_GROUPS } from '../infrastructure/data/seed';
import { AppLogger } from '../infrastructure/logging/AppLogger';
import { BrowserPasswordHasher } from '../infrastructure/security/BrowserPasswordHasher';
import { assert, assertEqual, type UnitTestCase } from './testRunner';

class Stage5FakeClock implements IClock {
  private currentMs: number;
  private readonly helperClock = new SystemClock();

  constructor(initialIso = '2026-07-01T12:00:00.000Z') {
    this.currentMs = Date.parse(initialIso);
  }

  public advanceSeconds(seconds: number): void {
    this.currentMs += seconds * 1000;
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

interface CapturedSms {
  phoneNumber: string;
  code: string;
  message: string;
}

class MockSmsSender implements ISmsSender {
  public readonly sentMessages: CapturedSms[] = [];

  public async sendOtpAsync(
    phoneNumber: string,
    code: string,
    message: string,
  ): Promise<void> {
    this.sentMessages.push({ phoneNumber, code, message });
  }
}

class MemorySessionStore implements ISessionTokenStore {
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

class MemoryStage5Repository implements IAuthRepository {
  public users: AppUser[] = [];
  public otps: OtpCode[] = [];
  public tokens: AuthToken[] = [];
  public sessions: UserSession[] = [];
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

function toPersianSampleDigits(asciiDigits: string): string {
  const map = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];
  return asciiDigits.replace(/\d/g, (d) => map[Number(d)] ?? d);
}

function createOtpHarness() {
  const clock = new Stage5FakeClock('2026-07-01T12:00:00.000Z');
  const repository = new MemoryStage5Repository();
  const hasher: IPasswordHasher = new BrowserPasswordHasher();
  const smsSender = new MockSmsSender();
  const sessionStore = new MemorySessionStore();
  const rateLimiter = new RateLimiter(clock, 30, 60 * 1000);
  const logger = new AppLogger(clock, `meraj_test_otp_${Date.now()}_${Math.random()}`, 50);
  const otpService = new OtpService(
    repository,
    hasher,
    smsSender,
    clock,
    logger,
    sessionStore,
    rateLimiter,
  );

  return {
    clock,
    repository,
    hasher,
    smsSender,
    sessionStore,
    rateLimiter,
    logger,
    otpService,
  };
}

function makeDummyUser(overrides: Partial<AppUser>): AppUser {
  return {
    id: 1,
    email: null,
    normalizedEmail: null,
    emailConfirmed: false,
    phoneNumber: '09123456789',
    normalizedPhoneNumber: '09123456789',
    phoneNumberConfirmed: true,
    passwordHash: null,
    passwordSalt: null,
    displayName: 'کاربر نمونه',
    ageGroupId: 2,
    personalizationEnabled: true,
    mustChangePassword: false,
    isActive: true,
    role: 'Member',
    failedLoginCount: 0,
    lockoutEnd: null,
    createdAt: '2026-07-01T12:00:00.000Z',
    lastLoginAt: null,
    ...overrides,
  };
}

export const stage5Tests: UnitTestCase[] = [
  {
    id: 'stage5-otp-full-mobile-flow',
    nameKey: 'health.card.tests.stage5Case1Name',
    descriptionKey: 'health.card.tests.stage5Case1Desc',
    run: async () => {
      const h = createOtpHarness();
      try {
        assertEqual(
          normalizeIranMobile('۰۹۱۲-۳۴۵-۶۷۸۹'),
          '09123456789',
          'Persian digits mobile with dashes must normalize to 09123456789',
        );
        assertEqual(
          normalizeIranMobile('+98 912 345 6789'),
          '09123456789',
          '+98 format must normalize to 09123456789',
        );
        assertEqual(
          normalizeIranMobile('00989123456789'),
          '09123456789',
          '0098 format must normalize to 09123456789',
        );
        assertEqual(
          normalizeIranMobile('9123456789'),
          '09123456789',
          '10-digit format without leading 0 must normalize to 09123456789',
        );

        // Request OTP using Persian digits
        const req1 = await h.otpService.requestOtp('۰۹۱۲۳۴۵۶۷۸۹');
        assertEqual(req1.ok, true, 'First OTP request must succeed');
        assertEqual(h.smsSender.sentMessages.length, 1, 'Expected 1 SMS sent');

        const sentCode1 = h.smsSender.sentMessages[0].code;
        assert(/^\d{6}$/.test(sentCode1), 'Sent OTP must be 6 digits');

        // Verify raw OTP code is NOT persisted in otpCodes
        assertEqual(h.repository.otps.length, 1, 'Expected 1 stored OtpCode record');
        assert(
          h.repository.otps[0].codeHash !== sentCode1 &&
            h.repository.otps[0].codeHash.length >= 32,
          'OtpCode must store only codeHash, never raw code',
        );

        // Verify OTP using Persian digits
        const verify1 = await h.otpService.verifyOtp(
          '+989123456789',
          toPersianSampleDigits(sentCode1),
        );
        assertEqual(verify1.ok, true, 'OTP verification with Persian digits must succeed');
        assertEqual(
          verify1.data?.status,
          'needs_registration',
          'New mobile user must receive needs_registration status',
        );

        if (verify1.data?.status !== 'needs_registration') {
          throw new Error('Expected needs_registration');
        }

        // Complete mobile registration (child ageGroupId = 1 must also work with phone)
        const reg = await h.otpService.completeMobileRegistration({
          verifiedPhone: verify1.data.verifiedPhone,
          registrationToken: verify1.data.registrationToken,
          displayName: 'ستاره کتاب‌خوان',
          ageGroupId: 1,
        });
        assertEqual(reg.ok, true, 'Mobile registration completion must succeed');
        assertEqual(reg.data?.user.role, 'Member', 'Mobile registered user role must be Member');
        assertEqual(reg.data?.user.phoneNumberConfirmed, true, 'phoneNumberConfirmed must be true');
        assertEqual(reg.data?.user.email, null, 'Mobile-only user email must be null');
        assert(h.sessionStore.getRawToken() !== null, 'Registration must establish user session');

        // Advance 65s and log in again with the same phone
        h.clock.advanceSeconds(65);
        h.sessionStore.clearRawToken();

        const req2 = await h.otpService.requestOtp('09123456789');
        assertEqual(req2.ok, true, 'Second OTP request after cooldown must succeed');
        const sentCode2 = h.smsSender.sentMessages[1].code;

        const verify2 = await h.otpService.verifyOtp('۰۹۱۲۳۴۵۶۷۸۹', sentCode2, '#/health');
        assertEqual(verify2.ok, true, 'Second OTP verify for existing user must succeed');
        assertEqual(verify2.data?.status, 'logged_in', 'Existing mobile user must log in directly');
        if (verify2.data?.status === 'logged_in') {
          assertEqual(
            verify2.data.redirectTo,
            '#/health',
            'Member login must honor safe public returnUrl',
          );
        }
      } finally {
        h.logger.clearLogs();
      }
    },
  },
  {
    id: 'stage5-otp-5-wrong-attempts-lock',
    nameKey: 'health.card.tests.stage5Case2Name',
    descriptionKey: 'health.card.tests.stage5Case2Desc',
    run: async () => {
      const h = createOtpHarness();
      try {
        await h.otpService.requestOtp('09121112233');
        const realCode = h.smsSender.sentMessages[0].code;
        const wrongCode = realCode === '111111' ? '222222' : '111111';

        for (let attempt = 1; attempt <= 5; attempt += 1) {
          const res = await h.otpService.verifyOtp('09121112233', wrongCode);
          assertEqual(res.ok, false, `Wrong attempt ${attempt} must fail`);
          if (attempt < 5) {
            assertEqual(res.errorCode, 'OTP_INVALID', `Attempt ${attempt} must return OTP_INVALID`);
          } else {
            assertEqual(res.errorCode, 'OTP_LOCKED', '5th wrong attempt must return OTP_LOCKED');
          }
        }

        // 6th attempt even with the right code must be rejected as OTP_LOCKED
        const sixthRes = await h.otpService.verifyOtp('09121112233', realCode);
        assertEqual(sixthRes.ok, false, '6th attempt with correct code must fail when locked');
        assertEqual(sixthRes.errorCode, 'OTP_LOCKED', '6th attempt must stay OTP_LOCKED');
      } finally {
        h.logger.clearLogs();
      }
    },
  },
  {
    id: 'stage5-otp-2min-expiry',
    nameKey: 'health.card.tests.stage5Case3Name',
    descriptionKey: 'health.card.tests.stage5Case3Desc',
    run: async () => {
      const h = createOtpHarness();
      try {
        // Code 1: verified at second 119 -> accepted
        await h.otpService.requestOtp('09122223344');
        const code1 = h.smsSender.sentMessages[0].code;
        h.clock.advanceSeconds(119);
        const res119 = await h.otpService.verifyOtp('09122223344', code1);
        assertEqual(res119.ok, true, 'OTP at second 119 must still be valid');

        // Code 2: verified at second 121 -> OTP_EXPIRED
        await h.otpService.requestOtp('09122223355');
        const code2 = h.smsSender.sentMessages[1].code;
        h.clock.advanceSeconds(121);
        const res121 = await h.otpService.verifyOtp('09122223355', code2);
        assertEqual(res121.ok, false, 'OTP at second 121 must be rejected');
        assertEqual(res121.errorCode, 'OTP_EXPIRED', 'Expected OTP_EXPIRED at second 121');
      } finally {
        h.logger.clearLogs();
      }
    },
  },
  {
    id: 'stage5-otp-60s-resend-cooldown',
    nameKey: 'health.card.tests.stage5Case4Name',
    descriptionKey: 'health.card.tests.stage5Case4Desc',
    run: async () => {
      const h = createOtpHarness();
      try {
        const first = await h.otpService.requestOtp('09123334455');
        assertEqual(first.ok, true, 'First OTP request must succeed');

        h.clock.advanceSeconds(45);
        const at45 = await h.otpService.requestOtp('09123334455');
        assertEqual(at45.ok, false, 'Resend at second 45 must be rejected');
        assertEqual(at45.errorCode, 'OTP_COOLDOWN', 'Expected OTP_COOLDOWN at second 45');
        assertEqual(at45.remainingSeconds, 15, 'Expected 15 seconds remaining at second 45');

        h.clock.advanceSeconds(16); // total 61 seconds
        const at61 = await h.otpService.requestOtp('09123334455');
        assertEqual(at61.ok, true, 'Resend at second 61 must succeed');
      } finally {
        h.logger.clearLogs();
      }
    },
  },
  {
    id: 'stage5-otp-5-per-hour-limit',
    nameKey: 'health.card.tests.stage5Case5Name',
    descriptionKey: 'health.card.tests.stage5Case5Desc',
    run: async () => {
      const h = createOtpHarness();
      try {
        // Request 5 codes spaced 10 minutes apart (total 40 minutes elapsed)
        for (let i = 1; i <= 5; i += 1) {
          const req = await h.otpService.requestOtp('09124445566');
          assertEqual(req.ok, true, `Hourly OTP #${i} must succeed`);
          if (i < 5) {
            h.clock.advanceMinutes(10);
          }
        }

        // At minute 50 (10 mins after 5th, 50 mins after 1st): 6th must hit OTP_HOURLY_LIMIT
        h.clock.advanceMinutes(10);
        const sixthAtMin50 = await h.otpService.requestOtp('09124445566');
        assertEqual(sixthAtMin50.ok, false, '6th OTP within 60 minutes must be rejected');
        assertEqual(
          sixthAtMin50.errorCode,
          'OTP_HOURLY_LIMIT',
          'Expected OTP_HOURLY_LIMIT for 6th OTP within an hour',
        );

        // Advance another 11 minutes (minute 61 from 1st code) -> oldest dropped out of window
        h.clock.advanceMinutes(11);
        const afterHour = await h.otpService.requestOtp('09124445566');
        assertEqual(afterHour.ok, true, 'OTP after > 60 minutes must be permitted again');
      } finally {
        h.logger.clearLogs();
      }
    },
  },
  {
    id: 'stage5-identifier-detection-and-rate-limiter',
    nameKey: 'health.card.tests.stage5Case6Name',
    descriptionKey: 'health.card.tests.stage5Case6Desc',
    run: () => {
      assertEqual(
        normalizeDigits('۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩'),
        '01234567890123456789',
        'normalizeDigits must convert both Persian and Arabic digits',
      );

      const phoneDetected = detectLoginIdentifier('۰۹۳۵۱۲۳۴۵۶۷');
      assertEqual(phoneDetected.type, 'phone', 'Persian mobile must detect as phone');
      if (phoneDetected.type === 'phone') {
        assertEqual(phoneDetected.normalized, '09351234567', 'Normalized phone mismatch');
      }

      const emailDetected = detectLoginIdentifier('  Researcher@Meraj.IR ');
      assertEqual(emailDetected.type, 'email', 'Email must detect as email');
      if (emailDetected.type === 'email') {
        assertEqual(emailDetected.normalized, 'researcher@meraj.ir', 'Normalized email mismatch');
      }

      const invalidDetected = detectLoginIdentifier('not-a-valid-id');
      assertEqual(invalidDetected.type, 'invalid', 'Invalid identifier must detect as invalid');

      // RateLimiter sliding window + reset()
      const clock = new Stage5FakeClock('2026-07-01T12:00:00.000Z');
      const limiter = new RateLimiter(clock, 3, 60 * 1000);
      assertEqual(limiter.consume('ip:1').allowed, true, 'Request 1 must be allowed');
      assertEqual(limiter.consume('ip:1').allowed, true, 'Request 2 must be allowed');
      assertEqual(limiter.consume('ip:1').allowed, true, 'Request 3 must be allowed');
      assertEqual(limiter.consume('ip:1').allowed, false, 'Request 4 within window must block');

      clock.advanceSeconds(61);
      assertEqual(limiter.consume('ip:1').allowed, true, 'Request after window must be allowed');

      assertEqual(limiter.consume('ip:1').allowed, true, 'Consume #2 after window');
      assertEqual(limiter.consume('ip:1').allowed, true, 'Consume #3 after window');
      assertEqual(limiter.consume('ip:1').allowed, false, 'Consume #4 must block before reset');
      limiter.reset('ip:1');
      assertEqual(limiter.consume('ip:1').allowed, true, 'Request after reset() must be allowed');
    },
  },
  {
    id: 'stage5-role-redirect-and-admin-guard',
    nameKey: 'health.card.tests.stage5Case7Name',
    descriptionKey: 'health.card.tests.stage5Case7Desc',
    run: () => {
      const member = makeDummyUser({ role: 'Member', mustChangePassword: false });
      const staff = makeDummyUser({ role: 'Staff', mustChangePassword: false });
      const superAdmin = makeDummyUser({ role: 'SuperAdmin', mustChangePassword: false });
      const forcedSuperAdmin = makeDummyUser({ role: 'SuperAdmin', mustChangePassword: true });
      const forcedStaff = makeDummyUser({ role: 'Staff', mustChangePassword: true });

      // Admin route guard
      assertEqual(canAccessAdminRoute(null), false, 'Guest must NOT access /admin (404)');
      assertEqual(canAccessAdminRoute(member), false, 'Member must NOT access /admin (404)');
      assertEqual(canAccessAdminRoute(staff), true, 'Active Staff must access /admin');
      assertEqual(canAccessAdminRoute(superAdmin), true, 'Active SuperAdmin must access /admin');

      // Post-login redirects
      assertEqual(
        resolvePostLoginRedirect(member, '#/dev/components'),
        '#/dev/components',
        'Member must redirect to safe public returnUrl',
      );
      assertEqual(
        resolvePostLoginRedirect(member, '#/admin'),
        '#/',
        'Member with /admin returnUrl must fall back to #/',
      );
      assertEqual(
        resolvePostLoginRedirect(member, 'https://evil.example'),
        '#/',
        'Member with external returnUrl must fall back to #/',
      );
      assertEqual(
        resolvePostLoginRedirect(staff, '#/health'),
        '#/admin',
        'Staff must redirect to #/admin',
      );
      assertEqual(
        resolvePostLoginRedirect(superAdmin, null),
        '#/admin',
        'SuperAdmin must redirect to #/admin',
      );
      assertEqual(
        resolvePostLoginRedirect(forcedSuperAdmin, '#/admin'),
        '#/account/change-password',
        'mustChangePassword=true must override SuperAdmin redirect',
      );
      assertEqual(
        resolvePostLoginRedirect(forcedStaff, '#/admin'),
        '#/account/change-password',
        'mustChangePassword=true must override Staff redirect',
      );
    },
  },
];
