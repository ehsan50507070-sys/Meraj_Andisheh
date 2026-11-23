export enum ContentRequestStatus {
  Submitted = 1,
  InProgress = 2,
  Done = 3,
  Rejected = 4,
}

export interface ContentRequestItem {
  id: number;
  userId: number;
  title: string;
  description: string;
  link: string | null;
  status: ContentRequestStatus;
  adminNote: string | null;
  linkedContentId: number | null;
  createdAt: string;
  updatedAt: string;
}
