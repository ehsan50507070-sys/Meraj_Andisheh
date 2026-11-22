const ALLOWED_HTML_TAGS: ReadonlySet<string> = new Set([
  'p',
  'br',
  'h2',
  'h3',
  'h4',
  'strong',
  'b',
  'em',
  'i',
  'u',
  'ul',
  'ol',
  'li',
  'blockquote',
  'a',
  'hr',
  'code',
  'pre',
]);

const VOID_ALLOWED_TAGS: ReadonlySet<string> = new Set(['br', 'hr']);

const DANGEROUS_CONTAINER_TAGS: readonly string[] = [
  'script',
  'style',
  'iframe',
  'object',
  'embed',
  'svg',
  'form',
  'noscript',
  'template',
  'textarea',
  'title',
];

function decodeBasicHtmlEntities(value: string): string {
  return value
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#x([0-9a-f]+);?/gi, (_, hex) => {
      const code = Number.parseInt(hex, 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : '';
    })
    .replace(/&#(\d+);?/g, (_, dec) => {
      const code = Number.parseInt(dec, 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : '';
    });
}

function escapeHtmlAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function extractHrefAttribute(rawAttrs: string): string | null {
  const doubleQuoted = rawAttrs.match(/\bhref\s*=\s*"([^"]*)"/i);
  if (doubleQuoted) {
    return doubleQuoted[1];
  }
  const singleQuoted = rawAttrs.match(/\bhref\s*=\s*'([^']*)'/i);
  if (singleQuoted) {
    return singleQuoted[1];
  }
  const unquoted = rawAttrs.match(/\bhref\s*=\s*([^\s"'=<>`]+)/i);
  if (unquoted) {
    return unquoted[1];
  }
  return null;
}

export function isSafeAnchorHref(rawHref: string): boolean {
  const decoded = decodeBasicHtmlEntities(rawHref ?? '');
  // Strip control characters and whitespace often used to smuggle javascript: URLs
  const collapsed = decoded.replace(/[\x00-\x20\u00A0]+/g, '').trim();
  if (!collapsed) {
    return false;
  }

  const lower = collapsed.toLowerCase();
  if (lower.startsWith('#')) {
    return true;
  }

  return lower.startsWith('http://') || lower.startsWith('https://');
}

/**
 * Strict allowlist-based HTML sanitizer for article bodies.
 * Strips dangerous tags/content (<script>, <style>, <iframe>, <svg>, <object>, etc.),
 * strips all inline event handlers (onclick, onerror, ...) and style attributes,
 * and allows only http://, https://, or # links on <a> with rel="noopener noreferrer".
 */
export function sanitizeHtml(rawHtml: string | null | undefined): string {
  if (!rawHtml || typeof rawHtml !== 'string') {
    return '';
  }

  let output = rawHtml.replace(/\0/g, '');

  // 1. Remove HTML comments
  output = output.replace(/<!--[\s\S]*?-->/g, '');

  // 2. Completely strip dangerous container tags along with their inner content
  for (const tag of DANGEROUS_CONTAINER_TAGS) {
    const pairedRegex = new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}\\s*>`, 'gi');
    output = output.replace(pairedRegex, '');
    const unclosedRegex = new RegExp(`<${tag}\\b[^>]*>`, 'gi');
    output = output.replace(unclosedRegex, '');
  }

  // 3. Process all remaining HTML tags strictly against the allowlist
  output = output.replace(/<\/?([a-zA-Z][a-zA-Z0-9:-]*)(\s+[^<>]*)?\/?>/g, (fullMatch, rawTagName, rawAttrs = '') => {
    const tagName = String(rawTagName).toLowerCase();
    const isClosing = fullMatch.startsWith('</');

    if (!ALLOWED_HTML_TAGS.has(tagName)) {
      return '';
    }

    if (isClosing) {
      if (VOID_ALLOWED_TAGS.has(tagName)) {
        return '';
      }
      return `</${tagName}>`;
    }

    if (VOID_ALLOWED_TAGS.has(tagName)) {
      return `<${tagName}>`;
    }

    if (tagName === 'a') {
      const rawHref = extractHrefAttribute(String(rawAttrs));
      if (rawHref !== null && isSafeAnchorHref(rawHref)) {
        const cleanHref = decodeBasicHtmlEntities(rawHref).trim();
        return `<a href="${escapeHtmlAttribute(cleanHref)}" rel="noopener noreferrer">`;
      }
      return '<a>';
    }

    // All other allowed tags lose every attribute (no onclick, onerror, style, class, etc.)
    return `<${tagName}>`;
  });

  return output.trim();
}
