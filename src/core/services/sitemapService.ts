import type { IClock } from '../abstractions/IClock';
import type { IContentRepository } from '../abstractions/contentRepository';
import type { ILayoutRepository } from '../abstractions/layoutRepository';
import { ContentStatus } from '../domain/content';

export interface SitemapGenerationResult {
  xml: string;
  urlCount: number;
  publishedContentsCount: number;
  staticPagesCount: number;
  generatedAtUtc: string;
}

export interface SitemapServiceDependencies {
  contentRepository: IContentRepository;
  layoutRepository: ILayoutRepository;
  clock: IClock;
}

const EXCLUDED_ROUTE_SEGMENTS = [
  '/admin',
  '/account',
  '/setup',
  '/download',
  '/health',
  '/dev',
  '/error',
] as const;

export function escapeXml(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function normalizeBaseUrl(rawBaseUrl: string): string {
  const trimmed = rawBaseUrl.trim();
  if (!trimmed) {
    return '.';
  }
  return trimmed.replace(/\/+$/, '');
}

function isDisallowedHashPath(hashPath: string): boolean {
  const lower = hashPath.toLowerCase();
  return EXCLUDED_ROUTE_SEGMENTS.some(
    (prefix) =>
      lower === `#${prefix}` ||
      lower.startsWith(`#${prefix}/`) ||
      lower.startsWith(`#${prefix}?`),
  );
}

function formatIsoDateOnly(isoTimestamp: string | null | undefined): string | null {
  if (!isoTimestamp) {
    return null;
  }
  const parsed = new Date(isoTimestamp);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed.toISOString().slice(0, 10);
}

function encodeSlugForUrl(slug: string): string {
  return encodeURIComponent(slug.trim());
}

export class SitemapService {
  private readonly contentRepository: IContentRepository;
  private readonly layoutRepository: ILayoutRepository;
  private readonly clock: IClock;

  constructor(deps: SitemapServiceDependencies) {
    this.contentRepository = deps.contentRepository;
    this.layoutRepository = deps.layoutRepository;
    this.clock = deps.clock;
  }

  public async generateSitemapXmlAsync(
    baseUrl: string,
  ): Promise<SitemapGenerationResult> {
    const cleanBase = normalizeBaseUrl(baseUrl);
    const todayDate = this.clock.nowUtcIso().slice(0, 10);

    const [allContents, allStaticPages] = await Promise.all([
      this.contentRepository.getAllContentItems(),
      this.layoutRepository.getAllStaticPages(),
    ]);

    const publishedContents = allContents
      .filter(
        (item) =>
          item.status === ContentStatus.Published &&
          typeof item.slug === 'string' &&
          item.slug.trim().length > 0,
      )
      .sort((a, b) => {
        const dateA = a.publishedAt ?? a.updatedAt ?? a.createdAt;
        const dateB = b.publishedAt ?? b.updatedAt ?? b.createdAt;
        return dateB.localeCompare(dateA) || b.id - a.id;
      });

    const publicStaticPages = [...allStaticPages]
      .filter((page) => typeof page.slug === 'string' && page.slug.trim().length > 0)
      .sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);

    const entries: Array<{
      loc: string;
      lastmod?: string | null;
      changefreq: string;
      priority: string;
    }> = [];

    const pushIfAllowed = (
      hashPath: string,
      changefreq: string,
      priority: string,
      lastmod?: string | null,
    ) => {
      if (isDisallowedHashPath(hashPath)) {
        return;
      }
      entries.push({
        loc: `${cleanBase}/${hashPath}`,
        lastmod: lastmod ?? null,
        changefreq,
        priority,
      });
    };

    pushIfAllowed('#/', 'daily', '1.0', todayDate);
    pushIfAllowed('#/content', 'daily', '0.9', todayDate);

    let staticPagesCount = 0;
    for (const page of publicStaticPages) {
      const encodedSlug = encodeSlugForUrl(page.slug);
      if (!encodedSlug) {
        continue;
      }
      pushIfAllowed(`#/p/${encodedSlug}`, 'monthly', '0.6', todayDate);
      staticPagesCount += 1;
    }

    let publishedContentsCount = 0;
    for (const item of publishedContents) {
      const encodedSlug = encodeSlugForUrl(item.slug);
      if (!encodedSlug) {
        continue;
      }
      const lastmod =
        formatIsoDateOnly(item.updatedAt) ??
        formatIsoDateOnly(item.publishedAt) ??
        todayDate;
      pushIfAllowed(`#/content/${encodedSlug}`, 'weekly', '0.8', lastmod);
      publishedContentsCount += 1;
    }

    const lines: string[] = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ];

    for (const entry of entries) {
      lines.push('  <url>');
      lines.push(`    <loc>${escapeXml(entry.loc)}</loc>`);
      if (entry.lastmod) {
        lines.push(`    <lastmod>${escapeXml(entry.lastmod)}</lastmod>`);
      }
      lines.push(`    <changefreq>${escapeXml(entry.changefreq)}</changefreq>`);
      lines.push(`    <priority>${escapeXml(entry.priority)}</priority>`);
      lines.push('  </url>');
    }

    lines.push('</urlset>');

    return {
      xml: lines.join('\n'),
      urlCount: entries.length,
      publishedContentsCount,
      staticPagesCount,
      generatedAtUtc: this.clock.nowUtcIso(),
    };
  }
}
