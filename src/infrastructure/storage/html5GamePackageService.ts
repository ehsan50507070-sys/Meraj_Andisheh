import type { DataStoreKey, IDataStore } from '../../core/abstractions/IDataStore';
import type {
  IGamePackageStorage,
  SampleEducationalGameZipAsset,
  SaveGamePackageInput,
  ValidateGameZipInput,
} from '../../core/abstractions/gameRepository';
import {
  ALLOWED_GAME_PACKAGE_EXTENSIONS,
  FORBIDDEN_GAME_PACKAGE_EXTENSIONS,
  type GamePackageEntry,
  type GamePackageValidationResult,
  type StoredGamePackage,
} from '../../core/domain/games';
import { STORE_NAMES } from '../data/migrations';

export interface GamePackageDataStorePort extends IDataStore {
  getByKey<T>(storeName: string, key: DataStoreKey): Promise<T | null>;
}

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_FILE_HEADER_SIGNATURE = 0x02014b50;
const LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50;

const TEXT_EXTENSIONS: ReadonlySet<string> = new Set([
  'html',
  'htm',
  'css',
  'js',
  'json',
  'svg',
]);

const MIME_TYPES_BY_EXTENSION: Record<string, string> = {
  html: 'text/html; charset=utf-8',
  htm: 'text/html; charset=utf-8',
  css: 'text/css; charset=utf-8',
  js: 'application/javascript; charset=utf-8',
  json: 'application/json; charset=utf-8',
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  mp3: 'audio/mpeg',
  ogg: 'audio/ogg',
  wav: 'audio/wav',
  woff: 'font/woff',
  woff2: 'font/woff2',
  ttf: 'font/ttf',
};

const utf8Decoder = new TextDecoder('utf-8', { fatal: false });
const utf8Encoder = new TextEncoder();

function readUint16LE(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function readUint32LE(bytes: Uint8Array, offset: number): number {
  return (
    (bytes[offset] |
      (bytes[offset + 1] << 8) |
      (bytes[offset + 2] << 16) |
      (bytes[offset + 3] << 24)) >>>
    0
  );
}

function writeUint16LE(view: DataView, offset: number, val: number): void {
  view.setUint16(offset, val & 0xffff, true);
}

function writeUint32LE(view: DataView, offset: number, val: number): void {
  view.setUint32(offset, val >>> 0, true);
}

const CRC32_TABLE: Uint32Array = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

export function computeCrc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    crc = CRC32_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export function createStoredZipBytes(
  files: ReadonlyArray<{ path: string; bytes: Uint8Array }>,
): Uint8Array {
  interface CdEntry {
    pathBytes: Uint8Array;
    bytes: Uint8Array;
    crc: number;
    localHeaderOffset: number;
  }

  const cdEntries: CdEntry[] = [];
  const chunks: Uint8Array[] = [];
  let currentOffset = 0;

  for (const file of files) {
    const cleanPath = file.path.replace(/^\/+/, '');
    const pathBytes = utf8Encoder.encode(cleanPath);
    const crc = computeCrc32(file.bytes);
    const localHeader = new Uint8Array(30 + pathBytes.length);
    const view = new DataView(localHeader.buffer);

    writeUint32LE(view, 0, LOCAL_FILE_HEADER_SIGNATURE);
    writeUint16LE(view, 4, 20); // version needed
    writeUint16LE(view, 6, 0x0800); // UTF-8 flag
    writeUint16LE(view, 8, 0); // Stored method
    writeUint16LE(view, 10, 0);
    writeUint16LE(view, 12, 0);
    writeUint32LE(view, 14, crc);
    writeUint32LE(view, 18, file.bytes.length);
    writeUint32LE(view, 22, file.bytes.length);
    writeUint16LE(view, 26, pathBytes.length);
    writeUint16LE(view, 28, 0);
    localHeader.set(pathBytes, 30);

    cdEntries.push({
      pathBytes,
      bytes: file.bytes,
      crc,
      localHeaderOffset: currentOffset,
    });

    chunks.push(localHeader, file.bytes);
    currentOffset += localHeader.length + file.bytes.length;
  }

  const cdStartOffset = currentOffset;
  let cdSize = 0;

  for (const entry of cdEntries) {
    const cdHeader = new Uint8Array(46 + entry.pathBytes.length);
    const view = new DataView(cdHeader.buffer);

    writeUint32LE(view, 0, CENTRAL_FILE_HEADER_SIGNATURE);
    writeUint16LE(view, 4, 20);
    writeUint16LE(view, 6, 20);
    writeUint16LE(view, 8, 0x0800); // UTF-8 flag
    writeUint16LE(view, 10, 0); // Stored method
    writeUint16LE(view, 12, 0);
    writeUint16LE(view, 14, 0);
    writeUint32LE(view, 16, entry.crc);
    writeUint32LE(view, 20, entry.bytes.length);
    writeUint32LE(view, 24, entry.bytes.length);
    writeUint16LE(view, 28, entry.pathBytes.length);
    writeUint16LE(view, 30, 0);
    writeUint16LE(view, 32, 0);
    writeUint16LE(view, 34, 0);
    writeUint16LE(view, 36, 0);
    writeUint32LE(view, 38, 0);
    writeUint32LE(view, 42, entry.localHeaderOffset);
    cdHeader.set(entry.pathBytes, 46);

    chunks.push(cdHeader);
    cdSize += cdHeader.length;
  }

  const eocd = new Uint8Array(22);
  const eocdView = new DataView(eocd.buffer);
  writeUint32LE(eocdView, 0, EOCD_SIGNATURE);
  writeUint16LE(eocdView, 4, 0);
  writeUint16LE(eocdView, 6, 0);
  writeUint16LE(eocdView, 8, cdEntries.length);
  writeUint16LE(eocdView, 10, cdEntries.length);
  writeUint32LE(eocdView, 12, cdSize);
  writeUint32LE(eocdView, 16, cdStartOffset);
  writeUint16LE(eocdView, 20, 0);
  chunks.push(eocd);

  const totalLen = chunks.reduce((acc, c) => acc + c.length, 0);
  const output = new Uint8Array(totalLen);
  let pos = 0;
  for (const chunk of chunks) {
    output.set(chunk, pos);
    pos += chunk.length;
  }
  return output;
}

function uint8ArrayToBase64(bytes: Uint8Array): string {
  const chunkSize = 0x8000;
  const parts: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const slice = bytes.subarray(offset, offset + chunkSize);
    let chunkStr = '';
    for (let i = 0; i < slice.length; i += 1) {
      chunkStr += String.fromCharCode(slice[i]);
    }
    parts.push(chunkStr);
  }
  return btoa(parts.join(''));
}

