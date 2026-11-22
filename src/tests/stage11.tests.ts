import type { IAgePreferenceStorage } from '../core/abstractions/agePreferenceStorage';
import type { IAuthRepository, ISessionTokenStore } from '../core/abstractions/authRepository';
import type { IClock } from '../core/abstractions/IClock';
import type { IEmailSender } from '../core/abstractions/emailSender';
import type { AppUser, AuthToken, UserSession } from '../core/domain/auth';
import type { ContentItem } from '../core/domain/content';
import type { OtpCode } from '../core/domain/otp';
import type { AgeGroup } from '../core/domain/taxonomy';
import {
  AGE_COOKIE_MAX_AGE_SECONDS,
  resolveEffectiveAgeGroup,
  selectAgeGroupAsync,
  shouldShowAgeGate,
} from '../core/services/ageContextService';
import {
  applyAgeGroupRules,
  isContentAllowedForAgeGroup,
  type AgeFilterableItem,
} from '../core/services/ageRuleService';
import { AuthService } from '../core/services/authService';
import { SystemClock } from '../infrastructure/clock/SystemClock';
import { IndexedDbAuthRepository } from '../infrastructure/data/IndexedDbAuthRepository';
import { IndexedDbDataStore } from '../infrastructure/data/IndexedDbDataStore';
import { IndexedDbTaxonomyRepository } from '../infrastructure/data/IndexedDbTaxonomyRepository';
import { DatabaseSeeder, INITIAL_AGE_GROUPS } from '../infrastructure/data/seed';
import { AppLogger } from '../infrastructure/logging/AppLogger';
import { BrowserPasswordHasher } from '../infrastructure/security/BrowserPasswordHasher';
import { assert, assertEqual, type UnitTestCase } from './testRunner';

class Stage11Clock implements IClock {
  private readonly iso = '2026-11-20T12:00:00.000Z';
  private readonly inner = new SystemClock();

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

class MockAgePreferenceStorage implements IAgePreferenceStorage {
  public value: string | null = null;
  public lastMaxAgeSeconds: number | null = null;

  constructor(initialValue: string | null = null) {
    this.value = initialValue;
  }

  public getAgeKey(): string | null {
    return this.value;
  }

  public setAgeKey(ageKey: string, maxAgeSeconds = AGE_COOKIE_MAX_AGE_SECONDS): void {
    this.value = ageKey;
    this.lastMaxAgeSeconds = maxAgeSeconds;
  }

