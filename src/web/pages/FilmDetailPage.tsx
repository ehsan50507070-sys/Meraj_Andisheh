import {
  ArrowRight,
  Bookmark,
  BookMarked,
  Check,
  Clock,
  Copy,
  Download,
  ExternalLink,
  Eye,
  Film as FilmIcon,
  Heart,
  Image as ImageIcon,
  Lock,
  Share2,
  ShieldAlert,
  Sparkles,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ContentFileKind, FileStorageType, type ContentFile } from '../../core/domain/content';
import type { FilmKind, PublicFilmDetailData } from '../../core/domain/portals';
import { useAuth } from '../auth/AuthContext';
import { ContentCommentsSection } from '../components/ContentCommentsSection';
import { StoryGeneratorModal } from '../components/StoryGeneratorModal';
import { DocumentAttachmentCard } from '../components/players/DocumentAttachmentCard';
import { SanitizedArticleBody } from '../components/players/SanitizedArticleBody';
import { VideoPlayerBox } from '../components/players/VideoPlayerBox';
import { Breadcrumb, Button, ContentCard, type BreadcrumbItem } from '../components/ui';
import { useAge } from '../context/AgeContext';
import { usePageMeta } from '../hooks/usePageMeta';
import { MainLayout } from '../layouts/MainLayout';
import type { ResourceKey } from '../resources/fa';
import { formatJalaliDatePersian, toPersianDigits } from '../resources/formatters';
import { t } from '../resources/i18n';
import { navigateToHash } from '../router/HashRouter';
import { appContainer } from '../services/appContainer';
import { NotFoundPage } from './NotFoundPage';

export interface FilmDetailPageProps {
  currentRoute: string;
  slug: string;
}

interface LoadedVideoAsset {
  blobUrl: string;
  mimeType: string;
}

function getKindLabelKey(kind: FilmKind): ResourceKey {
  switch (kind) {
    case 'Documentary':
      return 'films.kind.Documentary';
    case 'Animation':
      return 'films.kind.Animation';
    case 'Film':
    default:
      return 'films.kind.Film';
  }
}

