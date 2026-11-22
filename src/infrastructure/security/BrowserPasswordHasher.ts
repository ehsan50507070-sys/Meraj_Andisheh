import type {
  IPasswordHasher,
  PasswordHashResult,
} from '../../core/abstractions/passwordHasher';

const PBKDF2_ITERATIONS = 100_000;

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.trim();
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * Pure TypeScript SHA-256 fallback used only when Web Crypto subtle API is unavailable
 * (e.g., restricted insecure test context).
 */
function sha256Pure(messageBytes: Uint8Array): string {
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

  return Array.from(H, (val) => val.toString(16).padStart(8, '0')).join('');
}

export class BrowserPasswordHasher implements IPasswordHasher {
  private readonly encoder = new TextEncoder();

  private getRandomBytes(length: number): Uint8Array {
    const buffer = new Uint8Array(length);
    if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
      crypto.getRandomValues(buffer);
      return buffer;
    }
    throw new Error('SECURE_RANDOM_UNAVAILABLE');
  }

  private hasSubtleCrypto(): boolean {
    return typeof crypto !== 'undefined' && typeof crypto.subtle !== 'undefined';
  }

  private async derivePbkdf2Hex(password: string, saltHex: string): Promise<string> {
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      this.encoder.encode(password),
      'PBKDF2',
      false,
      ['deriveBits'],
    );
    const saltBytes = hexToBytes(saltHex);
    const derivedBits = await crypto.subtle.deriveBits(
      {
        name: 'PBKDF2',
        salt: saltBytes.buffer as ArrayBuffer,
        iterations: PBKDF2_ITERATIONS,
        hash: 'SHA-256',
      },
      keyMaterial,
      256,
    );
    return bytesToHex(new Uint8Array(derivedBits));
  }

  private deriveFallbackDigest(password: string, saltHex: string): string {
    let digest = sha256Pure(this.encoder.encode(`${saltHex}:${password}`));
    for (let i = 0; i < 1000; i += 1) {
      digest = sha256Pure(this.encoder.encode(`${digest}:${saltHex}:${i}`));
    }
    return digest;
  }

  public async hashPassword(password: string): Promise<PasswordHashResult> {
    const saltHex = bytesToHex(this.getRandomBytes(16));

    if (this.hasSubtleCrypto()) {
      const derived = await this.derivePbkdf2Hex(password, saltHex);
      return {
        hash: `pbkdf2$${derived}`,
        salt: saltHex,
      };
    }

    const fallback = this.deriveFallbackDigest(password, saltHex);
    return {
      hash: `sha256r$${fallback}`,
      salt: saltHex,
    };
  }

  public async verifyPassword(
    password: string,
    storedHash: string,
    salt: string,
  ): Promise<boolean> {
    if (!storedHash || !salt) {
      return false;
    }

    if (storedHash.startsWith('pbkdf2$') && this.hasSubtleCrypto()) {
      const expected = storedHash.slice('pbkdf2$'.length);
      const actual = await this.derivePbkdf2Hex(password, salt);
      return timingSafeEqual(actual, expected);
    }

    if (storedHash.startsWith('sha256r$')) {
      const expected = storedHash.slice('sha256r$'.length);
      const actual = this.deriveFallbackDigest(password, salt);
      return timingSafeEqual(actual, expected);
    }

    return false;
  }

  public async hashToken(rawToken: string): Promise<string> {
    const data = this.encoder.encode(rawToken);
    if (this.hasSubtleCrypto()) {
      const hashBuffer = await crypto.subtle.digest('SHA-256', data);
      return bytesToHex(new Uint8Array(hashBuffer));
    }
    return sha256Pure(data);
  }

  public generateSecureRandomToken(length = 32): string {
    const bytes = this.getRandomBytes(length);
    return bytesToHex(bytes);
  }
}
