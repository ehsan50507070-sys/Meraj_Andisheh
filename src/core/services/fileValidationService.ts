import type {
  FileCategory,
  FileValidationErrorCode,
  FileValidationResult,
  FileVisibility,
} from '../domain/storage';

export const DEFAULT_MAX_VIDEO_MB = 500;
export const DEFAULT_MAX_OTHER_MB = 100;
const BYTES_PER_MB = 1024 * 1024;

interface ExtensionSpec {
  category: FileCategory;
  mimeType: string;
}

const ALLOWED_EXTENSION_SPECS: Readonly<Record<string, ExtensionSpec>> = {
  mp4: { category: 'video', mimeType: 'video/mp4' },
  webm: { category: 'video', mimeType: 'video/webm' },
  mp3: { category: 'audio', mimeType: 'audio/mpeg' },
  m4a: { category: 'audio', mimeType: 'audio/mp4' },
  ogg: { category: 'audio', mimeType: 'audio/ogg' },
  png: { category: 'image', mimeType: 'image/png' },
  jpg: { category: 'image', mimeType: 'image/jpeg' },
  jpeg: { category: 'image', mimeType: 'image/jpeg' },
  webp: { category: 'image', mimeType: 'image/webp' },
  pdf: { category: 'document', mimeType: 'application/pdf' },
  doc: { category: 'document', mimeType: 'application/msword' },
  docx: {
    category: 'document',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  },
  xlsx: {
    category: 'document',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  },
  ppt: { category: 'presentation', mimeType: 'application/vnd.ms-powerpoint' },
  pptx: {
    category: 'presentation',
    mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  },
  zip: { category: 'archive', mimeType: 'application/zip' },
};

export const ALLOWED_FILE_EXTENSIONS: readonly string[] = Object.keys(ALLOWED_EXTENSION_SPECS);

export const FORBIDDEN_FILE_EXTENSIONS: readonly string[] = [
  'exe',
  'bat',
  'cmd',
  'ps1',
  'js',
  'mjs',
  'cjs',
  'vbs',
  'msi',
  'dll',
  'html',
  'htm',
  'svg',
  'xml',
  'php',
  'asp',
  'aspx',
  'sh',
  'com',
  'scr',
  'jar',
] as const;

export function extractNormalizedExtension(fileName: string): string | null {
  const cleanName = (fileName ?? '').split(/[/\\]/).pop()?.trim() ?? '';
  if (!cleanName) {
    return null;
  }
  const lastDot = cleanName.lastIndexOf('.');
  if (lastDot <= 0 || lastDot === cleanName.length - 1) {
    return null;
  }
  const ext = cleanName.slice(lastDot + 1).trim().toLowerCase();
  if (!ext || !/^[a-z0-9]+$/.test(ext)) {
    return null;
  }
  return ext;
}

export function getCategoryForExtension(ext: string): FileCategory | null {
  return ALLOWED_EXTENSION_SPECS[ext.toLowerCase()]?.category ?? null;
}

export function getMimeTypeForExtension(ext: string): string {
  return ALLOWED_EXTENSION_SPECS[ext.toLowerCase()]?.mimeType ?? 'application/octet-stream';
}

export function hasMaliciousSignature(bytes: Uint8Array): boolean {
  if (bytes.length >= 2 && bytes[0] === 0x4d && bytes[1] === 0x5a) {
    // Windows PE/MZ executable (EXE/DLL)
    return true;
  }
  if (
    bytes.length >= 4 &&
    bytes[0] === 0x7f &&
    bytes[1] === 0x45 &&
    bytes[2] === 0x4c &&
    bytes[3] === 0x46
  ) {
    // ELF binary
    return true;
  }

  // Inspect leading ASCII prefix for disguised <svg / <html / <script / <!doctype
  let offset = 0;
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    offset = 3; // Skip UTF-8 BOM
  }
  const sampleLen = Math.min(bytes.length, offset + 64);
  let textPrefix = '';
  for (let i = offset; i < sampleLen; i += 1) {
    const code = bytes[i];
    if (code === 0) {
      break;
    }
    textPrefix += String.fromCharCode(code);
  }
  const normalizedPrefix = textPrefix.trimStart().toLowerCase();
  return (
    normalizedPrefix.startsWith('<svg') ||
    normalizedPrefix.startsWith('<html') ||
    normalizedPrefix.startsWith('<script') ||
    normalizedPrefix.startsWith('<!doctype')
  );
}

function startsWithBytes(bytes: Uint8Array, expected: readonly number[], offset = 0): boolean {
  if (bytes.length < offset + expected.length) {
    return false;
  }
  for (let i = 0; i < expected.length; i += 1) {
    if (bytes[offset + i] !== expected[i]) {
      return false;
    }
  }
  return true;
}

