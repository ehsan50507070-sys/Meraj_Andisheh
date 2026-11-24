import { ArrowLeft, ExternalLink, Megaphone, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import type { AnnouncementItem } from '../../core/domain/layout';
import { validateAnnouncementLinkUrl } from '../../core/services/announcementService';
import { useAuth } from '../auth/AuthContext';
import { t } from '../resources/i18n';
import { navigateToHash } from '../router/HashRouter';
import { appContainer } from '../services/appContainer';

export interface NewsTickerBarProps {
  currentRoute: string;
}

export function NewsTickerBar({ currentRoute }: NewsTickerBarProps) {
  const { isNewsTickerEnabled } = useAuth();
  const [announcement, setAnnouncement] = useState<AnnouncementItem | null>(null);

  const normalizedPath =
    currentRoute.split('?')[0].replace(/^#/, '').toLowerCase() || '/';
  const isAdminRoute =
    normalizedPath === '/admin' || normalizedPath.startsWith('/admin/');

  const refreshBanner = useCallback(async () => {
    if (isAdminRoute || !isNewsTickerEnabled) {
      setAnnouncement(null);
      return;
    }
    await appContainer.ensureInitializedAtStartup();
    const res =
      await appContainer.announcementService.getCurrentBannerAnnouncementAsync();
    if (!res.enabled || !res.currentAnnouncement) {
      setAnnouncement(null);
      return;
    }
    setAnnouncement(res.currentAnnouncement);
  }, [isAdminRoute, isNewsTickerEnabled]);

  useEffect(() => {
    void refreshBanner();

    const handleAnnouncementsChanged = () => {
      void refreshBanner();
    };
    window.addEventListener(
      'meraj:announcements-changed',
      handleAnnouncementsChanged,
    );
    return () => {
      window.removeEventListener(
        'meraj:announcements-changed',
        handleAnnouncementsChanged,
      );
    };
  }, [refreshBanner]);

  if (isAdminRoute || !isNewsTickerEnabled || !announcement) {
    return null;
  }

  const linkValidation = validateAnnouncementLinkUrl(announcement.linkUrl);
  const safeLink = linkValidation.valid ? linkValidation.normalized : null;
  const isInternalLink = Boolean(safeLink && safeLink.startsWith('#/'));

  const handleDismiss = () => {
    appContainer.announcementService.dismissAnnouncementForSession(announcement.id);
    window.dispatchEvent(new Event('meraj:announcements-changed'));
  };

  return (
    <aside
      role="region"
      aria-label={t('newsTicker.ariaLabel')}
      className="w-full bg-[var(--color-accent)] text-[var(--color-on-accent)] border-b border-[var(--color-border)]"
    >
      <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 py-2 flex items-center justify-between gap-2 sm:gap-3">
        <div className="flex items-start sm:items-center gap-2 sm:gap-3 min-w-0 flex-1">
          <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-bold rounded-[var(--radius-control)] border border-current/25 bg-black/10 shrink-0 whitespace-nowrap">
            <Megaphone className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
            <span>{t('newsTicker.badge')}</span>
          </span>

          <p className="text-xs sm:text-sm font-medium leading-relaxed break-words min-w-0 flex-1">
            {announcement.text}
          </p>
        </div>

        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
          {safeLink &&
            (isInternalLink ? (
              <a
                href={safeLink}
                onClick={(event) => {
                  event.preventDefault();
                  navigateToHash(safeLink.slice(1));
                }}
                className="inline-flex items-center gap-1 min-h-[30px] px-2.5 py-1 text-xs font-bold rounded-[var(--radius-control)] border border-current/35 bg-black/10 hover:bg-black/20 transition-colors whitespace-nowrap focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-current"
              >
                <span>{t('newsTicker.linkAction')}</span>
                <ArrowLeft className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
              </a>
            ) : (
              <a
                href={safeLink}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 min-h-[30px] px-2.5 py-1 text-xs font-bold rounded-[var(--radius-control)] border border-current/35 bg-black/10 hover:bg-black/20 transition-colors whitespace-nowrap focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-current"
              >
                <span>{t('newsTicker.linkAction')}</span>
                <ExternalLink className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
              </a>
            ))}

          <button
            type="button"
            onClick={handleDismiss}
            aria-label={t('newsTicker.dismissAria')}
            title={t('newsTicker.dismissLabel')}
            className="inline-flex items-center justify-center w-8 h-8 rounded-[var(--radius-control)] hover:bg-black/15 transition-colors shrink-0 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-current"
          >
            <X className="w-4 h-4 shrink-0" aria-hidden="true" />
          </button>
        </div>
      </div>
    </aside>
  );
}
