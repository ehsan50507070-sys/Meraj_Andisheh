import { ExternalLink, FileSpreadsheet, Lock, Presentation } from 'lucide-react';
import type { ContentFile } from '../../../core/domain/content';
import { formatFileSizeParts } from '../../resources/formatters';
import { t } from '../../resources/i18n';

export interface DocumentAttachmentCardProps {
  file: ContentFile;
  variant: 'presentation' | 'document';
}

function getExtensionUpper(fileName: string, mimeType: string): string {
  const dotIdx = fileName.lastIndexOf('.');
  if (dotIdx !== -1 && dotIdx < fileName.length - 1) {
    return fileName.slice(dotIdx + 1).toUpperCase();
  }
  return mimeType.split('/').pop()?.toUpperCase() ?? 'FILE';
}

export function DocumentAttachmentCard({ file, variant }: DocumentAttachmentCardProps) {
  const sizeParts = formatFileSizeParts(file.sizeBytes);
  const ext = getExtensionUpper(file.originalFileName, file.mimeType);
  const Icon = variant === 'presentation' ? Presentation : FileSpreadsheet;

  const headingKey =
    variant === 'presentation'
      ? 'contentDetail.presentation.cardTitle'
      : 'contentDetail.document.cardTitle';
  const disabledNoticeKey =
    variant === 'presentation'
      ? 'contentDetail.presentation.downloadDisabledNotice'
      : 'contentDetail.document.downloadDisabledNotice';

  return (
    <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 sm:p-5 shadow-[var(--shadow-card)] space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-start gap-3 min-w-0">
          <div className="w-11 h-11 rounded-[var(--radius-control)] bg-[var(--color-surface-alt)] border border-[var(--color-border)] flex items-center justify-center shrink-0">
            <Icon className="w-5 h-5 text-[var(--color-primary)]" aria-hidden="true" />
          </div>
          <div className="space-y-1 min-w-0">
            <p className="text-sm font-bold text-[var(--color-text)]">{t(headingKey)}</p>
            <dl className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--color-muted)]">
              <div className="flex items-center gap-1 min-w-0">
                <dt>{t('contentDetail.player.fileNameLabel')}:</dt>
                <dd dir="ltr" className="font-mono text-[var(--color-text)] truncate max-w-[210px]">
                  {file.originalFileName}
                </dd>
              </div>
              <span aria-hidden="true">·</span>
              <div className="flex items-center gap-1">
                <dt>{t('contentDetail.player.fileTypeLabel')}:</dt>
                <dd dir="ltr" className="font-mono font-semibold text-[var(--color-text)]">
                  {ext}
                </dd>
              </div>
              {sizeParts && (
                <>
                  <span aria-hidden="true">·</span>
                  <div className="flex items-center gap-1 tabular-nums-strict">
                    <dt>{t('contentDetail.player.fileSizeLabel')}:</dt>
                    <dd className="font-semibold text-[var(--color-text)]">
                      {t(`contentDetail.sizeUnit.${sizeParts.unit}`, { value: sizeParts.value })}
                    </dd>
                  </div>
                </>
              )}
            </dl>
          </div>
        </div>

        {file.externalUrl ? (
          <a
            href={file.externalUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center gap-2 min-h-[44px] px-4 py-2 text-xs sm:text-sm font-semibold rounded-[var(--radius-control)] bg-[var(--color-primary-button)] text-[var(--color-on-primary)] whitespace-nowrap shrink-0"
          >
            <span>{t('contentDetail.player.externalCta')}</span>
            <ExternalLink className="w-4 h-4" aria-hidden="true" />
          </a>
        ) : (
          <button
            type="button"
            disabled
            className="inline-flex items-center justify-center gap-2 min-h-[44px] px-4 py-2 text-xs font-medium rounded-[var(--radius-control)] bg-[var(--color-surface-alt)] border border-[var(--color-border)] text-[var(--color-muted)] cursor-not-allowed shrink-0"
          >
            <Lock className="w-4 h-4 shrink-0" aria-hidden="true" />
            <span>{t(disabledNoticeKey)}</span>
          </button>
        )}
      </div>
    </div>
  );
}
