import {
  ArrowDown,
  ArrowUp,
  Edit3,
  ExternalLink,
  Eye,
  EyeOff,
  FileText,
  Image as ImageIcon,
  Layers,
  Megaphone,
  Plus,
  Power,
  Trash2,
  Upload,
} from 'lucide-react';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
} from 'react';
import {
  HOME_SHELF_TYPES,
  MAX_ANNOUNCEMENT_LINK_URL,
  MAX_ANNOUNCEMENT_TEXT,
  MAX_HERO_SLIDE_LINK_URL,
  MAX_HERO_SLIDE_SUBTITLE,
  MAX_HERO_SLIDE_TITLE,
  MAX_HOME_SHELF_TITLE,
  MAX_STATIC_PAGE_SLUG,
  MAX_STATIC_PAGE_TITLE,
  type AnnouncementComputedStatus,
  type AnnouncementItem,
  type HeroSlide,
  type HomeShelf,
  type HomeShelfType,
  type StaticPage,
} from '../../../core/domain/layout';
import type { AgeGroup, Topic } from '../../../core/domain/taxonomy';
import type { AdminAnnouncementRow } from '../../../core/services/announcementService';
import {
  dateToJalali,
  formatJalaliDate,
  getTodayJalali,
  jalaliToGregorian,
  parseJalaliInput,
} from '../../../core/services/jalaliCalendarService';
import type { TopicTreeNode } from '../../../core/services/taxonomyService';
import { useAuth } from '../../auth/AuthContext';
import {
  Alert,
  Button,
  FormField,
  JalaliDatePicker,
  Modal,
  Tag,
  type SelectOption,
} from '../../components/ui';
import type { ResourceKey } from '../../resources/fa';
import { toPersianDigits } from '../../resources/formatters';
import { t } from '../../resources/i18n';
import { appContainer } from '../../services/appContainer';
import { AdminLayout } from '../AdminLayout';

export interface AdminLayoutPageProps {
  currentRoute: string;
}

type LayoutTabKey = 'slides' | 'shelves' | 'pages' | 'announcements';

const HOUR_OPTIONS: readonly string[] = Array.from({ length: 24 }, (_, h) =>
  String(h).padStart(2, '0'),
);
const MINUTE_OPTIONS: readonly string[] = Array.from({ length: 60 }, (_, m) =>
  String(m).padStart(2, '0'),
);

function padTwoDigits(val: number): string {
  return String(val).padStart(2, '0');
}

function formatAnnouncementJalaliDateTime(isoTimestamp: string): string {
  const d = new Date(isoTimestamp);
  if (Number.isNaN(d.getTime())) {
    return '—';
  }
  const j = dateToJalali(d, false);
  const dateStr = formatJalaliDate(j.jy, j.jm, j.jd, true);
  const timeStr = toPersianDigits(
    `${padTwoDigits(d.getHours())}:${padTwoDigits(d.getMinutes())}`,
  );
  return `${dateStr} · ${timeStr}`;
}

function splitIsoToJalaliAndTime(isoTimestamp: string): {
  jalaliDate: string;
  hour: string;
  minute: string;
} {
  const d = new Date(isoTimestamp);
  if (Number.isNaN(d.getTime())) {
    const today = getTodayJalali(false);
    return {
      jalaliDate: formatJalaliDate(today.jy, today.jm, today.jd, true),
      hour: '00',
      minute: '00',
    };
  }
  const j = dateToJalali(d, false);
  return {
    jalaliDate: formatJalaliDate(j.jy, j.jm, j.jd, true),
    hour: padTwoDigits(d.getHours()),
    minute: padTwoDigits(d.getMinutes()),
  };
}

function combineJalaliAndTimeToIso(
  jalaliDateStr: string,
  hourStr: string,
  minuteStr: string,
): string | null {
  const parsed = parseJalaliInput(jalaliDateStr);
  if (!parsed) {
    return null;
  }
  const hour = Number.parseInt(hourStr, 10);
  const minute = Number.parseInt(minuteStr, 10);
  if (
    !Number.isInteger(hour) ||
    hour < 0 ||
    hour > 23 ||
    !Number.isInteger(minute) ||
    minute < 0 ||
    minute > 59
  ) {
    return null;
  }
  const g = jalaliToGregorian(parsed.jy, parsed.jm, parsed.jd);
  const dt = new Date(g.gy, g.gm - 1, g.gd, hour, minute, 0, 0);
  if (Number.isNaN(dt.getTime())) {
    return null;
  }
  return dt.toISOString();
}

function getAnnouncementStatusVariant(
  status: AnnouncementComputedStatus,
): 'success' | 'primary' | 'neutral' | 'warning' {
  switch (status) {
    case 'ActiveNow':
      return 'success';
    case 'Scheduled':
      return 'primary';
    case 'Expired':
      return 'neutral';
    case 'Disabled':
    default:
      return 'warning';
  }
}

interface FlattenedTopicOption {
  id: number;
  label: string;
}

function buildTopicTreeNodes(
  allTopics: readonly Topic[],
  parentId: number | null = null,
  depth = 0,
): TopicTreeNode[] {
  const children = allTopics
    .filter((item) => item.isActive && item.parentId === parentId)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);
  return children.map((topic) => ({
    topic,
    depth,
    contentCount: 0,
    totalSubtreeContentCount: 0,
    children: buildTopicTreeNodes(allTopics, topic.id, depth + 1),
  }));
}

function flattenTopicTree(
  nodes: readonly TopicTreeNode[],
  depth = 0,
  acc: FlattenedTopicOption[] = [],
): FlattenedTopicOption[] {
  for (const node of nodes) {
    const prefix = depth > 0 ? `${'— '.repeat(depth)}` : '';
    acc.push({ id: node.topic.id, label: `${prefix}${node.topic.name}` });
    if (node.children.length > 0) {
      flattenTopicTree(node.children, depth + 1, acc);
    }
  }
  return acc;
}

