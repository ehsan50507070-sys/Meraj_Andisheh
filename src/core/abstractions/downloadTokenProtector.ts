import type { DownloadTokenPayload } from '../domain/analytics';

export type DownloadTokenInvalidReason = 'INVALID_FORMAT' | 'TAMPERED_SIGNATURE';

export interface UnprotectDownloadTokenResult {
  isValid: boolean;
  payload?: DownloadTokenPayload;
  reason?: DownloadTokenInvalidReason;
}

export interface IDownloadTokenProtector {
  protectAsync(payload: DownloadTokenPayload): Promise<string>;
  unprotectAsync(token: string): Promise<UnprotectDownloadTokenResult>;
}