  public clearAgeKey(): void {
    this.value = null;
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

class NullEmailSender implements IEmailSender {
  public async sendAsync(): Promise<void> {}
}

class MemoryStage11AuthRepository implements IAuthRepository {
  public users: AppUser[] = [];
  public sessions: UserSession[] = [];
  public ageGroups: AgeGroup[] = INITIAL_AGE_GROUPS.map((g, idx) => ({
    ...g,
    id: idx + 1,
  }));
  private nextUserId = 10;
  private nextSessionId = 100;

  public async getUserById(id: number): Promise<AppUser | null> {
    return this.users.find((u) => u.id === id) ?? null;
  }
  public async getUserByNormalizedEmail(email: string): Promise<AppUser | null> {
    return this.users.find((u) => u.normalizedEmail === email) ?? null;
  }
  public async getUserByNormalizedPhoneNumber(phone: string): Promise<AppUser | null> {
    return this.users.find((u) => u.normalizedPhoneNumber === phone) ?? null;
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
    return { ...otp, id: 1 };
  }
  public async getOtpCodesByPhoneNumber(): Promise<OtpCode[]> {
    return [];
  }
  public async updateOtpCode(): Promise<void> {}
  public async createAuthToken(token: Omit<AuthToken, 'id'>): Promise<AuthToken> {
    return { ...token, id: 1 };
  }
  public async getAuthTokenByHash(): Promise<AuthToken | null> {
    return null;
  }
  public async updateAuthToken(): Promise<void> {}
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
    return this.ageGroups
      .filter((g) => g.isActive)
      .sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);
  }
  public async ageGroupExists(ageGroupId: number): Promise<boolean> {
    return this.ageGroups.some((g) => g.id === ageGroupId);
  }
  public async userExists(userId: number): Promise<boolean> {
    return this.users.some((u) => u.id === userId);
  }
  public async createContentItem(item: Omit<ContentItem, 'id'>): Promise<ContentItem> {
    return { ...item, id: 1 };
  }
}

function getSeededAgeGroups(): AgeGroup[] {
  return INITIAL_AGE_GROUPS.map((g, idx) => ({
    ...g,
    id: idx + 1,
  }));
}

export const stage11Tests: UnitTestCase[] = [
  {
    id: 'stage11-abc-rules-section32',
    nameKey: 'tests.stage11.abcRulesSection32.name',
    descriptionKey: 'tests.stage11.abcRulesSection32.desc',
    run: async () => {
      const groups = getSeededAgeGroups();
      const child = groups.find((g) => g.key === 'child')!;
      const teen = groups.find((g) => g.key === 'teen')!;
      const youth = groups.find((g) => g.key === 'youth')!;
      const adult = groups.find((g) => g.key === 'adult')!;

      const items: AgeFilterableItem<string>[] = [
        {
          item: 'A',
          ageGroupIds: [teen.id, youth.id],
          publishedAt: '2026-01-01T10:00:00.000Z',
          id: 1,
        },
        {
          item: 'C',
          ageGroupIds: [],
          publishedAt: '2026-01-05T10:00:00.000Z',
          id: 2,
        },
        {
          item: 'B',
          ageGroupIds: [adult.id],
          publishedAt: '2026-01-10T10:00:00.000Z',
          id: 3,
        },
      ];

      const forChild = applyAgeGroupRules(items, child);
      assertEqual(forChild.join(','), 'C', 'For child, only universal C must be visible');

      const forTeen = applyAgeGroupRules(items, teen);
      assertEqual(forTeen.join(','), 'A,C,B', 'For teen, priority order must be [A, C, B]');

      const forAdult = applyAgeGroupRules(items, adult);
      assertEqual(forAdult.join(','), 'B,C,A', 'For adult, priority order must be [B, C, A]');

      const samePriorityItems: AgeFilterableItem<string>[] = [
        {
          item: 'teen-older',
          ageGroupIds: [teen.id],
          publishedAt: '2026-01-02T10:00:00.000Z',
          id: 10,
        },
        {
          item: 'teen-newer',
          ageGroupIds: [teen.id],
          publishedAt: '2026-01-08T10:00:00.000Z',
          id: 11,
        },
      ];
      const sameTierSorted = applyAgeGroupRules(samePriorityItems, teen);
      assertEqual(
        sameTierSorted.join(','),
        'teen-newer,teen-older',
        'Within the same priority group, newest publishedAt must come first',
      );
    },
  },
  {
    id: 'stage11-child-hard-filter',
    nameKey: 'tests.stage11.childHardFilter.name',
    descriptionKey: 'tests.stage11.childHardFilter.desc',
    run: async () => {
      const groups = getSeededAgeGroups();
      const child = groups.find((g) => g.key === 'child')!;
      const teen = groups.find((g) => g.key === 'teen')!;
      const adult = groups.find((g) => g.key === 'adult')!;

      assertEqual(
        isContentAllowedForAgeGroup([adult.id], child),
        false,
        'Adult-only content must be disallowed for child',
      );
      assertEqual(
        isContentAllowedForAgeGroup([adult.id], teen),
        true,
        'Adult-only content remains allowed (lower priority) for teen',
      );
      assertEqual(
        isContentAllowedForAgeGroup([adult.id], adult),
        true,
        'Adult-only content is allowed for adult',
      );
      assertEqual(
        isContentAllowedForAgeGroup([child.id], child),
        true,
        'Child-targeted content is allowed for child',
      );
      assertEqual(
        isContentAllowedForAgeGroup([child.id, teen.id], child),
        true,
        'Shared child+teen content is allowed for child',
      );
      assertEqual(
        isContentAllowedForAgeGroup([], child),
        true,
        'Universal content ([]) is allowed for child',
      );
    },
  },
  {
    id: 'stage11-profile-overrides-cookie',
    nameKey: 'tests.stage11.profileOverridesCookie.name',
    descriptionKey: 'tests.stage11.profileOverridesCookie.desc',
    run: async () => {
      const groups = getSeededAgeGroups();
      const youth = groups.find((g) => g.key === 'youth')!;
      const storage = new MockAgePreferenceStorage('child');

      const memberWithYouth: AppUser = {
        id: 42,
        email: 'member@test.local',
        normalizedEmail: 'MEMBER@TEST.LOCAL',
        phoneNumber: null,
        normalizedPhoneNumber: null,
        displayName: 'کاربر جوان',
        role: 'Member',
        ageGroupId: youth.id,
        personalizationEnabled: false,
        emailConfirmed: true,
        phoneNumberConfirmed: false,
        mustChangePassword: false,
        isActive: true,
        failedLoginCount: 0,
        lockoutEnd: null,
        passwordHash: 'hash',
        passwordSalt: 'salt',
        createdAt: '2026-11-20T12:00:00.000Z',
        lastLoginAt: null,
      };

      const resolvedForMember = resolveEffectiveAgeGroup(memberWithYouth, groups, storage);
      assert(resolvedForMember !== null, 'Member age group must resolve');
      assertEqual(resolvedForMember!.key, 'youth', 'Profile ageGroupId must override ma_age cookie');
      assertEqual(resolvedForMember!.themeKey, 'modern', 'Youth age group theme must be modern');

      const resolvedForGuest = resolveEffectiveAgeGroup(null, groups, storage);
      assert(resolvedForGuest !== null, 'Guest falls back to cookie');
      assertEqual(resolvedForGuest!.key, 'child', 'Guest must still resolve cookie value child');
    },
  },
  {
    id: 'stage11-first-visit-cookie-persistence',
    nameKey: 'tests.stage11.firstVisitCookiePersistence.name',
    descriptionKey: 'tests.stage11.firstVisitCookiePersistence.desc',
    run: async () => {
      const groups = getSeededAgeGroups();
      const child = groups.find((g) => g.key === 'child')!;
      const storage = new MockAgePreferenceStorage(null);

      const initialResolved = resolveEffectiveAgeGroup(null, groups, storage);
      assertEqual(initialResolved, null, 'First visit without cookie or user resolves to null');

      assertEqual(shouldShowAgeGate(initialResolved, '#/'), true, 'Gate opens on public root #/');
      assertEqual(shouldShowAgeGate(initialResolved, ''), true, 'Gate opens on empty hash');
      assertEqual(shouldShowAgeGate(initialResolved, '#/admin'), false, 'Gate never opens on #/admin');
      assertEqual(
        shouldShowAgeGate(initialResolved, '#/admin/content'),
        false,
        'Gate never opens on #/admin/content',
      );
      assertEqual(
        shouldShowAgeGate(initialResolved, '#/setup/initial-admin'),
        false,
        'Gate never opens on #/setup/initial-admin',
      );
      assertEqual(
        shouldShowAgeGate(initialResolved, '#/account/change-password'),
        false,
        'Gate never opens on #/account/change-password',
      );
      assertEqual(
        shouldShowAgeGate(initialResolved, '#/account/login'),
        false,
        'Gate never opens on #/account/login',
      );
      assertEqual(
        shouldShowAgeGate(initialResolved, '#/account/register'),
        false,
        'Gate never opens on #/account/register',
      );
      assertEqual(shouldShowAgeGate(initialResolved, '#/health'), false, 'Gate never opens on #/health');

      const selected = await selectAgeGroupAsync({
        ageGroupId: child.id,
        currentUser: null,
        activeAgeGroups: groups,
        storage,
        updateUserAgeGroup: async () => {},
      });

      assertEqual(selected.ok, true, 'Selecting child group must succeed');
      assertEqual(selected.themeKey, 'playful', 'Child selection must yield playful theme');
      assertEqual(storage.getAgeKey(), 'child', 'Cookie storage must persist child key');
      assertEqual(
        storage.lastMaxAgeSeconds,
        AGE_COOKIE_MAX_AGE_SECONDS,
        'Cookie max-age must be 1 year (31536000s)',
      );

      const afterSelection = resolveEffectiveAgeGroup(null, groups, storage);
      assertEqual(afterSelection?.key, 'child', 'Subsequent resolution must return child');
      assertEqual(
        shouldShowAgeGate(afterSelection, '#/'),
        false,
        'Gate must not reopen after selection',
      );
    },
  },
  {
    id: 'stage11-header-switch-without-relogin',
    nameKey: 'tests.stage11.headerSwitchWithoutRelogin.name',
    descriptionKey: 'tests.stage11.headerSwitchWithoutRelogin.desc',
    run: async () => {
      const clock = new Stage11Clock();
      const logger = new AppLogger(clock, 'stage11_test_logs_mem', 50);
      const repo = new MemoryStage11AuthRepository();
      const hasher = new BrowserPasswordHasher();
      const sessionStore = new MemorySessionTokenStore();
      const authService = new AuthService(
        repo,
        hasher,
        new NullEmailSender(),
        clock,
        logger,
        sessionStore,
        {
          confirmSubject: 't',
          confirmBody: 'b',
          resetSubject: 't',
          resetBody: 'b',
        },
      );

      const child = repo.ageGroups.find((g) => g.key === 'child')!;
      const adult = repo.ageGroups.find((g) => g.key === 'adult')!;
      const pwd = await hasher.hashPassword('StrongPass!123');
      const createdUser = await repo.createUser({
        email: 'switch@test.local',
        normalizedEmail: 'SWITCH@TEST.LOCAL',
        phoneNumber: null,
        normalizedPhoneNumber: null,
        displayName: 'عضو تست تغییر رده',
        role: 'Member',
        ageGroupId: child.id,
        personalizationEnabled: false,
        emailConfirmed: true,
        phoneNumberConfirmed: false,
        mustChangePassword: false,
        isActive: true,
        failedLoginCount: 0,
        lockoutEnd: null,
        passwordHash: pwd.hash,
        passwordSalt: pwd.salt,
        createdAt: clock.nowUtcIso(),
        lastLoginAt: clock.nowUtcIso(),
      });

      const rawToken = hasher.generateSecureRandomToken(24);
      const tokenHash = await hasher.hashToken(rawToken);
      await repo.createSession({
        userId: createdUser.id,
        tokenHash,
        expiresAt: '2026-12-20T12:00:00.000Z',
        createdAt: clock.nowUtcIso(),
      });
      sessionStore.setRawToken(rawToken);

      const beforeSwitch = await authService.getCurrentUser();
      assert(beforeSwitch !== null, 'User session must be active before switching');
      assertEqual(beforeSwitch!.ageGroupId, child.id, 'Initial profile ageGroupId must be child');

      const storage = new MockAgePreferenceStorage('child');
      const switchResult = await selectAgeGroupAsync({
        ageGroupId: adult.id,
        currentUser: beforeSwitch,
        activeAgeGroups: repo.ageGroups,
        storage,
        updateUserAgeGroup: async (uid, gid) => {
          await authService.updateUserAgeGroup(uid, gid);
        },
      });

      assertEqual(switchResult.ok, true, 'Switching age group from header must succeed');
      assertEqual(switchResult.themeKey, 'editorial', 'Adult selection must switch theme to editorial');
      assertEqual(storage.getAgeKey(), 'adult', 'ma_age cookie must update to adult');

      const afterSwitch = await authService.getCurrentUser();
      assert(afterSwitch !== null, 'Active user session must remain intact without re-login');
      assertEqual(afterSwitch!.id, createdUser.id, 'Same user must remain logged in');
      assertEqual(afterSwitch!.ageGroupId, adult.id, 'User ageGroupId in DB must update to adult');

      if (typeof indexedDB !== 'undefined') {
        const dbName = `meraj_stage11_switch_${Date.now()}`;
        const store = new IndexedDbDataStore(dbName, 5, 'meta');
        try {
          const idbLogger = new AppLogger(clock, `stage11_idb_logs_${Date.now()}`, 50);
          const seeder = new DatabaseSeeder(store, idbLogger);
          await seeder.seed('stage11-test-seed');

          const idbRepo = new IndexedDbAuthRepository(store);
          const idbSessionStore = new MemorySessionTokenStore();
          const idbAuth = new AuthService(
            idbRepo,
            hasher,
            new NullEmailSender(),
            clock,
            idbLogger,
            idbSessionStore,
            {
              confirmSubject: 't',
              confirmBody: 'b',
              resetSubject: 't',
              resetBody: 'b',
            },
          );

          const idbGroups = await idbRepo.getActiveAgeGroups();
          const idbChild = idbGroups.find((g) => g.key === 'child')!;
          const idbAdult = idbGroups.find((g) => g.key === 'adult')!;

          const idbUser = await idbRepo.createUser({
            email: 'idb-switch@test.local',
            normalizedEmail: 'IDB-SWITCH@TEST.LOCAL',
            phoneNumber: null,
            normalizedPhoneNumber: null,
            displayName: 'کاربر تست IndexedDB',
            role: 'Member',
            ageGroupId: idbChild.id,
            personalizationEnabled: false,
            emailConfirmed: true,
            phoneNumberConfirmed: false,
            mustChangePassword: false,
            isActive: true,
            failedLoginCount: 0,
            lockoutEnd: null,
            passwordHash: pwd.hash,
            passwordSalt: pwd.salt,
            createdAt: clock.nowUtcIso(),
            lastLoginAt: clock.nowUtcIso(),
          });

          const idbRawToken = hasher.generateSecureRandomToken(24);
          const idbTokenHash = await hasher.hashToken(idbRawToken);
          await idbRepo.createSession({
            userId: idbUser.id,
            tokenHash: idbTokenHash,
            expiresAt: '2026-12-20T12:00:00.000Z',
            createdAt: clock.nowUtcIso(),
          });
          idbSessionStore.setRawToken(idbRawToken);

          const idbCookieStorage = new MockAgePreferenceStorage('child');
          const idbRes = await selectAgeGroupAsync({
            ageGroupId: idbAdult.id,
            currentUser: idbUser,
            activeAgeGroups: idbGroups,
            storage: idbCookieStorage,
            updateUserAgeGroup: async (uid, gid) => {
              await idbAuth.updateUserAgeGroup(uid, gid);
            },
          });

          assertEqual(idbRes.ok, true, 'IDB switch must succeed');
          assertEqual(idbRes.themeKey, 'editorial', 'IDB switch theme must be editorial');

          const persistedUser = await idbAuth.getCurrentUser();
          assert(persistedUser !== null, 'IDB session must remain active without re-login');
          assertEqual(
            persistedUser!.ageGroupId,
            idbAdult.id,
            'IDB user row must persist updated adult ageGroupId',
          );
        } finally {
          store.close();
          await new Promise<void>((resolve) => {
            const req = indexedDB.deleteDatabase(dbName);
            req.onsuccess = () => resolve();
            req.onerror = () => resolve();
            req.onblocked = () => resolve();
          });
        }
      }
    },
  },
  {
    id: 'stage11-live-db-age-groups',
    nameKey: 'tests.stage11.liveDbAgeGroups.name',
    descriptionKey: 'tests.stage11.liveDbAgeGroups.desc',
    run: async () => {
      const repo = new MemoryStage11AuthRepository();
      const child = repo.ageGroups.find((g) => g.key === 'child')!;
      const originalMin = child.minAge;
      child.minAge = 6;
      const updatedList = await repo.getActiveAgeGroups();
      assertEqual(
        updatedList.find((g) => g.key === 'child')?.minAge,
        6,
        'Repository must read live minAge=6 dynamically without hardcoded values',
      );
      child.minAge = originalMin;

      if (typeof indexedDB !== 'undefined') {
        const dbName = `meraj_stage11_live_${Date.now()}`;
        const store = new IndexedDbDataStore(dbName, 5, 'meta');
        try {
          const clock = new Stage11Clock();
          const logger = new AppLogger(clock, `stage11_live_logs_${Date.now()}`, 50);
          const seeder = new DatabaseSeeder(store, logger);
          await seeder.seed('stage11-live-seed');

          const authRepo = new IndexedDbAuthRepository(store);
          const taxonomyRepo = new IndexedDbTaxonomyRepository(store);

          const before = await authRepo.getActiveAgeGroups();
          const idbChild = before.find((g) => g.key === 'child')!;
          assertEqual(idbChild.minAge, 7, 'Seeded child minAge starts at 7');

          await taxonomyRepo.updateAgeGroup({
            ...idbChild,
            minAge: 6,
            maxAge: 11,
          });

          const afterUpdate = await authRepo.getActiveAgeGroups();
          const refreshedChild = afterUpdate.find((g) => g.key === 'child')!;
          assertEqual(
            refreshedChild.minAge,
            6,
            'IndexedDbAuthRepository must immediately reflect minAge=6 from DB',
          );

          await taxonomyRepo.updateAgeGroup({
            ...refreshedChild,
            minAge: 7,
            maxAge: 11,
          });

          const restored = await authRepo.getActiveAgeGroups();
          assertEqual(
            restored.find((g) => g.key === 'child')?.minAge,
            7,
            'Restored child minAge must return to 7',
          );
        } finally {
          store.close();
          await new Promise<void>((resolve) => {
            const req = indexedDB.deleteDatabase(dbName);
            req.onsuccess = () => resolve();
            req.onerror = () => resolve();
            req.onblocked = () => resolve();
          });
        }
      }
    },
  },
];
