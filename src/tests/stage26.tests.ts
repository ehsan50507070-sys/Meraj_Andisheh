import type { IClock } from '../core/abstractions/IClock';
import type { IAdminRepository } from '../core/abstractions/adminRepository';
import type { IAnnouncementDismissStorage } from '../core/abstractions/announcementDismissStorage';
import type { IAnnouncementRepository } from '../core/abstractions/announcementRepository';
import type { AppUser } from '../core/domain/auth';
import type { AnnouncementItem } from '../core/domain/layout';
import type { StaffPermission } from '../core/domain/permissions';
import type { FeatureFlag, SiteSetting } from '../core/domain/settings';
import type { AgeGroup } from '../core/domain/taxonomy';
import { AnnouncementService } from '../core/services/announcementService';
import { PermissionPolicyService } from '../core/services/permissionPolicyService';
import { SystemClock } from '../infrastructure/clock/SystemClock';
import { envConfig } from '../infrastructure/config/envConfig';
import { IndexedDbAdminRepository } from '../infrastructure/data/IndexedDbAdminRepository';
import { IndexedDbAnnouncementRepository } from '../infrastructure/data/IndexedDbAnnouncementRepository';
import { IndexedDbBackupSnapshotProvider } from '../infrastructure/data/IndexedDbBackupSnapshotProvider';
import { IndexedDbDataStore } from '../infrastructure/data/IndexedDbDataStore';
import {
  DATABASE_MIGRATIONS,
  STAGE26_OBJECT_STORES,
  STORE_NAMES,
} from '../infrastructure/data/migrations';
import { DatabaseSeeder, INITIAL_AGE_GROUPS } from '../infrastructure/data/seed';
import { AppLogger } from '../infrastructure/logging/AppLogger';
import { BrowserSessionAnnouncementDismissStorage } from '../infrastructure/storage/BrowserSessionAnnouncementDismissStorage';
import {
  ensureStage26NewsTickerDefaultFlagAsync,
  STAGE26_NEWS_TICKER_FLAG_META_KEY,
} from '../web/services/appContainer';
import { assert, assertEqual, type UnitTestCase } from './testRunner';

class Stage26FakeClock implements IClock {
  private iso: string;
  private readonly inner = new SystemClock();

  constructor(initialIso = '2026-11-24T12:00:00.000Z') {
    this.iso = initialIso;
  }

  public setUtcIso(nextIso: string): void {
    this.iso = nextIso;
  }

  public now(): Date {
    return new Date(this.iso);
  }

  public nowUtcIso(): string {
    return this.iso;
  }

  public nowJalali(): string {
    return this.inner.toJalali(this.now());
  }

  public toJalali(date: Date): string {
    return this.inner.toJalali(date);
  }
}

async function deleteTempDatabaseAsync(dbName: string): Promise<void> {
  if (typeof indexedDB === 'undefined') {
    return;
  }
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase(dbName);
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();
    req.onblocked = () => resolve();
  });
}

class MemoryStage26AdminRepository implements IAdminRepository {
  public users: AppUser[] = [];
  public permissions: StaffPermission[] = [];
  public flags: FeatureFlag[] = [{ key: 'NewsTicker', isEnabled: true }];
  public settings: SiteSetting[] = [];
  public ageGroups: AgeGroup[] = INITIAL_AGE_GROUPS.map((g, idx) => ({
    ...g,
    id: idx + 1,
  }));

  public async getUserById(id: number): Promise<AppUser | null> {
    return this.users.find((u) => u.id === id) ?? null;
  }

  public async getUserByNormalizedEmail(
    normalizedEmail: string,
  ): Promise<AppUser | null> {
    return this.users.find((u) => u.normalizedEmail === normalizedEmail) ?? null;
  }

  public async getUserByNormalizedPhoneNumber(
    normalizedPhoneNumber: string,
  ): Promise<AppUser | null> {
    return (
      this.users.find((u) => u.normalizedPhoneNumber === normalizedPhoneNumber) ??
      null
    );
  }

  public async getAllUsers(): Promise<AppUser[]> {
    return [...this.users];
  }

  public async createUser(user: Omit<AppUser, 'id'>): Promise<AppUser> {
    const nextId = this.users.reduce((max, u) => Math.max(max, u.id), 0) + 1;
    const created: AppUser = { ...user, id: nextId };
    this.users.push(created);
    return created;
  }

