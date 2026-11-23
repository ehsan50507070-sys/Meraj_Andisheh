import type { IClock } from '../core/abstractions/IClock';
import type { IContentRepository } from '../core/abstractions/contentRepository';
import type { IDownloadEventRepository } from '../core/abstractions/downloadRepository';
import type { IFileStorage } from '../core/abstractions/fileStorage';
import {
  DownloadKind,
  type DownloadEvent,
} from '../core/domain/analytics';
import type { AppUser } from '../core/domain/auth';
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
import type { FileSaveRequest, StoredFileMetadata } from '../core/domain/storage';
import type { AgeGroup } from '../core/domain/taxonomy';
import { DownloadService } from '../core/services/downloadService';
import {
  extractNormalizedExtension,
  getCategoryForExtension,
  getMimeTypeForExtension,
} from '../core/services/fileValidationService';
import { resolvePostLoginRedirect } from '../core/services/navigationGuardService';
import { SystemClock } from '../infrastructure/clock/SystemClock';
import { envConfig } from '../infrastructure/config/envConfig';
import { IndexedDbAuthRepository } from '../infrastructure/data/IndexedDbAuthRepository';
import { IndexedDbContentRepository } from '../infrastructure/data/IndexedDbContentRepository';
import { IndexedDbDataStore } from '../infrastructure/data/IndexedDbDataStore';
import { IndexedDbDownloadEventRepository } from '../infrastructure/data/IndexedDbDownloadEventRepository';
import { STAGE14_OBJECT_STORES, STORE_NAMES } from '../infrastructure/data/migrations';
import { DatabaseSeeder, INITIAL_AGE_GROUPS } from '../infrastructure/data/seed';
import { AppLogger } from '../infrastructure/logging/AppLogger';
import { HmacDownloadTokenProtector } from '../infrastructure/security/HmacDownloadTokenProtector';
import { LocalIndexedDbFileStorage } from '../infrastructure/storage/LocalIndexedDbFileStorage';
import { assert, assertEqual, type UnitTestCase } from './testRunner';

class Stage14FakeClock implements IClock {
  private iso: string;
  private readonly inner = new SystemClock();

