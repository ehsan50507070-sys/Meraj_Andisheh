import type { IClock } from '../abstractions/IClock';
import { isS3ConfigComplete, type S3StorageConfig } from '../domain/storage';

export const DEFAULT_S3_PRESIGNED_EXPIRES_SECONDS = 300;
const MIN_PRESIGNED_SECONDS = 1;
const MAX_PRESIGNED_SECONDS = 3600;

export interface S3PresignedMeta {
  userId: number;
  contentId: number;
  fileId: number;
  issuedAtEpochMs: number;
  expiresInSeconds: number;
}

export interface CreateS3PresignedUrlInput {
  config: S3StorageConfig;
  storageKey: string;
  contentId: number;
  fileId: number;
  userId: number;
  originalFileName?: string;
  expiresInSeconds?: number;
}

export interface CreateS3PresignedUrlResult {
  url: string;
  expiresInSeconds: number;
  issuedAtEpochMs: number;
  expiresAtEpochMs: number;
  amzDate: string;
  signature: string;
  bucketName: string;
  storageKey: string;
}

export type VerifyS3PresignedUrlErrorCode =
  | 'S3_NOT_CONFIGURED'
  | 'INVALID_URL_FORMAT'
  | 'INVALID_SIGNATURE'
  | 'PRESIGNED_URL_EXPIRED';

export type VerifyS3PresignedUrlResult =
  | {
      ok: true;
      bucketName: string;
      storageKey: string;
      issuedAtEpochMs: number;
      expiresAtEpochMs: number;
      expiresInSeconds: number;
      meta: S3PresignedMeta;
    }
  | {
      ok: false;
      errorCode: VerifyS3PresignedUrlErrorCode;
      expiresAtEpochMs?: number;
    };

function toHex(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let out = '';
  for (let i = 0; i < bytes.length; i += 1) {
    out += bytes[i].toString(16).padStart(2, '0');
  }
  return out;
}

function encodeBase64UrlUtf8(input: string): string {
  const bytes = new TextEncoder().encode(input);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 1) {
    bin += String.fromCharCode(bytes[i]);
  }
  if (typeof btoa === 'function') {
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  }
  return Buffer.from(bytes)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function decodeBase64UrlUtf8(encoded: string): string | null {
  try {
    const padded = encoded.replace(/-/g, '+').replace(/_/g, '/');
    const mod = padded.length % 4;
    const base64 = mod === 0 ? padded : `${padded}${'='.repeat(4 - mod)}`;
    if (typeof atob === 'function') {
      const bin = atob(base64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i += 1) {
        bytes[i] = bin.charCodeAt(i);
      }
      return new TextDecoder().decode(bytes);
    }
    return Buffer.from(base64, 'base64').toString('utf-8');
  } catch {
    return null;
  }
}

function constantTimeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length || a.length === 0) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

async function hmacSha256RawAsync(
  keyBytes: Uint8Array,
  message: string,
): Promise<Uint8Array> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new Error('WEB_CRYPTO_SUBTLE_UNAVAILABLE');
  }
  const keyCopy = new Uint8Array(keyBytes.byteLength);
  keyCopy.set(keyBytes);
  const cryptoKey = await subtle.importKey(
    'raw',
    keyCopy.buffer,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const msgBytes = new TextEncoder().encode(message);
  const sig = await subtle.sign('HMAC', cryptoKey, msgBytes);
  return new Uint8Array(sig);
}

async function sha256HexAsync(input: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new Error('WEB_CRYPTO_SUBTLE_UNAVAILABLE');
  }
  const msgBytes = new TextEncoder().encode(input);
  const digest = await subtle.digest('SHA-256', msgBytes);
  return toHex(digest);
}

function formatAmzDate(date: Date): { amzDate: string; dateStamp: string } {
  const yyyy = date.getUTCFullYear().toString().padStart(4, '0');
  const mm = (date.getUTCMonth() + 1).toString().padStart(2, '0');
  const dd = date.getUTCDate().toString().padStart(2, '0');
  const hh = date.getUTCHours().toString().padStart(2, '0');
  const mi = date.getUTCMinutes().toString().padStart(2, '0');
  const ss = date.getUTCSeconds().toString().padStart(2, '0');
  const dateStamp = `${yyyy}${mm}${dd}`;
  return {
    dateStamp,
    amzDate: `${dateStamp}T${hh}${mi}${ss}Z`,
  };
}

