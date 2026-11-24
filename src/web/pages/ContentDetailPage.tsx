import {
  ArrowRight,
  Bookmark,
  BookMarked,
  BookOpen,
  Check,
  Clock,
  Copy,
  Download,
  Eye,
  ExternalLink,
  Heart,
  Lock,
  Share2,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ContentFileKind, FileStorageType, type ContentFile } from '../../core/domain/content';
import type { ContentDetailData } from '../../core/services/contentDetailService';
import { useAuth } from '../auth/AuthContext';
import { ContentCommentsSection } from '../components/ContentCommentsSection';
import { AudioPlayerBox } from '../components/players/AudioPlayerBox';
import { DocumentAttachmentCard } from '../components/players/DocumentAttachmentCard';
import { ImageZoomViewer } from '../components/players/ImageZoomViewer';
import { PdfLocalViewer } from '../components/players/PdfLocalViewer';
import { SanitizedArticleBody } from '../components/players/SanitizedArticleBody';
import { VideoPlayerBox } from '../components/players/VideoPlayerBox';
import {
  Breadcrumb,
  Button,
  ContentCard,
  type BreadcrumbItem,
} from '../components/ui';
import { useAge } from '../context/AgeContext';
import { usePageMeta } from '../hooks/usePageMeta';
import { MainLayout } from '../layouts/MainLayout';
import { formatJalaliDatePersian, toPersianDigits } from '../resources/formatters';
import type { ResourceKey } from '../resources/fa';
import { t } from '../resources/i18n';
import { navigateToHash } from '../router/HashRouter';
import { appContainer } from '../services/appContainer';
import { NotFoundPage } from './NotFoundPage';

export interface ContentDetailPageProps {
  currentRoute: string;
  slug: string;
}

interface LoadedMediaAsset {
  blobUrl: string;
  bytes: Uint8Array;
  mimeType: string;
}

function isPdfFile(file: ContentFile | null | undefined): boolean {
  if (!file) {
    return false;
  }
  const lowerName = file.originalFileName.toLowerCase();
  return (
    file.mimeType.toLowerCase() === 'application/pdf' || lowerName.endsWith('.pdf')
  );
}

