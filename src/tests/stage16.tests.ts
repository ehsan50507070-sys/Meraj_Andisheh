import type { IClock } from '../core/abstractions/IClock';
import type { IAdminRepository } from '../core/abstractions/adminRepository';
import type { IAuthRepository, ISessionTokenStore } from '../core/abstractions/authRepository';
import type { ICommentRepository } from '../core/abstractions/commentRepository';
import type { IContentRepository } from '../core/abstractions/contentRepository';
import type { IDownloadEventRepository } from '../core/abstractions/downloadRepository';
import type {
  IAccountCleanupRepository,
  IInteractionRepository,
} from '../core/abstractions/interactionRepository';
import type { ITaxonomyRepository } from '../core/abstractions/taxonomyRepository';
import type { DownloadEvent, ViewEvent } from '../core/domain/analytics';
import type { AppUser, AuthToken, UserSession } from '../core/domain/auth';
import {
  CommentStatus,
  type BlockedWord,
  type CommentItem,
  type CommentReport,
} from '../core/domain/comments';
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
import type { OtpCode } from '../core/domain/otp';
import type { PermissionKey, StaffPermission } from '../core/domain/permissions';
import { FEATURE_FLAG_KEYS, type FeatureFlag, type SiteSetting } from '../core/domain/settings';
import type {
  AgeGroup,
  ImpactLevel,
  Person,
  Tag,
  Topic,
} from '../core/domain/taxonomy';
import {
  CommentService,
  containsExternalOrWebLink,
} from '../core/services/commentService';
import { PermissionPolicyService } from '../core/services/permissionPolicyService';
import { ProfileService } from '../core/services/profileService';
import { SearchNormalizer } from '../core/services/searchNormalizer';
import { SystemClock } from '../infrastructure/clock/SystemClock';
import { envConfig } from '../infrastructure/config/envConfig';
import { IndexedDbAccountCleanupRepository } from '../infrastructure/data/IndexedDbAccountCleanupRepository';
import { IndexedDbAdminRepository } from '../infrastructure/data/IndexedDbAdminRepository';
import { IndexedDbAuthRepository } from '../infrastructure/data/IndexedDbAuthRepository';
import { IndexedDbCommentRepository } from '../infrastructure/data/IndexedDbCommentRepository';
import { IndexedDbContentRepository } from '../infrastructure/data/IndexedDbContentRepository';
import { IndexedDbDataStore } from '../infrastructure/data/IndexedDbDataStore';
import { IndexedDbDownloadEventRepository } from '../infrastructure/data/IndexedDbDownloadEventRepository';
import { IndexedDbInteractionRepository } from '../infrastructure/data/IndexedDbInteractionRepository';
import { IndexedDbTaxonomyRepository } from '../infrastructure/data/IndexedDbTaxonomyRepository';
import { STAGE16_OBJECT_STORES, STORE_NAMES } from '../infrastructure/data/migrations';
import { DatabaseSeeder, INITIAL_AGE_GROUPS } from '../infrastructure/data/seed';
import { AppLogger } from '../infrastructure/logging/AppLogger';
import { BrowserPasswordHasher } from '../infrastructure/security/BrowserPasswordHasher';
import { ensureStage16CommentsDefaultFlagAsync } from '../web/services/appContainer';
import { assert, assertEqual, type UnitTestCase } from './testRunner';

class Stage16FakeClock implements IClock {
  private iso: string;
  private readonly inner = new SystemClock();

  constructor(initialIso = '2026-11-23T10:00:00.000Z') {
    this.iso = initialIso;
  }

  public setUtcIso(nextIso: string): void {
    this.iso = nextIso;
  }

