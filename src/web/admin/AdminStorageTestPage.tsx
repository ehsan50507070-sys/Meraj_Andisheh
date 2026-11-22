import {
  ExternalLink,
  FileWarning,
  HardDriveUpload,
  ShieldCheck,
  Trash2,
  Upload,
} from 'lucide-react';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
} from 'react';
import type {
  FileCategory,
  FileVisibility,
  StoredFileMetadata,
} from '../../core/domain/storage';
import type { UploadLimits } from '../../core/services/fileUploadService';
import { useAuth } from '../auth/AuthContext';
import {
  Alert,
  Button,
  FormField,
  Table,
  Tag,
  type TableColumn,
} from '../components/ui';
import { toPersianDigits } from '../resources/formatters';
import type { ResourceKey } from '../resources/fa';
import { t } from '../resources/i18n';
import { navigateToHash } from '../router/HashRouter';
import { appContainer } from '../services/appContainer';
import { AdminLayout } from './AdminLayout';

interface AdminStorageTestPageProps {
  currentRoute: string;
}

// Valid 1x1 transparent PNG bytes (real PNG signature + IHDR + IDAT + IEND)
const SAMPLE_VALID_PNG_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41,
  0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00,
  0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
  0x42, 0x60, 0x82,
]);

const SAMPLE_VALID_PDF_BYTES = new Uint8Array([
  0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34,
  0x0a, 0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a, 0x31,
  0x20, 0x30, 0x20, 0x6f, 0x62, 0x6a, 0x0a, 0x3c,
  0x3c, 0x3e, 0x3e, 0x0a, 0x65, 0x6e, 0x64, 0x6f,
  0x62, 0x6a, 0x0a, 0x25, 0x25, 0x45, 0x4f, 0x46,
]);

const SAMPLE_FAKE_EXE_BYTES = new Uint8Array([
  0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00,
  0x04, 0x00, 0x00, 0x00, 0xff, 0xff, 0x00, 0x00,
]);

function formatFileSizePersian(bytes: number): string {
  if (bytes >= 1024 * 1024) {
    return t('storage.size.mb', {
      value: toPersianDigits((bytes / (1024 * 1024)).toFixed(2)),
    });
  }
  if (bytes >= 1024) {
    return t('storage.size.kb', {
      value: toPersianDigits((bytes / 1024).toFixed(1)),
    });
  }
  return t('storage.size.bytes', { value: toPersianDigits(bytes) });
}

function getCategoryLabelKey(category: FileCategory): ResourceKey {
  return `storage.category.${category}` as ResourceKey;
}