export function ContentDetailPage({ currentRoute, slug }: ContentDetailPageProps) {
  const { currentUser, siteTitle, isAuthReady } = useAuth();
  const { effectiveAgeGroup, isAgeReady } = useAge();

  const [detail, setDetail] = useState<ContentDetailData | null>(null);
  const [isNotFound, setIsNotFound] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  usePageMeta({
    currentRoute,
    siteTitle,
    pageTitle: detail?.item.title ?? null,
    description: detail?.item.summary ?? null,
  });

  const [mainMedia, setMainMedia] = useState<LoadedMediaAsset | null>(null);
  const [previewPdfMedia, setPreviewPdfMedia] = useState<LoadedMediaAsset | null>(null);
  const [isLoadingMedia, setIsLoadingMedia] = useState<boolean>(false);
  const [relatedThumbUrls, setRelatedThumbUrls] = useState<Record<number, string>>({});

  const [displayViewCount, setDisplayViewCount] = useState<number>(0);
  const [displayDownloadCount, setDisplayDownloadCount] = useState<number>(0);
  const [displayLikeCount, setDisplayLikeCount] = useState<number>(0);
  const [liked, setLiked] = useState<boolean>(false);
  const [bookmarked, setBookmarked] = useState<boolean>(false);
  const [isTogglingLike, setIsTogglingLike] = useState<boolean>(false);
  const [isTogglingBookmark, setIsTogglingBookmark] = useState<boolean>(false);
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

  // StrictMode & age-switch guards: ensures view tracking and primary media loading do not repeat unnecessarily on age switch
  const trackedKeyRef = useRef<string | null>(null);
  const loadedSlugRef = useRef<string | null>(null);
  const detailRef = useRef<ContentDetailData | null>(null);
  detailRef.current = detail;
  const activeAgeGroupRef = useRef(effectiveAgeGroup);
  activeAgeGroupRef.current = effectiveAgeGroup;

  useEffect(() => {
    if (!isAgeReady || !isAuthReady) {
      return;
    }

    let active = true;
    const isSameSlugReload = loadedSlugRef.current === slug;

    const loadDetail = async () => {
      if (!isSameSlugReload) {
        setIsLoading(true);
        setIsNotFound(false);
        setDetail(null);
        setShareFeedback(null);
        setDownloadFeedback(null);
      }

      try {
        await appContainer.ensureInitializedAtStartup();
        const res = await appContainer.contentDetailService.getPublicContentDetailAsync(
          slug,
          effectiveAgeGroup,
        );

        if (!active) {
          return;
        }

        loadedSlugRef.current = slug;

        if (res.status === 'not_found') {
          setIsNotFound(true);
          setDetail(null);
          return;
        }

        const isSameContentItem = detailRef.current?.item.id === res.data.item.id;
        setIsNotFound(false);
        setDetail(res.data);

        if (!isSameContentItem) {
          setDisplayViewCount(res.data.item.viewCount);
          setDisplayDownloadCount(res.data.item.downloadCount);
          setDisplayLikeCount(res.data.item.likeCount);
          setDownloadFeedback(null);
          setInteractionAuthNotice(null);
        } else {
          setDisplayViewCount((prev) => Math.max(prev, res.data.item.viewCount));
          setDisplayDownloadCount((prev) => Math.max(prev, res.data.item.downloadCount));
        }

        const trackingGuardKey = `${res.data.item.id}:${slug}:${currentUser?.id ?? 'guest'}`;
        if (trackedKeyRef.current !== trackingGuardKey) {
          trackedKeyRef.current = trackingGuardKey;
          const visitorId = appContainer.visitorIdStorage.getOrCreateVisitorId();
          const userAgent =
            typeof navigator !== 'undefined' ? navigator.userAgent : '';
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

    void loadDetail();

    return () => {
      active = false;
    };
  }, [slug, effectiveAgeGroup, isAgeReady, isAuthReady, currentUser?.id]);

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

  const previewPdfFile = useMemo<ContentFile | null>(() => {
    if (!detail) {
      return null;
    }
    return (
      detail.files.find(
        (f) => f.kind === ContentFileKind.Preview && isPdfFile(f),
      ) ?? null
    );
  }, [detail]);

  const attachmentFiles = useMemo<ContentFile[]>(() => {
    if (!detail) {
      return [];
    }
    return detail.files.filter(
      (f) =>
        f.id !== primaryFile?.id &&
        f.id !== previewPdfFile?.id &&
        f.kind === ContentFileKind.Attachment,
    );
  }, [detail, primaryFile?.id, previewPdfFile?.id]);

  // Load main media and optional preview PDF only when item/files change (not on age/theme switch while item stays allowed)
  const detailItemId = detail?.item.id ?? null;
  useEffect(() => {
    if (!detailItemId) {
      setMainMedia(null);
      setPreviewPdfMedia(null);
      return;
    }

    let active = true;
    const createdUrls: string[] = [];

    const loadPrimaryAndPreviewBlobs = async () => {
      setIsLoadingMedia(true);
      setMainMedia(null);
      setPreviewPdfMedia(null);

      try {
        if (
          primaryFile &&
          primaryFile.storageType === FileStorageType.Local &&
          primaryFile.storageKey
        ) {
          const opened = await appContainer.contentDetailService.openPlaybackMediaAsync(
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
            setMainMedia({
              blobUrl: url,
              bytes: opened.bytes,
              mimeType: opened.mimeType,
            });
          }
        }

        if (
          previewPdfFile &&
          previewPdfFile.storageType === FileStorageType.Local &&
          previewPdfFile.storageKey
        ) {
          const openedPreview = await appContainer.contentDetailService.openPlaybackMediaAsync(
            detailItemId,
            previewPdfFile.storageKey,
            activeAgeGroupRef.current,
          );
          if (active && openedPreview) {
            const copy = new Uint8Array(openedPreview.bytes.byteLength);
            copy.set(openedPreview.bytes);
            const blob = new Blob([copy.buffer], { type: openedPreview.mimeType });
            const url = URL.createObjectURL(blob);
            createdUrls.push(url);
            setPreviewPdfMedia({
              blobUrl: url,
              bytes: openedPreview.bytes,
              mimeType: openedPreview.mimeType,
            });
          }
        }
      } finally {
        if (active) {
          setIsLoadingMedia(false);
        }
      }
    };

    void loadPrimaryAndPreviewBlobs();

    return () => {
      active = false;
      for (const url of createdUrls) {
        URL.revokeObjectURL(url);
      }
    };
  }, [
    detailItemId,
    primaryFile?.id,
    primaryFile?.storageType,
    primaryFile?.storageKey,
    previewPdfFile?.id,
    previewPdfFile?.storageType,
    previewPdfFile?.storageKey,
  ]);

  const relatedThumbSignature = useMemo(() => {
    if (!detail || detail.relatedContents.length === 0) {
      return '';
    }
    return detail.relatedContents
      .map((rel) => `${rel.item.id}:${rel.item.thumbnailKey ?? ''}`)
      .join('|');
  }, [detail]);

  // Load related item thumbnails independently so primary media playback is preserved across age switches
  useEffect(() => {
    const relatedItems = detailRef.current?.relatedContents ?? [];
    if (!relatedThumbSignature || relatedItems.length === 0) {
      setRelatedThumbUrls({});
      return;
    }

    let active = true;
    const createdUrls: string[] = [];

    const loadRelatedThumbs = async () => {
      const nextThumbs: Record<number, string> = {};
      await Promise.all(
        relatedItems.map(async (rel) => {
          if (!rel.item.thumbnailKey) {
            return;
          }
          const media = await appContainer.fileUploadService.openPublicMediaAsync(
            rel.item.thumbnailKey,
          );
          if (!active || !media.ok || !media.bytes || !media.metadata) {
            return;
          }
          const copy = new Uint8Array(media.bytes.byteLength);
          copy.set(media.bytes);
          const blob = new Blob([copy.buffer], { type: media.metadata.mimeType });
          const url = URL.createObjectURL(blob);
          createdUrls.push(url);
          nextThumbs[rel.item.id] = url;
        }),
      );
      if (active) {
        setRelatedThumbUrls(nextThumbs);
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
    if (!detail) {
      return;
    }
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

  const handleToggleLike = async () => {
    if (!detail) {
      return;
    }
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
    if (!detail) {
      return;
    }
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

  const buildContentReturnPath = (): string => {
    if (!detail) {
      return '#/';
    }
    return `#/content/${encodeURIComponent(detail.item.slug)}`;
  };

  const handleDownloadFile = async (file: ContentFile) => {
    if (!detail) {
      return;
    }

    const contentReturnPath = buildContentReturnPath();
    if (!currentUser || !currentUser.isActive) {
      navigateToHash(`/account/login?returnUrl=${encodeURIComponent(contentReturnPath)}`);
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
        returnUrl: contentReturnPath,
      });

      if (!res.ok) {
        if (res.errorCode === 'AUTH_REQUIRED' && res.redirectUrl) {
          navigateToHash(res.redirectUrl);
          return;
        }
        const errorKey = `contentDetail.download.error.${res.errorCode}` as ResourceKey;
        setDownloadFeedback({
          type: 'error',
          text: t(errorKey),
        });
        return;
      }

      navigateToHash(res.downloadUrl);
    } finally {
      setDownloadingFileId(null);
    }
  };

  const handleCopySignedTempLink = async (file: ContentFile) => {
    if (!detail || !currentUser || !currentUser.isActive) {
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
        returnUrl: buildContentReturnPath(),
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
            {t('catalog.loading')}
          </div>
        </div>
      </MainLayout>
    );
  }

  if (isNotFound || !detail) {
    return <NotFoundPage currentRoute={currentRoute} />;
  }

  const { item } = detail;
  const formatKey = `catalog.format.${item.format}` as ResourceKey;

  const breadcrumbItems: BreadcrumbItem[] = [
    { label: t('catalog.breadcrumb.home'), href: '#/' },
    { label: t('catalog.breadcrumb.bank'), href: '#/content' },
    ...detail.topicBreadcrumbChain.map((topic) => ({
      label: topic.name,
      href: `#/content?topics=${topic.id}`,
    })),
    { label: item.title },
  ];

  const embedUrl =
    primaryFile && primaryFile.externalUrl
      ? appContainer.contentDetailService.resolveEmbedUrl(primaryFile.externalUrl)
      : null;

  const renderPrimaryDownloadBar = (file: ContentFile | null) => {
    if (!file || file.storageType === FileStorageType.External || !file.isDownloadable) {
      return null;
    }

    const isMemberLoggedIn = Boolean(currentUser && currentUser.isActive);
    const isBusy = downloadingFileId === file.id;

    return (
      <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3.5 sm:px-5 shadow-[var(--shadow-card)] space-y-2.5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2.5">
            <Button
              variant="primary"
              size="sm"
              disabled={isBusy}
              onClick={() => void handleDownloadFile(file)}
              startIcon={isMemberLoggedIn ? <Download className="w-4 h-4" /> : <Lock className="w-4 h-4" />}
            >
              {isBusy ? t('contentDetail.download.preparing') : t('contentDetail.download.mainButton')}
            </Button>

            {isMemberLoggedIn ? (
              <Button
                variant="outline"
                size="sm"
                disabled={isBusy}
                onClick={() => void handleCopySignedTempLink(file)}
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
    );
  };

  const renderPrimaryPlayer = () => {
    const isMemberLoggedIn = Boolean(currentUser && currentUser.isActive);

    if (item.format === 'Video' || item.format === 'Film') {
      return (
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
          {renderPrimaryDownloadBar(primaryFile)}
        </div>
      );
    }

    if (item.format === 'Audio') {
      return (
        <div className="space-y-3">
          <AudioPlayerBox
            blobUrl={mainMedia?.blobUrl ?? null}
            externalUrl={primaryFile?.externalUrl ?? null}
            title={item.title}
            fileName={primaryFile?.originalFileName}
            sizeBytes={primaryFile?.sizeBytes}
            isLoading={isLoadingMedia}
          />
          {renderPrimaryDownloadBar(primaryFile)}
        </div>
      );
    }

    if (item.format === 'Image') {
      return (
        <div className="space-y-3">
          <ImageZoomViewer
            blobUrl={mainMedia?.blobUrl ?? null}
            externalUrl={primaryFile?.externalUrl ?? null}
            title={item.title}
            fileName={primaryFile?.originalFileName}
            sizeBytes={primaryFile?.sizeBytes}
            isLoading={isLoadingMedia}
          />
          {renderPrimaryDownloadBar(primaryFile)}
        </div>
      );
    }

    if (item.format === 'Pdf' || (primaryFile && isPdfFile(primaryFile))) {
      return (
        <div className="space-y-3">
          <PdfLocalViewer
            bytes={mainMedia?.bytes ?? null}
            blobUrl={mainMedia?.blobUrl ?? null}
            externalUrl={primaryFile?.externalUrl ?? null}
            title={item.title}
            fileName={primaryFile?.originalFileName}
            sizeBytes={primaryFile?.sizeBytes}
            isLoading={isLoadingMedia}
          />
          {renderPrimaryDownloadBar(primaryFile)}
        </div>
      );
    }

    if (item.format === 'Presentation') {
      return (
        <div className="space-y-4">
          {previewPdfFile && (
            <div className="space-y-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-sm sm:text-base font-bold text-[var(--color-text)]">
                  {t('contentDetail.presentation.previewHeading')}
                </h2>
                {previewPdfFile.storageType === FileStorageType.Local &&
                  previewPdfFile.isDownloadable && (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={downloadingFileId === previewPdfFile.id}
                      onClick={() => void handleDownloadFile(previewPdfFile)}
                      startIcon={
                        isMemberLoggedIn ? (
                          <Download className="w-4 h-4" />
                        ) : (
                          <Lock className="w-4 h-4" />
                        )
                      }
                    >
                      {t('contentDetail.download.previewButton')}
                    </Button>
                  )}
              </div>
              <PdfLocalViewer
                bytes={previewPdfMedia?.bytes ?? null}
                blobUrl={previewPdfMedia?.blobUrl ?? null}
                externalUrl={previewPdfFile.externalUrl}
                title={item.title}
                fileName={previewPdfFile.originalFileName}
                sizeBytes={previewPdfFile.sizeBytes}
                isLoading={isLoadingMedia}
              />
            </div>
          )}
          {primaryFile ? (
            <DocumentAttachmentCard
              file={primaryFile}
              variant="presentation"
              isMemberLoggedIn={isMemberLoggedIn}
              onDownload={(f) => void handleDownloadFile(f)}
              isDownloading={downloadingFileId === primaryFile.id}
            />
          ) : (
            <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface-alt)] p-6 text-center text-sm text-[var(--color-muted)]">
              {t('contentDetail.player.noMedia')}
            </div>
          )}
        </div>
      );
    }

    if (item.format === 'Article') {
      return null;
    }

    // Book or other document formats (.doc, .docx, .xlsx, .zip)
    if (primaryFile) {
      return (
        <DocumentAttachmentCard
          file={primaryFile}
          variant="document"
          isMemberLoggedIn={isMemberLoggedIn}
          onDownload={(f) => void handleDownloadFile(f)}
          isDownloading={downloadingFileId === primaryFile.id}
        />
      );
    }

    return null;
  };

  const ageTargetsDisplay =
    detail.targetAgeGroups.length > 0
      ? detail.targetAgeGroups
          .map((ag) => ag.name)
          .join(t('homePreview.targetListSeparator'))
      : t('contentDetail.meta.allAges');

  return (
    <MainLayout currentRoute={currentRoute}>
      <div className="max-w-5xl mx-auto px-3 sm:px-6 lg:px-8 py-5 sm:py-8 space-y-6 sm:space-y-8">
        {/* Breadcrumb */}
        <Breadcrumb
          items={breadcrumbItems}
          ariaLabel={t('catalog.breadcrumb.ariaLabel')}
        />

        {/* Hero Header Card */}
        <header className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-card)] shadow-[var(--shadow-card)] p-5 sm:p-8 space-y-4">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs sm:text-sm text-[var(--color-muted)] tabular-nums-strict">
            <span className="font-semibold text-[var(--color-primary)]">{t(formatKey)}</span>
            <span aria-hidden="true">·</span>
            <span>
              {t('contentDetail.meta.publishedAt')}: {formatJalaliDatePersian(item.publishedAt ?? item.createdAt)}
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
            {typeof item.readWatchMinutes === 'number' && item.readWatchMinutes > 0 && (
              <>
                <span aria-hidden="true">·</span>
                <span className="inline-flex items-center gap-1">
                  <Clock className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                  <span>
                    {t('contentDetail.meta.duration', {
                      minutes: toPersianDigits(item.readWatchMinutes),
                    })}
                  </span>
                </span>
              </>
            )}
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
                  startIcon={
                    <Heart
                      className={`w-4 h-4 ${liked ? 'fill-current' : ''}`}
                    />
                  }
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
                    <Bookmark
                      className={`w-4 h-4 ${bookmarked ? 'fill-current' : ''}`}
                    />
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
                      `/account/login?returnUrl=${encodeURIComponent(buildContentReturnPath())}`,
                    )
                  }
                >
                  {t('contentDetail.interaction.loginLinkAction')}
                </Button>
              </div>
            )}
          </div>
        </header>

        {/* Primary Format Player / Viewer */}
        {renderPrimaryPlayer()}

        {/* Article / Supplemental Sanitized HTML Body */}
        {detail.sanitizedBodyHtml && (
          <section className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-card)] shadow-[var(--shadow-card)] p-5 sm:p-8 space-y-4">
            <h2 className="text-base sm:text-lg font-bold text-[var(--color-text)] pb-3 border-b border-[var(--color-border)]">
              {t('contentDetail.article.title')}
            </h2>
            <SanitizedArticleBody html={detail.sanitizedBodyHtml} />
          </section>
        )}

        {/* Attachment Files (when present) */}
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
                  isMemberLoggedIn={Boolean(currentUser && currentUser.isActive)}
                  onDownload={(f) => void handleDownloadFile(f)}
                  isDownloading={downloadingFileId === att.id}
                  buttonLabelKey="contentDetail.download.attachmentButton"
                />
              ))}
            </div>
          </section>
        )}

        {/* Prominent Verified Sources Box (Always Visible) */}
        <section
          aria-labelledby="verified-sources-heading"
          className="bg-[var(--color-surface-alt)] border border-[var(--color-border-strong)] rounded-[var(--radius-card)] p-5 sm:p-7 space-y-4"
        >
          <div className="flex items-start gap-3 pb-3 border-b border-[var(--color-border)]">
            <div className="w-10 h-10 rounded-[var(--radius-control)] bg-[var(--color-surface)] border border-[var(--color-border)] flex items-center justify-center shrink-0">
              <BookMarked className="w-5 h-5 text-[var(--color-primary)]" aria-hidden="true" />
            </div>
            <div className="space-y-1">
              <h2
                id="verified-sources-heading"
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

        {/* Related Contents (Max 6; completely hidden when empty per Section 4) */}
        {detail.relatedContents.length > 0 && (
          <section className="space-y-4 pt-2">
            <div className="flex items-center gap-2">
              <BookOpen className="w-5 h-5 text-[var(--color-primary)] shrink-0" aria-hidden="true" />
              <div>
                <h2 className="text-lg sm:text-xl font-bold text-[var(--color-text)]">
                  {t('contentDetail.related.title')}
                </h2>
                <p className="text-xs sm:text-sm text-[var(--color-muted)]">
                  {t('contentDetail.related.subtitle')}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5 items-stretch">
              {detail.relatedContents.map((rel) => {
                const relFormatKey = `catalog.format.${rel.item.format}` as ResourceKey;
                return (
                  <ContentCard
                    key={rel.item.id}
                    title={rel.item.title}
                    formatLabel={t(relFormatKey)}
                    durationMinutes={rel.item.readWatchMinutes ?? 0}
                    topicLabel={rel.primaryTopicName ?? t('catalog.generalTopic')}
                    summary={rel.item.summary}
                    thumbnailUrl={relatedThumbUrls[rel.item.id]}
                    thumbnailAlt={rel.item.title}
                    onSelect={() =>
                      navigateToHash(`/content/${encodeURIComponent(rel.item.slug)}`)
                    }
                  />
                );
              })}
            </div>
          </section>
        )}

        {/* Comments Section (Automatically hidden when FeatureFlag('Comments') is disabled) */}
        <ContentCommentsSection
          contentId={detail.item.id}
          contentSlug={detail.item.slug}
        />

        {/* Back to Content Bank */}
        <div className="pt-2">
          <Button
            variant="outline"
            onClick={() => navigateToHash('/content')}
            startIcon={<ArrowRight className="w-4 h-4" />}
          >
            {t('contentDetail.meta.backToBank')}
          </Button>
        </div>
      </div>
    </MainLayout>
  );
}
