import type {
  IDownloadTokenProtector,
  UnprotectDownloadTokenResult,
} from '../../core/abstractions/downloadTokenProtector';
import type { DownloadTokenPayload } from '../../core/domain/analytics';

const DEFAULT_KEY_STORAGE_NAME = 'meraj_download_protection_key_v1';
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  if (typeof btoa === 'function') {
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  }
  return Buffer.from(bytes).toString('base64url');
}

function fromBase64Url(encoded: string): Uint8Array | null {
  if (!encoded || !BASE64URL_PATTERN.test(encoded)) {
    return null;
  }
  try {
    if (typeof atob === 'function') {
      const padded = encoded.replace(/-/g, '+').replace(/_/g, '/');
      const padLen = (4 - (padded.length % 4)) % 4;
      const base64 = padded + '='.repeat(padLen);
      const binary = atob(base64);
      const out = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) {
        out[i] = binary.charCodeAt(i);
      }
      return out;
    }
    return new Uint8Array(Buffer.from(encoded, 'base64url'));
  } catch {
    return null;
  }
}

function timingSafeEqualBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a[i] ^ b[i];
  }
  return diff === 0;
}

/**
 * Pure TypeScript SHA-256 returning 32 raw bytes, used for RFC 2104 HMAC-SHA256
 * when Web Crypto subtle API is unavailable.
 */
function sha256Raw(messageBytes: Uint8Array): Uint8Array {
  const K = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ]);

  const H = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);

  const bitLen = messageBytes.length * 8;
  const paddedLen = Math.ceil((messageBytes.length + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLen);
  padded.set(messageBytes);
  padded[messageBytes.length] = 0x80;

  const view = new DataView(padded.buffer);
  view.setUint32(paddedLen - 8, Math.floor(bitLen / 0x100000000), false);
  view.setUint32(paddedLen - 4, bitLen >>> 0, false);

  const w = new Uint32Array(64);
  for (let offset = 0; offset < paddedLen; offset += 64) {
    for (let i = 0; i < 16; i += 1) {
      w[i] = view.getUint32(offset + i * 4, false);
    }
    for (let i = 16; i < 64; i += 1) {
      const s0 =
        ((w[i - 15] >>> 7) | (w[i - 15] << 25)) ^
        ((w[i - 15] >>> 18) | (w[i - 15] << 14)) ^
        (w[i - 15] >>> 3);
      const s1 =
        ((w[i - 2] >>> 17) | (w[i - 2] << 15)) ^
        ((w[i - 2] >>> 19) | (w[i - 2] << 13)) ^
        (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }

    let [a, b, c, d, e, f, g, h] = H;
    for (let i = 0; i < 64; i += 1) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + K[i] + w[i]) >>> 0;
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) >>> 0;

      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    H[0] = (H[0] + a) >>> 0;
    H[1] = (H[1] + b) >>> 0;
    H[2] = (H[2] + c) >>> 0;
    H[3] = (H[3] + d) >>> 0;
    H[4] = (H[4] + e) >>> 0;
    H[5] = (H[5] + f) >>> 0;
    H[6] = (H[6] + g) >>> 0;
    H[7] = (H[7] + h) >>> 0;
  }

  const out = new Uint8Array(32);
  const outView = new DataView(out.buffer);
  for (let i = 0; i < 8; i += 1) {
    outView.setUint32(i * 4, H[i], false);
  }
  return out;
}

function hmacSha256Pure(keyBytes: Uint8Array, messageBytes: Uint8Array): Uint8Array {
  const blockSize = 64;
  const normalizedKey = new Uint8Array(blockSize);
  if (keyBytes.length > blockSize) {
    normalizedKey.set(sha256Raw(keyBytes));
  } else {
    normalizedKey.set(keyBytes);
  }

  const innerPad = new Uint8Array(blockSize + messageBytes.length);
  const outerPad = new Uint8Array(blockSize + 32);

  for (let i = 0; i < blockSize; i += 1) {
    innerPad[i] = normalizedKey[i] ^ 0x36;
    outerPad[i] = normalizedKey[i] ^ 0x5c;
  }
  innerPad.set(messageBytes, blockSize);
  const innerHash = sha256Raw(innerPad);
  outerPad.set(innerHash, blockSize);
  return sha256Raw(outerPad);
}

function isValidPayloadShape(raw: unknown): raw is DownloadTokenPayload {
  if (!raw || typeof raw !== 'object') {
    return false;
  }
  const obj = raw as Record<string, unknown>;
  return (
    typeof obj.userId === 'number' &&
    Number.isInteger(obj.userId) &&
    obj.userId > 0 &&
    typeof obj.contentId === 'number' &&
    Number.isInteger(obj.contentId) &&
    obj.contentId > 0 &&
    typeof obj.fileId === 'number' &&
    Number.isInteger(obj.fileId) &&
    obj.fileId > 0 &&
    typeof obj.issuedAtEpochMs === 'number' &&
    Number.isFinite(obj.issuedAtEpochMs) &&
    typeof obj.expiresAtEpochMs === 'number' &&
    Number.isFinite(obj.expiresAtEpochMs) &&
    obj.expiresAtEpochMs >= obj.issuedAtEpochMs
  );
}