function parseAmzDateMs(amzDate: string): number | null {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(amzDate);
  if (!m) {
    return null;
  }
  const ms = Date.UTC(
    Number(m[1]),
    Number(m[2]) - 1,
    Number(m[3]),
    Number(m[4]),
    Number(m[5]),
    Number(m[6]),
  );
  return Number.isNaN(ms) ? null : ms;
}

function encodeRfc3986(str: string): string {
  return encodeURIComponent(str).replace(
    /[!'()*]/g,
    (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function buildCanonicalQueryString(entries: Array<[string, string]>): string {
  return [...entries]
    .sort((a, b) => (a[0] === b[0] ? a[1].localeCompare(b[1]) : a[0].localeCompare(b[0])))
    .map(([k, v]) => `${encodeRfc3986(k)}=${encodeRfc3986(v)}`)
    .join('&');
}

function resolveTargetBaseAndPath(
  config: S3StorageConfig,
  storageKey: string,
): { baseOrigin: string; hostHeader: string; objectPath: string } {
  const cleanKey = storageKey.replace(/^\/+/, '');
  const cleanBucket = config.bucketName.trim();
  const trimmedEndpoint = config.endpoint.trim().replace(/\/+$/, '');

  let parsed: URL;
  if (trimmedEndpoint.startsWith('local-s3://')) {
    const pseudoHost = trimmedEndpoint.slice('local-s3://'.length) || 'local.s3.invalid';
    parsed = new URL(`https://${pseudoHost}`);
  } else {
    parsed = new URL(trimmedEndpoint);
  }

  const basePathPrefix = parsed.pathname === '/' ? '' : parsed.pathname.replace(/\/+$/, '');

  if (config.forcePathStyle) {
    return {
      baseOrigin: trimmedEndpoint.startsWith('local-s3://')
        ? trimmedEndpoint
        : `${parsed.protocol}//${parsed.host}`,
      hostHeader: parsed.host,
      objectPath: `${basePathPrefix}/${cleanBucket}/${cleanKey}`.replace(/\/+/g, '/'),
    };
  }

  const virtualHost = `${cleanBucket}.${parsed.host}`;
  return {
    baseOrigin: trimmedEndpoint.startsWith('local-s3://')
      ? `local-s3://${virtualHost}`
      : `${parsed.protocol}//${virtualHost}`,
    hostHeader: virtualHost,
    objectPath: `${basePathPrefix}/${cleanKey}`.replace(/\/+/g, '/'),
  };
}

async function deriveAws4SigningKeyAsync(
  secretAccessKey: string,
  dateStamp: string,
  region: string,
): Promise<Uint8Array> {
  const kSecret = new TextEncoder().encode(`AWS4${secretAccessKey}`);
  const kDate = await hmacSha256RawAsync(kSecret, dateStamp);
  const kRegion = await hmacSha256RawAsync(kDate, region);
  const kService = await hmacSha256RawAsync(kRegion, 's3');
  return hmacSha256RawAsync(kService, 'aws4_request');
}

function parseMetaToken(raw: string | null): S3PresignedMeta | null {
  if (!raw) {
    return null;
  }
  const decoded = decodeBase64UrlUtf8(raw);
  if (!decoded) {
    return null;
  }
  try {
    const parsed = JSON.parse(decoded) as Partial<S3PresignedMeta>;
    if (
      typeof parsed.userId !== 'number' ||
      typeof parsed.contentId !== 'number' ||
      typeof parsed.fileId !== 'number' ||
      typeof parsed.issuedAtEpochMs !== 'number' ||
      typeof parsed.expiresInSeconds !== 'number'
    ) {
      return null;
    }
    return parsed as S3PresignedMeta;
  } catch {
    return null;
  }
}

function parseLocalOrHttpsUrl(rawUrl: string): {
  scheme: string;
  host: string;
  pathname: string;
  searchParams: URLSearchParams;
} | null {
  try {
    if (rawUrl.startsWith('local-s3://')) {
      const normalized = `https://${rawUrl.slice('local-s3://'.length)}`;
      const url = new URL(normalized);
      return {
        scheme: 'local-s3://',
        host: url.host,
        pathname: url.pathname,
        searchParams: url.searchParams,
      };
    }
    const url = new URL(rawUrl);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      return null;
    }
    return {
      scheme: `${url.protocol}//`,
      host: url.host,
      pathname: url.pathname,
      searchParams: url.searchParams,
    };
  } catch {
    return null;
  }
}

export class S3PresignedUrlService {
  private readonly clock: IClock;

  constructor(clock: IClock) {
    this.clock = clock;
  }

  public async createS3PresignedDownloadUrlAsync(
    input: CreateS3PresignedUrlInput,
  ): Promise<CreateS3PresignedUrlResult> {
    if (!isS3ConfigComplete(input.config)) {
      throw new Error('S3_NOT_CONFIGURED');
    }

    const expiresInSeconds = Math.max(
      MIN_PRESIGNED_SECONDS,
      Math.min(
        MAX_PRESIGNED_SECONDS,
        Math.floor(input.expiresInSeconds ?? DEFAULT_S3_PRESIGNED_EXPIRES_SECONDS),
      ),
    );

    const nowDate = this.clock.now();
    const issuedAtEpochMs = nowDate.getTime();
    const expiresAtEpochMs = issuedAtEpochMs + expiresInSeconds * 1000;
    const { amzDate, dateStamp } = formatAmzDate(nowDate);
    const region = input.config.region.trim() || 'ir-thr-at1';
    const accessKeyId = input.config.accessKeyId.trim();
    const bucketName = input.config.bucketName.trim();
    const cleanStorageKey = input.storageKey.trim().replace(/^\/+/, '');
    const credentialScope = `${dateStamp}/${region}/s3/aws4_request`;

    const meta: S3PresignedMeta = {
      userId: input.userId,
      contentId: input.contentId,
      fileId: input.fileId,
      issuedAtEpochMs,
      expiresInSeconds,
    };
    const encodedMeta = encodeBase64UrlUtf8(JSON.stringify(meta));

    const { baseOrigin, hostHeader, objectPath } = resolveTargetBaseAndPath(
      input.config,
      cleanStorageKey,
    );

    const queryEntries: Array<[string, string]> = [
      ['X-Amz-Algorithm', 'AWS4-HMAC-SHA256'],
      ['X-Amz-Credential', `${accessKeyId}/${credentialScope}`],
      ['X-Amz-Date', amzDate],
      ['X-Amz-Expires', String(expiresInSeconds)],
      ['X-Amz-SignedHeaders', 'host'],
      ['X-Meraj-Meta', encodedMeta],
    ];

    if (input.originalFileName) {
      queryEntries.push([
        'response-content-disposition',
        `attachment; filename="${input.originalFileName.replace(/["\r\n]/g, '')}"`,
      ]);
    }

    const canonicalQuery = buildCanonicalQueryString(queryEntries);
    const canonicalUri = objectPath
      .split('/')
      .map((seg) => encodeRfc3986(seg))
      .join('/');

    const canonicalRequest = [
      'GET',
      canonicalUri,
      canonicalQuery,
      `host:${hostHeader}`,
      '',
      'host',
      'UNSIGNED-PAYLOAD',
    ].join('\n');

    const canonicalHash = await sha256HexAsync(canonicalRequest);
    const stringToSign = [
      'AWS4-HMAC-SHA256',
      amzDate,
      credentialScope,
      canonicalHash,
    ].join('\n');

    const signingKey = await deriveAws4SigningKeyAsync(
      input.config.secretAccessKey,
      dateStamp,
      region,
    );
    const sigBytes = await hmacSha256RawAsync(signingKey, stringToSign);
    const signature = toHex(sigBytes.buffer as ArrayBuffer);

    const fullUrl = `${baseOrigin}${canonicalUri}?${canonicalQuery}&X-Amz-Signature=${signature}`;

    return {
      url: fullUrl,
      expiresInSeconds,
      issuedAtEpochMs,
      expiresAtEpochMs,
      amzDate,
      signature,
      bucketName,
      storageKey: cleanStorageKey,
    };
  }

  public async verifyS3PresignedUrlAsync(
    presignedUrl: string,
    config: S3StorageConfig,
  ): Promise<VerifyS3PresignedUrlResult> {
    if (!isS3ConfigComplete(config)) {
      return { ok: false, errorCode: 'S3_NOT_CONFIGURED' };
    }

    const parsed = parseLocalOrHttpsUrl((presignedUrl ?? '').trim());
    if (!parsed) {
      return { ok: false, errorCode: 'INVALID_URL_FORMAT' };
    }

    const params = parsed.searchParams;
    const algorithm = params.get('X-Amz-Algorithm');
    const credential = params.get('X-Amz-Credential');
    const amzDate = params.get('X-Amz-Date');
    const expiresRaw = params.get('X-Amz-Expires');
    const signedHeaders = params.get('X-Amz-SignedHeaders');
    const providedSignature = params.get('X-Amz-Signature');
    const metaRaw = params.get('X-Meraj-Meta');

    if (
      algorithm !== 'AWS4-HMAC-SHA256' ||
      !credential ||
      !amzDate ||
      !expiresRaw ||
      signedHeaders !== 'host' ||
      !providedSignature ||
      !metaRaw
    ) {
      return { ok: false, errorCode: 'INVALID_SIGNATURE' };
    }

    const credParts = credential.split('/');
    if (credParts.length !== 5) {
      return { ok: false, errorCode: 'INVALID_SIGNATURE' };
    }
    const [credAccessKey, dateStamp, credRegion, credService, credTerm] = credParts;
    if (
      credAccessKey !== config.accessKeyId.trim() ||
      credService !== 's3' ||
      credTerm !== 'aws4_request'
    ) {
      return { ok: false, errorCode: 'INVALID_SIGNATURE' };
    }

    const issuedAtFromDateMs = parseAmzDateMs(amzDate);
    const expiresInSeconds = Number(expiresRaw);
    if (
      issuedAtFromDateMs === null ||
      !Number.isFinite(expiresInSeconds) ||
      expiresInSeconds <= 0
    ) {
      return { ok: false, errorCode: 'INVALID_SIGNATURE' };
    }

    const meta = parseMetaToken(metaRaw);
    if (!meta) {
      return { ok: false, errorCode: 'INVALID_SIGNATURE' };
    }

    // Recompute canonical query omitting X-Amz-Signature
    const queryEntries: Array<[string, string]> = [];
    params.forEach((value, key) => {
      if (key !== 'X-Amz-Signature') {
        queryEntries.push([key, value]);
      }
    });
    const canonicalQuery = buildCanonicalQueryString(queryEntries);
    const canonicalUri = parsed.pathname
      .split('/')
      .map((seg) => {
        try {
          return encodeRfc3986(decodeURIComponent(seg));
        } catch {
          return encodeRfc3986(seg);
        }
      })
      .join('/');

    const canonicalRequest = [
      'GET',
      canonicalUri,
      canonicalQuery,
      `host:${parsed.host}`,
      '',
      'host',
      'UNSIGNED-PAYLOAD',
    ].join('\n');

    const canonicalHash = await sha256HexAsync(canonicalRequest);
    const credentialScope = `${dateStamp}/${credRegion}/s3/aws4_request`;
    const stringToSign = [
      'AWS4-HMAC-SHA256',
      amzDate,
      credentialScope,
      canonicalHash,
    ].join('\n');

    const signingKey = await deriveAws4SigningKeyAsync(
      config.secretAccessKey,
      dateStamp,
      credRegion,
    );
    const expectedSigBytes = await hmacSha256RawAsync(signingKey, stringToSign);
    const expectedSignature = toHex(expectedSigBytes.buffer as ArrayBuffer);

    if (!constantTimeEqualHex(providedSignature.toLowerCase(), expectedSignature)) {
      return { ok: false, errorCode: 'INVALID_SIGNATURE' };
    }

    // Enforce millisecond-accurate expiration against injected IClock
    const expiresAtEpochMs = meta.issuedAtEpochMs + expiresInSeconds * 1000;
    const nowMs = this.clock.now().getTime();
    if (nowMs > expiresAtEpochMs) {
      return {
        ok: false,
        errorCode: 'PRESIGNED_URL_EXPIRED',
        expiresAtEpochMs,
      };
    }

    // Resolve bucketName & storageKey cleanly from pathname / host
    const cleanBucket = config.bucketName.trim();
    const decodedPath = (() => {
      try {
        return decodeURIComponent(parsed.pathname);
      } catch {
        return parsed.pathname;
      }
    })().replace(/^\/+/, '');

    let storageKey = decodedPath;
    if (config.forcePathStyle) {
      if (!decodedPath.startsWith(`${cleanBucket}/`)) {
        return { ok: false, errorCode: 'INVALID_SIGNATURE' };
      }
      storageKey = decodedPath.slice(cleanBucket.length + 1);
    } else if (!parsed.host.startsWith(`${cleanBucket}.`)) {
      return { ok: false, errorCode: 'INVALID_SIGNATURE' };
    }

    return {
      ok: true,
      bucketName: cleanBucket,
      storageKey,
      issuedAtEpochMs: meta.issuedAtEpochMs,
      expiresAtEpochMs,
      expiresInSeconds,
      meta,
    };
  }
}
