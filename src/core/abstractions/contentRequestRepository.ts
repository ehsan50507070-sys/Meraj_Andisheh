import type { ContentRequestItem } from '../domain/requests';

export interface IContentRequestRepository {
  getContentRequestById(id: number): Promise<ContentRequestItem | null>;
  getContentRequestsByUserId(userId: number): Promise<ContentRequestItem[]>;
  getAllContentRequests(): Promise<ContentRequestItem[]>;
  createContentRequest(
    request: Omit<ContentRequestItem, 'id'>,
  ): Promise<ContentRequestItem>;
  updateContentRequest(request: ContentRequestItem): Promise<void>;
  deleteContentRequest(id: number): Promise<void>;
}
