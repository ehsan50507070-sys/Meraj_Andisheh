import type {
  BlockedWord,
  CommentItem,
  CommentReport,
  CommentStatus,
} from '../domain/comments';

export interface ICommentRepository {
  // Comments
  getCommentById(id: number): Promise<CommentItem | null>;
  getCommentsByContentId(contentId: number): Promise<CommentItem[]>;
  getCommentsByUserId(userId: number): Promise<CommentItem[]>;
  getCommentsByStatus(status: CommentStatus): Promise<CommentItem[]>;
  getAllComments(): Promise<CommentItem[]>;
  createComment(comment: Omit<CommentItem, 'id'>): Promise<CommentItem>;
  updateComment(comment: CommentItem): Promise<void>;
  deleteComment(id: number): Promise<void>;

  // Comment Reports
  getReportById(id: number): Promise<CommentReport | null>;
  getReportByCommentAndUser(commentId: number, userId: number): Promise<CommentReport | null>;
  getReportsByCommentId(commentId: number): Promise<CommentReport[]>;
  getAllReports(): Promise<CommentReport[]>;
  createReport(report: Omit<CommentReport, 'id'>): Promise<CommentReport>;
  deleteReport(id: number): Promise<void>;
  deleteReportsByCommentId(commentId: number): Promise<number>;

  // Blocked Words
  getAllBlockedWords(): Promise<BlockedWord[]>;
  getBlockedWordById(id: number): Promise<BlockedWord | null>;
  getBlockedWordByNormalizedWord(normalizedWord: string): Promise<BlockedWord | null>;
  createBlockedWord(entry: Omit<BlockedWord, 'id'>): Promise<BlockedWord>;
  deleteBlockedWord(id: number): Promise<void>;
}