export function FilmDetailPage({ currentRoute, slug }: FilmDetailPageProps) {
  const { currentUser, siteTitle, isFilmsEnabled, isStoryGeneratorEnabled, isAuthReady } =
    useAuth();
  const { effectiveAgeGroup, isAgeReady } = useAge();

  const [detail, setDetail] = useState<PublicFilmDetailData | null>(null);
  const [isNotFound, setIsNotFound] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  usePageMeta({
    currentRoute,
    siteTitle,
    pageTitle: detail?.item.title ?? null,
    description: detail?.item.summary ?? null,
  });

  const [mainMedia, setMainMedia] = useState<LoadedVideoAsset | null>(null);
  const [isLoadingMedia, setIsLoadingMedia] = useState(false);
  const [relatedThumbUrls, setRelatedThumbUrls] = useState<Record<number, string>>({});

  const [displayViewCount, setDisplayViewCount] = useState(0);
  const [displayDownloadCount, setDisplayDownloadCount] = useState(0);
  const [displayLikeCount, setDisplayLikeCount] = useState(0);
  const [liked, setLiked] = useState(false);
  const [bookmarked, setBookmarked] = useState(false);
  const [isTogglingLike, setIsTogglingLike] = useState(false);
  const [isTogglingBookmark, setIsTogglingBookmark] = useState(false);
  const [interactionAuthNotice, setInteractionAuthNotice] = useState<string | null>(null);
  const [downloadingFileId, setDownloadingFileId] = useState<number | null>(null);
  const [downloadFeedback, setDownloadFeedback] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);
  const [shareFeedback, setShareFeedback] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);
  const [isStoryModalOpen, setIsStoryModalOpen] = useState(false);

  const trackedKeyRef = useRef<string | null>(null);
  const loadedSlugRef = useRef<string | null>(null);
  const detailRef = useRef<PublicFilmDetailData | null>(null);
  detailRef.current = detail;
  const activeAgeGroupRef = useRef(effectiveAgeGroup);
  activeAgeGroupRef.current = effectiveAgeGroup;

  useEffect(() => {
    if (!isAgeReady || !isAuthReady) {
      return;
    }

    if (!isFilmsEnabled) {
      setIsNotFound(true);
      setIsLoading(false);
      return;
    }

    let active = true;
    const isSameSlugReload = loadedSlugRef.current === slug;

    const loadFilmDetail = async () => {
      if (!isSameSlugReload) {
        setIsLoading(true);
        setIsNotFound(false);
        setDetail(null);
        setShareFeedback(null);
        setDownloadFeedback(null);
        setIsStoryModalOpen(false);
      }

      try {
        await appContainer.ensureInitializedAtStartup();
        const res = await appContainer.filmPortalService.getPublicFilmDetailAsync(
          slug,
          effectiveAgeGroup,
        );

        if (!active) return;

        loadedSlugRef.current = slug;

        if (res.status === 'not_found') {
          setIsNotFound(true);
          setDetail(null);
          return;
        }

        const isSameItem = detailRef.current?.item.id === res.data.item.id;
        setIsNotFound(false);
        setDetail(res.data);

        if (!isSameItem) {
          setDisplayViewCount(res.data.item.viewCount);
          setDisplayDownloadCount(res.data.item.downloadCount);
          setDisplayLikeCount(res.data.item.likeCount);
          setDownloadFeedback(null);
          setInteractionAuthNotice(null);
        } else {
          setDisplayViewCount((prev) => Math.max(prev, res.data.item.viewCount));
          setDisplayDownloadCount((prev) => Math.max(prev, res.data.item.downloadCount));
        }

        const trackingKey = `film:${res.data.item.id}:${slug}:${currentUser?.id ?? 'guest'}`;
        if (trackedKeyRef.current !== trackingKey) {
          trackedKeyRef.current = trackingKey;
          const visitorId = appContainer.visitorIdStorage.getOrCreateVisitorId();
          const userAgent = typeof navigator !== 'undefined' ? navigator.userAgent : '';
          const trackOutcome = await appContainer.viewTrackerService.trackViewAsync({
            contentId: res.data.item.id,
            userId: currentUser?.id ?? null,
            visitorId,
            userAgent,
            ageGroupId: effectiveAgeGroup?.id ?? currentUser?.ageGroupId ?? null,
            primaryTopicId: res.data.primaryRootTopicId,
          });
          if (active && trackOutcome.isCounted) {
            setDisplayViewCount((prev) => prev + 1);
          }
        }
      } finally {
        if (active) {
          setIsLoading(false);
        }
      }
    };

    void loadFilmDetail();
    return () => {
      active = false;
    };
  }, [slug, effectiveAgeGroup, isAgeReady, isAuthReady, isFilmsEnabled, currentUser?.id, currentUser?.ageGroupId]);

  const primaryFile = useMemo<ContentFile | null>(() => {
    if (!detail || detail.files.length === 0) {
      return null;
    }
    return (
      detail.files.find((f) => f.kind === ContentFileKind.Main) ??
      detail.files.find((f) => f.kind !== ContentFileKind.Preview) ??
      detail.files[0]
    );
  }, [detail]);

  const attachmentFiles = useMemo<ContentFile[]>(() => {
    if (!detail) return [];
    return detail.files.filter(
      (f) => f.id !== primaryFile?.id && f.kind === ContentFileKind.Attachment,
    );
  }, [detail, primaryFile?.id]);

  const detailItemId = detail?.item.id ?? null;

  useEffect(() => {
    if (!detailItemId) {
      setMainMedia(null);
      return;
    }

    let active = true;
    const createdUrls: string[] = [];

    const loadVideoBlob = async () => {
      setIsLoadingMedia(true);
      setMainMedia(null);
      try {
        if (
          primaryFile &&
          primaryFile.storageType === FileStorageType.Local &&
          primaryFile.storageKey
        ) {
          const opened = await appContainer.filmPortalService.openPlaybackMediaAsync(
            detailItemId,
            primaryFile.storageKey,
            activeAgeGroupRef.current,
          );
          if (active && opened) {
            const copy = new Uint8Array(opened.bytes.byteLength);
            copy.set(opened.bytes);
            const blob = new Blob([copy.buffer], { type: opened.mimeType });
            const url = URL.createObjectURL(blob);
            createdUrls.push(url);
            setMainMedia({ blobUrl: url, mimeType: opened.mimeType });
          }
        }
      } finally {
        if (active) {
          setIsLoadingMedia(false);
        }
      }
    };

    void loadVideoBlob();
    return () => {
      active = false;
      for (const url of createdUrls) {
        URL.revokeObjectURL(url);
      }
    };
  }, [detailItemId, primaryFile?.id, primaryFile?.storageType, primaryFile?.storageKey]);

  const relatedThumbSignature = useMemo(() => {
    if (!detail || detail.relatedFilms.length === 0) return '';
    return detail.relatedFilms
      .map((rel) => `${rel.item.id}:${rel.item.thumbnailKey ?? ''}`)
      .join('|');
  }, [detail]);

  useEffect(() => {
    const relatedItems = detailRef.current?.relatedFilms ?? [];
    if (!relatedThumbSignature || relatedItems.length === 0) {
      setRelatedThumbUrls({});
      return;
    }

    let active = true;
    const createdUrls: string[] = [];

    const loadRelatedThumbs = async () => {
      const next: Record<number, string> = {};
      await Promise.all(
        relatedItems.map(async (rel) => {
          if (!rel.item.thumbnailKey) return;
          const media = await appContainer.fileUploadService.openPublicMediaAsync(
            rel.item.thumbnailKey,
          );
          if (!active || !media.ok || !media.bytes || !media.metadata) return;
          const copy = new Uint8Array(media.bytes.byteLength);
          copy.set(media.bytes);
          const blob = new Blob([copy.buffer], { type: media.metadata.mimeType });
          const url = URL.createObjectURL(blob);
          createdUrls.push(url);
          next[rel.item.id] = url;
        }),
      );
      if (active) {
        setRelatedThumbUrls(next);
      }
    };

    void loadRelatedThumbs();
    return () => {
      active = false;
      for (const url of createdUrls) {
        URL.revokeObjectURL(url);
      }
    };
  }, [relatedThumbSignature]);

  useEffect(() => {
    if (!detailItemId || !isAuthReady) {
      setLiked(false);
      setBookmarked(false);
      return;
    }

    let active = true;
    void (async () => {
      const state = await appContainer.interactionService.getUserContentInteractionStateAsync(
        currentUser,
        detailItemId,
      );
      if (active) {
        setLiked(state.liked);
        setBookmarked(state.bookmarked);
        setDisplayLikeCount(state.likeCount);
        setInteractionAuthNotice(null);
      }
    })();

    return () => {
      active = false;
    };
  }, [detailItemId, currentUser, isAuthReady]);

  const buildFilmReturnPath = (): string => {
    if (!detail) return '#/films';
    return `#/films/${encodeURIComponent(detail.item.slug)}`;
  };

  const handleCopyLink = async () => {
    const shareUrl = typeof window !== 'undefined' ? window.location.href : currentRoute;
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(shareUrl);
        setShareFeedback({ type: 'success', text: t('contentDetail.share.copiedMessage') });
        return;
      }
      if (typeof document !== 'undefined') {
        const textarea = document.createElement('textarea');
        textarea.value = shareUrl;
        textarea.setAttribute('readonly', '');
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        const copied = document.execCommand('copy');
        document.body.removeChild(textarea);
        if (copied) {
          setShareFeedback({ type: 'success', text: t('contentDetail.share.copiedMessage') });
          return;
        }
      }
      setShareFeedback({ type: 'error', text: t('contentDetail.share.copyError') });
    } catch {
      setShareFeedback({ type: 'error', text: t('contentDetail.share.copyError') });
    }
  };

  const handleNativeShare = async () => {
    if (!detail) return;
    const shareUrl = typeof window !== 'undefined' ? window.location.href : currentRoute;
    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      try {
        await navigator.share({
          title: detail.item.title,
          text: detail.item.summary,
          url: shareUrl,
        });
        setShareFeedback({ type: 'success', text: t('contentDetail.share.sharedMessage') });
        return;
      } catch (err) {
        if ((err as { name?: string })?.name === 'AbortError') {
          return;
        }
      }
    }
    await handleCopyLink();
  };

  const handleToggleLike = async () => {
    if (!detail) return;
    if (!currentUser || !currentUser.isActive) {
      setInteractionAuthNotice(t('contentDetail.interaction.likeAuthRequired'));
      return;
    }
    setInteractionAuthNotice(null);
    setIsTogglingLike(true);
    try {
      const res = await appContainer.interactionService.toggleLikeAsync(
        currentUser,
        detail.item.id,
      );
      if (res.ok) {
        setLiked(res.liked);
        setDisplayLikeCount(res.likeCount);
      } else if (res.errorCode === 'AUTH_REQUIRED') {
        setInteractionAuthNotice(t('contentDetail.interaction.likeAuthRequired'));
      }
    } finally {
      setIsTogglingLike(false);
    }
  };

  const handleToggleBookmark = async () => {
    if (!detail) return;
    if (!currentUser || !currentUser.isActive) {
      setInteractionAuthNotice(t('contentDetail.interaction.bookmarkAuthRequired'));
      return;
    }
    setInteractionAuthNotice(null);
    setIsTogglingBookmark(true);
    try {
      const res = await appContainer.interactionService.toggleBookmarkAsync(
        currentUser,
        detail.item.id,
      );
      if (res.ok) {
        setBookmarked(res.bookmarked);
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('meraj:bookmarks-changed'));
        }
      } else if (res.errorCode === 'AUTH_REQUIRED') {
        setInteractionAuthNotice(t('contentDetail.interaction.bookmarkAuthRequired'));
      }
    } finally {
      setIsTogglingBookmark(false);
    }
  };

  const handleDownloadFile = async (file: ContentFile) => {
    if (!detail) return;
    const returnPath = buildFilmReturnPath();
    if (!currentUser || !currentUser.isActive) {
      navigateToHash(`/account/login?returnUrl=${encodeURIComponent(returnPath)}`);
      return;
    }

    setDownloadingFileId(file.id);
    setDownloadFeedback(null);
    try {
      const res = await appContainer.downloadService.createSignedDownloadLinkAsync({
        currentUser,
        contentId: detail.item.id,
        fileId: file.id,
        activeAgeGroup: effectiveAgeGroup,
        returnUrl: returnPath,
      });

      if (!res.ok) {
        if (res.errorCode === 'AUTH_REQUIRED' && res.redirectUrl) {
          navigateToHash(res.redirectUrl);
          return;
        }
        const errorKey = `contentDetail.download.error.${res.errorCode}` as ResourceKey;
        setDownloadFeedback({ type: 'error', text: t(errorKey) });
        return;
      }

      navigateToHash(res.downloadUrl);
    } finally {
      setDownloadingFileId(null);
    }
  };

  const handleCopySignedTempLink = async (file: ContentFile) => {
    if (!detail || !currentUser || !currentUser.isActive) return;
    setDownloadingFileId(file.id);
    setDownloadFeedback(null);
    try {
      const res = await appContainer.downloadService.createSignedDownloadLinkAsync({
        currentUser,
        contentId: detail.item.id,
        fileId: file.id,
        activeAgeGroup: effectiveAgeGroup,
        returnUrl: buildFilmReturnPath(),
      });
      if (!res.ok) {
        const errorKey = `contentDetail.download.error.${res.errorCode}` as ResourceKey;
        setDownloadFeedback({ type: 'error', text: t(errorKey) });
        return;
      }
      const fullUrl =
        typeof window !== 'undefined'
          ? `${window.location.origin}${window.location.pathname}${res.downloadUrl}`
          : res.downloadUrl;
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(fullUrl);
        setDownloadFeedback({ type: 'success', text: t('contentDetail.download.copiedTempLink') });
        return;
      }
      if (typeof document !== 'undefined') {
        const textarea = document.createElement('textarea');
        textarea.value = fullUrl;
        textarea.setAttribute('readonly', '');
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        const copied = document.execCommand('copy');
        document.body.removeChild(textarea);
        if (copied) {
          setDownloadFeedback({ type: 'success', text: t('contentDetail.download.copiedTempLink') });
          return;
        }
      }
      setDownloadFeedback({ type: 'error', text: t('contentDetail.share.copyError') });
    } finally {
      setDownloadingFileId(null);
    }
  };

  if (!isAgeReady || !isAuthReady || isLoading) {
    return (
      <MainLayout currentRoute={currentRoute}>
        <div className="max-w-5xl mx-auto px-3 sm:px-6 lg:px-8 py-10">
          <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-card)] p-8 text-center text-sm text-[var(--color-muted)]">
            {t('films.portal.loading')}
          </div>
        </div>
      </MainLayout>
    );
  }

  if (!isFilmsEnabled || isNotFound || !detail) {
    return <NotFoundPage currentRoute={currentRoute} />;
  }

  const { item, filmInfo } = detail;
  const runtimeMinutes = filmInfo.runtimeMinutes ?? item.readWatchMinutes ?? null;
  const embedUrl =
    primaryFile && primaryFile.externalUrl
      ? appContainer.filmPortalService.resolveEmbedUrl(primaryFile.externalUrl)
      : null;

  const breadcrumbItems: BreadcrumbItem[] = [
    { label: t('catalog.breadcrumb.home'), href: '#/' },
    { label: t('filmDetail.breadcrumb.portal'), href: '#/films' },
    ...detail.topicBreadcrumbChain.map((topic) => ({
      label: topic.name,
      href: `#/content?topics=${topic.id}`,
    })),
    { label: item.title },
  ];

  const ageTargetsDisplay =
    detail.targetAgeGroups.length > 0
      ? detail.targetAgeGroups.map((ag) => ag.name).join(t('homePreview.targetListSeparator'))
      : t('contentDetail.meta.allAges');

  const isMemberLoggedIn = Boolean(currentUser && currentUser.isActive);
  const canCreateStory = appContainer.storyService.canUserGenerateStory(
    currentUser,
    isStoryGeneratorEnabled,
  );
  const storyTopicName =
    detail.topics[0]?.name ??
    detail.topicBreadcrumbChain[detail.topicBreadcrumbChain.length - 1]?.name ??
    null;

  return (
    <MainLayout currentRoute={currentRoute}>
      <div className="max-w-5xl mx-auto px-3 sm:px-6 lg:px-8 py-5 sm:py-8 space-y-6 sm:space-y-8">
        <Breadcrumb items={breadcrumbItems} ariaLabel={t('catalog.breadcrumb.ariaLabel')} />

        {/* Film Hero Metadata Header */}
        <header className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-card)] shadow-[var(--shadow-card)] p-5 sm:p-8 space-y-4">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs sm:text-sm text-[var(--color-muted)] tabular-nums-strict">
            {filmInfo.isWeeklyPick && (
              <>
                <span className="inline-flex items-center gap-1 font-bold text-[var(--color-primary)]">
                  <Sparkles className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                  <span>{t('filmDetail.meta.weeklyPickTag')}</span>
                </span>
                <span aria-hidden="true">·</span>
              </>
            )}
            <span className="font-semibold text-[var(--color-primary)]">
              {t('filmDetail.meta.kindLabel')}: {t(getKindLabelKey(filmInfo.kind))}
            </span>
            {filmInfo.releaseYear !== null && (
              <>
                <span aria-hidden="true">·</span>
                <span>
                  {t('filmDetail.meta.releaseYear', {
                    year: toPersianDigits(filmInfo.releaseYear),
                  })}
                </span>
              </>
            )}
            {typeof runtimeMinutes === 'number' && runtimeMinutes > 0 && (
              <>
                <span aria-hidden="true">·</span>
                <span className="inline-flex items-center gap-1">
                  <Clock className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                  <span>
                    {t('filmDetail.meta.runtimeMinutes', {
                      minutes: toPersianDigits(runtimeMinutes),
                    })}
                  </span>
                </span>
              </>
            )}
            <span aria-hidden="true">·</span>
            <span>
              {t('contentDetail.meta.publishedAt')}:{' '}
              {formatJalaliDatePersian(item.publishedAt ?? item.createdAt)}
            </span>
            <span aria-hidden="true">·</span>
            <span className="inline-flex items-center gap-1">
              <Eye className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
              <span>
                {t('contentDetail.meta.viewCount', {
                  count: toPersianDigits(displayViewCount),
                })}
              </span>
            </span>
            <span aria-hidden="true">·</span>
            <span className="inline-flex items-center gap-1">
              <Download className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
              <span>
                {t('contentDetail.meta.downloadCount', {
                  count: toPersianDigits(displayDownloadCount),
                })}
              </span>
            </span>
            <span aria-hidden="true">·</span>
            <span className="inline-flex items-center gap-1">
              <Heart
                className={`w-3.5 h-3.5 shrink-0 ${liked ? 'fill-current text-[var(--color-primary)]' : ''}`}
                aria-hidden="true"
              />
              <span>
                {t('contentDetail.meta.likeCount', {
                  count: toPersianDigits(displayLikeCount),
                })}
              </span>
            </span>
            {detail.impactLevel && (
              <>
                <span aria-hidden="true">·</span>
                <span>
                  {t('contentDetail.meta.impactLevel')}: {detail.impactLevel.name}
                </span>
              </>
            )}
            <span aria-hidden="true">·</span>
            <span>
              {t('contentDetail.meta.targetAges')}: {ageTargetsDisplay}
            </span>
          </div>

          <h1 className="text-xl sm:text-3xl font-bold text-[var(--color-text)] leading-snug text-balance">
            {item.title}
          </h1>

          <p className="text-sm sm:text-base text-[var(--color-muted)] leading-relaxed max-w-3xl">
            {item.summary}
          </p>

          {filmInfo.ageRatingNote && (
            <div className="rounded-[var(--radius-control)] border border-[var(--color-border-strong)] bg-[var(--color-surface-alt)] px-4 py-3 flex items-start gap-2.5 text-xs sm:text-sm">
              <ShieldAlert
                className="w-4 h-4 text-[var(--color-primary)] shrink-0 mt-0.5"
                aria-hidden="true"
              />
              <div className="space-y-0.5">
                <p className="font-bold text-[var(--color-text)]">
                  {t('filmDetail.meta.ageNoteHeading')}
                </p>
                <p className="text-[var(--color-muted)] leading-relaxed">
                  {filmInfo.ageRatingNote}
                </p>
              </div>
            </div>
          )}

          {/* Like, Bookmark, Share & Copy Actions */}
          <div className="pt-3 border-t border-[var(--color-border)] space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant={liked ? 'primary' : 'outline'}
                  size="sm"
                  disabled={isTogglingLike}
                  aria-pressed={liked}
                  onClick={() => void handleToggleLike()}
                  startIcon={<Heart className={`w-4 h-4 ${liked ? 'fill-current' : ''}`} />}
                >
                  <span>
                    {liked
                      ? t('contentDetail.interaction.likedButton')
                      : t('contentDetail.interaction.likeButton')}
                  </span>
                  <span className="ms-1.5 text-xs font-bold tabular-nums-strict">
                    ({toPersianDigits(displayLikeCount)})
                  </span>
                </Button>

                <Button
                  variant={bookmarked ? 'primary' : 'outline'}
                  size="sm"
                  disabled={isTogglingBookmark}
                  aria-pressed={bookmarked}
                  onClick={() => void handleToggleBookmark()}
                  startIcon={
                    <Bookmark className={`w-4 h-4 ${bookmarked ? 'fill-current' : ''}`} />
                  }
                >
                  {bookmarked
                    ? t('contentDetail.interaction.bookmarkedButton')
                    : t('contentDetail.interaction.bookmarkButton')}
                </Button>

                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => void handleNativeShare()}
                  startIcon={<Share2 className="w-4 h-4" />}
                >
                  {t('contentDetail.share.button')}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void handleCopyLink()}
                  startIcon={
                    shareFeedback?.type === 'success' ? (
                      <Check className="w-4 h-4" />
                    ) : (
                      <Copy className="w-4 h-4" />
                    )
                  }
                >
                  {t('contentDetail.share.copyButton')}
                </Button>
                {canCreateStory && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setIsStoryModalOpen(true)}
                    startIcon={<ImageIcon className="w-4 h-4" />}
                  >
                    {t('story.action.createButton')}
                  </Button>
                )}
              </div>

              {shareFeedback && (
                <p
                  role="status"
                  className={`text-xs font-medium ${
                    shareFeedback.type === 'success'
                      ? 'text-[var(--color-success-text)]'
                      : 'text-[var(--color-error-text)]'
                  }`}
                >
                  {shareFeedback.text}
                </p>
              )}
            </div>

            {interactionAuthNotice && (
              <div
                role="status"
                className="flex flex-wrap items-center justify-between gap-2.5 p-3 rounded-[var(--radius-control)] bg-[var(--color-surface-alt)] border border-[var(--color-border)] text-xs sm:text-sm"
              >
                <span className="text-[var(--color-text)] font-medium">
                  {interactionAuthNotice}
                </span>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() =>
                    navigateToHash(
                      `/account/login?returnUrl=${encodeURIComponent(buildFilmReturnPath())}`,
                    )
                  }
                >
                  {t('contentDetail.interaction.loginLinkAction')}
                </Button>
              </div>
            )}
          </div>
        </header>

        {/* Dedicated Cinema Player & Signed Member Download Bar */}
        <div className="space-y-3">
          <VideoPlayerBox
            blobUrl={mainMedia?.blobUrl ?? null}
            externalUrl={primaryFile?.externalUrl ?? null}
            embedUrl={embedUrl}
            title={item.title}
            fileName={primaryFile?.originalFileName}
            sizeBytes={primaryFile?.sizeBytes}
            isLoading={isLoadingMedia}
          />

          {primaryFile &&
            primaryFile.storageType !== FileStorageType.External &&
            primaryFile.isDownloadable && (
              <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3.5 sm:px-5 shadow-[var(--shadow-card)] space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-2.5">
                    <Button
                      variant="primary"
                      size="sm"
                      disabled={downloadingFileId === primaryFile.id}
                      onClick={() => void handleDownloadFile(primaryFile)}
                      startIcon={
                        isMemberLoggedIn ? (
                          <Download className="w-4 h-4" />
                        ) : (
                          <Lock className="w-4 h-4" />
                        )
                      }
                    >
                      {downloadingFileId === primaryFile.id
                        ? t('contentDetail.download.preparing')
                        : t('contentDetail.download.mainButton')}
                    </Button>

                    {isMemberLoggedIn ? (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={downloadingFileId === primaryFile.id}
                        onClick={() => void handleCopySignedTempLink(primaryFile)}
                        startIcon={<Copy className="w-4 h-4" />}
                      >
                        {t('contentDetail.download.copyTempLink')}
                      </Button>
                    ) : (
                      <span className="text-xs font-medium text-[var(--color-muted)]">
                        {t('contentDetail.download.membersOnlyHint')}
                      </span>
                    )}
                  </div>

                  <span className="text-xs text-[var(--color-muted)]">
                    {t('contentDetail.download.validityHint')}
                  </span>
                </div>

                {downloadFeedback && (
                  <p
                    role="status"
                    className={`text-xs font-medium ${
                      downloadFeedback.type === 'success'
                        ? 'text-[var(--color-success-text)]'
                        : 'text-[var(--color-error-text)]'
                    }`}
                  >
                    {downloadFeedback.text}
                  </p>
                )}
              </div>
            )}
        </div>

        {/* Supplemental Film Review / Synopsis Body */}
        {detail.sanitizedBodyHtml && (
          <section className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-card)] shadow-[var(--shadow-card)] p-5 sm:p-8 space-y-4">
            <h2 className="text-base sm:text-lg font-bold text-[var(--color-text)] pb-3 border-b border-[var(--color-border)]">
              {t('contentDetail.article.title')}
            </h2>
            <SanitizedArticleBody html={detail.sanitizedBodyHtml} />
          </section>
        )}

        {/* Attachment Files */}
        {attachmentFiles.length > 0 && (
          <section className="space-y-3">
            <h2 className="text-base sm:text-lg font-bold text-[var(--color-text)]">
              {t('contentDetail.attachments.title')}
            </h2>
            <div className="space-y-3">
              {attachmentFiles.map((att) => (
                <DocumentAttachmentCard
                  key={att.id}
                  file={att}
                  variant="document"
                  isMemberLoggedIn={isMemberLoggedIn}
                  onDownload={(f) => void handleDownloadFile(f)}
                  isDownloading={downloadingFileId === att.id}
                  buttonLabelKey="contentDetail.download.attachmentButton"
                />
              ))}
            </div>
          </section>
        )}

        {/* Verified Sources Box */}
        <section
          aria-labelledby="film-verified-sources-heading"
          className="bg-[var(--color-surface-alt)] border border-[var(--color-border-strong)] rounded-[var(--radius-card)] p-5 sm:p-7 space-y-4"
        >
          <div className="flex items-start gap-3 pb-3 border-b border-[var(--color-border)]">
            <div className="w-10 h-10 rounded-[var(--radius-control)] bg-[var(--color-surface)] border border-[var(--color-border)] flex items-center justify-center shrink-0">
              <BookMarked className="w-5 h-5 text-[var(--color-primary)]" aria-hidden="true" />
            </div>
            <div className="space-y-1">
              <h2
                id="film-verified-sources-heading"
                className="text-base sm:text-lg font-bold text-[var(--color-text)]"
              >
                {t('contentDetail.sources.title')}
              </h2>
              <p className="text-xs sm:text-sm text-[var(--color-muted)]">
                {t('contentDetail.sources.subtitle')}
              </p>
            </div>
          </div>

          {detail.sources.length === 0 ? (
            <p className="text-sm text-[var(--color-muted)]">{t('contentDetail.sources.empty')}</p>
          ) : (
            <ol className="space-y-3">
              {detail.sources.map((src, index) => (
                <li
                  key={src.id}
                  className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 p-3.5 rounded-[var(--radius-control)] bg-[var(--color-surface)] border border-[var(--color-border)]"
                >
                  <div className="flex items-start gap-3 min-w-0">
                    <span className="w-7 h-7 rounded-[var(--radius-control)] bg-[var(--color-surface-alt)] border border-[var(--color-border)] flex items-center justify-center text-xs font-bold text-[var(--color-primary)] tabular-nums-strict shrink-0">
                      {toPersianDigits(index + 1)}
                    </span>
                    <div className="space-y-1 min-w-0">
                      <p className="text-sm font-semibold text-[var(--color-text)] leading-snug break-words">
                        {src.title}
                      </p>
                      {src.note && (
                        <p className="text-xs text-[var(--color-muted)] leading-relaxed break-words">
                          {t('contentDetail.sources.notePrefix')}: {src.note}
                        </p>
                      )}
                    </div>
                  </div>

                  {src.url && (
                    <a
                      href={src.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 min-h-[38px] px-3 py-1.5 text-xs font-semibold text-[var(--color-primary)] hover:underline underline-offset-4 whitespace-nowrap shrink-0"
                    >
                      <span>{t('contentDetail.sources.openLink')}</span>
                      <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
                    </a>
                  )}
                </li>
              ))}
            </ol>
          )}
        </section>

        {/* Clickable Taxonomy Metadata */}
        {(detail.topics.length > 0 || detail.tags.length > 0 || detail.persons.length > 0) && (
          <section className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-card)] p-5 sm:p-6 space-y-4">
            {detail.topics.length > 0 && (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-semibold text-[var(--color-muted)] min-w-[75px]">
                  {t('contentDetail.taxonomy.topicsTitle')}:
                </span>
                {detail.topics.map((topic) => (
                  <button
                    key={topic.id}
                    type="button"
                    onClick={() => navigateToHash(`/content?topics=${topic.id}`)}
                    className="min-h-[36px] px-3 py-1 text-xs font-medium rounded-[var(--radius-control)] bg-[var(--color-surface-alt)] border border-[var(--color-border)] text-[var(--color-text)] hover:border-[var(--color-primary)] hover:text-[var(--color-primary)] transition-colors whitespace-nowrap"
                  >
                    {topic.name}
                  </button>
                ))}
              </div>
            )}

            {detail.tags.length > 0 && (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-semibold text-[var(--color-muted)] min-w-[75px]">
                  {t('contentDetail.taxonomy.tagsTitle')}:
                </span>
                {detail.tags.map((tag) => (
                  <button
                    key={tag.id}
                    type="button"
                    onClick={() => navigateToHash(`/content?tags=${tag.id}`)}
                    className="min-h-[36px] px-3 py-1 text-xs font-medium rounded-[var(--radius-control)] bg-[var(--color-surface-alt)] border border-[var(--color-border)] text-[var(--color-text)] hover:border-[var(--color-primary)] hover:text-[var(--color-primary)] transition-colors whitespace-nowrap"
                  >
                    {tag.name}
                  </button>
                ))}
              </div>
            )}

            {detail.persons.length > 0 && (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-semibold text-[var(--color-muted)] min-w-[75px]">
                  {t('contentDetail.taxonomy.personsTitle')}:
                </span>
                {detail.persons.map((person) => (
                  <button
                    key={person.id}
                    type="button"
                    onClick={() => navigateToHash(`/content?persons=${person.id}`)}
                    className="min-h-[36px] px-3 py-1 text-xs font-medium rounded-[var(--radius-control)] bg-[var(--color-surface-alt)] border border-[var(--color-border)] text-[var(--color-text)] hover:border-[var(--color-primary)] hover:text-[var(--color-primary)] transition-colors whitespace-nowrap"
                  >
                    {person.name}
                  </button>
                ))}
              </div>
            )}
          </section>
        )}

        {/* Related Films (Max 6, strictly age-filtered & hidden when empty) */}
        {detail.relatedFilms.length > 0 && (
          <section className="space-y-4 pt-2">
            <div className="flex items-center gap-2">
              <FilmIcon className="w-5 h-5 text-[var(--color-primary)] shrink-0" aria-hidden="true" />
              <div>
                <h2 className="text-lg sm:text-xl font-bold text-[var(--color-text)]">
                  {t('filmDetail.related.title')}
                </h2>
                <p className="text-xs sm:text-sm text-[var(--color-muted)]">
                  {t('filmDetail.related.subtitle')}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5 items-stretch">
              {detail.relatedFilms.map((rel) => (
                <ContentCard
                  key={rel.item.id}
                  title={rel.item.title}
                  formatLabel={t(getKindLabelKey(rel.filmInfo.kind))}
                  durationMinutes={rel.filmInfo.runtimeMinutes ?? rel.item.readWatchMinutes ?? 0}
                  topicLabel={rel.primaryTopicName ?? t('catalog.generalTopic')}
                  summary={rel.item.summary}
                  thumbnailUrl={relatedThumbUrls[rel.item.id]}
                  thumbnailAlt={rel.item.title}
                  onSelect={() =>
                    navigateToHash(`/films/${encodeURIComponent(rel.item.slug)}`)
                  }
                />
              ))}
            </div>
          </section>
        )}

        {/* Comments Section */}
        <ContentCommentsSection contentId={detail.item.id} contentSlug={detail.item.slug} />

        {/* Back Actions */}
        <div className="pt-2 flex flex-wrap items-center gap-3">
          <Button
            variant="primary"
            onClick={() => navigateToHash('/films')}
            startIcon={<ArrowRight className="w-4 h-4" />}
          >
            {t('filmDetail.backToPortal')}
          </Button>
          <Button
            variant="outline"
            onClick={() => navigateToHash(`/content/${encodeURIComponent(item.slug)}`)}
          >
            {t('filmDetail.backToBank')}
          </Button>
        </div>
      </div>

      {canCreateStory && (
        <StoryGeneratorModal
          open={isStoryModalOpen}
          onClose={() => setIsStoryModalOpen(false)}
          content={item}
          topicName={storyTopicName}
          currentUser={currentUser}
          activeAgeGroup={effectiveAgeGroup}
          siteTitle={siteTitle}
        />
      )}
    </MainLayout>
  );
}