  public async updateUser(user: AppUser): Promise<void> {
    const idx = this.users.findIndex((u) => u.id === user.id);
    if (idx === -1) {
      this.users.push({ ...user });
    } else {
      this.users[idx] = { ...user };
    }
  }

  public async deleteSessionsByUserId(_userId: number): Promise<void> {}

  public async getStaffPermissionsByUserId(
    userId: number,
  ): Promise<StaffPermission[]> {
    return this.permissions.filter((p) => p.userId === userId);
  }

  public async replaceStaffPermissions(
    userId: number,
    permissions: Omit<StaffPermission, 'id'>[],
  ): Promise<StaffPermission[]> {
    const created = permissions.map((p, idx) => ({
      ...p,
      id: idx + 1,
      userId,
    }));
    this.permissions = [
      ...this.permissions.filter((p) => p.userId !== userId),
      ...created,
    ];
    return created;
  }

  public async getAllFeatureFlags(): Promise<FeatureFlag[]> {
    return this.flags.map((f) => ({ ...f }));
  }

  public async upsertFeatureFlag(flag: FeatureFlag): Promise<void> {
    const idx = this.flags.findIndex((f) => f.key === flag.key);
    if (idx === -1) {
      this.flags.push({ ...flag });
    } else {
      this.flags[idx] = { ...flag };
    }
  }

  public async getAllSiteSettings(): Promise<SiteSetting[]> {
    return [...this.settings];
  }

  public async getSiteSettingByKey(key: string): Promise<SiteSetting | null> {
    return this.settings.find((s) => s.key === key) ?? null;
  }

  public async upsertSiteSettings(settings: SiteSetting[]): Promise<void> {
    for (const s of settings) {
      const idx = this.settings.findIndex((existing) => existing.key === s.key);
      if (idx === -1) {
        this.settings.push({ ...s });
      } else {
        this.settings[idx] = { ...s };
      }
    }
  }

  public async getActiveAgeGroups(): Promise<AgeGroup[]> {
    return this.ageGroups.filter((ag) => ag.isActive);
  }
}

class MemoryStage26AnnouncementRepository implements IAnnouncementRepository {
  public items: AnnouncementItem[] = [];
  private seq = 1;

  public async getAllAnnouncements(): Promise<AnnouncementItem[]> {
    return this.items.map((item) => ({ ...item }));
  }

  public async getAnnouncementById(id: number): Promise<AnnouncementItem | null> {
    const found = this.items.find((item) => item.id === id);
    return found ? { ...found } : null;
  }

  public async createAnnouncement(
    item: Omit<AnnouncementItem, 'id'>,
  ): Promise<AnnouncementItem> {
    const created: AnnouncementItem = { ...item, id: this.seq++ };
    this.items.push(created);
    return { ...created };
  }

  public async updateAnnouncement(
    item: AnnouncementItem,
  ): Promise<AnnouncementItem> {
    const idx = this.items.findIndex((existing) => existing.id === item.id);
    if (idx === -1) {
      this.items.push({ ...item });
    } else {
      this.items[idx] = { ...item };
    }
    return { ...item };
  }

  public async deleteAnnouncement(id: number): Promise<void> {
    this.items = this.items.filter((item) => item.id !== id);
  }
}

class MemoryStage26DismissStorage implements IAnnouncementDismissStorage {
  private dismissed = new Set<number>();

  public getDismissedIds(): number[] {
    return Array.from(this.dismissed);
  }

  public dismissAnnouncement(id: number): void {
    if (Number.isInteger(id) && id > 0) {
      this.dismissed.add(id);
    }
  }

  public isDismissed(id: number): boolean {
    return this.dismissed.has(id);
  }

  public clearDismissed(): void {
    this.dismissed.clear();
  }
}

