import { createElement, Fragment, type ReactNode } from 'react';
import { isSafeAnchorHref, sanitizeHtml } from '../../../core/services/htmlSanitizer';

export interface SanitizedArticleBodyProps {
  html: string;
}

const ALLOWED_RENDER_TAGS = new Set([
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

function getTagClassName(tag: string): string | undefined {
  switch (tag) {
    case 'h2':
      return 'text-lg sm:text-xl font-bold text-[var(--color-text)] mt-6 mb-2.5';
    case 'h3':
      return 'text-base sm:text-lg font-bold text-[var(--color-text)] mt-5 mb-2';
    case 'h4':
      return 'text-sm sm:text-base font-semibold text-[var(--color-text)] mt-4 mb-1.5';
    case 'p':
      return 'text-sm sm:text-base text-[var(--color-text)] leading-[1.9] mb-4';
    case 'ul':
      return 'list-disc pr-6 mb-4 space-y-1.5 text-sm sm:text-base text-[var(--color-text)] leading-[1.8]';
    case 'ol':
      return 'list-decimal pr-6 mb-4 space-y-1.5 text-sm sm:text-base text-[var(--color-text)] leading-[1.8]';
    case 'li':
      return 'leading-[1.8]';
    case 'blockquote':
      return 'my-5 px-4 py-3 rounded-[var(--radius-control)] bg-[var(--color-surface-alt)] border border-[var(--color-border)] text-sm sm:text-base italic text-[var(--color-text)] leading-[1.85]';
    case 'a':
      return 'font-medium text-[var(--color-primary)] underline underline-offset-4 hover:opacity-85';
    case 'hr':
      return 'my-6 border-t border-[var(--color-border)]';
    case 'pre':
      return 'my-4 p-3 rounded-[var(--radius-control)] bg-[var(--color-surface-alt)] border border-[var(--color-border)] overflow-x-auto text-xs font-mono';
    case 'code':
      return 'font-mono text-xs sm:text-sm bg-[var(--color-surface-alt)] px-1.5 py-0.5 rounded';
    default:
      return undefined;
  }
}

function domNodeToReact(node: ChildNode, key: string): ReactNode {
  if (node.nodeType === 3) {
    return node.textContent;
  }
  if (node.nodeType !== 1) {
    return null;
  }

  const el = node as Element;
  const tag = el.tagName.toLowerCase();
  const children = Array.from(el.childNodes).map((child, idx) =>
    domNodeToReact(child, `${key}-${idx}`),
  );

  if (!ALLOWED_RENDER_TAGS.has(tag)) {
    return createElement(Fragment, { key }, ...children);
  }

  if (tag === 'br' || tag === 'hr') {
    return createElement(tag, { key, className: getTagClassName(tag) });
  }

  if (tag === 'a') {
    const rawHref = el.getAttribute('href') ?? '';
    if (isSafeAnchorHref(rawHref)) {
      return createElement(
        'a',
        {
          key,
          href: rawHref,
          target: rawHref.startsWith('#') ? undefined : '_blank',
          rel: rawHref.startsWith('#') ? undefined : 'noopener noreferrer',
          className: getTagClassName('a'),
        },
        ...children,
      );
    }
    return createElement('span', { key }, ...children);
  }

  return createElement(
    tag,
    { key, className: getTagClassName(tag) },
    ...children,
  );
}

export function SanitizedArticleBody({ html }: SanitizedArticleBodyProps) {
  const cleanHtml = sanitizeHtml(html);
  if (!cleanHtml) {
    return null;
  }

  if (typeof DOMParser === 'undefined') {
    const plain = cleanHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    return <p className="text-sm sm:text-base text-[var(--color-text)] leading-[1.9]">{plain}</p>;
  }

  const doc = new DOMParser().parseFromString(cleanHtml, 'text/html');
  const nodes = Array.from(doc.body.childNodes).map((node, idx) =>
    domNodeToReact(node, `art-${idx}`),
  );

  return <div className="max-w-prose text-right break-words">{nodes}</div>;
}