  public advanceMinutes(minutes: number): void {
    const next = new Date(this.now().getTime() + minutes * 60 * 1000);
    this.iso = next.toISOString();
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

class MemoryStage16Harness implements
  ICommentRepository,
  IContentRepository,
  ITaxonomyRepository,
  IAuthRepository,
  IDownloadEventRepository,
  IInteractionRepository,
  IAccountCleanupRepository
{
  private users: AppUser[] = [];
  private staffPermissions: StaffPermission[] = [];
  private sessions: UserSession[] = [];
  private authTokens: AuthToken[] = [];
  private otpCodes: OtpCode[] = [];
  private featureFlags: FeatureFlag[] = FEATURE_FLAG_KEYS.map((key) => ({
    key,
    isEnabled: key === 'Comments',
  }));
  private siteSettings: SiteSetting[] = [
    { key: 'Comments.MaxLength', value: '1000' },
  ];

  private ageGroups: AgeGroup[] = INITIAL_AGE_GROUPS.map((g, idx) => ({
    ...g,
    id: idx + 1,
  }));
  private topics: Topic[] = [];
  private tags: Tag[] = [];
  private persons: Person[] = [];
  private impactLevels: ImpactLevel[] = [
    { id: 1, name: 'عادی', sortOrder: 1 },
  ];

  private items: ContentItem[] = [];
  private sources: ContentSource[] = [];
  private files: ContentFile[] = [];
  private contentTopics: ContentTopic[] = [];
  private contentTags: ContentTag[] = [];
  private contentPersons: ContentPerson[] = [];
  private contentAgeGroups: ContentAgeGroup[] = [];

  private comments: CommentItem[] = [];
  private reports: CommentReport[] = [];
  private blockedWords: BlockedWord[] = [];
  private likes: ContentLike[] = [];
  private bookmarks: ContentBookmark[] = [];
  private viewEvents: ViewEvent[] = [];
  private downloadEvents: DownloadEvent[] = [];

  private userSeq = 10;
  private staffPermSeq = 1;
  private sessionSeq = 1;
  private tokenSeq = 1;
  private otpSeq = 1;
  private topicSeq = 1;
  private tagSeq = 1;
  private personSeq = 1;
  private impactSeq = 10;
  private itemSeq = 1;
  private sourceSeq = 1;
  private fileSeq = 1;
  private commentSeq = 1;
  private reportSeq = 1;
  private blockedWordSeq = 1;

  public getAgeGroupByKey(key: AgeGroup['key']): AgeGroup {
    const found = this.ageGroups.find((g) => g.key === key);
    if (!found) {
      throw new Error(`AgeGroup ${key} not found in harness`);
    }
    return { ...found };
  }

  public setCommentsFlagEnabled(enabled: boolean): void {
    const existing = this.featureFlags.find((f) => f.key === 'Comments');
    if (existing) {
      existing.isEnabled = enabled;
    } else {
      this.featureFlags.push({ key: 'Comments', isEnabled: enabled });
    }
  }

  public setMaxCommentLengthSetting(value: string): void {
    const existing = this.siteSettings.find((s) => s.key === 'Comments.MaxLength');
    if (existing) {
      existing.value = value;
    } else {
      this.siteSettings.push({ key: 'Comments.MaxLength', value });
    }
  }

  // ICommentRepository
  public async getCommentById(id: number): Promise<CommentItem | null> {
    const found = this.comments.find((c) => c.id === id);
    return found ? { ...found } : null;
  }

  public async getCommentsByContentId(contentId: number): Promise<CommentItem[]> {
    return this.comments.filter((c) => c.contentId === contentId).map((c) => ({ ...c }));
  }

  public async getCommentsByUserId(userId: number): Promise<CommentItem[]> {
    return this.comments.filter((c) => c.userId === userId).map((c) => ({ ...c }));
  }

  public async getCommentsByStatus(status: CommentStatus): Promise<CommentItem[]> {
    return this.comments.filter((c) => c.status === status).map((c) => ({ ...c }));
  }

  public async getAllComments(): Promise<CommentItem[]> {
    return this.comments.map((c) => ({ ...c }));
  }

  public async createComment(comment: Omit<CommentItem, 'id'>): Promise<CommentItem> {
    const created: CommentItem = { ...comment, id: this.commentSeq++ };
    this.comments.push(created);
    return { ...created };
  }

  public async updateComment(comment: CommentItem): Promise<void> {
    const idx = this.comments.findIndex((c) => c.id === comment.id);
    if (idx !== -1) {
      this.comments[idx] = { ...comment };
    }
  }

  public async deleteComment(id: number): Promise<void> {
    this.comments = this.comments.filter((c) => c.id !== id);
  }

  public async getReportById(id: number): Promise<CommentReport | null> {
    const found = this.reports.find((r) => r.id === id);
    return found ? { ...found } : null;
  }

  public async getReportByCommentAndUser(
    commentId: number,
    userId: number,
  ): Promise<CommentReport | null> {
    const found = this.reports.find(
      (r) => r.commentId === commentId && r.userId === userId,
    );
    return found ? { ...found } : null;
  }

  public async getReportsByCommentId(commentId: number): Promise<CommentReport[]> {
    return this.reports.filter((r) => r.commentId === commentId).map((r) => ({ ...r }));
  }

  public async getAllReports(): Promise<CommentReport[]> {
    return this.reports.map((r) => ({ ...r }));
  }

  public async createReport(report: Omit<CommentReport, 'id'>): Promise<CommentReport> {
    const created: CommentReport = { ...report, id: this.reportSeq++ };
    this.reports.push(created);
    return { ...created };
  }

  public async deleteReport(id: number): Promise<void> {
    this.reports = this.reports.filter((r) => r.id !== id);
  }

  public async deleteReportsByCommentId(commentId: number): Promise<number> {
    const before = this.reports.length;
    this.reports = this.reports.filter((r) => r.commentId !== commentId);
    return before - this.reports.length;
  }

  public async getAllBlockedWords(): Promise<BlockedWord[]> {
    return this.blockedWords.map((w) => ({ ...w }));
  }

  public async getBlockedWordById(id: number): Promise<BlockedWord | null> {
    const found = this.blockedWords.find((w) => w.id === id);
    return found ? { ...found } : null;
  }

  public async getBlockedWordByNormalizedWord(
    normalizedWord: string,
  ): Promise<BlockedWord | null> {
    const found = this.blockedWords.find((w) => w.word === normalizedWord);
    return found ? { ...found } : null;
  }

  public async createBlockedWord(entry: Omit<BlockedWord, 'id'>): Promise<BlockedWord> {
    const created: BlockedWord = { ...entry, id: this.blockedWordSeq++ };
    this.blockedWords.push(created);
    return { ...created };
  }

  public async deleteBlockedWord(id: number): Promise<void> {
    this.blockedWords = this.blockedWords.filter((w) => w.id !== id);
  }

  // IAdminRepository / IAuthRepository
  public async getUserById(id: number): Promise<AppUser | null> {
    const found = this.users.find((u) => u.id === id);
    return found ? { ...found } : null;
  }

  public async getUserByNormalizedEmail(normalizedEmail: string): Promise<AppUser | null> {
    if (!normalizedEmail) return null;
    const found = this.users.find((u) => u.normalizedEmail === normalizedEmail);
    return found ? { ...found } : null;
  }

  public async getUserByNormalizedPhoneNumber(
    normalizedPhoneNumber: string,
  ): Promise<AppUser | null> {
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

  public async getStaffPermissionsByUserId(userId: number): Promise<StaffPermission[]> {
    return this.staffPermissions.filter((p) => p.userId === userId).map((p) => ({ ...p }));
  }

  public async replaceStaffPermissions(
    userId: number,
    permissions: Omit<StaffPermission, 'id'>[],
  ): Promise<StaffPermission[]> {
    this.staffPermissions = this.staffPermissions.filter((p) => p.userId !== userId);
    const inserted = permissions.map((p) => ({ ...p, id: this.staffPermSeq++ }));
    this.staffPermissions.push(...inserted);
    return inserted.map((p) => ({ ...p }));
  }

  public async grantPermission(
    userId: number,
    permissionKey: PermissionKey,
    grantedAt: string,
    grantedById: number,
  ): Promise<void> {
    const existing = await this.getStaffPermissionsByUserId(userId);
    await this.replaceStaffPermissions(userId, [
      ...existing.map((p) => ({
        userId: p.userId,
        permissionKey: p.permissionKey,
        grantedAt: p.grantedAt,
        grantedById: p.grantedById,
      })),
      { userId, permissionKey, grantedAt, grantedById },
    ]);
  }

  public async getAllFeatureFlags(): Promise<FeatureFlag[]> {
    return this.featureFlags.map((f) => ({ ...f }));
  }

  public async upsertFeatureFlag(flag: FeatureFlag): Promise<void> {
    this.setCommentsFlagEnabled(flag.isEnabled);
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
      const idx = this.siteSettings.findIndex((item) => item.key === s.key);
      if (idx !== -1) {
        this.siteSettings[idx] = { ...s };
      } else {
        this.siteSettings.push({ ...s });
      }
    }
  }

  public async getActiveAgeGroups(): Promise<AgeGroup[]> {
    return this.ageGroups.filter((g) => g.isActive).map((g) => ({ ...g }));
  }

  // IAuthRepository remaining
  public async createOtpCode(otp: Omit<OtpCode, 'id'>): Promise<OtpCode> {
    const created = { ...otp, id: this.otpSeq++ };
    this.otpCodes.push(created);
    return created;
  }

  public async getOtpCodesByPhoneNumber(phoneNumber: string): Promise<OtpCode[]> {
    return this.otpCodes.filter((o) => o.phoneNumber === phoneNumber);
  }

  public async updateOtpCode(otp: OtpCode): Promise<void> {
    const idx = this.otpCodes.findIndex((o) => o.id === otp.id);
    if (idx !== -1) this.otpCodes[idx] = otp;
  }

  public async createAuthToken(token: Omit<AuthToken, 'id'>): Promise<AuthToken> {
    const created = { ...token, id: this.tokenSeq++ };
    this.authTokens.push(created);
    return created;
  }

  public async getAuthTokenByHash(tokenHash: string): Promise<AuthToken | null> {
    return this.authTokens.find((t) => t.tokenHash === tokenHash) ?? null;
  }

  public async updateAuthToken(token: AuthToken): Promise<void> {
    const idx = this.authTokens.findIndex((t) => t.id === token.id);
    if (idx !== -1) this.authTokens[idx] = token;
  }

  public async createSession(session: Omit<UserSession, 'id'>): Promise<UserSession> {
    const created = { ...session, id: this.sessionSeq++ };
    this.sessions.push(created);
    return created;
  }

  public async getSessionByTokenHash(tokenHash: string): Promise<UserSession | null> {
    return this.sessions.find((s) => s.tokenHash === tokenHash) ?? null;
  }

  public async updateSession(session: UserSession): Promise<void> {
    const idx = this.sessions.findIndex((s) => s.id === session.id);
    if (idx !== -1) this.sessions[idx] = session;
  }

  public async deleteSessionById(id: number): Promise<void> {
    this.sessions = this.sessions.filter((s) => s.id !== id);
  }

  public async deleteSessionByTokenHash(tokenHash: string): Promise<void> {
    this.sessions = this.sessions.filter((s) => s.tokenHash !== tokenHash);
  }

  public async ageGroupExists(ageGroupId: number): Promise<boolean> {
    return this.ageGroups.some((g) => g.id === ageGroupId);
  }

  // ITaxonomyRepository
  public async getAllTopics(): Promise<Topic[]> {
    return [...this.topics];
  }
  public async getTopicById(id: number): Promise<Topic | null> {
    return this.topics.find((t) => t.id === id) ?? null;
  }
  public async createTopic(topic: Omit<Topic, 'id'>): Promise<Topic> {
    const created = { ...topic, id: this.topicSeq++ };
    this.topics.push(created);
    return created;
  }
  public async updateTopic(topic: Topic): Promise<void> {
    const idx = this.topics.findIndex((t) => t.id === topic.id);
    if (idx !== -1) this.topics[idx] = topic;
  }
  public async deleteTopic(id: number): Promise<void> {
    this.topics = this.topics.filter((t) => t.id !== id);
  }
  public async getAllTags(): Promise<Tag[]> {
    return [...this.tags];
  }
  public async getTagById(id: number): Promise<Tag | null> {
    return this.tags.find((t) => t.id === id) ?? null;
  }
  public async createTag(tag: Omit<Tag, 'id'>): Promise<Tag> {
    const created = { ...tag, id: this.tagSeq++ };
    this.tags.push(created);
    return created;
  }
  public async updateTag(tag: Tag): Promise<void> {
    const idx = this.tags.findIndex((t) => t.id === tag.id);
    if (idx !== -1) this.tags[idx] = tag;
  }
  public async deleteTag(id: number): Promise<void> {
    this.tags = this.tags.filter((t) => t.id !== id);
  }
  public async getAllPersons(): Promise<Person[]> {
    return [...this.persons];
  }
  public async getPersonById(id: number): Promise<Person | null> {
    return this.persons.find((p) => p.id === id) ?? null;
  }
  public async createPerson(person: Omit<Person, 'id'>): Promise<Person> {
    const created = { ...person, id: this.personSeq++ };
    this.persons.push(created);
    return created;
  }
  public async updatePerson(person: Person): Promise<void> {
    const idx = this.persons.findIndex((p) => p.id === person.id);
    if (idx !== -1) this.persons[idx] = person;
  }
  public async deletePerson(id: number): Promise<void> {
    this.persons = this.persons.filter((p) => p.id !== id);
  }
  public async getAllImpactLevels(): Promise<ImpactLevel[]> {
    return [...this.impactLevels];
  }
  public async getImpactLevelById(id: number): Promise<ImpactLevel | null> {
    return this.impactLevels.find((l) => l.id === id) ?? null;
  }
  public async createImpactLevel(level: Omit<ImpactLevel, 'id'>): Promise<ImpactLevel> {
    const created = { ...level, id: this.impactSeq++ };
    this.impactLevels.push(created);
    return created;
  }
  public async updateImpactLevel(level: ImpactLevel): Promise<void> {
    const idx = this.impactLevels.findIndex((l) => l.id === level.id);
    if (idx !== -1) this.impactLevels[idx] = level;
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
    if (idx !== -1) this.ageGroups[idx] = group;
  }
  public async getContentTopicLinks(): Promise<ContentTopic[]> {
    return [...this.contentTopics];
  }
  public async countContentTagsByTagId(tagId: number): Promise<number> {
    return this.contentTags.filter((t) => t.tagId === tagId).length;
  }
  public async countContentPersonsByPersonId(personId: number): Promise<number> {
    return this.contentPersons.filter((p) => p.personId === personId).length;
  }
  public async countContentItemsByImpactLevelId(impactLevelId: number): Promise<number> {
    return this.items.filter((i) => i.impactLevelId === impactLevelId).length;
  }
  public async linkContentTopic(contentId: number, topicId: number): Promise<void> {
    this.contentTopics.push({ contentId, topicId });
  }

  // IContentRepository
  public async getAllContentItems(): Promise<ContentItem[]> {
    return this.items.map((i) => ({ ...i }));
  }
  public async getContentItemById(id: number): Promise<ContentItem | null> {
    return this.items.find((i) => i.id === id) ?? null;
  }
  public async getContentItemBySlug(slug: string): Promise<ContentItem | null> {
    return this.items.find((i) => i.slug === slug) ?? null;
  }
  public async createContentItem(item: Omit<ContentItem, 'id'>): Promise<ContentItem> {
    const created: ContentItem = { ...item, id: this.itemSeq++ };
    this.items.push(created);
    return { ...created };
  }
  public async updateContentItem(item: ContentItem): Promise<void> {
    const idx = this.items.findIndex((i) => i.id === item.id);
    if (idx !== -1) this.items[idx] = { ...item };
  }
  public async getSourcesByContentId(contentId: number): Promise<ContentSource[]> {
    return this.sources.filter((s) => s.contentId === contentId);
  }
  public async getAllSources(): Promise<ContentSource[]> {
    return [...this.sources];
  }
  public async replaceSources(
    contentId: number,
    sources: Omit<ContentSource, 'id'>[],
  ): Promise<ContentSource[]> {
    this.sources = this.sources.filter((s) => s.contentId !== contentId);
    const created = sources.map((s) => ({ ...s, id: this.sourceSeq++ }));
    this.sources.push(...created);
    return created;
  }
  public async getFilesByContentId(contentId: number): Promise<ContentFile[]> {
    return this.files.filter((f) => f.contentId === contentId);
  }
  public async getAllFiles(): Promise<ContentFile[]> {
    return [...this.files];
  }
  public async replaceFiles(
    contentId: number,
    files: Omit<ContentFile, 'id'>[],
  ): Promise<ContentFile[]> {
    this.files = this.files.filter((f) => f.contentId !== contentId);
    const created = files.map((f) => ({ ...f, id: this.fileSeq++ }));
    this.files.push(...created);
    return created;
  }
  public async getTopicIdsByContentId(contentId: number): Promise<number[]> {
    return this.contentTopics.filter((ct) => ct.contentId === contentId).map((ct) => ct.topicId);
  }
  public async getAllContentTopics(): Promise<ContentTopic[]> {
    return [...this.contentTopics];
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
    return [...this.contentTags];
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
    return [...this.contentPersons];
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
    return [...this.contentAgeGroups];
  }
  public async replaceContentAgeGroups(contentId: number, ageGroupIds: number[]): Promise<void> {
    this.contentAgeGroups = this.contentAgeGroups.filter((ca) => ca.contentId !== contentId);
    for (const ageGroupId of ageGroupIds) {
      this.contentAgeGroups.push({ contentId, ageGroupId });
    }
  }
  public async userExists(userId: number): Promise<boolean> {
    return this.users.some((u) => u.id === userId);
  }

  // IDownloadEventRepository
  public async createDownloadEvent(event: Omit<DownloadEvent, 'id'>): Promise<DownloadEvent> {
    const created: DownloadEvent = { ...event, id: this.downloadEvents.length + 1 };
    this.downloadEvents.push(created);
    return created;
  }
  public async getDownloadEventsByUserId(userId: number): Promise<DownloadEvent[]> {
    return this.downloadEvents.filter((e) => e.userId === userId);
  }

  public async getDownloadEventsByContentId(contentId: number): Promise<DownloadEvent[]> {
    return this.downloadEvents.filter((e) => e.contentId === contentId);
  }

  public async getAllDownloadEvents(): Promise<DownloadEvent[]> {
    return [...this.downloadEvents];
  }

  // IInteractionRepository
  public async getLike(userId: number, contentId: number): Promise<ContentLike | null> {
    return this.likes.find((l) => l.userId === userId && l.contentId === contentId) ?? null;
  }
  public async createLike(like: ContentLike): Promise<boolean> {
    this.likes.push(like);
    return true;
  }
  public async deleteLike(userId: number, contentId: number): Promise<boolean> {
    const before = this.likes.length;
    this.likes = this.likes.filter((l) => !(l.userId === userId && l.contentId === contentId));
    return this.likes.length !== before;
  }
  public async getLikesByUserId(userId: number): Promise<ContentLike[]> {
    return this.likes.filter((l) => l.userId === userId);
  }
  public async getLikesByContentId(contentId: number): Promise<ContentLike[]> {
    return this.likes.filter((l) => l.contentId === contentId);
  }
  public async countLikesByContentId(contentId: number): Promise<number> {
    return this.likes.filter((l) => l.contentId === contentId).length;
  }
  public async getBookmark(userId: number, contentId: number): Promise<ContentBookmark | null> {
    return (
      this.bookmarks.find((b) => b.userId === userId && b.contentId === contentId) ?? null
    );
  }
  public async createBookmark(bookmark: ContentBookmark): Promise<boolean> {
    this.bookmarks.push(bookmark);
    return true;
  }
  public async deleteBookmark(userId: number, contentId: number): Promise<boolean> {
    const before = this.bookmarks.length;
    this.bookmarks = this.bookmarks.filter(
      (b) => !(b.userId === userId && b.contentId === contentId),
    );
    return this.bookmarks.length !== before;
  }
  public async getBookmarksByUserId(userId: number): Promise<ContentBookmark[]> {
    return this.bookmarks.filter((b) => b.userId === userId);
  }
  public async countBookmarksByUserId(userId: number): Promise<number> {
    return this.bookmarks.filter((b) => b.userId === userId).length;
  }

  // IAccountCleanupRepository (also satisfies IAdminRepository.deleteSessionsByUserId)
  public async deleteSessionsByUserId(userId: number): Promise<number> {
    const count = this.sessions.filter((s) => s.userId === userId).length;
    this.sessions = this.sessions.filter((s) => s.userId !== userId);
    return count;
  }
  public async deleteAuthTokensByUserId(userId: number): Promise<number> {
    const count = this.authTokens.filter((t) => t.userId === userId).length;
    this.authTokens = this.authTokens.filter((t) => t.userId !== userId);
    return count;
  }
  public async deleteOtpCodesByPhoneNumber(phoneNumber: string): Promise<number> {
    const count = this.otpCodes.filter((o) => o.phoneNumber === phoneNumber).length;
    this.otpCodes = this.otpCodes.filter((o) => o.phoneNumber !== phoneNumber);
    return count;
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
    _deletedDisplayName: string,
  ): Promise<number> {
    return this.comments.filter((c) => c.userId === userId).length;
  }
  public async deleteOptionalTopicAffinitiesByUserId(): Promise<number> {
    return 0;
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

function createStage16Context() {
  const clock = new Stage16FakeClock('2026-11-23T10:00:00.000Z');
  const logger = new AppLogger(clock, `meraj_s16_test_${Date.now()}_${Math.random()}`, 100);
  const harness = new MemoryStage16Harness();
  const adminRepo = harness.asAdminRepository();
  const normalizer = new SearchNormalizer();
  const policyService = new PermissionPolicyService(adminRepo, logger);
  const commentService = new CommentService({
    commentRepository: harness,
    contentRepository: harness,
    adminRepository: adminRepo,
    taxonomyRepository: harness,
    permissionPolicyService: policyService,
    searchNormalizer: normalizer,
    clock,
    logger,
    deletedDisplayName: 'کاربر حذف‌شده',
  });
  return { clock, logger, harness, normalizer, policyService, commentService };
}

function buildTestUserPayload(
  overrides: Partial<Omit<AppUser, 'id'>>,
  nowIso: string,
): Omit<AppUser, 'id'> {
  const email = overrides.email ?? null;
  return {
    email,
    normalizedEmail: email ? email.trim().toUpperCase() : null,
    emailConfirmed: true,
    phoneNumber: null,
    normalizedPhoneNumber: null,
    phoneNumberConfirmed: false,
    passwordHash: null,
    passwordSalt: null,
    displayName: overrides.displayName ?? 'کاربر آزمایشی',
    role: overrides.role ?? 'Member',
    ageGroupId: overrides.ageGroupId ?? null,
    personalizationEnabled: true,
    mustChangePassword: false,
    isActive: true,
    isDeleted: false,
    deletedAt: null,
    failedLoginCount: 0,
    lockoutEnd: null,
    lastLoginAt: null,
    createdAt: nowIso,
    ...overrides,
  };
}

async function seedPublishedContent(
  harness: MemoryStage16Harness,
  creatorId: number,
  nowIso: string,
  title = 'مقاله آزمایشی مرحله ۱۶',
): Promise<ContentItem> {
  return harness.createContentItem({
    title,
    slug: `s16-article-${Math.random().toString(36).slice(2, 8)}`,
    summary: 'خلاصه محتوای آزمایشی برای بررسی بخش دیدگاه‌ها.',
    body: '<p>متن کامل</p>',
    format: 'Article',
    impactLevelId: 1,
    status: ContentStatus.Published,
    publishedAt: nowIso,
    readWatchMinutes: 4,
    thumbnailKey: null,
    isFeatured: false,
    languageCode: 'fa',
    searchText: title,
    viewCount: 0,
    downloadCount: 0,
    likeCount: 0,
    createdById: creatorId,
    createdAt: nowIso,
    updatedAt: nowIso,
  });
}

export const stage16Tests: UnitTestCase[] = [
  {
    id: 'stage16-child-safety-and-lifecycle',
    nameKey: 'tests.stage16.childSafetyAndLifecycle.name',
    descriptionKey: 'tests.stage16.childSafetyAndLifecycle.desc',
    run: async () => {
      const { clock, logger, harness, commentService } = createStage16Context();
      try {
        const childAge = harness.getAgeGroupByKey('child');
        const adultAge = harness.getAgeGroupByKey('adult');

        const superAdmin = await harness.createUser(
          buildTestUserPayload(
            { email: 'sa16@meraj.local', displayName: 'مدیرکل', role: 'SuperAdmin', ageGroupId: adultAge.id },
            clock.nowUtcIso(),
          ),
        );
        const moderator = await harness.createUser(
          buildTestUserPayload(
            { email: 'mod16@meraj.local', displayName: 'ناظر نظرات', role: 'Staff', ageGroupId: adultAge.id },
            clock.nowUtcIso(),
          ),
        );
        await harness.grantPermission(moderator.id, 'comments.moderate', clock.nowUtcIso(), superAdmin.id);

        const childUser = await harness.createUser(
          buildTestUserPayload(
            { email: 'child16@meraj.local', displayName: 'دانش‌آموز کودک', role: 'Member', ageGroupId: childAge.id },
            clock.nowUtcIso(),
          ),
        );
        const otherAdult = await harness.createUser(
          buildTestUserPayload(
            { email: 'adult16@meraj.local', displayName: 'کاربر بزرگسال', role: 'Member', ageGroupId: adultAge.id },
            clock.nowUtcIso(),
          ),
        );

        const content = await seedPublishedContent(harness, superAdmin.id, clock.nowUtcIso());

        const submitRes = await commentService.submitCommentAsync(
          childUser,
          content.id,
          'این داستان خیلی جذاب و آموزنده بود.',
        );
        assertEqual(submitRes.ok, true, 'Child comment submission must succeed');
        assertEqual(
          submitRes.comment?.status,
          CommentStatus.Pending,
          'Child author comment must start in CommentStatus.Pending',
        );
        assertEqual(
          submitRes.comment?.authorAgeGroupId,
          childAge.id,
          'Comment must snapshot child ageGroupId',
        );
        assertEqual(
          submitRes.comment?.moderationReason,
          'child_author',
          'Moderation reason must be child_author',
        );

        // Visibility check while Pending
        const guestList = await commentService.listPublicCommentsForContentAsync(content.id, null);
        assertEqual(guestList.comments.length, 0, 'Guest must NOT see child Pending comment');

        const otherList = await commentService.listPublicCommentsForContentAsync(content.id, otherAdult);
        assertEqual(otherList.comments.length, 0, 'Other member must NOT see child Pending comment');

        const selfList = await commentService.listPublicCommentsForContentAsync(content.id, childUser);
        assertEqual(selfList.comments.length, 1, 'Author must see own Pending comment');
        assertEqual(selfList.comments[0].isOwnPending, true, 'Own pending flag must be true');

        // Moderator approves -> visible to everyone
        const approveRes = await commentService.approveCommentAsync(moderator, submitRes.comment!.id);
        assertEqual(approveRes.ok, true, 'Moderator with comments.moderate must approve comment');
        assertEqual(approveRes.comment?.status, CommentStatus.Published, 'Approved comment must be Published');
        assertEqual(approveRes.comment?.moderatedById, moderator.id, 'moderatedById must record moderator');

        const guestAfterApprove = await commentService.listPublicCommentsForContentAsync(content.id, null);
        assertEqual(guestAfterApprove.comments.length, 1, 'Guest must see Published comment');

        // Moderator hides -> hidden for everyone including author
        const hideRes = await commentService.hideCommentAsync(moderator, submitRes.comment!.id);
        assertEqual(hideRes.ok, true, 'Moderator must hide comment');
        assertEqual(hideRes.comment?.status, CommentStatus.Hidden, 'Hidden comment status must be Hidden');

        const selfAfterHide = await commentService.listPublicCommentsForContentAsync(content.id, childUser);
        assertEqual(selfAfterHide.comments.length, 0, 'Hidden comment must disappear even for author');
      } finally {
        logger.clearLogs();
      }
    },
  },
  {
    id: 'stage16-blocked-words-normalization',
    nameKey: 'tests.stage16.blockedWordsNormalization.name',
    descriptionKey: 'tests.stage16.blockedWordsNormalization.desc',
    run: async () => {
      const { clock, logger, harness, commentService } = createStage16Context();
      try {
        const adultAge = harness.getAgeGroupByKey('adult');
        const superAdmin = await harness.createUser(
          buildTestUserPayload(
            { email: 'sa-bw@meraj.local', displayName: 'مدیرکل', role: 'SuperAdmin', ageGroupId: adultAge.id },
            clock.nowUtcIso(),
          ),
        );
        const adultMember = await harness.createUser(
          buildTestUserPayload(
            { email: 'adult-bw@meraj.local', displayName: 'کاربر عادی', role: 'Member', ageGroupId: adultAge.id },
            clock.nowUtcIso(),
          ),
        );
        const content = await seedPublishedContent(harness, superAdmin.id, clock.nowUtcIso());

        const addWordRes = await commentService.addBlockedWordAsync(superAdmin, 'توهین');
        assertEqual(addWordRes.ok, true, 'Adding blocked word must succeed');

        const dupRes = await commentService.addBlockedWordAsync(superAdmin, 'تـوهـيـن');
        assertEqual(dupRes.ok, false, 'Adding normalized-duplicate blocked word must fail');
        assertEqual(dupRes.errorCode, 'DUPLICATE_WORD', 'Duplicate normalized word must return DUPLICATE_WORD');

        await commentService.addBlockedWordAsync(superAdmin, 'خر');

        // Exact blocked word -> Pending
        const exactRes = await commentService.submitCommentAsync(
          adultMember,
          content.id,
          'این جمله حاوی توهین است.',
        );
        assertEqual(exactRes.ok, true, 'Blocked word comment saves as Pending');
        assertEqual(exactRes.comment?.status, CommentStatus.Pending, 'Exact blocked word goes to Pending');
        assertEqual(exactRes.comment?.moderationReason, 'blocked_word', 'Moderation reason must be blocked_word');

        // Tatweel + Arabic Yeh + ZWNJ + diacritics bypass attempt -> Pending
        const bypassRes = await commentService.submitCommentAsync(
          adultMember,
          content.id,
          'این رفتار تـُوهـيـن‌آمیز و ناپسند است!',
        );
        assertEqual(bypassRes.ok, true, 'Bypass comment saves as Pending');
        assertEqual(
          bypassRes.comment?.status,
          CommentStatus.Pending,
          'Normalized bypass with tatweel/Arabic yeh/diacritics must go to Pending',
        );

        // Clean adult comment containing «خرداد» must NOT false-positive on «خر»
        const cleanRes = await commentService.submitCommentAsync(
          adultMember,
          content.id,
          'گزارش خرداد ماه بسیار دقیق و مفید بود.',
        );
        assertEqual(cleanRes.ok, true, 'Clean adult comment must succeed');
        assertEqual(
          cleanRes.comment?.status,
          CommentStatus.Published,
          'Clean adult comment must publish immediately without false positive',
        );
      } finally {
        logger.clearLogs();
      }
    },
  },
  {
    id: 'stage16-link-validation-and-length',
    nameKey: 'tests.stage16.linkValidationAndLength.name',
    descriptionKey: 'tests.stage16.linkValidationAndLength.desc',
    run: async () => {
      const { clock, logger, harness, commentService } = createStage16Context();
      try {
        const adultAge = harness.getAgeGroupByKey('adult');
        const superAdmin = await harness.createUser(
          buildTestUserPayload(
            { email: 'sa-lv@meraj.local', displayName: 'مدیرکل', role: 'SuperAdmin', ageGroupId: adultAge.id },
            clock.nowUtcIso(),
          ),
        );
        const adultMember = await harness.createUser(
          buildTestUserPayload(
            { email: 'adult-lv@meraj.local', displayName: 'عضو', role: 'Member', ageGroupId: adultAge.id },
            clock.nowUtcIso(),
          ),
        );
        const content = await seedPublishedContent(harness, superAdmin.id, clock.nowUtcIso());

        assertEqual(containsExternalOrWebLink('سلام. خوبید'), false, 'Persian period must not trigger link detector');
        assertEqual(containsExternalOrWebLink('https://example.com'), true, 'https URL must trigger link detector');
        assertEqual(containsExternalOrWebLink('example.com'), true, 'bare domain must trigger link detector');
        assertEqual(containsExternalOrWebLink('t.me/channel'), true, 't.me link must trigger link detector');

        for (const badBody of [
          'به https://example.com سر بزنید',
          'سایت example.com عالی است',
          'کانال t.me/meraj_test را ببینید',
          'نشانی www.site.ir را باز کنید',
        ]) {
          const linkRes = await commentService.submitCommentAsync(adultMember, content.id, badBody);
          assertEqual(linkRes.ok, false, `Link body must be rejected: ${badBody}`);
          assertEqual(linkRes.errorCode, 'COMMENT_LINKS_NOT_ALLOWED', 'Must return COMMENT_LINKS_NOT_ALLOWED');
        }

        const emptyRes = await commentService.submitCommentAsync(adultMember, content.id, '   \n  ');
        assertEqual(emptyRes.ok, false, 'Blank comment must be rejected');
        assertEqual(emptyRes.errorCode, 'COMMENT_EMPTY', 'Must return COMMENT_EMPTY');

        const over1000 = 'الف'.repeat(1001);
        const longRes = await commentService.submitCommentAsync(adultMember, content.id, over1000);
        assertEqual(longRes.ok, false, '1001 chars must exceed default 1000 limit');
        assertEqual(longRes.errorCode, 'COMMENT_TOO_LONG', 'Must return COMMENT_TOO_LONG');

        // Custom Comments.MaxLength setting check
        harness.setMaxCommentLengthSetting('20');
        const customLongRes = await commentService.submitCommentAsync(
          adultMember,
          content.id,
          'الف'.repeat(21),
        );
        assertEqual(customLongRes.ok, false, '21 chars must be rejected when Comments.MaxLength=20');
        assertEqual(customLongRes.errorCode, 'COMMENT_TOO_LONG', 'Custom max length must enforce COMMENT_TOO_LONG');

        harness.setMaxCommentLengthSetting('1000');

        // Normal Persian sentence with periods succeeds immediately
        const validSentenceRes = await commentService.submitCommentAsync(
          adultMember,
          content.id,
          'سلام. خوبید! متن کاملاً سالم با نقطه‌گذاری فارسی است.',
        );
        assertEqual(validSentenceRes.ok, true, 'Normal Persian sentence with period must succeed');
        assertEqual(
          validSentenceRes.comment?.status,
          CommentStatus.Published,
          'Normal adult comment must publish immediately',
        );
      } finally {
        logger.clearLogs();
      }
    },
  },
  {
    id: 'stage16-rate-limit-5-per-hour',
    nameKey: 'tests.stage16.rateLimit5PerHour.name',
    descriptionKey: 'tests.stage16.rateLimit5PerHour.desc',
    run: async () => {
      const { clock, logger, harness, commentService } = createStage16Context();
      try {
        const adultAge = harness.getAgeGroupByKey('adult');
        const superAdmin = await harness.createUser(
          buildTestUserPayload(
            { email: 'sa-rl@meraj.local', displayName: 'مدیرکل', role: 'SuperAdmin', ageGroupId: adultAge.id },
            clock.nowUtcIso(),
          ),
        );
        const member = await harness.createUser(
          buildTestUserPayload(
            { email: 'member-rl@meraj.local', displayName: 'کاربر پرکار', role: 'Member', ageGroupId: adultAge.id },
            clock.nowUtcIso(),
          ),
        );
        const content = await seedPublishedContent(harness, superAdmin.id, clock.nowUtcIso());

        clock.setUtcIso('2026-11-23T10:00:00.000Z');
        for (let i = 1; i <= 5; i += 1) {
          const res = await commentService.submitCommentAsync(
            member,
            content.id,
            `دیدگاه شماره ${i} کاربر آزمایشی`,
          );
          assertEqual(res.ok, true, `Comment #${i} within 5/hour must succeed`);
          clock.advanceMinutes(5);
        }

        // At 10:25 -> 6th comment within trailing 1 hour must fail
        const sixthRes = await commentService.submitCommentAsync(
          member,
          content.id,
          'دیدگاه ششم در همان ساعت',
        );
        assertEqual(sixthRes.ok, false, '6th comment within 60 minutes must be blocked');
        assertEqual(sixthRes.statusCode, 429, 'Rate limit statusCode must be 429');
        assertEqual(sixthRes.errorCode, 'COMMENT_RATE_LIMIT', 'Must return COMMENT_RATE_LIMIT');

        // Advance clock to 61 minutes after first comment (10:00 -> 11:01)
        clock.setUtcIso('2026-11-23T11:01:00.000Z');
        const seventhRes = await commentService.submitCommentAsync(
          member,
          content.id,
          'دیدگاه جدید پس از ۶۱ دقیقه',
        );
        assertEqual(seventhRes.ok, true, 'Comment after 61 minutes must succeed once oldest slot expires');
      } finally {
        logger.clearLogs();
      }
    },
  },
  {
    id: 'stage16-report-and-rbac-permissions',
    nameKey: 'tests.stage16.reportAndRbacPermissions.name',
    descriptionKey: 'tests.stage16.reportAndRbacPermissions.desc',
    run: async () => {
      const { clock, logger, harness, commentService } = createStage16Context();
      try {
        const adultAge = harness.getAgeGroupByKey('adult');
        const superAdmin = await harness.createUser(
          buildTestUserPayload(
            { email: 'sa-rbac@meraj.local', displayName: 'مدیرکل', role: 'SuperAdmin', ageGroupId: adultAge.id },
            clock.nowUtcIso(),
          ),
        );
        const staffNoPerm = await harness.createUser(
          buildTestUserPayload(
            { email: 'staff-none@meraj.local', displayName: 'همکار بی‌دسترسی', role: 'Staff', ageGroupId: adultAge.id },
            clock.nowUtcIso(),
          ),
        );
        const staffModerator = await harness.createUser(
          buildTestUserPayload(
            { email: 'staff-mod@meraj.local', displayName: 'همکار ناظر', role: 'Staff', ageGroupId: adultAge.id },
            clock.nowUtcIso(),
          ),
        );
        await harness.grantPermission(staffModerator.id, 'comments.moderate', clock.nowUtcIso(), superAdmin.id);

        const author = await harness.createUser(
          buildTestUserPayload(
            { email: 'author-rbac@meraj.local', displayName: 'نویسنده', role: 'Member', ageGroupId: adultAge.id },
            clock.nowUtcIso(),
          ),
        );
        const reporter = await harness.createUser(
          buildTestUserPayload(
            { email: 'reporter-rbac@meraj.local', displayName: 'گزارش‌گر', role: 'Member', ageGroupId: adultAge.id },
            clock.nowUtcIso(),
          ),
        );

        const content = await seedPublishedContent(harness, superAdmin.id, clock.nowUtcIso());
        const commentRes = await commentService.submitCommentAsync(
          author,
          content.id,
          'دیدگاه منتشرشده جهت تست گزارش و دسترسی',
        );
        const commentId = commentRes.comment!.id;

        // Report once -> ok
        const report1 = await commentService.reportCommentAsync(
          reporter,
          commentId,
          'محتوای نامناسب و اسپم',
        );
        assertEqual(report1.ok, true, 'First report must succeed');

        // Duplicate report -> ALREADY_REPORTED
        const report2 = await commentService.reportCommentAsync(
          reporter,
          commentId,
          'گزارش مجدد',
        );
        assertEqual(report2.ok, false, 'Duplicate report must fail');
        assertEqual(report2.statusCode, 409, 'Duplicate report statusCode must be 409');
        assertEqual(report2.errorCode, 'ALREADY_REPORTED', 'Must return ALREADY_REPORTED');

        // Guest & Member get 404 on admin moderation endpoints
        assertEqual((await commentService.listAdminCommentsAsync(null)).statusCode, 404, 'Guest gets 404');
        assertEqual((await commentService.listAdminCommentsAsync(author)).statusCode, 404, 'Member gets 404');

        // Staff without comments.moderate -> 403 + WARN log
        const staffDeniedRes = await commentService.listAdminCommentsAsync(staffNoPerm);
        assertEqual(staffDeniedRes.ok, false, 'Staff without comments.moderate must fail');
        assertEqual(staffDeniedRes.statusCode, 403, 'Staff without comments.moderate gets 403');

        // Staff with comments.moderate -> sees reports and hides comment
        const reportsList = await commentService.listCommentReportsAsync(staffModerator);
        assertEqual(reportsList.ok, true, 'Moderator lists reports');
        assertEqual(reportsList.items?.length, 1, 'Reports list must include 1 report');

        const hideRes = await commentService.hideCommentAsync(staffModerator, commentId);
        assertEqual(hideRes.ok, true, 'Moderator can hide comment');

        // Staff tries hardDelete -> MUST get 403 + WARN log (Rule 6.7 / SuperAdmin-only)
        logger.clearLogs();
        const staffHardDelete = await commentService.hardDeleteCommentAsync(staffModerator, commentId);
        assertEqual(staffHardDelete.ok, false, 'Staff cannot hard-delete comments');
        assertEqual(staffHardDelete.statusCode, 403, 'Staff hard-delete gets 403 Forbidden');
        const warnLogs = logger.getLogs().filter((l) => l.level === 'WARN');
        assert(warnLogs.length >= 1, 'Unauthorized hard-delete attempt by Staff must produce a WARN log');
        assert((await harness.getCommentById(commentId)) !== null, 'Comment must still exist after blocked Staff delete');

        // SuperAdmin hard-deletes -> removes comment AND its reports
        const saHardDelete = await commentService.hardDeleteCommentAsync(superAdmin, commentId);
        assertEqual(saHardDelete.ok, true, 'SuperAdmin must succeed in hard-deleting comment');
        assertEqual(await harness.getCommentById(commentId), null, 'Comment must be deleted by SuperAdmin');
        assertEqual((await harness.getReportsByCommentId(commentId)).length, 0, 'Associated reports must be cascade-deleted');
      } finally {
        logger.clearLogs();
      }
    },
  },
  {
    id: 'stage16-feature-flag-deleted-user-and-idb-v10',
    nameKey: 'tests.stage16.featureFlagDeletedUserAndIdbV10.name',
    descriptionKey: 'tests.stage16.featureFlagDeletedUserAndIdbV10.desc',
    run: async () => {
      const { clock, logger, harness, commentService } = createStage16Context();
      const hasher = new BrowserPasswordHasher();
      const tokenStore = new MemorySessionTokenStore();

      try {
        const adultAge = harness.getAgeGroupByKey('adult');
        const superAdmin = await harness.createUser(
          buildTestUserPayload(
            { email: 'sa-flag@meraj.local', displayName: 'مدیرکل', role: 'SuperAdmin', ageGroupId: adultAge.id },
            clock.nowUtcIso(),
          ),
        );

        const rawPassword = 'UserPass#1405';
        const { hash, salt } = await hasher.hashPassword(rawPassword);
        const member = await harness.createUser(
          buildTestUserPayload(
            {
              email: 'del-comment@meraj.local',
              displayName: 'مهدی رضایی',
              role: 'Member',
              ageGroupId: adultAge.id,
              passwordHash: hash,
              passwordSalt: salt,
            },
            clock.nowUtcIso(),
          ),
        );

        const content = await seedPublishedContent(harness, superAdmin.id, clock.nowUtcIso());
        const submitRes = await commentService.submitCommentAsync(
          member,
          content.id,
          'دیدگاهی که پس از حذف حساب هم باقی می‌ماند.',
        );
        assertEqual(submitRes.ok, true, 'Initial comment submission must succeed');

        // 1) Toggle FeatureFlag('Comments') OFF -> gated everywhere, data retained
        harness.setCommentsFlagEnabled(false);
        const disabledPublic = await commentService.listPublicCommentsForContentAsync(content.id, null);
        assertEqual(disabledPublic.enabled, false, 'Public list must report enabled=false');
        assertEqual(disabledPublic.comments.length, 0, 'Public list must return empty when disabled');

        const disabledSubmit = await commentService.submitCommentAsync(member, content.id, 'تست خاموش');
        assertEqual(disabledSubmit.ok, false, 'Submit must fail when flag is off');
        assertEqual(disabledSubmit.errorCode, 'FEATURE_DISABLED', 'Must return FEATURE_DISABLED');

        const disabledAdmin = await commentService.listAdminCommentsAsync(superAdmin);
        assertEqual(disabledAdmin.ok, false, 'Admin panel query must return disabled/404 when flag is off');
        assertEqual(disabledAdmin.statusCode, 404, 'Admin comments query returns 404 when module is disabled');

        // Turn Flag back ON -> stored comment intact
        harness.setCommentsFlagEnabled(true);
        const reEnabledPublic = await commentService.listPublicCommentsForContentAsync(content.id, null);
        assertEqual(reEnabledPublic.enabled, true, 'Public list must report enabled=true again');
        assertEqual(reEnabledPublic.comments.length, 1, 'Stored comment must be preserved');
        assertEqual(reEnabledPublic.comments[0].authorDisplayName, 'مهدی رضایی', 'Author name shows normally before deletion');

        // 2) Delete member account (Rule 6.7) -> comment remains with «کاربر حذف‌شده»
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

        const delRes = await profileService.deleteAccountAsync(member, { password: rawPassword });
        assertEqual(delRes.ok, true, 'Account deletion must succeed');
        if (delRes.ok) {
          assertEqual(delRes.anonymizedCommentsCount, 1, 'anonymizedCommentsCount must equal 1');
        }

        const afterDeletePublic = await commentService.listPublicCommentsForContentAsync(content.id, null);
        assertEqual(afterDeletePublic.comments.length, 1, 'Comment must remain after account deletion');
        assertEqual(
          afterDeletePublic.comments[0].authorDisplayName,
          'کاربر حذف‌شده',
          'Deleted author must display as «کاربر حذف‌شده»',
        );
        assertEqual(afterDeletePublic.comments[0].isAuthorDeleted, true, 'isAuthorDeleted flag must be true');

        // 3) Real IndexedDB v10 Migration & Persistence check (browser runtime)
        if (typeof indexedDB !== 'undefined') {
          const testDbName = `MerajAndishehDB_S16_${Date.now()}`;
          const store = new IndexedDbDataStore(
            testDbName,
            envConfig.databaseVersion,
            envConfig.metaStoreName,
          );
          try {
            const seeder = new DatabaseSeeder(store, logger);
            await seeder.seed();
            await ensureStage16CommentsDefaultFlagAsync(store);

            const storeNames = await store.getObjectStoreNames();
            for (const expectedStore of STAGE16_OBJECT_STORES) {
              assert(
                storeNames.includes(expectedStore),
                `Missing Stage 16 ObjectStore in DB v${envConfig.databaseVersion}: ${expectedStore}`,
              );
            }

            const idbAuth = new IndexedDbAuthRepository(store);
            const idbAdmin = new IndexedDbAdminRepository(store);
            const idbContent = new IndexedDbContentRepository(store);
            const idbTaxonomy = new IndexedDbTaxonomyRepository(store);
            const idbComments = new IndexedDbCommentRepository(store);
            const idbDownload = new IndexedDbDownloadEventRepository(store);
            const idbInteraction = new IndexedDbInteractionRepository(store);
            const idbCleanup = new IndexedDbAccountCleanupRepository(store);

            const idbService = new CommentService({
              commentRepository: idbComments,
              contentRepository: idbContent,
              adminRepository: idbAdmin,
              taxonomyRepository: idbTaxonomy,
              permissionPolicyService: new PermissionPolicyService(idbAdmin, logger),
              searchNormalizer: new SearchNormalizer(),
              clock,
              logger,
              deletedDisplayName: 'کاربر حذف‌شده',
            });

            assertEqual(
              await idbService.isCommentsFeatureEnabledAsync(),
              true,
              'Comments FeatureFlag must be enabled by default in Stage 16 app bootstrap',
            );

            const idbUser = await idbAuth.createUser(
              buildTestUserPayload(
                {
                  email: 'idb16-member@meraj.local',
                  displayName: 'کاربر واقعی پایگاه داده',
                  role: 'Member',
                  ageGroupId: adultAge.id,
                  passwordHash: hash,
                  passwordSalt: salt,
                },
                clock.nowUtcIso(),
              ),
            );
            const idbContentItem = await idbContent.createContentItem({
              title: 'محتوای تست IDB v10',
              slug: 'idb-v10-stage16',
              summary: 'خلاصه',
              body: null,
              format: 'Article',
              impactLevelId: 1,
              status: ContentStatus.Published,
              publishedAt: clock.nowUtcIso(),
              readWatchMinutes: 3,
              thumbnailKey: null,
              isFeatured: false,
              languageCode: 'fa',
              searchText: 'محتوای تست',
              viewCount: 0,
              downloadCount: 0,
              likeCount: 0,
              createdById: idbUser.id,
              createdAt: clock.nowUtcIso(),
              updatedAt: clock.nowUtcIso(),
            });

            const idbComment = await idbService.submitCommentAsync(
              idbUser,
              idbContentItem.id,
              'ذخیره‌سازی واقعی در نسخه ۱۰ IndexedDB',
            );
            assertEqual(idbComment.ok, true, 'IDB v10 comment submission must succeed');

            const storedComments = await store.getAll<CommentItem>(STORE_NAMES.COMMENTS);
            assertEqual(storedComments.length, 1, 'IDB comments store must contain 1 row');

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
            const idbDel = await idbProfile.deleteAccountAsync(idbUser, { password: rawPassword });
            assertEqual(idbDel.ok, true, 'IDB account deletion must succeed');
            if (idbDel.ok) {
              assertEqual(idbDel.anonymizedCommentsCount, 1, 'IDB cleanup must count preserved user comment');
            }

            const idbAfterDelete = await idbService.listPublicCommentsForContentAsync(
              idbContentItem.id,
              null,
            );
            assertEqual(
              idbAfterDelete.comments[0]?.authorDisplayName,
              'کاربر حذف‌شده',
              'IDB comment must display «کاربر حذف‌شده» after user deletion',
            );
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
