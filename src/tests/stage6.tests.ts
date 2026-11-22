import type { IAdminRepository } from '../core/abstractions/adminRepository';
import type { IAuthRepository, ISessionTokenStore } from '../core/abstractions/authRepository';
import type { IClock } from '../core/abstractions/IClock';
import type { IEmailSender } from '../core/abstractions/emailSender';
import type { IPasswordHasher } from '../core/abstractions/passwordHasher';
import type { AppUser, AuthToken, UserSession } from '../core/domain/auth';
import type { ContentItem } from '../core/domain/content';
import type { OtpCode } from '../core/domain/otp';
import {
  ALL_PERMISSION_KEYS,
  type StaffPermission,
} from '../core/domain/permissions';
import {
  FEATURE_FLAG_KEYS,
  type FeatureFlag,
  type SiteSetting,
} from '../core/domain/settings';
import type { AgeGroup } from '../core/domain/taxonomy';
import { AuthService } from '../core/services/authService';
import { PermissionPolicyService } from '../core/services/permissionPolicyService';
import { SettingsManagementService } from '../core/services/settingsManagementService';
import { StaffManagementService } from '../core/services/staffManagementService';
import { UserManagementService } from '../core/services/userManagementService';
import { SystemClock } from '../infrastructure/clock/SystemClock';
import { envConfig } from '../infrastructure/config/envConfig';
import { IndexedDbDataStore } from '../infrastructure/data/IndexedDbDataStore';
import {
  DATABASE_MIGRATIONS,
  STAGE6_OBJECT_STORES,
  STORE_NAMES,
} from '../infrastructure/data/migrations';
import {
  INITIAL_AGE_GROUPS,
  INITIAL_FEATURE_FLAGS,
  INITIAL_SITE_SETTINGS,
} from '../infrastructure/data/seed';
import { AppLogger } from '../infrastructure/logging/AppLogger';
import { BrowserPasswordHasher } from '../infrastructure/security/BrowserPasswordHasher';
import { assert, assertEqual, type UnitTestCase } from './testRunner';

class Stage6FakeClock implements IClock {
  private currentMs: number;
  private readonly helperClock = new SystemClock();