export function matchesExtensionMagicBytes(extension: string, bytes: Uint8Array): boolean {
  const ext = extension.toLowerCase();

  switch (ext) {
    case 'pdf':
      // %PDF-
      return startsWithBytes(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d]);
    case 'png':
      return startsWithBytes(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case 'jpg':
    case 'jpeg':
      return startsWithBytes(bytes, [0xff, 0xd8, 0xff]);
    case 'webp':
      // RIFF....WEBP
      return (
        bytes.length >= 12 &&
        startsWithBytes(bytes, [0x52, 0x49, 0x46, 0x46], 0) &&
        startsWithBytes(bytes, [0x57, 0x45, 0x42, 0x50], 8)
      );
    case 'mp4':
    case 'm4a':
      // ....ftyp
      return bytes.length >= 8 && startsWithBytes(bytes, [0x66, 0x74, 0x79, 0x70], 4);
    case 'webm':
      return startsWithBytes(bytes, [0x1a, 0x45, 0xdf, 0xa3]);
    case 'mp3':
      return (
        startsWithBytes(bytes, [0x49, 0x44, 0x33]) || // ID3
        (bytes.length >= 2 && bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0) // MPEG frame sync
      );
    case 'ogg':
      // OggS
      return startsWithBytes(bytes, [0x4f, 0x67, 0x67, 0x53]);
    case 'zip':
    case 'docx':
    case 'xlsx':
    case 'pptx':
      return (
        startsWithBytes(bytes, [0x50, 0x4b, 0x03, 0x04]) ||
        startsWithBytes(bytes, [0x50, 0x4b, 0x05, 0x06]) ||
        startsWithBytes(bytes, [0x50, 0x4b, 0x07, 0x08])
      );
    case 'doc':
    case 'ppt':
      return startsWithBytes(bytes, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
    default:
      return false;
  }
}

export interface FileValidationInput {
  originalFileName: string;
  bytes: Uint8Array;
  visibility: FileVisibility;
  maxVideoMb?: number;
  maxOtherMb?: number;
  /** Optional size override for deterministic unit testing without allocating hundreds of MB of RAM */
  overrideSizeBytes?: number;
}

export function getValidationErrorMessageKey(errorCode?: FileValidationErrorCode): string {
  switch (errorCode) {
    case 'EMPTY_FILE':
      return 'storage.error.emptyFile';
    case 'MISSING_EXTENSION':
      return 'storage.error.missingExtension';
    case 'FORBIDDEN_EXTENSION':
      return 'storage.error.forbiddenExtension';
    case 'UNSUPPORTED_EXTENSION':
      return 'storage.error.unsupportedExtension';
    case 'FILE_SIGNATURE_MISMATCH':
      return 'storage.error.signatureMismatch';
    case 'FILE_TOO_LARGE':
      return 'storage.error.fileTooLarge';
    case 'PUBLIC_ONLY_IMAGES_ALLOWED':
      return 'storage.error.publicOnlyImages';
    default:
      return 'storage.error.generic';
  }
}

export function validateUploadedFile(input: FileValidationInput): FileValidationResult {
  const ext = extractNormalizedExtension(input.originalFileName);
  if (!ext) {
    return { isValid: false, errorCode: 'MISSING_EXTENSION' };
  }

  if ((FORBIDDEN_FILE_EXTENSIONS as readonly string[]).includes(ext)) {
    return {
      isValid: false,
      errorCode: 'FORBIDDEN_EXTENSION',
      normalizedExtension: ext,
    };
  }

  const spec = ALLOWED_EXTENSION_SPECS[ext];
  if (!spec) {
    return {
      isValid: false,
      errorCode: 'UNSUPPORTED_EXTENSION',
      normalizedExtension: ext,
    };
  }

  const effectiveSizeBytes =
    typeof input.overrideSizeBytes === 'number'
      ? input.overrideSizeBytes
      : input.bytes.byteLength;

  if (!Number.isFinite(effectiveSizeBytes) || effectiveSizeBytes <= 0) {
    return {
      isValid: false,
      errorCode: 'EMPTY_FILE',
      normalizedExtension: ext,
      category: spec.category,
    };
  }

  if (hasMaliciousSignature(input.bytes) || !matchesExtensionMagicBytes(ext, input.bytes)) {
    return {
      isValid: false,
      errorCode: 'FILE_SIGNATURE_MISMATCH',
      normalizedExtension: ext,
      category: spec.category,
    };
  }

  if (input.visibility === 'public' && spec.category !== 'image') {
    return {
      isValid: false,
      errorCode: 'PUBLIC_ONLY_IMAGES_ALLOWED',
      normalizedExtension: ext,
      category: spec.category,
    };
  }

  const maxVideoMb =
    typeof input.maxVideoMb === 'number' && input.maxVideoMb > 0
      ? input.maxVideoMb
      : DEFAULT_MAX_VIDEO_MB;
  const maxOtherMb =
    typeof input.maxOtherMb === 'number' && input.maxOtherMb > 0
      ? input.maxOtherMb
      : DEFAULT_MAX_OTHER_MB;

  const limitMb = spec.category === 'video' ? maxVideoMb : maxOtherMb;
  const maxAllowedBytes = limitMb * BYTES_PER_MB;

  if (effectiveSizeBytes > maxAllowedBytes) {
    return {
      isValid: false,
      errorCode: 'FILE_TOO_LARGE',
      normalizedExtension: ext,
      category: spec.category,
      maxAllowedBytes,
    };
  }

  return {
    isValid: true,
    category: spec.category,
    normalizedExtension: ext,
    detectedMimeType: spec.mimeType,
    maxAllowedBytes,
  };
}
