import { Fragment, type ReactNode } from 'react';
import { isSafeAnchorHref, sanitizeHtml } from '../../../core/services/htmlSanitizer';
import { t } from '../../resources/i18n';

function renderDomNodeToReact(node: ChildNode, keyPrefix: string): ReactNode {
  if (node.nodeType === Node.TEXT_NODE) {
    return node.textContent;
  }
  if (node.nodeType !== Node.ELEMENT_NODE) {
    return null;
  }

  const element = node as Element;
  const tag = element.tagName.toLowerCase();
  const children = Array.from(element.childNodes).map((child, idx) =>
    renderDomNodeToReact(child, `${keyPrefix}-${idx}`),
  );

  switch (tag) {
    case 'p':
      return (
        <p key={keyPrefix} className="leading-relaxed mb-3">
          {children}
        </p>
      );
    case 'br':
      return <br key={keyPrefix} />;
    case 'hr':
      return <hr key={keyPrefix} className="my-4 border-[var(--color-border)]" />;
    case 'h2':
      return (
        <h2 key={keyPrefix} className="text-lg font-bold text-[var(--color-text)] mt-4 mb-2">
          {children}
        </h2>
      );
    case 'h3':
      return (
        <h3 key={keyPrefix} className="text-base font-bold text-[var(--color-text)] mt-3 mb-1.5">
          {children}
        </h3>
      );
    case 'h4':
      return (
        <h4 key={keyPrefix} className="text-sm font-bold text-[var(--color-text)] mt-3 mb-1">
          {children}
        </h4>
      );
    case 'strong':
    case 'b':
      return (
        <strong key={keyPrefix} className="font-bold">
          {children}
        </strong>
      );
    case 'em':
    case 'i':
      return (
        <em key={keyPrefix} className="italic">
          {children}
        </em>
      );
    case 'u':
      return (
        <u key={keyPrefix} className="underline">
          {children}
        </u>
      );
    case 'ul':
      return (
        <ul key={keyPrefix} className="list-disc pr-6 my-2 space-y-1">
          {children}
        </ul>
      );
    case 'ol':
      return (
        <ol key={keyPrefix} className="list-decimal pr-6 my-2 space-y-1">
          {children}
        </ol>
      );
    case 'li':
      return <li key={keyPrefix}>{children}</li>;
    case 'blockquote':
      return (
        <blockquote
          key={keyPrefix}
          className="border-r-4 border-[var(--color-primary)] pr-3 py-1 my-3 text-[var(--color-muted)] bg-[var(--color-surface-alt)] rounded-[var(--radius-control)]"
        >
          {children}
        </blockquote>
      );
    case 'code':
      return (
        <code
          key={keyPrefix}
          dir="ltr"
          className="font-mono text-xs px-1.5 py-0.5 rounded bg-[var(--color-surface-alt)]"
        >
          {children}
        </code>
      );
    case 'pre':
      return (
        <pre
          key={keyPrefix}
          dir="ltr"
          className="font-mono text-xs p-3 rounded-[var(--radius-control)] bg-[var(--color-surface-alt)] overflow-x-auto my-2"
        >
          {children}
        </pre>
      );
    case 'a': {
      const rawHref = element.getAttribute('href') ?? '';
      if (isSafeAnchorHref(rawHref)) {
        return (
          <a
            key={keyPrefix}
            href={rawHref}
            target={rawHref.startsWith('#') ? undefined : '_blank'}
            rel="noopener noreferrer"
            className="text-[var(--color-primary)] underline underline-offset-4"
          >
            {children}
          </a>
        );
      }
      return <Fragment key={keyPrefix}>{children}</Fragment>;
    }
    default:
      return <Fragment key={keyPrefix}>{children}</Fragment>;
  }
}

interface SanitizedHtmlPreviewProps {
  html: string;
  emptyText?: string;
}

export function SanitizedHtmlPreview({ html, emptyText }: SanitizedHtmlPreviewProps) {
  const sanitized = sanitizeHtml(html);
  if (!sanitized) {
    return (
      <p className="text-xs text-[var(--color-muted)]">
        {emptyText ?? t('admin.content.editor.previewEmpty')}
      </p>
    );
  }

  const parser = new DOMParser();
  const doc = parser.parseFromString(sanitized, 'text/html');
  return (
    <>
      {Array.from(doc.body.childNodes).map((node, index) =>
        renderDomNodeToReact(node, `preview-${index}`),
      )}
    </>
  );
}
