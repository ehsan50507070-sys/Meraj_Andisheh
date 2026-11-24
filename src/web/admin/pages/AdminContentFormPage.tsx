import {
  Archive,
  ArrowDown,
  ArrowRight,
  ArrowUp,
  Bold,
  CheckCircle2,
  Eye,
  FileUp,
  Heading2,
  Heading3,
  ImagePlus,
  Italic,
  Link2,
  List,
  Plus,
  Quote,
  RotateCcw,
  Save,
  Sparkles,
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
} from 'react';
import {
  CONTENT_FORMATS,
  ContentFileKind,
  ContentStatus,
  FileStorageType,
  type ContentFormat,
} from '../../../core/domain/content';
import {
  FILM_AGE_RATING_NOTE_MAX_LENGTH,
  FILM_KINDS,
  type FilmKind,
} from '../../../core/domain/portals';
import type {
  AgeGroup,
  ImpactLevel,
  Person,
  Tag as TagModel,
  Topic,
} from '../../../core/domain/taxonomy';
import {
  CONTENT_SUMMARY_MAX_LENGTH,
  CONTENT_TITLE_MAX_LENGTH,
  SOURCE_TITLE_MAX_LENGTH,
  type PublishValidationError,
  type PublishValidationField,
} from '../../../core/services/contentPublishValidator';
import {
  SOURCE_NOTE_MAX_LENGTH,
  type SaveContentFileInput,
  type SaveContentSourceInput,
} from '../../../core/services/contentManagementService';
import { validateExternalUrl } from '../../../core/services/externalLinkService';
import { isSafeAnchorHref } from '../../../core/services/htmlSanitizer';
import { generateSlug } from '../../../core/services/slugService';
import type { SmartImportSuggestions } from '../../../core/services/smartImportParser';
import type { TopicTreeNode } from '../../../core/services/taxonomyService';
import { useAuth } from '../../auth/AuthContext';
import {
  Alert,
  Button,
  FormField,
  Modal,
  SanitizedHtmlPreview,
  Tag,
  type SelectOption,
} from '../../components/ui';
import { formatAgeGroupWithRange } from '../../resources/ageGroupFormatters';
import type { ResourceKey } from '../../resources/fa';
import { toPersianDigits } from '../../resources/formatters';
import { t } from '../../resources/i18n';
import { navigateToHash } from '../../router/HashRouter';
import { appContainer } from '../../services/appContainer';
import { smartImportDraftBridge } from '../../services/smartImportDraftBridge';
import { AdminLayout } from '../AdminLayout';

interface AdminContentFormPageProps {
  currentRoute: string;
  contentId?: number;
}

type FormTabKey = 'basic' | 'files' | 'sources' | 'taxonomy' | 'audience';

function getFormatResourceKey(format: ContentFormat): ResourceKey {
  switch (format) {
    case 'Video':
      return 'content.format.Video';
    case 'Audio':
      return 'content.format.Audio';
    case 'Article':
      return 'content.format.Article';
    case 'Image':
      return 'content.format.Image';
    case 'Pdf':
      return 'content.format.Pdf';
    case 'Presentation':
      return 'content.format.Presentation';
    case 'Book':
      return 'content.format.Book';
    case 'Film':
    default:
      return 'content.format.Film';
  }
}

function getFileKindResourceKey(kind: ContentFileKind): ResourceKey {
  switch (kind) {
    case ContentFileKind.Preview:
      return 'content.fileKind.Preview';
    case ContentFileKind.Attachment:
      return 'content.fileKind.Attachment';
    case ContentFileKind.Main:
    default:
      return 'content.fileKind.Main';
  }
}

function getStatusInfo(status: ContentStatus): {
  labelKey: ResourceKey;
  variant: 'neutral' | 'success' | 'warning';
} {
  switch (status) {
    case ContentStatus.Published:
      return { labelKey: 'content.status.Published', variant: 'success' };
    case ContentStatus.Archived:
      return { labelKey: 'content.status.Archived', variant: 'warning' };
    case ContentStatus.Draft:
    default:
      return { labelKey: 'content.status.Draft', variant: 'neutral' };
  }
}

function formatFileSize(sizeBytes: number | null | undefined): string {
  if (sizeBytes === null || sizeBytes === undefined || !Number.isFinite(sizeBytes)) {
    return '—';
  }
  if (sizeBytes < 1024) {
    return t('storage.size.bytes', { value: toPersianDigits(sizeBytes) });
  }
  if (sizeBytes < 1024 * 1024) {
    return t('storage.size.kb', { value: toPersianDigits(Math.round(sizeBytes / 1024)) });
  }
  const mb = (sizeBytes / (1024 * 1024)).toFixed(1);
  return t('storage.size.mb', { value: toPersianDigits(mb) });
}

function mapValidationFieldToTab(field: PublishValidationField): FormTabKey {
  switch (field) {
    case 'files':
      return 'files';
    case 'sources':
      return 'sources';
    case 'topicIds':
      return 'taxonomy';
    case 'title':
    case 'summary':
    case 'format':
    case 'body':
    case 'thumbnailKey':
    default:
      return 'basic';
  }
}

function flattenTopicTree(
  nodes: readonly TopicTreeNode[],
  out: Array<{ topic: Topic; depth: number }> = [],
): Array<{ topic: Topic; depth: number }> {
  for (const node of nodes) {
    out.push({ topic: node.topic, depth: node.depth });
    if (node.children.length > 0) {
      flattenTopicTree(node.children, out);
    }
  }
  return out;
}


