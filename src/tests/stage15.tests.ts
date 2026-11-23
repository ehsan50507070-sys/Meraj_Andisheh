import type { IClock } from '../core/abstractions/IClock';
import type { IAdminRepository } from '../core/abstractions/adminRepository';
import type { IAuthRepository, ISessionTokenStore } from '../core/abstractions/authRepository';
import type { IContentRepository } from '../core/abstractions/contentRepository';
import type { IDownloadEventRepository } from '../core/abstractions/downloadRepository';
import type {
  IAccountCleanupRepository,
  IInteractionRepository,
} from '../core/abstractions/interactionRepository';
import type { ITaxonomyRepository } from '../core/abstractions/taxonomyRepository';
import type { IEmailSender } from '../core/abstractions/emailSender';
import {
  DownloadKind,
  type DownloadEvent,
  type ViewEvent,
} from '../core/domain/analytics';
import type { AppUser, AuthToken, UserSession } from '../core/domain/auth';
import {
  ContentFileKind,
  ContentStatus,
  FileStorageType,
  type ContentAgeGroup,
  type ContentFile,
  type ContentItem,
  type ContentPerson,
  type ContentSource,
  type ContentTag,
  type ContentTopic,
} from '../core/domain/content';
import type { ContentBookmark, ContentLike } from '../core/domain/interactions';
import type { OtpCode } from '../core/domain/otp';
import type { StaffPermission } from '../core/domain/permissions';
import type { FeatureFlag, SiteSetting } from '../core/domain/settings';
import type {
  AgeGroup,
  ImpactLevel,
  Person,
  Tag,
  Topic,
} from '../core/domain/taxonomy';
import { AuthService } from '../core/services/authService';
import { InteractionService } from '../core/services/interactionService';
import { PermissionPolicyService } from '../core/services/permissionPolicyService';
import { ProfileService } from '../core/services/profileService';
import { RateLimiter } from '../core/services/rateLimiter';
import { StaffManagementService } from '../core/services/staffManagementService';
import { UserManagementService } from '../core/services/userManagementService';
import { SystemClock } from '../infrastructure/clock/SystemClock';
import { envConfig } from '../infrastructure/config/envConfig';
import { IndexedDbAccountCleanupRepository } from '../infrastructure/data/IndexedDbAccountCleanupRepository';
import { IndexedDbAuthRepository } from '../infrastructure/data/IndexedDbAuthRepository';
import { IndexedDbContentRepository } from '../infrastructure/data/IndexedDbContentRepository';
import { IndexedDbDataStore } from '../infrastructure/data/IndexedDbDataStore';
import { IndexedDbDownloadEventRepository } from '../infrastructure/data/IndexedDbDownloadEventRepository';
import { IndexedDbInteractionRepository } from '../infrastructure/data/IndexedDbInteractionRepository';
import { STAGE15_OBJECT_STORES, STORE_NAMES } from '../infrastructure/data/migrations';
import { DatabaseSeeder, INITIAL_AGE_GROUPS } from '../infrastructure/data/seed';
import { AppLogger } from '../infrastructure/logging/AppLogger';
import { BrowserPasswordHasher } from '../infrastructure/security/BrowserPasswordHasher';
import { assert, assertEqual, type UnitTestCase } from './testRunner';

class Stage15FakeClock implements IClock {
  private iso: string;
  private readonly inner = new SystemClock();

  constructor(initialIso = '2026-11-23T08:00:00.000Z') {
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
    // No-op in unit test
  }
}

interface SimulatedComment {
  id: number;
  userId: number;
  contentId: number;
  body: string;
  authorDisplayName: string;
}

