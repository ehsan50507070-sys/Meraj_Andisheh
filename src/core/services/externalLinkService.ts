export const DEFAULT_EMBED_HOST_WHITELIST: readonly string[] = ['aparat.com'] as const;

export type ExternalLinkDisplayMode = 'embed' | 'external_link';

export interface ExternalLinkValidationResult {
  isValid: boolean;
  normalizedUrl: string | null;
  hostname: string | null;
  isEmbedAllowed: boolean;
  displayMode: ExternalLinkDisplayMode;
}

export function isHostWhitelistedForEmbed(
  hostname: string,
  whitelist: readonly string[] = DEFAULT_EMBED_HOST_WHITELIST,
): boolean {
  const normalizedHost = hostname.trim().toLowerCase();
  if (!normalizedHost) {
    return false;
  }

  return whitelist.some((allowed) => {
    const cleanAllowed = allowed.trim().toLowerCase();
    return normalizedHost === cleanAllowed || normalizedHost.endsWith(`.${cleanAllowed}`);
  });
}

export function validateExternalUrl(
  rawUrl: string | null | undefined,
  embedWhitelist: readonly string[] = DEFAULT_EMBED_HOST_WHITELIST,
): ExternalLinkValidationResult {
  if (!rawUrl || typeof rawUrl !== 'string') {
    return {
      isValid: false,
      normalizedUrl: null,
      hostname: null,
      isEmbedAllowed: false,
      displayMode: 'external_link',
    };
  }

  const trimmed = rawUrl.trim();
  if (!trimmed || /[\x00-\x1f\s]/.test(trimmed)) {
    return {
      isValid: false,
      normalizedUrl: null,
      hostname: null,
      isEmbedAllowed: false,
      displayMode: 'external_link',
    };
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return {
      isValid: false,
      normalizedUrl: null,
      hostname: null,
      isEmbedAllowed: false,
      displayMode: 'external_link',
    };
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return {
      isValid: false,
      normalizedUrl: null,
      hostname: null,
      isEmbedAllowed: false,
      displayMode: 'external_link',
    };
  }

  const hostname = parsed.hostname.toLowerCase();
  if (!hostname || !hostname.includes('.')) {
    return {
      isValid: false,
      normalizedUrl: null,
      hostname: null,
      isEmbedAllowed: false,
      displayMode: 'external_link',
    };
  }

  const isEmbedAllowed = isHostWhitelistedForEmbed(hostname, embedWhitelist);
  return {
    isValid: true,
    normalizedUrl: parsed.toString(),
    hostname,
    isEmbedAllowed,
    displayMode: isEmbedAllowed ? 'embed' : 'external_link',
  };
}

/**
 * Extracts a safe embed iframe URL strictly for aparat.com links.
 * Returns null for any non-aparat host or invalid URL format.
 */
export function resolveAparatEmbedUrl(rawUrl: string | null | undefined): string | null {
  const validation = validateExternalUrl(rawUrl, ['aparat.com']);
  if (!validation.isValid || !validation.normalizedUrl || !validation.isEmbedAllowed) {
    return null;
  }

  let parsed: URL;
  try {
    parsed = new URL(validation.normalizedUrl);
  } catch {
    return null;
  }

  const host = parsed.hostname.toLowerCase();
  if (host !== 'aparat.com' && !host.endsWith('.aparat.com')) {
    return null;
  }

  const pathname = parsed.pathname.trim();
  const patterns: readonly RegExp[] = [
    /^\/v\/([a-zA-Z0-9_-]{3,64})(?:\/|$)/i,
    /^\/video\/video\/embed\/videohash\/([a-zA-Z0-9_-]{3,64})(?:\/|$)/i,
    /^\/embed\/([a-zA-Z0-9_-]{3,64})(?:\/|$)/i,
  ];

  for (const regex of patterns) {
    const match = pathname.match(regex);
    if (match && match[1]) {
      const videoHash = match[1];
      return `https://www.aparat.com/video/video/embed/videohash/${encodeURIComponent(videoHash)}/vt/frame`;
    }
  }

  return null;
}
