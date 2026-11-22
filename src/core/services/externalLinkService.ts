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
