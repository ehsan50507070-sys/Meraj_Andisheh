import type { IAccountCleanupRepository } from '../../core/abstractions/interactionRepository';
import type { DownloadEvent, ViewEvent } from '../../core/domain/analytics';
import type { AuthToken, UserSession } from '../../core/domain/auth';
import type { OtpCode } from '../../core/domain/otp';
import { IndexedDbDataStore } from './IndexedDbDataStore';
import { STORE_NAMES } from './migrations';

interface OptionalCommentRecord {
  id: number;
  userId?: number | null;
  authorDisplayName?: string;
}

interface OptionalAffinityRecord {
  id?: number;
  userId: number;
  rootTopicId?: number;
  topicId?: number;
}

export class IndexedDbAccountCleanupRepository implements IAccountCleanupRepository {
  private readonly dataStore: IndexedDbDataStore;

  constructor(dataStore: IndexedDbDataStore) {
    this.dataStore = dataStore;
  }

  public async deleteSessionsByUserId(userId: number): Promise<number> {
    const sessions = await this.dataStore.getAllByIndex<UserSession>(
      STORE_NAMES.SESSIONS,
      'by_userId',
      userId,
    );
    for (const session of sessions) {
      await this.dataStore.deleteByKey(STORE_NAMES.SESSIONS, session.id);
    }
    return sessions.length;
  }

  public async deleteAuthTokensByUserId(userId: number): Promise<number> {
    const tokens = await this.dataStore.getAllByIndex<AuthToken>(
      STORE_NAMES.AUTH_TOKENS,
      'by_userId',
      userId,
    );
    for (const token of tokens) {
      await this.dataStore.deleteByKey(STORE_NAMES.AUTH_TOKENS, token.id);
    }
    return tokens.length;
  }

  public async deleteOtpCodesByPhoneNumber(phoneNumber: string): Promise<number> {
    if (!phoneNumber) {
      return 0;
    }
    const otps = await this.dataStore.getAllByIndex<OtpCode>(
      STORE_NAMES.OTP_CODES,
      'by_phoneNumber',
      phoneNumber,
    );
    for (const otp of otps) {
      await this.dataStore.deleteByKey(STORE_NAMES.OTP_CODES, otp.id);
    }
    return otps.length;
  }

  public async anonymizeViewEventsByUserId(userId: number): Promise<number> {
    const events = await this.dataStore.getAllByIndex<ViewEvent>(
      STORE_NAMES.VIEW_EVENTS,
      'by_userId',
      userId,
    );
    for (const ev of events) {
      await this.dataStore.putRecord<ViewEvent>(STORE_NAMES.VIEW_EVENTS, {
        ...ev,
        userId: null,
      });
    }
    return events.length;
  }

  public async anonymizeDownloadEventsByUserId(userId: number): Promise<number> {
    const events = await this.dataStore.getAllByIndex<DownloadEvent>(
      STORE_NAMES.DOWNLOAD_EVENTS,
      'by_userId',
      userId,
    );
    for (const ev of events) {
      await this.dataStore.putRecord<DownloadEvent>(STORE_NAMES.DOWNLOAD_EVENTS, {
        ...ev,
        userId: null,
      });
    }
    return events.length;
  }

  public async anonymizeOptionalCommentsByUserId(
    userId: number,
    _deletedDisplayName: string,
  ): Promise<number> {
    const storeNames = await this.dataStore.getObjectStoreNames();
    if (!storeNames.includes(STORE_NAMES.COMMENTS)) {
      return 0;
    }
    // Rule 6.7: Preserve comment records with their userId FK pointing to the anonymized AppUser
    // (whose displayName is set to «کاربر حذف‌شده» and isDeleted = true); CommentService resolves that label.
    const userComments = await this.dataStore.getAllByIndex<OptionalCommentRecord>(
      STORE_NAMES.COMMENTS,
      'by_userId',
      userId,
    );
    return userComments.length;
  }

  public async deleteOptionalTopicAffinitiesByUserId(userId: number): Promise<number> {
    const storeNames = await this.dataStore.getObjectStoreNames();
    if (!storeNames.includes(STORE_NAMES.USER_TOPIC_AFFINITIES)) {
      return 0;
    }
    const userAffinities = await this.dataStore.getAllByIndex<OptionalAffinityRecord>(
      STORE_NAMES.USER_TOPIC_AFFINITIES,
      'by_userId',
      userId,
    );
    let count = 0;
    for (const aff of userAffinities) {
      if (aff.userId === userId) {
        if (typeof aff.rootTopicId === 'number') {
          await this.dataStore.deleteByKey(STORE_NAMES.USER_TOPIC_AFFINITIES, [
            aff.userId,
            aff.rootTopicId,
          ]);
          count += 1;
        } else if (typeof aff.topicId === 'number') {
          await this.dataStore.deleteByKey(STORE_NAMES.USER_TOPIC_AFFINITIES, [
            aff.userId,
            aff.topicId,
          ]);
          count += 1;
        } else if (typeof aff.id === 'number') {
          await this.dataStore.deleteByKey(STORE_NAMES.USER_TOPIC_AFFINITIES, aff.id);
          count += 1;
        }
      }
    }
    return count;
  }
}
