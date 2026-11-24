import type { IClock } from '../abstractions/IClock';
import type { ILogger } from '../abstractions/ILogger';

export type RobotsMetaDirective = 'index, follow' | 'noindex, nofollow';

export interface SafeErrorReport {
  errorId: string;
  safeMessageKey: string;
  occurredAtUtc: string;
  occurredAtJalali: string;
  isDevelopment: boolean;
  technicalDetails: string | null;
}

export interface CspValidationResult {
  isValid: boolean;
  issues: string[];
  directives: Record<string, string[]>;
}

const NOINDEX_PREFIXES = [
  '/admin',
  '/account',
  '/setup',
  '/download',
  '/health',
  '/dev',
  '/error',
  '/media',
] as const;

const REQUIRED_CSP_DIRECTIVES = [
  'default-src',
  'script-src',
  'style-src',
  'img-src',
  'media-src',
  'font-src',
  'connect-src',
  'frame-src',
  'object-src',
  'base-uri',
] as const;

const ALLOWED_FRAME_SRC_TOKENS = new Set([
  "'self'",
  'blob:',
  'https://www.aparat.com',
  'https://aparat.com',
]);

export function normalizeHashRouteForMeta(hashPath: string): string {
  const raw = hashPath.trim();
  if (!raw || raw === '#' || raw === '#/') {
    return '/';
  }
  const withoutHash = raw.startsWith('#') ? raw.slice(1) : raw;
  const queryIdx = withoutHash.indexOf('?');
  const pathOnly = queryIdx === -1 ? withoutHash : withoutHash.slice(0, queryIdx);
  const withLeadingSlash = pathOnly.startsWith('/') ? pathOnly : `/${pathOnly}`;
  const normalized =
    withLeadingSlash.length > 1 && withLeadingSlash.endsWith('/')
      ? withLeadingSlash.slice(0, -1)
      : withLeadingSlash;
  return normalized.toLowerCase() || '/';
}

export function getRobotsMetaForRoute(hashPath: string): RobotsMetaDirective {
  const normalized = normalizeHashRouteForMeta(hashPath);
  for (const prefix of NOINDEX_PREFIXES) {
    if (normalized === prefix || normalized.startsWith(`${prefix}/`)) {
      return 'noindex, nofollow';
    }
  }
  return 'index, follow';
}

function generateShortErrorSuffix(clock: IClock): string {
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const buf = new Uint8Array(2);
    crypto.getRandomValues(buf);
    return Array.from(buf, (b) => b.toString(16).padStart(2, '0'))
      .join('')
      .toUpperCase();
  }
  const ms = clock.now().getTime();
  return (ms & 0xffff).toString(16).padStart(4, '0').toUpperCase();
}

export function buildSafeErrorReport(
  error: unknown,
  isDevelopment: boolean,
  clock: IClock,
  logger?: ILogger,
): SafeErrorReport {
  const occurredAtUtc = clock.nowUtcIso();
  const occurredAtJalali = clock.nowJalali();
  const dateCompact = occurredAtUtc.slice(0, 10).replace(/-/g, '');
  const suffix = generateShortErrorSuffix(clock);
  const errorId = `MA-ERR-${dateCompact}-${suffix}`;

  const rawMessage =
    error instanceof Error
      ? error.message || error.name
      : typeof error === 'string'
        ? error
        : 'UNKNOWN_RUNTIME_ERROR';
  const rawStack = error instanceof Error && error.stack ? error.stack : '';

  if (logger) {
    logger.error('UNHANDLED_UI_ERROR', {
      errorId,
      message: rawMessage,
      stack: rawStack || undefined,
    });
  }

  const technicalDetails = isDevelopment
    ? [rawMessage, rawStack].filter((part) => part.trim().length > 0).join('\n\n')
    : null;

  return {
    errorId,
    safeMessageKey: 'error500.safeBody',
    occurredAtUtc,
    occurredAtJalali,
    isDevelopment,
    technicalDetails,
  };
}

