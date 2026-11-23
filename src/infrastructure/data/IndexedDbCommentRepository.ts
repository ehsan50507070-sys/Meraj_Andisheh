import type { ICommentRepository } from '../../core/abstractions/commentRepository';
import type {
  BlockedWord,
  CommentItem,
  CommentReport,
  CommentStatus,
} from '../../core/domain/comments';
import type { IndexedDbDataStore } from './IndexedDbDataStore';
import { STORE_NAMES } from './migrations';

export class IndexedDbCommentRepository implements ICommentRepository {
  private readonly dataStore: IndexedDbDataStore;

  constructor(dataStore: IndexedDbDataStore) {
    this.dataStore = dataStore;
  }

  public async getCommentById(id: number): Promise<CommentItem | null> {
    return this.dataStore.getByKey<CommentItem>(STORE_NAMES.COMMENTS, id);
  }

  public async getCommentsByContentId(contentId: number): Promise<CommentItem[]> {
    return this.dataStore.getAllByIndex<CommentItem>(
      STORE_NAMES.COMMENTS,
      'by_contentId',
      contentId,
    );
  }

  public async getCommentsByUserId(userId: number): Promise<CommentItem[]> {
    return this.dataStore.getAllByIndex<CommentItem>(
      STORE_NAMES.COMMENTS,
      'by_userId',
      userId,
    );
  }

  public async getCommentsByStatus(status: CommentStatus): Promise<CommentItem[]> {
    return this.dataStore.getAllByIndex<CommentItem>(
      STORE_NAMES.COMMENTS,
      'by_status',
      status,
    );
  }

  public async getAllComments(): Promise<CommentItem[]> {
    return this.dataStore.getAll<CommentItem>(STORE_NAMES.COMMENTS);
  }

  public async createComment(comment: Omit<CommentItem, 'id'>): Promise<CommentItem> {
    const id = await this.dataStore.addRecordWithAutoId(STORE_NAMES.COMMENTS, comment);
    return { ...comment, id };
  }

  public async updateComment(comment: CommentItem): Promise<void> {
    await this.dataStore.putRecord(STORE_NAMES.COMMENTS, comment);
  }

  public async deleteComment(id: number): Promise<void> {
    await this.dataStore.deleteByKey(STORE_NAMES.COMMENTS, id);
  }

  public async getReportById(id: number): Promise<CommentReport | null> {
    return this.dataStore.getByKey<CommentReport>(STORE_NAMES.COMMENT_REPORTS, id);
  }

  public async getReportByCommentAndUser(
    commentId: number,
    userId: number,
  ): Promise<CommentReport | null> {
    return this.dataStore.getByIndex<CommentReport>(
      STORE_NAMES.COMMENT_REPORTS,
      'by_comment_user',
      [commentId, userId],
    );
  }

  public async getReportsByCommentId(commentId: number): Promise<CommentReport[]> {
    return this.dataStore.getAllByIndex<CommentReport>(
      STORE_NAMES.COMMENT_REPORTS,
      'by_commentId',
      commentId,
    );
  }

  public async getAllReports(): Promise<CommentReport[]> {
    return this.dataStore.getAll<CommentReport>(STORE_NAMES.COMMENT_REPORTS);
  }

  public async createReport(
    report: Omit<CommentReport, 'id'>,
  ): Promise<CommentReport> {
    const id = await this.dataStore.addRecordWithAutoId(
      STORE_NAMES.COMMENT_REPORTS,
      report,
    );
    return { ...report, id };
  }

  public async deleteReport(id: number): Promise<void> {
    await this.dataStore.deleteByKey(STORE_NAMES.COMMENT_REPORTS, id);
  }

  public async deleteReportsByCommentId(commentId: number): Promise<number> {
    const reports = await this.getReportsByCommentId(commentId);
    for (const report of reports) {
      await this.dataStore.deleteByKey(STORE_NAMES.COMMENT_REPORTS, report.id);
    }
    return reports.length;
  }

  public async getAllBlockedWords(): Promise<BlockedWord[]> {
    return this.dataStore.getAll<BlockedWord>(STORE_NAMES.BLOCKED_WORDS);
  }

  public async getBlockedWordById(id: number): Promise<BlockedWord | null> {
    return this.dataStore.getByKey<BlockedWord>(STORE_NAMES.BLOCKED_WORDS, id);
  }

  public async getBlockedWordByNormalizedWord(
    normalizedWord: string,
  ): Promise<BlockedWord | null> {
    return this.dataStore.getByIndex<BlockedWord>(
      STORE_NAMES.BLOCKED_WORDS,
      'by_word',
      normalizedWord,
    );
  }

  public async createBlockedWord(
    entry: Omit<BlockedWord, 'id'>,
  ): Promise<BlockedWord> {
    const id = await this.dataStore.addRecordWithAutoId(
      STORE_NAMES.BLOCKED_WORDS,
      entry,
    );
    return { ...entry, id };
  }

  public async deleteBlockedWord(id: number): Promise<void> {
    await this.dataStore.deleteByKey(STORE_NAMES.BLOCKED_WORDS, id);
  }
}