export function AdminLayoutPage({ currentRoute }: AdminLayoutPageProps) {
  const { currentUser, isNewsTickerEnabled } = useAuth();
  const [activeTab, setActiveTab] = useState<LayoutTabKey>('slides');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  const [slides, setSlides] = useState<HeroSlide[]>([]);
  const [shelves, setShelves] = useState<HomeShelf[]>([]);
  const [pages, setPages] = useState<StaticPage[]>([]);
  const [announcementRows, setAnnouncementRows] = useState<AdminAnnouncementRow[]>([]);
  const [announcementFlagEnabled, setAnnouncementFlagEnabled] = useState<boolean>(
    isNewsTickerEnabled,
  );
  const [ageGroups, setAgeGroups] = useState<AgeGroup[]>([]);
  const [topics, setTopics] = useState<Topic[]>([]);
  const [topicTree, setTopicTree] = useState<TopicTreeNode[]>([]);

  const [slideImageUrls, setSlideImageUrls] = useState<Record<number, string>>({});
  const activeObjectUrlsRef = useRef<string[]>([]);

  const [feedback, setFeedback] = useState<{
    variant: 'success' | 'error';
    message: string;
  } | null>(null);

  // Modals
  const [slideModal, setSlideModal] = useState<{
    mode: 'create' | 'edit';
    editingId?: number;
    existingImageKey: string | null;
    title: string;
    subtitle: string;
    linkUrl: string;
    ageGroupId: string;
    sortOrder: string;
    isActive: boolean;
    uploadedImage: { originalFileName: string; bytes: Uint8Array } | null;
    previewUrl: string | null;
    removeImage: boolean;
  } | null>(null);
  const slideImageInputRef = useRef<HTMLInputElement | null>(null);

  const [shelfModal, setShelfModal] = useState<{
    mode: 'create' | 'edit';
    editingId?: number;
    title: string;
    type: HomeShelfType;
    topicId: string;
    sortOrder: string;
    isVisible: boolean;
  } | null>(null);

  const [pageModal, setPageModal] = useState<{
    mode: 'create' | 'edit';
    editingId?: number;
    title: string;
    slug: string;
    body: string;
    showInFooter: boolean;
    sortOrder: string;
  } | null>(null);

  const [announcementModal, setAnnouncementModal] = useState<{
    mode: 'create' | 'edit';
    editingId?: number;
    text: string;
    linkUrl: string;
    startDate: string;
    startHour: string;
    startMinute: string;
    endDate: string;
    endHour: string;
    endMinute: string;
    priority: string;
    isActive: boolean;
  } | null>(null);
  const [announcementModalError, setAnnouncementModalError] = useState<string | null>(
    null,
  );

  const [deleteTarget, setDeleteTarget] = useState<{
    kind: 'slide' | 'shelf' | 'page' | 'announcement';
    id: number;
    label: string;
  } | null>(null);

  const revokeLoadedUrls = useCallback(() => {
    for (const url of activeObjectUrlsRef.current) {
      URL.revokeObjectURL(url);
    }
    activeObjectUrlsRef.current = [];
  }, []);

  const loadAll = useCallback(async () => {
    if (!currentUser) {
      return;
    }
    setIsLoading(true);
    try {
      await appContainer.ensureInitializedAtStartup();
      const [
        slidesRes,
        shelvesRes,
        pagesRes,
        announcementsRes,
        loadedAges,
        loadedTopics,
      ] = await Promise.all([
        appContainer.layoutManagementService.listHeroSlidesAdmin(currentUser),
        appContainer.layoutManagementService.listHomeShelvesAdmin(currentUser),
        appContainer.layoutManagementService.listStaticPagesAdmin(currentUser),
        appContainer.announcementService.listAdminAnnouncementsAsync(currentUser),
        appContainer.taxonomyRepository.getAllAgeGroups(),
        appContainer.taxonomyRepository.getAllTopics(),
      ]);

      if (slidesRes.ok && slidesRes.data) {
        setSlides(slidesRes.data);
        revokeLoadedUrls();
        const nextUrls: Record<number, string> = {};
        await Promise.all(
          slidesRes.data.map(async (slide) => {
            if (!slide.imageKey) {
              return;
            }
            const media = await appContainer.fileUploadService.openPublicMediaAsync(
              slide.imageKey,
            );
            if (!media.ok || !media.bytes || !media.metadata) {
              return;
            }
            const copy = new Uint8Array(media.bytes.byteLength);
            copy.set(media.bytes);
            const blob = new Blob([copy.buffer], { type: media.metadata.mimeType });
            const url = URL.createObjectURL(blob);
            activeObjectUrlsRef.current.push(url);
            nextUrls[slide.id] = url;
          }),
        );
        setSlideImageUrls(nextUrls);
      }

      if (shelvesRes.ok && shelvesRes.data) {
        setShelves(shelvesRes.data);
      }
      if (pagesRes.ok && pagesRes.data) {
        setPages(pagesRes.data);
      }
      if (announcementsRes.ok && announcementsRes.data) {
        setAnnouncementRows(announcementsRes.data.rows);
        setAnnouncementFlagEnabled(announcementsRes.data.isFeatureEnabled);
      }

      setAgeGroups(
        loadedAges
          .filter((g) => g.isActive)
          .sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id),
      );
      setTopics(loadedTopics);
      setTopicTree(buildTopicTreeNodes(loadedTopics));
    } finally {
      setIsLoading(false);
    }
  }, [currentUser, revokeLoadedUrls]);

  useEffect(() => {
    void loadAll();
    return () => {
      revokeLoadedUrls();
    };
  }, [loadAll, revokeLoadedUrls]);

  const ageGroupById = useMemo(
    () => new Map<number, AgeGroup>(ageGroups.map((g) => [g.id, g])),
    [ageGroups],
  );

  const topicById = useMemo(
    () => new Map<number, Topic>(topics.map((item) => [item.id, item])),
    [topics],
  );

  const flattenedTopics = useMemo(
    () => flattenTopicTree(topicTree),
    [topicTree],
  );

  const shelfTypeOptions: SelectOption[] = useMemo(
    () =>
      HOME_SHELF_TYPES.map((type) => ({
        value: type,
        label: t(`admin.layout.shelves.type.${type}` as ResourceKey),
      })),
    [],
  );

  const topicSelectOptions: SelectOption[] = useMemo(
    () => [
      { value: '', label: t('admin.layout.shelves.topicPlaceholder') },
      ...flattenedTopics.map((item) => ({
        value: String(item.id),
        label: item.label,
      })),
    ],
    [flattenedTopics],
  );

  // ==================== Slide Handlers ====================

  const openCreateSlide = () => {
    setFeedback(null);
    const nextSort = slides.reduce((max, s) => Math.max(max, s.sortOrder), 0) + 1;
    setSlideModal({
      mode: 'create',
      existingImageKey: null,
      title: '',
      subtitle: '',
      linkUrl: '#/content',
      ageGroupId: '',
      sortOrder: String(nextSort),
      isActive: true,
      uploadedImage: null,
      previewUrl: null,
      removeImage: false,
    });
  };

  const openEditSlide = (slide: HeroSlide) => {
    setFeedback(null);
    setSlideModal({
      mode: 'edit',
      editingId: slide.id,
      existingImageKey: slide.imageKey,
      title: slide.title,
      subtitle: slide.subtitle,
      linkUrl: slide.linkUrl,
      ageGroupId: slide.ageGroupId !== null ? String(slide.ageGroupId) : '',
      sortOrder: String(slide.sortOrder),
      isActive: slide.isActive,
      uploadedImage: null,
      previewUrl: slideImageUrls[slide.id] ?? null,
      removeImage: false,
    });
  };

  const handleSlideFileChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !slideModal) {
      return;
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    const previewUrl = URL.createObjectURL(file);
    setSlideModal((prev) =>
      prev
        ? {
            ...prev,
            uploadedImage: { originalFileName: file.name, bytes },
            previewUrl,
            removeImage: false,
          }
        : null,
    );
  };

  const handleSaveSlide = async (e: FormEvent) => {
    e.preventDefault();
    if (!currentUser || !slideModal) {
      return;
    }
    setIsSaving(true);
    setFeedback(null);
    try {
      const parsedAge =
        slideModal.ageGroupId.trim() !== ''
          ? Number.parseInt(slideModal.ageGroupId, 10)
          : null;
      const parsedSort = Number.parseInt(slideModal.sortOrder, 10);

      const res = await appContainer.layoutManagementService.saveHeroSlide(currentUser, {
        id: slideModal.editingId,
        title: slideModal.title,
        subtitle: slideModal.subtitle,
        linkUrl: slideModal.linkUrl,
        ageGroupId: Number.isInteger(parsedAge) ? parsedAge : null,
        sortOrder: Number.isFinite(parsedSort) && parsedSort >= 0 ? parsedSort : undefined,
        isActive: slideModal.isActive,
        uploadedImage: slideModal.uploadedImage,
        removeImage: slideModal.removeImage,
      });

      if (!res.ok) {
        setFeedback({
          variant: 'error',
          message: t((res.messageKey ?? 'admin.layout.error.notFound') as ResourceKey),
        });
        return;
      }

      setSlideModal(null);
      setFeedback({
        variant: 'success',
        message: t('admin.layout.feedback.slideSaved'),
      });
      await loadAll();
    } finally {
      setIsSaving(false);
    }
  };

  const handleMoveSlide = async (id: number, direction: 'up' | 'down') => {
    if (!currentUser) {
      return;
    }
    setIsSaving(true);
    setFeedback(null);
    try {
      const res = await appContainer.layoutManagementService.moveHeroSlide(
        currentUser,
        id,
        direction,
      );
      if (res.ok) {
        setFeedback({
          variant: 'success',
          message: t('admin.layout.feedback.slideReordered'),
        });
        await loadAll();
      }
    } finally {
      setIsSaving(false);
    }
  };

  const handleToggleSlide = async (slide: HeroSlide) => {
    if (!currentUser) {
      return;
    }
    setIsSaving(true);
    setFeedback(null);
    try {
      const res = await appContainer.layoutManagementService.toggleHeroSlideActive(
        currentUser,
        slide.id,
        !slide.isActive,
      );
      if (res.ok) {
        setFeedback({
          variant: 'success',
          message: t('admin.layout.feedback.slideSaved'),
        });
        await loadAll();
      }
    } finally {
      setIsSaving(false);
    }
  };

  // ==================== Shelf Handlers ====================

  const openCreateShelf = () => {
    setFeedback(null);
    const nextSort = shelves.reduce((max, s) => Math.max(max, s.sortOrder), 0) + 1;
    setShelfModal({
      mode: 'create',
      title: '',
      type: 'Latest',
      topicId: flattenedTopics[0] ? String(flattenedTopics[0].id) : '',
      sortOrder: String(nextSort),
      isVisible: true,
    });
  };

  const openEditShelf = (shelf: HomeShelf) => {
    setFeedback(null);
    setShelfModal({
      mode: 'edit',
      editingId: shelf.id,
      title: shelf.title,
      type: shelf.type,
      topicId: shelf.topicId !== null ? String(shelf.topicId) : '',
      sortOrder: String(shelf.sortOrder),
      isVisible: shelf.isVisible,
    });
  };

  const handleSaveShelf = async (e: FormEvent) => {
    e.preventDefault();
    if (!currentUser || !shelfModal) {
      return;
    }
    setIsSaving(true);
    setFeedback(null);
    try {
      const parsedTopic =
        shelfModal.type === 'ByTopic' && shelfModal.topicId.trim() !== ''
          ? Number.parseInt(shelfModal.topicId, 10)
          : null;
      const parsedSort = Number.parseInt(shelfModal.sortOrder, 10);

      const res = await appContainer.layoutManagementService.saveHomeShelf(currentUser, {
        id: shelfModal.editingId,
        title: shelfModal.title,
        type: shelfModal.type,
        topicId: parsedTopic,
        sortOrder: Number.isFinite(parsedSort) && parsedSort >= 0 ? parsedSort : undefined,
        isVisible: shelfModal.isVisible,
      });

      if (!res.ok) {
        setFeedback({
          variant: 'error',
          message: t((res.messageKey ?? 'admin.layout.error.notFound') as ResourceKey),
        });
        return;
      }

      setShelfModal(null);
      setFeedback({
        variant: 'success',
        message: t('admin.layout.feedback.shelfSaved'),
      });
      await loadAll();
    } finally {
      setIsSaving(false);
    }
  };

  const handleMoveShelf = async (id: number, direction: 'up' | 'down') => {
    if (!currentUser) {
      return;
    }
    setIsSaving(true);
    setFeedback(null);
    try {
      const res = await appContainer.layoutManagementService.moveHomeShelf(
        currentUser,
        id,
        direction,
      );
      if (res.ok) {
        setFeedback({
          variant: 'success',
          message: t('admin.layout.feedback.shelfReordered'),
        });
        await loadAll();
      }
    } finally {
      setIsSaving(false);
    }
  };

  const handleToggleShelf = async (shelf: HomeShelf) => {
    if (!currentUser) {
      return;
    }
    setIsSaving(true);
    setFeedback(null);
    try {
      const res = await appContainer.layoutManagementService.toggleHomeShelfVisible(
        currentUser,
        shelf.id,
        !shelf.isVisible,
      );
      if (res.ok) {
        setFeedback({
          variant: 'success',
          message: t('admin.layout.feedback.shelfSaved'),
        });
        await loadAll();
      }
    } finally {
      setIsSaving(false);
    }
  };

  // ==================== Static Page Handlers ====================

  const openCreatePage = () => {
    setFeedback(null);
    const nextSort = pages.reduce((max, p) => Math.max(max, p.sortOrder), 0) + 1;
    setPageModal({
      mode: 'create',
      title: '',
      slug: '',
      body: '',
      showInFooter: true,
      sortOrder: String(nextSort),
    });
  };

  const openEditPage = (page: StaticPage) => {
    setFeedback(null);
    setPageModal({
      mode: 'edit',
      editingId: page.id,
      title: page.title,
      slug: page.slug,
      body: page.body,
      showInFooter: page.showInFooter,
      sortOrder: String(page.sortOrder),
    });
  };

  const handleSavePage = async (e: FormEvent) => {
    e.preventDefault();
    if (!currentUser || !pageModal) {
      return;
    }
    setIsSaving(true);
    setFeedback(null);
    try {
      const parsedSort = Number.parseInt(pageModal.sortOrder, 10);
      const res = await appContainer.layoutManagementService.saveStaticPage(currentUser, {
        id: pageModal.editingId,
        title: pageModal.title,
        slug: pageModal.slug,
        body: pageModal.body,
        showInFooter: pageModal.showInFooter,
        sortOrder: Number.isFinite(parsedSort) && parsedSort >= 0 ? parsedSort : undefined,
      });

      if (!res.ok) {
        setFeedback({
          variant: 'error',
          message: t((res.messageKey ?? 'admin.layout.error.notFound') as ResourceKey),
        });
        return;
      }

      setPageModal(null);
      window.dispatchEvent(new Event('meraj:footer-pages-changed'));
      setFeedback({
        variant: 'success',
        message: t('admin.layout.feedback.pageSaved'),
      });
      await loadAll();
    } finally {
      setIsSaving(false);
    }
  };

  // ==================== Announcement Handlers ====================

  const openCreateAnnouncement = () => {
    setFeedback(null);
    setAnnouncementModalError(null);
    const nowDate = appContainer.clock.now();
    const startParts = splitIsoToJalaliAndTime(nowDate.toISOString());
    const endDateObj = new Date(nowDate.getTime() + 7 * 24 * 60 * 60 * 1000);
    const endParts = splitIsoToJalaliAndTime(endDateObj.toISOString());

    setAnnouncementModal({
      mode: 'create',
      text: '',
      linkUrl: '',
      startDate: startParts.jalaliDate,
      startHour: '00',
      startMinute: '00',
      endDate: endParts.jalaliDate,
      endHour: '23',
      endMinute: '59',
      priority: toPersianDigits(10),
      isActive: true,
    });
  };

  const openEditAnnouncement = (item: AnnouncementItem) => {
    setFeedback(null);
    setAnnouncementModalError(null);
    const startParts = splitIsoToJalaliAndTime(item.startsAt);
    const endParts = splitIsoToJalaliAndTime(item.endsAt);

    setAnnouncementModal({
      mode: 'edit',
      editingId: item.id,
      text: item.text,
      linkUrl: item.linkUrl ?? '',
      startDate: startParts.jalaliDate,
      startHour: startParts.hour,
      startMinute: startParts.minute,
      endDate: endParts.jalaliDate,
      endHour: endParts.hour,
      endMinute: endParts.minute,
      priority: toPersianDigits(item.priority),
      isActive: item.isActive,
    });
  };

  const handleSaveAnnouncement = async (e: FormEvent) => {
    e.preventDefault();
    if (!currentUser || !announcementModal) {
      return;
    }

    const startsAtIso = combineJalaliAndTimeToIso(
      announcementModal.startDate,
      announcementModal.startHour,
      announcementModal.startMinute,
    );
    const endsAtIso = combineJalaliAndTimeToIso(
      announcementModal.endDate,
      announcementModal.endHour,
      announcementModal.endMinute,
    );

    if (!startsAtIso || !endsAtIso) {
      setAnnouncementModalError(t('admin.layout.announcements.error.invalidDate'));
      return;
    }

    setIsSaving(true);
    setFeedback(null);
    setAnnouncementModalError(null);
    try {
      const res = await appContainer.announcementService.saveAnnouncementAsync(
        currentUser,
        {
          id: announcementModal.editingId,
          text: announcementModal.text,
          linkUrl: announcementModal.linkUrl,
          startsAt: startsAtIso,
          endsAt: endsAtIso,
          priority: announcementModal.priority,
          isActive: announcementModal.isActive,
        },
      );

      if (!res.ok) {
        const errMsg = t(
          (res.messageKey ?? 'admin.layout.error.notFound') as ResourceKey,
        );
        setAnnouncementModalError(errMsg);
        return;
      }

      setAnnouncementModal(null);
      window.dispatchEvent(new Event('meraj:announcements-changed'));
      setFeedback({
        variant: 'success',
        message: t('admin.layout.feedback.announcementSaved'),
      });
      await loadAll();
    } finally {
      setIsSaving(false);
    }
  };

  const handleToggleAnnouncement = async (item: AnnouncementItem) => {
    if (!currentUser) {
      return;
    }
    setIsSaving(true);
    setFeedback(null);
    try {
      const res =
        await appContainer.announcementService.toggleAnnouncementActiveAsync(
          currentUser,
          item.id,
          !item.isActive,
        );
      if (res.ok) {
        window.dispatchEvent(new Event('meraj:announcements-changed'));
        setFeedback({
          variant: 'success',
          message: t('admin.layout.feedback.announcementSaved'),
        });
        await loadAll();
      }
    } finally {
      setIsSaving(false);
    }
  };

  // ==================== Delete Handler ====================

  const handleConfirmDelete = async () => {
    if (!currentUser || !deleteTarget) {
      return;
    }
    setIsSaving(true);
    setFeedback(null);
    try {
      if (deleteTarget.kind === 'slide') {
        const res = await appContainer.layoutManagementService.deleteHeroSlide(
          currentUser,
          deleteTarget.id,
        );
        if (res.ok) {
          setFeedback({
            variant: 'success',
            message: t('admin.layout.feedback.slideDeleted'),
          });
        }
      } else if (deleteTarget.kind === 'shelf') {
        const res = await appContainer.layoutManagementService.deleteHomeShelf(
          currentUser,
          deleteTarget.id,
        );
        if (res.ok) {
          setFeedback({
            variant: 'success',
            message: t('admin.layout.feedback.shelfDeleted'),
          });
        }
      } else if (deleteTarget.kind === 'page') {
        const res = await appContainer.layoutManagementService.deleteStaticPage(
          currentUser,
          deleteTarget.id,
        );
        if (res.ok) {
          window.dispatchEvent(new Event('meraj:footer-pages-changed'));
          setFeedback({
            variant: 'success',
            message: t('admin.layout.feedback.pageDeleted'),
          });
        }
      } else {
        const res =
          await appContainer.announcementService.deleteAnnouncementAsync(
            currentUser,
            deleteTarget.id,
          );
        if (res.ok) {
          window.dispatchEvent(new Event('meraj:announcements-changed'));
          setFeedback({
            variant: 'success',
            message: t('admin.layout.feedback.announcementDeleted'),
          });
        }
      }
      setDeleteTarget(null);
      await loadAll();
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <AdminLayout currentRoute={currentRoute}>
      <div className="space-y-6">
        <header className="space-y-2 border-b border-[var(--color-border)] pb-4">
          <div className="flex items-center gap-2 text-xs font-semibold text-[var(--color-primary)]">
            <Layers className="w-4 h-4 shrink-0" aria-hidden="true" />
            <span>{t('admin.nav.layout')}</span>
          </div>
          <h1 className="text-xl sm:text-2xl font-bold text-[var(--color-text)]">
            {t('admin.layout.title')}
          </h1>
          <p className="text-xs sm:text-sm text-[var(--color-muted)]">
            {t('admin.layout.subtitle')}
          </p>
        </header>

        {feedback && (
          <Alert
            variant={feedback.variant}
            message={feedback.message}
            onDismiss={() => setFeedback(null)}
          />
        )}

        {/* Navigation Tabs */}
        <div
          role="tablist"
          aria-label={t('admin.layout.tabs.ariaLabel')}
          className="flex flex-wrap gap-2 border-b border-[var(--color-border)] pb-3"
        >
          {(
            [
              { key: 'slides', label: t('admin.layout.tab.slides'), icon: ImageIcon },
              { key: 'shelves', label: t('admin.layout.tab.shelves'), icon: Layers },
              { key: 'pages', label: t('admin.layout.tab.pages'), icon: FileText },
              {
                key: 'announcements',
                label: t('admin.layout.tab.announcements'),
                icon: Megaphone,
              },
            ] as const
          ).map((tab) => {
            const Icon = tab.icon;
            const isSelected = activeTab === tab.key;
            return (
              <button
                key={tab.key}
                type="button"
                role="tab"
                aria-selected={isSelected}
                onClick={() => {
                  setActiveTab(tab.key);
                  setFeedback(null);
                }}
                className={`inline-flex items-center gap-2 min-h-[40px] px-4 py-2 rounded-[var(--radius-control)] text-xs sm:text-sm font-semibold border transition-colors ${
                  isSelected
                    ? 'bg-[var(--color-primary)] text-[var(--color-on-primary)] border-transparent'
                    : 'bg-[var(--color-surface)] text-[var(--color-text)] border-[var(--color-border)] hover:bg-[var(--color-surface-alt)]'
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" aria-hidden="true" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>

        {/* Tab 1: Hero Slides */}
        {activeTab === 'slides' && (
          <section className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-base sm:text-lg font-bold text-[var(--color-text)] tabular-nums-strict">
                {t('admin.layout.slides.sectionTitle', {
                  count: toPersianDigits(slides.length),
                })}
              </h2>
              <Button
                variant="primary"
                onClick={openCreateSlide}
                startIcon={<Plus className="w-4 h-4" />}
              >
                {t('admin.layout.slides.addButton')}
              </Button>
            </div>

            {isLoading ? (
              <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-card)] p-6 text-center text-sm text-[var(--color-muted)]">
                {t('home.page.loading')}
              </div>
            ) : slides.length === 0 ? (
              <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-card)] p-8 text-center space-y-2">
                <h3 className="text-base font-bold text-[var(--color-text)]">
                  {t('admin.layout.slides.emptyTitle')}
                </h3>
                <p className="text-xs sm:text-sm text-[var(--color-muted)]">
                  {t('admin.layout.slides.emptyBody')}
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {slides.map((slide, idx) => {
                  const previewUrl = slideImageUrls[slide.id];
                  const targetAge =
                    slide.ageGroupId !== null
                      ? ageGroupById.get(slide.ageGroupId)?.name ??
                        t('admin.layout.slides.allAgesLabel')
                      : t('admin.layout.slides.allAgesLabel');

                  return (
                    <div
                      key={slide.id}
                      className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-card)] p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-4"
                    >
                      <div className="flex flex-col sm:flex-row sm:items-center gap-4 min-w-0 flex-1">
                        <div className="w-full sm:w-36 h-20 rounded-[var(--radius-control)] border border-[var(--color-border)] bg-[var(--color-surface-alt)] overflow-hidden shrink-0 flex items-center justify-center">
                          {previewUrl ? (
                            <img
                              src={previewUrl}
                              alt={slide.title}
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <span className="text-[11px] text-[var(--color-muted)] text-center px-2">
                              {t('admin.layout.slides.noImagePlaceholder')}
                            </span>
                          )}
                        </div>

                        <div className="space-y-1.5 min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <Tag
                              label={
                                slide.isActive
                                  ? t('admin.layout.slides.activeBadge')
                                  : t('admin.layout.slides.inactiveBadge')
                              }
                              variant={slide.isActive ? 'success' : 'warning'}
                            />
                            <Tag label={targetAge} variant="neutral" />
                            <Tag
                              label={t('admin.layout.slides.sortBadge', {
                                order: toPersianDigits(slide.sortOrder),
                              })}
                              variant="accent"
                            />
                          </div>

                          <h3 className="text-sm sm:text-base font-bold text-[var(--color-text)] truncate">
                            {slide.title}
                          </h3>
                          {slide.subtitle && (
                            <p className="text-xs text-[var(--color-muted)] line-clamp-2">
                              {slide.subtitle}
                            </p>
                          )}
                          <p dir="ltr" className="text-xs font-mono text-[var(--color-primary)] truncate text-right">
                            {slide.linkUrl}
                          </p>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-2 shrink-0">
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={isSaving || idx === 0}
                          onClick={() => void handleMoveSlide(slide.id, 'up')}
                          startIcon={<ArrowUp className="w-3.5 h-3.5" />}
                        >
                          {t('admin.layout.slides.moveUp')}
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={isSaving || idx === slides.length - 1}
                          onClick={() => void handleMoveSlide(slide.id, 'down')}
                          startIcon={<ArrowDown className="w-3.5 h-3.5" />}
                        >
                          {t('admin.layout.slides.moveDown')}
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={isSaving}
                          onClick={() => void handleToggleSlide(slide)}
                          startIcon={<Power className="w-3.5 h-3.5" />}
                        >
                          {slide.isActive
                            ? t('admin.layout.slides.toggleDisable')
                            : t('admin.layout.slides.toggleEnable')}
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={isSaving}
                          onClick={() => openEditSlide(slide)}
                          startIcon={<Edit3 className="w-3.5 h-3.5" />}
                        >
                          {t('admin.layout.slides.editButton')}
                        </Button>
                        <Button
                          variant="danger"
                          size="sm"
                          disabled={isSaving}
                          onClick={() =>
                            setDeleteTarget({
                              kind: 'slide',
                              id: slide.id,
                              label: slide.title,
                            })
                          }
                          startIcon={<Trash2 className="w-3.5 h-3.5" />}
                        >
                          {t('admin.layout.slides.deleteButton')}
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        )}

        {/* Tab 2: Home Shelves */}
        {activeTab === 'shelves' && (
          <section className="space-y-4">
            <Alert variant="info" message={t('admin.layout.shelves.stage20Note')} />

            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-base sm:text-lg font-bold text-[var(--color-text)] tabular-nums-strict">
                {t('admin.layout.shelves.sectionTitle', {
                  count: toPersianDigits(shelves.length),
                })}
              </h2>
              <Button
                variant="primary"
                onClick={openCreateShelf}
                startIcon={<Plus className="w-4 h-4" />}
              >
                {t('admin.layout.shelves.addButton')}
              </Button>
            </div>

            {shelves.length === 0 ? (
              <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-card)] p-8 text-center space-y-2">
                <h3 className="text-base font-bold text-[var(--color-text)]">
                  {t('admin.layout.shelves.emptyTitle')}
                </h3>
                <p className="text-xs sm:text-sm text-[var(--color-muted)]">
                  {t('admin.layout.shelves.emptyBody')}
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {shelves.map((shelf, idx) => {
                  const topicName =
                    shelf.topicId !== null
                      ? topicById.get(shelf.topicId)?.name ?? ''
                      : '';
                  return (
                    <div
                      key={shelf.id}
                      className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-card)] p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-4"
                    >
                      <div className="space-y-1.5 min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <Tag
                            label={
                              shelf.isVisible
                                ? t('admin.layout.shelves.visibleBadge')
                                : t('admin.layout.shelves.hiddenBadge')
                            }
                            variant={shelf.isVisible ? 'success' : 'warning'}
                          />
                          <Tag
                            label={t(
                              `admin.layout.shelves.type.${shelf.type}` as ResourceKey,
                            )}
                            variant="primary"
                          />
                          {shelf.type === 'Personalized' && (
                            <Tag
                              label={t('admin.layout.shelves.stage20Badge')}
                              variant="warning"
                            />
                          )}
                          {topicName && (
                            <Tag
                              label={t('admin.layout.shelves.topicBadge', {
                                name: topicName,
                              })}
                              variant="neutral"
                            />
                          )}
                          <Tag
                            label={t('admin.layout.slides.sortBadge', {
                              order: toPersianDigits(shelf.sortOrder),
                            })}
                            variant="accent"
                          />
                        </div>

                        <h3 className="text-sm sm:text-base font-bold text-[var(--color-text)]">
                          {shelf.title}
                        </h3>
                      </div>

                      <div className="flex flex-wrap items-center gap-2 shrink-0">
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={isSaving || idx === 0}
                          onClick={() => void handleMoveShelf(shelf.id, 'up')}
                          startIcon={<ArrowUp className="w-3.5 h-3.5" />}
                        >
                          {t('admin.layout.slides.moveUp')}
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={isSaving || idx === shelves.length - 1}
                          onClick={() => void handleMoveShelf(shelf.id, 'down')}
                          startIcon={<ArrowDown className="w-3.5 h-3.5" />}
                        >
                          {t('admin.layout.slides.moveDown')}
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={isSaving}
                          onClick={() => void handleToggleShelf(shelf)}
                          startIcon={
                            shelf.isVisible ? (
                              <EyeOff className="w-3.5 h-3.5" />
                            ) : (
                              <Eye className="w-3.5 h-3.5" />
                            )
                          }
                        >
                          {shelf.isVisible
                            ? t('admin.layout.shelves.hideAction')
                            : t('admin.layout.shelves.showAction')}
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={isSaving}
                          onClick={() => openEditShelf(shelf)}
                          startIcon={<Edit3 className="w-3.5 h-3.5" />}
                        >
                          {t('admin.layout.slides.editButton')}
                        </Button>
                        <Button
                          variant="danger"
                          size="sm"
                          disabled={isSaving}
                          onClick={() =>
                            setDeleteTarget({
                              kind: 'shelf',
                              id: shelf.id,
                              label: shelf.title,
                            })
                          }
                          startIcon={<Trash2 className="w-3.5 h-3.5" />}
                        >
                          {t('admin.layout.slides.deleteButton')}
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        )}

        {/* Tab 3: Static Pages */}
        {activeTab === 'pages' && (
          <section className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-base sm:text-lg font-bold text-[var(--color-text)] tabular-nums-strict">
                {t('admin.layout.pages.sectionTitle', {
                  count: toPersianDigits(pages.length),
                })}
              </h2>
              <Button
                variant="primary"
                onClick={openCreatePage}
                startIcon={<Plus className="w-4 h-4" />}
              >
                {t('admin.layout.pages.addButton')}
              </Button>
            </div>

            {pages.length === 0 ? (
              <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-card)] p-8 text-center space-y-2">
                <h3 className="text-base font-bold text-[var(--color-text)]">
                  {t('admin.layout.pages.emptyTitle')}
                </h3>
                <p className="text-xs sm:text-sm text-[var(--color-muted)]">
                  {t('admin.layout.pages.emptyBody')}
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {pages.map((page) => (
                  <div
                    key={page.id}
                    className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-card)] p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-4"
                  >
                    <div className="space-y-1.5 min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Tag
                          label={
                            page.showInFooter
                              ? t('admin.layout.pages.inFooterBadge')
                              : t('admin.layout.pages.notInFooterBadge')
                          }
                          variant={page.showInFooter ? 'success' : 'neutral'}
                        />
                        <Tag
                          label={t('admin.layout.slides.sortBadge', {
                            order: toPersianDigits(page.sortOrder),
                          })}
                          variant="accent"
                        />
                      </div>

                      <h3 className="text-sm sm:text-base font-bold text-[var(--color-text)]">
                        {page.title}
                      </h3>

                      <div className="flex flex-wrap items-center gap-3 text-xs">
                        <span className="text-[var(--color-muted)]">
                          {t('admin.layout.pages.slugLabel')}:
                        </span>
                        <span dir="ltr" className="font-mono text-[var(--color-primary)]">
                          {`#/p/${page.slug}`}
                        </span>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 shrink-0">
                      <a
                        href={`#/p/${encodeURIComponent(page.slug)}`}
                        className="inline-flex items-center gap-1.5 min-h-[34px] px-3 py-1.5 rounded-[var(--radius-control)] border border-[var(--color-border-strong)] bg-[var(--color-surface)] text-xs font-medium text-[var(--color-text)] hover:bg-[var(--color-surface-alt)] transition-colors"
                      >
                        <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
                        <span>{t('admin.layout.pages.previewLink')}</span>
                      </a>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={isSaving}
                        onClick={() => openEditPage(page)}
                        startIcon={<Edit3 className="w-3.5 h-3.5" />}
                      >
                        {t('admin.layout.slides.editButton')}
                      </Button>
                      <Button
                        variant="danger"
                        size="sm"
                        disabled={isSaving}
                        onClick={() =>
                          setDeleteTarget({
                            kind: 'page',
                            id: page.id,
                            label: page.title,
                          })
                        }
                        startIcon={<Trash2 className="w-3.5 h-3.5" />}
                      >
                        {t('admin.layout.slides.deleteButton')}
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        {/* Tab 4: Announcements / News Ticker */}
        {activeTab === 'announcements' && (
          <section className="space-y-4">
            {!announcementFlagEnabled && (
              <div className="rounded-[var(--radius-card)] border border-[var(--color-warning-border)] bg-[var(--color-warning-bg)] p-4 flex flex-wrap items-center justify-between gap-3">
                <p className="text-xs sm:text-sm text-[var(--color-warning-text)] leading-relaxed">
                  {t('admin.layout.announcements.flagDisabledNotice')}
                </p>
                <a
                  href="#/admin/settings"
                  className="inline-flex items-center gap-1.5 min-h-[34px] px-3 py-1.5 rounded-[var(--radius-control)] border border-[var(--color-border-strong)] bg-[var(--color-surface)] text-xs font-semibold text-[var(--color-text)] hover:bg-[var(--color-surface-alt)] transition-colors whitespace-nowrap"
                >
                  <span>{t('admin.layout.announcements.openSettingsButton')}</span>
                </a>
              </div>
            )}

            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-base sm:text-lg font-bold text-[var(--color-text)] tabular-nums-strict">
                {t('admin.layout.announcements.sectionTitle', {
                  count: toPersianDigits(announcementRows.length),
                })}
              </h2>
              <Button
                variant="primary"
                onClick={openCreateAnnouncement}
                startIcon={<Plus className="w-4 h-4" />}
              >
                {t('admin.layout.announcements.addButton')}
              </Button>
            </div>

            {isLoading ? (
              <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-card)] p-6 text-center text-sm text-[var(--color-muted)]">
                {t('home.page.loading')}
              </div>
            ) : announcementRows.length === 0 ? (
              <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-card)] p-8 text-center space-y-2">
                <h3 className="text-base font-bold text-[var(--color-text)]">
                  {t('admin.layout.announcements.emptyTitle')}
                </h3>
                <p className="text-xs sm:text-sm text-[var(--color-muted)]">
                  {t('admin.layout.announcements.emptyBody')}
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {announcementRows.map(({ item, computedStatus }) => (
                  <div
                    key={item.id}
                    className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-card)] p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-4"
                  >
                    <div className="space-y-2 min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Tag
                          label={t(
                            `admin.layout.announcements.status.${computedStatus}` as ResourceKey,
                          )}
                          variant={getAnnouncementStatusVariant(computedStatus)}
                        />
                        <Tag
                          label={t('admin.layout.announcements.priorityBadge', {
                            priority: toPersianDigits(item.priority),
                          })}
                          variant="accent"
                        />
                        {item.linkUrl && (
                          <Tag
                            label={t('admin.layout.announcements.linkBadge')}
                            variant="neutral"
                          />
                        )}
                      </div>

                      <p className="text-sm sm:text-base font-semibold text-[var(--color-text)] leading-relaxed break-words">
                        {item.text}
                      </p>

                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[var(--color-muted)] tabular-nums-strict">
                        <span>
                          {t('admin.layout.announcements.dateRangeLabel', {
                            start: formatAnnouncementJalaliDateTime(item.startsAt),
                            end: formatAnnouncementJalaliDateTime(item.endsAt),
                          })}
                        </span>
                        {item.linkUrl && (
                          <span dir="ltr" className="font-mono text-[var(--color-primary)] truncate max-w-xs">
                            {item.linkUrl}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 shrink-0">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={isSaving}
                        onClick={() => void handleToggleAnnouncement(item)}
                        startIcon={<Power className="w-3.5 h-3.5" />}
                      >
                        {item.isActive
                          ? t('admin.layout.announcements.toggleDisable')
                          : t('admin.layout.announcements.toggleEnable')}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={isSaving}
                        onClick={() => openEditAnnouncement(item)}
                        startIcon={<Edit3 className="w-3.5 h-3.5" />}
                      >
                        {t('admin.layout.slides.editButton')}
                      </Button>
                      <Button
                        variant="danger"
                        size="sm"
                        disabled={isSaving}
                        onClick={() =>
                          setDeleteTarget({
                            kind: 'announcement',
                            id: item.id,
                            label: item.text,
                          })
                        }
                        startIcon={<Trash2 className="w-3.5 h-3.5" />}
                      >
                        {t('admin.layout.slides.deleteButton')}
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}
      </div>

      {/* Hero Slide Create/Edit Modal */}
      {slideModal && (
        <Modal
          open
          onClose={() => !isSaving && setSlideModal(null)}
          title={
            slideModal.mode === 'create'
              ? t('admin.layout.slides.modalCreateTitle')
              : t('admin.layout.slides.modalEditTitle')
          }
        >
          <form onSubmit={(e) => void handleSaveSlide(e)} className="space-y-4">
            <div className="space-y-1.5">
              <label
                htmlFor="hero-slide-title"
                className="block text-sm font-medium text-[var(--color-text)]"
              >
                {t('admin.layout.slides.titleLabel')}
              </label>
              <input
                id="hero-slide-title"
                type="text"
                required
                maxLength={MAX_HERO_SLIDE_TITLE}
                value={slideModal.title}
                onChange={(e) =>
                  setSlideModal((prev) =>
                    prev ? { ...prev, title: e.target.value } : null,
                  )
                }
                placeholder={t('admin.layout.slides.titlePlaceholder')}
                className="w-full min-h-[42px] px-3 py-2 text-sm rounded-[var(--radius-control)] border border-[var(--color-border-strong)] bg-[var(--color-surface)] text-[var(--color-text)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--color-primary)]"
              />
            </div>

            <div className="space-y-1.5">
              <label
                htmlFor="hero-slide-subtitle"
                className="block text-sm font-medium text-[var(--color-text)]"
              >
                {t('admin.layout.slides.subtitleLabel')}
              </label>
              <textarea
                id="hero-slide-subtitle"
                rows={2}
                maxLength={MAX_HERO_SLIDE_SUBTITLE}
                value={slideModal.subtitle}
                onChange={(e) =>
                  setSlideModal((prev) =>
                    prev ? { ...prev, subtitle: e.target.value } : null,
                  )
                }
                placeholder={t('admin.layout.slides.subtitlePlaceholder')}
                className="w-full px-3 py-2 text-sm rounded-[var(--radius-control)] border border-[var(--color-border-strong)] bg-[var(--color-surface)] text-[var(--color-text)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--color-primary)]"
              />
            </div>

            <div className="space-y-1.5">
              <label
                htmlFor="hero-slide-link"
                className="block text-sm font-medium text-[var(--color-text)]"
              >
                {t('admin.layout.slides.linkLabel')}
              </label>
              <input
                id="hero-slide-link"
                type="text"
                dir="ltr"
                required
                maxLength={MAX_HERO_SLIDE_LINK_URL}
                value={slideModal.linkUrl}
                onChange={(e) =>
                  setSlideModal((prev) =>
                    prev ? { ...prev, linkUrl: e.target.value } : null,
                  )
                }
                placeholder={t('admin.layout.slides.linkPlaceholder')}
                className="w-full min-h-[42px] px-3 py-2 text-sm font-mono text-left rounded-[var(--radius-control)] border border-[var(--color-border-strong)] bg-[var(--color-surface)] text-[var(--color-text)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--color-primary)]"
              />
              <p className="text-xs text-[var(--color-muted)]">
                {t('admin.layout.slides.linkHint')}
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <FormField
                id="hero-slide-age"
                kind="select"
                label={t('admin.layout.slides.ageGroupLabel')}
                value={slideModal.ageGroupId}
                onChange={(value) =>
                  setSlideModal((prev) =>
                    prev ? { ...prev, ageGroupId: value } : null,
                  )
                }
                options={[
                  { value: '', label: t('admin.layout.slides.ageGroupAllOption') },
                  ...ageGroups.map((g) => ({ value: String(g.id), label: g.name })),
                ]}
              />

              <FormField
                id="hero-slide-sort"
                kind="input"
                type="text"
                label={t('admin.layout.slides.sortOrderLabel')}
                value={slideModal.sortOrder}
                onChange={(value) =>
                  setSlideModal((prev) =>
                    prev ? { ...prev, sortOrder: value } : null,
                  )
                }
              />
            </div>

            <div className="space-y-2 p-3.5 rounded-[var(--radius-control)] bg-[var(--color-surface-alt)] border border-[var(--color-border)]">
              <p className="text-sm font-medium text-[var(--color-text)]">
                {t('admin.layout.slides.imageLabel')}
              </p>
              {slideModal.previewUrl && !slideModal.removeImage && (
                <div className="w-full h-36 rounded-[var(--radius-control)] overflow-hidden border border-[var(--color-border)] bg-[var(--color-surface)]">
                  <img
                    src={slideModal.previewUrl}
                    alt={slideModal.title || t('admin.layout.slides.imageLabel')}
                    className="w-full h-full object-cover"
                  />
                </div>
              )}
              <div className="flex flex-wrap items-center gap-2">
                <input
                  ref={slideImageInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={(e) => void handleSlideFileChange(e)}
                  className="hidden"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => slideImageInputRef.current?.click()}
                  startIcon={<Upload className="w-3.5 h-3.5" />}
                >
                  {t('admin.layout.slides.uploadImageButton')}
                </Button>
                {(slideModal.previewUrl || slideModal.existingImageKey) &&
                  !slideModal.removeImage && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        setSlideModal((prev) =>
                          prev
                            ? {
                                ...prev,
                                uploadedImage: null,
                                previewUrl: null,
                                removeImage: true,
                              }
                            : null,
                        )
                      }
                      startIcon={<Trash2 className="w-3.5 h-3.5" />}
                    >
                      {t('admin.layout.slides.removeImageButton')}
                    </Button>
                  )}
              </div>
              <p className="text-xs text-[var(--color-muted)]">
                {t('admin.layout.slides.imageKeepHint')}
              </p>
            </div>

            <label className="flex items-center gap-2.5 text-sm text-[var(--color-text)] cursor-pointer select-none">
              <input
                type="checkbox"
                checked={slideModal.isActive}
                onChange={(e) =>
                  setSlideModal((prev) =>
                    prev ? { ...prev, isActive: e.target.checked } : null,
                  )
                }
                className="w-4 h-4 accent-[var(--color-primary)]"
              />
              <span>{t('admin.layout.slides.isActiveLabel')}</span>
            </label>

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-[var(--color-border)]">
              <Button
                type="button"
                variant="outline"
                disabled={isSaving}
                onClick={() => setSlideModal(null)}
              >
                {t('admin.layout.cancelButton')}
              </Button>
              <Button type="submit" variant="primary" disabled={isSaving}>
                {isSaving
                  ? t('admin.layout.savingButton')
                  : t('admin.layout.saveButton')}
              </Button>
            </div>
          </form>
        </Modal>
      )}

      {/* Home Shelf Create/Edit Modal */}
      {shelfModal && (
        <Modal
          open
          onClose={() => !isSaving && setShelfModal(null)}
          title={
            shelfModal.mode === 'create'
              ? t('admin.layout.shelves.modalCreateTitle')
              : t('admin.layout.shelves.modalEditTitle')
          }
        >
          <form onSubmit={(e) => void handleSaveShelf(e)} className="space-y-4">
            <div className="space-y-1.5">
              <label
                htmlFor="home-shelf-title"
                className="block text-sm font-medium text-[var(--color-text)]"
              >
                {t('admin.layout.shelves.titleLabel')}
              </label>
              <input
                id="home-shelf-title"
                type="text"
                required
                maxLength={MAX_HOME_SHELF_TITLE}
                value={shelfModal.title}
                onChange={(e) =>
                  setShelfModal((prev) =>
                    prev ? { ...prev, title: e.target.value } : null,
                  )
                }
                placeholder={t('admin.layout.shelves.titlePlaceholder')}
                className="w-full min-h-[42px] px-3 py-2 text-sm rounded-[var(--radius-control)] border border-[var(--color-border-strong)] bg-[var(--color-surface)] text-[var(--color-text)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--color-primary)]"
              />
            </div>

            <FormField
              id="home-shelf-type"
              kind="select"
              label={t('admin.layout.shelves.typeLabel')}
              value={shelfModal.type}
              onChange={(value) =>
                setShelfModal((prev) =>
                  prev
                    ? {
                        ...prev,
                        type: value as HomeShelfType,
                        topicId:
                          value === 'ByTopic'
                            ? prev.topicId ||
                              (flattenedTopics[0] ? String(flattenedTopics[0].id) : '')
                            : '',
                      }
                    : null,
                )
              }
              options={shelfTypeOptions}
            />

            {shelfModal.type === 'ByTopic' && (
              <FormField
                id="home-shelf-topic"
                kind="select"
                label={t('admin.layout.shelves.topicLabel')}
                value={shelfModal.topicId}
                onChange={(value) =>
                  setShelfModal((prev) =>
                    prev ? { ...prev, topicId: value } : null,
                  )
                }
                options={topicSelectOptions}
              />
            )}

            <FormField
              id="home-shelf-sort"
              kind="input"
              type="text"
              label={t('admin.layout.shelves.sortOrderLabel')}
              value={shelfModal.sortOrder}
              onChange={(value) =>
                setShelfModal((prev) =>
                  prev ? { ...prev, sortOrder: value } : null,
                )
              }
            />

            <label className="flex items-center gap-2.5 text-sm text-[var(--color-text)] cursor-pointer select-none">
              <input
                type="checkbox"
                checked={shelfModal.isVisible}
                onChange={(e) =>
                  setShelfModal((prev) =>
                    prev ? { ...prev, isVisible: e.target.checked } : null,
                  )
                }
                className="w-4 h-4 accent-[var(--color-primary)]"
              />
              <span>{t('admin.layout.shelves.isVisibleLabel')}</span>
            </label>

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-[var(--color-border)]">
              <Button
                type="button"
                variant="outline"
                disabled={isSaving}
                onClick={() => setShelfModal(null)}
              >
                {t('admin.layout.cancelButton')}
              </Button>
              <Button type="submit" variant="primary" disabled={isSaving}>
                {isSaving
                  ? t('admin.layout.savingButton')
                  : t('admin.layout.saveButton')}
              </Button>
            </div>
          </form>
        </Modal>
      )}

      {/* Static Page Create/Edit Modal */}
      {pageModal && (
        <Modal
          open
          onClose={() => !isSaving && setPageModal(null)}
          title={
            pageModal.mode === 'create'
              ? t('admin.layout.pages.modalCreateTitle')
              : t('admin.layout.pages.modalEditTitle')
          }
        >
          <form onSubmit={(e) => void handleSavePage(e)} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label
                  htmlFor="static-page-title"
                  className="block text-sm font-medium text-[var(--color-text)]"
                >
                  {t('admin.layout.pages.titleLabel')}
                </label>
                <input
                  id="static-page-title"
                  type="text"
                  required
                  maxLength={MAX_STATIC_PAGE_TITLE}
                  value={pageModal.title}
                  onChange={(e) =>
                    setPageModal((prev) =>
                      prev ? { ...prev, title: e.target.value } : null,
                    )
                  }
                  placeholder={t('admin.layout.pages.titlePlaceholder')}
                  className="w-full min-h-[42px] px-3 py-2 text-sm rounded-[var(--radius-control)] border border-[var(--color-border-strong)] bg-[var(--color-surface)] text-[var(--color-text)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--color-primary)]"
                />
              </div>

              <div className="space-y-1.5">
                <label
                  htmlFor="static-page-slug"
                  className="block text-sm font-medium text-[var(--color-text)]"
                >
                  {t('admin.layout.pages.slugInputLabel')}
                </label>
                <input
                  id="static-page-slug"
                  type="text"
                  dir="ltr"
                  maxLength={MAX_STATIC_PAGE_SLUG}
                  value={pageModal.slug}
                  onChange={(e) =>
                    setPageModal((prev) =>
                      prev ? { ...prev, slug: e.target.value } : null,
                    )
                  }
                  placeholder={t('admin.layout.pages.slugPlaceholder')}
                  className="w-full min-h-[42px] px-3 py-2 text-sm font-mono text-left rounded-[var(--radius-control)] border border-[var(--color-border-strong)] bg-[var(--color-surface)] text-[var(--color-text)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--color-primary)]"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label
                htmlFor="static-page-body"
                className="block text-sm font-medium text-[var(--color-text)]"
              >
                {t('admin.layout.pages.bodyLabel')}
              </label>
              <textarea
                id="static-page-body"
                rows={8}
                required
                value={pageModal.body}
                onChange={(e) =>
                  setPageModal((prev) =>
                    prev ? { ...prev, body: e.target.value } : null,
                  )
                }
                placeholder={t('admin.layout.pages.bodyPlaceholder')}
                className="w-full px-3 py-2 text-sm leading-relaxed rounded-[var(--radius-control)] border border-[var(--color-border-strong)] bg-[var(--color-surface)] text-[var(--color-text)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--color-primary)]"
              />
              <p className="text-xs text-[var(--color-muted)]">
                {t('admin.layout.pages.bodySanitizeHint')}
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-center">
              <FormField
                id="static-page-sort"
                kind="input"
                type="text"
                label={t('admin.layout.pages.sortOrderLabel')}
                value={pageModal.sortOrder}
                onChange={(value) =>
                  setPageModal((prev) =>
                    prev ? { ...prev, sortOrder: value } : null,
                  )
                }
              />

              <label className="flex items-center gap-2.5 text-sm text-[var(--color-text)] cursor-pointer select-none sm:pt-6">
                <input
                  type="checkbox"
                  checked={pageModal.showInFooter}
                  onChange={(e) =>
                    setPageModal((prev) =>
                      prev ? { ...prev, showInFooter: e.target.checked } : null,
                    )
                  }
                  className="w-4 h-4 accent-[var(--color-primary)]"
                />
                <span>{t('admin.layout.pages.showInFooterLabel')}</span>
              </label>
            </div>

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-[var(--color-border)]">
              <Button
                type="button"
                variant="outline"
                disabled={isSaving}
                onClick={() => setPageModal(null)}
              >
                {t('admin.layout.cancelButton')}
              </Button>
              <Button type="submit" variant="primary" disabled={isSaving}>
                {isSaving
                  ? t('admin.layout.savingButton')
                  : t('admin.layout.saveButton')}
              </Button>
            </div>
          </form>
        </Modal>
      )}

      {/* Announcement Create/Edit Modal */}
      {announcementModal && (
        <Modal
          open
          onClose={() => !isSaving && setAnnouncementModal(null)}
          title={
            announcementModal.mode === 'create'
              ? t('admin.layout.announcements.modalCreateTitle')
              : t('admin.layout.announcements.modalEditTitle')
          }
        >
          <form onSubmit={(e) => void handleSaveAnnouncement(e)} className="space-y-4">
            {announcementModalError && (
              <Alert
                variant="error"
                message={announcementModalError}
                onDismiss={() => setAnnouncementModalError(null)}
              />
            )}

            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <label
                  htmlFor="announcement-text"
                  className="block text-sm font-medium text-[var(--color-text)]"
                >
                  {t('admin.layout.announcements.textLabel')}
                </label>
                <span className="text-xs text-[var(--color-muted)] tabular-nums-strict">
                  {t('admin.layout.announcements.charCounter', {
                    current: toPersianDigits(announcementModal.text.length),
                    max: toPersianDigits(MAX_ANNOUNCEMENT_TEXT),
                  })}
                </span>
              </div>
              <textarea
                id="announcement-text"
                rows={3}
                required
                maxLength={MAX_ANNOUNCEMENT_TEXT}
                value={announcementModal.text}
                onChange={(e) =>
                  setAnnouncementModal((prev) =>
                    prev ? { ...prev, text: e.target.value } : null,
                  )
                }
                placeholder={t('admin.layout.announcements.textPlaceholder')}
                className="w-full px-3 py-2 text-sm leading-relaxed rounded-[var(--radius-control)] border border-[var(--color-border-strong)] bg-[var(--color-surface)] text-[var(--color-text)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--color-primary)]"
              />
            </div>

            <div className="space-y-1.5">
              <label
                htmlFor="announcement-link"
                className="block text-sm font-medium text-[var(--color-text)]"
              >
                {t('admin.layout.announcements.linkInputLabel')}
              </label>
              <input
                id="announcement-link"
                type="text"
                dir="ltr"
                maxLength={MAX_ANNOUNCEMENT_LINK_URL}
                value={announcementModal.linkUrl}
                onChange={(e) =>
                  setAnnouncementModal((prev) =>
                    prev ? { ...prev, linkUrl: e.target.value } : null,
                  )
                }
                placeholder={t('admin.layout.announcements.linkInputPlaceholder')}
                className="w-full min-h-[42px] px-3 py-2 text-sm font-mono text-left rounded-[var(--radius-control)] border border-[var(--color-border-strong)] bg-[var(--color-surface)] text-[var(--color-text)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--color-primary)]"
              />
              <p className="text-xs text-[var(--color-muted)]">
                {t('admin.layout.announcements.linkInputHint')}
              </p>
            </div>

            {/* Start Date (Jalali) & Time */}
            <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-end">
              <div className="sm:col-span-6">
                <JalaliDatePicker
                  id="announcement-starts-at-date"
                  label={t('admin.layout.announcements.startsAtDateLabel')}
                  required
                  value={announcementModal.startDate}
                  onChange={(value) =>
                    setAnnouncementModal((prev) =>
                      prev ? { ...prev, startDate: value } : null,
                    )
                  }
                />
              </div>
              <div className="sm:col-span-3 space-y-1.5">
                <label
                  htmlFor="announcement-start-hour"
                  className="block text-xs sm:text-sm font-medium text-[var(--color-text)]"
                >
                  {t('admin.layout.announcements.hourLabel')}
                </label>
                <select
                  id="announcement-start-hour"
                  value={announcementModal.startHour}
                  onChange={(e) =>
                    setAnnouncementModal((prev) =>
                      prev ? { ...prev, startHour: e.target.value } : null,
                    )
                  }
                  className="w-full min-h-[42px] px-2.5 py-2 text-sm rounded-[var(--radius-control)] border border-[var(--color-border-strong)] bg-[var(--color-surface)] text-[var(--color-text)] tabular-nums-strict focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--color-primary)]"
                >
                  {HOUR_OPTIONS.map((hh) => (
                    <option key={hh} value={hh}>
                      {toPersianDigits(hh)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="sm:col-span-3 space-y-1.5">
                <label
                  htmlFor="announcement-start-minute"
                  className="block text-xs sm:text-sm font-medium text-[var(--color-text)]"
                >
                  {t('admin.layout.announcements.minuteLabel')}
                </label>
                <select
                  id="announcement-start-minute"
                  value={announcementModal.startMinute}
                  onChange={(e) =>
                    setAnnouncementModal((prev) =>
                      prev ? { ...prev, startMinute: e.target.value } : null,
                    )
                  }
                  className="w-full min-h-[42px] px-2.5 py-2 text-sm rounded-[var(--radius-control)] border border-[var(--color-border-strong)] bg-[var(--color-surface)] text-[var(--color-text)] tabular-nums-strict focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--color-primary)]"
                >
                  {MINUTE_OPTIONS.map((mm) => (
                    <option key={mm} value={mm}>
                      {toPersianDigits(mm)}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* End Date (Jalali) & Time */}
            <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-end">
              <div className="sm:col-span-6">
                <JalaliDatePicker
                  id="announcement-ends-at-date"
                  label={t('admin.layout.announcements.endsAtDateLabel')}
                  required
                  value={announcementModal.endDate}
                  onChange={(value) =>
                    setAnnouncementModal((prev) =>
                      prev ? { ...prev, endDate: value } : null,
                    )
                  }
                />
              </div>
              <div className="sm:col-span-3 space-y-1.5">
                <label
                  htmlFor="announcement-end-hour"
                  className="block text-xs sm:text-sm font-medium text-[var(--color-text)]"
                >
                  {t('admin.layout.announcements.hourLabel')}
                </label>
                <select
                  id="announcement-end-hour"
                  value={announcementModal.endHour}
                  onChange={(e) =>
                    setAnnouncementModal((prev) =>
                      prev ? { ...prev, endHour: e.target.value } : null,
                    )
                  }
                  className="w-full min-h-[42px] px-2.5 py-2 text-sm rounded-[var(--radius-control)] border border-[var(--color-border-strong)] bg-[var(--color-surface)] text-[var(--color-text)] tabular-nums-strict focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--color-primary)]"
                >
                  {HOUR_OPTIONS.map((hh) => (
                    <option key={hh} value={hh}>
                      {toPersianDigits(hh)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="sm:col-span-3 space-y-1.5">
                <label
                  htmlFor="announcement-end-minute"
                  className="block text-xs sm:text-sm font-medium text-[var(--color-text)]"
                >
                  {t('admin.layout.announcements.minuteLabel')}
                </label>
                <select
                  id="announcement-end-minute"
                  value={announcementModal.endMinute}
                  onChange={(e) =>
                    setAnnouncementModal((prev) =>
                      prev ? { ...prev, endMinute: e.target.value } : null,
                    )
                  }
                  className="w-full min-h-[42px] px-2.5 py-2 text-sm rounded-[var(--radius-control)] border border-[var(--color-border-strong)] bg-[var(--color-surface)] text-[var(--color-text)] tabular-nums-strict focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--color-primary)]"
                >
                  {MINUTE_OPTIONS.map((mm) => (
                    <option key={mm} value={mm}>
                      {toPersianDigits(mm)}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="space-y-1.5">
              <label
                htmlFor="announcement-priority"
                className="block text-sm font-medium text-[var(--color-text)]"
              >
                {t('admin.layout.announcements.priorityLabel')}
              </label>
              <input
                id="announcement-priority"
                type="text"
                inputMode="numeric"
                value={announcementModal.priority}
                onChange={(e) =>
                  setAnnouncementModal((prev) =>
                    prev ? { ...prev, priority: e.target.value } : null,
                  )
                }
                className="w-full min-h-[42px] px-3 py-2 text-sm tabular-nums-strict rounded-[var(--radius-control)] border border-[var(--color-border-strong)] bg-[var(--color-surface)] text-[var(--color-text)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--color-primary)]"
              />
              <p className="text-xs text-[var(--color-muted)]">
                {t('admin.layout.announcements.priorityHint')}
              </p>
            </div>

            <label className="flex items-center gap-2.5 text-sm text-[var(--color-text)] cursor-pointer select-none">
              <input
                type="checkbox"
                checked={announcementModal.isActive}
                onChange={(e) =>
                  setAnnouncementModal((prev) =>
                    prev ? { ...prev, isActive: e.target.checked } : null,
                  )
                }
                className="w-4 h-4 accent-[var(--color-primary)]"
              />
              <span>{t('admin.layout.announcements.isActiveLabel')}</span>
            </label>

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-[var(--color-border)]">
              <Button
                type="button"
                variant="outline"
                disabled={isSaving}
                onClick={() => setAnnouncementModal(null)}
              >
                {t('admin.layout.cancelButton')}
              </Button>
              <Button type="submit" variant="primary" disabled={isSaving}>
                {isSaving
                  ? t('admin.layout.savingButton')
                  : t('admin.layout.saveButton')}
              </Button>
            </div>
          </form>
        </Modal>
      )}

      {/* Delete Confirmation Modal */}
      {deleteTarget && (
        <Modal
          open
          onClose={() => !isSaving && setDeleteTarget(null)}
          title={deleteTarget.label}
        >
          <div className="space-y-4">
            <p className="text-sm text-[var(--color-text)] leading-relaxed">
              {deleteTarget.kind === 'slide'
                ? t('admin.layout.confirmDeleteSlide')
                : deleteTarget.kind === 'shelf'
                  ? t('admin.layout.confirmDeleteShelf')
                  : deleteTarget.kind === 'page'
                    ? t('admin.layout.confirmDeletePage')
                    : t('admin.layout.confirmDeleteAnnouncement')}
            </p>
            <div className="flex items-center justify-end gap-2 pt-2 border-t border-[var(--color-border)]">
              <Button
                variant="outline"
                disabled={isSaving}
                onClick={() => setDeleteTarget(null)}
              >
                {t('admin.layout.cancelButton')}
              </Button>
              <Button
                variant="danger"
                disabled={isSaving}
                onClick={() => void handleConfirmDelete()}
              >
                {t('admin.layout.slides.deleteButton')}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </AdminLayout>
  );
}