export function AdminStorageTestPage({ currentRoute }: AdminStorageTestPageProps) {
  const { currentUser } = useAuth();
  const [visibility, setVisibility] = useState<FileVisibility>('private');
  const [limits, setLimits] = useState<UploadLimits>({ maxVideoMb: 500, maxOtherMb: 100 });
  const [files, setFiles] = useState<StoredFileMetadata[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [feedback, setFeedback] = useState<{
    variant: 'success' | 'error';
    title?: string;
    message: string;
    storageKey?: string;
  } | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const loadStorageData = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await appContainer.fileUploadService.listFilesAsync(currentUser);
      if (res.ok) {
        setFiles(res.items ?? []);
        if (res.limits) {
          setLimits(res.limits);
        }
      }
    } finally {
      setIsLoading(false);
    }
  }, [currentUser]);

  useEffect(() => {
    void loadStorageData();
  }, [loadStorageData]);

  const executeUpload = async (
    originalFileName: string,
    bytes: Uint8Array,
    targetVisibility: FileVisibility,
    overrideSizeBytes?: number,
  ) => {
    setIsUploading(true);
    setFeedback(null);
    try {
      const res = await appContainer.fileUploadService.uploadFileAsync(currentUser, {
        originalFileName,
        bytes,
        visibility: targetVisibility,
        overrideSizeBytes,
      });

      if (!res.ok || !res.metadata) {
        setFeedback({
          variant: 'error',
          title: t('admin.storage.uploadRejectedTitle'),
          message: res.messageKey
            ? t(res.messageKey as ResourceKey)
            : t('storage.error.generic'),
        });
        return;
      }

      setFeedback({
        variant: 'success',
        message: t('admin.storage.uploadSuccess', { name: res.metadata.originalFileName }),
        storageKey: res.metadata.storageKey,
      });
      await loadStorageData();
    } finally {
      setIsUploading(false);
    }
  };

  const handleBrowserFile = async (file: File | undefined) => {
    if (!file) {
      return;
    }
    const buffer = await file.arrayBuffer();
    await executeUpload(file.name, new Uint8Array(buffer), visibility);
  };

  const handleFileInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    const picked = event.target.files?.[0];
    event.target.value = '';
    void handleBrowserFile(picked);
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragging(false);
    const dropped = event.dataTransfer.files?.[0];
    void handleBrowserFile(dropped);
  };

  const handleDelete = async (storageKey: string) => {
    const res = await appContainer.fileUploadService.deleteFileAsync(currentUser, storageKey);
    if (res.ok) {
      setFeedback({
        variant: 'success',
        message: t('admin.storage.deletedSuccess'),
      });
      await loadStorageData();
    }
  };

  const columns: TableColumn<StoredFileMetadata>[] = [
    {
      key: 'storageKey',
      header: t('admin.storage.col.storageKey'),
      render: (row) => (
        <code
          dir="ltr"
          className="font-mono text-xs text-[var(--color-text)] bg-[var(--color-surface-alt)] px-2 py-1 rounded break-all"
        >
          {row.storageKey}
        </code>
      ),
    },
    {
      key: 'originalFileName',
      header: t('admin.storage.col.originalName'),
      render: (row) => (
        <span dir="ltr" className="font-mono text-xs text-[var(--color-muted)]">
          {row.originalFileName}
        </span>
      ),
    },
    {
      key: 'category',
      header: t('admin.storage.col.category'),
      render: (row) => (
        <Tag label={t(getCategoryLabelKey(row.category))} variant="neutral" />
      ),
    },
    {
      key: 'sizeBytes',
      header: t('admin.storage.col.size'),
      numeric: true,
      render: (row) => (
        <span className="text-xs text-[var(--color-text)] tabular-nums-strict">
          {formatFileSizePersian(row.sizeBytes)}
        </span>
      ),
    },
    {
      key: 'visibility',
      header: t('admin.storage.col.visibility'),
      render: (row) => (
        <Tag
          label={
            row.visibility === 'public'
              ? t('storage.visibility.public')
              : t('storage.visibility.private')
          }
          variant={row.visibility === 'public' ? 'success' : 'primary'}
        />
      ),
    },
    {
      key: 'actions',
      header: t('admin.storage.col.actions'),
      render: (row) => (
        <div className="flex flex-wrap items-center gap-1.5">
          <Button
            variant="outline"
            size="sm"
            onClick={() => navigateToHash(`/media/${row.storageKey}`)}
            startIcon={<ExternalLink className="w-3.5 h-3.5" />}
          >
            {t('admin.storage.openPublicAction')}
          </Button>
          <Button
            variant="danger"
            size="sm"
            onClick={() => void handleDelete(row.storageKey)}
            startIcon={<Trash2 className="w-3.5 h-3.5" />}
          >
            {t('admin.storage.deleteAction')}
          </Button>
        </div>
      ),
    },
  ];

  return (
    <AdminLayout currentRoute={currentRoute}>
      <div className="space-y-6">
        {/* Header & Live SiteSetting Limits */}
        <section className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-card)] shadow-[var(--shadow-card)] p-5 sm:p-6 space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="space-y-1 max-w-2xl">
              <h1 className="text-xl sm:text-2xl font-bold text-[var(--color-text)] flex items-center gap-2">
                <HardDriveUpload className="w-6 h-6 text-[var(--color-primary)] shrink-0" aria-hidden="true" />
                <span>{t('admin.storage.title')}</span>
              </h1>
              <p className="text-xs sm:text-sm text-[var(--color-muted)] leading-relaxed">
                {t('admin.storage.subtitle')}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Tag
                label={t('admin.storage.limitsBadgeVideo', {
                  mb: toPersianDigits(limits.maxVideoMb),
                })}
                variant="primary"
              />
              <Tag
                label={t('admin.storage.limitsBadgeOther', {
                  mb: toPersianDigits(limits.maxOtherMb),
                })}
                variant="neutral"
              />
            </div>
          </div>
        </section>

        {/* Uploader & Quick Simulations */}
        <section className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-card)] shadow-[var(--shadow-card)] p-5 sm:p-6 space-y-5">
          <FormField
            id="storage-test-visibility"
            label={t('admin.storage.visibilityLabel')}
            kind="select"
            value={visibility}
            onChange={(val) => setVisibility(val as FileVisibility)}
            options={[
              { value: 'private', label: t('admin.storage.visibilityPrivateOption') },
              { value: 'public', label: t('admin.storage.visibilityPublicOption') },
            ]}
          />

          <div
            onDragOver={(e) => {
              e.preventDefault();
              setIsDragging(true);
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
            className={`rounded-[var(--radius-card)] border-2 border-dashed p-6 sm:p-8 text-center space-y-3 transition-colors ${
              isDragging
                ? 'border-[var(--color-primary)] bg-[var(--color-surface-alt)]'
                : 'border-[var(--color-border-strong)] bg-[var(--color-bg)]'
            }`}
          >
            <Upload className="w-8 h-8 mx-auto text-[var(--color-primary)]" aria-hidden="true" />
            <div className="space-y-1">
              <p className="text-sm font-semibold text-[var(--color-text)]">
                {t('admin.storage.dropzoneTitle')}
              </p>
              <p className="text-xs text-[var(--color-muted)]">
                {t('admin.storage.dropzoneHint')}
              </p>
            </div>

            <input
              ref={fileInputRef}
              type="file"
              onChange={handleFileInputChange}
              className="hidden"
            />
            <div>
              <Button
                type="button"
                variant="primary"
                disabled={isUploading}
                onClick={() => fileInputRef.current?.click()}
                startIcon={<Upload className="w-4 h-4" />}
              >
                {isUploading
                  ? t('admin.storage.uploadingLabel')
                  : t('admin.storage.pickFileButton')}
              </Button>
            </div>
          </div>

          <div className="pt-2 border-t border-[var(--color-border)] space-y-3">
            <div className="space-y-0.5">
              <h2 className="text-sm font-bold text-[var(--color-text)]">
                {t('admin.storage.simTitle')}
              </h2>
              <p className="text-xs text-[var(--color-muted)]">
                {t('admin.storage.simSubtitle')}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={isUploading}
                startIcon={<ShieldCheck className="w-3.5 h-3.5" />}
                onClick={() =>
                  void executeUpload('sample-document.pdf', SAMPLE_VALID_PDF_BYTES, 'private')
                }
              >
                {t('admin.storage.simValidPdf')}
              </Button>

              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={isUploading}
                startIcon={<FileWarning className="w-3.5 h-3.5" />}
                onClick={() =>
                  void executeUpload('fake-payload.pdf', SAMPLE_FAKE_EXE_BYTES, 'private')
                }
              >
                {t('admin.storage.simFakeExePdf')}
              </Button>

              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={isUploading}
                startIcon={<ShieldCheck className="w-3.5 h-3.5" />}
                onClick={() =>
                  void executeUpload('thumbnail-sample.png', SAMPLE_VALID_PNG_BYTES, 'public')
                }
              >
                {t('admin.storage.simValidPublicPng')}
              </Button>

              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={isUploading}
                startIcon={<FileWarning className="w-3.5 h-3.5" />}
                onClick={() =>
                  void executeUpload(
                    'huge-book.pdf',
                    SAMPLE_VALID_PDF_BYTES,
                    'private',
                    (limits.maxOtherMb + 1) * 1024 * 1024,
                  )
                }
              >
                {t('admin.storage.simOversizedFile')}
              </Button>
            </div>
          </div>
        </section>

        {feedback && (
          <div className="space-y-2">
            <Alert
              variant={feedback.variant}
              title={feedback.title}
              message={feedback.message}
              onDismiss={() => setFeedback(null)}
            />
            {feedback.storageKey && (
              <div className="p-3.5 rounded-[var(--radius-control)] border border-[var(--color-border)] bg-[var(--color-surface)] flex flex-wrap items-center justify-between gap-2">
                <code dir="ltr" className="font-mono text-xs text-[var(--color-primary)] break-all">
                  {feedback.storageKey}
                </code>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => navigateToHash(`/media/${feedback.storageKey}`)}
                  startIcon={<ExternalLink className="w-3.5 h-3.5" />}
                >
                  {t('admin.storage.openPublicAction')}
                </Button>
              </div>
            )}
          </div>
        )}

        {/* Stored Files Table */}
        <section className="space-y-3">
          <h2 className="text-base font-bold text-[var(--color-text)] tabular-nums-strict">
            {t('admin.storage.tableTitle', {
              count: toPersianDigits(files.length),
            })}
          </h2>

          <Table
            columns={columns}
            rows={isLoading ? [] : files}
            getRowKey={(row) => row.storageKey}
            emptyText={t('admin.storage.emptyTable')}
          />
        </section>
      </div>
    </AdminLayout>
  );
}