async function inflateDeflateRawAsync(compressed: Uint8Array): Promise<Uint8Array | null> {
  if (typeof DecompressionStream === 'undefined') {
    return null;
  }
  try {
    const ds = new DecompressionStream('deflate-raw');
    const copy = new Uint8Array(compressed.byteLength);
    copy.set(compressed);
    const stream = new Blob([copy.buffer]).stream().pipeThrough(ds);
    const arrayBuffer = await new Response(stream).arrayBuffer();
    return new Uint8Array(arrayBuffer);
  } catch {
    return null;
  }
}

function findEocdOffset(bytes: Uint8Array): number {
  if (bytes.length < 22) {
    return -1;
  }
  const minOffset = Math.max(0, bytes.length - 65557);
  for (let i = bytes.length - 22; i >= minOffset; i -= 1) {
    if (readUint32LE(bytes, i) === EOCD_SIGNATURE) {
      const commentLen = readUint16LE(bytes, i + 20);
      if (i + 22 + commentLen === bytes.length) {
        return i;
      }
    }
  }
  return -1;
}

function isUnsafeRawEntryPath(rawPath: string): boolean {
  if (!rawPath || rawPath.includes('\0') || rawPath.includes('\\')) {
    return true;
  }
  if (rawPath.startsWith('/') || /^[a-zA-Z]:/.test(rawPath)) {
    return true;
  }
  const parts = rawPath.split('/');
  return parts.some((segment) => segment === '..');
}

function normalizeRelativeSegments(rawPath: string): string {
  return rawPath
    .split('/')
    .filter((seg) => seg.length > 0 && seg !== '.')
    .join('/');
}

function getFileExtension(path: string): string {
  const baseName = path.split('/').pop() ?? '';
  const dotIdx = baseName.lastIndexOf('.');
  if (dotIdx <= 0 || dotIdx === baseName.length - 1) {
    return '';
  }
  return baseName.slice(dotIdx + 1).toLowerCase();
}

