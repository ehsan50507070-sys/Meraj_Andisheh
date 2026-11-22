import {
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  FileText,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { useEffect, useRef, useState } from 'react';
import { formatFileSizeParts, toPersianDigits } from '../../resources/formatters';
import { t } from '../../resources/i18n';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerSrc;

export interface PdfLocalViewerProps {
  bytes: Uint8Array | null;
  blobUrl: string | null;
  externalUrl: string | null;
  title: string;
  fileName?: string;
  sizeBytes?: number | null;
  isLoading: boolean;
}

const MIN_ZOOM = 0.75;
const MAX_ZOOM = 2.0;
const ZOOM_STEP = 0.25;

export function PdfLocalViewer({
  bytes,
  blobUrl,
  externalUrl,
  title,
  fileName,
  sizeBytes,
  isLoading,
}: PdfLocalViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [pdfDoc, setPdfDoc] = useState<pdfjsLib.PDFDocumentProxy | null>(null);
  const [totalPages, setTotalPages] = useState<number>(0);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [zoom, setZoom] = useState<number>(1);
  const [renderFailed, setRenderFailed] = useState<boolean>(false);
  const [isParsing, setIsParsing] = useState<boolean>(false);

  const sizeParts = formatFileSizeParts(sizeBytes);

  useEffect(() => {
    let cancelled = false;
    let activeDoc: pdfjsLib.PDFDocumentProxy | null = null;

    const loadDocument = async () => {
      setPdfDoc(null);
      setTotalPages(0);
      setCurrentPage(1);
      setRenderFailed(false);

      if (!bytes || bytes.byteLength === 0) {
        return;
      }

      setIsParsing(true);
      try {
        // Copy bytes before passing to pdf.js worker (worker detaches transferred ArrayBuffer)
        const bufferCopy = new Uint8Array(bytes.byteLength);
        bufferCopy.set(bytes);
        const loadingTask = pdfjsLib.getDocument({ data: bufferCopy });
        const doc = await loadingTask.promise;
        if (cancelled) {
          void doc.cleanup();
          await (doc as unknown as { destroy?: () => Promise<void> }).destroy?.();
          return;
        }
        activeDoc = doc;
        setPdfDoc(doc);
        setTotalPages(doc.numPages);
        setCurrentPage(1);
      } catch {
        if (!cancelled) {
          setRenderFailed(true);
        }
      } finally {
        if (!cancelled) {
          setIsParsing(false);
        }
      }
    };

    void loadDocument();

    return () => {
      cancelled = true;
      if (activeDoc) {
        void activeDoc.cleanup();
        void (activeDoc as unknown as { destroy?: () => Promise<void> }).destroy?.();
      }
    };
  }, [bytes]);

  useEffect(() => {
    let cancelled = false;
    let renderTask: pdfjsLib.RenderTask | null = null;

    const renderPage = async () => {
      if (!pdfDoc || !canvasRef.current || totalPages === 0) {
        return;
      }
      try {
        const page = await pdfDoc.getPage(currentPage);
        if (cancelled || !canvasRef.current) {
          return;
        }
        const viewport = page.getViewport({ scale: 1.2 * zoom });
        const canvas = canvasRef.current;
        const context = canvas.getContext('2d');
        if (!context) {
          setRenderFailed(true);
          return;
        }
        canvas.height = viewport.height;
        canvas.width = viewport.width;

        renderTask = page.render({
          canvas,
          canvasContext: context,
          viewport,
        });
        await renderTask.promise;
      } catch (err) {
        if (!cancelled && (err as { name?: string })?.name !== 'RenderingCancelledException') {
          setRenderFailed(true);
        }
      }
    };

    void renderPage();

    return () => {
      cancelled = true;
      if (renderTask) {
        renderTask.cancel();
      }
    };
  }, [pdfDoc, currentPage, totalPages, zoom]);

  if (isLoading || isParsing) {
    return (
      <div className="rounded-[var(--radius-card)] bg-[var(--color-surface-alt)] border border-[var(--color-border)] p-10 text-center text-sm text-[var(--color-muted)]">
        {t('contentDetail.player.loading')}
      </div>
    );
  }

  if (externalUrl && !bytes && !blobUrl) {
    return (
      <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface-alt)] p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-start gap-3 min-w-0">
          <FileText className="w-6 h-6 text-[var(--color-primary)] shrink-0 mt-0.5" aria-hidden="true" />
          <div className="space-y-1 min-w-0">
            <p className="text-sm font-semibold text-[var(--color-text)]">
              {t('contentDetail.player.externalHostLabel')}
            </p>
            <p dir="ltr" className="text-xs font-mono text-[var(--color-muted)] truncate">
              {externalUrl}
            </p>
          </div>
        </div>
        <a
          href={externalUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center justify-center gap-2 min-h-[44px] px-5 py-2.5 text-sm font-semibold rounded-[var(--radius-control)] bg-[var(--color-primary-button)] text-[var(--color-on-primary)] whitespace-nowrap shrink-0"
        >
          <span>{t('contentDetail.player.externalCta')}</span>
          <ExternalLink className="w-4 h-4" aria-hidden="true" />
        </a>
      </div>
    );
  }

  if (!bytes && !blobUrl) {
    return (
      <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface-alt)] p-6 text-center text-sm text-[var(--color-muted)]">
        {t('contentDetail.player.noMedia')}
      </div>
    );
  }

  if (renderFailed && blobUrl) {
    return (
      <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] overflow-hidden shadow-[var(--shadow-card)]">
        <div className="px-4 py-2.5 bg-[var(--color-surface-alt)] border-b border-[var(--color-border)] flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--color-muted)]">
          <span>{t('contentDetail.pdf.fallbackHint')}</span>
          {fileName && (
            <span dir="ltr" className="font-mono text-[var(--color-text)] truncate max-w-[240px]">
              {fileName}
            </span>
          )}
        </div>
        <iframe
          src={blobUrl}
          title={title}
          className="w-full h-[520px] border-0 bg-white"
        />
      </div>
    );
  }

  return (
    <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] overflow-hidden shadow-[var(--shadow-card)]">
      {/* Toolbar */}
      <div className="px-4 py-3 bg-[var(--color-surface-alt)] border-b border-[var(--color-border)] flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
            disabled={currentPage <= 1}
            className="inline-flex items-center gap-1 min-h-[38px] px-3 py-1.5 text-xs font-medium rounded-[var(--radius-control)] bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-text)] disabled:opacity-45 hover:border-[var(--color-border-strong)] whitespace-nowrap"
          >
            <ChevronRight className="w-4 h-4" aria-hidden="true" />
            <span>{t('contentDetail.pdf.prevPage')}</span>
          </button>

          <span className="text-xs font-semibold text-[var(--color-text)] tabular-nums-strict px-1">
            {t('contentDetail.pdf.pageIndicator', {
              current: toPersianDigits(currentPage),
              total: toPersianDigits(Math.max(1, totalPages)),
            })}
          </span>

          <button
            type="button"
            onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
            disabled={currentPage >= totalPages}
            className="inline-flex items-center gap-1 min-h-[38px] px-3 py-1.5 text-xs font-medium rounded-[var(--radius-control)] bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-text)] disabled:opacity-45 hover:border-[var(--color-border-strong)] whitespace-nowrap"
          >
            <span>{t('contentDetail.pdf.nextPage')}</span>
            <ChevronLeft className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => setZoom((z) => Math.max(MIN_ZOOM, Number((z - ZOOM_STEP).toFixed(2))))}
            disabled={zoom <= MIN_ZOOM}
            aria-label={t('contentDetail.image.zoomOut')}
            className="min-h-[38px] px-2.5 py-1.5 text-xs rounded-[var(--radius-control)] bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-text)] disabled:opacity-45"
          >
            <ZoomOut className="w-4 h-4" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => setZoom(1)}
            className="min-h-[38px] px-2.5 py-1.5 text-xs font-semibold rounded-[var(--radius-control)] bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-text)] tabular-nums-strict whitespace-nowrap"
          >
            {t('contentDetail.image.zoomPercent', {
              percent: toPersianDigits(Math.round(zoom * 100)),
            })}
          </button>
          <button
            type="button"
            onClick={() => setZoom((z) => Math.min(MAX_ZOOM, Number((z + ZOOM_STEP).toFixed(2))))}
            disabled={zoom >= MAX_ZOOM}
            aria-label={t('contentDetail.image.zoomIn')}
            className="min-h-[38px] px-2.5 py-1.5 text-xs rounded-[var(--radius-control)] bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-text)] disabled:opacity-45"
          >
            <ZoomIn className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>
      </div>

      {/* Canvas Container */}
      <div className="max-h-[640px] overflow-auto bg-[var(--color-surface-alt)] p-3 sm:p-5 flex justify-center">
        <canvas
          ref={canvasRef}
          aria-label={title}
          className="max-w-full h-auto shadow-sm rounded bg-white"
        />
      </div>

      {(fileName || sizeParts) && (
        <div className="px-4 py-2.5 bg-[var(--color-surface-alt)] border-t border-[var(--color-border)] flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[var(--color-muted)]">
          {fileName && (
            <span dir="ltr" className="font-mono text-[var(--color-text)] truncate max-w-[260px]">
              {fileName}
            </span>
          )}
          {fileName && sizeParts && <span aria-hidden="true">·</span>}
          {sizeParts && (
            <span className="tabular-nums-strict">
              {t(`contentDetail.sizeUnit.${sizeParts.unit}`, { value: sizeParts.value })}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