async function createStage26HarnessAsync(
  initialIso = '2026-11-24T12:00:00.000Z',
  customDismissStorage?: IAnnouncementDismissStorage,
) {
  const clock = new Stage26FakeClock(initialIso);
  const logKey = `meraj_stage26_test_logs_${Date.now()}_${Math.random()
    .toString(36)
    .slice(2, 7)}`;
  const logger = new AppLogger(clock, logKey, 100);
  const adminRepository = new MemoryStage26AdminRepository();
  const announcementRepository = new MemoryStage26AnnouncementRepository();
  const dismissStorage =
    customDismissStorage ?? new MemoryStage26DismissStorage();
  const permissionPolicyService = new PermissionPolicyService(
    adminRepository,
    logger,
  );
  const service = new AnnouncementService({
    announcementRepository,
    adminRepository,
    dismissStorage,
    permissionPolicyService,
    clock,
    logger,
  });

  const superAdmin = await adminRepository.createUser({
    email: 'superadmin-s26@example.com',
    normalizedEmail: 'superadmin-s26@example.com',
    phoneNumber: null,
    normalizedPhoneNumber: null,
    displayName: 'مدیرکل تست ۲۶',
    passwordHash: 'hash',
    passwordSalt: 'salt',
    role: 'SuperAdmin',
    emailConfirmed: true,
    phoneNumberConfirmed: false,
    ageGroupId: 4,
    personalizationEnabled: true,
    mustChangePassword: false,
    isActive: true,
    isDeleted: false,
    failedLoginCount: 0,
    lockoutEnd: null,
    lastLoginAt: null,
    createdAt: clock.nowUtcIso(),
  });

  const staffAllowed = await adminRepository.createUser({
    email: 'staff-layout-s26@example.com',
    normalizedEmail: 'staff-layout-s26@example.com',
    phoneNumber: null,
    normalizedPhoneNumber: null,
    displayName: 'همکار مجاز ظاهر',
    passwordHash: 'hash',
    passwordSalt: 'salt',
    role: 'Staff',
    emailConfirmed: true,
    phoneNumberConfirmed: false,
    ageGroupId: 4,
    personalizationEnabled: true,
    mustChangePassword: false,
    isActive: true,
    isDeleted: false,
    failedLoginCount: 0,
    lockoutEnd: null,
    lastLoginAt: null,
    createdAt: clock.nowUtcIso(),
  });
  await adminRepository.replaceStaffPermissions(staffAllowed.id, [
    {
      userId: staffAllowed.id,
      permissionKey: 'layout.manage',
      grantedAt: clock.nowUtcIso(),
      grantedById: superAdmin.id,
    },
  ]);

  const staffUnauthorized = await adminRepository.createUser({
    email: 'staff-denied-s26@example.com',
    normalizedEmail: 'staff-denied-s26@example.com',
    phoneNumber: null,
    normalizedPhoneNumber: null,
    displayName: 'همکار بدون مجوز ظاهر',
    passwordHash: 'hash',
    passwordSalt: 'salt',
    role: 'Staff',
    emailConfirmed: true,
    phoneNumberConfirmed: false,
    ageGroupId: 4,
    personalizationEnabled: true,
    mustChangePassword: false,
    isActive: true,
    isDeleted: false,
    failedLoginCount: 0,
    lockoutEnd: null,
    lastLoginAt: null,
    createdAt: clock.nowUtcIso(),
  });

  const member = await adminRepository.createUser({
    email: 'member-s26@example.com',
    normalizedEmail: 'member-s26@example.com',
    phoneNumber: null,
    normalizedPhoneNumber: null,
    displayName: 'عضو عادی ۲۶',
    passwordHash: 'hash',
    passwordSalt: 'salt',
    role: 'Member',
    emailConfirmed: true,
    phoneNumberConfirmed: false,
    ageGroupId: 4,
    personalizationEnabled: true,
    mustChangePassword: false,
    isActive: true,
    isDeleted: false,
    failedLoginCount: 0,
    lockoutEnd: null,
    lastLoginAt: null,
    createdAt: clock.nowUtcIso(),
  });

  return {
    clock,
    logger,
    adminRepository,
    announcementRepository,
    dismissStorage,
    permissionPolicyService,
    service,
    superAdmin,
    staffAllowed,
    staffUnauthorized,
    member,
  };
}

