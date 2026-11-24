import {
  BookOpen,
  Download,
  Edit3,
  ExternalLink,
  Film as FilmIcon,
  Gamepad2,
  Plus,
  Search,
  Settings,
  Sparkles,
  Trash2,
  Upload,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState, type ChangeEvent } from 'react';
import { ContentStatus } from '../../../core/domain/content';
import type { AdminGameListItem } from '../../../core/domain/games';
import {
  BOOK_AUTHOR_MAX_LENGTH,
  BOOK_KEY_EXCERPTS_MAX_LENGTH,
  BOOK_STUDIO_NOTE_MAX_LENGTH,
  FILM_AGE_RATING_NOTE_MAX_LENGTH,
  FILM_KINDS,
  type AdminBookListItem,
  type AdminFilmListItem,
  type FilmKind,
} from '../../../core/domain/portals';
import type { AgeGroup, Topic } from '../../../core/domain/taxonomy';
import { useAuth } from '../../auth/AuthContext';
import {
  Alert,
  Button,
  FormField,
  Modal,
  Table,
  Tag,
  type SelectOption,
  type TableColumn,
} from '../../components/ui';
import type { ResourceKey } from '../../resources/fa';
import {
  formatFileSizeParts,
  toPersianDigits,
} from '../../resources/formatters';
import { t } from '../../resources/i18n';
import { navigateToHash } from '../../router/HashRouter';
import { appContainer } from '../../services/appContainer';
import { AdminLayout } from '../AdminLayout';

interface AdminPortalsPageProps {
  currentRoute: string;
}

type PortalsTabKey = 'films' | 'books' | 'games';