  constructor(initialIso = '2026-08-01T10:00:00.000Z') {
    this.currentMs = Date.parse(initialIso);
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

class MemoryEmailSender implements IEmailSender {
  public async sendAsync(): Promise<void> {
    // No-op in unit tests
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

class MemoryStage6Repository implements IAuthRepository, IAdminRepository {
  public users: AppUser[] = [];
  public otps: OtpCode[] = [];
  public tokens: AuthToken[] = [];
  public sessions: UserSession[] = [];
  public staffPermissions: StaffPermission[] = [];
  public featureFlags: FeatureFlag[] = INITIAL_FEATURE_FLAGS.map((f) => ({ ...f }));
  public siteSettings: SiteSetting[] = INITIAL_SITE_SETTINGS.map((s) => ({ ...s }));
  private contents: ContentItem[] = [];
  private nextUserId = 1;
  private nextOtpId = 1;
  private nextTokenId = 1;
  private nextSessionId = 1;
  private nextPermissionId = 1;
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
    if (idx !== -1) this.otps[idx] = { ...otp };
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
    if (idx !== -1) this.tokens[idx] = { ...token };
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

  public async deleteSessionsByUserId(userId: number): Promise<void> {
    this.sessions = this.sessions.filter((s) => s.userId !== userId);
  }

  public async getStaffPermissionsByUserId(userId: number): Promise<StaffPermission[]> {
    return this.staffPermissions.filter((p) => p.userId === userId);
  }

  public async replaceStaffPermissions(
    userId: number,
    permissions: Omit<StaffPermission, 'id'>[],
  ): Promise<StaffPermission[]> {
    this.staffPermissions = this.staffPermissions.filter((p) => p.userId !== userId);
    const inserted: StaffPermission[] = [];
    for (const perm of permissions) {
      const record: StaffPermission = { ...perm, id: this.nextPermissionId++ };
      this.staffPermissions.push(record);
      inserted.push(record);
    }
    return inserted;
  }

  public async getAllFeatureFlags(): Promise<FeatureFlag[]> {
    return this.featureFlags.map((f) => ({ ...f }));
  }

  public async upsertFeatureFlag(flag: FeatureFlag): Promise<void> {
    const idx = this.featureFlags.findIndex((f) => f.key === flag.key);
    if (idx === -1) {
      this.featureFlags.push({ ...flag });
    } else {
      this.featureFlags[idx] = { ...flag };
    }
  }

  public async getAllSiteSettings(): Promise<SiteSetting[]> {
    return this.siteSettings.map((s) => ({ ...s }));
  }

  public async getSiteSettingByKey(key: string): Promise<SiteSetting | null> {
    const found = this.siteSettings.find((s) => s.key === key);
    return found ? { ...found } : null;
  }

  public async upsertSiteSettings(settings: SiteSetting[]): Promise<void> {
    for (const setting of settings) {
      const idx = this.siteSettings.findIndex((s) => s.key === setting.key);
      if (idx === -1) {
        this.siteSettings.push({ ...setting });
      } else {
        this.siteSettings[idx] = { ...setting };
      }
    }
  }

  public async getActiveAgeGroups(): Promise<AgeGroup[]> {
    return [...INITIAL_AGE_GROUPS];
  }

  public async ageGroupExists(ageGroupId: number): Promise<boolean> {
    return INITIAL_AGE_GROUPS.some((g) => g.id === ageGroupId);
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

async function createStage6Harness() {
  const clock = new Stage6FakeClock();
  const repo = new MemoryStage6Repository();
  const logger = new AppLogger(clock, `meraj_stage6_test_${Date.now()}`, 50);
  logger.clearLogs();
  const passwordHasher: IPasswordHasher = new BrowserPasswordHasher();
  const sessionStore = new MemorySessionTokenStore();
  const emailSender = new MemoryEmailSender();

  const authService = new AuthService(
    repo,
    passwordHasher,
    emailSender,
    clock,
    logger,
    sessionStore,
    {
      confirmSubject: 'confirm',
      confirmBody: '{url}',
      resetSubject: 'reset',
      resetBody: '{url}',
    },
  );
  const policyService = new PermissionPolicyService(repo, logger);
  const staffService = new StaffManagementService(
    repo,
    passwordHasher,
    clock,
    logger,
    policyService,
  );
  const userService = new UserManagementService(repo, logger, policyService);
  const settingsService = new SettingsManagementService(repo, logger, policyService);

  const superAdminHash = await passwordHasher.hashPassword('SuperPass!2026');
  const superAdmin = await repo.createUser({
    email: 'super@example.com',
    normalizedEmail: 'super@example.com',
    emailConfirmed: true,
    phoneNumber: null,
    normalizedPhoneNumber: null,
    phoneNumberConfirmed: false,
    passwordHash: superAdminHash.hash,
    passwordSalt: superAdminHash.salt,
    displayName: 'مدیر کل سامانه',
    ageGroupId: null,
    personalizationEnabled: true,
    mustChangePassword: false,
    isActive: true,
    role: 'SuperAdmin',
    failedLoginCount: 0,
    lockoutEnd: null,
    createdAt: clock.nowUtcIso(),
    lastLoginAt: null,
  });

  return {
    clock,
    repo,
    logger,
    passwordHasher,
    sessionStore,
    authService,
    policyService,
    staffService,
    userService,
    settingsService,
    superAdmin,
  };
}

export const stage6Tests: UnitTestCase[] = [
  {
    id: 'stage6-migration-v5',
    nameKey: 'tests.stage6.migrationV5.name',
    descriptionKey: 'tests.stage6.migrationV5.desc',
    run: async () => {
      assert(
        DATABASE_MIGRATIONS.some((m) => m.version === 5),
        'Migration version 5 must be registered',
      );
      assert(
        STAGE6_OBJECT_STORES.includes(STORE_NAMES.STAFF_PERMISSIONS),
        'STAGE6_OBJECT_STORES must include staffPermissions',
      );

      if (typeof window !== 'undefined' && window.indexedDB) {
        const testDbName = `MerajStage6MigrationTest_${Date.now()}`;
        const testStore = new IndexedDbDataStore(
          testDbName,
          envConfig.databaseVersion,
          envConfig.metaStoreName,
        );
        try {
          await testStore.connect();
          const stores = await testStore.getObjectStoreNames();
          assert(
            stores.includes(STORE_NAMES.STAFF_PERMISSIONS),
            'staffPermissions object store must exist after Migration v5',
          );

          await testStore.addRecordWithAutoId(STORE_NAMES.STAFF_PERMISSIONS, {
            userId: 101,
            permissionKey: 'content.manage',
            grantedAt: '2026-08-01T10:00:00.000Z',
            grantedById: 1,
          });

          let duplicateRejected = false;
          try {
            await testStore.addRecordWithAutoId(STORE_NAMES.STAFF_PERMISSIONS, {
              userId: 101,
              permissionKey: 'content.manage',
              grantedAt: '2026-08-01T10:01:00.000Z',
              grantedById: 1,
            });
          } catch {
            duplicateRejected = true;
          }
          assert(
            duplicateRejected,
            'Unique composite index [userId, permissionKey] must reject duplicate entries',
          );
        } finally {
          testStore.close();
          window.indexedDB.deleteDatabase(testDbName);
        }
      }
    },
  },
  {
    id: 'stage6-policy-403-and-warn-log',
    nameKey: 'tests.stage6.policy403AndWarnLog.name',
    descriptionKey: 'tests.stage6.policy403AndWarnLog.desc',
    run: async () => {
      const h = await createStage6Harness();
      try {
        const created = await h.staffService.createStaffAccount(h.superAdmin, {
          displayName: 'همکار اخبار',
          email: 'staff1@example.com',
          permissions: ['dashboard.view'],
        });
        assertEqual(created.ok, true, 'SuperAdmin must be able to create staff');
        const staffUser = created.item!.user;

        h.logger.clearLogs();
        const decision = await h.policyService.authorizePermission(
          staffUser,
          'content.manage',
          '#/admin/content',
        );

        assertEqual(decision.allowed, false, 'Staff without content.manage must be denied');
        assertEqual(decision.statusCode, 403, 'Denied Staff must receive HTTP-equivalent 403');

        const warnLogs = h.logger.getLogs().filter((l) => l.level === 'WARN');
        assertEqual(warnLogs.length, 1, 'Exactly one WARN log must be recorded on 403 denial');
        assertEqual(warnLogs[0].details?.userId, staffUser.id, 'WARN log must capture userId');
        assertEqual(
          warnLogs[0].details?.requiredPermission,
          'content.manage',
          'WARN log must capture requiredPermission',
        );
      } finally {
        h.logger.clearLogs();
      }
    },
  },
  {
    id: 'stage6-superadmin-staff-isolation',
    nameKey: 'tests.stage6.superAdminStaffIsolation.name',
    descriptionKey: 'tests.stage6.superAdminStaffIsolation.desc',
    run: async () => {
      const h = await createStage6Harness();
      try {
        const superPerms = await h.policyService.getUserPermissions(h.superAdmin);
        assertEqual(superPerms.length, 10, 'SuperAdmin must implicitly have all 10 permission keys');

        const created = await h.staffService.createStaffAccount(h.superAdmin, {
          displayName: 'همکار پرمجوز',
          email: 'fullstaff@example.com',
          permissions: [...ALL_PERMISSION_KEYS],
        });
        assertEqual(created.ok, true, 'Staff creation must succeed');
        const fullStaff = created.item!.user;
        assertEqual(
          created.item!.permissions.length,
          10,
          'Staff was granted all 10 permission keys',
        );

        const superAdminCheck = h.policyService.authorizeSuperAdminOnly(
          fullStaff,
          '#/admin/staff',
        );
        assertEqual(superAdminCheck.allowed, false, 'Staff with all 10 keys still cannot access SuperAdmin route');
        assertEqual(superAdminCheck.statusCode, 403, 'Staff accessing #/admin/staff must get 403');

        const attemptCreate = await h.staffService.createStaffAccount(fullStaff, {
          displayName: 'غیرمجاز',
          email: 'unauth@example.com',
          permissions: [],
        });
        assertEqual(attemptCreate.ok, false, 'Staff cannot create another Staff');
        assertEqual(attemptCreate.statusCode, 403, 'Unauthorized staff creation must return 403');
      } finally {
        h.logger.clearLogs();
      }
    },
  },
  {
    id: 'stage6-permission-grant-and-revoke',
    nameKey: 'tests.stage6.permissionGrantAndRevoke.name',
    descriptionKey: 'tests.stage6.permissionGrantAndRevoke.desc',
    run: async () => {
      const h = await createStage6Harness();
      try {
        const created = await h.staffService.createStaffAccount(h.superAdmin, {
          displayName: 'همکار تحریریه',
          email: 'editor@example.com',
          permissions: [],
        });
        const staffUser = created.item!.user;
        const tempPassword = created.tempPassword!;

        // Clear mustChangePassword for direct re-login test after password setup
        await h.authService.loginWithEmail({
          email: 'editor@example.com',
          password: tempPassword,
        });
        await h.authService.changePassword({
          userId: staffUser.id,
          currentPassword: tempPassword,
          newPassword: 'EditorStrong#2026',
        });
        await h.authService.logout();

        // Grant content.manage
        const grantRes = await h.staffService.updateStaffPermissions(
          h.superAdmin,
          staffUser.id,
          ['content.manage'],
        );
        assertEqual(grantRes.ok, true, 'SuperAdmin must grant content.manage');

        // Re-login and verify access
        const relogin1 = await h.authService.loginWithEmail({
          email: 'editor@example.com',
          password: 'EditorStrong#2026',
        });
        assertEqual(relogin1.ok, true, 'Staff re-login after grant must succeed');
        const decisionGranted = await h.policyService.authorizePermission(
          relogin1.data?.user ?? null,
          'content.manage',
          '#/admin/content',
        );
        assertEqual(decisionGranted.statusCode, 200, 'Granted permission must allow access (200)');
        await h.authService.logout();

        // Revoke content.manage
        const revokeRes = await h.staffService.updateStaffPermissions(
          h.superAdmin,
          staffUser.id,
          [],
        );
        assertEqual(revokeRes.ok, true, 'SuperAdmin must revoke content.manage');

        // Re-login and verify 403
        const relogin2 = await h.authService.loginWithEmail({
          email: 'editor@example.com',
          password: 'EditorStrong#2026',
        });
        assertEqual(relogin2.ok, true, 'Staff re-login after revoke must succeed');
        const decisionRevoked = await h.policyService.authorizePermission(
          relogin2.data?.user ?? null,
          'content.manage',
          '#/admin/content',
        );
        assertEqual(decisionRevoked.statusCode, 403, 'Revoked permission must return 403');
      } finally {
        h.logger.clearLogs();
      }
    },
  },
  {
    id: 'stage6-guest-and-member-get-404',
    nameKey: 'tests.stage6.guestAndMemberGet404.name',
    descriptionKey: 'tests.stage6.guestAndMemberGet404.desc',
    run: async () => {
      const h = await createStage6Harness();
      try {
        const memberHash = await h.passwordHasher.hashPassword('MemberPass!2026');
        const member = await h.repo.createUser({
          email: 'member@example.com',
          normalizedEmail: 'member@example.com',
          emailConfirmed: true,
          phoneNumber: null,
          normalizedPhoneNumber: null,
          phoneNumberConfirmed: false,
          passwordHash: memberHash.hash,
          passwordSalt: memberHash.salt,
          displayName: 'کاربر عادی',
          ageGroupId: 2,
          personalizationEnabled: true,
          mustChangePassword: false,
          isActive: true,
          role: 'Member',
          failedLoginCount: 0,
          lockoutEnd: null,
          createdAt: h.clock.nowUtcIso(),
          lastLoginAt: null,
        });

        for (const actor of [null, member]) {
          assertEqual(
            h.policyService.authorizeAdminShell(actor).statusCode,
            404,
            'Guest and Member must get 404 on admin shell',
          );
          assertEqual(
            h.policyService.authorizeSuperAdminOnly(actor, '#/admin/staff').statusCode,
            404,
            'Guest and Member must get 404 on #/admin/staff (never 403)',
          );
          assertEqual(
            (
              await h.policyService.authorizePermission(
                actor,
                'settings.manage',
                '#/admin/settings',
              )
            ).statusCode,
            404,
            'Guest and Member must get 404 on #/admin/settings (never 403)',
          );
        }
        assertEqual(
          h.logger.getLogs().filter((l) => l.level === 'WARN').length,
          0,
          'Guest/Member 404 masking must not leak Staff 403 warnings',
        );
      } finally {
        h.logger.clearLogs();
      }
    },
  },
  {
    id: 'stage6-user-deactivation-session-purge',
    nameKey: 'tests.stage6.userDeactivationSessionPurge.name',
    descriptionKey: 'tests.stage6.userDeactivationSessionPurge.desc',
    run: async () => {
      const h = await createStage6Harness();
      try {
        const memberHash = await h.passwordHasher.hashPassword('MemberPass!2026');
        const member = await h.repo.createUser({
          email: 'active.member@example.com',
          normalizedEmail: 'active.member@example.com',
          emailConfirmed: true,
          phoneNumber: null,
          normalizedPhoneNumber: null,
          phoneNumberConfirmed: false,
          passwordHash: memberHash.hash,
          passwordSalt: memberHash.salt,
          displayName: 'عضو فعال',
          ageGroupId: 3,
          personalizationEnabled: true,
          mustChangePassword: false,
          isActive: true,
          role: 'Member',
          failedLoginCount: 0,
          lockoutEnd: null,
          createdAt: h.clock.nowUtcIso(),
          lastLoginAt: null,
        });

        const memberLogin = await h.authService.loginWithEmail({
          email: 'active.member@example.com',
          password: 'MemberPass!2026',
        });
        assertEqual(memberLogin.ok, true, 'Member login must create an active session');
        assert(
          h.repo.sessions.some((s) => s.userId === member.id),
          'Active session must exist for Member',
        );

        const staffNoPerm = (
          await h.staffService.createStaffAccount(h.superAdmin, {
            displayName: 'همکار محتوا',
            email: 'noperm@example.com',
            permissions: ['content.manage'],
          })
        ).item!.user;

        const deniedToggle = await h.userService.toggleMemberActive(
          staffNoPerm,
          member.id,
          false,
        );
        assertEqual(deniedToggle.statusCode, 403, 'Staff without users.manage must get 403');

        const staffWithPerm = (
          await h.staffService.createStaffAccount(h.superAdmin, {
            displayName: 'همکار کاربران',
            email: 'useradmin@example.com',
            permissions: ['users.manage'],
          })
        ).item!.user;

        const okToggle = await h.userService.toggleMemberActive(
          staffWithPerm,
          member.id,
          false,
        );
        assertEqual(okToggle.ok, true, 'Staff with users.manage must deactivate Member');
        assertEqual(
          h.repo.sessions.filter((s) => s.userId === member.id).length,
          0,
          'All active sessions for deactivated Member must be deleted immediately',
        );

        const currentAfterDeactivate = await h.authService.getCurrentUser();
        assertEqual(currentAfterDeactivate, null, 'Deactivated Member session must be invalid');

        const blockedRelogin = await h.authService.loginWithEmail({
          email: 'active.member@example.com',
          password: 'MemberPass!2026',
        });
        assertEqual(blockedRelogin.ok, false, 'Deactivated Member must not be able to log in');
        assertEqual(
          blockedRelogin.errorCode,
          'ACCOUNT_INACTIVE',
          'Deactivated Member login must fail with ACCOUNT_INACTIVE',
        );
      } finally {
        h.logger.clearLogs();
      }
    },
  },
  {
    id: 'stage6-settings-and-feature-flags',
    nameKey: 'tests.stage6.settingsAndFeatureFlags.name',
    descriptionKey: 'tests.stage6.settingsAndFeatureFlags.desc',
    run: async () => {
      const h = await createStage6Harness();
      try {
        const settingsStaff = (
          await h.staffService.createStaffAccount(h.superAdmin, {
            displayName: 'همکار تنظیمات',
            email: 'settings@example.com',
            permissions: ['settings.manage'],
          })
        ).item!.user;

        const toggleRes = await h.settingsService.toggleFeatureFlag(
          settingsStaff,
          'Comments',
          true,
        );
        assertEqual(toggleRes.ok, true, 'Enabling Comments flag must succeed');

        const flagsAfter = await h.settingsService.getFeatureFlags(settingsStaff);
        assertEqual(
          flagsAfter.items?.length,
          FEATURE_FLAG_KEYS.length,
          'All 7 feature flags must be returned',
        );
        assertEqual(
          flagsAfter.items?.find((f) => f.key === 'Comments')?.isEnabled,
          true,
          'Comments flag must remain enabled',
        );
        assertEqual(
          flagsAfter.items?.find((f) => f.key === 'Films')?.isEnabled,
          false,
          'Other flags must stay unaffected',
        );

        const updateRes = await h.settingsService.updateSiteSettings(settingsStaff, {
          'Site.Title': 'معراج اندیشه نو',
          'Home.ItemsPerShelf': '۱۶',
        });
        assertEqual(updateRes.ok, true, 'Valid SiteSettings with Persian digits must succeed');

        const publicTitle = await h.settingsService.getPublicSiteTitle('معراج اندیشه');
        assertEqual(publicTitle, 'معراج اندیشه نو', 'Updated Site.Title must read back accurately');

        const allSettings = await h.settingsService.getSiteSettings(settingsStaff);
        assertEqual(
          allSettings.items?.find((s) => s.key === 'Home.ItemsPerShelf')?.value,
          '16',
          'Home.ItemsPerShelf must be normalized and persisted as 16',
        );

        for (const badVal of ['0', '-5', 'abc', '']) {
          const invalidRes = await h.settingsService.updateSiteSettings(settingsStaff, {
            'Home.ItemsPerShelf': badVal,
          });
          assertEqual(
            invalidRes.ok,
            false,
            `Invalid numeric setting "${badVal}" must be rejected`,
          );
          assertEqual(
            invalidRes.errorCode,
            'VALIDATION_FAILED',
            'Invalid setting must return VALIDATION_FAILED',
          );
        }
      } finally {
        h.logger.clearLogs();
      }
    },
  },
];
