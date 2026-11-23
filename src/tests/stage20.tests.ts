import type { IClock } from '../core/abstractions/IClock';
import type { IAdminRepository } from '../core/abstractions/adminRepository';
import type { IGuestAffinityStorage } from '../core/abstractions/affinityStorage';
import type { IAuthRepository, ISessionTokenStore } from '../core/abstractions/authRepository';
import type { IContentRepository } from '../core/abstractions/contentRepository';
import type { IDownloadEventRepository } from '../core/abstractions/downloadRepository';
import type { IEmailSender } from '../core/abstractions/emailSender';
import type {
  IAccountCleanupRepository,
  IInteractionRepository,
} from '../core/abstractions/interactionRepository';
import type { ILayoutRepository } from '../core/abstractions/layoutRepository';
import type { IUserTopicAffinityRepository } from '../core/abstractions/personalizationService';
import type { ISmsSender } from '../core/abstractions/smsSender';
import type { ITaxonomyRepository } from '../core/abstractions/taxonomyRepository';
import type { IViewEventRepository } from '../core/abstractions/viewTracker';
import type { DownloadEvent, ViewEvent } from '../core/domain/analytics';
import type { AppUser, AuthToken, UserSession } from '../core/domain/auth';
import {
  ContentStatus,
  type ContentAgeGroup,
  type ContentFile,
  type ContentItem,
  type ContentPerson,
  type ContentSource,
  type ContentTag,
  type ContentTopic,
} from '../core/domain/content';
import type { ContentBookmark, ContentLike } from '../core/domain/interactions';
import type { HeroSlide, HomeShelf, StaticPage } from '../core/domain/layout';
import type { OtpCode } from '../core/domain/otp';
import type { StaffPermission } from '../core/domain/permissions';
import type {
  GuestTopicAffinityEntry,
  UserTopicAffinity,
} from '../core/domain/personalization';
import {
  FEATURE_FLAG_KEYS,
  type FeatureFlag,
  type SiteSetting,
} from '../core/domain/settings';
import type {
  AgeGroup,
  ImpactLevel,
  Person,
  Tag,
  Topic,
} from '../core/domain/taxonomy';
import { AuthService } from '../core/services/authService';
import { HomePageService } from '../core/services/homePageService';
import { OtpService } from '../core/services/otpService';
import { PermissionPolicyService } from '../core/services/permissionPolicyService';
import { PersonalizationService } from '../core/services/personalizationService';
import { ProfileService } from '../core/services/profileService';
import { RateLimiter } from '../core/services/rateLimiter';
import { SettingsManagementService } from '../core/services/settingsManagementService';
import { ViewTrackerService } from '../core/services/viewTrackerService';
import { SystemClock } from '../infrastructure/clock/SystemClock';
import { envConfig } from '../infrastructure/config/envConfig';
import { IndexedDbAccountCleanupRepository } from '../infrastructure/data/IndexedDbAccountCleanupRepository';
import { IndexedDbDataStore } from '../infrastructure/data/IndexedDbDataStore';
import { IndexedDbUserTopicAffinityRepository } from '../infrastructure/data/IndexedDbUserTopicAffinityRepository';
import {
  DATABASE_MIGRATIONS,
  STAGE20_OBJECT_STORES,
  STORE_NAMES,
} from '../infrastructure/data/migrations';
import { INITIAL_AGE_GROUPS } from '../infrastructure/data/seed';
import { AppLogger } from '../infrastructure/logging/AppLogger';
import { BrowserPasswordHasher } from '../infrastructure/security/BrowserPasswordHasher';
import { BrowserAffinityCookieStorage } from '../infrastructure/storage/BrowserAffinityCookieStorage';
import { assert, assertEqual, type UnitTestCase } from './testRunner';

class Stage20FakeClock implements IClock {
  private currentMs: number;
  private readonly inner = new SystemClock();

  constructor(initialIso = '2026-11-23T10:00:00.000Z') {
    this.currentMs = Date.parse(initialIso);
  }

  public setUtcIso(iso: string): void {
    this.currentMs = Date.parse(iso);
  }

  public advanceMinutes(minutes: number): void {
    this.currentMs += minutes * 60 * 1000;
  }

  public now(): Date {
    return new Date(this.currentMs);
  }

  public nowUtcIso(): string {
    return new Date(this.currentMs).toISOString();
  }

  public nowJalali(): string {
    return this.inner.toJalali(this.now());
  }