export function validateCspPolicy(cspContent: string): CspValidationResult {
  const issues: string[] = [];
  const directives: Record<string, string[]> = {};

  if (typeof cspContent !== 'string' || cspContent.trim().length === 0) {
    return {
      isValid: false,
      issues: ['CSP_EMPTY'],
      directives,
    };
  }

  const rawSegments = cspContent
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  for (const segment of rawSegments) {
    const tokens = segment.split(/\s+/).filter(Boolean);
    if (tokens.length === 0) {
      continue;
    }
    const name = tokens[0].toLowerCase();
    directives[name] = tokens.slice(1);
  }

  for (const required of REQUIRED_CSP_DIRECTIVES) {
    if (!directives[required] || directives[required].length === 0) {
      issues.push(`MISSING_DIRECTIVE:${required}`);
    }
  }

  const defaultSrc = directives['default-src'] ?? [];
  if (defaultSrc.length !== 1 || defaultSrc[0] !== "'self'") {
    issues.push('INVALID_DEFAULT_SRC');
  }

  const baseUri = directives['base-uri'] ?? [];
  if (baseUri.length !== 1 || baseUri[0] !== "'self'") {
    issues.push('INVALID_BASE_URI');
  }

  const localOnlyDirectives = ['script-src', 'style-src', 'font-src'] as const;
  for (const dirName of localOnlyDirectives) {
    const values = directives[dirName] ?? [];
    for (const val of values) {
      const lowerVal = val.toLowerCase();
      if (
        lowerVal === '*' ||
        lowerVal === "'unsafe-eval'" ||
        lowerVal.startsWith('http://') ||
        lowerVal.startsWith('https://') ||
        lowerVal.startsWith('//')
      ) {
        issues.push(`DISALLOWED_EXTERNAL_SOURCE:${dirName}:${val}`);
      }
    }
  }

  const frameSrc = directives['frame-src'] ?? [];
  for (const val of frameSrc) {
    if (!ALLOWED_FRAME_SRC_TOKENS.has(val.toLowerCase())) {
      issues.push(`DISALLOWED_FRAME_SRC:${val}`);
    }
  }

  return {
    isValid: issues.length === 0,
    issues,
    directives,
  };
}

const KNOWN_THIRD_PARTY_CDN_HOSTS = [
  'fonts.googleapis.com',
  'fonts.gstatic.com',
  'cdn.jsdelivr.net',
  'unpkg.com',
  'cdnjs.cloudflare.com',
  'ajax.googleapis.com',
  'code.jquery.com',
  'stackpath.bootstrapcdn.com',
  'maxcdn.bootstrapcdn.com',
  'kit.fontawesome.com',
  'use.fontawesome.com',
] as const;

const PREVIEW_RUNTIME_HOST_SUFFIXES = [
  '.run.app',
  '.aistudio.google.com',
  '.clients6.google.com',
] as const;

const PREVIEW_RUNTIME_EXACT_HOSTS = new Set([
  'aistudio.google.com',
  'makersuite.google.com',
  'www.gstatic.com',
  'apis.google.com',
  'accounts.google.com',
]);

export function isPreviewBridgeOrSameOriginUrl(
  rawUrl: string,
  currentHostname?: string | null,
): boolean {
  const trimmed = (rawUrl ?? '').trim();
  if (
    !trimmed ||
    trimmed.startsWith('/') ||
    trimmed.startsWith('./') ||
    trimmed.startsWith('../') ||
    trimmed.startsWith('#') ||
    /^blob:/i.test(trimmed) ||
    /^data:/i.test(trimmed)
  ) {
    return true;
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return true;
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return true;
  }

  const host = parsed.hostname.toLowerCase();
  if (currentHostname && host === currentHostname.toLowerCase()) {
    return true;
  }

  if (
    KNOWN_THIRD_PARTY_CDN_HOSTS.some(
      (cdnHost) => host === cdnHost || host.endsWith(`.${cdnHost}`),
    )
  ) {
    return false;
  }

  if (
    PREVIEW_RUNTIME_EXACT_HOSTS.has(host) ||
    PREVIEW_RUNTIME_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix))
  ) {
    return true;
  }

  return false;
}

export function auditDocumentExternalCdnUrls(
  urls: readonly string[],
  currentHostname?: string | null,
): string[] {
  const disallowed: string[] = [];
  for (const raw of urls) {
    const clean = (raw ?? '').trim();
    if (!clean) {
      continue;
    }
    if (!isPreviewBridgeOrSameOriginUrl(clean, currentHostname)) {
      if (!disallowed.includes(clean)) {
        disallowed.push(clean);
      }
    }
  }
  return disallowed;
}

export interface RobotsTxtValidationResult {
  isValid: boolean;
  missingDirectives: string[];
}

const REQUIRED_ROBOTS_DISALLOW_PATHS = [
  '/admin',
  '/setup',
  '/account',
  '/download',
] as const;

export function validateRobotsTxtContent(
  rawContent: string,
): RobotsTxtValidationResult {
  const missingDirectives: string[] = [];
  if (typeof rawContent !== 'string' || rawContent.trim().length === 0) {
    return {
      isValid: false,
      missingDirectives: ['EMPTY_ROBOTS_TXT'],
    };
  }

  const lines = rawContent
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'));

  const hasAllow = lines.some((line) => /^allow:\s*\//i.test(line));
  if (!hasAllow) {
    missingDirectives.push('Allow: /');
  }

  for (const disallowPath of REQUIRED_ROBOTS_DISALLOW_PATHS) {
    const pattern = new RegExp(`^disallow:\\s*${disallowPath}(?:\\b|/)`, 'i');
    if (!lines.some((line) => pattern.test(line))) {
      missingDirectives.push(`Disallow: ${disallowPath}`);
    }
  }

  const hasSitemap = lines.some((line) => /^sitemap:\s*\S+/i.test(line));
  if (!hasSitemap) {
    missingDirectives.push('Sitemap');
  }

  return {
    isValid: missingDirectives.length === 0,
    missingDirectives,
  };
}