export function AdminContentFormPage({ currentRoute, contentId }: AdminContentFormPageProps) {
  const { currentUser } = useAuth();
  const [activeTab, setActiveTab] = useState<FormTabKey>('basic');
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [isPublishing, setIsPublishing] = useState<boolean>(false);
  const [isArchiving, setIsArchiving] = useState<boolean>(false);
  const [isUploadingThumb, setIsUploadingThumb] = useState<boolean>(false);
  const [isUploadingFile, setIsUploadingFile] = useState<boolean>(false);

  // Loaded entity state
  const [editingId, setEditingId] = useState<number | undefined>(contentId);
  const [status, setStatus] = useState<ContentStatus>(ContentStatus.Draft);

  // Taxonomy options
  const [topicTree, setTopicTree] = useState<TopicTreeNode[]>([]);
  const [tags, setTags] = useState<TagModel[]>([]);
  const [persons, setPersons] = useState<Person[]>([]);
  const [impactLevels, setImpactLevels] = useState<ImpactLevel[]>([]);
  const [activeAgeGroups, setActiveAgeGroups] = useState<AgeGroup[]>([]);

  // Form fields
  const [title, setTitle] = useState('');
  const [slug, setSlug] = useState('');
  const [slugManuallyEdited, setSlugManuallyEdited] = useState(Boolean(contentId));
  const [summary, setSummary] = useState('');
  const [format, setFormat] = useState<ContentFormat>('Article');
  const [readWatchMinutes, setReadWatchMinutes] = useState('');
  const [isFeatured, setIsFeatured] = useState(false);
  const [thumbnailKey, setThumbnailKey] = useState<string | null>(null);
  const [thumbnailPreviewUrl, setThumbnailPreviewUrl] = useState<string | null>(null);
  const [body, setBody] = useState('');
  const [showBodyPreview, setShowBodyPreview] = useState(false);

  // FilmInfo fields (Stage 23, shown when format === 'Film')
  const [filmKind, setFilmKind] = useState<FilmKind>('Film');
  const [filmReleaseYear, setFilmReleaseYear] = useState('');
  const [filmRuntimeMinutes, setFilmRuntimeMinutes] = useState('');
  const [filmAgeRatingNote, setFilmAgeRatingNote] = useState('');
  const [filmIsWeeklyPick, setFilmIsWeeklyPick] = useState(false);

  // Collections
  const [files, setFiles] = useState<SaveContentFileInput[]>([]);
  const [sources, setSources] = useState<SaveContentSourceInput[]>([]);
  const [topicIds, setTopicIds] = useState<number[]>([]);
  const [tagIds, setTagIds] = useState<number[]>([]);
  const [personIds, setPersonIds] = useState<number[]>([]);
  const [impactLevelId, setImpactLevelId] = useState<string>('');
  const [ageGroupIds, setAgeGroupIds] = useState<number[]>([]);

  // Tab 1 link modal
  const [linkModalOpen, setLinkModalOpen] = useState(false);
  const [linkUrlInput, setLinkUrlInput] = useState('');
  const [linkTextInput, setLinkTextInput] = useState('');
  const [linkModalError, setLinkModalError] = useState<string | null>(null);
  const bodyTextareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Tab 2 inputs
  const [newFileKind, setNewFileKind] = useState<ContentFileKind>(ContentFileKind.Main);
  const [newLocalDownloadable, setNewLocalDownloadable] = useState<boolean>(true);
  const [externalUrlInput, setExternalUrlInput] = useState('');
  const [externalNameInput, setExternalNameInput] = useState('');
  const localFileInputRef = useRef<HTMLInputElement | null>(null);
  const thumbFileInputRef = useRef<HTMLInputElement | null>(null);

  // Tab 3 source inputs
  const [sourceTitleInput, setSourceTitleInput] = useState('');
  const [sourceUrlInput, setSourceUrlInput] = useState('');
  const [sourceNoteInput, setSourceNoteInput] = useState('');

  // Tab 4 search inputs
  const [tagSearch, setTagSearch] = useState('');
  const [personSearch, setPersonSearch] = useState('');

  // Feedback & validation state
  const [feedback, setFeedback] = useState<{
    variant: 'success' | 'error' | 'warning';
    title?: string;
    message: string;
  } | null>(null);
  const [validationErrors, setValidationErrors] = useState<PublishValidationError[]>([]);
  const [archiveModalOpen, setArchiveModalOpen] = useState(false);
  const [smartImportPrefilled, setSmartImportPrefilled] = useState(false);
  const [remainingSuggestions, setRemainingSuggestions] = useState<SmartImportSuggestions | null>(
    null,
  );
  const justCreatedIdRef = useRef<number | null>(null);

  const loadThumbnailPreview = useCallback(async (key: string | null) => {
    setThumbnailPreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
    if (!key) return;
    const res = await appContainer.fileUploadService.openPublicMediaAsync(key);
    if (res.ok && res.bytes && res.metadata) {
      const copy = new Uint8Array(res.bytes.byteLength);
      copy.set(res.bytes);
      const blob = new Blob([copy.buffer], { type: res.metadata.mimeType });
      const url = URL.createObjectURL(blob);
      setThumbnailPreviewUrl(url);
    }
  }, []);

  useEffect(() => {
    return () => {
      if (thumbnailPreviewUrl) {
        URL.revokeObjectURL(thumbnailPreviewUrl);
      }
    };
  }, [thumbnailPreviewUrl]);

  const loadForm = useCallback(async () => {
    if (contentId !== undefined && justCreatedIdRef.current === contentId) {
      justCreatedIdRef.current = null;
      return;
    }
    setIsLoading(true);
    setFeedback(null);
    setValidationErrors([]);
    try {
      const taxRes = await appContainer.contentManagementService.getTaxonomyOptionsForContent(
        currentUser,
      );
      if (taxRes.ok && taxRes.data) {
        setTopicTree(taxRes.data.topicTree);
        setTags(taxRes.data.tags);
        setPersons(taxRes.data.persons);
        setImpactLevels(taxRes.data.impactLevels);
        setActiveAgeGroups(taxRes.data.activeAgeGroups);
      }

      if (contentId !== undefined) {
        const aggRes = await appContainer.contentManagementService.getContentAggregate(
          currentUser,
          contentId,
        );
        if (!aggRes.ok || !aggRes.data) {
          setFeedback({
            variant: 'error',
            message: aggRes.messageKey
              ? t(aggRes.messageKey as ResourceKey)
              : t('admin.content.error.notFound'),
          });
          return;
        }

        const agg = aggRes.data;
        setEditingId(agg.item.id);
        setStatus(agg.item.status);
        setTitle(agg.item.title);
        setSlug(agg.item.slug);
        setSlugManuallyEdited(true);
        setSummary(agg.item.summary);
        setFormat(agg.item.format);
        setReadWatchMinutes(
          agg.item.readWatchMinutes !== null ? String(agg.item.readWatchMinutes) : '',
        );
        setIsFeatured(agg.item.isFeatured);
        setThumbnailKey(agg.item.thumbnailKey);
        await loadThumbnailPreview(agg.item.thumbnailKey);
        setBody(agg.item.body ?? '');

        setSources(
          agg.sources.map((s) => ({
            title: s.title,
            url: s.url ?? '',
            note: s.note ?? '',
            sortOrder: s.sortOrder,
          })),
        );
        setFiles(
          agg.files.map((f) => ({
            kind: f.kind,
            storageType: f.storageType,
            storageKey: f.storageKey,
            externalUrl: f.externalUrl,
            originalFileName: f.originalFileName,
            mimeType: f.mimeType,
            sizeBytes: f.sizeBytes,
            isDownloadable: f.isDownloadable,
            sortOrder: f.sortOrder,
          })),
        );
        setTopicIds(agg.topicIds);
        setTagIds(agg.tagIds);
        setPersonIds(agg.personIds);
        setImpactLevelId(agg.item.impactLevelId !== null ? String(agg.item.impactLevelId) : '');
        setAgeGroupIds(agg.ageGroupIds);
        if (agg.item.format === 'Film') {
          const filmRes = await appContainer.filmPortalService.getFilmInfoByContentIdForAdminAsync(
            currentUser,
            agg.item.id,
          );
          if (filmRes.ok && filmRes.data) {
            setFilmKind(filmRes.data.kind);
            setFilmReleaseYear(
              filmRes.data.releaseYear !== null ? String(filmRes.data.releaseYear) : '',
            );
            setFilmRuntimeMinutes(
              filmRes.data.runtimeMinutes !== null ? String(filmRes.data.runtimeMinutes) : '',
            );
            setFilmAgeRatingNote(filmRes.data.ageRatingNote ?? '');
            setFilmIsWeeklyPick(filmRes.data.isWeeklyPick);
          } else {
            setFilmKind('Film');
            setFilmReleaseYear('');
            setFilmRuntimeMinutes('');
            setFilmAgeRatingNote('');
            setFilmIsWeeklyPick(false);
          }
        } else {
          setFilmKind('Film');
          setFilmReleaseYear('');
          setFilmRuntimeMinutes('');
          setFilmAgeRatingNote('');
          setFilmIsWeeklyPick(false);
        }
        setSmartImportPrefilled(false);
        setRemainingSuggestions(null);
      } else {
        const pendingTransfer = smartImportDraftBridge.consumePendingTransfer();
        if (pendingTransfer) {
          const { draft, suggestions } = pendingTransfer;
          setEditingId(undefined);
          setStatus(ContentStatus.Draft);
          setTitle(draft.title);
          setSlug(draft.slug);
          setSlugManuallyEdited(Boolean(draft.slug));
          setSummary(draft.summary);
          setFormat(draft.format);
          setReadWatchMinutes(
            draft.readWatchMinutes !== null ? String(draft.readWatchMinutes) : '',
          );
          setIsFeatured(false);
          setThumbnailKey(null);
          await loadThumbnailPreview(null);
          setBody(draft.bodyHtml);
          setSources(
            draft.sources.map((s) => ({
              title: s.title,
              url: s.url ?? '',
              note: s.note ?? '',
              sortOrder: s.sortOrder,
            })),
          );
          setFiles([]);
          setTopicIds(draft.topicIds);
          setTagIds(draft.tagIds);
          setPersonIds(draft.personIds);
          setImpactLevelId(draft.impactLevelId !== null ? String(draft.impactLevelId) : '');
          setAgeGroupIds(draft.ageGroupIds);
          setFilmKind('Film');
          setFilmReleaseYear('');
          setFilmRuntimeMinutes('');
          setFilmAgeRatingNote('');
          setFilmIsWeeklyPick(false);
          setSmartImportPrefilled(true);
          setRemainingSuggestions(suggestions);
        } else {
          setEditingId(undefined);
          setStatus(ContentStatus.Draft);
          setTitle('');
          setSlug('');
          setSlugManuallyEdited(false);
          setSummary('');
          setFormat('Article');
          setReadWatchMinutes('');
          setIsFeatured(false);
          setThumbnailKey(null);
          await loadThumbnailPreview(null);
          setBody('');
          setSources([]);
          setFiles([]);
          setTopicIds([]);
          setTagIds([]);
          setPersonIds([]);
          setImpactLevelId('');
          setAgeGroupIds([]);
          setFilmKind('Film');
          setFilmReleaseYear('');
          setFilmRuntimeMinutes('');
          setFilmAgeRatingNote('');
          setFilmIsWeeklyPick(false);
          setSmartImportPrefilled(false);
          setRemainingSuggestions(null);
        }
      }
    } finally {
      setIsLoading(false);
    }
  }, [contentId, currentUser, loadThumbnailPreview]);

  useEffect(() => {
    void loadForm();
  }, [loadForm]);

  const errorTabsSet = useMemo(() => {
    const set = new Set<FormTabKey>();
    for (const err of validationErrors) {
      set.add(mapValidationFieldToTab(err.field));
    }
    return set;
  }, [validationErrors]);

  const flattenedTopics = useMemo(() => flattenTopicTree(topicTree), [topicTree]);

  const filteredTags = useMemo(() => {
    const q = tagSearch.trim().toLowerCase();
    if (!q) return tags;
    return tags.filter(
      (item) => item.name.toLowerCase().includes(q) || item.slug.toLowerCase().includes(q),
    );
  }, [tags, tagSearch]);

  const filteredPersons = useMemo(() => {
    const q = personSearch.trim().toLowerCase();
    if (!q) return persons;
    return persons.filter(
      (item) => item.name.toLowerCase().includes(q) || item.slug.toLowerCase().includes(q),
    );
  }, [persons, personSearch]);

  const formatOptions: SelectOption[] = useMemo(
    () =>
      CONTENT_FORMATS.map((fmt) => ({
        value: fmt,
        label: t(getFormatResourceKey(fmt)),
      })),
    [],
  );

  const filmKindOptions: SelectOption[] = useMemo(
    () =>
      FILM_KINDS.map((kind) => ({
        value: kind,
        label: t(`films.kind.${kind}` as ResourceKey),
      })),
    [],
  );

  const fileKindOptions: SelectOption[] = useMemo(
    () => [
      { value: String(ContentFileKind.Main), label: t('content.fileKind.Main') },
      { value: String(ContentFileKind.Preview), label: t('content.fileKind.Preview') },
      { value: String(ContentFileKind.Attachment), label: t('content.fileKind.Attachment') },
    ],
    [],
  );

  const impactLevelOptions: SelectOption[] = useMemo(
    () => [
      { value: '', label: t('admin.content.taxonomy.impactLevelNone') },
      ...impactLevels.map((lvl) => ({
        value: String(lvl.id),
        label: lvl.name,
      })),
    ],
    [impactLevels],
  );

  const handleTitleChange = (val: string) => {
    setTitle(val);
    if (!slugManuallyEdited) {
      setSlug(generateSlug(val));
    }
  };

  const handlePickThumbnail = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    setIsUploadingThumb(true);
    setFeedback(null);
    try {
      const buffer = await file.arrayBuffer();
      const res = await appContainer.contentManagementService.uploadThumbnailAsync(currentUser, {
        originalFileName: file.name,
        bytes: new Uint8Array(buffer),
      });
      if (!res.ok || !res.data) {
        setFeedback({
          variant: 'error',
          message: res.messageKey
            ? t(res.messageKey as ResourceKey)
            : t('storage.error.generic'),
        });
        return;
      }
      setThumbnailKey(res.data.storageKey);
      await loadThumbnailPreview(res.data.storageKey);
    } finally {
      setIsUploadingThumb(false);
    }
  };

  const handleRemoveThumbnail = () => {
    setThumbnailKey(null);
    void loadThumbnailPreview(null);
  };

  const insertHtmlSnippet = (before: string, after: string, fallbackInner: string) => {
    const textarea = bodyTextareaRef.current;
    if (!textarea) {
      setBody((prev) => `${prev}${prev ? '\n' : ''}${before}${fallbackInner}${after}`);
      return;
    }
    const start = textarea.selectionStart ?? body.length;
    const end = textarea.selectionEnd ?? body.length;
    const selected = body.slice(start, end) || fallbackInner;
    const next = `${body.slice(0, start)}${before}${selected}${after}${body.slice(end)}`;
    setBody(next);
    window.requestAnimationFrame(() => {
      textarea.focus();
      const cursorPos = start + before.length + selected.length + after.length;
      textarea.setSelectionRange(cursorPos, cursorPos);
    });
  };

  const handleInsertSafeLink = () => {
    const trimmedUrl = linkUrlInput.trim();
    if (!isSafeAnchorHref(trimmedUrl)) {
      setLinkModalError(t('admin.content.error.invalidUrl'));
      return;
    }
    const label = linkTextInput.trim() || t('admin.content.editor.linkDefaultText');
    const escapedHref = trimmedUrl
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    insertHtmlSnippet(`<a href="${escapedHref}" rel="noopener noreferrer">`, '</a>', label);
    setLinkUrlInput('');
    setLinkTextInput('');
    setLinkModalError(null);
    setLinkModalOpen(false);
  };

  const handlePickLocalContentFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    setIsUploadingFile(true);
    setFeedback(null);
    try {
      const buffer = await file.arrayBuffer();
      const res = await appContainer.contentManagementService.uploadContentFileAsync(
        currentUser,
        {
          originalFileName: file.name,
          bytes: new Uint8Array(buffer),
        },
      );
      if (!res.ok || !res.data) {
        setFeedback({
          variant: 'error',
          message: res.messageKey
            ? t(res.messageKey as ResourceKey)
            : t('storage.error.generic'),
        });
        return;
      }

      const meta = res.data;
      setFiles((prev) => [
        ...prev,
        {
          kind: newFileKind,
          storageType: FileStorageType.Local,
          storageKey: meta.storageKey,
          externalUrl: null,
          originalFileName: meta.originalFileName,
          mimeType: meta.mimeType,
          sizeBytes: meta.sizeBytes,
          isDownloadable: newLocalDownloadable,
          sortOrder: prev.length + 1,
        },
      ]);
    } finally {
      setIsUploadingFile(false);
    }
  };

  const handleAddExternalFile = () => {
    setFeedback(null);
    const urlCheck = validateExternalUrl(externalUrlInput);
    if (!urlCheck.isValid || !urlCheck.normalizedUrl) {
      setFeedback({
        variant: 'error',
        message: t('admin.content.error.invalidExternalFileUrl'),
      });
      return;
    }
    const trimmedName = externalNameInput.trim();
    if (!trimmedName) {
      setFeedback({
        variant: 'error',
        message: t('admin.content.error.externalFileNameRequired'),
      });
      return;
    }

    setFiles((prev) => [
      ...prev,
      {
        kind: newFileKind,
        storageType: FileStorageType.External,
        storageKey: null,
        externalUrl: urlCheck.normalizedUrl,
        originalFileName: trimmedName,
        mimeType: 'text/html',
        sizeBytes: null,
        isDownloadable: false,
        sortOrder: prev.length + 1,
      },
    ]);
    setExternalUrlInput('');
    setExternalNameInput('');
  };

  const moveFile = (index: number, direction: -1 | 1) => {
    setFiles((prev) => {
      const target = index + direction;
      if (target < 0 || target >= prev.length) return prev;
      const copy = [...prev];
      const [moved] = copy.splice(index, 1);
      copy.splice(target, 0, moved);
      return copy.map((f, idx) => ({ ...f, sortOrder: idx + 1 }));
    });
  };

  const toggleFileDownloadable = (index: number, checked: boolean) => {
    setFiles((prev) =>
      prev.map((f, idx) => {
        if (idx !== index || f.storageType === FileStorageType.External) return f;
        return { ...f, isDownloadable: checked };
      }),
    );
  };

  const removeFileAt = (index: number) => {
    setFiles((prev) =>
      prev.filter((_, idx) => idx !== index).map((f, idx) => ({ ...f, sortOrder: idx + 1 })),
    );
  };

  const handleAddSource = () => {
    setFeedback(null);
    const trimmedTitle = sourceTitleInput.trim();
    if (!trimmedTitle || trimmedTitle.length > SOURCE_TITLE_MAX_LENGTH) {
      setFeedback({
        variant: 'error',
        message: t('admin.content.error.invalidSourceTitle'),
      });
      return;
    }

    const trimmedNote = sourceNoteInput.trim();
    if (trimmedNote.length > SOURCE_NOTE_MAX_LENGTH) {
      setFeedback({
        variant: 'error',
        message: t('admin.content.error.invalidSourceNote'),
      });
      return;
    }

    let normalizedUrl: string | null = null;
    const rawUrl = sourceUrlInput.trim();
    if (rawUrl) {
      const urlCheck = validateExternalUrl(rawUrl);
      if (!urlCheck.isValid || !urlCheck.normalizedUrl) {
        setFeedback({
          variant: 'error',
          message: t('admin.content.error.invalidUrl'),
        });
        return;
      }
      normalizedUrl = urlCheck.normalizedUrl;
    }

    setSources((prev) => [
      ...prev,
      {
        title: trimmedTitle,
        url: normalizedUrl,
        note: trimmedNote || null,
        sortOrder: prev.length + 1,
      },
    ]);
    setSourceTitleInput('');
    setSourceUrlInput('');
    setSourceNoteInput('');
  };

  const moveSource = (index: number, direction: -1 | 1) => {
    setSources((prev) => {
      const target = index + direction;
      if (target < 0 || target >= prev.length) return prev;
      const copy = [...prev];
      const [moved] = copy.splice(index, 1);
      copy.splice(target, 0, moved);
      return copy.map((s, idx) => ({ ...s, sortOrder: idx + 1 }));
    });
  };

  const removeSourceAt = (index: number) => {
    setSources((prev) =>
      prev.filter((_, idx) => idx !== index).map((s, idx) => ({ ...s, sortOrder: idx + 1 })),
    );
  };

  const toggleIdSelection = (
    id: number,
    setter: (updater: (prev: number[]) => number[]) => void,
  ) => {
    setter((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const buildSavePayload = () => ({
    id: editingId,
    title,
    slug,
    summary,
    body,
    format,
    impactLevelId: impactLevelId ? Number(impactLevelId) : null,
    readWatchMinutes: readWatchMinutes.trim() || null,
    thumbnailKey,
    isFeatured,
    sources,
    files,
    topicIds,
    tagIds,
    personIds,
    ageGroupIds,
  });

  const handleSave = async (): Promise<number | null> => {
    setIsSaving(true);
    setFeedback(null);
    setValidationErrors([]);
    try {
      const res = await appContainer.contentManagementService.saveDraft(
        currentUser,
        buildSavePayload(),
      );
      if (!res.ok || !res.data) {
        if (res.validationErrors) {
          setValidationErrors(res.validationErrors);
        }
        setFeedback({
          variant: 'error',
          title: res.validationErrors
            ? t('admin.content.form.publishChecklistFailedTitle')
            : undefined,
          message: res.messageKey
            ? t(res.messageKey as ResourceKey)
            : t('admin.content.error.notFound'),
        });
        return null;
      }

      const saved = res.data;
      setEditingId(saved.item.id);
      setStatus(saved.item.status);
      setSlug(saved.item.slug);
      setBody(saved.item.body ?? '');

      if (saved.item.format === 'Film') {
        const filmInfoRes = await appContainer.filmPortalService.upsertFilmInfoAsync(
          currentUser,
          {
            contentId: saved.item.id,
            kind: filmKind,
            releaseYear: filmReleaseYear,
            runtimeMinutes: filmRuntimeMinutes,
            ageRatingNote: filmAgeRatingNote,
            isWeeklyPick: filmIsWeeklyPick,
          },
          {
            sourceContext: 'contentForm',
            routePath: currentRoute,
          },
        );
        if (!filmInfoRes.ok) {
          setActiveTab('basic');
          setFeedback({
            variant: 'error',
            message: filmInfoRes.messageKey
              ? t(filmInfoRes.messageKey as ResourceKey)
              : t('admin.portals.film.error.invalidReleaseYear'),
          });
          if (editingId === undefined) {
            justCreatedIdRef.current = saved.item.id;
            navigateToHash(`/admin/content/edit/${saved.item.id}`);
          }
          return null;
        }
      }

      setFeedback({
        variant: 'success',
        message: t('admin.content.form.savedSuccess'),
      });
      if (editingId === undefined) {
        justCreatedIdRef.current = saved.item.id;
        navigateToHash(`/admin/content/edit/${saved.item.id}`);
      }
      return saved.item.id;
    } finally {
      setIsSaving(false);
    }
  };

  const handlePublish = async () => {
    setIsPublishing(true);
    setFeedback(null);
    setValidationErrors([]);
    try {
      const saveRes = await appContainer.contentManagementService.saveDraft(
        currentUser,
        buildSavePayload(),
      );
      if (!saveRes.ok || !saveRes.data) {
        if (saveRes.validationErrors) {
          setValidationErrors(saveRes.validationErrors);
        }
        setFeedback({
          variant: 'error',
          title: saveRes.validationErrors
            ? t('admin.content.form.publishChecklistFailedTitle')
            : undefined,
          message: saveRes.messageKey
            ? t(saveRes.messageKey as ResourceKey)
            : t('admin.content.error.notFound'),
        });
        return;
      }

      const savedId = saveRes.data.item.id;
      setEditingId(savedId);
      setSlug(saveRes.data.item.slug);
      setBody(saveRes.data.item.body ?? '');

      if (saveRes.data.item.format === 'Film') {
        const filmInfoRes = await appContainer.filmPortalService.upsertFilmInfoAsync(
          currentUser,
          {
            contentId: savedId,
            kind: filmKind,
            releaseYear: filmReleaseYear,
            runtimeMinutes: filmRuntimeMinutes,
            ageRatingNote: filmAgeRatingNote,
            isWeeklyPick: filmIsWeeklyPick,
          },
          {
            sourceContext: 'contentForm',
            routePath: currentRoute,
          },
        );
        if (!filmInfoRes.ok) {
          setActiveTab('basic');
          setFeedback({
            variant: 'error',
            message: filmInfoRes.messageKey
              ? t(filmInfoRes.messageKey as ResourceKey)
              : t('admin.portals.film.error.invalidReleaseYear'),
          });
          if (editingId === undefined) {
            justCreatedIdRef.current = savedId;
            navigateToHash(`/admin/content/edit/${savedId}`);
          }
          return;
        }
      }

      const pubRes = await appContainer.contentManagementService.publishContent(
        currentUser,
        savedId,
      );
      if (!pubRes.ok || !pubRes.data) {
        if (pubRes.validationErrors) {
          setValidationErrors(pubRes.validationErrors);
          const firstTab = mapValidationFieldToTab(pubRes.validationErrors[0].field);
          setActiveTab(firstTab);
        }
        setFeedback({
          variant: 'error',
          title: t('admin.content.form.publishChecklistFailedTitle'),
          message: pubRes.messageKey
            ? t(pubRes.messageKey as ResourceKey)
            : t('admin.content.error.notFound'),
        });
        return;
      }

      setStatus(pubRes.data.item.status);
      setValidationErrors([]);
      setFeedback({
        variant: 'success',
        message: t('admin.content.form.publishedSuccess'),
      });
      if (editingId === undefined) {
        justCreatedIdRef.current = savedId;
        navigateToHash(`/admin/content/edit/${savedId}`);
      }
    } finally {
      setIsPublishing(false);
    }
  };

  const handleArchive = async () => {
    if (!editingId) return;
    setIsArchiving(true);
    setFeedback(null);
    try {
      const res = await appContainer.contentManagementService.archiveContent(
        currentUser,
        editingId,
      );
      if (res.ok && res.data) {
        setStatus(res.data.status);
        setArchiveModalOpen(false);
        setFeedback({
          variant: 'warning',
          message: t('admin.content.list.feedback.archived', { title: res.data.title }),
        });
      } else if (res.messageKey) {
        setFeedback({
          variant: 'error',
          message: t(res.messageKey as ResourceKey),
        });
      }
    } finally {
      setIsArchiving(false);
    }
  };

  const handleRestore = async () => {
    if (!editingId) return;
    setIsSaving(true);
    setFeedback(null);
    try {
      const res = await appContainer.contentManagementService.restoreToDraft(
        currentUser,
        editingId,
      );
      if (res.ok && res.data) {
        setStatus(res.data.status);
        setFeedback({
          variant: 'success',
          message: t('admin.content.list.feedback.restored', { title: res.data.title }),
        });
      } else if (res.messageKey) {
        setFeedback({
          variant: 'error',
          message: t(res.messageKey as ResourceKey),
        });
      }
    } finally {
      setIsSaving(false);
    }
  };

  const statusInfo = getStatusInfo(status);
  const externalPreviewCheck = useMemo(
    () => (externalUrlInput.trim() ? validateExternalUrl(externalUrlInput) : null),
    [externalUrlInput],
  );

  const tabs: ReadonlyArray<{ id: FormTabKey; labelKey: ResourceKey }> = [
    { id: 'basic', labelKey: 'admin.content.form.tab.basic' },
    { id: 'files', labelKey: 'admin.content.form.tab.files' },
    { id: 'sources', labelKey: 'admin.content.form.tab.sources' },
    { id: 'taxonomy', labelKey: 'admin.content.form.tab.taxonomy' },
    { id: 'audience', labelKey: 'admin.content.form.tab.audience' },
  ];

  return (
    <AdminLayout currentRoute={currentRoute}>
      <div className="space-y-6">
        {/* Top Action Bar */}
        <header className="pb-5 border-b border-[var(--color-border)] flex flex-wrap items-center justify-between gap-4">
          <div className="space-y-1.5 min-w-0">
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="text-xl sm:text-2xl font-bold text-[var(--color-text)] truncate">
                {editingId !== undefined
                  ? t('admin.content.form.editTitle', { title: title || slug || String(editingId) })
                  : t('admin.content.form.createTitle')}
              </h1>
              <Tag label={t(statusInfo.labelKey)} variant={statusInfo.variant} />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {editingId === undefined && (
              <Button
                variant="outline"
                onClick={() => navigateToHash('/admin/content/smart-import')}
                startIcon={<Sparkles className="w-4 h-4" />}
              >
                {t('admin.content.list.smartImportAction')}
              </Button>
            )}

            <Button
              variant="ghost"
              onClick={() => navigateToHash('/admin/content')}
              startIcon={<ArrowRight className="w-4 h-4" />}
            >
              {t('admin.content.form.backToList')}
            </Button>

            <Button
              variant="secondary"
              disabled={isSaving || isPublishing || isLoading}
              onClick={() => void handleSave()}
              startIcon={<Save className="w-4 h-4" />}
            >
              {isSaving
                ? t('admin.content.form.saving')
                : editingId !== undefined
                  ? t('admin.content.form.saveChanges')
                  : t('admin.content.form.saveDraft')}
            </Button>

            {status !== ContentStatus.Published && (
              <Button
                variant="primary"
                disabled={isSaving || isPublishing || isLoading}
                onClick={() => void handlePublish()}
                startIcon={<CheckCircle2 className="w-4 h-4" />}
              >
                {isPublishing
                  ? t('admin.content.form.publishing')
                  : t('admin.content.form.publish')}
              </Button>
            )}

            {editingId !== undefined && status !== ContentStatus.Archived && (
              <Button
                variant="outline"
                disabled={isSaving || isPublishing || isArchiving}
                onClick={() => setArchiveModalOpen(true)}
                startIcon={<Archive className="w-4 h-4" />}
              >
                {t('admin.content.form.archive')}
              </Button>
            )}

            {editingId !== undefined && status === ContentStatus.Archived && (
              <Button
                variant="outline"
                disabled={isSaving || isPublishing}
                onClick={() => void handleRestore()}
                startIcon={<RotateCcw className="w-4 h-4" />}
              >
                {t('admin.content.form.restore')}
              </Button>
            )}
          </div>
        </header>

        {/* Smart Import Prefill Notice & Remaining Suggestions */}
        {smartImportPrefilled && (
          <div className="space-y-2">
            <Alert
              variant="info"
              message={t('admin.smartImport.formPrefilledBanner')}
              onDismiss={() => setSmartImportPrefilled(false)}
            />
            {remainingSuggestions &&
              (remainingSuggestions.missingTopics.length > 0 ||
                remainingSuggestions.missingTags.length > 0 ||
                remainingSuggestions.missingPersons.length > 0) && (
                <div className="rounded-[var(--radius-control)] border border-[var(--color-warning-border)] bg-[var(--color-warning-bg)] px-4 py-3 text-xs sm:text-sm text-[var(--color-warning-text)] space-y-1.5">
                  <p className="font-bold">
                    {t('admin.smartImport.formRemainingSuggestionsTitle')}
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {remainingSuggestions.missingTopics.map((item) => (
                      <Tag
                        key={`rem-topic-${item.rawText}`}
                        label={
                          item.parentName
                            ? t('admin.smartImport.suggestions.topicWithParent', {
                                parent: item.parentName,
                                name: item.name,
                              })
                            : item.name
                        }
                        variant="warning"
                      />
                    ))}
                    {remainingSuggestions.missingTags.map((item) => (
                      <Tag
                        key={`rem-tag-${item.name}`}
                        label={item.name}
                        variant="warning"
                      />
                    ))}
                    {remainingSuggestions.missingPersons.map((item) => (
                      <Tag
                        key={`rem-person-${item.name}`}
                        label={item.name}
                        variant="warning"
                      />
                    ))}
                  </div>
                </div>
              )}
          </div>
        )}

        {/* Feedback & Validation Checklist Errors */}
        {feedback && (
          <div className="space-y-2">
            <Alert
              variant={feedback.variant}
              title={feedback.title}
              message={feedback.message}
              onDismiss={() => setFeedback(null)}
            />
            {validationErrors.length > 0 && (
              <div className="rounded-[var(--radius-control)] border border-[var(--color-error-border)] bg-[var(--color-error-bg)] px-4 py-3 text-xs sm:text-sm text-[var(--color-error-text)]">
                <ul className="list-disc pr-5 space-y-1">
                  {validationErrors.map((err) => (
                    <li key={`${err.field}-${err.code}`}>{t(err.messageKey as ResourceKey)}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {isLoading ? (
          <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-8 text-center text-sm text-[var(--color-muted)]">
            {t('admin.content.form.loading')}
          </div>
        ) : (
          <div className="space-y-6">
            {/* 5 Tabs Navigation */}
            <div
              role="tablist"
              aria-label={t('admin.content.form.tabsAriaLabel')}
              className="flex flex-wrap gap-2 border-b border-[var(--color-border)] pb-3"
            >
              {tabs.map((tab) => {
                const isActive = activeTab === tab.id;
                const hasError = errorTabsSet.has(tab.id);
                return (
                  <button
                    key={tab.id}
                    type="button"
                    role="tab"
                    aria-selected={isActive}
                    onClick={() => setActiveTab(tab.id)}
                    className={`inline-flex items-center gap-2 min-h-[40px] px-4 py-2 text-xs sm:text-sm font-semibold rounded-[var(--radius-control)] border transition-colors whitespace-nowrap ${
                      isActive
                        ? 'bg-[var(--color-primary-button)] text-[var(--color-on-primary)] border-transparent'
                        : 'bg-[var(--color-surface)] text-[var(--color-text)] border-[var(--color-border)] hover:bg-[var(--color-surface-alt)]'
                    }`}
                  >
                    <span>{t(tab.labelKey)}</span>
                    {hasError && (
                      <span className="px-1.5 py-0.5 text-[10px] rounded bg-[var(--color-error-bg)] text-[var(--color-error-text)] border border-[var(--color-error-border)]">
                        {t('admin.content.form.tabHasErrorBadge')}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            {/* Tab 1: Basic Info + Thumbnail + Article Editor */}
            {activeTab === 'basic' && (
              <section className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-[var(--shadow-card)] p-5 sm:p-6 space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                  <div className="space-y-1">
                    <FormField
                      id="content-title"
                      label={t('admin.content.field.title')}
                      value={title}
                      onChange={handleTitleChange}
                      placeholder={t('admin.content.field.titlePlaceholder')}
                      required
                    />
                    <p
                      className={`text-xs tabular-nums-strict ${
                        title.trim().length > CONTENT_TITLE_MAX_LENGTH
                          ? 'text-[var(--color-error-text)] font-semibold'
                          : 'text-[var(--color-muted)]'
                      }`}
                    >
                      {t('admin.content.field.titleCounter', {
                        count: toPersianDigits(title.trim().length),
                      })}
                    </p>
                  </div>

                  <FormField
                    id="content-slug"
                    label={t('admin.content.field.slug')}
                    value={slug}
                    onChange={(val) => {
                      setSlugManuallyEdited(true);
                      setSlug(val);
                    }}
                    placeholder={t('admin.content.field.slugPlaceholder')}
                  />
                </div>

                <div className="space-y-1">
                  <FormField
                    id="content-summary"
                    label={t('admin.content.field.summary')}
                    kind="textarea"
                    rows={3}
                    value={summary}
                    onChange={setSummary}
                    placeholder={t('admin.content.field.summaryPlaceholder')}
                    required
                  />
                  <p
                    className={`text-xs tabular-nums-strict ${
                      summary.trim().length > CONTENT_SUMMARY_MAX_LENGTH
                        ? 'text-[var(--color-error-text)] font-semibold'
                        : 'text-[var(--color-muted)]'
                    }`}
                  >
                    {t('admin.content.field.summaryCounter', {
                      count: toPersianDigits(summary.trim().length),
                    })}
                  </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-5 items-start">
                  <FormField
                    id="content-format"
                    label={t('admin.content.field.format')}
                    kind="select"
                    value={format}
                    onChange={(val) => setFormat(val as ContentFormat)}
                    options={formatOptions}
                  />

                  <FormField
                    id="content-minutes"
                    label={t('admin.content.field.minutes')}
                    value={readWatchMinutes}
                    onChange={setReadWatchMinutes}
                    placeholder={t('admin.content.field.minutesPlaceholder')}
                  />

                  <div className="pt-7">
                    <label className="inline-flex items-center gap-2.5 text-sm font-medium text-[var(--color-text)] cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={isFeatured}
                        onChange={(e) => setIsFeatured(e.target.checked)}
                        className="w-4 h-4 accent-[var(--color-primary)]"
                      />
                      <span>{t('admin.content.field.isFeatured')}</span>
                    </label>
                  </div>
                </div>

                {format === 'Book' && (
                  <Alert variant="info" message={t('admin.content.field.phase2FormatHint')} />
                )}

                {format === 'Film' && (
                  <div className="p-4 sm:p-5 rounded-[var(--radius-control)] border border-[var(--color-border-strong)] bg-[var(--color-surface-alt)] space-y-4">
                    <div className="space-y-1">
                      <h2 className="text-sm sm:text-base font-bold text-[var(--color-text)]">
                        {t('admin.content.film.sectionTitle')}
                      </h2>
                      <p className="text-xs text-[var(--color-muted)]">
                        {t('admin.content.film.sectionSubtitle')}
                      </p>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <FormField
                        id="content-film-kind"
                        label={t('admin.content.film.kindLabel')}
                        kind="select"
                        value={filmKind}
                        onChange={(val) => setFilmKind(val as FilmKind)}
                        options={filmKindOptions}
                      />

                      <FormField
                        id="content-film-year"
                        label={t('admin.content.film.releaseYearLabel')}
                        value={filmReleaseYear}
                        onChange={setFilmReleaseYear}
                        placeholder={t('admin.content.film.releaseYearPlaceholder')}
                      />

                      <FormField
                        id="content-film-runtime"
                        label={t('admin.content.film.runtimeMinutesLabel')}
                        value={filmRuntimeMinutes}
                        onChange={setFilmRuntimeMinutes}
                        placeholder={t('admin.content.film.runtimeMinutesPlaceholder')}
                      />
                    </div>

                    <div className="space-y-1">
                      <FormField
                        id="content-film-age-note"
                        label={t('admin.content.film.ageRatingNoteLabel')}
                        kind="textarea"
                        rows={2}
                        value={filmAgeRatingNote}
                        onChange={setFilmAgeRatingNote}
                        placeholder={t('admin.content.film.ageRatingNotePlaceholder')}
                      />
                      <p
                        className={`text-xs tabular-nums-strict ${
                          filmAgeRatingNote.trim().length > FILM_AGE_RATING_NOTE_MAX_LENGTH
                            ? 'text-[var(--color-error-text)] font-semibold'
                            : 'text-[var(--color-muted)]'
                        }`}
                      >
                        {t('admin.content.film.ageRatingNoteCounter', {
                          count: toPersianDigits(filmAgeRatingNote.trim().length),
                        })}
                      </p>
                    </div>

                    <div className="space-y-1">
                      <label className="inline-flex items-center gap-2.5 text-sm font-medium text-[var(--color-text)] cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={filmIsWeeklyPick}
                          onChange={(e) => setFilmIsWeeklyPick(e.target.checked)}
                          className="w-4 h-4 accent-[var(--color-primary)]"
                        />
                        <span>{t('admin.content.film.weeklyPickLabel')}</span>
                      </label>
                      <p className="text-xs text-[var(--color-muted)] leading-relaxed">
                        {t('admin.content.film.weeklyPickHint')}
                      </p>
                    </div>
                  </div>
                )}

                {/* Thumbnail Uploader (Public IFileStorage) */}
                <div className="p-4 rounded-[var(--radius-control)] border border-[var(--color-border)] bg-[var(--color-surface-alt)] space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <span className="text-sm font-semibold text-[var(--color-text)]">
                      {t('admin.content.field.thumbnail')}
                    </span>
                    <div className="flex flex-wrap items-center gap-2">
                      <input
                        ref={thumbFileInputRef}
                        type="file"
                        accept=".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp"
                        onChange={(e) => void handlePickThumbnail(e)}
                        className="hidden"
                      />
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={isUploadingThumb}
                        onClick={() => thumbFileInputRef.current?.click()}
                        startIcon={<ImagePlus className="w-4 h-4" />}
                      >
                        {thumbnailKey
                          ? t('admin.content.field.thumbnailChange')
                          : t('admin.content.field.thumbnailPick')}
                      </Button>

                      {thumbnailKey && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={handleRemoveThumbnail}
                          startIcon={<Trash2 className="w-4 h-4" />}
                        >
                          {t('admin.content.field.thumbnailRemove')}
                        </Button>
                      )}
                    </div>
                  </div>

                  {thumbnailPreviewUrl ? (
                    <div className="w-48 aspect-video rounded-[var(--radius-control)] overflow-hidden border border-[var(--color-border)] bg-[var(--color-surface)]">
                      <img
                        src={thumbnailPreviewUrl}
                        alt={title || t('admin.content.field.thumbnail')}
                        className="w-full h-full object-cover"
                      />
                    </div>
                  ) : (
                    <p className="text-xs text-[var(--color-muted)]">
                      {t('admin.content.field.thumbnailMissing')}
                    </p>
                  )}
                </div>

                {/* Article HTML Editor with Toolbar & Sanitized Preview */}
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <label
                        htmlFor="content-body-editor"
                        className="block text-sm font-semibold text-[var(--color-text)]"
                      >
                        {t('admin.content.field.body')}
                      </label>
                      <p className="text-xs text-[var(--color-muted)] mt-0.5">
                        {t('admin.content.field.bodyHint')}
                      </p>
                    </div>

                    <Button
                      size="sm"
                      variant={showBodyPreview ? 'primary' : 'outline'}
                      onClick={() => setShowBodyPreview((prev) => !prev)}
                      startIcon={<Eye className="w-4 h-4" />}
                    >
                      {t('admin.content.editor.togglePreview')}
                    </Button>
                  </div>

                  <div
                    role="toolbar"
                    aria-label={t('admin.content.editor.toolbarLabel')}
                    className="flex flex-wrap items-center gap-1.5 p-2 rounded-[var(--radius-control)] border border-[var(--color-border)] bg-[var(--color-surface-alt)]"
                  >
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => insertHtmlSnippet('<h2>', '</h2>', t('admin.content.editor.btnH2'))}
                      startIcon={<Heading2 className="w-3.5 h-3.5" />}
                    >
                      {t('admin.content.editor.btnH2')}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => insertHtmlSnippet('<h3>', '</h3>', t('admin.content.editor.btnH3'))}
                      startIcon={<Heading3 className="w-3.5 h-3.5" />}
                    >
                      {t('admin.content.editor.btnH3')}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        insertHtmlSnippet('<strong>', '</strong>', t('admin.content.editor.btnBold'))
                      }
                      startIcon={<Bold className="w-3.5 h-3.5" />}
                    >
                      {t('admin.content.editor.btnBold')}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => insertHtmlSnippet('<em>', '</em>', t('admin.content.editor.btnItalic'))}
                      startIcon={<Italic className="w-3.5 h-3.5" />}
                    >
                      {t('admin.content.editor.btnItalic')}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        insertHtmlSnippet('<ul>\n  <li>', '</li>\n</ul>', t('admin.content.editor.btnList'))
                      }
                      startIcon={<List className="w-3.5 h-3.5" />}
                    >
                      {t('admin.content.editor.btnList')}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        insertHtmlSnippet(
                          '<blockquote>',
                          '</blockquote>',
                          t('admin.content.editor.btnQuote'),
                        )
                      }
                      startIcon={<Quote className="w-3.5 h-3.5" />}
                    >
                      {t('admin.content.editor.btnQuote')}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setLinkModalError(null);
                        setLinkModalOpen(true);
                      }}
                      startIcon={<Link2 className="w-3.5 h-3.5" />}
                    >
                      {t('admin.content.editor.btnLink')}
                    </Button>
                  </div>

                  <textarea
                    ref={bodyTextareaRef}
                    id="content-body-editor"
                    rows={10}
                    value={body}
                    onChange={(e) => setBody(e.target.value)}
                    className="w-full rounded-[var(--radius-control)] bg-[var(--color-surface)] text-[var(--color-text)] border border-[var(--color-border-strong)] px-3.5 py-2.5 text-sm leading-relaxed focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--color-primary)]"
                  />

                  {showBodyPreview && (
                    <div className="p-4 rounded-[var(--radius-control)] border border-[var(--color-border)] bg-[var(--color-surface-alt)] space-y-2">
                      <p className="text-xs font-semibold text-[var(--color-muted)]">
                        {t('admin.content.editor.previewTitle')}
                      </p>
                      <div className="p-4 rounded-[var(--radius-control)] bg-[var(--color-surface)] border border-[var(--color-border)] text-sm text-[var(--color-text)]">
                        <SanitizedHtmlPreview html={body} />
                      </div>
                    </div>
                  )}
                </div>
              </section>
            )}

            {/* Tab 2: Files (Hybrid Local IFileStorage + External URL) */}
            {activeTab === 'files' && (
              <section className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-[var(--shadow-card)] p-5 sm:p-6 space-y-6">
                <div className="max-w-xs">
                  <FormField
                    id="new-file-kind"
                    label={t('admin.content.files.kindLabel')}
                    kind="select"
                    value={String(newFileKind)}
                    onChange={(val) => setNewFileKind(Number(val) as ContentFileKind)}
                    options={fileKindOptions}
                  />
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                  {/* Method A: Private Local Upload */}
                  <div className="p-4 rounded-[var(--radius-control)] border border-[var(--color-border)] bg-[var(--color-surface-alt)] space-y-3">
                    <h2 className="text-sm font-bold text-[var(--color-text)] flex items-center gap-2">
                      <FileUp className="w-4 h-4 text-[var(--color-primary)] shrink-0" aria-hidden="true" />
                      <span>{t('admin.content.files.localTitle')}</span>
                    </h2>
                    <p className="text-xs text-[var(--color-muted)] leading-relaxed">
                      {t('admin.content.files.localHint')}
                    </p>

                    <label className="inline-flex items-center gap-2 text-xs sm:text-sm text-[var(--color-text)] cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={newLocalDownloadable}
                        onChange={(e) => setNewLocalDownloadable(e.target.checked)}
                        className="w-4 h-4 accent-[var(--color-primary)]"
                      />
                      <span>{t('admin.content.files.downloadableLabel')}</span>
                    </label>

                    <div>
                      <input
                        ref={localFileInputRef}
                        type="file"
                        onChange={(e) => void handlePickLocalContentFile(e)}
                        className="hidden"
                      />
                      <Button
                        variant="secondary"
                        disabled={isUploadingFile}
                        onClick={() => localFileInputRef.current?.click()}
                        startIcon={<Upload className="w-4 h-4" />}
                      >
                        {isUploadingFile
                          ? t('admin.content.files.uploading')
                          : t('admin.content.files.pickFileButton')}
                      </Button>
                    </div>
                  </div>

                  {/* Method B: External Link */}
                  <div className="p-4 rounded-[var(--radius-control)] border border-[var(--color-border)] bg-[var(--color-surface-alt)] space-y-3">
                    <h2 className="text-sm font-bold text-[var(--color-text)] flex items-center gap-2">
                      <Link2 className="w-4 h-4 text-[var(--color-primary)] shrink-0" aria-hidden="true" />
                      <span>{t('admin.content.files.externalTitle')}</span>
                    </h2>

                    <FormField
                      id="external-file-url"
                      label={t('admin.content.files.externalUrlLabel')}
                      value={externalUrlInput}
                      onChange={setExternalUrlInput}
                      placeholder={t('admin.content.files.externalUrlPlaceholder')}
                    />

                    {externalPreviewCheck?.isValid && (
                      <div>
                        <Tag
                          variant={externalPreviewCheck.isEmbedAllowed ? 'success' : 'neutral'}
                          label={
                            externalPreviewCheck.isEmbedAllowed
                              ? t('admin.content.files.embedAllowedBadge')
                              : t('admin.content.files.externalLinkOnlyBadge')
                          }
                        />
                      </div>
                    )}

                    <FormField
                      id="external-file-name"
                      label={t('admin.content.files.externalNameLabel')}
                      value={externalNameInput}
                      onChange={setExternalNameInput}
                      placeholder={t('admin.content.files.externalNamePlaceholder')}
                    />

                    <p className="text-xs text-[var(--color-muted)]">
                      {t('admin.content.files.externalNotDownloadableNote')}
                    </p>

                    <Button
                      variant="outline"
                      onClick={handleAddExternalFile}
                      startIcon={<Plus className="w-4 h-4" />}
                    >
                      {t('admin.content.files.addExternalButton')}
                    </Button>
                  </div>
                </div>

                {/* Attached Files List */}
                <div className="space-y-3">
                  {files.length === 0 ? (
                    <p className="text-xs sm:text-sm text-[var(--color-muted)] py-4 text-center border border-dashed border-[var(--color-border)] rounded-[var(--radius-control)]">
                      {t('admin.content.files.empty')}
                    </p>
                  ) : (
                    <ul className="divide-y divide-[var(--color-border)] border border-[var(--color-border)] rounded-[var(--radius-control)]">
                      {files.map((file, idx) => {
                        const isExternal = file.storageType === FileStorageType.External;
                        const extValidation =
                          isExternal && file.externalUrl
                            ? validateExternalUrl(file.externalUrl)
                            : null;

                        return (
                          <li
                            key={`${file.storageKey ?? file.externalUrl ?? idx}-${idx}`}
                            className="p-3.5 flex flex-wrap items-center justify-between gap-3"
                          >
                            <div className="min-w-0 space-y-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="font-semibold text-sm text-[var(--color-text)]">
                                  {file.originalFileName}
                                </span>
                                <Tag label={t(getFileKindResourceKey(file.kind))} variant="neutral" />
                                <Tag
                                  label={
                                    isExternal
                                      ? t('content.storageType.External')
                                      : t('content.storageType.Local')
                                  }
                                  variant={isExternal ? 'accent' : 'primary'}
                                />
                                {extValidation && (
                                  <Tag
                                    label={
                                      extValidation.isEmbedAllowed
                                        ? t('admin.content.files.embedAllowedBadge')
                                        : t('admin.content.files.externalLinkOnlyBadge')
                                    }
                                    variant={extValidation.isEmbedAllowed ? 'success' : 'neutral'}
                                  />
                                )}
                              </div>
                              <div className="flex flex-wrap items-center gap-3 text-xs text-[var(--color-muted)] tabular-nums-strict">
                                <span>{formatFileSize(file.sizeBytes)}</span>
                                {isExternal && file.externalUrl ? (
                                  <span dir="ltr" className="font-mono truncate max-w-xs">
                                    {file.externalUrl}
                                  </span>
                                ) : file.storageKey ? (
                                  <span dir="ltr" className="font-mono truncate max-w-xs">
                                    {file.storageKey}
                                  </span>
                                ) : null}
                              </div>
                            </div>

                            <div className="flex flex-wrap items-center gap-2">
                              <label className="inline-flex items-center gap-1.5 text-xs text-[var(--color-text)] select-none">
                                <input
                                  type="checkbox"
                                  checked={isExternal ? false : file.isDownloadable}
                                  disabled={isExternal}
                                  onChange={(e) => toggleFileDownloadable(idx, e.target.checked)}
                                  className="w-4 h-4 accent-[var(--color-primary)]"
                                />
                                <span>{t('admin.content.files.downloadableLabel')}</span>
                              </label>

                              <Button
                                size="sm"
                                variant="ghost"
                                disabled={idx === 0}
                                aria-label={t('admin.content.files.moveUp')}
                                onClick={() => moveFile(idx, -1)}
                                startIcon={<ArrowUp className="w-3.5 h-3.5" />}
                              >
                                {toPersianDigits(idx + 1)}
                              </Button>

                              <Button
                                size="sm"
                                variant="ghost"
                                disabled={idx === files.length - 1}
                                aria-label={t('admin.content.files.moveDown')}
                                onClick={() => moveFile(idx, 1)}
                                startIcon={<ArrowDown className="w-3.5 h-3.5" />}
                              >
                                {t('admin.content.files.sortLabel')}
                              </Button>

                              <Button
                                size="sm"
                                variant="danger"
                                onClick={() => removeFileAt(idx)}
                                startIcon={<Trash2 className="w-3.5 h-3.5" />}
                              >
                                {t('admin.content.files.remove')}
                              </Button>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              </section>
            )}

            {/* Tab 3: Mandatory Sources */}
            {activeTab === 'sources' && (
              <section className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-[var(--shadow-card)] p-5 sm:p-6 space-y-5">
                <Alert variant="info" message={t('admin.content.sources.mandatoryBanner')} />

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 p-4 rounded-[var(--radius-control)] border border-[var(--color-border)] bg-[var(--color-surface-alt)]">
                  <FormField
                    id="source-title"
                    label={t('admin.content.sources.titleLabel')}
                    value={sourceTitleInput}
                    onChange={setSourceTitleInput}
                    placeholder={t('admin.content.sources.titlePlaceholder')}
                    required
                  />
                  <FormField
                    id="source-url"
                    label={t('admin.content.sources.urlLabel')}
                    value={sourceUrlInput}
                    onChange={setSourceUrlInput}
                    placeholder={t('admin.content.sources.urlPlaceholder')}
                  />
                  <FormField
                    id="source-note"
                    label={t('admin.content.sources.noteLabel')}
                    value={sourceNoteInput}
                    onChange={setSourceNoteInput}
                    placeholder={t('admin.content.sources.notePlaceholder')}
                  />

                  <div className="md:col-span-3 flex justify-end">
                    <Button
                      variant="secondary"
                      onClick={handleAddSource}
                      startIcon={<Plus className="w-4 h-4" />}
                    >
                      {t('admin.content.sources.addButton')}
                    </Button>
                  </div>
                </div>

                {sources.length === 0 ? (
                  <p className="text-xs sm:text-sm text-[var(--color-muted)] py-4 text-center border border-dashed border-[var(--color-border)] rounded-[var(--radius-control)]">
                    {t('admin.content.sources.empty')}
                  </p>
                ) : (
                  <ul className="divide-y divide-[var(--color-border)] border border-[var(--color-border)] rounded-[var(--radius-control)]">
                    {sources.map((src, idx) => (
                      <li
                        key={`${src.title}-${idx}`}
                        className="p-3.5 flex flex-wrap items-start justify-between gap-3"
                      >
                        <div className="min-w-0 space-y-1">
                          <p className="text-sm font-semibold text-[var(--color-text)]">
                            {toPersianDigits(idx + 1)}. {src.title}
                          </p>
                          {src.url && isSafeAnchorHref(src.url) && (
                            <a
                              href={src.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              dir="ltr"
                              className="inline-block text-xs font-mono text-[var(--color-primary)] underline underline-offset-4 break-all"
                            >
                              {src.url}
                            </a>
                          )}
                          {src.note && (
                            <p className="text-xs text-[var(--color-muted)]">{src.note}</p>
                          )}
                        </div>

                        <div className="flex items-center gap-1.5">
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={idx === 0}
                            aria-label={t('admin.content.files.moveUp')}
                            onClick={() => moveSource(idx, -1)}
                            startIcon={<ArrowUp className="w-3.5 h-3.5" />}
                          >
                            {toPersianDigits(idx + 1)}
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={idx === sources.length - 1}
                            aria-label={t('admin.content.files.moveDown')}
                            onClick={() => moveSource(idx, 1)}
                            startIcon={<ArrowDown className="w-3.5 h-3.5" />}
                          >
                            {t('admin.content.files.sortLabel')}
                          </Button>
                          <Button
                            size="sm"
                            variant="danger"
                            onClick={() => removeSourceAt(idx)}
                            startIcon={<Trash2 className="w-3.5 h-3.5" />}
                          >
                            {t('admin.content.sources.remove')}
                          </Button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            )}

            {/* Tab 4: Taxonomy (Hierarchical Topics, Tags, Persons, ImpactLevel) */}
            {activeTab === 'taxonomy' && (
              <section className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-[var(--shadow-card)] p-5 sm:p-6 space-y-6">
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  {/* Topics Tree */}
                  <div className="space-y-3">
                    <h2 className="text-sm font-bold text-[var(--color-text)]">
                      {t('admin.content.taxonomy.topicsTitle')}
                    </h2>
                    {flattenedTopics.length === 0 ? (
                      <p className="text-xs text-[var(--color-muted)]">
                        {t('admin.content.taxonomy.topicsEmpty')}
                      </p>
                    ) : (
                      <div className="max-h-72 overflow-y-auto p-3 rounded-[var(--radius-control)] border border-[var(--color-border)] space-y-2">
                        {flattenedTopics.map(({ topic, depth }) => (
                          <label
                            key={topic.id}
                            style={{ paddingRight: `${depth * 18}px` }}
                            className="flex items-center gap-2 text-sm text-[var(--color-text)] cursor-pointer select-none"
                          >
                            <input
                              type="checkbox"
                              checked={topicIds.includes(topic.id)}
                              onChange={() => toggleIdSelection(topic.id, setTopicIds)}
                              className="w-4 h-4 accent-[var(--color-primary)] shrink-0"
                            />
                            <span className={topic.isActive ? '' : 'opacity-60'}>
                              {topic.name}
                            </span>
                          </label>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Impact Level */}
                  <div className="space-y-4">
                    <FormField
                      id="content-impact-level"
                      label={t('admin.content.taxonomy.impactLevelTitle')}
                      kind="select"
                      value={impactLevelId}
                      onChange={setImpactLevelId}
                      options={impactLevelOptions}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  {/* Tags Multi-Select */}
                  <div className="space-y-2.5">
                    <FormField
                      id="content-tags-search"
                      label={t('admin.content.taxonomy.tagsTitle')}
                      type="search"
                      value={tagSearch}
                      onChange={setTagSearch}
                      placeholder={t('admin.content.taxonomy.tagsSearchPlaceholder')}
                    />
                    <div className="max-h-56 overflow-y-auto p-3 rounded-[var(--radius-control)] border border-[var(--color-border)] flex flex-wrap gap-2">
                      {filteredTags.map((tag) => {
                        const checked = tagIds.includes(tag.id);
                        return (
                          <label
                            key={tag.id}
                            className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-[var(--radius-tag)] border text-xs cursor-pointer select-none transition-colors ${
                              checked
                                ? 'bg-[var(--color-primary-button)] text-[var(--color-on-primary)] border-transparent'
                                : 'bg-[var(--color-surface-alt)] text-[var(--color-text)] border-[var(--color-border)]'
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => toggleIdSelection(tag.id, setTagIds)}
                              className="sr-only"
                            />
                            <span>{tag.name}</span>
                          </label>
                        );
                      })}
                    </div>
                  </div>

                  {/* Persons Multi-Select */}
                  <div className="space-y-2.5">
                    <FormField
                      id="content-persons-search"
                      label={t('admin.content.taxonomy.personsTitle')}
                      type="search"
                      value={personSearch}
                      onChange={setPersonSearch}
                      placeholder={t('admin.content.taxonomy.personsSearchPlaceholder')}
                    />
                    <div className="max-h-56 overflow-y-auto p-3 rounded-[var(--radius-control)] border border-[var(--color-border)] space-y-2">
                      {filteredPersons.map((person) => (
                        <label
                          key={person.id}
                          className="flex items-center gap-2 text-sm text-[var(--color-text)] cursor-pointer select-none"
                        >
                          <input
                            type="checkbox"
                            checked={personIds.includes(person.id)}
                            onChange={() => toggleIdSelection(person.id, setPersonIds)}
                            className="w-4 h-4 accent-[var(--color-primary)] shrink-0"
                          />
                          <span>{person.name}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                </div>
              </section>
            )}

            {/* Tab 5: Audience (AgeGroups) */}
            {activeTab === 'audience' && (
              <section className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-[var(--shadow-card)] p-5 sm:p-6 space-y-5">
                <Alert variant="info" message={t('admin.content.audience.infoBanner')} />

                <div className="space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h2 className="text-sm font-bold text-[var(--color-text)]">
                      {t('admin.content.audience.title')}
                    </h2>
                    <span className="text-xs font-medium text-[var(--color-muted)] tabular-nums-strict">
                      {ageGroupIds.length === 0
                        ? t('admin.content.audience.allAgesSelected')
                        : t('admin.content.audience.specificCountSelected', {
                            count: toPersianDigits(ageGroupIds.length),
                          })}
                    </span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
                    {activeAgeGroups.map((group) => (
                      <label
                        key={group.id}
                        className="flex items-center gap-2.5 p-3 rounded-[var(--radius-control)] border border-[var(--color-border)] bg-[var(--color-surface-alt)] text-sm text-[var(--color-text)] cursor-pointer select-none"
                      >
                        <input
                          type="checkbox"
                          checked={ageGroupIds.includes(group.id)}
                          onChange={() => toggleIdSelection(group.id, setAgeGroupIds)}
                          className="w-4 h-4 accent-[var(--color-primary)] shrink-0"
                        />
                        <span>{formatAgeGroupWithRange(group)}</span>
                      </label>
                    ))}
                  </div>
                </div>
              </section>
            )}
          </div>
        )}
      </div>

      {/* Insert Safe Link Modal */}
      <Modal
        open={linkModalOpen}
        onClose={() => setLinkModalOpen(false)}
        title={t('admin.content.editor.btnLink')}
        footer={
          <>
            <Button variant="ghost" onClick={() => setLinkModalOpen(false)}>
              {t('admin.content.common.cancel')}
            </Button>
            <Button variant="primary" onClick={handleInsertSafeLink}>
              {t('admin.content.editor.linkInsertSubmit')}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {linkModalError && <Alert variant="error" message={linkModalError} />}
          <FormField
            id="editor-link-url"
            label={t('admin.content.editor.linkUrlLabel')}
            value={linkUrlInput}
            onChange={setLinkUrlInput}
            placeholder={t('admin.content.sources.urlPlaceholder')}
            required
          />
          <FormField
            id="editor-link-text"
            label={t('admin.content.editor.linkTextLabel')}
            value={linkTextInput}
            onChange={setLinkTextInput}
            placeholder={t('admin.content.editor.linkDefaultText')}
          />
        </div>
      </Modal>

      {/* Safe Archive Confirmation Modal */}
      <Modal
        open={archiveModalOpen}
        onClose={() => setArchiveModalOpen(false)}
        title={t('admin.content.list.archiveConfirmTitle')}
        footer={
          <>
            <Button
              variant="ghost"
              disabled={isArchiving}
              onClick={() => setArchiveModalOpen(false)}
            >
              {t('admin.content.common.cancel')}
            </Button>
            <Button
              variant="danger"
              disabled={isArchiving}
              onClick={() => void handleArchive()}
              startIcon={<Archive className="w-4 h-4" />}
            >
              {t('admin.content.list.archiveConfirmSubmit')}
            </Button>
          </>
        }
      >
        <p className="text-sm text-[var(--color-text)] leading-relaxed">
          {t('admin.content.list.archiveConfirmBody', { title: title || slug })}
        </p>
      </Modal>
    </AdminLayout>
  );
}