class MemoryStage15Harness implements
  IAuthRepository,
  IContentRepository,
  ITaxonomyRepository,
  IDownloadEventRepository,
  IInteractionRepository,
  IAccountCleanupRepository
{
  private users: AppUser[] = [];
  private otpCodes: OtpCode[] = [];
  private authTokens: AuthToken[] = [];
  private sessions: UserSession[] = [];
  private ageGroups: AgeGroup[] = INITIAL_AGE_GROUPS.map((g, idx) => ({
    ...g,
    id: idx + 1,
  }));
  private topics: Topic[] = [];
  private tags: Tag[] = [];
  private persons: Person[] = [];
  private impactLevels: ImpactLevel[] = [];

  private items: ContentItem[] = [];
  private sources: ContentSource[] = [];
  private files: ContentFile[] = [];
  private contentTopics: ContentTopic[] = [];
  private contentTags: ContentTag[] = [];
  private contentPersons: ContentPerson[] = [];
  private contentAgeGroups: ContentAgeGroup[] = [];

  private likes: ContentLike[] = [];
  private bookmarks: ContentBookmark[] = [];
  private viewEvents: ViewEvent[] = [];
  private downloadEvents: DownloadEvent[] = [];
  private staffPermissions: StaffPermission[] = [];
  private featureFlags: FeatureFlag[] = [];
  private siteSettings: SiteSetting[] = [];
  public simulatedComments: SimulatedComment[] = [];

  private staffPermSeq = 1;
  private userSeq = 100;
  private otpSeq = 1;
  private tokenSeq = 1;
  private sessionSeq = 1;
  private topicSeq = 1;
  private tagSeq = 1;
  private personSeq = 1;
  private impactSeq = 1;
  private itemSeq = 1;
  private sourceSeq = 1;
  private fileSeq = 1;
  private viewSeq = 1;
  private downloadSeq = 1;

  // IAuthRepository
  public async getUserById(id: number): Promise<AppUser | null> {
    const found = this.users.find((u) => u.id === id);
    return found ? { ...found } : null;
  }

  public async getUserByNormalizedEmail(normalizedEmail: string): Promise<AppUser | null> {
    if (!normalizedEmail) return null;
    const found = this.users.find((u) => u.normalizedEmail === normalizedEmail);
    return found ? { ...found } : null;
  }

  public async getUserByNormalizedPhoneNumber(normalizedPhoneNumber: string): Promise<AppUser | null> {
    if (!normalizedPhoneNumber) return null;
    const found = this.users.find((u) => u.normalizedPhoneNumber === normalizedPhoneNumber);
    return found ? { ...found } : null;
  }

  public async getAllUsers(): Promise<AppUser[]> {
    return this.users.map((u) => ({ ...u }));
  }

  public async countUsers(): Promise<number> {
    return this.users.length;
  }

  public async hasAnySuperAdmin(): Promise<boolean> {
    return this.users.some((u) => u.role === 'SuperAdmin' && u.isActive && !u.isDeleted);
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

  public async getAllSessions(): Promise<UserSession[]> {
    return this.sessions.map((s) => ({ ...s }));
  }

  public async getActiveAgeGroups(): Promise<AgeGroup[]> {
    return this.ageGroups.filter((g) => g.isActive).map((g) => ({ ...g }));
  }

  public async ageGroupExists(ageGroupId: number): Promise<boolean> {
    return this.ageGroups.some((g) => g.id === ageGroupId);
  }

  public async userExists(userId: number): Promise<boolean> {
    return this.users.some((u) => u.id === userId);
  }

  // IContentRepository
  public async getAllContentItems(): Promise<ContentItem[]> {
    return this.items.map((i) => ({ ...i }));
  }

  public async getContentItemById(id: number): Promise<ContentItem | null> {
    const found = this.items.find((i) => i.id === id);
    return found ? { ...found } : null;
  }

  public async getContentItemBySlug(slug: string): Promise<ContentItem | null> {
    const found = this.items.find((i) => i.slug === slug);
    return found ? { ...found } : null;
  }

  public async createContentItem(item: Omit<ContentItem, 'id'>): Promise<ContentItem> {
    if (!this.users.some((u) => u.id === item.createdById)) {
      throw new Error(`FOREIGN_KEY_VIOLATION: createdById=${item.createdById} not found in users`);
    }
    const created: ContentItem = { ...item, id: this.itemSeq++ };
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
    const created = sources.map((s) => ({ ...s, contentId, id: this.sourceSeq++ }));
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
    const created = files.map((f) => ({ ...f, contentId, id: this.fileSeq++ }));
    this.files.push(...created);
    return created.map((f) => ({ ...f }));
  }

  public async getTopicIdsByContentId(contentId: number): Promise<number[]> {
    return this.contentTopics.filter((ct) => ct.contentId === contentId).map((ct) => ct.topicId);
  }

  public async getAllContentTopics(): Promise<ContentTopic[]> {
    return this.contentTopics.map((ct) => ({ ...ct }));
  }

  public async replaceContentTopics(contentId: number, topicIds: number[]): Promise<void> {
    this.contentTopics = this.contentTopics.filter((ct) => ct.contentId !== contentId);
    for (const topicId of topicIds) {
      this.contentTopics.push({ contentId, topicId });
    }
  }

  public async getTagIdsByContentId(contentId: number): Promise<number[]> {
    return this.contentTags.filter((ct) => ct.contentId === contentId).map((ct) => ct.tagId);
  }

  public async getAllContentTags(): Promise<ContentTag[]> {
    return this.contentTags.map((ct) => ({ ...ct }));
  }

  public async replaceContentTags(contentId: number, tagIds: number[]): Promise<void> {
    this.contentTags = this.contentTags.filter((ct) => ct.contentId !== contentId);
    for (const tagId of tagIds) {
      this.contentTags.push({ contentId, tagId });
    }
  }

  public async getPersonIdsByContentId(contentId: number): Promise<number[]> {
    return this.contentPersons.filter((cp) => cp.contentId === contentId).map((cp) => cp.personId);
  }

  public async getAllContentPersons(): Promise<ContentPerson[]> {
    return this.contentPersons.map((cp) => ({ ...cp }));
  }

  public async replaceContentPersons(contentId: number, personIds: number[]): Promise<void> {
    this.contentPersons = this.contentPersons.filter((cp) => cp.contentId !== contentId);
    for (const personId of personIds) {
      this.contentPersons.push({ contentId, personId });
    }
  }

  public async getAgeGroupIdsByContentId(contentId: number): Promise<number[]> {
    return this.contentAgeGroups
      .filter((ca) => ca.contentId === contentId)
      .map((ca) => ca.ageGroupId);
  }

  public async getAllContentAgeGroups(): Promise<Array<{ contentId: number; ageGroupId: number }>> {
    return this.contentAgeGroups.map((ca) => ({ ...ca }));
  }

  public async replaceContentAgeGroups(contentId: number, ageGroupIds: number[]): Promise<void> {
    this.contentAgeGroups = this.contentAgeGroups.filter((ca) => ca.contentId !== contentId);
    for (const ageGroupId of ageGroupIds) {
      this.contentAgeGroups.push({ contentId, ageGroupId });
    }
  }

  // ITaxonomyRepository
  public async getAllTopics(): Promise<Topic[]> {
    return this.topics.map((t) => ({ ...t }));
  }

  public async getTopicById(id: number): Promise<Topic | null> {
    return this.topics.find((t) => t.id === id) ?? null;
  }

  public async createTopic(topic: Omit<Topic, 'id'>): Promise<Topic> {
    const created: Topic = { ...topic, id: this.topicSeq++ };
    this.topics.push(created);
    return { ...created };
  }

  public async updateTopic(topic: Topic): Promise<void> {
    const idx = this.topics.findIndex((t) => t.id === topic.id);
    if (idx !== -1) this.topics[idx] = { ...topic };
  }

  public async deleteTopic(id: number): Promise<void> {
    this.topics = this.topics.filter((t) => t.id !== id);
  }

  public async getAllTags(): Promise<Tag[]> {
    return this.tags.map((t) => ({ ...t }));
  }

  public async getTagById(id: number): Promise<Tag | null> {
    return this.tags.find((t) => t.id === id) ?? null;
  }

  public async createTag(tag: Omit<Tag, 'id'>): Promise<Tag> {
    const created: Tag = { ...tag, id: this.tagSeq++ };
    this.tags.push(created);
    return { ...created };
  }

  public async updateTag(tag: Tag): Promise<void> {
    const idx = this.tags.findIndex((t) => t.id === tag.id);
    if (idx !== -1) this.tags[idx] = { ...tag };
  }

  public async deleteTag(id: number): Promise<void> {
    this.tags = this.tags.filter((t) => t.id !== id);
  }

  public async getAllPersons(): Promise<Person[]> {
    return this.persons.map((p) => ({ ...p }));
  }

  public async getPersonById(id: number): Promise<Person | null> {
    return this.persons.find((p) => p.id === id) ?? null;
  }

  public async createPerson(person: Omit<Person, 'id'>): Promise<Person> {
    const created: Person = { ...person, id: this.personSeq++ };
    this.persons.push(created);
    return { ...created };
  }

  public async updatePerson(person: Person): Promise<void> {
    const idx = this.persons.findIndex((p) => p.id === person.id);
    if (idx !== -1) this.persons[idx] = { ...person };
  }

  public async deletePerson(id: number): Promise<void> {
    this.persons = this.persons.filter((p) => p.id !== id);
  }

  public async getAllImpactLevels(): Promise<ImpactLevel[]> {
    return this.impactLevels.map((l) => ({ ...l }));
  }

  public async getImpactLevelById(id: number): Promise<ImpactLevel | null> {
    return this.impactLevels.find((l) => l.id === id) ?? null;
  }

  public async createImpactLevel(level: Omit<ImpactLevel, 'id'>): Promise<ImpactLevel> {
    const created: ImpactLevel = { ...level, id: this.impactSeq++ };
    this.impactLevels.push(created);
    return { ...created };
  }

  public async updateImpactLevel(level: ImpactLevel): Promise<void> {
    const idx = this.impactLevels.findIndex((l) => l.id === level.id);
    if (idx !== -1) this.impactLevels[idx] = { ...level };
  }

  public async deleteImpactLevel(id: number): Promise<void> {
    this.impactLevels = this.impactLevels.filter((l) => l.id !== id);
  }

  public async getAllAgeGroups(): Promise<AgeGroup[]> {
    return this.ageGroups.map((g) => ({ ...g }));
  }

  public async getAgeGroupById(id: number): Promise<AgeGroup | null> {
    return this.ageGroups.find((g) => g.id === id) ?? null;
  }

  public async updateAgeGroup(group: AgeGroup): Promise<void> {
    const idx = this.ageGroups.findIndex((g) => g.id === group.id);
    if (idx !== -1) this.ageGroups[idx] = { ...group };
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

  // ViewEvent + IDownloadEventRepository
  public addViewEvent(event: Omit<ViewEvent, 'id'>): ViewEvent {
    const created: ViewEvent = { ...event, id: this.viewSeq++ };
    this.viewEvents.push(created);
    return { ...created };
  }

  public getAllViewEvents(): ViewEvent[] {
    return this.viewEvents.map((v) => ({ ...v }));
  }

  public async createDownloadEvent(event: Omit<DownloadEvent, 'id'>): Promise<DownloadEvent> {
    const created: DownloadEvent = { ...event, id: this.downloadSeq++ };
    this.downloadEvents.push(created);
    return { ...created };
  }

  public async getDownloadEventsByContentId(contentId: number): Promise<DownloadEvent[]> {
    return this.downloadEvents.filter((e) => e.contentId === contentId).map((e) => ({ ...e }));
  }

  public async getDownloadEventsByUserId(userId: number): Promise<DownloadEvent[]> {
    return this.downloadEvents.filter((e) => e.userId === userId).map((e) => ({ ...e }));
  }

  public async getAllDownloadEvents(): Promise<DownloadEvent[]> {
    return this.downloadEvents.map((e) => ({ ...e }));
  }

  // IInteractionRepository
  public async getLike(userId: number, contentId: number): Promise<ContentLike | null> {
    const found = this.likes.find((l) => l.userId === userId && l.contentId === contentId);
    return found ? { ...found } : null;
  }

  public async createLike(like: ContentLike): Promise<boolean> {
    if (this.likes.some((l) => l.userId === like.userId && l.contentId === like.contentId)) {
      return false;
    }
    this.likes.push({ ...like });
    return true;
  }

  public async deleteLike(userId: number, contentId: number): Promise<boolean> {
    const before = this.likes.length;
    this.likes = this.likes.filter((l) => !(l.userId === userId && l.contentId === contentId));
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

  public async getBookmark(userId: number, contentId: number): Promise<ContentBookmark | null> {
    const found = this.bookmarks.find((b) => b.userId === userId && b.contentId === contentId);
    return found ? { ...found } : null;
  }

  public async createBookmark(bookmark: ContentBookmark): Promise<boolean> {
    if (
      this.bookmarks.some(
        (b) => b.userId === bookmark.userId && b.contentId === bookmark.contentId,
      )
    ) {
      return false;
    }
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
  public async deleteSessionsByUserId(userId: number): Promise<number> {
    const before = this.sessions.length;
    this.sessions = this.sessions.filter((s) => s.userId !== userId);
    return before - this.sessions.length;
  }

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
    this.viewEvents = this.viewEvents.map((ev) => {
      if (ev.userId === userId) {
        count += 1;
        return { ...ev, userId: null };
      }
      return ev;
    });
    return count;
  }

  public async anonymizeDownloadEventsByUserId(userId: number): Promise<number> {
    let count = 0;
    this.downloadEvents = this.downloadEvents.map((ev) => {
      if (ev.userId === userId) {
        count += 1;
        return { ...ev, userId: null };
      }
      return ev;
    });
    return count;
  }

  public async anonymizeOptionalCommentsByUserId(
    userId: number,
    deletedDisplayName: string,
  ): Promise<number> {
    let count = 0;
    this.simulatedComments = this.simulatedComments.map((c) => {
      if (c.userId === userId) {
        count += 1;
        return { ...c, authorDisplayName: deletedDisplayName };
      }
      return c;
    });
    return count;
  }

  public async deleteOptionalTopicAffinitiesByUserId(): Promise<number> {
    return 0;
  }

  // IAdminRepository
  public async getStaffPermissionsByUserId(userId: number): Promise<StaffPermission[]> {
    return this.staffPermissions.filter((p) => p.userId === userId).map((p) => ({ ...p }));
  }

  public async replaceStaffPermissions(
    userId: number,
    permissions: Omit<StaffPermission, 'id'>[],
  ): Promise<StaffPermission[]> {
    this.staffPermissions = this.staffPermissions.filter((p) => p.userId !== userId);
    const created = permissions.map((p) => ({ ...p, userId, id: this.staffPermSeq++ }));
    this.staffPermissions.push(...created);
    return created.map((p) => ({ ...p }));
  }

  public async getAllFeatureFlags(): Promise<FeatureFlag[]> {
    return this.featureFlags.map((f) => ({ ...f }));
  }

  public async upsertFeatureFlag(flag: FeatureFlag): Promise<void> {
    const idx = this.featureFlags.findIndex((f) => f.key === flag.key);
    if (idx !== -1) {
      this.featureFlags[idx] = { ...flag };
    } else {
      this.featureFlags.push({ ...flag });
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
      if (idx !== -1) {
        this.siteSettings[idx] = { ...s };
      } else {
        this.siteSettings.push({ ...s });
      }
    }
  }

  public asAdminRepository(): IAdminRepository {
    return {
      getUserById: (id) => this.getUserById(id),
      getUserByNormalizedEmail: (email) => this.getUserByNormalizedEmail(email),
      getUserByNormalizedPhoneNumber: (phone) => this.getUserByNormalizedPhoneNumber(phone),
      getAllUsers: () => this.getAllUsers(),
      createUser: (user) => this.createUser(user),
      updateUser: (user) => this.updateUser(user),
      deleteSessionsByUserId: async (userId) => {
        await this.deleteSessionsByUserId(userId);
      },
      getStaffPermissionsByUserId: (userId) => this.getStaffPermissionsByUserId(userId),
      replaceStaffPermissions: (userId, permissions) =>
        this.replaceStaffPermissions(userId, permissions),
      getAllFeatureFlags: () => this.getAllFeatureFlags(),
      upsertFeatureFlag: (flag) => this.upsertFeatureFlag(flag),
      getAllSiteSettings: () => this.getAllSiteSettings(),
      getSiteSettingByKey: (key) => this.getSiteSettingByKey(key),
      upsertSiteSettings: (settings) => this.upsertSiteSettings(settings),
      getActiveAgeGroups: () => this.getActiveAgeGroups(),
    };
  }
}

function buildTestUserPayload(
  partial: {
    email?: string | null;
    phoneNumber?: string | null;
    displayName: string;
    role: AppUser['role'];
    ageGroupId: number | null;
    passwordHash?: string | null;
    passwordSalt?: string | null;
  },
  nowIso: string,
): Omit<AppUser, 'id'> {
  return {
    email: partial.email ?? null,
    normalizedEmail: partial.email ? partial.email.trim().toLowerCase() : null,
    phoneNumber: partial.phoneNumber ?? null,
    normalizedPhoneNumber: partial.phoneNumber ?? null,
    displayName: partial.displayName,
    role: partial.role,
    ageGroupId: partial.ageGroupId,
    personalizationEnabled: false,
    emailConfirmed: Boolean(partial.email),
    phoneNumberConfirmed: Boolean(partial.phoneNumber),
    mustChangePassword: false,
    isActive: true,
    isDeleted: false,
    deletedAt: null,
    failedLoginCount: 0,
    lockoutEnd: null,
    passwordHash: partial.passwordHash ?? 'hash',
    passwordSalt: partial.passwordSalt ?? 'salt',
    createdAt: nowIso,
    lastLoginAt: null,
  };
}

export const stage15Tests: UnitTestCase[] = [
  {
    id: 'stage15-like-unlike-and-guest-reject',
    nameKey: 'tests.stage15.likeUnlikeAndGuestReject.name',
    descriptionKey: 'tests.stage15.likeUnlikeAndGuestReject.desc',
    run: async () => {
      const clock = new Stage15FakeClock();
      const logger = new AppLogger(clock, `meraj_s15_like_${Date.now()}`, 50);
      try {
        const harness = new MemoryStage15Harness();
        const ages = await harness.getActiveAgeGroups();
        const adultAge = ages.find((a) => a.key === 'adult')!;

        const author = await harness.createUser(
          buildTestUserPayload(
            {
              email: 'author-like@meraj.local',
              displayName: 'نویسنده‌ی تست لایک',
              role: 'Staff',
              ageGroupId: adultAge.id,
            },
            clock.nowUtcIso(),
          ),
        );
        const member = await harness.createUser(
          buildTestUserPayload(
            {
              email: 'member-like@meraj.local',
              displayName: 'عضو تست لایک',
              role: 'Member',
              ageGroupId: adultAge.id,
            },
            clock.nowUtcIso(),
          ),
        );

        const content = await harness.createContentItem({
          title: 'محتوای آزمایشی لایک',
          slug: 'stage15-like-test-item',
          summary: 'خلاصه',
          body: null,
          format: 'Article',
          impactLevelId: 1,
          status: ContentStatus.Published,
          publishedAt: clock.nowUtcIso(),
          readWatchMinutes: 5,
          thumbnailKey: null,
          isFeatured: false,
          languageCode: 'fa',
          searchText: 'محتوای آزمایشی لایک',
          viewCount: 0,
          downloadCount: 0,
          likeCount: 0,
          createdById: author.id,
          createdAt: clock.nowUtcIso(),
          updatedAt: clock.nowUtcIso(),
        });

        const interactionService = new InteractionService(
          harness,
          harness,
          harness,
          clock,
          logger,
        );

        // 1) Guest click rejected with AUTH_REQUIRED
        const guestLike = await interactionService.toggleLikeAsync(null, content.id);
        assertEqual(guestLike.ok, false, 'Guest must not be able to like content');
        if (!guestLike.ok) {
          assertEqual(guestLike.errorCode, 'AUTH_REQUIRED', 'Guest like must return AUTH_REQUIRED');
        }

        // 2) First click by real member -> liked=true, likeCount=1
        const firstClick = await interactionService.toggleLikeAsync(member, content.id);
        assertEqual(firstClick.ok, true, 'Member first like must succeed');
        if (firstClick.ok) {
          assertEqual(firstClick.liked, true, 'First click must set liked=true');
          assertEqual(firstClick.likeCount, 1, 'First click must set likeCount=1');
        }
        const storedAfterFirst = await harness.getContentItemById(content.id);
        assertEqual(storedAfterFirst?.likeCount, 1, 'ContentItem.likeCount must sync to 1');

        // 3) Second click by same member -> liked=false, likeCount=0
        const secondClick = await interactionService.toggleLikeAsync(member, content.id);
        assertEqual(secondClick.ok, true, 'Member unlike must succeed');
        if (secondClick.ok) {
          assertEqual(secondClick.liked, false, 'Second click must toggle liked=false');
          assertEqual(secondClick.likeCount, 0, 'Second click must drop likeCount back to 0');
        }
        const storedAfterSecond = await harness.getContentItemById(content.id);
        assertEqual(storedAfterSecond?.likeCount, 0, 'ContentItem.likeCount must never go negative');
      } finally {
        logger.clearLogs();
      }
    },
  },
  {
    id: 'stage15-bookmarks-and-privacy',
    nameKey: 'tests.stage15.bookmarksAndPrivacy.name',
    descriptionKey: 'tests.stage15.bookmarksAndPrivacy.desc',
    run: async () => {
      const clock = new Stage15FakeClock();
      const logger = new AppLogger(clock, `meraj_s15_bm_${Date.now()}`, 50);
      try {
        const harness = new MemoryStage15Harness();
        const ages = await harness.getActiveAgeGroups();
        const adultAge = ages.find((a) => a.key === 'adult')!;
        const childAge = ages.find((a) => a.key === 'child')!;

        const author = await harness.createUser(
          buildTestUserPayload(
            {
              email: 'author-bm@meraj.local',
              displayName: 'نویسنده‌ی تست نشانک',
              role: 'Staff',
              ageGroupId: adultAge.id,
            },
            clock.nowUtcIso(),
          ),
        );
        const memberA = await harness.createUser(
          buildTestUserPayload(
            {
              email: 'member-a-bm@meraj.local',
              displayName: 'عضو اول',
              role: 'Member',
              ageGroupId: adultAge.id,
            },
            clock.nowUtcIso(),
          ),
        );
        const memberB = await harness.createUser(
          buildTestUserPayload(
            {
              email: 'member-b-bm@meraj.local',
              displayName: 'عضو دوم',
              role: 'Member',
              ageGroupId: adultAge.id,
            },
            clock.nowUtcIso(),
          ),
        );

        const topic = await harness.createTopic({
          parentId: null,
          name: 'موضوع تست علاقه‌مندی',
          slug: 'bookmark-test-topic',
          icon: null,
          sortOrder: 1,
          isActive: true,
        });

        const content = await harness.createContentItem({
          title: 'محتوای بزرگسال برای تست نشانک',
          slug: 'stage15-bookmark-item',
          summary: 'خلاصه',
          body: null,
          format: 'Book',
          impactLevelId: 1,
          status: ContentStatus.Published,
          publishedAt: clock.nowUtcIso(),
          readWatchMinutes: 20,
          thumbnailKey: null,
          isFeatured: false,
          languageCode: 'fa',
          searchText: 'محتوای بزرگسال',
          viewCount: 0,
          downloadCount: 0,
          likeCount: 0,
          createdById: author.id,
          createdAt: clock.nowUtcIso(),
          updatedAt: clock.nowUtcIso(),
        });
        await harness.replaceContentTopics(content.id, [topic.id]);
        await harness.replaceContentAgeGroups(content.id, [adultAge.id]);

        const interactionService = new InteractionService(
          harness,
          harness,
          harness,
          clock,
          logger,
        );

        // Add bookmark for A
        const addRes = await interactionService.toggleBookmarkAsync(memberA, content.id);
        assertEqual(addRes.ok, true, 'Adding bookmark must succeed');
        if (addRes.ok) {
          assertEqual(addRes.bookmarked, true, 'Bookmark state must be true');
        }

        // Member A sees bookmark under Adult age
        const ownBookmarks = await interactionService.getUserBookmarksAsync(
          memberA,
          memberA.id,
          adultAge,
        );
        assertEqual(ownBookmarks.ok, true, 'Owner must be able to read own bookmarks');
        if (ownBookmarks.ok) {
          assertEqual(ownBookmarks.items.length, 1, 'Member A must see 1 bookmarked item');
          assertEqual(ownBookmarks.items[0].primaryTopicName, topic.name, 'Primary topic name must resolve');
        }

        // Strict Child safety filter hides Adult-only bookmarked item
        const childView = await interactionService.getUserBookmarksAsync(
          memberA,
          memberA.id,
          childAge,
        );
        assertEqual(childView.ok, true, 'Owner read under child age must succeed');
        if (childView.ok) {
          assertEqual(childView.items.length, 0, 'Adult-only bookmark must be filtered out in child age mode');
        }

        // Strict privacy: Member B and Guest rejected with FORBIDDEN
        const otherRead = await interactionService.getUserBookmarksAsync(
          memberB,
          memberA.id,
          adultAge,
        );
        assertEqual(otherRead.ok, false, 'Member B must not read Member A bookmarks');
        if (!otherRead.ok) {
          assertEqual(otherRead.errorCode, 'FORBIDDEN', 'Cross-user bookmarks access must return FORBIDDEN');
        }

        const guestRead = await interactionService.getUserBookmarksAsync(
          null,
          memberA.id,
          adultAge,
        );
        assertEqual(guestRead.ok, false, 'Guest must not read bookmarks');
        if (!guestRead.ok) {
          assertEqual(guestRead.errorCode, 'FORBIDDEN', 'Guest bookmarks access must return FORBIDDEN');
        }

        // Member A removes bookmark
        const removeRes = await interactionService.toggleBookmarkAsync(memberA, content.id);
        assertEqual(removeRes.ok, true, 'Removing bookmark must succeed');
        if (removeRes.ok) {
          assertEqual(removeRes.bookmarked, false, 'Bookmark state after second toggle must be false');
        }
        const afterRemove = await interactionService.getUserBookmarksAsync(
          memberA,
          memberA.id,
          adultAge,
        );
        if (afterRemove.ok) {
          assertEqual(afterRemove.items.length, 0, 'Bookmarks list must be empty after removal');
        }
      } finally {
        logger.clearLogs();
      }
    },
  },
  {
    id: 'stage15-download-history-privacy',
    nameKey: 'tests.stage15.downloadHistoryPrivacy.name',
    descriptionKey: 'tests.stage15.downloadHistoryPrivacy.desc',
    run: async () => {
      const clock = new Stage15FakeClock();
      const logger = new AppLogger(clock, `meraj_s15_dl_${Date.now()}`, 50);
      try {
        const harness = new MemoryStage15Harness();
        const ages = await harness.getActiveAgeGroups();
        const adultAge = ages.find((a) => a.key === 'adult')!;
        const hasher = new BrowserPasswordHasher();
        const tokenStore = new MemorySessionTokenStore();

        const author = await harness.createUser(
          buildTestUserPayload(
            {
              email: 'author-dl@meraj.local',
              displayName: 'نویسنده‌ی دانلود',
              role: 'Staff',
              ageGroupId: adultAge.id,
            },
            clock.nowUtcIso(),
          ),
        );
        const memberA = await harness.createUser(
          buildTestUserPayload(
            {
              email: 'member-a-dl@meraj.local',
              displayName: 'کاربر الف',
              role: 'Member',
              ageGroupId: adultAge.id,
            },
            clock.nowUtcIso(),
          ),
        );
        const memberB = await harness.createUser(
          buildTestUserPayload(
            {
              email: 'member-b-dl@meraj.local',
              displayName: 'کاربر ب',
              role: 'Member',
              ageGroupId: adultAge.id,
            },
            clock.nowUtcIso(),
          ),
        );

        const content = await harness.createContentItem({
          title: 'کتابچه‌ی راهنمای پژوهش',
          slug: 'research-guide-pdf',
          summary: 'خلاصه',
          body: null,
          format: 'Pdf',
          impactLevelId: 1,
          status: ContentStatus.Published,
          publishedAt: clock.nowUtcIso(),
          readWatchMinutes: 12,
          thumbnailKey: null,
          isFeatured: false,
          languageCode: 'fa',
          searchText: 'کتابچه‌ی راهنمای پژوهش',
          viewCount: 0,
          downloadCount: 1,
          likeCount: 0,
          createdById: author.id,
          createdAt: clock.nowUtcIso(),
          updatedAt: clock.nowUtcIso(),
        });

        const [file] = await harness.replaceFiles(content.id, [
          {
            contentId: content.id,
            kind: ContentFileKind.Main,
            storageType: FileStorageType.Local,
            storageKey: 'private/vault/guide.pdf',
            externalUrl: null,
            originalFileName: 'guide.pdf',
            mimeType: 'application/pdf',
            sizeBytes: 2048,
            isDownloadable: true,
            sortOrder: 0,
          },
        ]);

        await harness.createDownloadEvent({
          kind: DownloadKind.File,
          contentId: content.id,
          fileId: file.id,
          userId: memberA.id,
          ageGroupId: adultAge.id,
          occurredAt: clock.nowUtcIso(),
        });

        const profileService = new ProfileService({
          authRepository: harness,
          contentRepository: harness,
          interactionRepository: harness,
          downloadEventRepository: harness,
          cleanupRepository: harness,
          passwordHasher: hasher,
          sessionTokenStore: tokenStore,
          clock,
          logger,
          deletedDisplayName: 'کاربر حذف‌شده',
        });

        // Owner sees own download history
        const ownHistory = await profileService.getUserDownloadHistoryAsync(memberA, memberA.id);
        assertEqual(ownHistory.ok, true, 'Owner must see own download history');
        if (ownHistory.ok) {
          assertEqual(ownHistory.entries.length, 1, 'Owner download history must have 1 entry');
          assertEqual(ownHistory.entries[0].contentTitle, content.title, 'Content title must match');
          assertEqual(ownHistory.entries[0].fileName, 'guide.pdf', 'File name must match');
        }

        // Cross-user and guest rejected with FORBIDDEN
        const otherHistory = await profileService.getUserDownloadHistoryAsync(
          memberB,
          memberA.id,
        );
        assertEqual(otherHistory.ok, false, 'Member B must not view Member A download history');
        if (!otherHistory.ok) {
          assertEqual(otherHistory.errorCode, 'FORBIDDEN', 'Cross-user download history must return FORBIDDEN');
        }

        const guestHistory = await profileService.getUserDownloadHistoryAsync(null, memberA.id);
        assertEqual(guestHistory.ok, false, 'Guest must not view download history');
        if (!guestHistory.ok) {
          assertEqual(guestHistory.errorCode, 'FORBIDDEN', 'Guest download history must return FORBIDDEN');
        }
      } finally {
        logger.clearLogs();
      }
    },
  },
  {
    id: 'stage15-profile-update-validation',
    nameKey: 'tests.stage15.profileUpdateValidation.name',
    descriptionKey: 'tests.stage15.profileUpdateValidation.desc',
    run: async () => {
      const clock = new Stage15FakeClock();
      const logger = new AppLogger(clock, `meraj_s15_prof_${Date.now()}`, 50);
      try {
        const harness = new MemoryStage15Harness();
        const ages = await harness.getActiveAgeGroups();
        const adultAge = ages.find((a) => a.key === 'adult')!;
        const teenAge = ages.find((a) => a.key === 'teen')!;
        const hasher = new BrowserPasswordHasher();
        const tokenStore = new MemorySessionTokenStore();

        const member = await harness.createUser(
          buildTestUserPayload(
            {
              email: 'member-prof@meraj.local',
              displayName: 'نام اولیه',
              role: 'Member',
              ageGroupId: adultAge.id,
            },
            clock.nowUtcIso(),
          ),
        );

        const profileService = new ProfileService({
          authRepository: harness,
          contentRepository: harness,
          interactionRepository: harness,
          downloadEventRepository: harness,
          cleanupRepository: harness,
          passwordHasher: hasher,
          sessionTokenStore: tokenStore,
          clock,
          logger,
          deletedDisplayName: 'کاربر حذف‌شده',
        });

        // Empty displayName rejected
        const emptyRes = await profileService.updateProfileAsync(member, {
          displayName: '   ',
          ageGroupId: teenAge.id,
        });
        assertEqual(emptyRes.ok, false, 'Empty displayName must be rejected');
        if (!emptyRes.ok) {
          assertEqual(emptyRes.errorCode, 'INVALID_DISPLAY_NAME', 'Empty displayName must return INVALID_DISPLAY_NAME');
        }

        // Over 60 chars rejected
        const overLimit = 'الف'.repeat(61);
        const longRes = await profileService.updateProfileAsync(member, {
          displayName: overLimit,
          ageGroupId: teenAge.id,
        });
        assertEqual(longRes.ok, false, 'DisplayName > 60 chars must be rejected');
        if (!longRes.ok) {
          assertEqual(longRes.errorCode, 'INVALID_DISPLAY_NAME', 'Over-60 displayName must return INVALID_DISPLAY_NAME');
        }

        // Invalid ageGroupId rejected
        const badAgeRes = await profileService.updateProfileAsync(member, {
          displayName: 'نام معتبر',
          ageGroupId: 999999,
        });
        assertEqual(badAgeRes.ok, false, 'Non-existent ageGroupId must be rejected');
        if (!badAgeRes.ok) {
          assertEqual(badAgeRes.errorCode, 'INVALID_AGE_GROUP', 'Invalid ageGroupId must return INVALID_AGE_GROUP');
        }

        // Valid update persisted in users table
        const validRes = await profileService.updateProfileAsync(member, {
          displayName: '  پژوهشگر جوان  ',
          ageGroupId: teenAge.id,
        });
        assertEqual(validRes.ok, true, 'Valid profile update must succeed');
        if (validRes.ok) {
          assertEqual(validRes.user.displayName, 'پژوهشگر جوان', 'Trimmed displayName must be saved');
          assertEqual(validRes.user.ageGroupId, teenAge.id, 'Updated ageGroupId must match teenAge');
          assertEqual(validRes.ageGroup.key, 'teen', 'Returned ageGroup must be teen');
        }

        const stored = await harness.getUserById(member.id);
        assertEqual(stored?.displayName, 'پژوهشگر جوان', 'Users store must persist updated displayName');
        assertEqual(stored?.ageGroupId, teenAge.id, 'Users store must persist updated ageGroupId');
      } finally {
        logger.clearLogs();
      }
    },
  },
  {
    id: 'stage15-account-deletion-rule-67',
    nameKey: 'tests.stage15.accountDeletionRule67.name',
    descriptionKey: 'tests.stage15.accountDeletionRule67.desc',
    run: async () => {
      const clock = new Stage15FakeClock();
      const logger = new AppLogger(clock, `meraj_s15_del_${Date.now()}`, 50);
      try {
        const harness = new MemoryStage15Harness();
        const ages = await harness.getActiveAgeGroups();
        const adultAge = ages.find((a) => a.key === 'adult')!;
        const hasher = new BrowserPasswordHasher();
        const tokenStore = new MemorySessionTokenStore();
        const rateLimiter = new RateLimiter(clock, 50, 60_000);

        const authService = new AuthService(
          harness,
          hasher,
          new MemoryNullEmailSender(),
          clock,
          logger,
          tokenStore,
          {
            confirmSubject: 'confirm',
            confirmBody: '{{link}}',
            resetSubject: 'reset',
            resetBody: '{{link}}',
          },
          rateLimiter,
        );

        const author = await harness.createUser(
          buildTestUserPayload(
            {
              email: 'author-del@meraj.local',
              displayName: 'نویسنده‌ی مقاله',
              role: 'Staff',
              ageGroupId: adultAge.id,
            },
            clock.nowUtcIso(),
          ),
        );

        const rawPassword = 'StrongPassword#2026';
        const { hash, salt } = await hasher.hashPassword(rawPassword);
        const memberX = await harness.createUser(
          buildTestUserPayload(
            {
              email: 'member-x-del@meraj.local',
              phoneNumber: '09123456789',
              displayName: 'علی رضایی',
              role: 'Member',
              ageGroupId: adultAge.id,
              passwordHash: hash,
              passwordSalt: salt,
            },
            clock.nowUtcIso(),
          ),
        );

        // Log Member X in via AuthService to create real session + browser token
        const loginRes = await authService.loginWithEmail({
          email: 'member-x-del@meraj.local',
          password: rawPassword,
        });
        assertEqual(loginRes.ok, true, 'Initial login must succeed before deletion');
        assert(tokenStore.getRawToken() !== null, 'Session raw token must exist before deletion');
        assertEqual((await harness.getAllSessions()).length, 1, '1 UserSession must exist before deletion');

        const content = await harness.createContentItem({
          title: 'مقاله‌ی تست حذف حساب',
          slug: 'stage15-delete-test-article',
          summary: 'خلاصه',
          body: null,
          format: 'Article',
          impactLevelId: 1,
          status: ContentStatus.Published,
          publishedAt: clock.nowUtcIso(),
          readWatchMinutes: 7,
          thumbnailKey: null,
          isFeatured: false,
          languageCode: 'fa',
          searchText: 'مقاله‌ی تست حذف حساب',
          viewCount: 1,
          downloadCount: 1,
          likeCount: 0,
          createdById: author.id,
          createdAt: clock.nowUtcIso(),
          updatedAt: clock.nowUtcIso(),
        });

        const interactionService = new InteractionService(
          harness,
          harness,
          harness,
          clock,
          logger,
        );
        const profileService = new ProfileService({
          authRepository: harness,
          contentRepository: harness,
          interactionRepository: harness,
          downloadEventRepository: harness,
          cleanupRepository: harness,
          passwordHasher: hasher,
          sessionTokenStore: tokenStore,
          clock,
          logger,
          deletedDisplayName: 'کاربر حذف‌شده',
        });

        // Member X likes, bookmarks, views, downloads, and leaves a simulated comment
        await interactionService.toggleLikeAsync(memberX, content.id);
        await interactionService.toggleBookmarkAsync(memberX, content.id);
        assertEqual((await harness.getContentItemById(content.id))?.likeCount, 1, 'likeCount must be 1 before deletion');

        harness.addViewEvent({
          contentId: content.id,
          userId: memberX.id,
          visitorId: 'visitor-x',
          ageGroupId: adultAge.id,
          primaryTopicId: null,
          occurredAt: clock.nowUtcIso(),
          isCounted: true,
        });
        await harness.createDownloadEvent({
          kind: DownloadKind.File,
          contentId: content.id,
          fileId: null,
          userId: memberX.id,
          ageGroupId: adultAge.id,
          occurredAt: clock.nowUtcIso(),
        });
        harness.simulatedComments.push({
          id: 1,
          userId: memberX.id,
          contentId: content.id,
          body: 'نظر ارزشمند کاربر',
          authorDisplayName: memberX.displayName,
        });

        // 1) Wrong password must fail with INVALID_PASSWORD and leave user intact
        const wrongRes = await profileService.deleteAccountAsync(memberX, {
          password: 'WrongPassword#999',
        });
        assertEqual(wrongRes.ok, false, 'Wrong password must reject account deletion');
        if (!wrongRes.ok) {
          assertEqual(wrongRes.errorCode, 'INVALID_PASSWORD', 'Wrong password errorCode must be INVALID_PASSWORD');
        }
        assertEqual((await harness.getLikesByUserId(memberX.id)).length, 1, 'Likes must remain after rejected delete');

        // 2) Correct password executes full Rule 6.7 cleanup & anonymization
        const deleteRes = await profileService.deleteAccountAsync(memberX, {
          password: rawPassword,
        });
        assertEqual(deleteRes.ok, true, 'Correct password must execute Rule 6.7 deletion');
        if (!deleteRes.ok) return;

        assertEqual(deleteRes.removedLikesCount, 1, '1 like must be removed');
        assertEqual(deleteRes.removedBookmarksCount, 1, '1 bookmark must be removed');
        assertEqual(deleteRes.anonymizedViewsCount, 1, '1 viewEvent must be anonymized');
        assertEqual(deleteRes.anonymizedDownloadsCount, 1, '1 downloadEvent must be anonymized');
        assertEqual(deleteRes.anonymizedCommentsCount, 1, '1 comment must be anonymized');

        // Likes & bookmarks removed, content likeCount decremented cleanly
        assertEqual((await harness.getLikesByUserId(memberX.id)).length, 0, 'User likes must be empty');
        assertEqual((await harness.getBookmarksByUserId(memberX.id)).length, 0, 'User bookmarks must be empty');
        assertEqual((await harness.getContentItemById(content.id))?.likeCount, 0, 'ContentItem.likeCount must reset to 0');

        // Session terminated and re-login rejected
        assertEqual(tokenStore.getRawToken(), null, 'Browser session token must be cleared');
        assertEqual((await harness.getAllSessions()).length, 0, 'All UserSessions for deleted user must be removed');
        assertEqual(await authService.getCurrentUser(), null, 'getCurrentUser() must return null after deletion');

        const reloginRes = await authService.loginWithEmail({
          email: 'member-x-del@meraj.local',
          password: rawPassword,
        });
        assertEqual(reloginRes.ok, false, 'Logging in with deleted email/password must fail');

        // ViewEvent & DownloadEvent kept with userId === null
        const allViews = harness.getAllViewEvents();
        const allDownloads = await harness.getAllDownloadEvents();
        assertEqual(allViews.length, 1, 'ViewEvent row must stay preserved for analytics');
        assertEqual(allViews[0].userId, null, 'ViewEvent.userId must be anonymized to null');
        assertEqual(allDownloads.length, 1, 'DownloadEvent row must stay preserved for analytics');
        assertEqual(allDownloads[0].userId, null, 'DownloadEvent.userId must be anonymized to null');

        // Simulated comment preserved with anonymous displayName «کاربر حذف‌شده»
        assertEqual(harness.simulatedComments.length, 1, 'Comment must stay preserved');
        assertEqual(
          harness.simulatedComments[0].authorDisplayName,
          'کاربر حذف‌شده',
          'Comment authorDisplayName must be anonymized to «کاربر حذف‌شده»',
        );

        // AppUser record anonymized (no PII, email/phone freed)
        const anonymizedUser = await harness.getUserById(memberX.id);
        assert(anonymizedUser !== null, 'AppUser record must remain for FK integrity');
        assertEqual(anonymizedUser?.email, null, 'AppUser.email must be null');
        assertEqual(anonymizedUser?.normalizedEmail, null, 'AppUser.normalizedEmail must be null');
        assertEqual(anonymizedUser?.phoneNumber, null, 'AppUser.phoneNumber must be null');
        assertEqual(anonymizedUser?.normalizedPhoneNumber, null, 'AppUser.normalizedPhoneNumber must be null');
        assertEqual(anonymizedUser?.passwordHash, null, 'AppUser.passwordHash must be null');
        assertEqual(anonymizedUser?.displayName, 'کاربر حذف‌شده', 'AppUser.displayName must become «کاربر حذف‌شده»');
        assertEqual(anonymizedUser?.isActive, false, 'AppUser.isActive must be false');
        assertEqual(anonymizedUser?.isDeleted, true, 'AppUser.isDeleted must be true');

        // Admin panel isolation: deleted user disappears from listMembers and cannot be reactivated
        const superAdmin = await harness.createUser(
          buildTestUserPayload(
            {
              email: 'superadmin-check@meraj.local',
              displayName: 'مدیرکل آزمایشی',
              role: 'SuperAdmin',
              ageGroupId: adultAge.id,
            },
            clock.nowUtcIso(),
          ),
        );
        const adminRepo = harness.asAdminRepository();
        const policyService = new PermissionPolicyService(adminRepo, logger);
        const userMgmtService = new UserManagementService(adminRepo, logger, policyService);
        const staffMgmtService = new StaffManagementService(
          adminRepo,
          hasher,
          clock,
          logger,
          policyService,
        );

        const adminAllMembers = await userMgmtService.listMembers(superAdmin, { status: 'all' });
        assertEqual(adminAllMembers.ok, true, 'SuperAdmin listMembers must succeed');
        assert(
          !(adminAllMembers.items ?? []).some((u) => u.id === memberX.id),
          'Deleted member must not appear in admin listMembers (all)',
        );
        const adminInactiveMembers = await userMgmtService.listMembers(superAdmin, {
          status: 'inactive',
        });
        assert(
          !(adminInactiveMembers.items ?? []).some((u) => u.id === memberX.id),
          'Deleted member must not appear in admin listMembers (inactive)',
        );

        const reactivateMemberRes = await userMgmtService.toggleMemberActive(
          superAdmin,
          memberX.id,
          true,
        );
        assertEqual(
          reactivateMemberRes.ok,
          false,
          'Admin reactivating a deleted member must be rejected',
        );
        assertEqual(
          reactivateMemberRes.errorCode,
          'CANNOT_MODIFY_DELETED_USER',
          'Reactivating a deleted member must return CANNOT_MODIFY_DELETED_USER',
        );
        const postToggleUser = await harness.getUserById(memberX.id);
        assertEqual(postToggleUser?.isActive, false, 'Deleted user isActive must remain false');
        assertEqual(postToggleUser?.isDeleted, true, 'Deleted user isDeleted must remain true');

        // Also ensure deleted staff accounts are excluded from listStaffAccounts & cannot be reactivated
        const staffUser = await harness.createUser(
          buildTestUserPayload(
            {
              email: 'staff-del-check@meraj.local',
              displayName: 'همکار آزمایشی حذف‌شده',
              role: 'Staff',
              ageGroupId: adultAge.id,
              passwordHash: hash,
              passwordSalt: salt,
            },
            clock.nowUtcIso(),
          ),
        );
        await profileService.deleteAccountAsync(staffUser, { password: rawPassword });
        const staffListRes = await staffMgmtService.listStaffAccounts(superAdmin);
        assertEqual(staffListRes.ok, true, 'listStaffAccounts must succeed');
        assert(
          !(staffListRes.items ?? []).some((item) => item.user.id === staffUser.id),
          'Deleted staff account must not appear in listStaffAccounts',
        );
        const reactivateStaffRes = await staffMgmtService.toggleStaffActive(
          superAdmin,
          staffUser.id,
          true,
        );
        assertEqual(reactivateStaffRes.ok, false, 'Reactivating deleted staff must be rejected');
        assertEqual(
          reactivateStaffRes.errorCode,
          'CANNOT_MODIFY_DELETED_USER',
          'Reactivating deleted staff must return CANNOT_MODIFY_DELETED_USER',
        );

        // 3) Real IndexedDB v9 likes/bookmarks + cleanup roundtrip (in browser)
        if (typeof indexedDB !== 'undefined') {
          const testDbName = `MerajAndishehDB_S15_${Date.now()}`;
          const store = new IndexedDbDataStore(
            testDbName,
            envConfig.databaseVersion,
            envConfig.metaStoreName,
          );
          try {
            const seeder = new DatabaseSeeder(store, logger);
            await seeder.seed();

            const storeNames = await store.getObjectStoreNames();
            for (const expectedStore of STAGE15_OBJECT_STORES) {
              assert(
                storeNames.includes(expectedStore),
                `Missing Stage 15 ObjectStore after Migration v${envConfig.databaseVersion}: ${expectedStore}`,
              );
            }

            const idbAuth = new IndexedDbAuthRepository(store);
            const idbContent = new IndexedDbContentRepository(store);
            const idbDownload = new IndexedDbDownloadEventRepository(store);
            const idbInteraction = new IndexedDbInteractionRepository(store);
            const idbCleanup = new IndexedDbAccountCleanupRepository(store);

            const idbUser = await idbAuth.createUser(
              buildTestUserPayload(
                {
                  email: 's15-idb@meraj.local',
                  displayName: 'کاربر پایگاه داده',
                  role: 'Member',
                  ageGroupId: adultAge.id,
                  passwordHash: hash,
                  passwordSalt: salt,
                },
                clock.nowUtcIso(),
              ),
            );

            const idbItem = await idbContent.createContentItem({
              title: 'محتوای تست IDB مرحله ۱۵',
              slug: 'idb-s15-item',
              summary: 'خلاصه',
              body: null,
              format: 'Article',
              impactLevelId: 1,
              status: ContentStatus.Published,
              publishedAt: clock.nowUtcIso(),
              readWatchMinutes: 5,
              thumbnailKey: null,
              isFeatured: false,
              languageCode: 'fa',
              searchText: 'محتوای تست IDB',
              viewCount: 0,
              downloadCount: 1,
              likeCount: 1,
              createdById: idbUser.id,
              createdAt: clock.nowUtcIso(),
              updatedAt: clock.nowUtcIso(),
            });

            await idbInteraction.createLike({
              userId: idbUser.id,
              contentId: idbItem.id,
              createdAt: clock.nowUtcIso(),
            });
            await idbInteraction.createBookmark({
              userId: idbUser.id,
              contentId: idbItem.id,
              createdAt: clock.nowUtcIso(),
            });
            await idbDownload.createDownloadEvent({
              kind: DownloadKind.File,
              contentId: idbItem.id,
              fileId: null,
              userId: idbUser.id,
              ageGroupId: adultAge.id,
              occurredAt: clock.nowUtcIso(),
            });

            const idbProfile = new ProfileService({
              authRepository: idbAuth,
              contentRepository: idbContent,
              interactionRepository: idbInteraction,
              downloadEventRepository: idbDownload,
              cleanupRepository: idbCleanup,
              passwordHasher: hasher,
              sessionTokenStore: new MemorySessionTokenStore(),
              clock,
              logger,
              deletedDisplayName: 'کاربر حذف‌شده',
            });

            const idbDel = await idbProfile.deleteAccountAsync(idbUser, {
              password: rawPassword,
            });
            assertEqual(idbDel.ok, true, 'IDB Rule 6.7 deletion must succeed');
            assertEqual(
              await idbInteraction.countLikesByContentId(idbItem.id),
              0,
              'IDB likes store must have 0 likes after deletion',
            );
            assertEqual(
              (await idbInteraction.getBookmarksByUserId(idbUser.id)).length,
              0,
              'IDB bookmarks store must have 0 bookmarks after deletion',
            );
            assertEqual(
              (await idbContent.getContentItemById(idbItem.id))?.likeCount,
              0,
              'IDB contentItem.likeCount must reset to 0',
            );
            const idbAllDl = await store.getAll<DownloadEvent>(STORE_NAMES.DOWNLOAD_EVENTS);
            assertEqual(idbAllDl.length, 1, 'IDB DownloadEvent must stay preserved');
            assertEqual(idbAllDl[0].userId, null, 'IDB DownloadEvent.userId must be null');
          } finally {
            store.close();
            indexedDB.deleteDatabase(testDbName);
          }
        }
      } finally {
        logger.clearLogs();
      }
    },
  },
];
