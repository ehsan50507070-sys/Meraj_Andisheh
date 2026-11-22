export type FileVisibility = 'public' | 'private';

export type FileCategory =
  | 'video'
  | 'audio'
  | 'image'
  | 'document'
  | 'presentation'
  | 'archive';

export type FileValidationErrorCode =
  | 'EMPTY_FILE'
  | 'MISSING_EXTENSION'
  | 'FORBIDDEN_EXTENSION'
  | 'UNSUPPORTED_EXTENSION'
  | 'FILE_SIGNATURE_MISMATCH'
  | 'FILE_TOO_LARGE'
  | 'PUBLIC_ONLY_IMAGES_ALLOWED';

export interface StoredFileMetadata {
  storageKey: string;
  originalFileName: string;
  extension: string;
  mimeType: string;
  sizeBytes: number;
  visibility: FileVisibility;
  category: FileCategory;
  uploadedById: number | null;
  /** ISO 8601 UTC timestamp */
  createdAt: string;
}

export interface FileSaveRequest {
  bytes: Uint8Array;
  originalFileName: string;
  contentType: string;
  visibility: FileVisibility;
  uploadedById?: number | null;
}

export interface FileValidationResult {
  isValid: boolean;
  errorCode?: FileValidationErrorCode;
  category?: FileCategory;
  normalizedExtension?: string;
  detectedMimeType?: string;
  maxAllowedBytes?: number;
}