function getStatusVariant(status: ContentStatus): 'success' | 'warning' | 'neutral' {
  switch (status) {
    case ContentStatus.Published:
      return 'success';
    case ContentStatus.Archived:
      return 'warning';
    case ContentStatus.Draft:
    default:
      return 'neutral';
  }
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

export function AdminPortalsPage({ currentRoute }: AdminPortalsPageProps) {
  const { currentUser, isFilmsEnabled, isBooksEnabled, isGamesEnabled } = useAuth();

  const [activeTab, setActiveTab] = useState<PortalsTabKey>('films');
  const [feedback, setFeedback] = useState<{
    variant: 'success' | 'error' | 'warning';
    message: string;
  } | null>(null);

  // Films Tab State
  const [filmSearchQuery, setFilmSearchQuery] = useState('');
  const [films, setFilms] = useState<AdminFilmListItem[]>([]);
  const [isLoadingFilms, setIsLoadingFilms] = useState(true);
  const [busyWeeklyPickId, setBusyWeeklyPickId] = useState<number | null>(null);

  // Quick edit Film modal state
  const [editingFilmRow, setEditingFilmRow] = useState<AdminFilmListItem | null>(null);
  const [modalKind, setModalKind] = useState<FilmKind>('Film');
  const [modalYear, setModalYear] = useState('');
  const [modalRuntime, setModalRuntime] = useState('');
  const [modalAgeNote, setModalAgeNote] = useState('');
  const [modalWeeklyPick, setModalWeeklyPick] = useState(false);
  const [filmModalError, setFilmModalError] = useState<string | null>(null);
  const [isSavingFilmModal, setIsSavingFilmModal] = useState(false);

  // Books Tab State
  const [bookSearchQuery, setBookSearchQuery] = useState('');
  const [books, setBooks] = useState<AdminBookListItem[]>([]);
  const [isLoadingBooks, setIsLoadingBooks] = useState(true);

  // Quick edit Book modal state
  const [editingBookRow, setEditingBookRow] = useState<AdminBookListItem | null>(null);
  const [modalBookAuthor, setModalBookAuthor] = useState('');
  const [modalBookPublisher, setModalBookPublisher] = useState('');
  const [modalBookPublishYear, setModalBookPublishYear] = useState('');
  const [modalBookPages, setModalBookPages] = useState('');
  const [modalBookKeyExcerpts, setModalBookKeyExcerpts] = useState('');
  const [modalBookStudioNote, setModalBookStudioNote] = useState('');
  const [bookModalError, setBookModalError] = useState<string | null>(null);
  const [isSavingBookModal, setIsSavingBookModal] = useState(false);

  // Games Tab State (Stage 29)
  const [gameSearchQuery, setGameSearchQuery] = useState('');
  const [games, setGames] = useState<AdminGameListItem[]>([]);
  const [isLoadingGames, setIsLoadingGames] = useState(true);
  const [allTopics, setAllTopics] = useState<Topic[]>([]);
  const [allAgeGroups, setAllAgeGroups] = useState<AgeGroup[]>([]);
  const [isInstallingSampleGame, setIsInstallingSampleGame] = useState(false);
  const [busyGameId, setBusyGameId] = useState<number | null>(null);

  // Game Create/Edit Modal State
  const [gameModalOpen, setGameModalOpen] = useState(false);
  const [editingGameRow, setEditingGameRow] = useState<AdminGameListItem | null>(null);
  const [gameTitle, setGameTitle] = useState('');
  const [gameDescription, setGameDescription] = useState('');
  const [gameEndMessage, setGameEndMessage] = useState('');
  const [gameTopicId, setGameTopicId] = useState<string>('');
  const [gameMaxScore, setGameMaxScore] = useState('100');
  const [gameAgeGroupIds, setGameAgeGroupIds] = useState<number[]>([]);
  const [gameIsPublished, setGameIsPublished] = useState(true);
  const [gameThumbnailKey, setGameThumbnailKey] = useState<string | null>(null);
  const [gameZipFileName, setGameZipFileName] = useState('');
  const [gameZipBytes, setGameZipBytes] = useState<Uint8Array | null>(null);
  const [gameModalError, setGameModalError] = useState<string | null>(null);
  const [isSavingGameModal, setIsSavingGameModal] = useState(false);
  const [isUploadingThumb, setIsUploadingThumb] = useState(false);

  // Game Delete Confirm Modal
  const [deletingGameRow, setDeletingGameRow] = useState<AdminGameListItem | null>(null);
  const [isDeletingGame, setIsDeletingGame] = useState(false);

  const loadFilms = useCallback(async () => {
    setIsLoadingFilms(true);
    try {
      const res = await appContainer.filmPortalService.listAdminFilmsAsync(
        currentUser,
        filmSearchQuery,
      );
      if (res.ok && res.data) {
        setFilms(res.data);
      } else {
        setFilms([]);
        if (res.messageKey) {
          setFeedback({
            variant: 'error',
            message: t(res.messageKey as ResourceKey),
          });
        }
      }
    } finally {
      setIsLoadingFilms(false);
    }
  }, [currentUser, filmSearchQuery]);

  const loadBooks = useCallback(async () => {
    setIsLoadingBooks(true);
    try {
      const res = await appContainer.bookPortalService.listAdminBooksAsync(
        currentUser,
        bookSearchQuery,
      );
      if (res.ok && res.data) {
        setBooks(res.data);
      } else {
        setBooks([]);
        if (res.messageKey) {
          setFeedback({
            variant: 'error',
            message: t(res.messageKey as ResourceKey),
          });
        }
      }
    } finally {
      setIsLoadingBooks(false);
    }
  }, [currentUser, bookSearchQuery]);

  const loadGames = useCallback(async () => {
    setIsLoadingGames(true);
    try {
      const [res, topicsList, agesList] = await Promise.all([
        appContainer.gamePortalService.listAdminGamesAsync(
          currentUser,
          gameSearchQuery,
        ),
        appContainer.taxonomyRepository.getAllTopics(),
        appContainer.adminRepository.getActiveAgeGroups(),
      ]);
      setAllTopics(topicsList);
      setAllAgeGroups(agesList);
      if (res.ok && res.data) {
        setGames(res.data);
      } else {
        setGames([]);
        if (res.messageKey) {
          setFeedback({
            variant: 'error',
            message: t(res.messageKey as ResourceKey),
          });
        }
      }
    } finally {
      setIsLoadingGames(false);
    }
  }, [currentUser, gameSearchQuery]);

  useEffect(() => {
    void loadFilms();
  }, [loadFilms]);

  useEffect(() => {
    void loadBooks();
  }, [loadBooks]);

  useEffect(() => {
    void loadGames();
  }, [loadGames]);

  const currentWeeklyPick = useMemo(
    () => films.find((row) => row.filmInfo.isWeeklyPick) ?? null,
    [films],
  );

  const filmKindOptions: SelectOption[] = useMemo(
    () =>
      FILM_KINDS.map((kind) => ({
        value: kind,
        label: t(getKindLabelKey(kind)),
      })),
    [],
  );

  const handleSetWeeklyPick = async (row: AdminFilmListItem) => {
    setBusyWeeklyPickId(row.item.id);
    setFeedback(null);
    try {
      const res = await appContainer.filmPortalService.setWeeklyPickAsync(
        currentUser,
        row.item.id,
      );
      if (!res.ok) {
        setFeedback({
          variant: 'error',
          message: res.messageKey
            ? t(res.messageKey as ResourceKey)
            : t('admin.portals.film.error.contentNotFound'),
        });
        return;
      }
      await loadFilms();
      setFeedback({
        variant: 'success',
        message: t('admin.portals.films.feedback.weeklyPickSet', {
          title: row.item.title,
        }),
      });
    } finally {
      setBusyWeeklyPickId(null);
    }
  };

  const openQuickEditFilmModal = (row: AdminFilmListItem) => {
    setEditingFilmRow(row);
    setModalKind(row.filmInfo.kind);
    setModalYear(row.filmInfo.releaseYear !== null ? String(row.filmInfo.releaseYear) : '');
    setModalRuntime(
      row.filmInfo.runtimeMinutes !== null ? String(row.filmInfo.runtimeMinutes) : '',
    );
    setModalAgeNote(row.filmInfo.ageRatingNote ?? '');
    setModalWeeklyPick(row.filmInfo.isWeeklyPick);
    setFilmModalError(null);
  };

  const handleSaveFilmQuickEdit = async () => {
    if (!editingFilmRow) return;
    setIsSavingFilmModal(true);
    setFilmModalError(null);
    try {
      const res = await appContainer.filmPortalService.upsertFilmInfoAsync(
        currentUser,
        {
          contentId: editingFilmRow.item.id,
          kind: modalKind,
          releaseYear: modalYear,
          runtimeMinutes: modalRuntime,
          ageRatingNote: modalAgeNote,
          isWeeklyPick: modalWeeklyPick,
        },
        {
          sourceContext: 'portals',
          routePath: currentRoute,
        },
      );
      if (!res.ok) {
        setFilmModalError(
          res.messageKey
            ? t(res.messageKey as ResourceKey)
            : t('admin.portals.film.error.invalidReleaseYear'),
        );
        return;
      }
      const savedTitle = editingFilmRow.item.title;
      setEditingFilmRow(null);
      await loadFilms();
      setFeedback({
        variant: 'success',
        message: t('admin.portals.films.feedback.filmInfoSaved', {
          title: savedTitle,
        }),
      });
    } finally {
      setIsSavingFilmModal(false);
    }
  };

  const openQuickEditBookModal = (row: AdminBookListItem) => {
    setEditingBookRow(row);
    setModalBookAuthor(row.bookInfo.author);
    setModalBookPublisher(row.bookInfo.publisher ?? '');
    setModalBookPublishYear(
      row.bookInfo.publishYear !== null ? String(row.bookInfo.publishYear) : '',
    );
    setModalBookPages(
      row.bookInfo.pages !== null ? String(row.bookInfo.pages) : '',
    );
    setModalBookKeyExcerpts(row.bookInfo.keyExcerpts ?? '');
    setModalBookStudioNote(row.bookInfo.studioNote ?? '');
    setBookModalError(null);
  };

  const handleSaveBookQuickEdit = async () => {
    if (!editingBookRow) return;
    setIsSavingBookModal(true);
    setBookModalError(null);
    try {
      const res = await appContainer.bookPortalService.upsertBookInfoAsync(
        currentUser,
        {
          contentId: editingBookRow.item.id,
          author: modalBookAuthor,
          publisher: modalBookPublisher,
          publishYear: modalBookPublishYear,
          pages: modalBookPages,
          keyExcerpts: modalBookKeyExcerpts,
          studioNote: modalBookStudioNote,
        },
        {
          sourceContext: 'portals',
          routePath: currentRoute,
        },
      );
      if (!res.ok) {
        setBookModalError(
          res.messageKey
            ? t(res.messageKey as ResourceKey)
            : t('admin.portals.book.error.authorRequired'),
        );
        return;
      }
      const savedTitle = editingBookRow.item.title;
      setEditingBookRow(null);
      await loadBooks();
      setFeedback({
        variant: 'success',
        message: t('admin.portals.books.feedback.bookInfoSaved', {
          title: savedTitle,
        }),
      });
    } finally {
      setIsSavingBookModal(false);
    }
  };

  // Games Tab Handlers
  const ageGroupNameById = useMemo(
    () => new Map(allAgeGroups.map((ag) => [ag.id, ag.name])),
    [allAgeGroups],
  );

  const gameTopicOptions: SelectOption[] = useMemo(() => {
    const base: SelectOption[] = [
      { value: '', label: t('admin.portals.games.modal.noTopicOption') },
    ];
    for (const topic of allTopics) {
      base.push({ value: String(topic.id), label: topic.name });
    }
    return base;
  }, [allTopics]);

  const openCreateGameModal = () => {
    setEditingGameRow(null);
    setGameTitle('');
    setGameDescription('');
    setGameEndMessage('');
    setGameTopicId('');
    setGameMaxScore('100');
    setGameAgeGroupIds([]);
    setGameIsPublished(true);
    setGameThumbnailKey(null);
    setGameZipFileName('');
    setGameZipBytes(null);
    setGameModalError(null);
    setGameModalOpen(true);
  };

  const openEditGameModal = (row: AdminGameListItem) => {
    setEditingGameRow(row);
    setGameTitle(row.game.title);
    setGameDescription(row.game.description);
    setGameEndMessage(row.game.endMessage ?? '');
    setGameTopicId(row.game.topicId !== null ? String(row.game.topicId) : '');
    setGameMaxScore(String(row.game.maxScore));
    setGameAgeGroupIds([...row.ageGroupIds]);
    setGameIsPublished(row.game.isPublished);
    setGameThumbnailKey(row.game.thumbnailKey);
    setGameZipFileName('');
    setGameZipBytes(null);
    setGameModalError(null);
    setGameModalOpen(true);
  };

  const handleGameZipFileChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) {
      setGameZipFileName('');
      setGameZipBytes(null);
      return;
    }
    const buf = await file.arrayBuffer();
    setGameZipFileName(file.name);
    setGameZipBytes(new Uint8Array(buf));
    setGameModalError(null);
  };

  const handleGameThumbnailChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsUploadingThumb(true);
    setGameModalError(null);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const uploadRes = await appContainer.fileUploadService.uploadFileAsync(
        currentUser,
        {
          originalFileName: file.name,
          bytes,
          visibility: 'public',
        },
        {
          allowedPermissions: ['portals.manage', 'content.manage'],
          routePath: currentRoute,
        },
      );
      if (!uploadRes.ok || !uploadRes.metadata) {
        setGameModalError(
          uploadRes.messageKey
            ? t(uploadRes.messageKey as ResourceKey)
            : t('upload.error.unknown'),
        );
        return;
      }
      setGameThumbnailKey(uploadRes.metadata.storageKey);
    } finally {
      setIsUploadingThumb(false);
    }
  };

  const handleToggleGameAgeGroup = (ageGroupId: number) => {
    setGameAgeGroupIds((prev) =>
      prev.includes(ageGroupId)
        ? prev.filter((id) => id !== ageGroupId)
        : [...prev, ageGroupId],
    );
  };

  const handleSaveGameModal = async () => {
    setIsSavingGameModal(true);
    setGameModalError(null);
    try {
      const topicIdNum = gameTopicId ? Number.parseInt(gameTopicId, 10) : null;

      if (editingGameRow) {
        const res = await appContainer.gamePortalService.updateGameAsync(currentUser, {
          id: editingGameRow.game.id,
          title: gameTitle,
          description: gameDescription,
          endMessage: gameEndMessage,
          topicId: topicIdNum,
          maxScore: gameMaxScore,
          ageGroupIds: gameAgeGroupIds,
          isPublished: gameIsPublished,
          thumbnailKey: gameThumbnailKey,
          zipFileName: gameZipBytes ? gameZipFileName : undefined,
          zipBytes: gameZipBytes ?? undefined,
        });
        if (!res.ok || !res.data) {
          setGameModalError(
            res.messageKey
              ? t(res.messageKey as ResourceKey)
              : t('admin.portals.games.error.zipInvalidFormat'),
          );
          return;
        }
        setGameModalOpen(false);
        await loadGames();
        setFeedback({
          variant: 'success',
          message: t('admin.portals.games.feedback.updated', {
            title: res.data.title,
          }),
        });
      } else {
        if (!gameZipBytes || gameZipBytes.byteLength === 0) {
          setGameModalError(t('admin.portals.games.error.zipRequired'));
          return;
        }
        const res = await appContainer.gamePortalService.createGameFromZipAsync(
          currentUser,
          {
            title: gameTitle,
            description: gameDescription,
            endMessage: gameEndMessage,
            topicId: topicIdNum,
            maxScore: gameMaxScore,
            ageGroupIds: gameAgeGroupIds,
            isPublished: gameIsPublished,
            thumbnailKey: gameThumbnailKey,
            zipFileName: gameZipFileName || 'game.zip',
            zipBytes: gameZipBytes,
          },
        );
        if (!res.ok || !res.data) {
          setGameModalError(
            res.messageKey
              ? t(res.messageKey as ResourceKey)
              : t('admin.portals.games.error.zipInvalidFormat'),
          );
          return;
        }
        setGameModalOpen(false);
        await loadGames();
        setFeedback({
          variant: 'success',
          message: t('admin.portals.games.feedback.created', {
            title: res.data.title,
          }),
        });
      }
    } finally {
      setIsSavingGameModal(false);
    }
  };

  const handleToggleGamePublish = async (row: AdminGameListItem) => {
    setBusyGameId(row.game.id);
    setFeedback(null);
    try {
      const nextPublished = !row.game.isPublished;
      const res = await appContainer.gamePortalService.toggleGamePublishedAsync(
        currentUser,
        row.game.id,
        nextPublished,
      );
      if (!res.ok) {
        setFeedback({
          variant: 'error',
          message: res.messageKey
            ? t(res.messageKey as ResourceKey)
            : t('admin.portals.games.error.notFound'),
        });
        return;
      }
      await loadGames();
      setFeedback({
        variant: 'success',
        message: nextPublished
          ? t('admin.portals.games.feedback.published')
          : t('admin.portals.games.feedback.unpublished'),
      });
    } finally {
      setBusyGameId(null);
    }
  };

  const handleConfirmDeleteGame = async () => {
    if (!deletingGameRow) return;
    setIsDeletingGame(true);
    setFeedback(null);
    try {
      const res = await appContainer.gamePortalService.deleteGameAsync(
        currentUser,
        deletingGameRow.game.id,
      );
      if (!res.ok) {
        setFeedback({
          variant: 'error',
          message: res.messageKey
            ? t(res.messageKey as ResourceKey)
            : t('admin.portals.games.error.notFound'),
        });
        return;
      }
      setDeletingGameRow(null);
      await loadGames();
      setFeedback({
        variant: 'success',
        message: t('admin.portals.games.feedback.deleted'),
      });
    } finally {
      setIsDeletingGame(false);
    }
  };

  const handleInstallSampleGame = async () => {
    setIsInstallingSampleGame(true);
    setFeedback(null);
    try {
      const res = await appContainer.gamePortalService.installSampleEducationalGameAsync(
        currentUser,
        {
          title: t('admin.portals.games.sample.title'),
          description: t('admin.portals.games.sample.description'),
          endMessage: t('admin.portals.games.sample.endMessage'),
        },
      );
      if (!res.ok || !res.data) {
        setFeedback({
          variant: 'error',
          message: res.messageKey
            ? t(res.messageKey as ResourceKey)
            : t('admin.portals.games.error.zipInvalidFormat'),
        });
        return;
      }
      await loadGames();
      setFeedback({
        variant: 'success',
        message: t('admin.portals.games.feedback.sampleInstalled', {
          title: res.data.title,
        }),
      });
    } finally {
      setIsInstallingSampleGame(false);
    }
  };

  const handleDownloadSampleZip = async () => {
    const asset = await appContainer.gamePortalService.generateSampleZipAssetAsync();
    const copy = new Uint8Array(asset.bytes.byteLength);
    copy.set(asset.bytes);
    const blob = new Blob([copy.buffer], { type: 'application/zip' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = asset.fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const filmColumns: TableColumn<AdminFilmListItem>[] = [
    {
      key: 'title',
      header: t('admin.portals.films.col.title'),
      render: (row) => (
        <div className="space-y-1 min-w-[200px]">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-[var(--color-text)]">{row.item.title}</span>
            {row.filmInfo.isWeeklyPick && (
              <Tag label={t('admin.portals.films.weeklyPickActiveBadge')} variant="primary" />
            )}
          </div>
          <p className="text-xs text-[var(--color-muted)]">
            {row.primaryTopicName ?? t('catalog.generalTopic')}
          </p>
        </div>
      ),
    },
    {
      key: 'kind',
      header: t('admin.portals.films.col.kind'),
      render: (row) => (
        <div className="space-y-1 text-xs sm:text-sm tabular-nums-strict">
          <p className="font-semibold text-[var(--color-text)]">
            {t(getKindLabelKey(row.filmInfo.kind))}
          </p>
          <p className="text-xs text-[var(--color-muted)]">
            {row.filmInfo.releaseYear !== null
              ? t('admin.portals.films.yearLabel', {
                  year: toPersianDigits(row.filmInfo.releaseYear),
                })
              : t('admin.portals.films.unsetValue')}
          </p>
        </div>
      ),
    },
    {
      key: 'runtimeAndAge',
      header: t('admin.portals.films.col.runtimeAndAge'),
      render: (row) => {
        const runtime = row.filmInfo.runtimeMinutes ?? row.item.readWatchMinutes;
        return (
          <div className="space-y-1 text-xs max-w-xs">
            <p className="font-medium text-[var(--color-text)] tabular-nums-strict">
              {typeof runtime === 'number' && runtime > 0
                ? t('admin.portals.films.runtimeLabel', {
                    minutes: toPersianDigits(runtime),
                  })
                : t('admin.portals.films.unsetValue')}
            </p>
            <p className="text-[var(--color-muted)] line-clamp-2">
              {row.filmInfo.ageRatingNote ?? t('admin.portals.films.unsetValue')}
            </p>
          </div>
        );
      },
    },
    {
      key: 'status',
      header: t('admin.portals.films.col.status'),
      render: (row) => (
        <Tag
          label={t(`content.status.${row.item.status}` as ResourceKey)}
          variant={getStatusVariant(row.item.status)}
        />
      ),
    },
    {
      key: 'actions',
      header: t('admin.portals.films.col.actions'),
      render: (row) => (
        <div className="flex flex-wrap items-center gap-2">
          {!row.filmInfo.isWeeklyPick && (
            <Button
              size="sm"
              variant="primary"
              disabled={busyWeeklyPickId === row.item.id}
              onClick={() => void handleSetWeeklyPick(row)}
              startIcon={<Sparkles className="w-3.5 h-3.5" />}
            >
              {busyWeeklyPickId === row.item.id
                ? t('admin.portals.films.settingWeeklyPick')
                : t('admin.portals.films.setWeeklyPickAction')}
            </Button>
          )}
          <Button
            size="sm"
            variant="secondary"
            onClick={() => openQuickEditFilmModal(row)}
            startIcon={<Edit3 className="w-3.5 h-3.5" />}
          >
            {t('admin.portals.films.quickEditAction')}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => navigateToHash(`/admin/content/edit/${row.item.id}`)}
          >
            {t('admin.portals.films.editFullContentAction')}
          </Button>
          {row.item.status === ContentStatus.Published && isFilmsEnabled && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() =>
                navigateToHash(`/films/${encodeURIComponent(row.item.slug)}`)
              }
              startIcon={<ExternalLink className="w-3.5 h-3.5" />}
            >
              {t('admin.portals.films.previewFilmAction')}
            </Button>
          )}
        </div>
      ),
    },
  ];

  const bookColumns: TableColumn<AdminBookListItem>[] = [
    {
      key: 'title',
      header: t('admin.portals.books.col.title'),
      render: (row) => (
        <div className="space-y-1 min-w-[200px]">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-[var(--color-text)]">{row.item.title}</span>
            {row.item.isFeatured && (
              <Tag label={t('admin.portals.books.featuredBadge')} variant="primary" />
            )}
          </div>
          <p className="text-xs text-[var(--color-muted)]">
            {row.primaryTopicName ?? t('catalog.generalTopic')}
          </p>
        </div>
      ),
    },
    {
      key: 'authorAndPublisher',
      header: t('admin.portals.books.col.authorAndPublisher'),
      render: (row) => (
        <div className="space-y-1 text-xs sm:text-sm max-w-xs">
          <p className="font-semibold text-[var(--color-text)]">
            {row.bookInfo.author.trim().length > 0
              ? row.bookInfo.author
              : t('admin.portals.books.unsetValue')}
          </p>
          <p className="text-xs text-[var(--color-muted)]">
            {row.bookInfo.publisher ?? t('admin.portals.books.unsetValue')}
          </p>
        </div>
      ),
    },
    {
      key: 'yearAndPages',
      header: t('admin.portals.books.col.yearAndPages'),
      render: (row) => (
        <div className="space-y-1 text-xs tabular-nums-strict">
          <p className="font-medium text-[var(--color-text)]">
            {row.bookInfo.publishYear !== null
              ? t('admin.portals.books.yearLabel', {
                  year: toPersianDigits(row.bookInfo.publishYear),
                })
              : t('admin.portals.books.unsetValue')}
          </p>
          <p className="text-[var(--color-muted)]">
            {row.bookInfo.pages !== null
              ? t('admin.portals.books.pagesLabel', {
                  pages: toPersianDigits(row.bookInfo.pages),
                })
              : t('admin.portals.books.unsetValue')}
          </p>
        </div>
      ),
    },
    {
      key: 'status',
      header: t('admin.portals.books.col.status'),
      render: (row) => (
        <Tag
          label={t(`content.status.${row.item.status}` as ResourceKey)}
          variant={getStatusVariant(row.item.status)}
        />
      ),
    },
    {
      key: 'actions',
      header: t('admin.portals.books.col.actions'),
      render: (row) => (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="secondary"
            onClick={() => openQuickEditBookModal(row)}
            startIcon={<Edit3 className="w-3.5 h-3.5" />}
          >
            {t('admin.portals.books.quickEditAction')}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => navigateToHash(`/admin/content/edit/${row.item.id}`)}
          >
            {t('admin.portals.books.editFullContentAction')}
          </Button>
          {row.item.status === ContentStatus.Published && isBooksEnabled && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() =>
                navigateToHash(`/books/${encodeURIComponent(row.item.slug)}`)
              }
              startIcon={<ExternalLink className="w-3.5 h-3.5" />}
            >
              {t('admin.portals.books.previewBookAction')}
            </Button>
          )}
        </div>
      ),
    },
  ];

  const gameColumns: TableColumn<AdminGameListItem>[] = [
    {
      key: 'title',
      header: t('admin.portals.games.col.title'),
      render: (row) => (
        <div className="space-y-1 min-w-[200px]">
          <p className="font-semibold text-[var(--color-text)]">{row.game.title}</p>
          <p className="text-xs text-[var(--color-muted)]">
            {row.topicName ?? t('catalog.generalTopic')} · <span dir="ltr">{row.game.slug}</span>
          </p>
        </div>
      ),
    },
    {
      key: 'package',
      header: t('admin.portals.games.col.package'),
      render: (row) => {
        const sizeParts = formatFileSizeParts(row.packageTotalBytes);
        const sizeText = sizeParts
          ? t(`contentDetail.sizeUnit.${sizeParts.unit}` as ResourceKey, {
              value: sizeParts.value,
            })
          : toPersianDigits(0);
        return (
          <div className="space-y-1 text-xs tabular-nums-strict">
            <p className="font-semibold text-[var(--color-text)]">
              {t('admin.portals.games.maxScoreColLabel', {
                score: toPersianDigits(row.game.maxScore),
              })}
            </p>
            <p className="text-[var(--color-muted)]">
              {t('admin.portals.games.packageStats', {
                files: toPersianDigits(row.packageFilesCount),
                size: sizeText,
              })}{' '}
              ·{' '}
              {t('admin.portals.games.scoresCountLabel', {
                count: toPersianDigits(row.scoresCount),
              })}
            </p>
          </div>
        );
      },
    },
    {
      key: 'ages',
      header: t('admin.portals.games.col.ages'),
      render: (row) => (
        <span className="text-xs text-[var(--color-text)]">
          {row.ageGroupIds.length === 0
            ? t('admin.portals.games.allAgesLabel')
            : row.ageGroupIds
                .map((id) => ageGroupNameById.get(id))
                .filter((name): name is string => Boolean(name))
                .join(t('homePreview.targetListSeparator'))}
        </span>
      ),
    },
    {
      key: 'status',
      header: t('admin.portals.games.col.status'),
      render: (row) => (
        <Tag
          label={
            row.game.isPublished
              ? t('admin.portals.games.status.published')
              : t('admin.portals.games.status.draft')
          }
          variant={row.game.isPublished ? 'success' : 'neutral'}
        />
      ),
    },
    {
      key: 'actions',
      header: t('admin.portals.games.col.actions'),
      render: (row) => (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="secondary"
            onClick={() => openEditGameModal(row)}
            startIcon={<Edit3 className="w-3.5 h-3.5" />}
          >
            {t('admin.portals.games.action.edit')}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={busyGameId === row.game.id}
            onClick={() => void handleToggleGamePublish(row)}
          >
            {row.game.isPublished
              ? t('admin.portals.games.action.unpublish')
              : t('admin.portals.games.action.publish')}
          </Button>
          {row.game.isPublished && isGamesEnabled && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() =>
                navigateToHash(`/games/${encodeURIComponent(row.game.slug)}`)
              }
              startIcon={<ExternalLink className="w-3.5 h-3.5" />}
            >
              {t('admin.portals.games.action.preview')}
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setDeletingGameRow(row)}
            startIcon={<Trash2 className="w-3.5 h-3.5 text-[var(--color-error-text)]" />}
          >
            {t('admin.portals.games.action.delete')}
          </Button>
        </div>
      ),
    },
  ];

  return (
    <AdminLayout currentRoute={currentRoute}>
      <div className="space-y-6">
        <header className="pb-5 border-b border-[var(--color-border)] flex flex-wrap items-end justify-between gap-4">
          <div className="space-y-1.5 max-w-3xl">
            <h1 className="text-xl sm:text-2xl font-bold text-[var(--color-text)]">
              {t('admin.portals.title')}
            </h1>
            <p className="text-xs sm:text-sm text-[var(--color-muted)] leading-relaxed">
              {t('admin.portals.subtitle')}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {activeTab === 'films' ? (
              <>
                {isFilmsEnabled && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => navigateToHash('/films')}
                    startIcon={<ExternalLink className="w-4 h-4" />}
                  >
                    {t('admin.portals.films.openShowcase')}
                  </Button>
                )}
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => navigateToHash('/admin/content/new')}
                  startIcon={<Plus className="w-4 h-4" />}
                >
                  {t('admin.portals.films.addNewContentFilm')}
                </Button>
              </>
            ) : activeTab === 'books' ? (
              <>
                {isBooksEnabled && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => navigateToHash('/books')}
                    startIcon={<ExternalLink className="w-4 h-4" />}
                  >
                    {t('admin.portals.books.openShowcase')}
                  </Button>
                )}
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => navigateToHash('/admin/content/new')}
                  startIcon={<Plus className="w-4 h-4" />}
                >
                  {t('admin.portals.books.addNewContentBook')}
                </Button>
              </>
            ) : (
              <>
                {isGamesEnabled && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => navigateToHash('/games')}
                    startIcon={<ExternalLink className="w-4 h-4" />}
                  >
                    {t('admin.portals.games.openShowcase')}
                  </Button>
                )}
                <Button
                  variant="primary"
                  size="sm"
                  onClick={openCreateGameModal}
                  startIcon={<Plus className="w-4 h-4" />}
                >
                  {t('admin.portals.games.addNewGameButton')}
                </Button>
              </>
            )}
          </div>
        </header>

        {/* Portals Tabs */}
        <div
          role="tablist"
          aria-label={t('admin.portals.tabs.ariaLabel')}
          className="flex flex-wrap gap-2 border-b border-[var(--color-border)] pb-3"
        >
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'films'}
            onClick={() => {
              setActiveTab('films');
              setFeedback(null);
            }}
            className={`inline-flex items-center gap-2 min-h-[40px] px-4 py-2 text-xs sm:text-sm font-semibold rounded-[var(--radius-control)] border transition-colors whitespace-nowrap ${
              activeTab === 'films'
                ? 'bg-[var(--color-primary-button)] text-[var(--color-on-primary)] border-transparent'
                : 'bg-[var(--color-surface)] text-[var(--color-text)] border-[var(--color-border)] hover:bg-[var(--color-surface-alt)]'
            }`}
          >
            <FilmIcon className="w-4 h-4 shrink-0" aria-hidden="true" />
            <span>{t('admin.portals.tab.films')}</span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'books'}
            onClick={() => {
              setActiveTab('books');
              setFeedback(null);
            }}
            className={`inline-flex items-center gap-2 min-h-[40px] px-4 py-2 text-xs sm:text-sm font-semibold rounded-[var(--radius-control)] border transition-colors whitespace-nowrap ${
              activeTab === 'books'
                ? 'bg-[var(--color-primary-button)] text-[var(--color-on-primary)] border-transparent'
                : 'bg-[var(--color-surface)] text-[var(--color-text)] border-[var(--color-border)] hover:bg-[var(--color-surface-alt)]'
            }`}
          >
            <BookOpen className="w-4 h-4 shrink-0" aria-hidden="true" />
            <span>{t('admin.portals.tab.books')}</span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'games'}
            onClick={() => {
              setActiveTab('games');
              setFeedback(null);
            }}
            className={`inline-flex items-center gap-2 min-h-[40px] px-4 py-2 text-xs sm:text-sm font-semibold rounded-[var(--radius-control)] border transition-colors whitespace-nowrap ${
              activeTab === 'games'
                ? 'bg-[var(--color-primary-button)] text-[var(--color-on-primary)] border-transparent'
                : 'bg-[var(--color-surface)] text-[var(--color-text)] border-[var(--color-border)] hover:bg-[var(--color-surface-alt)]'
            }`}
          >
            <Gamepad2 className="w-4 h-4 shrink-0" aria-hidden="true" />
            <span>{t('admin.portals.tab.games')}</span>
          </button>
        </div>

        {feedback && (
          <Alert
            variant={feedback.variant}
            message={feedback.message}
            onDismiss={() => setFeedback(null)}
          />
        )}

        {activeTab === 'films' ? (
          <div className="space-y-5">
            {/* Feature Flag Status + Current Weekly Pick Spotlight */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <section className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-5 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs sm:text-sm font-semibold text-[var(--color-muted)]">
                    {t('admin.portals.films.flagLabel')}
                  </span>
                  <Tag
                    label={
                      isFilmsEnabled
                        ? t('admin.portals.films.flagEnabled')
                        : t('admin.portals.films.flagDisabled')
                    }
                    variant={isFilmsEnabled ? 'success' : 'warning'}
                  />
                </div>
                <p className="text-xs text-[var(--color-muted)] leading-relaxed">
                  {t('admin.portals.films.exclusivityNote')}
                </p>
                <div className="pt-1">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => navigateToHash('/admin/settings')}
                    startIcon={<Settings className="w-3.5 h-3.5" />}
                  >
                    {t('admin.portals.films.openSettings')}
                  </Button>
                </div>
              </section>

              <section className="rounded-[var(--radius-card)] border border-[var(--color-border-strong)] bg-[var(--color-surface-alt)] p-5 space-y-2.5">
                <div className="flex items-center gap-2 text-sm font-bold text-[var(--color-primary)]">
                  <Sparkles className="w-4 h-4 shrink-0" aria-hidden="true" />
                  <span>{t('admin.portals.films.weeklyPickBannerTitle')}</span>
                </div>
                {currentWeeklyPick ? (
                  <div className="space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-base font-bold text-[var(--color-text)]">
                        {currentWeeklyPick.item.title}
                      </p>
                      <Tag
                        label={t(getKindLabelKey(currentWeeklyPick.filmInfo.kind))}
                        variant="primary"
                      />
                    </div>
                    {currentWeeklyPick.item.status !== ContentStatus.Published && (
                      <p className="text-xs text-[var(--color-warning-text)] font-medium">
                        {t('admin.portals.films.weeklyPickNotPublishedWarn')}
                      </p>
                    )}
                  </div>
                ) : (
                  <p className="text-xs sm:text-sm text-[var(--color-muted)]">
                    {t('admin.portals.films.weeklyPickNone')}
                  </p>
                )}
              </section>
            </div>

            {/* Search Input */}
            <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
              <label htmlFor="admin-portals-films-search" className="sr-only">
                {t('admin.portals.films.searchLabel')}
              </label>
              <div className="relative max-w-md">
                <Search
                  className="w-4 h-4 text-[var(--color-muted)] absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none"
                  aria-hidden="true"
                />
                <input
                  id="admin-portals-films-search"
                  type="search"
                  value={filmSearchQuery}
                  onChange={(e) => setFilmSearchQuery(e.target.value)}
                  placeholder={t('admin.portals.films.searchPlaceholder')}
                  className="w-full min-h-[42px] pr-9 pl-3 py-2 text-xs sm:text-sm rounded-[var(--radius-control)] border border-[var(--color-border)] bg-[var(--color-surface-alt)] text-[var(--color-text)] focus:outline-2 focus:outline-[var(--color-primary)]"
                />
              </div>
            </div>

            {/* Films Table */}
            {isLoadingFilms ? (
              <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-8 text-center text-sm text-[var(--color-muted)]">
                {t('admin.portals.films.loading')}
              </div>
            ) : films.length === 0 ? (
              <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-8 text-center space-y-3">
                <FilmIcon className="w-10 h-10 text-[var(--color-muted)] mx-auto" aria-hidden="true" />
                <h2 className="text-base font-bold text-[var(--color-text)]">
                  {t('admin.portals.films.emptyTitle')}
                </h2>
                <p className="text-xs sm:text-sm text-[var(--color-muted)] max-w-md mx-auto">
                  {t('admin.portals.films.emptyBody')}
                </p>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => navigateToHash('/admin/content/new')}
                  startIcon={<Plus className="w-4 h-4" />}
                >
                  {t('admin.portals.films.addNewContentFilm')}
                </Button>
              </div>
            ) : (
              <Table
                columns={filmColumns}
                rows={films}
                getRowKey={(row) => String(row.item.id)}
              />
            )}
          </div>
        ) : activeTab === 'books' ? (
          <div className="space-y-5">
            {/* Book Feature Flag Card */}
            <section className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-5 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs sm:text-sm font-semibold text-[var(--color-muted)]">
                  {t('admin.portals.books.flagLabel')}
                </span>
                <Tag
                  label={
                    isBooksEnabled
                      ? t('admin.portals.books.flagEnabled')
                      : t('admin.portals.books.flagDisabled')
                  }
                  variant={isBooksEnabled ? 'success' : 'warning'}
                />
              </div>
              <p className="text-xs text-[var(--color-muted)] leading-relaxed">
                {t('admin.portals.books.infoNote')}
              </p>
              <div className="pt-1 flex flex-wrap items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => navigateToHash('/admin/settings')}
                  startIcon={<Settings className="w-3.5 h-3.5" />}
                >
                  {t('admin.portals.books.openSettings')}
                </Button>
              </div>
            </section>

            {/* Book Search Input */}
            <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
              <label htmlFor="admin-portals-books-search" className="sr-only">
                {t('admin.portals.books.searchLabel')}
              </label>
              <div className="relative max-w-md">
                <Search
                  className="w-4 h-4 text-[var(--color-muted)] absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none"
                  aria-hidden="true"
                />
                <input
                  id="admin-portals-books-search"
                  type="search"
                  value={bookSearchQuery}
                  onChange={(e) => setBookSearchQuery(e.target.value)}
                  placeholder={t('admin.portals.books.searchPlaceholder')}
                  className="w-full min-h-[42px] pr-9 pl-3 py-2 text-xs sm:text-sm rounded-[var(--radius-control)] border border-[var(--color-border)] bg-[var(--color-surface-alt)] text-[var(--color-text)] focus:outline-2 focus:outline-[var(--color-primary)]"
                />
              </div>
            </div>

            {/* Books Table */}
            {isLoadingBooks ? (
              <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-8 text-center text-sm text-[var(--color-muted)]">
                {t('admin.portals.books.loading')}
              </div>
            ) : books.length === 0 ? (
              <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-8 text-center space-y-3">
                <BookOpen className="w-10 h-10 text-[var(--color-muted)] mx-auto" aria-hidden="true" />
                <h2 className="text-base font-bold text-[var(--color-text)]">
                  {t('admin.portals.books.emptyTitle')}
                </h2>
                <p className="text-xs sm:text-sm text-[var(--color-muted)] max-w-md mx-auto">
                  {t('admin.portals.books.emptyBody')}
                </p>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => navigateToHash('/admin/content/new')}
                  startIcon={<Plus className="w-4 h-4" />}
                >
                  {t('admin.portals.books.addNewContentBook')}
                </Button>
              </div>
            ) : (
              <Table
                columns={bookColumns}
                rows={books}
                getRowKey={(row) => String(row.item.id)}
              />
            )}
          </div>
        ) : (
          <div className="space-y-5">
            {/* Games Feature Flag + Sample Game Installer */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <section className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-5 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs sm:text-sm font-semibold text-[var(--color-muted)]">
                    {t('admin.portals.games.flagLabel')}
                  </span>
                  <Tag
                    label={
                      isGamesEnabled
                        ? t('admin.portals.games.flagEnabled')
                        : t('admin.portals.games.flagDisabled')
                    }
                    variant={isGamesEnabled ? 'success' : 'warning'}
                  />
                </div>
                <p className="text-xs text-[var(--color-muted)] leading-relaxed">
                  {t('admin.portals.games.infoNote')}
                </p>
                <div className="pt-1 flex flex-wrap items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => navigateToHash('/admin/settings')}
                    startIcon={<Settings className="w-3.5 h-3.5" />}
                  >
                    {t('admin.portals.games.openSettings')}
                  </Button>
                </div>
              </section>

              <section className="rounded-[var(--radius-card)] border border-[var(--color-border-strong)] bg-[var(--color-surface-alt)] p-5 space-y-3">
                <div className="flex items-center gap-2 text-sm font-bold text-[var(--color-primary)]">
                  <Gamepad2 className="w-4 h-4 shrink-0" aria-hidden="true" />
                  <span>{t('admin.portals.games.sample.title')}</span>
                </div>
                <p className="text-xs text-[var(--color-muted)] leading-relaxed">
                  {t('admin.portals.games.sample.description')}
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    variant="primary"
                    size="sm"
                    disabled={isInstallingSampleGame}
                    onClick={() => void handleInstallSampleGame()}
                    startIcon={<Sparkles className="w-3.5 h-3.5" />}
                  >
                    {isInstallingSampleGame
                      ? t('admin.portals.games.installingSampleButton')
                      : t('admin.portals.games.installSampleButton')}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void handleDownloadSampleZip()}
                    startIcon={<Download className="w-3.5 h-3.5" />}
                  >
                    {t('admin.portals.games.downloadSampleZipButton')}
                  </Button>
                </div>
              </section>
            </div>

            {/* Game Search */}
            <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
              <label htmlFor="admin-portals-games-search" className="sr-only">
                {t('admin.portals.games.searchLabel')}
              </label>
              <div className="relative max-w-md">
                <Search
                  className="w-4 h-4 text-[var(--color-muted)] absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none"
                  aria-hidden="true"
                />
                <input
                  id="admin-portals-games-search"
                  type="search"
                  value={gameSearchQuery}
                  onChange={(e) => setGameSearchQuery(e.target.value)}
                  placeholder={t('admin.portals.games.searchPlaceholder')}
                  className="w-full min-h-[42px] pr-9 pl-3 py-2 text-xs sm:text-sm rounded-[var(--radius-control)] border border-[var(--color-border)] bg-[var(--color-surface-alt)] text-[var(--color-text)] focus:outline-2 focus:outline-[var(--color-primary)]"
                />
              </div>
            </div>

            {/* Games Table */}
            {isLoadingGames ? (
              <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-8 text-center text-sm text-[var(--color-muted)]">
                {t('admin.portals.games.loading')}
              </div>
            ) : games.length === 0 ? (
              <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-8 text-center space-y-3">
                <Gamepad2 className="w-10 h-10 text-[var(--color-muted)] mx-auto" aria-hidden="true" />
                <h2 className="text-base font-bold text-[var(--color-text)]">
                  {t('admin.portals.games.emptyTitle')}
                </h2>
                <p className="text-xs sm:text-sm text-[var(--color-muted)] max-w-md mx-auto">
                  {t('admin.portals.games.emptyBody')}
                </p>
                <div className="flex flex-wrap items-center justify-center gap-2">
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={openCreateGameModal}
                    startIcon={<Upload className="w-4 h-4" />}
                  >
                    {t('admin.portals.games.addNewGameButton')}
                  </Button>
                </div>
              </div>
            ) : (
              <Table
                columns={gameColumns}
                rows={games}
                getRowKey={(row) => String(row.game.id)}
              />
            )}
          </div>
        )}
      </div>

      {/* Quick Edit FilmInfo Modal */}
      <Modal
        open={Boolean(editingFilmRow)}
        onClose={() => {
          if (!isSavingFilmModal) setEditingFilmRow(null);
        }}
        title={
          editingFilmRow
            ? t('admin.portals.films.modal.title', { title: editingFilmRow.item.title })
            : ''
        }
        footer={
          <>
            <Button
              variant="ghost"
              disabled={isSavingFilmModal}
              onClick={() => setEditingFilmRow(null)}
            >
              {t('admin.portals.films.modal.cancel')}
            </Button>
            <Button
              variant="primary"
              disabled={isSavingFilmModal}
              onClick={() => void handleSaveFilmQuickEdit()}
            >
              {isSavingFilmModal
                ? t('admin.portals.films.modal.saving')
                : t('admin.portals.films.modal.save')}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {filmModalError && <Alert variant="error" message={filmModalError} />}

          <FormField
            id="modal-film-kind"
            label={t('admin.content.film.kindLabel')}
            kind="select"
            value={modalKind}
            onChange={(val) => setModalKind(val as FilmKind)}
            options={filmKindOptions}
          />

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <FormField
              id="modal-film-year"
              label={t('admin.content.film.releaseYearLabel')}
              value={modalYear}
              onChange={setModalYear}
              placeholder={t('admin.content.film.releaseYearPlaceholder')}
            />
            <FormField
              id="modal-film-runtime"
              label={t('admin.content.film.runtimeMinutesLabel')}
              value={modalRuntime}
              onChange={setModalRuntime}
              placeholder={t('admin.content.film.runtimeMinutesPlaceholder')}
            />
          </div>

          <div className="space-y-1">
            <FormField
              id="modal-film-age-note"
              label={t('admin.content.film.ageRatingNoteLabel')}
              kind="textarea"
              rows={2}
              value={modalAgeNote}
              onChange={setModalAgeNote}
              placeholder={t('admin.content.film.ageRatingNotePlaceholder')}
            />
            <p
              className={`text-xs tabular-nums-strict ${
                modalAgeNote.trim().length > FILM_AGE_RATING_NOTE_MAX_LENGTH
                  ? 'text-[var(--color-error-text)] font-semibold'
                  : 'text-[var(--color-muted)]'
              }`}
            >
              {t('admin.content.film.ageRatingNoteCounter', {
                count: toPersianDigits(modalAgeNote.trim().length),
              })}
            </p>
          </div>

          <label className="inline-flex items-center gap-2.5 text-sm font-medium text-[var(--color-text)] cursor-pointer select-none">
            <input
              type="checkbox"
              checked={modalWeeklyPick}
              onChange={(e) => setModalWeeklyPick(e.target.checked)}
              className="w-4 h-4 accent-[var(--color-primary)]"
            />
            <span>{t('admin.content.film.weeklyPickLabel')}</span>
          </label>
        </div>
      </Modal>

      {/* Quick Edit BookInfo Modal */}
      <Modal
        open={Boolean(editingBookRow)}
        onClose={() => {
          if (!isSavingBookModal) setEditingBookRow(null);
        }}
        title={
          editingBookRow
            ? t('admin.portals.books.modal.title', { title: editingBookRow.item.title })
            : ''
        }
        footer={
          <>
            <Button
              variant="ghost"
              disabled={isSavingBookModal}
              onClick={() => setEditingBookRow(null)}
            >
              {t('admin.portals.books.modal.cancel')}
            </Button>
            <Button
              variant="primary"
              disabled={isSavingBookModal}
              onClick={() => void handleSaveBookQuickEdit()}
            >
              {isSavingBookModal
                ? t('admin.portals.books.modal.saving')
                : t('admin.portals.books.modal.save')}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {bookModalError && <Alert variant="error" message={bookModalError} />}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1">
              <FormField
                id="modal-book-author"
                label={t('admin.content.book.authorLabel')}
                value={modalBookAuthor}
                onChange={setModalBookAuthor}
                placeholder={t('admin.content.book.authorPlaceholder')}
                required
              />
              <p
                className={`text-xs tabular-nums-strict ${
                  modalBookAuthor.trim().length > BOOK_AUTHOR_MAX_LENGTH
                    ? 'text-[var(--color-error-text)] font-semibold'
                    : 'text-[var(--color-muted)]'
                }`}
              >
                {t('admin.content.book.authorCounter', {
                  count: toPersianDigits(modalBookAuthor.trim().length),
                })}
              </p>
            </div>

            <FormField
              id="modal-book-publisher"
              label={t('admin.content.book.publisherLabel')}
              value={modalBookPublisher}
              onChange={setModalBookPublisher}
              placeholder={t('admin.content.book.publisherPlaceholder')}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <FormField
              id="modal-book-year"
              label={t('admin.content.book.publishYearLabel')}
              value={modalBookPublishYear}
              onChange={setModalBookPublishYear}
              placeholder={t('admin.content.book.publishYearPlaceholder')}
            />
            <FormField
              id="modal-book-pages"
              label={t('admin.content.book.pagesLabel')}
              value={modalBookPages}
              onChange={setModalBookPages}
              placeholder={t('admin.content.book.pagesPlaceholder')}
            />
          </div>

          <div className="space-y-1">
            <FormField
              id="modal-book-excerpts"
              label={t('admin.content.book.keyExcerptsLabel')}
              kind="textarea"
              rows={3}
              value={modalBookKeyExcerpts}
              onChange={setModalBookKeyExcerpts}
              placeholder={t('admin.content.book.keyExcerptsPlaceholder')}
            />
            <p
              className={`text-xs tabular-nums-strict ${
                modalBookKeyExcerpts.trim().length > BOOK_KEY_EXCERPTS_MAX_LENGTH
                  ? 'text-[var(--color-error-text)] font-semibold'
                  : 'text-[var(--color-muted)]'
              }`}
            >
              {t('admin.content.book.keyExcerptsCounter', {
                count: toPersianDigits(modalBookKeyExcerpts.trim().length),
              })}
            </p>
          </div>

          <div className="space-y-1">
            <FormField
              id="modal-book-studio-note"
              label={t('admin.content.book.studioNoteLabel')}
              kind="textarea"
              rows={2}
              value={modalBookStudioNote}
              onChange={setModalBookStudioNote}
              placeholder={t('admin.content.book.studioNotePlaceholder')}
            />
            <p
              className={`text-xs tabular-nums-strict ${
                modalBookStudioNote.trim().length > BOOK_STUDIO_NOTE_MAX_LENGTH
                  ? 'text-[var(--color-error-text)] font-semibold'
                  : 'text-[var(--color-muted)]'
              }`}
            >
              {t('admin.content.book.studioNoteCounter', {
                count: toPersianDigits(modalBookStudioNote.trim().length),
              })}
            </p>
          </div>
        </div>
      </Modal>

      {/* Create/Edit HTML5 Game Modal */}
      <Modal
        open={gameModalOpen}
        onClose={() => {
          if (!isSavingGameModal) setGameModalOpen(false);
        }}
        title={
          editingGameRow
            ? t('admin.portals.games.modal.editTitle', {
                title: editingGameRow.game.title,
              })
            : t('admin.portals.games.modal.createTitle')
        }
        footer={
          <>
            <Button
              variant="ghost"
              disabled={isSavingGameModal}
              onClick={() => setGameModalOpen(false)}
            >
              {t('admin.portals.games.modal.cancel')}
            </Button>
            <Button
              variant="primary"
              disabled={isSavingGameModal || isUploadingThumb}
              onClick={() => void handleSaveGameModal()}
            >
              {isSavingGameModal
                ? t('admin.portals.games.modal.saving')
                : t('admin.portals.games.modal.save')}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {gameModalError && <Alert variant="error" message={gameModalError} />}

          <FormField
            id="modal-game-title"
            label={t('admin.portals.games.modal.titleLabel')}
            value={gameTitle}
            onChange={setGameTitle}
            placeholder={t('admin.portals.games.modal.titlePlaceholder')}
            required
          />

          <FormField
            id="modal-game-desc"
            label={t('admin.portals.games.modal.descriptionLabel')}
            kind="textarea"
            rows={2}
            value={gameDescription}
            onChange={setGameDescription}
            placeholder={t('admin.portals.games.modal.descriptionPlaceholder')}
          />

          <FormField
            id="modal-game-end-message"
            label={t('admin.portals.games.modal.endMessageLabel')}
            kind="textarea"
            rows={2}
            value={gameEndMessage}
            onChange={setGameEndMessage}
            placeholder={t('admin.portals.games.modal.endMessagePlaceholder')}
          />

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <FormField
              id="modal-game-topic"
              label={t('admin.portals.games.modal.topicLabel')}
              kind="select"
              value={gameTopicId}
              onChange={setGameTopicId}
              options={gameTopicOptions}
            />

            <FormField
              id="modal-game-max-score"
              label={t('admin.portals.games.modal.maxScoreLabel')}
              value={gameMaxScore}
              onChange={setGameMaxScore}
              hint={t('admin.portals.games.modal.maxScoreHint')}
              required
            />
          </div>

          <div className="space-y-2">
            <p className="text-xs sm:text-sm font-medium text-[var(--color-text)]">
              {t('admin.portals.games.modal.ageGroupsLabel')}
            </p>
            <div className="flex flex-wrap gap-3">
              {allAgeGroups.map((ag) => (
                <label
                  key={ag.id}
                  className="inline-flex items-center gap-2 text-xs sm:text-sm text-[var(--color-text)] cursor-pointer select-none"
                >
                  <input
                    type="checkbox"
                    checked={gameAgeGroupIds.includes(ag.id)}
                    onChange={() => handleToggleGameAgeGroup(ag.id)}
                    className="w-4 h-4 accent-[var(--color-primary)]"
                  />
                  <span>{ag.name}</span>
                </label>
              ))}
            </div>
            <p className="text-xs text-[var(--color-muted)]">
              {t('admin.portals.games.modal.ageGroupsEmptyHint')}
            </p>
          </div>

          <div className="space-y-1.5">
            <label
              htmlFor="modal-game-zip-input"
              className="block text-xs sm:text-sm font-medium text-[var(--color-text)]"
            >
              {editingGameRow
                ? t('admin.portals.games.modal.zipLabelEdit')
                : t('admin.portals.games.modal.zipLabelCreate')}
            </label>
            <input
              id="modal-game-zip-input"
              type="file"
              accept=".zip,application/zip"
              onChange={(e) => void handleGameZipFileChange(e)}
              className="block w-full text-xs text-[var(--color-text)] file:ml-3 file:py-2 file:px-3 file:rounded-[var(--radius-control)] file:border file:border-[var(--color-border)] file:bg-[var(--color-surface-alt)] file:text-xs file:font-semibold file:text-[var(--color-text)] hover:file:bg-[var(--color-surface)]"
            />
            <p className="text-xs text-[var(--color-muted)]">
              {t('admin.portals.games.modal.zipHint')}
            </p>
            {gameZipBytes && (
              <p className="text-xs font-medium text-[var(--color-primary)] tabular-nums-strict">
                {(() => {
                  const parts = formatFileSizeParts(gameZipBytes.byteLength);
                  const sizeLabel = parts
                    ? t(`contentDetail.sizeUnit.${parts.unit}` as ResourceKey, {
                        value: parts.value,
                      })
                    : toPersianDigits(gameZipBytes.byteLength);
                  return t('admin.portals.games.modal.zipSelectedFile', {
                    name: gameZipFileName,
                    size: sizeLabel,
                  });
                })()}
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <label
              htmlFor="modal-game-thumb-input"
              className="block text-xs sm:text-sm font-medium text-[var(--color-text)]"
            >
              {t('admin.portals.games.modal.thumbnailLabel')}
            </label>
            <div className="flex flex-wrap items-center gap-2">
              <input
                id="modal-game-thumb-input"
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={(e) => void handleGameThumbnailChange(e)}
                className="block text-xs text-[var(--color-text)] file:ml-3 file:py-1.5 file:px-3 file:rounded-[var(--radius-control)] file:border file:border-[var(--color-border)] file:bg-[var(--color-surface-alt)] file:text-xs file:font-semibold file:text-[var(--color-text)]"
              />
              {gameThumbnailKey && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setGameThumbnailKey(null)}
                >
                  {t('admin.portals.games.modal.thumbnailClear')}
                </Button>
              )}
            </div>
          </div>

          <label className="inline-flex items-center gap-2.5 text-sm font-medium text-[var(--color-text)] cursor-pointer select-none">
            <input
              type="checkbox"
              checked={gameIsPublished}
              onChange={(e) => setGameIsPublished(e.target.checked)}
              className="w-4 h-4 accent-[var(--color-primary)]"
            />
            <span>{t('admin.portals.games.modal.isPublishedLabel')}</span>
          </label>
        </div>
      </Modal>

      {/* Confirm Delete Game Modal */}
      <Modal
        open={Boolean(deletingGameRow)}
        onClose={() => {
          if (!isDeletingGame) setDeletingGameRow(null);
        }}
        title={t('admin.portals.games.action.delete')}
        footer={
          <>
            <Button
              variant="ghost"
              disabled={isDeletingGame}
              onClick={() => setDeletingGameRow(null)}
            >
              {t('admin.portals.games.modal.cancel')}
            </Button>
            <Button
              variant="primary"
              disabled={isDeletingGame}
              onClick={() => void handleConfirmDeleteGame()}
            >
              {t('admin.portals.games.action.delete')}
            </Button>
          </>
        }
      >
        <p className="text-sm text-[var(--color-text)] leading-relaxed">
          {deletingGameRow
            ? t('admin.portals.games.confirmDelete', {
                title: deletingGameRow.game.title,
              })
            : ''}
        </p>
      </Modal>
    </AdminLayout>
  );
}
