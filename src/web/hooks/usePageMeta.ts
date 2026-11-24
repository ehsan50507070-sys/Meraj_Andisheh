import { useEffect } from 'react';
import {
  getRobotsMetaForRoute,
  normalizeHashRouteForMeta,
} from '../../core/services/securityAuditService';
import type { ResourceKey } from '../resources/fa';
import { t } from '../resources/i18n';

export interface PageMetaOptions {
  currentRoute: string;
  siteTitle?: string | null;
  pageTitle?: string | null;
  description?: string | null;
}

function resolveDefaultRouteTitleKey(normalizedPath: string): ResourceKey {
  if (normalizedPath === '/') {
    return 'meta.title.home';
  }
  if (normalizedPath === '/content') {
    return 'meta.title.catalog';
  }
  if (normalizedPath.startsWith('/content/')) {
    return 'meta.title.contentDetail';
  }
  if (normalizedPath === '/search') {
    return 'meta.title.search';
  }
  if (normalizedPath === '/requests') {
    return 'meta.title.requests';
  }
  if (normalizedPath.startsWith('/p/')) {
    return 'meta.title.staticPage';
  }
  if (normalizedPath === '/health') {
    return 'meta.title.health';
  }
  if (normalizedPath.startsWith('/error/')) {
    return 'meta.title.error500';
  }
  if (normalizedPath.startsWith('/admin')) {
    return 'meta.title.admin';
  }
  if (normalizedPath.startsWith('/account')) {
    return 'meta.title.account';
  }
  if (normalizedPath.startsWith('/setup')) {
    return 'meta.title.setup';
  }
  if (normalizedPath.startsWith('/download')) {
    return 'meta.title.download';
  }
  if (normalizedPath.startsWith('/dev')) {
    return 'meta.title.dev';
  }
  return 'meta.title.notFound';
}

function setOrCreateMetaTag(
  attrName: 'name' | 'property',
  attrValue: string,
  content: string,
): void {
  if (typeof document === 'undefined' || !document.head) {
    return;
  }
  let el = document.head.querySelector<HTMLMetaElement>(
    `meta[${attrName}="${attrValue}"]`,
  );
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute(attrName, attrValue);
    document.head.appendChild(el);
  }
  el.setAttribute('content', content);
}

export function usePageMeta({
  currentRoute,
  siteTitle,
  pageTitle,
  description,
}: PageMetaOptions): void {
  useEffect(() => {
    if (typeof document === 'undefined') {
      return;
    }
    const baseSiteTitle =
      siteTitle && siteTitle.trim().length > 0 ? siteTitle.trim() : t('app.name');
    const normalizedPath = normalizeHashRouteForMeta(currentRoute);
    const resolvedPageTitle =
      pageTitle && pageTitle.trim().length > 0
        ? pageTitle.trim()
        : t(resolveDefaultRouteTitleKey(normalizedPath));

    const fullTitle = t('meta.titleFormat', {
      page: resolvedPageTitle,
      site: baseSiteTitle,
    });
    document.title = fullTitle;
    setOrCreateMetaTag('property', 'og:title', fullTitle);

    const robotsDirective = getRobotsMetaForRoute(currentRoute);
    setOrCreateMetaTag('name', 'robots', robotsDirective);

    const cleanDesc =
      description && description.trim().length > 0
        ? description.trim()
        : t('meta.defaultDescription');
    setOrCreateMetaTag('name', 'description', cleanDesc);
    setOrCreateMetaTag('property', 'og:description', cleanDesc);
  }, [currentRoute, siteTitle, pageTitle, description]);
}