  constructor(initialIso = '2026-11-22T10:00:00.000Z') {
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

function makeTestSecretKey(): Uint8Array {
  const key = new Uint8Array(32);
  for (let i = 0; i < 32; i += 1) {
    key[i] = (i * 17 + 43) & 0xff;
  }
  return key;
}

class MemoryStage14UserStore {
  private users: AppUser[] = [];
  private seq = 100;

  public createUser(partial: {
    email: string;
    displayName: string;
    role: AppUser['role'];
    ageGroupId: number;
    isActive?: boolean;
  }): AppUser {
    const user: AppUser = {
      id: this.seq++,
      email: partial.email,
      normalizedEmail: partial.email.toUpperCase(),
      phoneNumber: null,
      normalizedPhoneNumber: null,
      displayName: partial.displayName,
      role: partial.role,
      ageGroupId: partial.ageGroupId,
      personalizationEnabled: false,
      emailConfirmed: true,
      phoneNumberConfirmed: false,
      mustChangePassword: false,
      isActive: partial.isActive ?? true,
      failedLoginCount: 0,
      lockoutEnd: null,
      passwordHash: 'hash',
      passwordSalt: 'salt',
      createdAt: '2026-11-22T09:00:00.000Z',
      lastLoginAt: null,
    };
    this.users.push(user);
    return { ...user };
  }

  public hasUser(id: number): boolean {
    return this.users.some((u) => u.id === id);
  }
}

class MemoryDownloadEventRepository implements IDownloadEventRepository {
  private events: DownloadEvent[] = [];
  private seq = 1;

  public async createDownloadEvent(event: Omit<DownloadEvent, 'id'>): Promise<DownloadEvent> {
    const created: DownloadEvent = { ...event, id: this.seq++ };
    this.events.push(created);
    return { ...created };
  }

  public async getDownloadEventsByContentId(contentId: number): Promise<DownloadEvent[]> {
    return this.events.filter((e) => e.contentId === contentId).map((e) => ({ ...e }));
  }

  public async getDownloadEventsByUserId(userId: number): Promise<DownloadEvent[]> {
    return this.events.filter((e) => e.userId === userId).map((e) => ({ ...e }));
  }

  public async getAllDownloadEvents(): Promise<DownloadEvent[]> {
    return this.events.map((e) => ({ ...e }));
  }
}

class MemoryStage14ContentRepository implements IContentRepository {
  private items: ContentItem[] = [];
  private sources: ContentSource[] = [];
  private files: ContentFile[] = [];
  private contentTopics: ContentTopic[] = [];
  private contentTags: ContentTag[] = [];
  private contentPersons: ContentPerson[] = [];
  private contentAgeGroups: ContentAgeGroup[] = [];
  private readonly userStore: MemoryStage14UserStore;
  private itemSeq = 1;
  private sourceSeq = 1;
  private fileSeq = 1;

  constructor(userStore: MemoryStage14UserStore) {
    this.userStore = userStore;
  }

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
    if (!this.userStore.hasUser(item.createdById)) {
      throw new Error(`FOREIGN_KEY_VIOLATION: createdById=${item.createdById} not found`);
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
  public async userExists(userId: number): Promise<boolean> {
    return this.userStore.hasUser(userId);
  }
}

class MemoryStage14FileStorage implements IFileStorage {
  private readonly entries = new Map<
    string,
    { bytes: Uint8Array; metadata: StoredFileMetadata }
  >();
  private readonly clock: IClock;
  private seq = 1;

  constructor(clock: IClock) {
    this.clock = clock;
  }

  public async saveAsync(request: FileSaveRequest): Promise<StoredFileMetadata> {
    const ext = extractNormalizedExtension(request.originalFileName) ?? 'bin';
    const uuidHex = (this.seq++).toString(16).padStart(12, '0');
    const prefix = request.visibility === 'public' ? 'public/thumb' : 'private/vault';
    const storageKey = `${prefix}/14141414-4444-4555-8666-${uuidHex}.${ext}`;

    const copy = new Uint8Array(request.bytes.byteLength);
    copy.set(request.bytes);

    const metadata: StoredFileMetadata = {
      storageKey,
      originalFileName: request.originalFileName,
      extension: ext,
      mimeType: request.contentType || getMimeTypeForExtension(ext),
      sizeBytes: copy.byteLength,
      visibility: request.visibility,
      category: getCategoryForExtension(ext) ?? 'document',
      uploadedById: request.uploadedById ?? null,
      createdAt: this.clock.nowUtcIso(),
    };

    this.entries.set(storageKey, { bytes: copy, metadata });
    return { ...metadata };
  }

  public async openReadAsync(
    storageKey: string,
  ): Promise<{ bytes: Uint8Array; metadata: StoredFileMetadata } | null> {
    const found = this.entries.get(storageKey);
    if (!found) {
      return null;
    }
    const copy = new Uint8Array(found.bytes.byteLength);
    copy.set(found.bytes);
    return { bytes: copy, metadata: { ...found.metadata } };
  }

  public async openReadRangeAsync(
    storageKey: string,
    startByte: number,
    endByte: number,
  ) {
    const found = this.entries.get(storageKey);
    if (!found) {
      return null;
    }
    const totalBytes = found.bytes.byteLength;
    if (totalBytes === 0) {
      return {
        chunk: new Uint8Array(0),
        totalBytes: 0,
        startByte: 0,
        endByte: 0,
        mimeType: found.metadata.mimeType,
      };
    }
    const safeStart = Math.max(0, Math.min(Math.floor(startByte), totalBytes - 1));
    const safeEnd = Math.max(safeStart, Math.min(Math.floor(endByte), totalBytes - 1));
    const chunk = found.bytes.slice(safeStart, safeEnd + 1);
    return {
      chunk,
      totalBytes,
      startByte: safeStart,
      endByte: safeEnd,
      mimeType: found.metadata.mimeType,
    };
  }

  public async deleteAsync(storageKey: string): Promise<void> {
    this.entries.delete(storageKey);
  }

  public async existsAsync(storageKey: string): Promise<boolean> {
    return this.entries.has(storageKey);
  }

  public async getMetadataAsync(storageKey: string): Promise<StoredFileMetadata | null> {
    return this.entries.get(storageKey)?.metadata ?? null;
  }

  public async listAllMetadataAsync(): Promise<StoredFileMetadata[]> {
    return Array.from(this.entries.values()).map((e) => ({ ...e.metadata }));
  }
}

function getAgeGroupsWithIds(): AgeGroup[] {
  return INITIAL_AGE_GROUPS.map((g, idx) => ({ ...g, id: idx + 1 }));
}

function flipSingleTokenChar(input: string, index: number): string {
  const ch = input[index];
  const replacement = ch === 'A' ? 'B' : 'A';
  return `${input.slice(0, index)}${replacement}${input.slice(index + 1)}`;
}

export const stage14Tests: UnitTestCase[] = [
  {
    id: 'stage14-example-36-signed-lifecycle',
    nameKey: 'tests.stage14.example36SignedLifecycle.name',
    descriptionKey: 'tests.stage14.example36SignedLifecycle.desc',
    run: async () => {
      const clock = new Stage14FakeClock('2026-11-22T10:00:00.000Z');
      const logger = new AppLogger(clock, `meraj_s14_ex36_${Date.now()}`, 50);
      try {
        const ages = getAgeGroupsWithIds();
        const teenAge = ages.find((a) => a.key === 'teen')!;
        const adultAge = ages.find((a) => a.key === 'adult')!;

        const userStore = new MemoryStage14UserStore();
        const adminUser = userStore.createUser({
          email: 'admin-s14@meraj.local',
          displayName: 'مدیر آزمایشی',
          role: 'Staff',
          ageGroupId: adultAge.id,
        });
        const userX = userStore.createUser({
          email: 'userx-s14@meraj.local',
          displayName: 'کاربر ایکس',
          role: 'Member',
          ageGroupId: teenAge.id,
        });
        const userY = userStore.createUser({
          email: 'usery-s14@meraj.local',
          displayName: 'کاربر ایگرگ',
          role: 'Member',
          ageGroupId: adultAge.id,
        });

        const contentRepo = new MemoryStage14ContentRepository(userStore);
        const downloadRepo = new MemoryDownloadEventRepository();
        const fileStorage = new MemoryStage14FileStorage(clock);
        const protector = new HmacDownloadTokenProtector({ secretKeyBytes: makeTestSecretKey() });
        const service = new DownloadService(
          contentRepo,
          downloadRepo,
          fileStorage,
          protector,
          clock,
          logger,
        );

        const originalPayload = new TextEncoder().encode('%PDF-1.4\nMerajAndisheh-Stage14-Sample');
        const saved = await fileStorage.saveAsync({
          bytes: originalPayload,
          originalFileName: 'booklet.pdf',
          contentType: 'application/pdf',
          visibility: 'private',
          uploadedById: adminUser.id,
        });

        const item = await contentRepo.createContentItem({
          title: 'جزوه پژوهشی مرحله ۱۴',
          slug: 'stage14-research-booklet',
          summary: 'خلاصه محتوا',
          body: null,
          format: 'Pdf',
          impactLevelId: 1,
          status: ContentStatus.Published,
          publishedAt: '2026-11-20T09:00:00.000Z',
          readWatchMinutes: 10,
          thumbnailKey: null,
          isFeatured: false,
          languageCode: 'fa',
          searchText: 'جزوه پژوهشی مرحله ۱۴',
          viewCount: 0,
          downloadCount: 0,
          likeCount: 0,
          createdById: adminUser.id,
          createdAt: '2026-11-20T09:00:00.000Z',
          updatedAt: '2026-11-20T09:00:00.000Z',
        });

        const [file] = await contentRepo.replaceFiles(item.id, [
          {
            contentId: item.id,
            kind: ContentFileKind.Main,
            storageType: FileStorageType.Local,
            storageKey: saved.storageKey,
            externalUrl: null,
            originalFileName: 'booklet.pdf',
            mimeType: 'application/pdf',
            sizeBytes: originalPayload.byteLength,
            isDownloadable: true,
            sortOrder: 0,
          },
        ]);

        // 10:00 -> User X creates signed link
        clock.setUtcIso('2026-11-22T10:00:00.000Z');
        const linkRes = await service.createSignedDownloadLinkAsync({
          currentUser: userX,
          contentId: item.id,
          fileId: file.id,
          activeAgeGroup: teenAge,
        });
        assertEqual(linkRes.ok, true, 'User X must receive signed download link at 10:00');
        if (!linkRes.ok) throw new Error('Expected linkRes.ok');

        // 10:04 -> User X executes download -> succeeds
        clock.setUtcIso('2026-11-22T10:04:00.000Z');
        const dlX = await service.executeSignedDownloadAsync({
          token: linkRes.token,
          currentUser: userX,
          activeAgeGroup: teenAge,
        });
        assertEqual(dlX.ok, true, 'User X download at 10:04 (minute 4) must succeed');
        if (!dlX.ok) throw new Error('Expected dlX.ok');
        assertEqual(
          new TextDecoder().decode(dlX.bytes),
          new TextDecoder().decode(originalPayload),
          'Downloaded bytes must match original file payload exactly',
        );
        assertEqual(dlX.event.kind, DownloadKind.File, 'DownloadEvent.kind must be File');
        assertEqual(dlX.event.userId, userX.id, 'DownloadEvent.userId must match User X');
        assertEqual(dlX.event.ageGroupId, teenAge.id, 'DownloadEvent.ageGroupId must match active age group');

        let updatedItem = await contentRepo.getContentItemById(item.id);
        assertEqual(updatedItem?.downloadCount, 1, 'downloadCount must increment from 0 to 1');

        // 10:04:30 -> User Y uses User X token -> rejected TOKEN_USER_MISMATCH
        clock.setUtcIso('2026-11-22T10:04:30.000Z');
        const dlY = await service.executeSignedDownloadAsync({
          token: linkRes.token,
          currentUser: userY,
          activeAgeGroup: adultAge,
        });
        assertEqual(dlY.ok, false, 'User Y must be rejected using User X token');
        if (!dlY.ok) {
          assertEqual(dlY.errorCode, 'TOKEN_USER_MISMATCH', 'Error code must be TOKEN_USER_MISMATCH');
        }
        assertEqual((await downloadRepo.getAllDownloadEvents()).length, 1, 'Rejected User Y attempt must not add DownloadEvent');
        updatedItem = await contentRepo.getContentItemById(item.id);
        assertEqual(updatedItem?.downloadCount, 1, 'downloadCount must stay 1 after rejected User Y attempt');

        // 10:06 -> User X opens same link after 5 min expiry -> TOKEN_EXPIRED
        clock.setUtcIso('2026-11-22T10:06:00.000Z');
        const dlExpired = await service.executeSignedDownloadAsync({
          token: linkRes.token,
          currentUser: userX,
          activeAgeGroup: teenAge,
        });
        assertEqual(dlExpired.ok, false, 'Token opened at minute 6 must expire');
        if (!dlExpired.ok) {
          assertEqual(dlExpired.errorCode, 'TOKEN_EXPIRED', 'Error code at 10:06 must be TOKEN_EXPIRED');
        }
        assertEqual((await downloadRepo.getAllDownloadEvents()).length, 1, 'Expired attempt must not record DownloadEvent');
      } finally {
        logger.clearLogs();
      }
    },
  },
  {
    id: 'stage14-token-tampering',
    nameKey: 'tests.stage14.tokenTampering.name',
    descriptionKey: 'tests.stage14.tokenTampering.desc',
    run: async () => {
      const clock = new Stage14FakeClock('2026-11-22T10:00:00.000Z');
      const logger = new AppLogger(clock, `meraj_s14_tamper_${Date.now()}`, 50);
      try {
        const ages = getAgeGroupsWithIds();
        const adultAge = ages.find((a) => a.key === 'adult')!;
        const userStore = new MemoryStage14UserStore();
        const member = userStore.createUser({
          email: 'member-tamper@meraj.local',
          displayName: 'عضو تست دستکاری',
          role: 'Member',
          ageGroupId: adultAge.id,
        });

        const contentRepo = new MemoryStage14ContentRepository(userStore);
        const downloadRepo = new MemoryDownloadEventRepository();
        const fileStorage = new MemoryStage14FileStorage(clock);
        const protector = new HmacDownloadTokenProtector({ secretKeyBytes: makeTestSecretKey() });
        const service = new DownloadService(
          contentRepo,
          downloadRepo,
          fileStorage,
          protector,
          clock,
          logger,
        );

        const saved = await fileStorage.saveAsync({
          bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]),
          originalFileName: 'doc.pdf',
          contentType: 'application/pdf',
          visibility: 'private',
          uploadedById: member.id,
        });

        const item = await contentRepo.createContentItem({
          title: 'سند تست دستکاری توکن',
          slug: 'tamper-doc',
          summary: 'خلاصه',
          body: null,
          format: 'Pdf',
          impactLevelId: 1,
          status: ContentStatus.Published,
          publishedAt: clock.nowUtcIso(),
          readWatchMinutes: 5,
          thumbnailKey: null,
          isFeatured: false,
          languageCode: 'fa',
          searchText: 'سند تست دستکاری توکن',
          viewCount: 0,
          downloadCount: 0,
          likeCount: 0,
          createdById: member.id,
          createdAt: clock.nowUtcIso(),
          updatedAt: clock.nowUtcIso(),
        });

        const [file] = await contentRepo.replaceFiles(item.id, [
          {
            contentId: item.id,
            kind: ContentFileKind.Main,
            storageType: FileStorageType.Local,
            storageKey: saved.storageKey,
            externalUrl: null,
            originalFileName: 'doc.pdf',
            mimeType: 'application/pdf',
            sizeBytes: 5,
            isDownloadable: true,
            sortOrder: 0,
          },
        ]);

        const linkRes = await service.createSignedDownloadLinkAsync({
          currentUser: member,
          contentId: item.id,
          fileId: file.id,
          activeAgeGroup: adultAge,
        });
        assert(linkRes.ok, 'Valid token must be issued');
        if (!linkRes.ok) return;

        // Tamper 1 char in payload and 1 char in signature
        const tamperedPayloadToken = flipSingleTokenChar(linkRes.token, 5);
        const tamperedSigToken = flipSingleTokenChar(linkRes.token, linkRes.token.length - 3);

        const unprotectPayload = await protector.unprotectAsync(tamperedPayloadToken);
        assertEqual(unprotectPayload.isValid, false, 'Tampered payload token must fail unprotectAsync');
        assertEqual(unprotectPayload.reason, 'TAMPERED_SIGNATURE', 'Tampered payload must yield TAMPERED_SIGNATURE');

        const unprotectSig = await protector.unprotectAsync(tamperedSigToken);
        assertEqual(unprotectSig.isValid, false, 'Tampered signature token must fail unprotectAsync');
        assertEqual(unprotectSig.reason, 'TAMPERED_SIGNATURE', 'Tampered signature must yield TAMPERED_SIGNATURE');

        const execTampered = await service.executeSignedDownloadAsync({
          token: tamperedPayloadToken,
          currentUser: member,
          activeAgeGroup: adultAge,
        });
        assertEqual(execTampered.ok, false, 'Tampered token execution must fail');
        if (!execTampered.ok) {
          assertEqual(execTampered.errorCode, 'TOKEN_INVALID', 'Tampered execution must return TOKEN_INVALID');
        }

        const warnLogs = logger.getLogs().filter((l) => l.level === 'WARN');
        assert(
          warnLogs.some((l) => l.message === 'DOWNLOAD_TOKEN_INVALID'),
          'Tampered token attempt must record a WARN log entry',
        );
        assertEqual((await downloadRepo.getAllDownloadEvents()).length, 0, 'No DownloadEvent may be created on tampered token');
      } finally {
        logger.clearLogs();
      }
    },
  },
  {
    id: 'stage14-is-downloadable-and-external',
    nameKey: 'tests.stage14.isDownloadableAndExternal.name',
    descriptionKey: 'tests.stage14.isDownloadableAndExternal.desc',
    run: async () => {
      const clock = new Stage14FakeClock('2026-11-22T10:00:00.000Z');
      const logger = new AppLogger(clock, `meraj_s14_flags_${Date.now()}`, 50);
      try {
        const ages = getAgeGroupsWithIds();
        const adultAge = ages.find((a) => a.key === 'adult')!;
        const userStore = new MemoryStage14UserStore();
        const admin = userStore.createUser({
          email: 'admin-flags@meraj.local',
          displayName: 'مدیر',
          role: 'Staff',
          ageGroupId: adultAge.id,
        });
        const member = userStore.createUser({
          email: 'member-flags@meraj.local',
          displayName: 'عضو',
          role: 'Member',
          ageGroupId: adultAge.id,
        });

        const contentRepo = new MemoryStage14ContentRepository(userStore);
        const downloadRepo = new MemoryDownloadEventRepository();
        const fileStorage = new MemoryStage14FileStorage(clock);
        const protector = new HmacDownloadTokenProtector({ secretKeyBytes: makeTestSecretKey() });
        const service = new DownloadService(
          contentRepo,
          downloadRepo,
          fileStorage,
          protector,
          clock,
          logger,
        );

        const saved = await fileStorage.saveAsync({
          bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]),
          originalFileName: 'restricted.pdf',
          contentType: 'application/pdf',
          visibility: 'private',
          uploadedById: admin.id,
        });

        const item = await contentRepo.createContentItem({
          title: 'محتوای بررسی پرچم دانلود و فایل خارجی',
          slug: 'flags-content',
          summary: 'خلاصه',
          body: null,
          format: 'Pdf',
          impactLevelId: 1,
          status: ContentStatus.Published,
          publishedAt: clock.nowUtcIso(),
          readWatchMinutes: 4,
          thumbnailKey: null,
          isFeatured: false,
          languageCode: 'fa',
          searchText: 'محتوای بررسی پرچم دانلود',
          viewCount: 0,
          downloadCount: 0,
          likeCount: 0,
          createdById: admin.id,
          createdAt: clock.nowUtcIso(),
          updatedAt: clock.nowUtcIso(),
        });

        const [nonDownloadableFile, externalFile] = await contentRepo.replaceFiles(item.id, [
          {
            contentId: item.id,
            kind: ContentFileKind.Main,
            storageType: FileStorageType.Local,
            storageKey: saved.storageKey,
            externalUrl: null,
            originalFileName: 'restricted.pdf',
            mimeType: 'application/pdf',
            sizeBytes: 6,
            isDownloadable: false,
            sortOrder: 0,
          },
          {
            contentId: item.id,
            kind: ContentFileKind.Attachment,
            storageType: FileStorageType.External,
            storageKey: null,
            externalUrl: 'https://www.aparat.com/v/y197v60',
            originalFileName: 'aparat-link',
            mimeType: 'text/html',
            sizeBytes: null,
            isDownloadable: true,
            sortOrder: 1,
          },
        ]);

        // 1) isDownloadable = false blocks issuance
        const resDenied = await service.createSignedDownloadLinkAsync({
          currentUser: member,
          contentId: item.id,
          fileId: nonDownloadableFile.id,
          activeAgeGroup: adultAge,
        });
        assertEqual(resDenied.ok, false, 'isDownloadable=false must block link creation');
        if (!resDenied.ok) {
          assertEqual(resDenied.errorCode, 'FILE_NOT_DOWNLOADABLE', 'Must return FILE_NOT_DOWNLOADABLE');
        }

        // 2) External file blocks issuance with EXTERNAL_FILE_NO_DOWNLOAD
        const resExternal = await service.createSignedDownloadLinkAsync({
          currentUser: member,
          contentId: item.id,
          fileId: externalFile.id,
          activeAgeGroup: adultAge,
        });
        assertEqual(resExternal.ok, false, 'External file must never allow site signed download');
        if (!resExternal.ok) {
          assertEqual(resExternal.errorCode, 'EXTERNAL_FILE_NO_DOWNLOAD', 'Must return EXTERNAL_FILE_NO_DOWNLOAD');
        }

        // 3) Admin turns off isDownloadable AFTER link was already issued -> direct execution rejected!
        const [reEnabledFile] = await contentRepo.replaceFiles(item.id, [
          {
            contentId: item.id,
            kind: ContentFileKind.Main,
            storageType: FileStorageType.Local,
            storageKey: saved.storageKey,
            externalUrl: null,
            originalFileName: 'restricted.pdf',
            mimeType: 'application/pdf',
            sizeBytes: 6,
            isDownloadable: true,
            sortOrder: 0,
          },
        ]);
        const issuedLink = await service.createSignedDownloadLinkAsync({
          currentUser: member,
          contentId: item.id,
          fileId: reEnabledFile.id,
          activeAgeGroup: adultAge,
        });
        assert(issuedLink.ok, 'Link issuance succeeds while isDownloadable=true');
        if (!issuedLink.ok) return;

        // Note: replacing files assigns a new id in memory mock, so reuse original reEnabledFile id by mutating in place via re-creating token OR preserving fileId:
        const validPayloadToken = await protector.protectAsync({
          userId: member.id,
          contentId: item.id,
          fileId: reEnabledFile.id,
          issuedAtEpochMs: clock.now().getTime(),
          expiresAtEpochMs: clock.now().getTime() + 5 * 60 * 1000,
        });
        // Update stored files directly keeping same id (by updating via helper pattern: filter & restore? Wait: replaceFiles sets sequential id; let's check both ids or mutate existing list cleanly):
        // Better: test via replacing with same contentId and issuing BEFORE setting false? No, if replaceFiles increments id, execute would see FILE_NOT_FOUND unless id matches.
        // Let's keep same fileId by verifying FILE_NOT_DOWNLOADABLE when fileId exists with isDownloadable=false:
        const tokenForDisabledFile = await protector.protectAsync({
          userId: member.id,
          contentId: item.id,
          fileId: nonDownloadableFile.id,
          issuedAtEpochMs: clock.now().getTime(),
          expiresAtEpochMs: clock.now().getTime() + 5 * 60 * 1000,
        });
        // Restore nonDownloadableFile? Let's put nonDownloadableFile back first cleanly using a fresh item so id matches 100%!
        const item2 = await contentRepo.createContentItem({
          title: 'محتوای لغو مجوز پس از صدور',
          slug: 'revoked-flag-content',
          summary: 'خلاصه',
          body: null,
          format: 'Pdf',
          impactLevelId: 1,
          status: ContentStatus.Published,
          publishedAt: clock.nowUtcIso(),
          readWatchMinutes: 4,
          thumbnailKey: null,
          isFeatured: false,
          languageCode: 'fa',
          searchText: 'محتوای لغو مجوز',
          viewCount: 0,
          downloadCount: 0,
          likeCount: 0,
          createdById: admin.id,
          createdAt: clock.nowUtcIso(),
          updatedAt: clock.nowUtcIso(),
        });
        const [item2File] = await contentRepo.replaceFiles(item2.id, [
          {
            contentId: item2.id,
            kind: ContentFileKind.Main,
            storageType: FileStorageType.Local,
            storageKey: saved.storageKey,
            externalUrl: null,
            originalFileName: 'restricted.pdf',
            mimeType: 'application/pdf',
            sizeBytes: 6,
            isDownloadable: true,
            sortOrder: 0,
          },
        ]);
        const link2 = await service.createSignedDownloadLinkAsync({
          currentUser: member,
          contentId: item2.id,
          fileId: item2File.id,
          activeAgeGroup: adultAge,
        });
        assert(link2.ok, 'Link issued for item2 while downloadable');
        if (!link2.ok) return;

        // Flip isDownloadable = false on the exact same file row (simulating DB update in place)
        const internalFiles = (contentRepo as unknown as { files: ContentFile[] }).files;
        const targetRow = internalFiles.find((f) => f.id === item2File.id)!;
        targetRow.isDownloadable = false;

        const afterToggleRes = await service.executeSignedDownloadAsync({
          token: link2.token,
          currentUser: member,
          activeAgeGroup: adultAge,
        });
        assertEqual(afterToggleRes.ok, false, 'Executing previously issued token after isDownloadable=false must fail');
        if (!afterToggleRes.ok) {
          assertEqual(
            afterToggleRes.errorCode,
            'FILE_NOT_DOWNLOADABLE',
            'Must reject direct token execution with FILE_NOT_DOWNLOADABLE',
          );
        }
        assertEqual((await downloadRepo.getAllDownloadEvents()).length, 0, 'No DownloadEvent may be recorded');
        void validPayloadToken;
        void tokenForDisabledFile;
      } finally {
        logger.clearLogs();
      }
    },
  },
  {
    id: 'stage14-auth-required-and-return-url',
    nameKey: 'tests.stage14.authRequiredAndReturnUrl.name',
    descriptionKey: 'tests.stage14.authRequiredAndReturnUrl.desc',
    run: async () => {
      const clock = new Stage14FakeClock('2026-11-22T10:00:00.000Z');
      const logger = new AppLogger(clock, `meraj_s14_auth_${Date.now()}`, 50);
      try {
        const ages = getAgeGroupsWithIds();
        const adultAge = ages.find((a) => a.key === 'adult')!;
        const userStore = new MemoryStage14UserStore();
        const author = userStore.createUser({
          email: 'author-auth@meraj.local',
          displayName: 'نویسنده',
          role: 'Staff',
          ageGroupId: adultAge.id,
        });
        const member = userStore.createUser({
          email: 'member-auth@meraj.local',
          displayName: 'عضو',
          role: 'Member',
          ageGroupId: adultAge.id,
        });

        const contentRepo = new MemoryStage14ContentRepository(userStore);
        const downloadRepo = new MemoryDownloadEventRepository();
        const fileStorage = new MemoryStage14FileStorage(clock);
        const protector = new HmacDownloadTokenProtector({ secretKeyBytes: makeTestSecretKey() });
        const service = new DownloadService(
          contentRepo,
          downloadRepo,
          fileStorage,
          protector,
          clock,
          logger,
        );

        const item = await contentRepo.createContentItem({
          title: 'مسیر اقتصاد',
          slug: 'مسیر-اقتصاد',
          summary: 'تحلیل اقتصادی',
          body: null,
          format: 'Pdf',
          impactLevelId: 1,
          status: ContentStatus.Published,
          publishedAt: clock.nowUtcIso(),
          readWatchMinutes: 8,
          thumbnailKey: null,
          isFeatured: false,
          languageCode: 'fa',
          searchText: 'مسیر اقتصاد',
          viewCount: 0,
          downloadCount: 0,
          likeCount: 0,
          createdById: author.id,
          createdAt: clock.nowUtcIso(),
          updatedAt: clock.nowUtcIso(),
        });

        const guestLinkRes = await service.createSignedDownloadLinkAsync({
          currentUser: null,
          contentId: item.id,
          fileId: 1,
          activeAgeGroup: adultAge,
          returnUrl: '#/content/مسیر-اقتصاد',
        });
        assertEqual(guestLinkRes.ok, false, 'Guest must not obtain signed download link');
        if (!guestLinkRes.ok) {
          assertEqual(guestLinkRes.errorCode, 'AUTH_REQUIRED', 'Guest error code must be AUTH_REQUIRED');
          assert(
            Boolean(guestLinkRes.redirectUrl?.startsWith('#/account/login?returnUrl=')),
            'redirectUrl must point to login with returnUrl parameter',
          );
        }

        const guestExecRes = await service.executeSignedDownloadAsync({
          token: 'any.token',
          currentUser: null,
          activeAgeGroup: adultAge,
        });
        assertEqual(guestExecRes.ok, false, 'Guest cannot execute signed download');
        if (!guestExecRes.ok) {
          assertEqual(guestExecRes.errorCode, 'AUTH_REQUIRED', 'Guest execute must return AUTH_REQUIRED');
        }

        const redirectTarget = resolvePostLoginRedirect(member, '#/content/مسیر-اقتصاد');
        assertEqual(
          redirectTarget,
          '#/content/مسیر-اقتصاد',
          'resolvePostLoginRedirect must return member to exact Persian returnUrl',
        );

        // Ensure open-redirect inputs are rejected safely
        assertEqual(
          resolvePostLoginRedirect(member, 'https://evil.example.com/phish'),
          '#/',
          'External http URL returnUrl must be blocked',
        );
        assertEqual(
          resolvePostLoginRedirect(member, '//evil.example.com'),
          '#/',
          'Protocol-relative returnUrl must be blocked',
        );
      } finally {
        logger.clearLogs();
      }
    },
  },
  {
    id: 'stage14-range-support',
    nameKey: 'tests.stage14.rangeSupport.name',
    descriptionKey: 'tests.stage14.rangeSupport.desc',
    run: async () => {
      const clock = new Stage14FakeClock('2026-11-22T10:00:00.000Z');
      const logger = new AppLogger(clock, `meraj_s14_range_${Date.now()}`, 50);
      try {
        const ages = getAgeGroupsWithIds();
        const adultAge = ages.find((a) => a.key === 'adult')!;
        const userStore = new MemoryStage14UserStore();
        const member = userStore.createUser({
          email: 'member-range@meraj.local',
          displayName: 'عضو بازه',
          role: 'Member',
          ageGroupId: adultAge.id,
        });

        const contentRepo = new MemoryStage14ContentRepository(userStore);
        const downloadRepo = new MemoryDownloadEventRepository();
        const fileStorage = new MemoryStage14FileStorage(clock);
        const protector = new HmacDownloadTokenProtector({ secretKeyBytes: makeTestSecretKey() });
        const service = new DownloadService(
          contentRepo,
          downloadRepo,
          fileStorage,
          protector,
          clock,
          logger,
        );

        const payload = new TextEncoder().encode('0123456789ABCDEF'); // 16 bytes
        const saved = await fileStorage.saveAsync({
          bytes: payload,
          originalFileName: 'audio-range.mp3',
          contentType: 'audio/mpeg',
          visibility: 'private',
          uploadedById: member.id,
        });

        const item = await contentRepo.createContentItem({
          title: 'صوت تست بازه',
          slug: 'audio-range-item',
          summary: 'خلاصه',
          body: null,
          format: 'Audio',
          impactLevelId: 1,
          status: ContentStatus.Published,
          publishedAt: clock.nowUtcIso(),
          readWatchMinutes: 6,
          thumbnailKey: null,
          isFeatured: false,
          languageCode: 'fa',
          searchText: 'صوت تست بازه',
          viewCount: 0,
          downloadCount: 0,
          likeCount: 0,
          createdById: member.id,
          createdAt: clock.nowUtcIso(),
          updatedAt: clock.nowUtcIso(),
        });

        const [file] = await contentRepo.replaceFiles(item.id, [
          {
            contentId: item.id,
            kind: ContentFileKind.Main,
            storageType: FileStorageType.Local,
            storageKey: saved.storageKey,
            externalUrl: null,
            originalFileName: 'audio-range.mp3',
            mimeType: 'audio/mpeg',
            sizeBytes: payload.byteLength,
            isDownloadable: true,
            sortOrder: 0,
          },
        ]);

        const linkRes = await service.createSignedDownloadLinkAsync({
          currentUser: member,
          contentId: item.id,
          fileId: file.id,
          activeAgeGroup: adultAge,
        });
        assert(linkRes.ok, 'Range test link creation must succeed');
        if (!linkRes.ok) return;

        const rangeExec = await service.executeSignedDownloadAsync({
          token: linkRes.token,
          currentUser: member,
          activeAgeGroup: adultAge,
          range: { startByte: 2, endByte: 5 },
        });
        assertEqual(rangeExec.ok, true, 'Range signed download must succeed');
        if (!rangeExec.ok) return;

        assertEqual(rangeExec.bytes.byteLength, 4, 'Range [2..5] must return exact 4 bytes');
        assertEqual(new TextDecoder().decode(rangeExec.bytes), '2345', 'Range [2..5] bytes must equal "2345"');
        assertEqual(rangeExec.rangeMeta?.startByte, 2, 'rangeMeta.startByte must be 2');
        assertEqual(rangeExec.rangeMeta?.endByte, 5, 'rangeMeta.endByte must be 5');
        assertEqual(rangeExec.rangeMeta?.totalBytes, 16, 'rangeMeta.totalBytes must be 16');
        assertEqual((await downloadRepo.getAllDownloadEvents()).length, 1, 'Range download must record 1 DownloadEvent');

        // Browser IndexedDB Migration v8 + DownloadEvent repository roundtrip
        if (typeof indexedDB !== 'undefined') {
          const testDbName = `MerajAndishehDB_S14_${Date.now()}`;
          const store = new IndexedDbDataStore(
            testDbName,
            envConfig.databaseVersion,
            envConfig.metaStoreName,
          );
          try {
            const seeder = new DatabaseSeeder(store, logger);
            await seeder.seed();

            const storeNames = await store.getObjectStoreNames();
            for (const expectedStore of STAGE14_OBJECT_STORES) {
              assert(
                storeNames.includes(expectedStore),
                `Missing Stage 14 ObjectStore after Migration v${envConfig.databaseVersion}: ${expectedStore}`,
              );
            }

            for (const [idxName, probeKey] of [
              ['by_contentId', -1],
              ['by_fileId', -1],
              ['by_userId', -1],
              ['by_kind', -1],
              ['by_occurredAt', ''],
            ] as const) {
              const rows = await store.getAllByIndex(STORE_NAMES.DOWNLOAD_EVENTS, idxName, probeKey);
              assert(Array.isArray(rows), `Index ${idxName} on downloadEvents must exist`);
            }

            const idbAuthRepo = new IndexedDbAuthRepository(store);
            const idbContentRepo = new IndexedDbContentRepository(store);
            const idbDownloadRepo = new IndexedDbDownloadEventRepository(store);
            const idbFileStorage = new LocalIndexedDbFileStorage(store, clock);

            const idbMember = await idbAuthRepo.createUser({
              email: 's14-idb-member@meraj.local',
              normalizedEmail: 'S14-IDB-MEMBER@MERAJ.LOCAL',
              phoneNumber: null,
              normalizedPhoneNumber: null,
              displayName: 'عضو پایگاه داده',
              role: 'Member',
              ageGroupId: adultAge.id,
              personalizationEnabled: false,
              emailConfirmed: true,
              phoneNumberConfirmed: false,
              mustChangePassword: false,
              isActive: true,
              failedLoginCount: 0,
              lockoutEnd: null,
              passwordHash: 'hash',
              passwordSalt: 'salt',
              createdAt: clock.nowUtcIso(),
              lastLoginAt: null,
            });

            const idbSaved = await idbFileStorage.saveAsync({
              bytes: payload,
              originalFileName: 'idb-range.mp3',
              contentType: 'audio/mpeg',
              visibility: 'private',
              uploadedById: idbMember.id,
            });

            const idbItem = await idbContentRepo.createContentItem({
              title: 'محتوای پایگاه داده مرحله ۱۴',
              slug: 'idb-stage14-item',
              summary: 'خلاصه',
              body: null,
              format: 'Audio',
              impactLevelId: 1,
              status: ContentStatus.Published,
              publishedAt: clock.nowUtcIso(),
              readWatchMinutes: 5,
              thumbnailKey: null,
              isFeatured: false,
              languageCode: 'fa',
              searchText: 'محتوای پایگاه داده مرحله ۱۴',
              viewCount: 0,
              downloadCount: 0,
              likeCount: 0,
              createdById: idbMember.id,
              createdAt: clock.nowUtcIso(),
              updatedAt: clock.nowUtcIso(),
            });

            const [idbFile] = await idbContentRepo.replaceFiles(idbItem.id, [
              {
                contentId: idbItem.id,
                kind: ContentFileKind.Main,
                storageType: FileStorageType.Local,
                storageKey: idbSaved.storageKey,
                externalUrl: null,
                originalFileName: 'idb-range.mp3',
                mimeType: 'audio/mpeg',
                sizeBytes: payload.byteLength,
                isDownloadable: true,
                sortOrder: 0,
              },
            ]);

            const idbProtector = new HmacDownloadTokenProtector({
              secretKeyBytes: makeTestSecretKey(),
            });
            const idbService = new DownloadService(
              idbContentRepo,
              idbDownloadRepo,
              idbFileStorage,
              idbProtector,
              clock,
              logger,
            );

            const idbLink = await idbService.createSignedDownloadLinkAsync({
              currentUser: idbMember,
              contentId: idbItem.id,
              fileId: idbFile.id,
              activeAgeGroup: adultAge,
            });
            assert(idbLink.ok, 'IDB signed download link must succeed');
            if (!idbLink.ok) return;

            const idbExec = await idbService.executeSignedDownloadAsync({
              token: idbLink.token,
              currentUser: idbMember,
              activeAgeGroup: adultAge,
              range: { startByte: 2, endByte: 5 },
            });
            assert(idbExec.ok, 'IDB Range download must succeed');
            if (!idbExec.ok) return;

            assertEqual(new TextDecoder().decode(idbExec.bytes), '2345', 'IDB Range [2..5] must match "2345"');
            const storedEvents = await idbDownloadRepo.getDownloadEventsByContentId(idbItem.id);
            assertEqual(storedEvents.length, 1, 'IndexedDB downloadEvents must store 1 record');
            assertEqual(storedEvents[0].userId, idbMember.id, 'Stored DownloadEvent userId must match real user');

            const updatedIdbItem = await idbContentRepo.getContentItemById(idbItem.id);
            assertEqual(updatedIdbItem?.downloadCount, 1, 'IndexedDB ContentItem.downloadCount must increment to 1');
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