export const stage26Tests: readonly UnitTestCase[] = [
  {
    id: 'stage26_time_boundary_active_window',
    nameKey: 'tests.stage26.timeBoundaryActiveWindow.name',
    descriptionKey: 'tests.stage26.timeBoundaryActiveWindow.desc',
    run: async () => {
      const h = await createStage26HarnessAsync('2026-11-24T12:00:00.000Z');
      try {
        const startsAt = '2026-11-23T12:00:00.000Z';
        const endsAt = '2026-11-25T12:00:00.000Z';

        const created = await h.service.createAnnouncementAsync(h.superAdmin, {
          text: 'ویژه‌برنامه‌ی مطالعه‌ی پاییزی از دیروز تا فردا فعال است.',
          linkUrl: '#/content',
          startsAt,
          endsAt,
          isActive: true,
          priority: 10,
        });
        assertEqual(created.ok, true, 'Creating timed announcement must succeed');
        const item = created.data!;

        // 1. Midpoint inside window -> visible & ActiveNow
        const midRes = await h.service.getActivePublicAnnouncementsAsync();
        assertEqual(midRes.enabled, true, 'NewsTicker must be enabled');
        assertEqual(
          midRes.activeAnnouncements.length,
          1,
          'Announcement must be visible between startsAt and endsAt',
        );
        assertEqual(
          h.service.computeStatus(item),
          'ActiveNow',
          'Status inside window must be ActiveNow',
        );

        // 2. Before startsAt -> hidden & Scheduled
        h.clock.setUtcIso('2026-11-23T11:59:59.000Z');
        const beforeRes = await h.service.getActivePublicAnnouncementsAsync();
        assertEqual(
          beforeRes.activeAnnouncements.length,
          0,
          'Announcement must be hidden before startsAt',
        );
        assertEqual(
          h.service.computeStatus(item),
          'Scheduled',
          'Status before startsAt must be Scheduled',
        );

        // 3. Exact startsAt boundary -> visible (inclusive startsAt <= now)
        h.clock.setUtcIso(startsAt);
        const atStartRes = await h.service.getActivePublicAnnouncementsAsync();
        assertEqual(
          atStartRes.activeAnnouncements.length,
          1,
          'Announcement must be visible at exact startsAt boundary',
        );

        // 4. Exact endsAt boundary -> expired & hidden (strict now < endsAt)
        h.clock.setUtcIso(endsAt);
        const atEndRes = await h.service.getActivePublicAnnouncementsAsync();
        assertEqual(
          atEndRes.activeAnnouncements.length,
          0,
          'Announcement must be hidden at exact endsAt boundary',
        );
        assertEqual(
          h.service.computeStatus(item),
          'Expired',
          'Status at endsAt must be Expired',
        );
      } finally {
        h.logger.clearLogs();
      }
    },
  },
  {
    id: 'stage26_priority_order_and_tie_break',
    nameKey: 'tests.stage26.priorityOrderAndTieBreak.name',
    descriptionKey: 'tests.stage26.priorityOrderAndTieBreak.desc',
    run: async () => {
      const h = await createStage26HarnessAsync('2026-11-24T12:00:00.000Z');
      try {
        const lowRes = await h.service.createAnnouncementAsync(h.superAdmin, {
          text: 'اطلاعیه اولویت ۵',
          linkUrl: '#/content',
          startsAt: '2026-11-20T00:00:00.000Z',
          endsAt: '2026-11-30T00:00:00.000Z',
          isActive: true,
          priority: '۵',
        });
        assertEqual(lowRes.ok, true, 'Persian digit priority must be accepted');
        assertEqual(lowRes.data?.priority, 5, 'Persian digits ۵ must parse to 5');

        const highRes = await h.service.createAnnouncementAsync(h.superAdmin, {
          text: 'اطلاعیه اولویت ۱۰',
          linkUrl: 'https://example.com/urgent',
          startsAt: '2026-11-20T00:00:00.000Z',
          endsAt: '2026-11-30T00:00:00.000Z',
          isActive: true,
          priority: '١٠',
        });
        assertEqual(highRes.ok, true, 'Arabic digit priority must be accepted');
        assertEqual(highRes.data?.priority, 10, 'Arabic digits ١٠ must parse to 10');

        // Disabled announcement with priority 99 must be ignored
        await h.service.createAnnouncementAsync(h.superAdmin, {
          text: 'اطلاعیه غیرفعال با اولویت ۹۹',
          startsAt: '2026-11-20T00:00:00.000Z',
          endsAt: '2026-11-30T00:00:00.000Z',
          isActive: false,
          priority: 99,
        });

        const active = await h.service.getActivePublicAnnouncementsAsync();
        assertEqual(
          active.activeAnnouncements.length,
          2,
          'Only active in-window announcements should return',
        );
        assertEqual(
          active.activeAnnouncements[0].id,
          highRes.data!.id,
          'Priority 10 must come before priority 5',
        );
        assertEqual(
          active.currentAnnouncement?.id,
          highRes.data!.id,
          'Current banner must be highest priority announcement',
        );
      } finally {
        h.logger.clearLogs();
      }
    },
  },
  {
    id: 'stage26_feature_flag_news_ticker_gate',
    nameKey: 'tests.stage26.featureFlagNewsTickerGate.name',
    descriptionKey: 'tests.stage26.featureFlagNewsTickerGate.desc',
    run: async () => {
      const h = await createStage26HarnessAsync('2026-11-24T12:00:00.000Z');
      try {
        await h.service.createAnnouncementAsync(h.superAdmin, {
          text: 'اطلاعیه آزمایشی کلید ماژول NewsTicker',
          startsAt: '2026-11-20T00:00:00.000Z',
          endsAt: '2026-11-30T00:00:00.000Z',
          isActive: true,
          priority: 10,
        });

        await h.adminRepository.upsertFeatureFlag({
          key: 'NewsTicker',
          isEnabled: false,
        });

        const disabledPublic = await h.service.getActivePublicAnnouncementsAsync();
        assertEqual(
          disabledPublic.enabled,
          false,
          'When NewsTicker flag is false, enabled must be false',
        );
        assertEqual(
          disabledPublic.activeAnnouncements.length,
          0,
          'When NewsTicker flag is false, activeAnnouncements must be empty',
        );
        assertEqual(
          disabledPublic.currentAnnouncement,
          null,
          'When NewsTicker flag is false, currentAnnouncement must be null',
        );

        await h.adminRepository.upsertFeatureFlag({
          key: 'NewsTicker',
          isEnabled: true,
        });

        const enabledBanner = await h.service.getCurrentBannerAnnouncementAsync();
        assertEqual(enabledBanner.enabled, true, 'When enabled, enabled must be true');
        assert(
          Boolean(enabledBanner.currentAnnouncement),
          'When NewsTicker flag is true, active announcement must be returned',
        );
      } finally {
        h.logger.clearLogs();
      }
    },
  },
  {
    id: 'stage26_session_dismiss_and_new_session',
    nameKey: 'tests.stage26.sessionDismissAndNewSession.name',
    descriptionKey: 'tests.stage26.sessionDismissAndNewSession.desc',
    run: async () => {
      const tempSessionKey = `meraj_s26_dismiss_test_${Date.now()}`;
      const sessionStorageImpl = new BrowserSessionAnnouncementDismissStorage(
        tempSessionKey,
      );
      const h = await createStage26HarnessAsync(
        '2026-11-24T12:00:00.000Z',
        sessionStorageImpl,
      );

      try {
        const first = await h.service.createAnnouncementAsync(h.superAdmin, {
          text: 'اطلاعیه اول با اولویت بالا',
          startsAt: '2026-11-20T00:00:00.000Z',
          endsAt: '2026-11-30T00:00:00.000Z',
          isActive: true,
          priority: 20,
        });
        const second = await h.service.createAnnouncementAsync(h.superAdmin, {
          text: 'اطلاعیه دوم با اولویت متوسط',
          startsAt: '2026-11-20T00:00:00.000Z',
          endsAt: '2026-11-30T00:00:00.000Z',
          isActive: true,
          priority: 10,
        });

        const before = await h.service.getCurrentBannerAnnouncementAsync();
        assertEqual(
          before.currentAnnouncement?.id,
          first.data!.id,
          'Top priority announcement must show before dismiss',
        );

        // Dismiss top announcement in this session
        const dismissedOk = h.service.dismissAnnouncementForSession(
          first.data!.id,
        );
        assertEqual(dismissedOk, true, 'dismissAnnouncementForSession must return true');

        const afterSameSession =
          await h.service.getCurrentBannerAnnouncementAsync();
        assertEqual(
          afterSameSession.currentAnnouncement?.id,
          second.data!.id,
          'After dismissing #1, banner must show #2 in the same session',
        );

        // Reload simulation within same sessionStorage
        const reloadedStorage = new BrowserSessionAnnouncementDismissStorage(
          tempSessionKey,
        );
        const reloadedService = new AnnouncementService({
          announcementRepository: h.announcementRepository,
          adminRepository: h.adminRepository,
          dismissStorage: reloadedStorage,
          permissionPolicyService: h.permissionPolicyService,
          clock: h.clock,
          logger: h.logger,
        });
        const afterReload =
          await reloadedService.getCurrentBannerAnnouncementAsync();
        assertEqual(
          afterReload.currentAnnouncement?.id,
          second.data!.id,
          'Dismissal must persist across reloads within the same session',
        );

        // Simulate new browser session (sessionStorage cleared)
        sessionStorageImpl.clearDismissed();
        const inNewSession =
          await reloadedService.getCurrentBannerAnnouncementAsync();
        assertEqual(
          inNewSession.currentAnnouncement?.id,
          first.data!.id,
          'New browser session must clear dismiss state and show #1 again',
        );
      } finally {
        sessionStorageImpl.clearDismissed();
        h.logger.clearLogs();
      }
    },
  },
  {
    id: 'stage26_rbac_security_validation_and_idb_v18',
    nameKey: 'tests.stage26.rbacSecurityValidationAndIdbV18.name',
    descriptionKey: 'tests.stage26.rbacSecurityValidationAndIdbV18.desc',
    run: async () => {
      const h = await createStage26HarnessAsync('2026-11-24T12:00:00.000Z');
      try {
        const validPayload = {
          text: 'اطلاعیه تست امنیتی',
          linkUrl: '#/content',
          startsAt: '2026-11-23T00:00:00.000Z',
          endsAt: '2026-11-26T00:00:00.000Z',
          isActive: true,
          priority: 1,
        };

        // 1. Guest & Member -> 404
        const guestRes = await h.service.createAnnouncementAsync(null, validPayload);
        assertEqual(guestRes.statusCode, 404, 'Guest must receive 404');

        const memberRes = await h.service.createAnnouncementAsync(
          h.member,
          validPayload,
        );
        assertEqual(memberRes.statusCode, 404, 'Member must receive 404');

        // 2. Staff without layout.manage -> 403 + WARN log
        h.logger.clearLogs();
        const deniedStaffRes = await h.service.createAnnouncementAsync(
          h.staffUnauthorized,
          validPayload,
        );
        assertEqual(
          deniedStaffRes.statusCode,
          403,
          'Staff without layout.manage must receive 403',
        );
        const warnLogs = h.logger
          .getLogs()
          .filter((entry) => entry.level === 'WARN');
        assert(
          warnLogs.length > 0,
          'Denied staff request must emit a WARN audit log',
        );

        // 3. Authorized staff -> 200
        const allowedRes = await h.service.createAnnouncementAsync(
          h.staffAllowed,
          validPayload,
        );
        assertEqual(
          allowedRes.statusCode,
          200,
          'Staff with layout.manage must be allowed',
        );

        // 4. Dangerous linkUrl checks (javascript:, data:, #/admin)
        const jsLinkRes = await h.service.createAnnouncementAsync(
          h.staffAllowed,
          { ...validPayload, linkUrl: 'javascript:alert(1)' },
        );
        assertEqual(
          jsLinkRes.statusCode,
          400,
          'javascript: link must be rejected with 400',
        );
        assertEqual(
          jsLinkRes.errorCode,
          'ANNOUNCEMENT_LINK_INVALID',
          'javascript: link must return ANNOUNCEMENT_LINK_INVALID',
        );

        const adminLinkRes = await h.service.createAnnouncementAsync(
          h.staffAllowed,
          { ...validPayload, linkUrl: '#/admin/settings' },
        );
        assertEqual(
          adminLinkRes.statusCode,
          400,
          'Public ticker must never accept #/admin links',
        );

        // 5. Inverted date range -> INVALID_DATE_RANGE
        const badRangeRes = await h.service.createAnnouncementAsync(
          h.staffAllowed,
          {
            ...validPayload,
            startsAt: '2026-11-26T00:00:00.000Z',
            endsAt: '2026-11-24T00:00:00.000Z',
          },
        );
        assertEqual(badRangeRes.statusCode, 400, 'Reversed date range must fail');
        assertEqual(
          badRangeRes.errorCode,
          'INVALID_DATE_RANGE',
          'Reversed date range must return INVALID_DATE_RANGE',
        );
      } finally {
        h.logger.clearLogs();
      }

      // 6. IndexedDB v17 -> v18 migration & full backup check
      assert(
        envConfig.stageNumber >= 26,
        `envConfig.stageNumber must be >= 26 (actual=${envConfig.stageNumber})`,
      );
      assert(
        envConfig.databaseVersion >= 18,
        `envConfig.databaseVersion must be >= 18 (actual=${envConfig.databaseVersion})`,
      );
      assert(
        DATABASE_MIGRATIONS.some((m) => m.version === 18),
        'DATABASE_MIGRATIONS must contain version 18',
      );
      assert(
        STAGE26_OBJECT_STORES.includes(STORE_NAMES.ANNOUNCEMENTS),
        'STAGE26_OBJECT_STORES must include announcements',
      );

      if (typeof indexedDB === 'undefined') {
        return;
      }

      const tempDbName = `MerajStage26_V17_To_V18_${Date.now()}`;
      const clock = new Stage26FakeClock();
      const migLogger = new AppLogger(clock, `meraj_s26_mig_${Date.now()}`, 50);

      try {
        const storeV17 = new IndexedDbDataStore(
          tempDbName,
          17,
          envConfig.metaStoreName,
        );
        await storeV17.connect();
        const seeder = new DatabaseSeeder(storeV17, migLogger);
        await seeder.seed();
        const adminBefore = new IndexedDbAdminRepository(storeV17);
        const flagBefore = (await adminBefore.getAllFeatureFlags()).find(
          (f) => f.key === 'NewsTicker',
        );
        assertEqual(
          flagBefore?.isEnabled,
          false,
          'Seed on v17 must leave NewsTicker disabled prior to v18 migration',
        );
        storeV17.close();

        const storeV18 = new IndexedDbDataStore(
          tempDbName,
          envConfig.databaseVersion,
          envConfig.metaStoreName,
        );
        try {
          await storeV18.connect();
          const storeNames = await storeV18.getObjectStoreNames();
          assert(
            storeNames.includes(STORE_NAMES.ANNOUNCEMENTS),
            'v18 migration must create announcements object store',
          );

          const adminAfter = new IndexedDbAdminRepository(storeV18);
          const flagAfter = (await adminAfter.getAllFeatureFlags()).find(
            (f) => f.key === 'NewsTicker',
          );
          assertEqual(
            flagAfter?.isEnabled,
            true,
            'Migration v18 must auto-enable NewsTicker on database upgrade',
          );

          const meta = await storeV18.getMeta(STAGE26_NEWS_TICKER_FLAG_META_KEY);
          assert(
            Boolean(meta && meta.value === '1'),
            'Migration v18 must write stage26 meta marker',
          );

          // Startup helper respects subsequent admin toggle off
          await adminAfter.upsertFeatureFlag({
            key: 'NewsTicker',
            isEnabled: false,
          });
          await ensureStage26NewsTickerDefaultFlagAsync(storeV18);
          const flagRespect = (await adminAfter.getAllFeatureFlags()).find(
            (f) => f.key === 'NewsTicker',
          );
          assertEqual(
            flagRespect?.isEnabled,
            false,
            'ensureStage26NewsTickerDefaultFlagAsync must respect admin disable',
          );

          // Test repository persistence + full snapshot inclusion
          const repo = new IndexedDbAnnouncementRepository(storeV18);
          const persisted = await repo.createAnnouncement({
            text: 'رکورد پشتیبان‌گیری مرحله ۲۶',
            linkUrl: '#/content',
            startsAt: '2026-11-23T00:00:00.000Z',
            endsAt: '2026-11-26T00:00:00.000Z',
            isActive: true,
            priority: 7,
            createdAt: clock.nowUtcIso(),
            updatedAt: clock.nowUtcIso(),
          });
          assert(persisted.id > 0, 'IndexedDB announcement record must get auto id');

          const backupProvider = new IndexedDbBackupSnapshotProvider(storeV18);
          const snapshot = await backupProvider.exportFullSnapshotAsync();
          assert(
            Array.isArray(snapshot.tables[STORE_NAMES.ANNOUNCEMENTS]) &&
              snapshot.tables[STORE_NAMES.ANNOUNCEMENTS].length === 1,
            'Full backup snapshot must include announcements table records',
          );
        } finally {
          storeV18.close();
        }
      } finally {
        migLogger.clearLogs();
        await deleteTempDatabaseAsync(tempDbName);
      }
    },
  },
];
