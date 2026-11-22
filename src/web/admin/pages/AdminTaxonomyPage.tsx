import {
  ChevronDown,
  ChevronLeft,
  Edit3,
  FolderTree,
  Gauge,
  Hash,
  ImagePlus,
  Layers,
  Plus,
  Power,
  Trash2,
  UserCheck,
  Users,
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
import type {
  AgeGroup,
  ImpactLevel,
  Person,
  Tag as TagModel,
  Topic,
} from '../../../core/domain/taxonomy';
import {
  collectDescendantTopicIds,
  MAX_PERSON_BIO_LENGTH,
  type PersonPhotoInput,
  type TopicTreeNode,
} from '../../../core/services/taxonomyService';
import { THEME_KEYS, type ThemeKey } from '../../../core/services/themeService';
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
import { formatAgeGroupRange } from '../../resources/ageGroupFormatters';
import type { ResourceKey } from '../../resources/fa';
import { toPersianDigits } from '../../resources/formatters';
import { t } from '../../resources/i18n';
import { appContainer } from '../../services/appContainer';
import { AdminLayout } from '../AdminLayout';

interface AdminTaxonomyPageProps {
  currentRoute: string;
}

type TaxonomyTabKey = 'topics' | 'tags' | 'persons' | 'impactLevels' | 'ageGroups';

function getThemeNameKey(themeKey: ThemeKey): ResourceKey {
  switch (themeKey) {
    case 'playful':
      return 'theme.playful.name';
    case 'modern':
      return 'theme.modern.name';
    case 'editorial':
    default:
      return 'theme.editorial.name';
  }
}

export function AdminTaxonomyPage({ currentRoute }: AdminTaxonomyPageProps) {
  const { currentUser } = useAuth();
  const [activeTab, setActiveTab] = useState<TaxonomyTabKey>('topics');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  // Data collections
  const [topics, setTopics] = useState<Topic[]>([]);
  const [topicTree, setTopicTree] = useState<TopicTreeNode[]>([]);
  const [tags, setTags] = useState<TagModel[]>([]);
  const [persons, setPersons] = useState<Person[]>([]);
  const [impactLevels, setImpactLevels] = useState<ImpactLevel[]>([]);
  const [ageGroups, setAgeGroups] = useState<AgeGroup[]>([]);

  // Person photo object URL cache
  const [personPhotoUrls, setPersonPhotoUrls] = useState<Record<number, string>>({});
  const activeObjectUrlsRef = useRef<string[]>([]);

  // Feedback banner + optional quick-deactivate action when topic deletion blocked by content
  const [feedback, setFeedback] = useState<{
    variant: 'success' | 'error' | 'warning';
    message: string;
    deactivateTopicId?: number;
  } | null>(null);

  // Search / collapse state
  const [collapsedTopicIds, setCollapsedTopicIds] = useState<Set<number>>(new Set());
  const [tagSearch, setTagSearch] = useState('');
  const [personSearch, setPersonSearch] = useState('');

  // Quick add Tag inline
  const [quickTagName, setQuickTagName] = useState('');

  // Topic Modal state
  const [topicModal, setTopicModal] = useState<{
    mode: 'create' | 'edit';
    editingId?: number;
    parentId: number | null;
    name: string;
    slug: string;
    icon: string;
    sortOrder: string;
    isActive: boolean;
  } | null>(null);

  // Tag Modal state
  const [tagModal, setTagModal] = useState<{
    id: number;
    name: string;
    slug: string;
  } | null>(null);

  // Person Modal state
  const [personModal, setPersonModal] = useState<{
    mode: 'create' | 'edit';
    editingId?: number;
    existingPhotoKey: string | null;
    name: string;
    slug: string;
    bio: string;
    photoFile: PersonPhotoInput | null;
    photoPreviewUrl: string | null;
    removePhoto: boolean;
  } | null>(null);
  const personPhotoInputRef = useRef<HTMLInputElement | null>(null);

  // ImpactLevel Modal state
  const [impactModal, setImpactModal] = useState<{
    mode: 'create' | 'edit';
    editingId?: number;
    name: string;
    sortOrder: string;
  } | null>(null);

  // AgeGroup Modal state
  const [ageGroupModal, setAgeGroupModal] = useState<{
    id: number;
    name: string;
    minAge: string;
    maxAge: string;
    hasNoMaxAge: boolean;
    themeKey: ThemeKey;
    sortOrder: string;
    isActive: boolean;
  } | null>(null);

  // Delete confirmation modal
  const [deleteConfirm, setDeleteConfirm] = useState<{
    kind: 'topic' | 'tag' | 'person' | 'impactLevel';
    id: number;
    name: string;
  } | null>(null);

  const revokeAllPersonUrls = useCallback(() => {
    for (const url of activeObjectUrlsRef.current) {
      URL.revokeObjectURL(url);
    }
    activeObjectUrlsRef.current = [];
  }, []);

  const refreshPersonPhotoPreviews = useCallback(
    async (personList: Person[]) => {
      revokeAllPersonUrls();
      const nextMap: Record<number, string> = {};
      const nextUrls: string[] = [];

      await Promise.all(
        personList.map(async (person) => {
          if (!person.photoKey) return;
          const openRes = await appContainer.fileUploadService.openPublicMediaAsync(
            person.photoKey,
          );
          if (openRes.ok && openRes.bytes && openRes.metadata) {
            const copy = new Uint8Array(openRes.bytes.byteLength);
            copy.set(openRes.bytes);
            const blob = new Blob([copy.buffer], { type: openRes.metadata.mimeType });
            const url = URL.createObjectURL(blob);
            nextUrls.push(url);
            nextMap[person.id] = url;
          }
        }),
      );

      activeObjectUrlsRef.current = nextUrls;
      setPersonPhotoUrls(nextMap);
    },
    [revokeAllPersonUrls],
  );

  const loadAllTaxonomy = useCallback(async () => {
    setIsLoading(true);
    try {
      const [topicsRes, tagsRes, personsRes, impactRes, ageRes] = await Promise.all([
        appContainer.taxonomyService.getTopicsOverviewAsync(currentUser),
        appContainer.taxonomyService.listTagsAsync(currentUser),
        appContainer.taxonomyService.listPersonsAsync(currentUser),
        appContainer.taxonomyService.listImpactLevelsAsync(currentUser),
        appContainer.taxonomyService.listAgeGroupsAsync(currentUser),
      ]);

      if (topicsRes.ok && topicsRes.data) {
        setTopics(topicsRes.data.topics);
        setTopicTree(topicsRes.data.tree);
      }
      if (tagsRes.ok && tagsRes.data) {
        setTags(tagsRes.data);
      }
      if (personsRes.ok && personsRes.data) {
        setPersons(personsRes.data);
        await refreshPersonPhotoPreviews(personsRes.data);
      }
      if (impactRes.ok && impactRes.data) {
        setImpactLevels(impactRes.data);
      }
      if (ageRes.ok && ageRes.data) {
        setAgeGroups(ageRes.data);
      }
    } finally {
      setIsLoading(false);
    }
  }, [currentUser, refreshPersonPhotoPreviews]);

  useEffect(() => {
    void loadAllTaxonomy();
    return () => {
      revokeAllPersonUrls();
    };
  }, [loadAllTaxonomy, revokeAllPersonUrls]);

  // Cleanup modal temporary preview blob URL when closed/unmounted
  useEffect(() => {
    const previewUrl = personModal?.photoPreviewUrl ?? null;
    return () => {
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [personModal?.photoPreviewUrl]);

  const showErrorFeedback = (messageKey?: string, deactivateTopicId?: number) => {
    setFeedback({
      variant: 'error',
      message: t((messageKey ?? 'admin.taxonomy.error.entityNotFound') as ResourceKey),
      deactivateTopicId,
    });
  };

  // ==================== Topics Handlers ====================

  const toggleTopicCollapse = (topicId: number) => {
    setCollapsedTopicIds((prev) => {
      const next = new Set(prev);
      if (next.has(topicId)) {
        next.delete(topicId);
      } else {
        next.add(topicId);
      }
      return next;
    });
  };

  const openCreateRootTopic = () => {
    setTopicModal({
      mode: 'create',
      parentId: null,
      name: '',
      slug: '',
      icon: '',
      sortOrder: String(topics.filter((x) => x.parentId === null).length + 1),
      isActive: true,
    });
  };

  const openCreateChildTopic = (parent: Topic) => {
    setCollapsedTopicIds((prev) => {
      const next = new Set(prev);
      next.delete(parent.id);
      return next;
    });
    setTopicModal({
      mode: 'create',
      parentId: parent.id,
      name: '',
      slug: '',
      icon: '',
      sortOrder: String(topics.filter((x) => x.parentId === parent.id).length + 1),
      isActive: true,
    });
  };

  const openEditTopic = (topic: Topic) => {
    setTopicModal({
      mode: 'edit',
      editingId: topic.id,
      parentId: topic.parentId,
      name: topic.name,
      slug: topic.slug,
      icon: topic.icon ?? '',
      sortOrder: String(topic.sortOrder),
      isActive: topic.isActive,
    });
  };

  const availableTopicParentOptions: SelectOption[] = useMemo(() => {
    if (!topicModal) return [];
    const excludedIds = new Set<number>();
    if (topicModal.mode === 'edit' && topicModal.editingId !== undefined) {
      excludedIds.add(topicModal.editingId);
      for (const descId of collectDescendantTopicIds(topicModal.editingId, topics)) {
        excludedIds.add(descId);
      }
    }

    const opts: SelectOption[] = [
      { value: '', label: t('admin.taxonomy.topics.rootOption') },
    ];

    const walk = (nodes: TopicTreeNode[]) => {
      for (const node of nodes) {
        if (!excludedIds.has(node.topic.id)) {
          const indentPrefix = node.depth > 0 ? `${'— '.repeat(node.depth)}` : '';
          opts.push({
            value: String(node.topic.id),
            label: `${indentPrefix}${node.topic.name}`,
          });
          walk(node.children);
        }
      }
    };
    walk(topicTree);
    return opts;
  }, [topicModal, topicTree, topics]);

  const handleSaveTopic = async (event: FormEvent) => {
    event.preventDefault();
    if (!topicModal) return;
    setIsSaving(true);
    try {
      const payload = {
        parentId: topicModal.parentId,
        name: topicModal.name,
        slug: topicModal.slug,
        icon: topicModal.icon || null,
        sortOrder: topicModal.sortOrder,
        isActive: topicModal.isActive,
      };

      const res =
        topicModal.mode === 'create'
          ? await appContainer.taxonomyService.createTopicAsync(currentUser, payload)
          : await appContainer.taxonomyService.updateTopicAsync(
              currentUser,
              topicModal.editingId!,
              payload,
            );

      if (!res.ok || !res.data) {
        showErrorFeedback(res.messageKey);
        return;
      }

      const savedName = res.data.name;
      setTopicModal(null);
      setFeedback({
        variant: 'success',
        message: t(
          topicModal.mode === 'create'
            ? 'admin.taxonomy.topics.feedback.created'
            : 'admin.taxonomy.topics.feedback.updated',
          { name: savedName },
        ),
      });
      await loadAllTaxonomy();
    } finally {
      setIsSaving(false);
    }
  };

  const handleToggleTopicActive = async (topic: Topic) => {
    setIsSaving(true);
    try {
      const res = await appContainer.taxonomyService.toggleTopicActiveAsync(
        currentUser,
        topic.id,
        !topic.isActive,
      );
      if (!res.ok) {
        showErrorFeedback(res.messageKey);
        return;
      }
      setFeedback({
        variant: 'success',
        message: t('admin.taxonomy.topics.feedback.toggled', { name: topic.name }),
      });
      await loadAllTaxonomy();
    } finally {
      setIsSaving(false);
    }
  };

  // ==================== Tags Handlers ====================

  const handleQuickCreateTag = async (event: FormEvent) => {
    event.preventDefault();
    if (!quickTagName.trim()) return;
    setIsSaving(true);
    try {
      const res = await appContainer.taxonomyService.createTagAsync(currentUser, {
        name: quickTagName,
      });
      if (!res.ok || !res.data) {
        showErrorFeedback(res.messageKey);
        return;
      }
      setQuickTagName('');
      setFeedback({
        variant: 'success',
        message: t('admin.taxonomy.tags.feedback.created', { name: res.data.name }),
      });
      await loadAllTaxonomy();
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveTag = async (event: FormEvent) => {
    event.preventDefault();
    if (!tagModal) return;
    setIsSaving(true);
    try {
      const res = await appContainer.taxonomyService.updateTagAsync(
        currentUser,
        tagModal.id,
        {
          name: tagModal.name,
          slug: tagModal.slug,
        },
      );
      if (!res.ok || !res.data) {
        showErrorFeedback(res.messageKey);
        return;
      }
      setTagModal(null);
      setFeedback({
        variant: 'success',
        message: t('admin.taxonomy.tags.feedback.updated', { name: res.data.name }),
      });
      await loadAllTaxonomy();
    } finally {
      setIsSaving(false);
    }
  };

  // ==================== Persons Handlers ====================

  const openCreatePerson = () => {
    setPersonModal({
      mode: 'create',
      existingPhotoKey: null,
      name: '',
      slug: '',
      bio: '',
      photoFile: null,
      photoPreviewUrl: null,
      removePhoto: false,
    });
  };

  const openEditPerson = (person: Person) => {
    setPersonModal({
      mode: 'edit',
      editingId: person.id,
      existingPhotoKey: person.photoKey,
      name: person.name,
      slug: person.slug,
      bio: person.bio,
      photoFile: null,
      photoPreviewUrl: null,
      removePhoto: false,
    });
  };

  const handlePickPersonPhoto = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !personModal) return;

    const buffer = await file.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    const previewUrl = URL.createObjectURL(file);

    setPersonModal((prev) =>
      prev
        ? {
            ...prev,
            photoFile: {
              originalFileName: file.name,
              bytes,
            },
            photoPreviewUrl: previewUrl,
            removePhoto: false,
          }
        : null,
    );
  };

  const handleSavePerson = async (event: FormEvent) => {
    event.preventDefault();
    if (!personModal) return;
    setIsSaving(true);
    try {
      const payload = {
        name: personModal.name,
        slug: personModal.slug,
        bio: personModal.bio,
        photoFile: personModal.photoFile,
        removePhoto: personModal.removePhoto,
      };
      const res =
        personModal.mode === 'create'
          ? await appContainer.taxonomyService.createPersonAsync(currentUser, payload)
          : await appContainer.taxonomyService.updatePersonAsync(
              currentUser,
              personModal.editingId!,
              payload,
            );

      if (!res.ok || !res.data) {
        showErrorFeedback(res.messageKey);
        return;
      }

      const savedName = res.data.name;
      setPersonModal(null);
      setFeedback({
        variant: 'success',
        message: t(
          personModal.mode === 'create'
            ? 'admin.taxonomy.persons.feedback.created'
            : 'admin.taxonomy.persons.feedback.updated',
          { name: savedName },
        ),
      });
      await loadAllTaxonomy();
    } finally {
      setIsSaving(false);
    }
  };

  // ==================== Impact Levels Handlers ====================

  const handleSaveImpactLevel = async (event: FormEvent) => {
    event.preventDefault();
    if (!impactModal) return;
    setIsSaving(true);
    try {
      const payload = {
        name: impactModal.name,
        sortOrder: impactModal.sortOrder,
      };
      const res =
        impactModal.mode === 'create'
          ? await appContainer.taxonomyService.createImpactLevelAsync(currentUser, payload)
          : await appContainer.taxonomyService.updateImpactLevelAsync(
              currentUser,
              impactModal.editingId!,
              payload,
            );

      if (!res.ok || !res.data) {
        showErrorFeedback(res.messageKey);
        return;
      }

      const savedName = res.data.name;
      setImpactModal(null);
      setFeedback({
        variant: 'success',
        message: t(
          impactModal.mode === 'create'
            ? 'admin.taxonomy.impact.feedback.created'
            : 'admin.taxonomy.impact.feedback.updated',
          { name: savedName },
        ),
      });
      await loadAllTaxonomy();
    } finally {
      setIsSaving(false);
    }
  };

  // ==================== Age Groups Handlers ====================

  const openEditAgeGroup = (group: AgeGroup) => {
    setAgeGroupModal({
      id: group.id,
      name: group.name,
      minAge: String(group.minAge),
      maxAge: group.maxAge !== null ? String(group.maxAge) : '',
      hasNoMaxAge: group.maxAge === null,
      themeKey: group.themeKey,
      sortOrder: String(group.sortOrder),
      isActive: group.isActive,
    });
  };

  const handleSaveAgeGroup = async (event: FormEvent) => {
    event.preventDefault();
    if (!ageGroupModal) return;
    setIsSaving(true);
    try {
      const res = await appContainer.taxonomyService.updateAgeGroupAsync(
        currentUser,
        ageGroupModal.id,
        {
          name: ageGroupModal.name,
          minAge: ageGroupModal.minAge,
          maxAge: ageGroupModal.hasNoMaxAge ? null : ageGroupModal.maxAge,
          themeKey: ageGroupModal.themeKey,
          sortOrder: ageGroupModal.sortOrder,
          isActive: ageGroupModal.isActive,
        },
      );

      if (!res.ok || !res.data) {
        showErrorFeedback(res.messageKey);
        return;
      }

      const savedName = res.data.name;
      setAgeGroupModal(null);
      setFeedback({
        variant: 'success',
        message: t('admin.taxonomy.ageGroups.feedback.updated', { name: savedName }),
      });
      await loadAllTaxonomy();
    } finally {
      setIsSaving(false);
    }
  };

  // ==================== Delete Handler ====================

  const handleConfirmDelete = async () => {
    if (!deleteConfirm) return;
    setIsSaving(true);
    try {
      if (deleteConfirm.kind === 'topic') {
        const res = await appContainer.taxonomyService.deleteTopicAsync(
          currentUser,
          deleteConfirm.id,
        );
        if (!res.ok) {
          showErrorFeedback(
            res.messageKey,
            res.errorCode === 'TOPIC_HAS_CONTENT' ? deleteConfirm.id : undefined,
          );
          setDeleteConfirm(null);
          return;
        }
        setFeedback({
          variant: 'success',
          message: t('admin.taxonomy.topics.feedback.deleted', { name: deleteConfirm.name }),
        });
      } else if (deleteConfirm.kind === 'tag') {
        const res = await appContainer.taxonomyService.deleteTagAsync(
          currentUser,
          deleteConfirm.id,
        );
        if (!res.ok) {
          showErrorFeedback(res.messageKey);
          setDeleteConfirm(null);
          return;
        }
        setFeedback({
          variant: 'success',
          message: t('admin.taxonomy.tags.feedback.deleted', { name: deleteConfirm.name }),
        });
      } else if (deleteConfirm.kind === 'person') {
        const res = await appContainer.taxonomyService.deletePersonAsync(
          currentUser,
          deleteConfirm.id,
        );
        if (!res.ok) {
          showErrorFeedback(res.messageKey);
          setDeleteConfirm(null);
          return;
        }
        setFeedback({
          variant: 'success',
          message: t('admin.taxonomy.persons.feedback.deleted', { name: deleteConfirm.name }),
        });
      } else if (deleteConfirm.kind === 'impactLevel') {
        const res = await appContainer.taxonomyService.deleteImpactLevelAsync(
          currentUser,
          deleteConfirm.id,
        );
        if (!res.ok) {
          showErrorFeedback(res.messageKey);
          setDeleteConfirm(null);
          return;
        }
        setFeedback({
          variant: 'success',
          message: t('admin.taxonomy.impact.feedback.deleted', { name: deleteConfirm.name }),
        });
      }
      setDeleteConfirm(null);
      await loadAllTaxonomy();
    } finally {
      setIsSaving(false);
    }
  };

  // ==================== Filtered Data & Columns ====================

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
      (item) =>
        item.name.toLowerCase().includes(q) ||
        item.slug.toLowerCase().includes(q) ||
        item.bio.toLowerCase().includes(q),
    );
  }, [persons, personSearch]);

  const tagColumns: TableColumn<TagModel>[] = [
    {
      key: 'name',
      header: t('admin.taxonomy.tags.col.name'),
      render: (row) => <span className="font-semibold text-[var(--color-text)]">{row.name}</span>,
    },
    {
      key: 'slug',
      header: t('admin.taxonomy.tags.col.slug'),
      render: (row) => (
        <code dir="ltr" className="font-mono text-xs text-[var(--color-muted)]">
          {row.slug}
        </code>
      ),
    },
    {
      key: 'actions',
      header: t('admin.taxonomy.common.actions'),
      render: (row) => (
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            startIcon={<Edit3 className="w-3.5 h-3.5" />}
            onClick={() => setTagModal({ id: row.id, name: row.name, slug: row.slug })}
          >
            {t('admin.taxonomy.common.edit')}
          </Button>
          <Button
            type="button"
            variant="danger"
            size="sm"
            startIcon={<Trash2 className="w-3.5 h-3.5" />}
            onClick={() => setDeleteConfirm({ kind: 'tag', id: row.id, name: row.name })}
          >
            {t('admin.taxonomy.common.delete')}
          </Button>
        </div>
      ),
    },
  ];

  const impactColumns: TableColumn<ImpactLevel>[] = [
    {
      key: 'sortOrder',
      header: t('admin.taxonomy.impact.col.sortOrder'),
      numeric: true,
      render: (row) => (
        <span className="font-semibold tabular-nums-strict text-[var(--color-text)]">
          {toPersianDigits(row.sortOrder)}
        </span>
      ),
    },
    {
      key: 'name',
      header: t('admin.taxonomy.impact.col.name'),
      render: (row) => <span className="font-semibold text-[var(--color-text)]">{row.name}</span>,
    },
    {
      key: 'actions',
      header: t('admin.taxonomy.common.actions'),
      render: (row) => (
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            startIcon={<Edit3 className="w-3.5 h-3.5" />}
            onClick={() =>
              setImpactModal({
                mode: 'edit',
                editingId: row.id,
                name: row.name,
                sortOrder: String(row.sortOrder),
              })
            }
          >
            {t('admin.taxonomy.common.edit')}
          </Button>
          <Button
            type="button"
            variant="danger"
            size="sm"
            startIcon={<Trash2 className="w-3.5 h-3.5" />}
            onClick={() =>
              setDeleteConfirm({ kind: 'impactLevel', id: row.id, name: row.name })
            }
          >
            {t('admin.taxonomy.common.delete')}
          </Button>
        </div>
      ),
    },
  ];

  const ageGroupColumns: TableColumn<AgeGroup>[] = [
    {
      key: 'key',
      header: t('admin.taxonomy.ageGroups.col.key'),
      render: (row) => (
        <code dir="ltr" className="font-mono text-xs text-[var(--color-muted)]">
          {row.key}
        </code>
      ),
    },
    {
      key: 'name',
      header: t('admin.taxonomy.ageGroups.col.name'),
      render: (row) => <span className="font-semibold text-[var(--color-text)]">{row.name}</span>,
    },
    {
      key: 'range',
      header: t('admin.taxonomy.ageGroups.col.range'),
      numeric: true,
      render: (row) => (
        <span className="text-xs font-medium text-[var(--color-text)] tabular-nums-strict">
          {formatAgeGroupRange(row)}
        </span>
      ),
    },
    {
      key: 'theme',
      header: t('admin.taxonomy.ageGroups.col.theme'),
      render: (row) => <Tag label={t(getThemeNameKey(row.themeKey))} variant="accent" />,
    },
    {
      key: 'sortOrder',
      header: t('admin.taxonomy.ageGroups.col.sortOrder'),
      numeric: true,
      render: (row) => (
        <span className="tabular-nums-strict text-xs text-[var(--color-text)]">
          {toPersianDigits(row.sortOrder)}
        </span>
      ),
    },
    {
      key: 'status',
      header: t('admin.taxonomy.ageGroups.col.status'),
      render: (row) => (
        <Tag
          label={
            row.isActive
              ? t('admin.taxonomy.common.active')
              : t('admin.taxonomy.common.inactive')
          }
          variant={row.isActive ? 'success' : 'warning'}
        />
      ),
    },
    {
      key: 'actions',
      header: t('admin.taxonomy.common.actions'),
      render: (row) => (
        <Button
          type="button"
          variant="outline"
          size="sm"
          startIcon={<Edit3 className="w-3.5 h-3.5" />}
          onClick={() => openEditAgeGroup(row)}
        >
          {t('admin.taxonomy.common.edit')}
        </Button>
      ),
    },
  ];

  // Recursive RTL Topic Tree renderer
  const renderTopicNodes = (nodes: TopicTreeNode[]) => {
    return (
      <ul className="space-y-2">
        {nodes.map((node) => {
          const { topic, children, totalSubtreeContentCount } = node;
          const hasChildren = children.length > 0;
          const isCollapsed = collapsedTopicIds.has(topic.id);

          return (
            <li key={topic.id} className="space-y-2">
              <div
                className={`rounded-[var(--radius-control)] border border-[var(--color-border)] bg-[var(--color-surface)] p-3 sm:p-3.5 flex flex-wrap items-center justify-between gap-3 ${
                  !topic.isActive ? 'opacity-70 bg-[var(--color-surface-alt)]' : ''
                }`}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  {hasChildren ? (
                    <button
                      type="button"
                      onClick={() => toggleTopicCollapse(topic.id)}
                      aria-label={t('admin.taxonomy.topics.toggleExpandAria', {
                        name: topic.name,
                      })}
                      className="w-7 h-7 inline-flex items-center justify-center rounded-[var(--radius-control)] border border-[var(--color-border)] text-[var(--color-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-alt)]"
                    >
                      {isCollapsed ? (
                        <ChevronLeft className="w-4 h-4" />
                      ) : (
                        <ChevronDown className="w-4 h-4" />
                      )}
                    </button>
                  ) : (
                    <span className="w-7 h-7 inline-flex items-center justify-center text-[var(--color-muted)] text-xs">
                      •
                    </span>
                  )}

                  <div className="min-w-0 space-y-0.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-sm text-[var(--color-text)]">
                        {topic.name}
                      </span>
                      {topic.icon && (
                        <code
                          dir="ltr"
                          className="text-[11px] font-mono px-1.5 py-0.5 rounded bg-[var(--color-surface-alt)] text-[var(--color-muted)]"
                        >
                          {topic.icon}
                        </code>
                      )}
                      <Tag
                        label={
                          topic.isActive
                            ? t('admin.taxonomy.common.active')
                            : t('admin.taxonomy.common.inactive')
                        }
                        variant={topic.isActive ? 'success' : 'warning'}
                      />
                    </div>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--color-muted)] tabular-nums-strict">
                      <code dir="ltr" className="font-mono">
                        {topic.slug}
                      </code>
                      <span>
                        {t('admin.taxonomy.topics.sortBadge', {
                          order: toPersianDigits(topic.sortOrder),
                        })}
                      </span>
                      <span>
                        {t('admin.taxonomy.topics.contentCountBadge', {
                          count: toPersianDigits(totalSubtreeContentCount),
                        })}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-1.5">
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    startIcon={<Plus className="w-3.5 h-3.5" />}
                    onClick={() => openCreateChildTopic(topic)}
                  >
                    {t('admin.taxonomy.topics.addChild')}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    startIcon={<Edit3 className="w-3.5 h-3.5" />}
                    onClick={() => openEditTopic(topic)}
                  >
                    {t('admin.taxonomy.common.edit')}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    startIcon={<Power className="w-3.5 h-3.5" />}
                    onClick={() => void handleToggleTopicActive(topic)}
                  >
                    {topic.isActive
                      ? t('admin.taxonomy.topics.deactivateAction')
                      : t('admin.taxonomy.topics.activateAction')}
                  </Button>
                  <Button
                    type="button"
                    variant="danger"
                    size="sm"
                    startIcon={<Trash2 className="w-3.5 h-3.5" />}
                    onClick={() =>
                      setDeleteConfirm({ kind: 'topic', id: topic.id, name: topic.name })
                    }
                  >
                    {t('admin.taxonomy.common.delete')}
                  </Button>
                </div>
              </div>

              {hasChildren && !isCollapsed && (
                <div className="pr-5 sm:pr-7 border-r-2 border-[var(--color-border)] mr-3">
                  {renderTopicNodes(children)}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    );
  };

  const tabItems: Array<{
    key: TaxonomyTabKey;
    label: string;
    icon: typeof FolderTree;
  }> = [
    {
      key: 'topics',
      label: t('admin.taxonomy.tab.topics', { count: toPersianDigits(topics.length) }),
      icon: FolderTree,
    },
    {
      key: 'tags',
      label: t('admin.taxonomy.tab.tags', { count: toPersianDigits(tags.length) }),
      icon: Hash,
    },
    {
      key: 'persons',
      label: t('admin.taxonomy.tab.persons', { count: toPersianDigits(persons.length) }),
      icon: Users,
    },
    {
      key: 'impactLevels',
      label: t('admin.taxonomy.tab.impactLevels', {
        count: toPersianDigits(impactLevels.length),
      }),
      icon: Gauge,
    },
    {
      key: 'ageGroups',
      label: t('admin.taxonomy.tab.ageGroups', { count: toPersianDigits(ageGroups.length) }),
      icon: UserCheck,
    },
  ];

  const themeOptions: SelectOption[] = THEME_KEYS.map((key) => ({
    value: key,
    label: t(getThemeNameKey(key)),
  }));

  const currentPersonPreviewSrc = personModal
    ? personModal.photoPreviewUrl ??
      (!personModal.removePhoto && personModal.editingId
        ? personPhotoUrls[personModal.editingId] ?? null
        : null)
    : null;

  return (
    <AdminLayout currentRoute={currentRoute}>
      <div className="space-y-6">
        {/* Header Card */}
        <section className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-card)] shadow-[var(--shadow-card)] p-5 sm:p-6 space-y-4">
          <div className="space-y-1">
            <h1 className="text-xl sm:text-2xl font-bold text-[var(--color-text)] flex items-center gap-2">
              <Layers className="w-6 h-6 text-[var(--color-primary)] shrink-0" aria-hidden="true" />
              <span>{t('admin.taxonomy.title')}</span>
            </h1>
            <p className="text-xs sm:text-sm text-[var(--color-muted)] leading-relaxed">
              {t('admin.taxonomy.subtitle')}
            </p>
          </div>

          {/* 5 Tabs Navigation */}
          <div
            role="tablist"
            aria-label={t('admin.taxonomy.tabs.ariaLabel')}
            className="flex flex-wrap gap-2 pt-2 border-t border-[var(--color-border)]"
          >
            {tabItems.map((tab) => {
              const Icon = tab.icon;
              const isSelected = activeTab === tab.key;
              return (
                <button
                  key={tab.key}
                  type="button"
                  role="tab"
                  aria-selected={isSelected}
                  onClick={() => {
                    setFeedback(null);
                    setActiveTab(tab.key);
                  }}
                  className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-[var(--radius-control)] text-xs sm:text-sm font-semibold border transition-colors tabular-nums-strict ${
                    isSelected
                      ? 'bg-[var(--color-primary-button)] text-[var(--color-on-primary)] border-transparent'
                      : 'bg-[var(--color-surface-alt)] text-[var(--color-text)] border-[var(--color-border)] hover:border-[var(--color-primary)]'
                  }`}
                >
                  <Icon className="w-4 h-4 shrink-0" aria-hidden="true" />
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </div>
        </section>

        {feedback && (
          <div className="space-y-2">
            <Alert
              variant={feedback.variant}
              message={feedback.message}
              onDismiss={() => setFeedback(null)}
            />
            {feedback.deactivateTopicId !== undefined && (
              <div className="flex justify-end">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  startIcon={<Power className="w-4 h-4" />}
                  onClick={() => {
                    const target = topics.find((x) => x.id === feedback.deactivateTopicId);
                    if (target) {
                      void handleToggleTopicActive({ ...target, isActive: true });
                    }
                  }}
                >
                  {t('admin.taxonomy.topics.deactivatePromptAction')}
                </Button>
              </div>
            )}
          </div>
        )}

        {/* Tab 1: Topics Tree */}
        {activeTab === 'topics' && (
          <section className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-card)] shadow-[var(--shadow-card)] p-5 sm:p-6 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-base sm:text-lg font-bold text-[var(--color-text)]">
                {t('admin.taxonomy.tab.topics', { count: toPersianDigits(topics.length) })}
              </h2>
              <Button
                type="button"
                variant="primary"
                startIcon={<Plus className="w-4 h-4" />}
                onClick={openCreateRootTopic}
              >
                {t('admin.taxonomy.topics.addRoot')}
              </Button>
            </div>

            {!isLoading && topicTree.length === 0 ? (
              <p className="text-sm text-[var(--color-muted)] py-6 text-center">
                {t('admin.taxonomy.topics.empty')}
              </p>
            ) : (
              renderTopicNodes(topicTree)
            )}
          </section>
        )}

        {/* Tab 2: Tags */}
        {activeTab === 'tags' && (
          <section className="space-y-4">
            <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-card)] shadow-[var(--shadow-card)] p-5 sm:p-6 space-y-4">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-end">
                <form onSubmit={handleQuickCreateTag} className="flex flex-wrap items-end gap-2">
                  <div className="flex-1 min-w-[200px]">
                    <FormField
                      id="quick-tag-name"
                      label={t('admin.taxonomy.tags.addButton')}
                      value={quickTagName}
                      onChange={setQuickTagName}
                      placeholder={t('admin.taxonomy.tags.addPlaceholder')}
                    />
                  </div>
                  <Button
                    type="submit"
                    variant="primary"
                    disabled={isSaving || !quickTagName.trim()}
                    startIcon={<Plus className="w-4 h-4" />}
                  >
                    {t('admin.taxonomy.tags.addButton')}
                  </Button>
                </form>

                <FormField
                  id="tag-search"
                  type="search"
                  label={t('layout.header.searchAction')}
                  value={tagSearch}
                  onChange={setTagSearch}
                  placeholder={t('admin.taxonomy.common.searchPlaceholder')}
                />
              </div>
            </div>

            <Table
              columns={tagColumns}
              rows={isLoading ? [] : filteredTags}
              getRowKey={(row) => String(row.id)}
              emptyText={t('admin.taxonomy.tags.empty')}
            />
          </section>
        )}

        {/* Tab 3: Persons */}
        {activeTab === 'persons' && (
          <section className="space-y-4">
            <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-card)] shadow-[var(--shadow-card)] p-5 sm:p-6 flex flex-wrap items-end justify-between gap-4">
              <div className="flex-1 min-w-[240px]">
                <FormField
                  id="person-search"
                  type="search"
                  label={t('layout.header.searchAction')}
                  value={personSearch}
                  onChange={setPersonSearch}
                  placeholder={t('admin.taxonomy.common.searchPlaceholder')}
                />
              </div>
              <Button
                type="button"
                variant="primary"
                startIcon={<Plus className="w-4 h-4" />}
                onClick={openCreatePerson}
              >
                {t('admin.taxonomy.persons.addButton')}
              </Button>
            </div>

            {!isLoading && filteredPersons.length === 0 ? (
              <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-card)] p-8 text-center text-sm text-[var(--color-muted)]">
                {t('admin.taxonomy.persons.empty')}
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {filteredPersons.map((person) => {
                  const photoUrl = personPhotoUrls[person.id];
                  return (
                    <article
                      key={person.id}
                      className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-card)] shadow-[var(--shadow-card)] p-4 sm:p-5 flex gap-4 justify-between"
                    >
                      <div className="flex gap-3.5 min-w-0 flex-1">
                        <div className="w-16 h-16 rounded-full overflow-hidden border border-[var(--color-border)] bg-[var(--color-surface-alt)] shrink-0 flex items-center justify-center">
                          {photoUrl ? (
                            <img
                              src={photoUrl}
                              alt={person.name}
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <Users
                              className="w-6 h-6 text-[var(--color-muted)]"
                              aria-hidden="true"
                            />
                          )}
                        </div>

                        <div className="min-w-0 space-y-1 flex-1">
                          <h3 className="font-bold text-sm sm:text-base text-[var(--color-text)] truncate">
                            {person.name}
                          </h3>
                          <code
                            dir="ltr"
                            className="block font-mono text-xs text-[var(--color-muted)] truncate"
                          >
                            {person.slug}
                          </code>
                          <p className="text-xs text-[var(--color-muted)] line-clamp-2 leading-relaxed">
                            {person.bio || t('admin.taxonomy.persons.noBio')}
                          </p>
                        </div>
                      </div>

                      <div className="flex flex-col gap-2 shrink-0">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          startIcon={<Edit3 className="w-3.5 h-3.5" />}
                          onClick={() => openEditPerson(person)}
                        >
                          {t('admin.taxonomy.common.edit')}
                        </Button>
                        <Button
                          type="button"
                          variant="danger"
                          size="sm"
                          startIcon={<Trash2 className="w-3.5 h-3.5" />}
                          onClick={() =>
                            setDeleteConfirm({
                              kind: 'person',
                              id: person.id,
                              name: person.name,
                            })
                          }
                        >
                          {t('admin.taxonomy.common.delete')}
                        </Button>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        )}

        {/* Tab 4: Impact Levels */}
        {activeTab === 'impactLevels' && (
          <section className="space-y-4">
            <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-card)] shadow-[var(--shadow-card)] p-5 sm:p-6 flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-base sm:text-lg font-bold text-[var(--color-text)]">
                {t('admin.taxonomy.tab.impactLevels', {
                  count: toPersianDigits(impactLevels.length),
                })}
              </h2>
              <Button
                type="button"
                variant="primary"
                startIcon={<Plus className="w-4 h-4" />}
                onClick={() =>
                  setImpactModal({
                    mode: 'create',
                    name: '',
                    sortOrder: String(impactLevels.length + 1),
                  })
                }
              >
                {t('admin.taxonomy.impact.addButton')}
              </Button>
            </div>

            <Table
              columns={impactColumns}
              rows={isLoading ? [] : impactLevels}
              getRowKey={(row) => String(row.id)}
              emptyText={t('admin.taxonomy.impact.empty')}
            />
          </section>
        )}

        {/* Tab 5: Age Groups */}
        {activeTab === 'ageGroups' && (
          <section className="space-y-4">
            <Alert variant="info" message={t('admin.taxonomy.ageGroups.infoBanner')} />
            <Table
              columns={ageGroupColumns}
              rows={isLoading ? [] : ageGroups}
              getRowKey={(row) => String(row.id)}
              emptyText={t('ui.table.emptyText')}
            />
          </section>
        )}
      </div>

      {/* Modal: Topic Create / Edit */}
      <Modal
        open={topicModal !== null}
        onClose={() => setTopicModal(null)}
        title={
          topicModal?.mode === 'edit'
            ? t('admin.taxonomy.topics.editTitle', { name: topicModal.name })
            : topicModal?.parentId !== null && topicModal?.parentId !== undefined
              ? t('admin.taxonomy.topics.createChildTitle', {
                  parent:
                    topics.find((item) => item.id === topicModal.parentId)?.name ?? '',
                })
              : t('admin.taxonomy.topics.createRootTitle')
        }
        footer={
          <>
            <Button type="button" variant="ghost" onClick={() => setTopicModal(null)}>
              {t('admin.taxonomy.common.cancel')}
            </Button>
            <Button
              type="submit"
              form="topic-form"
              variant="primary"
              disabled={isSaving}
            >
              {isSaving ? t('admin.taxonomy.common.saving') : t('admin.taxonomy.common.save')}
            </Button>
          </>
        }
      >
        {topicModal && (
          <form id="topic-form" onSubmit={handleSaveTopic} className="space-y-4" noValidate>
            <FormField
              id="topic-name"
              label={t('admin.taxonomy.topics.fieldName')}
              value={topicModal.name}
              onChange={(val) => setTopicModal({ ...topicModal, name: val })}
              placeholder={t('admin.taxonomy.topics.fieldNamePlaceholder')}
              required
            />
            <FormField
              id="topic-slug"
              label={t('admin.taxonomy.common.slugLabel')}
              value={topicModal.slug}
              onChange={(val) => setTopicModal({ ...topicModal, slug: val })}
              placeholder={t('admin.taxonomy.common.slugPlaceholder')}
            />
            <FormField
              id="topic-parent"
              kind="select"
              label={t('admin.taxonomy.topics.fieldParent')}
              value={topicModal.parentId !== null ? String(topicModal.parentId) : ''}
              onChange={(val) =>
                setTopicModal({
                  ...topicModal,
                  parentId: val ? Number.parseInt(val, 10) : null,
                })
              }
              options={availableTopicParentOptions}
            />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <FormField
                id="topic-sort"
                label={t('admin.taxonomy.common.sortOrderLabel')}
                value={topicModal.sortOrder}
                onChange={(val) => setTopicModal({ ...topicModal, sortOrder: val })}
                required
              />
              <FormField
                id="topic-icon"
                label={t('admin.taxonomy.topics.fieldIcon')}
                value={topicModal.icon}
                onChange={(val) => setTopicModal({ ...topicModal, icon: val })}
                placeholder={t('admin.taxonomy.topics.fieldIconPlaceholder')}
              />
            </div>
            <label className="flex items-center gap-2.5 text-sm font-medium text-[var(--color-text)] cursor-pointer">
              <input
                type="checkbox"
                checked={topicModal.isActive}
                onChange={(e) =>
                  setTopicModal({ ...topicModal, isActive: e.target.checked })
                }
                className="w-4 h-4 accent-[var(--color-primary)]"
              />
              <span>{t('admin.taxonomy.topics.fieldActive')}</span>
            </label>
          </form>
        )}
      </Modal>

      {/* Modal: Tag Edit */}
      <Modal
        open={tagModal !== null}
        onClose={() => setTagModal(null)}
        title={t('admin.taxonomy.tags.editTitle', { name: tagModal?.name ?? '' })}
        footer={
          <>
            <Button type="button" variant="ghost" onClick={() => setTagModal(null)}>
              {t('admin.taxonomy.common.cancel')}
            </Button>
            <Button type="submit" form="tag-form" variant="primary" disabled={isSaving}>
              {isSaving ? t('admin.taxonomy.common.saving') : t('admin.taxonomy.common.save')}
            </Button>
          </>
        }
      >
        {tagModal && (
          <form id="tag-form" onSubmit={handleSaveTag} className="space-y-4" noValidate>
            <FormField
              id="tag-edit-name"
              label={t('admin.taxonomy.tags.fieldName')}
              value={tagModal.name}
              onChange={(val) => setTagModal({ ...tagModal, name: val })}
              required
            />
            <FormField
              id="tag-edit-slug"
              label={t('admin.taxonomy.common.slugLabel')}
              value={tagModal.slug}
              onChange={(val) => setTagModal({ ...tagModal, slug: val })}
              placeholder={t('admin.taxonomy.common.slugPlaceholder')}
            />
          </form>
        )}
      </Modal>

      {/* Modal: Person Create / Edit */}
      <Modal
        open={personModal !== null}
        onClose={() => setPersonModal(null)}
        title={
          personModal?.mode === 'edit'
            ? t('admin.taxonomy.persons.editTitle', { name: personModal.name })
            : t('admin.taxonomy.persons.createTitle')
        }
        footer={
          <>
            <Button type="button" variant="ghost" onClick={() => setPersonModal(null)}>
              {t('admin.taxonomy.common.cancel')}
            </Button>
            <Button type="submit" form="person-form" variant="primary" disabled={isSaving}>
              {isSaving ? t('admin.taxonomy.common.saving') : t('admin.taxonomy.common.save')}
            </Button>
          </>
        }
      >
        {personModal && (
          <form id="person-form" onSubmit={handleSavePerson} className="space-y-4" noValidate>
            <FormField
              id="person-name"
              label={t('admin.taxonomy.persons.fieldName')}
              value={personModal.name}
              onChange={(val) => setPersonModal({ ...personModal, name: val })}
              placeholder={t('admin.taxonomy.persons.fieldNamePlaceholder')}
              required
            />
            <FormField
              id="person-slug"
              label={t('admin.taxonomy.common.slugLabel')}
              value={personModal.slug}
              onChange={(val) => setPersonModal({ ...personModal, slug: val })}
              placeholder={t('admin.taxonomy.common.slugPlaceholder')}
            />
            <div className="space-y-1">
              <FormField
                id="person-bio"
                kind="textarea"
                rows={4}
                label={t('admin.taxonomy.persons.fieldBio')}
                value={personModal.bio}
                onChange={(val) => setPersonModal({ ...personModal, bio: val })}
                placeholder={t('admin.taxonomy.persons.fieldBioPlaceholder')}
              />
              <div
                className={`text-xs text-left tabular-nums-strict ${
                  personModal.bio.trim().length > MAX_PERSON_BIO_LENGTH
                    ? 'text-[var(--color-error-text)] font-semibold'
                    : 'text-[var(--color-muted)]'
                }`}
              >
                {t('admin.taxonomy.persons.bioCounter', {
                  count: toPersianDigits(personModal.bio.trim().length),
                })}
              </div>
            </div>

            <div className="space-y-2 pt-2 border-t border-[var(--color-border)]">
              <p className="text-sm font-medium text-[var(--color-text)]">
                {t('admin.taxonomy.persons.fieldPhoto')}
              </p>

              <div className="flex flex-wrap items-center gap-3">
                <div className="w-16 h-16 rounded-full overflow-hidden border border-[var(--color-border)] bg-[var(--color-surface-alt)] flex items-center justify-center shrink-0">
                  {currentPersonPreviewSrc ? (
                    <img
                      src={currentPersonPreviewSrc}
                      alt={personModal.name}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <Users className="w-6 h-6 text-[var(--color-muted)]" aria-hidden="true" />
                  )}
                </div>

                <input
                  ref={personPhotoInputRef}
                  type="file"
                  accept=".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp"
                  onChange={(e) => void handlePickPersonPhoto(e)}
                  className="hidden"
                />

                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  startIcon={<ImagePlus className="w-4 h-4" />}
                  onClick={() => personPhotoInputRef.current?.click()}
                >
                  {t('admin.taxonomy.persons.pickPhoto')}
                </Button>

                {currentPersonPreviewSrc && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setPersonModal({
                        ...personModal,
                        photoFile: null,
                        photoPreviewUrl: null,
                        removePhoto: true,
                      })
                    }
                  >
                    {t('admin.taxonomy.persons.removePhoto')}
                  </Button>
                )}
              </div>
            </div>
          </form>
        )}
      </Modal>

      {/* Modal: Impact Level Create / Edit */}
      <Modal
        open={impactModal !== null}
        onClose={() => setImpactModal(null)}
        title={
          impactModal?.mode === 'edit'
            ? t('admin.taxonomy.impact.editTitle', { name: impactModal.name })
            : t('admin.taxonomy.impact.createTitle')
        }
        footer={
          <>
            <Button type="button" variant="ghost" onClick={() => setImpactModal(null)}>
              {t('admin.taxonomy.common.cancel')}
            </Button>
            <Button type="submit" form="impact-form" variant="primary" disabled={isSaving}>
              {isSaving ? t('admin.taxonomy.common.saving') : t('admin.taxonomy.common.save')}
            </Button>
          </>
        }
      >
        {impactModal && (
          <form
            id="impact-form"
            onSubmit={handleSaveImpactLevel}
            className="space-y-4"
            noValidate
          >
            <FormField
              id="impact-name"
              label={t('admin.taxonomy.impact.fieldName')}
              value={impactModal.name}
              onChange={(val) => setImpactModal({ ...impactModal, name: val })}
              placeholder={t('admin.taxonomy.impact.fieldNamePlaceholder')}
              required
            />
            <FormField
              id="impact-sort"
              label={t('admin.taxonomy.common.sortOrderLabel')}
              value={impactModal.sortOrder}
              onChange={(val) => setImpactModal({ ...impactModal, sortOrder: val })}
              required
            />
          </form>
        )}
      </Modal>

      {/* Modal: Age Group Edit */}
      <Modal
        open={ageGroupModal !== null}
        onClose={() => setAgeGroupModal(null)}
        title={t('admin.taxonomy.ageGroups.editTitle', { name: ageGroupModal?.name ?? '' })}
        footer={
          <>
            <Button type="button" variant="ghost" onClick={() => setAgeGroupModal(null)}>
              {t('admin.taxonomy.common.cancel')}
            </Button>
            <Button type="submit" form="agegroup-form" variant="primary" disabled={isSaving}>
              {isSaving ? t('admin.taxonomy.common.saving') : t('admin.taxonomy.common.save')}
            </Button>
          </>
        }
      >
        {ageGroupModal && (
          <form
            id="agegroup-form"
            onSubmit={handleSaveAgeGroup}
            className="space-y-4"
            noValidate
          >
            <FormField
              id="agegroup-name"
              label={t('admin.taxonomy.ageGroups.fieldName')}
              value={ageGroupModal.name}
              onChange={(val) => setAgeGroupModal({ ...ageGroupModal, name: val })}
              required
            />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <FormField
                id="agegroup-min"
                label={t('admin.taxonomy.ageGroups.fieldMinAge')}
                value={ageGroupModal.minAge}
                onChange={(val) => setAgeGroupModal({ ...ageGroupModal, minAge: val })}
                required
              />
              <FormField
                id="agegroup-max"
                label={t('admin.taxonomy.ageGroups.fieldMaxAge')}
                value={ageGroupModal.hasNoMaxAge ? '' : ageGroupModal.maxAge}
                onChange={(val) => setAgeGroupModal({ ...ageGroupModal, maxAge: val })}
                disabled={ageGroupModal.hasNoMaxAge}
              />
            </div>

            <label className="flex items-center gap-2.5 text-sm text-[var(--color-text)] cursor-pointer">
              <input
                type="checkbox"
                checked={ageGroupModal.hasNoMaxAge}
                onChange={(e) =>
                  setAgeGroupModal({
                    ...ageGroupModal,
                    hasNoMaxAge: e.target.checked,
                  })
                }
                className="w-4 h-4 accent-[var(--color-primary)]"
              />
              <span>{t('admin.taxonomy.ageGroups.noMaxAgeLabel')}</span>
            </label>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <FormField
                id="agegroup-theme"
                kind="select"
                label={t('admin.taxonomy.ageGroups.fieldTheme')}
                value={ageGroupModal.themeKey}
                onChange={(val) =>
                  setAgeGroupModal({ ...ageGroupModal, themeKey: val as ThemeKey })
                }
                options={themeOptions}
              />
              <FormField
                id="agegroup-sort"
                label={t('admin.taxonomy.common.sortOrderLabel')}
                value={ageGroupModal.sortOrder}
                onChange={(val) => setAgeGroupModal({ ...ageGroupModal, sortOrder: val })}
                required
              />
            </div>

            <label className="flex items-center gap-2.5 text-sm font-medium text-[var(--color-text)] cursor-pointer">
              <input
                type="checkbox"
                checked={ageGroupModal.isActive}
                onChange={(e) =>
                  setAgeGroupModal({ ...ageGroupModal, isActive: e.target.checked })
                }
                className="w-4 h-4 accent-[var(--color-primary)]"
              />
              <span>{t('admin.taxonomy.ageGroups.fieldActive')}</span>
            </label>
          </form>
        )}
      </Modal>

      {/* Modal: Delete Confirmation */}
      <Modal
        open={deleteConfirm !== null}
        onClose={() => setDeleteConfirm(null)}
        title={t('admin.taxonomy.common.confirmDeleteTitle')}
        footer={
          <>
            <Button type="button" variant="ghost" onClick={() => setDeleteConfirm(null)}>
              {t('admin.taxonomy.common.cancel')}
            </Button>
            <Button
              type="button"
              variant="danger"
              disabled={isSaving}
              onClick={() => void handleConfirmDelete()}
            >
              {t('admin.taxonomy.common.confirmDeleteSubmit')}
            </Button>
          </>
        }
      >
        {deleteConfirm && (
          <p>
            {deleteConfirm.kind === 'topic'
              ? t('admin.taxonomy.topics.deleteBody', { name: deleteConfirm.name })
              : deleteConfirm.kind === 'tag'
                ? t('admin.taxonomy.tags.deleteBody', { name: deleteConfirm.name })
                : deleteConfirm.kind === 'person'
                  ? t('admin.taxonomy.persons.deleteBody', { name: deleteConfirm.name })
                  : t('admin.taxonomy.impact.deleteBody', { name: deleteConfirm.name })}
          </p>
        )}
      </Modal>
    </AdminLayout>
  );
}