function buildEntryDataUri(entry: GamePackageEntry): string {
  if (entry.isText && typeof entry.textContent === 'string') {
    if (entry.mimeType.startsWith('image/svg+xml')) {
      return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(entry.textContent)}`;
    }
    return `data:${entry.mimeType};base64,${uint8ArrayToBase64(utf8Encoder.encode(entry.textContent))}`;
  }
  return `data:${entry.mimeType};base64,${entry.base64Data ?? ''}`;
}

function resolvePackageAssetPath(
  rawRef: string,
  baseDir: string,
  entryMap: ReadonlyMap<string, GamePackageEntry>,
): GamePackageEntry | null {
  const cleaned = (rawRef ?? '').trim().split('#')[0].split('?')[0].trim();
  if (
    !cleaned ||
    /^(https?:|data:|blob:|mailto:|tel:|javascript:|#)/i.test(cleaned)
  ) {
    return null;
  }

  const normalizedRef = cleaned.replace(/^\/+/, '');
  const baseParts = baseDir ? baseDir.split('/').filter(Boolean) : [];
  const refParts = normalizedRef.split('/').filter((p) => p.length > 0 && p !== '.');
  const resolvedParts = cleaned.startsWith('/') ? [] : [...baseParts];

  for (const part of refParts) {
    if (part === '..') {
      if (resolvedParts.length > 0) {
        resolvedParts.pop();
      }
    } else {
      resolvedParts.push(part);
    }
  }

  const candidatePath = resolvedParts.join('/');
  return (
    entryMap.get(candidatePath) ??
    entryMap.get(candidatePath.toLowerCase()) ??
    null
  );
}

function rewriteCssAssetUrls(
  cssText: string,
  cssBaseDir: string,
  entryMap: ReadonlyMap<string, GamePackageEntry>,
): string {
  return cssText.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, (full, quote, ref) => {
    const resolved = resolvePackageAssetPath(ref, cssBaseDir, entryMap);
    if (!resolved) {
      return full;
    }
    return `url(${quote}${buildEntryDataUri(resolved)}${quote})`;
  });
}

function parseTagAttribute(attrs: string, attrName: string): string | null {
  const regex = new RegExp(
    `(?:^|\\s)${attrName}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`,
    'i',
  );
  const match = attrs.match(regex);
  if (!match) {
    return null;
  }
  return (match[1] ?? match[2] ?? match[3] ?? '').trim();
}

export function buildSandboxedSrcdocFromPackage(
  pkg: StoredGamePackage,
): string | null {
  if (!pkg || pkg.entries.length === 0) {
    return null;
  }

  const entryMap = new Map<string, GamePackageEntry>();
  for (const entry of pkg.entries) {
    entryMap.set(entry.path, entry);
    entryMap.set(entry.path.toLowerCase(), entry);
  }

  const indexEntry = entryMap.get('index.html');
  if (!indexEntry || typeof indexEntry.textContent !== 'string') {
    return null;
  }

  let html = indexEntry.textContent;

  // Remove potentially dangerous <base> or <meta http-equiv="refresh"> tags inside untrusted packages
  html = html
    .replace(/<base\b[^>]*>/gi, '')
    .replace(/<meta\b[^>]*http-equiv\s*=\s*["']?refresh["']?[^>]*>/gi, '');

  // Inline local <link rel="stylesheet" href="...">
  html = html.replace(/<link\b([^>]*)>/gi, (fullTag, attrs: string) => {
    const rel = parseTagAttribute(attrs, 'rel');
    const href = parseTagAttribute(attrs, 'href');
    if (!rel || !rel.toLowerCase().split(/\s+/).includes('stylesheet') || !href) {
      return fullTag;
    }
    const target = resolvePackageAssetPath(href, '', entryMap);
    if (!target || typeof target.textContent !== 'string') {
      return fullTag;
    }
    const cssDir = target.path.includes('/')
      ? target.path.slice(0, target.path.lastIndexOf('/'))
      : '';
    const rewrittenCss = rewriteCssAssetUrls(target.textContent, cssDir, entryMap);
    return `<style>\n${rewrittenCss}\n</style>`;
  });

  // Inline local CSS url(...) inside <style>...</style>
  html = html.replace(
    /<style\b([^>]*)>([\s\S]*?)<\/style>/gi,
    (_full, attrs: string, cssBody: string) => {
      const rewritten = rewriteCssAssetUrls(cssBody, '', entryMap);
      return `<style${attrs}>${rewritten}</style>`;
    },
  );

  // Inline local <script src="..."></script>
  html = html.replace(
    /<script\b([^>]*)>([\s\S]*?)<\/script>/gi,
    (fullTag, attrs: string) => {
      const src = parseTagAttribute(attrs, 'src');
      if (!src) {
        return fullTag;
      }
      const target = resolvePackageAssetPath(src, '', entryMap);
      if (!target || typeof target.textContent !== 'string') {
        return fullTag;
      }
      const safeJs = target.textContent.replace(/<\/script/gi, '<\\/script');
      return `<script>\n${safeJs}\n</script>`;
    },
  );

  // Rewrite src="..." and poster="..." for media/assets inside package
  html = html.replace(
    /\b(src|poster)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi,
    (fullAttr, attrName: string, dqVal?: string, sqVal?: string) => {
      const rawRef = dqVal ?? sqVal ?? '';
      const target = resolvePackageAssetPath(rawRef, '', entryMap);
      if (!target) {
        return fullAttr;
      }
      return `${attrName}="${buildEntryDataUri(target)}"`;
    },
  );

  return html;
}

export class Html5GamePackageService implements IGamePackageStorage {
  private readonly dataStore: GamePackageDataStorePort;

  constructor(dataStore: GamePackageDataStorePort) {
    this.dataStore = dataStore;
  }

  public async validateAndExtractZipAsync(
    input: ValidateGameZipInput,
  ): Promise<GamePackageValidationResult> {
    const bytes = input.bytes;
    if (!bytes || bytes.byteLength === 0) {
      return {
        ok: false,
        errorCode: 'ZIP_REQUIRED',
        messageKey: 'admin.portals.games.error.zipRequired',
        entries: [],
        totalSizeBytes: 0,
      };
    }

    if (bytes.byteLength > input.maxTotalBytes) {
      return {
        ok: false,
        errorCode: 'ZIP_TOO_LARGE',
        messageKey: 'admin.portals.games.error.zipTooLarge',
        entries: [],
        totalSizeBytes: 0,
      };
    }

    const eocdOffset = findEocdOffset(bytes);
    if (eocdOffset === -1) {
      return {
        ok: false,
        errorCode: 'ZIP_INVALID_FORMAT',
        messageKey: 'admin.portals.games.error.zipInvalidFormat',
        entries: [],
        totalSizeBytes: 0,
      };
    }

    const totalEntries = readUint16LE(bytes, eocdOffset + 10);
    const cdSize = readUint32LE(bytes, eocdOffset + 12);
    const cdOffset = readUint32LE(bytes, eocdOffset + 16);

    if (cdOffset + cdSize > eocdOffset) {
      return {
        ok: false,
        errorCode: 'ZIP_INVALID_FORMAT',
        messageKey: 'admin.portals.games.error.zipInvalidFormat',
        entries: [],
        totalSizeBytes: 0,
      };
    }

    interface ExtractedRawEntry {
      normalizedPath: string;
      rawBytes: Uint8Array;
    }

    const rawEntries: ExtractedRawEntry[] = [];
    let runningUncompressedBytes = 0;
    let ptr = cdOffset;

    for (let idx = 0; idx < totalEntries; idx += 1) {
      if (ptr + 46 > eocdOffset || readUint32LE(bytes, ptr) !== CENTRAL_FILE_HEADER_SIGNATURE) {
        return {
          ok: false,
          errorCode: 'ZIP_INVALID_FORMAT',
          messageKey: 'admin.portals.games.error.zipInvalidFormat',
          entries: [],
          totalSizeBytes: 0,
        };
      }

      const compressionMethod = readUint16LE(bytes, ptr + 10);
      const compressedSize = readUint32LE(bytes, ptr + 20);
      const uncompressedSize = readUint32LE(bytes, ptr + 24);
      const fileNameLen = readUint16LE(bytes, ptr + 28);
      const extraLen = readUint16LE(bytes, ptr + 30);
      const commentLen = readUint16LE(bytes, ptr + 32);
      const externalAttr = readUint32LE(bytes, ptr + 38);
      const localHeaderOffset = readUint32LE(bytes, ptr + 42);

      if (ptr + 46 + fileNameLen > eocdOffset) {
        return {
          ok: false,
          errorCode: 'ZIP_INVALID_FORMAT',
          messageKey: 'admin.portals.games.error.zipInvalidFormat',
          entries: [],
          totalSizeBytes: 0,
        };
      }

      const rawName = utf8Decoder.decode(
        bytes.subarray(ptr + 46, ptr + 46 + fileNameLen),
      );
      ptr += 46 + fileNameLen + extraLen + commentLen;

      if (isUnsafeRawEntryPath(rawName)) {
        return {
          ok: false,
          errorCode: 'ZIP_PATH_TRAVERSAL',
          messageKey: 'admin.portals.games.error.zipPathTraversal',
          invalidFileName: rawName,
          entries: [],
          totalSizeBytes: 0,
        };
      }

      const isDirectory =
        rawName.endsWith('/') || ((externalAttr & 0x10) !== 0 && uncompressedSize === 0);
      if (isDirectory || rawName.startsWith('__MACOSX/')) {
        continue;
      }

      const normalizedPath = normalizeRelativeSegments(rawName);
      if (!normalizedPath) {
        continue;
      }

      if (uncompressedSize > input.maxTotalBytes) {
        return {
          ok: false,
          errorCode: 'ZIP_TOO_LARGE',
          messageKey: 'admin.portals.games.error.zipTooLarge',
          invalidFileName: normalizedPath,
          entries: [],
          totalSizeBytes: 0,
        };
      }

      if (
        localHeaderOffset + 30 > cdOffset ||
        readUint32LE(bytes, localHeaderOffset) !== LOCAL_FILE_HEADER_SIGNATURE
      ) {
        return {
          ok: false,
          errorCode: 'ZIP_INVALID_FORMAT',
          messageKey: 'admin.portals.games.error.zipInvalidFormat',
          entries: [],
          totalSizeBytes: 0,
        };
      }

      const lhNameLen = readUint16LE(bytes, localHeaderOffset + 26);
      const lhExtraLen = readUint16LE(bytes, localHeaderOffset + 28);
      const dataStart = localHeaderOffset + 30 + lhNameLen + lhExtraLen;
      const dataEnd = dataStart + compressedSize;

      if (dataEnd > cdOffset || dataEnd > bytes.length) {
        return {
          ok: false,
          errorCode: 'ZIP_INVALID_FORMAT',
          messageKey: 'admin.portals.games.error.zipInvalidFormat',
          entries: [],
          totalSizeBytes: 0,
        };
      }

      const payload = bytes.subarray(dataStart, dataEnd);
      let fileBytes: Uint8Array;

      if (compressionMethod === 0) {
        fileBytes = new Uint8Array(payload);
      } else if (compressionMethod === 8) {
        const inflated = await inflateDeflateRawAsync(payload);
        if (!inflated) {
          return {
            ok: false,
            errorCode: 'ZIP_INVALID_FORMAT',
            messageKey: 'admin.portals.games.error.zipInvalidFormat',
            entries: [],
            totalSizeBytes: 0,
          };
        }
        fileBytes = inflated;
      } else {
        return {
          ok: false,
          errorCode: 'ZIP_INVALID_FORMAT',
          messageKey: 'admin.portals.games.error.zipInvalidFormat',
          entries: [],
          totalSizeBytes: 0,
        };
      }

      runningUncompressedBytes += fileBytes.byteLength;
      if (runningUncompressedBytes > input.maxTotalBytes) {
        return {
          ok: false,
          errorCode: 'ZIP_TOO_LARGE',
          messageKey: 'admin.portals.games.error.zipTooLarge',
          invalidFileName: normalizedPath,
          entries: [],
          totalSizeBytes: 0,
        };
      }

      rawEntries.push({
        normalizedPath,
        rawBytes: fileBytes,
      });
    }

    if (rawEntries.length === 0) {
      return {
        ok: false,
        errorCode: 'ZIP_MISSING_INDEX_HTML',
        messageKey: 'admin.portals.games.error.zipMissingIndexHtml',
        entries: [],
        totalSizeBytes: 0,
      };
    }

    // Unwrap a single wrapper directory only if root does not have index.html and every entry sits inside the same top directory
    let workingEntries = rawEntries;
    const hasRootIndex = workingEntries.some(
      (entry) => entry.normalizedPath.toLowerCase() === 'index.html',
    );
    if (!hasRootIndex) {
      const topDirs = new Set(
        workingEntries
          .filter((e) => e.normalizedPath.includes('/'))
          .map((e) => e.normalizedPath.split('/')[0]),
      );
      const allInsideSingleDir =
        topDirs.size === 1 && workingEntries.every((e) => e.normalizedPath.includes('/'));
      if (allInsideSingleDir) {
        const prefix = `${Array.from(topDirs)[0]}/`;
        const unwrapped = workingEntries.map((entry) => ({
          normalizedPath: entry.normalizedPath.slice(prefix.length),
          rawBytes: entry.rawBytes,
        }));
        if (unwrapped.some((entry) => entry.normalizedPath.toLowerCase() === 'index.html')) {
          workingEntries = unwrapped;
        }
      }
    }

    // Validate all extensions strictly against allowlist & explicit forbidden list
    const validatedEntries: GamePackageEntry[] = [];
    for (const entry of workingEntries) {
      const ext = getFileExtension(entry.normalizedPath);
      if (
        !ext ||
        FORBIDDEN_GAME_PACKAGE_EXTENSIONS.has(ext) ||
        !ALLOWED_GAME_PACKAGE_EXTENSIONS.has(ext)
      ) {
        return {
          ok: false,
          errorCode: 'ZIP_FORBIDDEN_FILE_TYPE',
          messageKey: 'admin.portals.games.error.zipForbiddenFileType',
          invalidFileName: entry.normalizedPath,
          entries: [],
          totalSizeBytes: 0,
        };
      }

      const finalPath =
        entry.normalizedPath.toLowerCase() === 'index.html'
          ? 'index.html'
          : entry.normalizedPath;
      const mimeType = MIME_TYPES_BY_EXTENSION[ext] ?? 'application/octet-stream';
      const isText = TEXT_EXTENSIONS.has(ext);

      validatedEntries.push({
        path: finalPath,
        mimeType,
        sizeBytes: entry.rawBytes.byteLength,
        isText,
        textContent: isText ? utf8Decoder.decode(entry.rawBytes) : undefined,
        base64Data: isText ? undefined : uint8ArrayToBase64(entry.rawBytes),
      });
    }

    const hasIndexHtml = validatedEntries.some((entry) => entry.path === 'index.html');
    if (!hasIndexHtml) {
      return {
        ok: false,
        errorCode: 'ZIP_MISSING_INDEX_HTML',
        messageKey: 'admin.portals.games.error.zipMissingIndexHtml',
        entries: [],
        totalSizeBytes: 0,
      };
    }

    return {
      ok: true,
      entries: validatedEntries,
      totalSizeBytes: runningUncompressedBytes,
    };
  }

  public async savePackageAsync(
    input: SaveGamePackageInput,
  ): Promise<StoredGamePackage> {
    const pkg: StoredGamePackage = {
      packageFolder: input.packageFolder,
      originalZipName: input.originalZipName,
      totalSizeBytes: input.totalSizeBytes,
      filesCount: input.entries.length,
      entries: input.entries,
      createdAt: input.createdAt,
    };
    await this.dataStore.putRecord<StoredGamePackage>(STORE_NAMES.GAME_PACKAGES, pkg);
    return pkg;
  }

  public async getPackageAsync(
    packageFolder: string,
  ): Promise<StoredGamePackage | null> {
    return this.dataStore.getByKey<StoredGamePackage>(
      STORE_NAMES.GAME_PACKAGES,
      packageFolder,
    );
  }

  public async getAllPackagesAsync(): Promise<StoredGamePackage[]> {
    return this.dataStore.getAll<StoredGamePackage>(STORE_NAMES.GAME_PACKAGES);
  }

  public async deletePackageAsync(packageFolder: string): Promise<void> {
    await this.dataStore.deleteByKey(STORE_NAMES.GAME_PACKAGES, packageFolder);
  }

  public async buildSandboxedGameSrcdocAsync(
    packageFolder: string,
  ): Promise<string | null> {
    const pkg = await this.getPackageAsync(packageFolder);
    if (!pkg) {
      return null;
    }
    return buildSandboxedSrcdocFromPackage(pkg);
  }

  public async createSampleEducationalGameZipBytesAsync(): Promise<SampleEducationalGameZipAsset> {
    const indexHtml = `<!doctype html>
<html lang="fa" dir="rtl">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>معمای دانش و اندیشه</title>
  <link rel="stylesheet" href="style.css" />
</head>
<body>
  <main class="arena">
    <header class="hud">
      <div class="hud-title">مسابقه‌ی تعاملی دانش و اندیشه</div>
      <div class="hud-metrics">
        <span id="hud-progress" class="hud-pill">پرسش ۱ از ۵</span>
        <span id="hud-score" class="hud-pill">امتیاز: ۰ / ۱۰۰</span>
        <button id="sound-toggle" type="button" class="btn-ghost" aria-label="تغییر وضعیت صدا">صدا: روشن</button>
      </div>
    </header>

    <section id="screen-title" class="panel">
      <h1>آماده‌ی چالش علمی و فرهنگی هستید؟</h1>
      <p>در این مسابقه‌ی کوتاه، به ۵ پرسش جذاب درباره‌ی نجوم، تاریخ علم و اخلاق پاسخ دهید. هر پاسخ درست ۲۰ امتیاز دارد.</p>
      <button id="start-btn" type="button" class="btn-primary">شروع بازی</button>
    </section>

    <section id="screen-play" class="panel hidden">
      <div id="category-label" class="category-tag"></div>
      <h2 id="question-text" class="question-text"></h2>
      <div id="options-list" class="options-grid"></div>
      <div id="feedback-box" class="feedback hidden"></div>
      <div class="controls-row">
        <button id="next-btn" type="button" class="btn-primary hidden">پرسش بعدی</button>
      </div>
    </section>

    <section id="screen-over" class="panel hidden">
      <h2 id="over-title">پایان چالش علمی</h2>
      <p id="over-summary" class="over-summary"></p>
      <div class="controls-row">
        <button id="restart-btn" type="button" class="btn-primary">بازی دوباره</button>
      </div>
    </section>
  </main>
  <script src="game.js"></script>
</body>
</html>`;

    const styleCss = `* { box-sizing: border-box; }
html, body {
  margin: 0;
  padding: 0;
  min-height: 100%;
  font-family: Vazirmatn, Tahoma, sans-serif;
  background: #0F172A;
  color: #F8FAFC;
  direction: rtl;
}
body {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
}
.arena {
  width: 100%;
  max-width: 680px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.hud {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  background: #1E293B;
  border: 1px solid #334155;
  border-radius: 12px;
  padding: 12px 16px;
}
.hud-title {
  font-weight: 700;
  font-size: 15px;
  color: #F59E0B;
}
.hud-metrics {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
.hud-pill {
  background: #0F172A;
  border: 1px solid #334155;
  border-radius: 8px;
  padding: 6px 10px;
  font-size: 13px;
  font-weight: 600;
}
.panel {
  background: #1E293B;
  border: 1px solid #334155;
  border-radius: 16px;
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.hidden { display: none !important; }
h1, h2 {
  margin: 0;
  line-height: 1.5;
}
p {
  margin: 0;
  color: #CBD5E1;
  line-height: 1.8;
  font-size: 15px;
}
.category-tag {
  font-size: 12px;
  font-weight: 700;
  color: #38BDF8;
}
.question-text {
  font-size: 18px;
  color: #F8FAFC;
}
.options-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 10px;
}
.option-btn {
  min-height: 48px;
  text-align: right;
  padding: 12px 16px;
  border-radius: 10px;
  border: 1px solid #475569;
  background: #0F172A;
  color: #F8FAFC;
  font-family: inherit;
  font-size: 15px;
  cursor: pointer;
  transition: transform 0.12s ease, border-color 0.15s ease, background-color 0.15s ease;
}
.option-btn:hover:not(:disabled) {
  border-color: #F59E0B;
  background: #172554;
}
.option-btn.correct {
  border-color: #10B981;
  background: #064E3B;
}
.option-btn.wrong {
  border-color: #EF4444;
  background: #7F1D1D;
}
.feedback {
  padding: 12px 14px;
  border-radius: 10px;
  font-size: 14px;
  line-height: 1.7;
  background: #0F172A;
  border: 1px solid #334155;
}
.controls-row {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}
.btn-primary {
  min-height: 44px;
  padding: 10px 22px;
  border-radius: 10px;
  border: none;
  background: #F59E0B;
  color: #0F172A;
  font-family: inherit;
  font-size: 15px;
  font-weight: 700;
  cursor: pointer;
}
.btn-primary:hover {
  background: #FBBF24;
}
.btn-ghost {
  min-height: 36px;
  padding: 6px 12px;
  border-radius: 8px;
  border: 1px solid #475569;
  background: transparent;
  color: #E2E8F0;
  font-family: inherit;
  font-size: 12px;
  cursor: pointer;
}
.over-summary {
  font-size: 16px;
  font-weight: 600;
  color: #F8FAFC;
}`;

    const gameJs = `(function () {
  var QUESTIONS = [
    {
      category: 'نجوم و رصدخانه',
      prompt: 'رصدخانه‌ی تاریخی مراغه به سرپرستی کدام دانشمند ایرانی بنا شد؟',
      options: ['خواجه نصیرالدین طوسی', 'ابوریحان بیرونی', 'عمر خیام'],
      correctIndex: 0,
      note: 'خواجه نصیرالدین طوسی در سده‌ی هفتم هجری رصدخانه‌ی مراغه را پایه‌گذاری کرد.'
    },
    {
      category: 'جغرافیا و علوم',
      prompt: 'کدام دانشمند ایرانی با روش مثلثاتی شعاع زمین را در قلعه‌ی نندنه هند با دقت شگفت‌انگیزی محاسبه کرد؟',
      options: ['زکریای رازی', 'ابوریحان بیرونی', 'جابر بن حیان'],
      correctIndex: 1,
      note: 'ابوریحان بیرونی با اندازه‌گیری زاویه‌ی افق از بالای کوه، محیط و شعاع زمین را محاسبه نمود.'
    },
    {
      category: 'اخلاق و حکمت',
      prompt: 'در فرهنگ اسلامی و ایرانی، نخستین شرط رشد علمی و اجتماعی چیست؟',
      options: ['انباشت بدون پرسش', 'کنجکاوی خردمندانه و امانت‌داری', 'رقابت ناسالم'],
      correctIndex: 1,
      note: 'پرسشگری مسئولانه همراه با صداقت علمی زمینه‌ساز پیشرفت پایدار است.'
    },
    {
      category: 'فیزیک و نورشناسی',
      prompt: 'کتاب «المناظر» درباره‌ی شکست و بازتاب نور اثر کدام دانشمند برجسته است؟',
      options: ['ابن هیثم', 'فارابی', 'خوارزمی'],
      correctIndex: 0,
      note: 'ابن هیثم با آزمایش‌های دقیق اتاقک تاریک، علم نورشناسی نوین را بنیان گذاشت.'
    },
    {
      category: 'ریاضیات',
      prompt: 'واژه‌ی جهانی «الگوریتم» از نام کدام ریاضی‌دان نامدار برگرفته شده است؟',
      options: ['ابن سینا', 'محمد بن موسی خوارزمی', 'غیاث‌الدین جمشید کاشانی'],
      correctIndex: 1,
      note: 'کتاب جبر و مقابله‌ی خوارزمی نقطه‌ی عطف تاریخ ریاضیات و علوم رایانه است.'
    }
  ];

  var persianDigits = ['۰','۱','۲','۳','۴','۵','۶','۷','۸','۹'];
  function toFaDigits(val) {
    return String(val).replace(/[0-9]/g, function (d) { return persianDigits[Number(d)]; });
  }

  var state = {
    mode: 'TITLE_MENU',
    currentIndex: 0,
    score: 0,
    answered: false,
    soundEnabled: true
  };

  var screenTitle = document.getElementById('screen-title');
  var screenPlay = document.getElementById('screen-play');
  var screenOver = document.getElementById('screen-over');
  var hudProgress = document.getElementById('hud-progress');
  var hudScore = document.getElementById('hud-score');
  var categoryLabel = document.getElementById('category-label');
  var questionText = document.getElementById('question-text');
  var optionsList = document.getElementById('options-list');
  var feedbackBox = document.getElementById('feedback-box');
  var nextBtn = document.getElementById('next-btn');
  var overSummary = document.getElementById('over-summary');
  var soundToggleBtn = document.getElementById('sound-toggle');

  function playTone(freq, duration) {
    if (!state.soundEnabled) return;
    try {
      var Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      var ctx = new Ctx();
      var osc = ctx.createOscillator();
      var gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.value = 0.06;
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + duration);
    } catch (_) {}
  }

  function updateHud() {
    var step = Math.min(state.currentIndex + 1, QUESTIONS.length);
    hudProgress.textContent = 'پرسش ' + toFaDigits(step) + ' از ' + toFaDigits(QUESTIONS.length);
    hudScore.textContent = 'امتیاز: ' + toFaDigits(state.score) + ' / ۱۰۰';
  }

  function renderQuestion() {
    var q = QUESTIONS[state.currentIndex];
    state.answered = false;
    updateHud();
    categoryLabel.textContent = q.category;
    questionText.textContent = q.prompt;
    feedbackBox.classList.add('hidden');
    nextBtn.classList.add('hidden');
    optionsList.innerHTML = '';

    q.options.forEach(function (opt, idx) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'option-btn';
      btn.textContent = opt;
      btn.addEventListener('click', function () { handleSelect(idx); });
      optionsList.appendChild(btn);
    });
  }

  function handleSelect(selectedIdx) {
    if (state.answered) return;
    state.answered = true;
    var q = QUESTIONS[state.currentIndex];
    var buttons = optionsList.querySelectorAll('button');
    buttons.forEach(function (b, idx) {
      b.disabled = true;
      if (idx === q.correctIndex) b.classList.add('correct');
      else if (idx === selectedIdx) b.classList.add('wrong');
    });

    if (selectedIdx === q.correctIndex) {
      state.score += 20;
      playTone(660, 0.14);
      feedbackBox.textContent = 'آفرین! ' + q.note;
    } else {
      playTone(240, 0.18);
      feedbackBox.textContent = 'پاسخ دقیق‌تر: ' + q.note;
    }
    updateHud();
    feedbackBox.classList.remove('hidden');
    nextBtn.textContent = state.currentIndex + 1 >= QUESTIONS.length ? 'پایان و ثبت امتیاز' : 'پرسش بعدی';
    nextBtn.classList.remove('hidden');
  }

  function finishGame() {
    state.mode = 'GAME_OVER';
    screenPlay.classList.add('hidden');
    screenOver.classList.remove('hidden');
    overSummary.textContent = 'امتیاز نهایی شما: ' + toFaDigits(state.score) + ' از ۱۰۰';
    playTone(880, 0.2);
    try {
      window.parent.postMessage({
        type: 'MERAJ_GAME_SCORE',
        score: state.score,
        maxScore: 100,
        completed: true
      }, '*');
    } catch (_) {}
  }

  function startGame() {
    state.mode = 'PLAYING';
    state.currentIndex = 0;
    state.score = 0;
    screenTitle.classList.add('hidden');
    screenOver.classList.add('hidden');
    screenPlay.classList.remove('hidden');
    renderQuestion();
  }

  document.getElementById('start-btn').addEventListener('click', startGame);
  document.getElementById('restart-btn').addEventListener('click', startGame);
  nextBtn.addEventListener('click', function () {
    if (state.currentIndex + 1 < QUESTIONS.length) {
      state.currentIndex += 1;
      renderQuestion();
    } else {
      finishGame();
    }
  });
  soundToggleBtn.addEventListener('click', function () {
    state.soundEnabled = !state.soundEnabled;
    soundToggleBtn.textContent = state.soundEnabled ? 'صدا: روشن' : 'صدا: خاموش';
  });
  updateHud();
})();`;

    const bytes = createStoredZipBytes([
      { path: 'index.html', bytes: utf8Encoder.encode(indexHtml) },
      { path: 'style.css', bytes: utf8Encoder.encode(styleCss) },
      { path: 'game.js', bytes: utf8Encoder.encode(gameJs) },
    ]);

    return {
      fileName: 'meraj-knowledge-quiz.zip',
      bytes,
      defaultTitleKey: 'admin.portals.games.sample.title',
      maxScore: 100,
    };
  }
}