  public toJalali(date: Date): string {
    return this.inner.toJalali(date);
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

class MemoryNullEmailSender implements IEmailSender {
  public async sendAsync(): Promise<void> {
    // No-op in test
  }
}

class MemoryCapturingSmsSender implements ISmsSender {
  public lastCode = '';

  public async sendOtpAsync(
    _phoneNumber: string,
    code: string,
    _message: string,
  ): Promise<void> {
    this.lastCode = code;
  }
}

class MemoryGuestAffinityStorage implements IGuestAffinityStorage {
  private entries: GuestTopicAffinityEntry[] = [];
  private enabled = true;

  public getGuestAffinities(): GuestTopicAffinityEntry[] {
    return this.entries.map((entry) => ({ ...entry }));
  }

  public setGuestAffinities(entries: readonly GuestTopicAffinityEntry[]): void {
    this.entries = entries
      .filter((item) => item.rootTopicId > 0 && item.viewCount > 0)
      .map((item) => ({ ...item }))
      .sort(
        (a, b) =>
          b.viewCount - a.viewCount ||
          b.lastViewedAt.localeCompare(a.lastViewedAt) ||
          a.rootTopicId - b.rootTopicId,
      )
      .slice(0, 20);
  }

  public clearGuestAffinities(): void {
    this.entries = [];
  }

  public getGuestPersonalizationEnabled(): boolean {
    return this.enabled;
  }

  public setGuestPersonalizationEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  public clearGuestPersonalizationPreference(): void {
    this.enabled = true;
  }
}

class Stage20MemoryHarness
  implements
    IUserTopicAffinityRepository,
    IAuthRepository,
    IAdminRepository,
    IContentRepository,
    ITaxonomyRepository,
    IViewEventRepository,
    IDownloadEventRepository,
    ILayoutRepository,
    IInteractionRepository
{
  private affinities = new Map<string, UserTopicAffinity>();
  private users: AppUser[] = [];
  private otpCodes: OtpCode[] = [];
  private authTokens: AuthToken[] = [];
  private sessions: UserSession[] = [];
  private staffPermissions: StaffPermission[] = [];
  private featureFlags: FeatureFlag[] = FEATURE_FLAG_KEYS.map((key) => ({
    key,
    isEnabled: false,
  }));
  private siteSettings: SiteSetting[] = [
    { key: 'Personalization.DefaultEnabled', value: '1' },
    { key: 'Personalization.MinViews', value: '3' },
    { key: 'Home.ItemsPerShelf', value: '12' },
  ];

  private ageGroups: AgeGroup[] = INITIAL_AGE_GROUPS.map((g, idx) => ({
    ...g,
    id: idx + 1,
  }));
  private topics: Topic[] = [];
  private tags: Tag[] = [];
  private persons: Person[] = [];
  private impactLevels: ImpactLevel[] = [{ id: 1, name: 'عادی', sortOrder: 1 }];

  private items: ContentItem[] = [];
  private sources: ContentSource[] = [];
  private files: ContentFile[] = [];
  private contentTopics: ContentTopic[] = [];
  private contentTags: ContentTag[] = [];
  private contentPersons: ContentPerson[] = [];
  private contentAgeGroups: ContentAgeGroup[] = [];

  private viewEvents: ViewEvent[] = [];
  private downloadEvents: DownloadEvent[] = [];
  private likes: ContentLike[] = [];
  private bookmarks: ContentBookmark[] = [];

  private heroSlides: HeroSlide[] = [];
  private homeShelves: HomeShelf[] = [
    {
      id: 1,
      title: 'پیشنهادهای شما',
      type: 'Personalized',
      topicId: null,
      sortOrder: 1,
      isVisible: true,
    },
    {
      id: 2,
      title: 'تازه‌ترین‌ها',
      type: 'Latest',
      topicId: null,
      sortOrder: 2,
      isVisible: true,
    },
  ];
  private staticPages: StaticPage[] = [];

  private userSeq = 1;
  private otpSeq = 1;
  private tokenSeq = 1;
  private sessionSeq = 1;
  private topicSeq = 1;
  private tagSeq = 1;
  private personSeq = 1;
  private impactSeq = 10;
  private contentSeq = 1;
  private sourceSeq = 1;
  private fileSeq = 1;
  private viewSeq = 1;
  private downloadSeq = 1;
  private slideSeq = 1;
  private shelfSeq = 10;
  private pageSeq = 1;
  private permSeq = 1;

  private affinityKey(userId: number, rootTopicId: number): string {
    return `${userId}:${rootTopicId}`;
  }

  public addTopicSeed(name: string, parentId: number | null = null): Topic {
    const id = this.topicSeq++;
    const topic: Topic = {
      id,
      parentId,
      name,
      slug: `topic-${id}`,
      icon: null,
      sortOrder: id,
      isActive: true,
    };
    this.topics.push(topic);
    return topic;
  }

  public async seedPublishedContent(input: {
    title: string;
    topicIds: number[];
    ageGroupIds: number[];
    publishedAt: string;
  }): Promise<ContentItem> {
    const item = await this.createContentItem({
      title: input.title,
      slug: `content-${this.contentSeq}`,
      format: 'Article',
      summary: input.title,
      body: input.title,
      thumbnailKey: null,
      readWatchMinutes: 5,
      impactLevelId: null,
      status: ContentStatus.Published,
      isFeatured: false,
      languageCode: 'fa',
      searchText: input.title,
      viewCount: 0,
      downloadCount: 0,
      likeCount: 0,
      createdById: 1,
      publishedAt: input.publishedAt,
      createdAt: input.publishedAt,
      updatedAt: input.publishedAt,
    });
    await this.replaceContentTopics(item.id, input.topicIds);
    await this.replaceContentAgeGroups(item.id, input.ageGroupIds);
    return item;
  }

  public async setSiteSetting(key: string, value: string): Promise<void> {
    await this.upsertSiteSettings([{ key, value }]);
  }

  // IUserTopicAffinityRepository
  public async getAffinity(
    userId: number,
    rootTopicId: number,
  ): Promise<UserTopicAffinity | null> {
    const item = this.affinities.get(this.affinityKey(userId, rootTopicId));
    return item ? { ...item } : null;
  }

  public async getAffinitiesByUserId(userId: number): Promise<UserTopicAffinity[]> {
    return Array.from(this.affinities.values())
      .filter((item) => item.userId === userId)
      .map((item) => ({ ...item }));
  }

  public async upsertAffinity(affinity: UserTopicAffinity): Promise<void> {
    this.affinities.set(
      this.affinityKey(affinity.userId, affinity.rootTopicId),
      { ...affinity },
    );
  }

  public async deleteAffinitiesByUserId(userId: number): Promise<number> {
    let deleted = 0;
    for (const [key, value] of this.affinities.entries()) {
      if (value.userId === userId) {
        this.affinities.delete(key);
        deleted += 1;
      }
    }
    return deleted;
  }

  // IAuthRepository & IAdminRepository
  public async getUserById(id: number): Promise<AppUser | null> {
    const found = this.users.find((u) => u.id === id);
    return found ? { ...found } : null;
  }

  public async getUserByNormalizedEmail(normalizedEmail: string): Promise<AppUser | null> {
    const found = this.users.find((u) => u.normalizedEmail === normalizedEmail);
    return found ? { ...found } : null;
  }

  public async getUserByNormalizedPhoneNumber(
    normalizedPhoneNumber: string,
  ): Promise<AppUser | null> {
    const found = this.users.find(
      (u) => u.normalizedPhoneNumber === normalizedPhoneNumber,
    );
    return found ? { ...found } : null;
  }

  public async getAllUsers(): Promise<AppUser[]> {
    return this.users.map((u) => ({ ...u }));
  }

  public async countUsers(): Promise<number> {
    return this.users.length;
  }

  public async hasAnySuperAdmin(): Promise<boolean> {
    return this.users.some((u) => u.role === 'SuperAdmin' && !u.isDeleted);
  }

  public async createUser(user: Omit<AppUser, 'id'>): Promise<AppUser> {
    const created: AppUser = { ...user, id: this.userSeq++ };
    this.users.push(created);
    return { ...created };
  }

  public async updateUser(user: AppUser): Promise<void> {
    const idx = this.users.findIndex((u) => u.id === user.id);
    if (idx !== -1) {
      this.users[idx] = { ...user };
    }
  }

  public async createOtpCode(otp: Omit<OtpCode, 'id'>): Promise<OtpCode> {
    const created: OtpCode = { ...otp, id: this.otpSeq++ };
    this.otpCodes.push(created);
    return { ...created };
  }

  public async getOtpCodesByPhoneNumber(phoneNumber: string): Promise<OtpCode[]> {
    return this.otpCodes.filter((o) => o.phoneNumber === phoneNumber).map((o) => ({ ...o }));
  }

  public async updateOtpCode(otp: OtpCode): Promise<void> {
    const idx = this.otpCodes.findIndex((o) => o.id === otp.id);
    if (idx !== -1) {
      this.otpCodes[idx] = { ...otp };
    }
  }

  public async createAuthToken(token: Omit<AuthToken, 'id'>): Promise<AuthToken> {
    const created: AuthToken = { ...token, id: this.tokenSeq++ };
    this.authTokens.push(created);
    return { ...created };
  }

  public async getAuthTokenByHash(tokenHash: string): Promise<AuthToken | null> {
    const found = this.authTokens.find((t) => t.tokenHash === tokenHash);
    return found ? { ...found } : null;
  }

  public async updateAuthToken(token: AuthToken): Promise<void> {
    const idx = this.authTokens.findIndex((t) => t.id === token.id);
    if (idx !== -1) {
      this.authTokens[idx] = { ...token };
    }
  }

  public async createSession(session: Omit<UserSession, 'id'>): Promise<UserSession> {
    const created: UserSession = { ...session, id: this.sessionSeq++ };
    this.sessions.push(created);
    return { ...created };
  }

  public async getSessionByTokenHash(tokenHash: string): Promise<UserSession | null> {
    const found = this.sessions.find((s) => s.tokenHash === tokenHash);
    return found ? { ...found } : null;
  }

  public async deleteSessionByTokenHash(tokenHash: string): Promise<void> {
    this.sessions = this.sessions.filter((s) => s.tokenHash !== tokenHash);
  }

  public async deleteSessionsByUserId(userId: number): Promise<void> {
    this.sessions = this.sessions.filter((s) => s.userId !== userId);
  }

  public createCleanupAdapter(): IAccountCleanupRepository {
    return {
      deleteSessionsByUserId: async (userId: number) => {
        const before = this.sessions.length;
        this.sessions = this.sessions.filter((s) => s.userId !== userId);
        return before - this.sessions.length;
      },
      deleteAuthTokensByUserId: (userId) => this.deleteAuthTokensByUserId(userId),
      deleteOtpCodesByPhoneNumber: (phone) => this.deleteOtpCodesByPhoneNumber(phone),
      anonymizeViewEventsByUserId: (userId) => this.anonymizeViewEventsByUserId(userId),
      anonymizeDownloadEventsByUserId: (userId) =>
        this.anonymizeDownloadEventsByUserId(userId),
      anonymizeOptionalCommentsByUserId: () =>
        this.anonymizeOptionalCommentsByUserId(),
      deleteOptionalTopicAffinitiesByUserId: (userId) =>
        this.deleteOptionalTopicAffinitiesByUserId(userId),
    };
  }

  public async getActiveAgeGroups(): Promise<AgeGroup[]> {
    return this.ageGroups.filter((a) => a.isActive).map((a) => ({ ...a }));
  }

  public async ageGroupExists(ageGroupId: number): Promise<boolean> {
    return this.ageGroups.some((a) => a.id === ageGroupId);
  }

  public async userExists(userId: number): Promise<boolean> {
    return this.users.some((u) => u.id === userId && !u.isDeleted);
  }

  public async getStaffPermissionsByUserId(userId: number): Promise<StaffPermission[]> {
    return this.staffPermissions
      .filter((p) => p.userId === userId)
      .map((p) => ({ ...p }));
  }

  public async replaceStaffPermissions(
    userId: number,
    permissions: Omit<StaffPermission, 'id'>[],
  ): Promise<StaffPermission[]> {
    this.staffPermissions = this.staffPermissions.filter((p) => p.userId !== userId);
    const created = permissions.map((p) => ({ ...p, id: this.permSeq++ }));
    this.staffPermissions.push(...created);
    return created.map((p) => ({ ...p }));
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
    for (const s of settings) {
      const idx = this.siteSettings.findIndex((existing) => existing.key === s.key);
      if (idx === -1) {
        this.siteSettings.push({ ...s });
      } else {
        this.siteSettings[idx] = { ...s };
      }
    }
  }

  // IContentRepository
  public async getAllContentItems(): Promise<ContentItem[]> {
    return this.items.map((item) => ({ ...item }));
  }

  public async getContentItemById(id: number): Promise<ContentItem | null> {
    const found = this.items.find((item) => item.id === id);
    return found ? { ...found } : null;
  }

  public async getContentItemBySlug(slug: string): Promise<ContentItem | null> {
    const found = this.items.find((item) => item.slug === slug);
    return found ? { ...found } : null;
  }

  public async createContentItem(item: Omit<ContentItem, 'id'>): Promise<ContentItem> {
    const created: ContentItem = { ...item, id: this.contentSeq++ };
    this.items.push(created);
    return { ...created };
  }

  public async updateContentItem(item: ContentItem): Promise<void> {
    const idx = this.items.findIndex((i) => i.id === item.id);
    if (idx !== -1) {
      this.items[idx] = { ...item };
    }
  }

  public async getSourcesByContentId(contentId: number): Promise<ContentSource[]> {
    return this.sources.filter((s) => s.contentId === contentId).map((s) => ({ ...s }));
  }

  public async getAllSources(): Promise<ContentSource[]> {
    return this.sources.map((s) => ({ ...s }));
  }

  public async replaceSources(
    contentId: number,
    sources: Omit<ContentSource, 'id'>[],
  ): Promise<ContentSource[]> {
    this.sources = this.sources.filter((s) => s.contentId !== contentId);
    const created = sources.map((s) => ({ ...s, id: this.sourceSeq++ }));
    this.sources.push(...created);
    return created.map((s) => ({ ...s }));
  }

  public async getFilesByContentId(contentId: number): Promise<ContentFile[]> {
    return this.files.filter((f) => f.contentId === contentId).map((f) => ({ ...f }));
  }

  public async getAllFiles(): Promise<ContentFile[]> {
    return this.files.map((f) => ({ ...f }));
  }

  public async replaceFiles(
    contentId: number,
    files: Omit<ContentFile, 'id'>[],
  ): Promise<ContentFile[]> {
    this.files = this.files.filter((f) => f.contentId !== contentId);
    const created = files.map((f) => ({ ...f, id: this.fileSeq++ }));
    this.files.push(...created);
    return created.map((f) => ({ ...f }));
  }

  public async getTopicIdsByContentId(contentId: number): Promise<number[]> {
    return this.contentTopics.filter((t) => t.contentId === contentId).map((t) => t.topicId);
  }

  public async getAllContentTopics(): Promise<ContentTopic[]> {
    return this.contentTopics.map((t) => ({ ...t }));
  }

  public async replaceContentTopics(contentId: number, topicIds: number[]): Promise<void> {
    this.contentTopics = this.contentTopics.filter((t) => t.contentId !== contentId);
    for (const topicId of topicIds) {
      this.contentTopics.push({ contentId, topicId });
    }
  }

  public async getTagIdsByContentId(contentId: number): Promise<number[]> {
    return this.contentTags.filter((t) => t.contentId === contentId).map((t) => t.tagId);
  }

  public async getAllContentTags(): Promise<ContentTag[]> {
    return this.contentTags.map((t) => ({ ...t }));
  }

  public async replaceContentTags(contentId: number, tagIds: number[]): Promise<void> {
    this.contentTags = this.contentTags.filter((t) => t.contentId !== contentId);
    for (const tagId of tagIds) {
      this.contentTags.push({ contentId, tagId });
    }
  }

  public async getPersonIdsByContentId(contentId: number): Promise<number[]> {
    return this.contentPersons.filter((p) => p.contentId === contentId).map((p) => p.personId);
  }

  public async getAllContentPersons(): Promise<ContentPerson[]> {
    return this.contentPersons.map((p) => ({ ...p }));
  }

  public async replaceContentPersons(contentId: number, personIds: number[]): Promise<void> {
    this.contentPersons = this.contentPersons.filter((p) => p.contentId !== contentId);
    for (const personId of personIds) {
      this.contentPersons.push({ contentId, personId });
    }
  }

  public async getAgeGroupIdsByContentId(contentId: number): Promise<number[]> {
    return this.contentAgeGroups
      .filter((a) => a.contentId === contentId)
      .map((a) => a.ageGroupId);
  }

  public async getAllContentAgeGroups(): Promise<ContentAgeGroup[]> {
    return this.contentAgeGroups.map((a) => ({ ...a }));
  }

  public async replaceContentAgeGroups(
    contentId: number,
    ageGroupIds: number[],
  ): Promise<void> {
    this.contentAgeGroups = this.contentAgeGroups.filter((a) => a.contentId !== contentId);
    for (const ageGroupId of ageGroupIds) {
      this.contentAgeGroups.push({ contentId, ageGroupId });
    }
  }

  // ITaxonomyRepository
  public async getAllTopics(): Promise<Topic[]> {
    return this.topics.map((t) => ({ ...t }));
  }

  public async getTopicById(id: number): Promise<Topic | null> {
    const found = this.topics.find((t) => t.id === id);
    return found ? { ...found } : null;
  }

  public async createTopic(topic: Omit<Topic, 'id'>): Promise<Topic> {
    const created: Topic = { ...topic, id: this.topicSeq++ };
    this.topics.push(created);
    return { ...created };
  }

  public async updateTopic(topic: Topic): Promise<void> {
    const idx = this.topics.findIndex((t) => t.id === topic.id);
    if (idx !== -1) {
      this.topics[idx] = { ...topic };
    }
  }

  public async deleteTopic(id: number): Promise<void> {
    this.topics = this.topics.filter((t) => t.id !== id);
  }

  public async getAllTags(): Promise<Tag[]> {
    return this.tags.map((t) => ({ ...t }));
  }

  public async getTagById(id: number): Promise<Tag | null> {
    const found = this.tags.find((t) => t.id === id);
    return found ? { ...found } : null;
  }

  public async createTag(tag: Omit<Tag, 'id'>): Promise<Tag> {
    const created: Tag = { ...tag, id: this.tagSeq++ };
    this.tags.push(created);
    return { ...created };
  }

  public async updateTag(tag: Tag): Promise<void> {
    const idx = this.tags.findIndex((t) => t.id === tag.id);
    if (idx !== -1) {
      this.tags[idx] = { ...tag };
    }
  }

  public async deleteTag(id: number): Promise<void> {
    this.tags = this.tags.filter((t) => t.id !== id);
  }

  public async getAllPersons(): Promise<Person[]> {
    return this.persons.map((p) => ({ ...p }));
  }

  public async getPersonById(id: number): Promise<Person | null> {
    const found = this.persons.find((p) => p.id === id);
    return found ? { ...found } : null;
  }

  public async createPerson(person: Omit<Person, 'id'>): Promise<Person> {
    const created: Person = { ...person, id: this.personSeq++ };
    this.persons.push(created);
    return { ...created };
  }

  public async updatePerson(person: Person): Promise<void> {
    const idx = this.persons.findIndex((p) => p.id === person.id);
    if (idx !== -1) {
      this.persons[idx] = { ...person };
    }
  }

  public async deletePerson(id: number): Promise<void> {
    this.persons = this.persons.filter((p) => p.id !== id);
  }

  public async getAllImpactLevels(): Promise<ImpactLevel[]> {
    return this.impactLevels.map((i) => ({ ...i }));
  }

  public async getImpactLevelById(id: number): Promise<ImpactLevel | null> {
    const found = this.impactLevels.find((i) => i.id === id);
    return found ? { ...found } : null;
  }

  public async createImpactLevel(level: Omit<ImpactLevel, 'id'>): Promise<ImpactLevel> {
    const created: ImpactLevel = { ...level, id: this.impactSeq++ };
    this.impactLevels.push(created);
    return { ...created };
  }

  public async updateImpactLevel(level: ImpactLevel): Promise<void> {
    const idx = this.impactLevels.findIndex((i) => i.id === level.id);
    if (idx !== -1) {
      this.impactLevels[idx] = { ...level };
    }
  }

  public async deleteImpactLevel(id: number): Promise<void> {
    this.impactLevels = this.impactLevels.filter((i) => i.id !== id);
  }

  public async getAllAgeGroups(): Promise<AgeGroup[]> {
    return this.ageGroups.map((a) => ({ ...a }));
  }

  public async getAgeGroupById(id: number): Promise<AgeGroup | null> {
    const found = this.ageGroups.find((a) => a.id === id);
    return found ? { ...found } : null;
  }

  public async updateAgeGroup(group: AgeGroup): Promise<void> {
    const idx = this.ageGroups.findIndex((a) => a.id === group.id);
    if (idx !== -1) {
      this.ageGroups[idx] = { ...group };
    }
  }

  public async getContentTopicLinks(): Promise<ContentTopic[]> {
    return this.contentTopics.map((ct) => ({ ...ct }));
  }

  public async countContentTagsByTagId(tagId: number): Promise<number> {
    return this.contentTags.filter((ct) => ct.tagId === tagId).length;
  }

  public async countContentPersonsByPersonId(personId: number): Promise<number> {
    return this.contentPersons.filter((cp) => cp.personId === personId).length;
  }

  public async countContentItemsByImpactLevelId(impactLevelId: number): Promise<number> {
    return this.items.filter((i) => i.impactLevelId === impactLevelId).length;
  }

  public async linkContentTopic(contentId: number, topicId: number): Promise<void> {
    this.contentTopics.push({ contentId, topicId });
  }

  // IViewEventRepository
  public async createViewEvent(event: Omit<ViewEvent, 'id'>): Promise<ViewEvent> {
    const created: ViewEvent = { ...event, id: this.viewSeq++ };
    this.viewEvents.push(created);
    return { ...created };
  }

  public async getViewEventsByContentId(contentId: number): Promise<ViewEvent[]> {
    return this.viewEvents.filter((v) => v.contentId === contentId).map((v) => ({ ...v }));
  }

  public async getAllViewEvents(): Promise<ViewEvent[]> {
    return this.viewEvents.map((v) => ({ ...v }));
  }

  // IDownloadEventRepository
  public async createDownloadEvent(
    event: Omit<DownloadEvent, 'id'>,
  ): Promise<DownloadEvent> {
    const created: DownloadEvent = { ...event, id: this.downloadSeq++ };
    this.downloadEvents.push(created);
    return { ...created };
  }

  public async getDownloadEventsByContentId(contentId: number): Promise<DownloadEvent[]> {
    return this.downloadEvents
      .filter((d) => d.contentId === contentId)
      .map((d) => ({ ...d }));
  }

  public async getDownloadEventsByUserId(userId: number): Promise<DownloadEvent[]> {
    return this.downloadEvents.filter((d) => d.userId === userId).map((d) => ({ ...d }));
  }

  public async getAllDownloadEvents(): Promise<DownloadEvent[]> {
    return this.downloadEvents.map((d) => ({ ...d }));
  }

  // ILayoutRepository
  public async getAllHeroSlides(): Promise<HeroSlide[]> {
    return this.heroSlides.map((s) => ({ ...s }));
  }

  public async getHeroSlideById(id: number): Promise<HeroSlide | null> {
    const found = this.heroSlides.find((s) => s.id === id);
    return found ? { ...found } : null;
  }

  public async createHeroSlide(slide: Omit<HeroSlide, 'id'>): Promise<HeroSlide> {
    const created: HeroSlide = { ...slide, id: this.slideSeq++ };
    this.heroSlides.push(created);
    return { ...created };
  }

  public async updateHeroSlide(slide: HeroSlide): Promise<HeroSlide> {
    const idx = this.heroSlides.findIndex((s) => s.id === slide.id);
    if (idx !== -1) {
      this.heroSlides[idx] = { ...slide };
    }
    return { ...slide };
  }

  public async deleteHeroSlide(id: number): Promise<void> {
    this.heroSlides = this.heroSlides.filter((s) => s.id !== id);
  }

  public async getAllHomeShelves(): Promise<HomeShelf[]> {
    return this.homeShelves.map((s) => ({ ...s }));
  }

  public async getHomeShelfById(id: number): Promise<HomeShelf | null> {
    const found = this.homeShelves.find((s) => s.id === id);
    return found ? { ...found } : null;
  }

  public async createHomeShelf(shelf: Omit<HomeShelf, 'id'>): Promise<HomeShelf> {
    const created: HomeShelf = { ...shelf, id: this.shelfSeq++ };
    this.homeShelves.push(created);
    return { ...created };
  }

  public async updateHomeShelf(shelf: HomeShelf): Promise<HomeShelf> {
    const idx = this.homeShelves.findIndex((s) => s.id === shelf.id);
    if (idx !== -1) {
      this.homeShelves[idx] = { ...shelf };
    }
    return { ...shelf };
  }

  public async deleteHomeShelf(id: number): Promise<void> {
    this.homeShelves = this.homeShelves.filter((s) => s.id !== id);
  }

  public async getAllStaticPages(): Promise<StaticPage[]> {
    return this.staticPages.map((p) => ({ ...p }));
  }

  public async getStaticPageById(id: number): Promise<StaticPage | null> {
    const found = this.staticPages.find((p) => p.id === id);
    return found ? { ...found } : null;
  }

  public async getStaticPageBySlug(slug: string): Promise<StaticPage | null> {
    const found = this.staticPages.find((p) => p.slug === slug);
    return found ? { ...found } : null;
  }

  public async createStaticPage(page: Omit<StaticPage, 'id'>): Promise<StaticPage> {
    const created: StaticPage = { ...page, id: this.pageSeq++ };
    this.staticPages.push(created);
    return { ...created };
  }

  public async updateStaticPage(page: StaticPage): Promise<StaticPage> {
    const idx = this.staticPages.findIndex((p) => p.id === page.id);
    if (idx !== -1) {
      this.staticPages[idx] = { ...page };
    }
    return { ...page };
  }

  public async deleteStaticPage(id: number): Promise<void> {
    this.staticPages = this.staticPages.filter((p) => p.id !== id);
  }

  // IInteractionRepository
  public async getLike(userId: number, contentId: number): Promise<ContentLike | null> {
    return (
      this.likes.find((l) => l.userId === userId && l.contentId === contentId) ?? null
    );
  }

  public async createLike(like: ContentLike): Promise<boolean> {
    this.likes.push({ ...like });
    return true;
  }

  public async deleteLike(userId: number, contentId: number): Promise<boolean> {
    const before = this.likes.length;
    this.likes = this.likes.filter(
      (l) => !(l.userId === userId && l.contentId === contentId),
    );
    return this.likes.length < before;
  }

  public async getLikesByUserId(userId: number): Promise<ContentLike[]> {
    return this.likes.filter((l) => l.userId === userId).map((l) => ({ ...l }));
  }

  public async getLikesByContentId(contentId: number): Promise<ContentLike[]> {
    return this.likes.filter((l) => l.contentId === contentId).map((l) => ({ ...l }));
  }

  public async countLikesByContentId(contentId: number): Promise<number> {
    return this.likes.filter((l) => l.contentId === contentId).length;
  }

  public async getBookmark(
    userId: number,
    contentId: number,
  ): Promise<ContentBookmark | null> {
    return (
      this.bookmarks.find((b) => b.userId === userId && b.contentId === contentId) ??
      null
    );
  }

  public async createBookmark(bookmark: ContentBookmark): Promise<boolean> {
    this.bookmarks.push({ ...bookmark });
    return true;
  }

  public async deleteBookmark(userId: number, contentId: number): Promise<boolean> {
    const before = this.bookmarks.length;
    this.bookmarks = this.bookmarks.filter(
      (b) => !(b.userId === userId && b.contentId === contentId),
    );
    return this.bookmarks.length < before;
  }

  public async getBookmarksByUserId(userId: number): Promise<ContentBookmark[]> {
    return this.bookmarks.filter((b) => b.userId === userId).map((b) => ({ ...b }));
  }

  public async countBookmarksByUserId(userId: number): Promise<number> {
    return this.bookmarks.filter((b) => b.userId === userId).length;
  }

  // IAccountCleanupRepository
  public async deleteAuthTokensByUserId(userId: number): Promise<number> {
    const before = this.authTokens.length;
    this.authTokens = this.authTokens.filter((t) => t.userId !== userId);
    return before - this.authTokens.length;
  }

  public async deleteOtpCodesByPhoneNumber(phoneNumber: string): Promise<number> {
    const before = this.otpCodes.length;
    this.otpCodes = this.otpCodes.filter((o) => o.phoneNumber !== phoneNumber);
    return before - this.otpCodes.length;
  }

  public async anonymizeViewEventsByUserId(userId: number): Promise<number> {
    let count = 0;
    for (const ev of this.viewEvents) {
      if (ev.userId === userId) {
        ev.userId = null;
        count += 1;
      }
    }
    return count;
  }

  public async anonymizeDownloadEventsByUserId(userId: number): Promise<number> {
    let count = 0;
    for (const ev of this.downloadEvents) {
      if (ev.userId === userId) {
        ev.userId = null;
        count += 1;
      }
    }
    return count;
  }

  public async anonymizeOptionalCommentsByUserId(): Promise<number> {
    return 0;
  }

  public async deleteOptionalTopicAffinitiesByUserId(userId: number): Promise<number> {
    return this.deleteAffinitiesByUserId(userId);
  }
}

function createInMemoryCookieStorage() {
  let cookieJar = '';
  const memFallback = new Map<string, string>();
  const storage = new BrowserAffinityCookieStorage({
    getCookieString: () => cookieJar,
    setCookieString: (val: string) => {
      const kv = val.split(';')[0] ?? '';
      const eqIdx = kv.indexOf('=');
      if (eqIdx <= 0) {
        return;
      }
      const name = kv.slice(0, eqIdx).trim();
      const value = kv.slice(eqIdx + 1).trim();
      const others = cookieJar
        .split(';')
        .map((p) => p.trim())
        .filter((p) => p.length > 0 && !p.startsWith(`${name}=`));
      if (!val.includes('max-age=0')) {
        others.push(`${name}=${value}`);
      }
      cookieJar = others.join('; ');
    },
    storage: {
      getItem: (key: string) => memFallback.get(key) ?? null,
      setItem: (key: string, value: string) => {
        memFallback.set(key, value);
      },
      removeItem: (key: string) => {
        memFallback.delete(key);
      },
    },
  });
  return {
    storage,
    getRawCookieJar: () => cookieJar,
  };
}

function buildPersonalizationHarness(
  clock: Stage20FakeClock,
  customGuestStorage?: IGuestAffinityStorage,
) {
  const harness = new Stage20MemoryHarness();
  const guestStorage = customGuestStorage ?? new MemoryGuestAffinityStorage();
  const logger = new AppLogger(clock);
  const personalizationService = new PersonalizationService({
    affinityRepository: harness,
    guestAffinityStorage: guestStorage,
    adminRepository: harness,
    contentRepository: harness,
    taxonomyRepository: harness,
    viewEventRepository: harness,
    clock,
    logger,
  });
  const viewTracker = new ViewTrackerService(
    harness,
    harness,
    clock,
    logger,
    harness,
    personalizationService,
  );
  const homePageService = new HomePageService({
    layoutRepository: harness,
    contentRepository: harness,
    taxonomyRepository: harness,
    adminRepository: harness,
    viewEventRepository: harness,
    clock,
    personalizationService,
  });
  const policyService = new PermissionPolicyService(harness, logger);
  const settingsService = new SettingsManagementService(harness, logger, policyService);

  return {
    harness,
    guestStorage,
    logger,
    personalizationService,
    viewTracker,
    homePageService,
    settingsService,
  };
}

export const stage20Tests: UnitTestCase[] = [
  {
    id: 'stage20-example310-threshold-and-unseen-order',
    nameKey: 'tests.stage20.example310ThresholdAndUnseenOrder.name',
    descriptionKey: 'tests.stage20.example310ThresholdAndUnseenOrder.desc',
    run: async () => {
      const clock = new Stage20FakeClock('2026-11-23T08:00:00.000Z');
      const {
        harness,
        viewTracker,
        homePageService,
        personalizationService,
      } = buildPersonalizationHarness(clock);

      const user = await harness.createUser({
        email: 'reader@meraj.ir',
        normalizedEmail: 'reader@meraj.ir',
        emailConfirmed: true,
        phoneNumber: null,
        normalizedPhoneNumber: null,
        phoneNumberConfirmed: false,
        passwordHash: 'h',
        passwordSalt: 's',
        displayName: 'خواننده نمونه',
        role: 'Member',
        ageGroupId: 4,
        personalizationEnabled: true,
        mustChangePassword: false,
        isActive: true,
        isDeleted: false,
        deletedAt: null,
        failedLoginCount: 0,
        lockoutEnd: null,
        createdAt: clock.nowUtcIso(),
        lastLoginAt: null,
      });

      const rootA = harness.addTopicSeed('تاریخ اسلام', null);
      const childA1 = harness.addTopicSeed('تاریخ صدر اسلام', rootA.id);
      const grandA2 = harness.addTopicSeed('سیره نبوی', childA1.id);
      const rootB = harness.addTopicSeed('اخلاق و عرفان', null);

      const viewedItems: ContentItem[] = [];
      for (let i = 1; i <= 4; i += 1) {
        const topicId = i <= 2 ? rootA.id : i === 3 ? childA1.id : grandA2.id;
        viewedItems.push(
          await harness.seedPublishedContent({
            title: `مطلب دیده‌شده A-${i}`,
            topicIds: [topicId],
            ageGroupIds: [4],
            publishedAt: `2026-11-0${i}T10:00:00.000Z`,
          }),
        );
      }
      const viewedB = await harness.seedPublishedContent({
        title: 'مطلب دیده‌شده B-1',
        topicIds: [rootB.id],
        ageGroupIds: [4],
        publishedAt: '2026-11-05T10:00:00.000Z',
      });

      // Publish 15 unseen items (10 in A tree, 5 in B) with ascending dates
      const unseenA: ContentItem[] = [];
      for (let i = 1; i <= 10; i += 1) {
        const day = String(10 + i).padStart(2, '0');
        unseenA.push(
          await harness.seedPublishedContent({
            title: `جدید A-${i}`,
            topicIds: [i % 2 === 0 ? childA1.id : rootA.id],
            ageGroupIds: [4],
            publishedAt: `2026-11-${day}T09:00:00.000Z`,
          }),
        );
      }
      const unseenB: ContentItem[] = [];
      for (let i = 1; i <= 5; i += 1) {
        const day = String(15 + i).padStart(2, '0');
        unseenB.push(
          await harness.seedPublishedContent({
            title: `جدید B-${i}`,
            topicIds: [rootB.id],
            ageGroupIds: [4],
            publishedAt: `2026-11-${day}T12:00:00.000Z`,
          }),
        );
      }

      const ageGroups = await harness.getAllAgeGroups();
      const adultAge = ageGroups.find((g) => g.id === 4) ?? null;

      // Record 2 counted views on Topic A (< MinViews=3) -> shelf must stay hidden
      await viewTracker.trackViewAsync({
        contentId: viewedItems[0].id,
        userId: user.id,
        visitorId: 'vis-ex310',
        userAgent: 'Mozilla/5.0',
        ageGroupId: 4,
        primaryTopicId: rootA.id,
      });
      await viewTracker.trackViewAsync({
        contentId: viewedItems[1].id,
        userId: user.id,
        visitorId: 'vis-ex310',
        userAgent: 'Mozilla/5.0',
        ageGroupId: 4,
        primaryTopicId: rootA.id,
      });

      const belowThreshold =
        await personalizationService.getPersonalizedRecommendationsAsync({
          user,
          activeAgeGroup: adultAge,
          visitorId: 'vis-ex310',
        });
      assertEqual(
        belowThreshold.isVisible,
        false,
        'Shelf must stay hidden when max affinity is 2 (< 3)',
      );
      const homeBefore = await homePageService.getHomePageDataAsync(adultAge, {
        user,
        visitorId: 'vis-ex310',
      });
      assert(
        !homeBefore.shelves.some((s) => s.shelf.type === 'Personalized'),
        'HomePageService must hide Personalized shelf below MinViews threshold',
      );

      // Add views on subtopic A1 and grandchild A2 (total A = 4) and 1 on B
      await viewTracker.trackViewAsync({
        contentId: viewedItems[2].id,
        userId: user.id,
        visitorId: 'vis-ex310',
        userAgent: 'Mozilla/5.0',
        ageGroupId: 4,
        primaryTopicId: childA1.id,
      });
      await viewTracker.trackViewAsync({
        contentId: viewedItems[3].id,
        userId: user.id,
        visitorId: 'vis-ex310',
        userAgent: 'Mozilla/5.0',
        ageGroupId: 4,
        primaryTopicId: grandA2.id,
      });
      await viewTracker.trackViewAsync({
        contentId: viewedB.id,
        userId: user.id,
        visitorId: 'vis-ex310',
        userAgent: 'Mozilla/5.0',
        ageGroupId: 4,
        primaryTopicId: rootB.id,
      });

      const homeAfter = await homePageService.getHomePageDataAsync(adultAge, {
        user,
        visitorId: 'vis-ex310',
      });
      const personalizedShelf = homeAfter.shelves.find(
        (s) => s.shelf.type === 'Personalized',
      );
      assert(personalizedShelf !== undefined, 'Personalized shelf must be visible now');
      assertEqual(
        personalizedShelf!.items.length,
        12,
        'Personalized shelf must respect Home.ItemsPerShelf = 12',
      );
      assertEqual(
        personalizedShelf!.personalizedTopics?.map((t) => t.rootTopicId).join(','),
        `${rootA.id},${rootB.id}`,
        'Top 2 matched root topics must be A (4) then B (1)',
      );

      const seenIdSet = new Set([
        ...viewedItems.map((i) => i.id),
        viewedB.id,
      ]);
      const recommendedIds = personalizedShelf!.items.map((e) => e.item.id);
      assertEqual(
        new Set(recommendedIds).size,
        12,
        'Personalized shelf must contain no duplicate content items',
      );
      for (const id of recommendedIds) {
        assert(!seenIdSet.has(id), 'Viewed content must never be recommended');
      }

      // Expect top 10 newest from Topic A, then top 2 newest from Topic B (unseenB[4], unseenB[3])
      const expectedFirst10A = unseenA
        .slice()
        .reverse()
        .map((i) => i.id);
      const expectedNext2B = [unseenB[4].id, unseenB[3].id];
      assertEqual(
        recommendedIds.slice(0, 10).join(','),
        expectedFirst10A.join(','),
        'First 10 recommendations must be newest unseen items from top Topic A',
      );
      assertEqual(
        recommendedIds.slice(10, 12).join(','),
        expectedNext2B.join(','),
        'Remaining 2 slots must be filled with newest unseen items from Topic B',
      );
    },
  },
  {
    id: 'stage20-utc-day-content-cap',
    nameKey: 'tests.stage20.utcDayContentCap.name',
    descriptionKey: 'tests.stage20.utcDayContentCap.desc',
    run: async () => {
      const clock = new Stage20FakeClock('2026-11-23T10:00:00.000Z');
      const { harness, viewTracker } = buildPersonalizationHarness(clock);

      const user = await harness.createUser({
        email: 'utc@meraj.ir',
        normalizedEmail: 'utc@meraj.ir',
        emailConfirmed: true,
        phoneNumber: null,
        normalizedPhoneNumber: null,
        phoneNumberConfirmed: false,
        passwordHash: 'h',
        passwordSalt: 's',
        displayName: 'کاربر زمان',
        role: 'Member',
        ageGroupId: 4,
        personalizationEnabled: true,
        mustChangePassword: false,
        isActive: true,
        isDeleted: false,
        deletedAt: null,
        failedLoginCount: 0,
        lockoutEnd: null,
        createdAt: clock.nowUtcIso(),
        lastLoginAt: null,
      });

      const rootHistory = harness.addTopicSeed('تاریخ', null);
      const item1 = await harness.seedPublishedContent({
        title: 'مطلب یکم',
        topicIds: [rootHistory.id],
        ageGroupIds: [4],
        publishedAt: '2026-11-01T10:00:00.000Z',
      });
      const item2 = await harness.seedPublishedContent({
        title: 'مطلب دوم',
        topicIds: [rootHistory.id],
        ageGroupIds: [4],
        publishedAt: '2026-11-02T10:00:00.000Z',
      });

      // 10:00 UTC Day 1 on item1 -> counted + affinity = 1
      const v1 = await viewTracker.trackViewAsync({
        contentId: item1.id,
        userId: user.id,
        visitorId: 'vis-utc',
        userAgent: 'Mozilla/5.0',
        ageGroupId: 4,
        primaryTopicId: rootHistory.id,
      });
      assertEqual(v1.isCounted, true, 'First view must be counted');
      assertEqual(
        (await harness.getAffinity(user.id, rootHistory.id))?.viewCount ?? 0,
        1,
        'Affinity should be 1 after first view',
      );

      // 11:00 UTC same day (60m >= 30m) -> ViewTracker counts, affinity must NOT increment again!
      clock.setUtcIso('2026-11-23T11:00:00.000Z');
      const v2 = await viewTracker.trackViewAsync({
        contentId: item1.id,
        userId: user.id,
        visitorId: 'vis-utc',
        userAgent: 'Mozilla/5.0',
        ageGroupId: 4,
        primaryTopicId: rootHistory.id,
      });
      assertEqual(v2.isCounted, true, 'Second view after 60 minutes is counted as ViewEvent');
      assertEqual(
        (await harness.getAffinity(user.id, rootHistory.id))?.viewCount ?? 0,
        1,
        'Affinity must stay 1 on same UTC calendar day for same content',
      );

      // Next UTC calendar day 09:00 -> item1 increments affinity to 2
      clock.setUtcIso('2026-11-24T09:00:00.000Z');
      await viewTracker.trackViewAsync({
        contentId: item1.id,
        userId: user.id,
        visitorId: 'vis-utc',
        userAgent: 'Mozilla/5.0',
        ageGroupId: 4,
        primaryTopicId: rootHistory.id,
      });
      assertEqual(
        (await harness.getAffinity(user.id, rootHistory.id))?.viewCount ?? 0,
        2,
        'Affinity must increment to 2 on next UTC day',
      );

      // Same UTC day 09:40 -> different item2 increments affinity to 3
      clock.setUtcIso('2026-11-24T09:40:00.000Z');
      await viewTracker.trackViewAsync({
        contentId: item2.id,
        userId: user.id,
        visitorId: 'vis-utc',
        userAgent: 'Mozilla/5.0',
        ageGroupId: 4,
        primaryTopicId: rootHistory.id,
      });
      assertEqual(
        (await harness.getAffinity(user.id, rootHistory.id))?.viewCount ?? 0,
        3,
        'Different content on the same UTC day must increment affinity to 3',
      );
    },
  },
  {
    id: 'stage20-toggles-and-clear-history',
    nameKey: 'tests.stage20.togglesAndClearHistory.name',
    descriptionKey: 'tests.stage20.togglesAndClearHistory.desc',
    run: async () => {
      const clock = new Stage20FakeClock('2026-11-23T08:00:00.000Z');
      const {
        harness,
        personalizationService,
        homePageService,
        settingsService,
      } = buildPersonalizationHarness(clock);

      const admin = await harness.createUser({
        email: 'admin20@meraj.ir',
        normalizedEmail: 'admin20@meraj.ir',
        emailConfirmed: true,
        phoneNumber: null,
        normalizedPhoneNumber: null,
        phoneNumberConfirmed: false,
        passwordHash: 'h',
        passwordSalt: 's',
        displayName: 'مدیر کل',
        role: 'SuperAdmin',
        ageGroupId: 4,
        personalizationEnabled: true,
        mustChangePassword: false,
        isActive: true,
        isDeleted: false,
        deletedAt: null,
        failedLoginCount: 0,
        lockoutEnd: null,
        createdAt: clock.nowUtcIso(),
        lastLoginAt: null,
      });

      const rootScience = harness.addTopicSeed('علوم پایه', null);
      await harness.seedPublishedContent({
        title: 'مطلب دیده‌نشده علوم',
        topicIds: [rootScience.id],
        ageGroupIds: [4],
        publishedAt: '2026-11-20T10:00:00.000Z',
      });
      await harness.upsertAffinity({
        userId: admin.id,
        rootTopicId: rootScience.id,
        viewCount: 5,
        lastViewedAt: clock.nowUtcIso(),
      });

      const ageGroups = await harness.getAllAgeGroups();
      const adultAge = ageGroups.find((g) => g.id === 4) ?? null;

      // 1) Enabled initially
      const initialRecs = await personalizationService.getPersonalizedRecommendationsAsync({
        user: admin,
        activeAgeGroup: adultAge,
      });
      assertEqual(initialRecs.isVisible, true, 'Recommendations must start visible');

      // 2) User toggle OFF -> hidden; toggle ON -> visible again
      const toggleOff = await personalizationService.setUserPersonalizationEnabledAsync(
        admin,
        false,
      );
      assertEqual(toggleOff.ok, true, 'User toggle OFF must succeed');
      assertEqual(toggleOff.effectiveEnabled, false, 'Effective state must be false');
      const userOff = (await harness.getUserById(admin.id))!;
      const homeWhileOff = await homePageService.getHomePageDataAsync(adultAge, {
        user: userOff,
      });
      assert(
        !homeWhileOff.shelves.some((s) => s.shelf.type === 'Personalized'),
        'Personalized shelf must hide when userPersonalizationEnabled is false',
      );

      const toggleOn = await personalizationService.setUserPersonalizationEnabledAsync(
        userOff,
        true,
      );
      assertEqual(toggleOn.effectiveEnabled, true, 'Effective state must restore to true');
      const userOn = (await harness.getUserById(admin.id))!;

      // 3) Admin global switch Personalization.DefaultEnabled = '0' -> hidden globally
      const saveGlobalOff = await settingsService.updateSiteSettings(admin, {
        'Personalization.DefaultEnabled': '0',
      });
      assertEqual(saveGlobalOff.ok, true, 'Admin disabling global personalization succeeds');
      const statusGlobalOff =
        await personalizationService.getPersonalizationStatusAsync(userOn);
      assertEqual(statusGlobalOff.globalEnabled, false, 'globalEnabled must be false');
      assertEqual(
        statusGlobalOff.effectiveEnabled,
        false,
        'effectiveEnabled must be false when global is disabled',
      );

      // Re-enable globally -> visible again
      await settingsService.updateSiteSettings(admin, {
        'Personalization.DefaultEnabled': '1',
      });

      // 4) Clear personalization history deletes all affinity rows
      const cleared = await personalizationService.clearPersonalizationHistoryAsync(userOn);
      assertEqual(cleared.ok, true, 'Clearing history must succeed');
      assertEqual(cleared.deletedTopicsCount, 1, 'One topic affinity must be removed');
      const statusAfterClear =
        await personalizationService.getPersonalizationStatusAsync(userOn);
      assertEqual(statusAfterClear.topTopics.length, 0, 'topTopics must be empty');
      const recsAfterClear =
        await personalizationService.getPersonalizedRecommendationsAsync({
          user: userOn,
          activeAgeGroup: adultAge,
        });
      assertEqual(
        recsAfterClear.isVisible,
        false,
        'Recommendations must hide after clearing history',
      );
    },
  },
  {
    id: 'stage20-guest-cookie-cap20-and-login-merge',
    nameKey: 'tests.stage20.guestCookieCap20AndLoginMerge.name',
    descriptionKey: 'tests.stage20.guestCookieCap20AndLoginMerge.desc',
    run: async () => {
      const clock = new Stage20FakeClock('2026-11-23T08:00:00.000Z');
      const inMemoryCookie = createInMemoryCookieStorage();
      const {
        harness,
        guestStorage,
        logger,
        personalizationService,
        viewTracker,
      } = buildPersonalizationHarness(clock, inMemoryCookie.storage);

      // Create 22 root topics and record guest views with descending priority
      const rootTopics: Topic[] = [];
      for (let i = 1; i <= 22; i += 1) {
        rootTopics.push(harness.addTopicSeed(`موضوع-${i}`, null));
      }

      // Topics 1..20 get 2 views each across 2 UTC days; topics 21 & 22 get 1 view each
      for (let idx = 0; idx < 22; idx += 1) {
        const topic = rootTopics[idx];
        const content1 = await harness.seedPublishedContent({
          title: `محتوای ۱ موضوع ${idx + 1}`,
          topicIds: [topic.id],
          ageGroupIds: [4],
          publishedAt: '2026-11-10T10:00:00.000Z',
        });
        clock.setUtcIso('2026-11-23T10:00:00.000Z');
        await viewTracker.trackViewAsync({
          contentId: content1.id,
          userId: null,
          visitorId: 'guest-22',
          userAgent: 'Mozilla/5.0',
          ageGroupId: 4,
          primaryTopicId: topic.id,
        });

        if (idx < 20) {
          const content2 = await harness.seedPublishedContent({
            title: `محتوای ۲ موضوع ${idx + 1}`,
            topicIds: [topic.id],
            ageGroupIds: [4],
            publishedAt: '2026-11-11T10:00:00.000Z',
          });
          await viewTracker.trackViewAsync({
            contentId: content2.id,
            userId: null,
            visitorId: 'guest-22',
            userAgent: 'Mozilla/5.0',
            ageGroupId: 4,
            primaryTopicId: topic.id,
          });
        }
      }

      const guestEntries = guestStorage.getGuestAffinities();
      assertEqual(
        guestEntries.length,
        20,
        'Guest ma_aff storage must strictly cap at 20 root topics',
      );
      const guestIds = new Set(guestEntries.map((e) => e.rootTopicId));
      for (let idx = 0; idx < 20; idx += 1) {
        assert(
          guestIds.has(rootTopics[idx].id),
          `Top-scoring topic ${idx + 1} must be retained in ma_aff`,
        );
      }
      assert(
        inMemoryCookie.getRawCookieJar().includes('ma_aff='),
        'BrowserAffinityCookieStorage must serialize entries into ma_aff cookie',
      );

      // Verify BrowserAffinityCookieStorage ignores __proto__/invalid keys cleanly
      const safetyCookie = createInMemoryCookieStorage();
      safetyCookie.storage.setGuestAffinities(
        Array.from({ length: 22 }, (_, i) => ({
          rootTopicId: i + 1,
          viewCount: i + 1,
          lastViewedAt: '2026-11-23T10:00:00.000Z',
        })),
      );
      const parsedBrowser = safetyCookie.storage.getGuestAffinities();
      assertEqual(parsedBrowser.length, 20, 'BrowserAffinityCookieStorage enforces max 20');
      assertEqual(
        parsedBrowser[0].rootTopicId,
        22,
        'Highest-count topic retained first in BrowserAffinityCookieStorage',
      );

      // Login merge via real AuthService.loginWithEmail
      const hasher = new BrowserPasswordHasher();
      const { hash: passwordHash, salt } = await hasher.hashPassword('StrongPass!2026');
      const emailUser = await harness.createUser({
        email: 'merge@meraj.ir',
        normalizedEmail: 'merge@meraj.ir',
        emailConfirmed: true,
        phoneNumber: '09121234567',
        normalizedPhoneNumber: '09121234567',
        phoneNumberConfirmed: true,
        passwordHash,
        passwordSalt: salt,
        displayName: 'کاربر ادغام',
        role: 'Member',
        ageGroupId: 4,
        personalizationEnabled: true,
        mustChangePassword: false,
        isActive: true,
        isDeleted: false,
        deletedAt: null,
        failedLoginCount: 0,
        lockoutEnd: null,
        createdAt: clock.nowUtcIso(),
        lastLoginAt: null,
      });

      const topicA = rootTopics[0];
      const topicB = rootTopics[1];
      const topicC = rootTopics[2];

      // DB user already has topicA = 2; guest cookie has topicA = 2 and topicC = 3
      await harness.upsertAffinity({
        userId: emailUser.id,
        rootTopicId: topicA.id,
        viewCount: 2,
        lastViewedAt: '2026-11-20T10:00:00.000Z',
      });
      guestStorage.setGuestAffinities([
        {
          rootTopicId: topicA.id,
          viewCount: 2,
          lastViewedAt: '2026-11-23T12:00:00.000Z',
        },
        {
          rootTopicId: topicC.id,
          viewCount: 3,
          lastViewedAt: '2026-11-23T12:05:00.000Z',
        },
      ]);

      const tokenStore = new MemorySessionTokenStore();
      const authService = new AuthService(
        harness,
        hasher,
        new MemoryNullEmailSender(),
        clock,
        logger,
        tokenStore,
        undefined,
        new RateLimiter(clock, 20, 60_000),
        personalizationService,
      );

      const loginRes = await authService.loginWithEmail({
        email: 'merge@meraj.ir',
        password: 'StrongPass!2026',
      });
      assertEqual(loginRes.ok, true, 'Email login must succeed');
      assertEqual(
        (await harness.getAffinity(emailUser.id, topicA.id))?.viewCount ?? 0,
        4,
        'Existing DB topicA (2) + guest topicA (2) must merge cleanly to 4',
      );
      assertEqual(
        (await harness.getAffinity(emailUser.id, topicC.id))?.viewCount ?? 0,
        3,
        'New guest topicC (3) must be added to DB on email login',
      );
      assertEqual(
        guestStorage.getGuestAffinities().length,
        0,
        'Guest ma_aff cookie must be cleared immediately after email login merge',
      );

      // Login merge via real OtpService.verifyOtp
      guestStorage.setGuestAffinities([
        {
          rootTopicId: topicB.id,
          viewCount: 5,
          lastViewedAt: '2026-11-23T13:00:00.000Z',
        },
      ]);
      const smsSender = new MemoryCapturingSmsSender();
      const otpService = new OtpService(
        harness,
        hasher,
        smsSender,
        clock,
        logger,
        tokenStore,
        new RateLimiter(clock, 20, 60_000),
        'کد تایید: {code}',
        personalizationService,
      );
      const reqRes = await otpService.requestOtp('09121234567');
      assertEqual(reqRes.ok, true, 'OTP request must succeed');
      const verifyRes = await otpService.verifyOtp('09121234567', smsSender.lastCode);
      assertEqual(verifyRes.ok, true, 'OTP verify must succeed');
      assertEqual(
        (await harness.getAffinity(emailUser.id, topicB.id))?.viewCount ?? 0,
        5,
        'OTP login must merge guest topicB (5) into DB',
      );
      assertEqual(
        guestStorage.getGuestAffinities().length,
        0,
        'Guest ma_aff cookie must be cleared after OTP login merge',
      );
    },
  },
  {
    id: 'stage20-child-safety-and-rule67-purge',
    nameKey: 'tests.stage20.childSafetyAndRule67Purge.name',
    descriptionKey: 'tests.stage20.childSafetyAndRule67Purge.desc',
    run: async () => {
      const clock = new Stage20FakeClock('2026-11-23T08:00:00.000Z');
      const { harness, logger, personalizationService } = buildPersonalizationHarness(clock);

      const hasher = new BrowserPasswordHasher();
      const { hash: passwordHash, salt } = await hasher.hashPassword('ChildSafe!2026');

      const childUser = await harness.createUser({
        email: 'child20@meraj.ir',
        normalizedEmail: 'child20@meraj.ir',
        emailConfirmed: true,
        phoneNumber: null,
        normalizedPhoneNumber: null,
        phoneNumberConfirmed: false,
        passwordHash,
        passwordSalt: salt,
        displayName: 'کودک کنجکاو',
        role: 'Member',
        ageGroupId: 1,
        personalizationEnabled: true,
        mustChangePassword: false,
        isActive: true,
        isDeleted: false,
        deletedAt: null,
        failedLoginCount: 0,
        lockoutEnd: null,
        createdAt: clock.nowUtcIso(),
        lastLoginAt: null,
      });

      const rootScience = harness.addTopicSeed('علم و شگفتی‌ها', null);
      await harness.upsertAffinity({
        userId: childUser.id,
        rootTopicId: rootScience.id,
        viewCount: 6,
        lastViewedAt: clock.nowUtcIso(),
      });

      const childItem = await harness.seedPublishedContent({
        title: 'آزمایش علمی کودکانه',
        topicIds: [rootScience.id],
        ageGroupIds: [1],
        publishedAt: '2026-11-22T10:00:00.000Z',
      });
      const universalItem = await harness.seedPublishedContent({
        title: 'داستان نجوم برای همه',
        topicIds: [rootScience.id],
        ageGroupIds: [],
        publishedAt: '2026-11-21T10:00:00.000Z',
      });
      const adultItem = await harness.seedPublishedContent({
        title: 'مقاله تخصصی بزرگسالان',
        topicIds: [rootScience.id],
        ageGroupIds: [4],
        publishedAt: '2026-11-23T11:00:00.000Z',
      });

      const ageGroups = await harness.getAllAgeGroups();
      const childAge = ageGroups.find((g) => g.id === 1) ?? null;
      assert(childAge !== null, 'Child age group must exist');

      const childRecs = await personalizationService.getPersonalizedRecommendationsAsync({
        user: childUser,
        activeAgeGroup: childAge,
      });
      assertEqual(childRecs.isVisible, true, 'Child shelf visible when allowed items exist');
      const returnedIds = childRecs.items.map((e) => e.item.id);
      assert(returnedIds.includes(childItem.id), 'Child item must be included');
      assert(returnedIds.includes(universalItem.id), 'Universal item must be included');
      assert(
        !returnedIds.includes(adultItem.id),
        'Strict child safety: Adult content must NEVER appear in child recommendations',
      );

      // Rule 6.7 purge removes all UserTopicAffinity records for deleted account
      const profileService = new ProfileService({
        authRepository: harness,
        contentRepository: harness,
        interactionRepository: harness,
        downloadEventRepository: harness,
        cleanupRepository: harness.createCleanupAdapter(),
        passwordHasher: hasher,
        sessionTokenStore: new MemorySessionTokenStore(),
        clock,
        logger,
        deletedDisplayName: 'کاربر حذف‌شده',
      });

      const deleteRes = await profileService.deleteAccountAsync(childUser, {
        password: 'ChildSafe!2026',
      });
      assertEqual(deleteRes.ok, true, 'Rule 6.7 deleteAccountAsync must succeed');
      assertEqual(
        (await harness.getAffinitiesByUserId(childUser.id)).length,
        0,
        'Rule 6.7 must purge all UserTopicAffinity rows for the deleted user',
      );

      // Migration & envConfig assertions
      assert(
        DATABASE_MIGRATIONS.some((m) => m.version === 13),
        'DATABASE_MIGRATIONS must include version 13',
      );
      assert(
        envConfig.databaseVersion >= 13,
        'envConfig.databaseVersion must be >= 13 in Stage 20',
      );
      assert(
        STAGE20_OBJECT_STORES.includes(STORE_NAMES.USER_TOPIC_AFFINITIES),
        'STAGE20_OBJECT_STORES must include userTopicAffinities',
      );

      if (typeof indexedDB !== 'undefined') {
        const testDbName = `meraj-stage20-idb-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
        const dataStore = new IndexedDbDataStore(
          testDbName,
          envConfig.databaseVersion,
          envConfig.metaStoreName,
        );
        try {
          await dataStore.connect();
          const storeNames = await dataStore.getObjectStoreNames();
          assert(
            storeNames.includes(STORE_NAMES.USER_TOPIC_AFFINITIES),
            'IndexedDB v13 must provision userTopicAffinities object store',
          );

          const repo = new IndexedDbUserTopicAffinityRepository(dataStore);
          const cleanupRepo = new IndexedDbAccountCleanupRepository(dataStore);
          await repo.upsertAffinity({
            userId: 901,
            rootTopicId: rootScience.id,
            viewCount: 7,
            lastViewedAt: clock.nowUtcIso(),
          });
          const loaded = await repo.getAffinity(901, rootScience.id);
          assertEqual(loaded?.viewCount ?? 0, 7, 'IDB roundtrip must preserve viewCount');

          const purged = await cleanupRepo.deleteOptionalTopicAffinitiesByUserId(901);
          assertEqual(purged, 1, 'IDB cleanup must delete composite-keyed affinity row');
          assertEqual(
            (await repo.getAffinitiesByUserId(901)).length,
            0,
            'IDB userTopicAffinities must be empty after cleanup',
          );
        } finally {
          dataStore.close();
          await new Promise<void>((resolve) => {
            const req = indexedDB.deleteDatabase(testDbName);
            req.onsuccess = () => resolve();
            req.onerror = () => resolve();
            req.onblocked = () => resolve();
          });
        }
      }
    },
  },
];