export class HmacDownloadTokenProtector implements IDownloadTokenProtector {
  private readonly encoder = new TextEncoder();
  private readonly decoder = new TextDecoder('utf-8', { fatal: true });
  private readonly keyStorageName: string;
  private cachedKeyBytes: Uint8Array | null;

  constructor(options?: { secretKeyBytes?: Uint8Array; keyStorageName?: string }) {
    this.keyStorageName = options?.keyStorageName ?? DEFAULT_KEY_STORAGE_NAME;
    if (options?.secretKeyBytes && options.secretKeyBytes.byteLength >= 16) {
      const copy = new Uint8Array(options.secretKeyBytes.byteLength);
      copy.set(options.secretKeyBytes);
      this.cachedKeyBytes = copy;
    } else {
      this.cachedKeyBytes = null;
    }
  }

  private getOrGenerateKeyBytes(): Uint8Array {
    if (this.cachedKeyBytes) {
      return this.cachedKeyBytes;
    }

    if (typeof window !== 'undefined' && window.localStorage) {
      try {
        const stored = window.localStorage.getItem(this.keyStorageName);
        if (stored) {
          const decoded = fromBase64Url(stored);
          if (decoded && decoded.byteLength === 32) {
            this.cachedKeyBytes = decoded;
            return decoded;
          }
        }
      } catch {
        // Ignore storage read restrictions and fall back to memory key generation
      }
    }

    const generated = new Uint8Array(32);
    if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
      crypto.getRandomValues(generated);
    } else {
      throw new Error('SECURE_RANDOM_UNAVAILABLE');
    }

    this.cachedKeyBytes = generated;

    if (typeof window !== 'undefined' && window.localStorage) {
      try {
        window.localStorage.setItem(this.keyStorageName, toBase64Url(generated));
      } catch {
        // Ignore storage quota restrictions; in-memory key remains valid for active session
      }
    }

    return generated;
  }

  private async signBytesAsync(messageBytes: Uint8Array): Promise<Uint8Array> {
    const keyBytes = this.getOrGenerateKeyBytes();
    if (typeof crypto !== 'undefined' && typeof crypto.subtle !== 'undefined') {
      const cryptoKey = await crypto.subtle.importKey(
        'raw',
        keyBytes.buffer.slice(0) as ArrayBuffer,
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign'],
      );
      const sigBuffer = await crypto.subtle.sign(
        'HMAC',
        cryptoKey,
        messageBytes.buffer.slice(0) as ArrayBuffer,
      );
      return new Uint8Array(sigBuffer);
    }
    return hmacSha256Pure(keyBytes, messageBytes);
  }

  public async protectAsync(payload: DownloadTokenPayload): Promise<string> {
    const canonicalPayload: DownloadTokenPayload = {
      userId: payload.userId,
      contentId: payload.contentId,
      fileId: payload.fileId,
      issuedAtEpochMs: payload.issuedAtEpochMs,
      expiresAtEpochMs: payload.expiresAtEpochMs,
    };
    const payloadBytes = this.encoder.encode(JSON.stringify(canonicalPayload));
    const encodedPayload = toBase64Url(payloadBytes);
    const sigBytes = await this.signBytesAsync(this.encoder.encode(encodedPayload));
    const encodedSig = toBase64Url(sigBytes);
    return `${encodedPayload}.${encodedSig}`;
  }

  public async unprotectAsync(token: string): Promise<UnprotectDownloadTokenResult> {
    if (!token || typeof token !== 'string') {
      return { isValid: false, reason: 'INVALID_FORMAT' };
    }

    const trimmed = token.trim();
    const parts = trimmed.split('.');
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
      return { isValid: false, reason: 'INVALID_FORMAT' };
    }

    const [encodedPayload, encodedSig] = parts;
    if (!BASE64URL_PATTERN.test(encodedPayload) || !BASE64URL_PATTERN.test(encodedSig)) {
      return { isValid: false, reason: 'INVALID_FORMAT' };
    }

    const providedSigBytes = fromBase64Url(encodedSig);
    if (!providedSigBytes || providedSigBytes.byteLength !== 32) {
      return { isValid: false, reason: 'TAMPERED_SIGNATURE' };
    }

    const expectedSigBytes = await this.signBytesAsync(this.encoder.encode(encodedPayload));
    if (!timingSafeEqualBytes(expectedSigBytes, providedSigBytes)) {
      return { isValid: false, reason: 'TAMPERED_SIGNATURE' };
    }

    const payloadBytes = fromBase64Url(encodedPayload);
    if (!payloadBytes) {
      return { isValid: false, reason: 'INVALID_FORMAT' };
    }

    try {
      const jsonText = this.decoder.decode(payloadBytes);
      const parsed: unknown = JSON.parse(jsonText);
      if (!isValidPayloadShape(parsed)) {
        return { isValid: false, reason: 'INVALID_FORMAT' };
      }
      return {
        isValid: true,
        payload: {
          userId: parsed.userId,
          contentId: parsed.contentId,
          fileId: parsed.fileId,
          issuedAtEpochMs: parsed.issuedAtEpochMs,
          expiresAtEpochMs: parsed.expiresAtEpochMs,
        },
      };
    } catch {
      return { isValid: false, reason: 'INVALID_FORMAT' };
    }
  }
}
