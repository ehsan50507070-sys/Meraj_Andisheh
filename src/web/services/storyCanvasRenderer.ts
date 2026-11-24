import {
  STORY_HEIGHT,
  STORY_MIME_TYPE,
  STORY_WIDTH,
  type StoryRenderPayload,
} from '../../core/domain/story';

const STORY_FONT_FAMILY = '"Vazirmatn", Tahoma, sans-serif';

export interface RenderedStoryOutput {
  blob: Blob;
  width: number;
  height: number;
}

function loadImageFromUrlAsync(url: string | null): Promise<HTMLImageElement | null> {
  if (!url || typeof Image === 'undefined') {
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

function traceRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function drawCoverImage(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  const srcWidth = img.naturalWidth || img.width;
  const srcHeight = img.naturalHeight || img.height;
  if (srcWidth <= 0 || srcHeight <= 0) {
    return;
  }

  ctx.save();
  if (radius > 0) {
    traceRoundedRect(ctx, x, y, width, height, radius);
    ctx.clip();
  }

  const scale = Math.max(width / srcWidth, height / srcHeight);
  const drawWidth = srcWidth * scale;
  const drawHeight = srcHeight * scale;
  const dx = x + (width - drawWidth) / 2;
  const dy = y + (height - drawHeight) / 2;
  ctx.drawImage(img, dx, dy, drawWidth, drawHeight);
  ctx.restore();
}

function drawGeometricPlaceholder(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
  variant: 'dark' | 'light',
): void {
  ctx.save();
  if (radius > 0) {
    traceRoundedRect(ctx, x, y, width, height, radius);
    ctx.clip();
  }

  const bgGrad = ctx.createLinearGradient(x, y, x + width, y + height);
  if (variant === 'dark') {
    bgGrad.addColorStop(0, '#13203B');
    bgGrad.addColorStop(0.5, '#1D2F53');
    bgGrad.addColorStop(1, '#0E172B');
  } else {
    bgGrad.addColorStop(0, '#EFE9DE');
    bgGrad.addColorStop(0.5, '#E4DBCC');
    bgGrad.addColorStop(1, '#EBE3D5');
  }
  ctx.fillStyle = bgGrad;
  ctx.fillRect(x, y, width, height);

  const cx = x + width / 2;
  const cy = y + height / 2;
  ctx.strokeStyle =
    variant === 'dark' ? 'rgba(212, 175, 106, 0.28)' : 'rgba(154, 52, 18, 0.2)';
  ctx.lineWidth = 2;

  for (const ringRadius of [110, 175, 240]) {
    ctx.beginPath();
    ctx.arc(cx, cy, ringRadius, 0, Math.PI * 2);
    ctx.stroke();
  }

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(Math.PI / 4);
  ctx.strokeRect(-105, -105, 210, 210);
  ctx.rotate(Math.PI / 4);
  ctx.strokeRect(-105, -105, 210, 210);
  ctx.restore();

  ctx.restore();
}

export function wrapRtlText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxLines: number,
): string[] {
  const cleaned = text.replace(/\r\n/g, '\n').trim();
  if (!cleaned || maxLines <= 0) {
    return [];
  }

  const paragraphs = cleaned
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const allLines: string[] = [];
  let truncated = false;

  for (let pIdx = 0; pIdx < paragraphs.length; pIdx += 1) {
    const words = paragraphs[pIdx].split(/\s+/).filter(Boolean);
    let currentLine = '';

    for (let wIdx = 0; wIdx < words.length; wIdx += 1) {
      const word = words[wIdx];
      const candidate = currentLine ? `${currentLine} ${word}` : word;

      if (ctx.measureText(candidate).width <= maxWidth) {
        currentLine = candidate;
      } else if (currentLine) {
        allLines.push(currentLine);
        if (allLines.length >= maxLines) {
          truncated = true;
          break;
        }
        currentLine = word;
      } else {
        // Fallback when a single unspaced token exceeds maxWidth
        let chunk = '';
        for (const ch of word) {
          if (ctx.measureText(chunk + ch).width <= maxWidth) {
            chunk += ch;
          } else {
            break;
          }
        }
        allLines.push(chunk || word.slice(0, 1));
        if (allLines.length >= maxLines) {
          truncated = true;
          break;
        }
        currentLine = '';
      }
    }

    if (truncated) {
      break;
    }

    if (currentLine) {
      allLines.push(currentLine);
      if (allLines.length >= maxLines && pIdx < paragraphs.length - 1) {
        truncated = true;
        break;
      }
    }
  }

  if (truncated && allLines.length > 0) {
    const lastIdx = allLines.length - 1;
    let last = allLines[lastIdx];
    while (last.length > 1 && ctx.measureText(`${last}…`).width > maxWidth) {
      last = last.slice(0, -1).trimEnd();
    }
    allLines[lastIdx] = `${last}…`;
  }

  return allLines.slice(0, maxLines);
}

function drawTopicChip(
  ctx: CanvasRenderingContext2D,
  topicName: string,
  centerX: number,
  y: number,
  options: {
    bg: string;
    border: string;
    text: string;
  },
): void {
  ctx.save();
  ctx.font = `600 28px ${STORY_FONT_FAMILY}`;
  ctx.direction = 'rtl';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const paddingX = 36;
  const chipHeight = 58;
  const measured = Math.min(ctx.measureText(topicName).width + paddingX * 2, STORY_WIDTH - 176);
  const chipX = centerX - measured / 2;

  traceRoundedRect(ctx, chipX, y, measured, chipHeight, chipHeight / 2);
  ctx.fillStyle = options.bg;
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = options.border;
  ctx.stroke();

  ctx.fillStyle = options.text;
  ctx.fillText(topicName, centerX, y + chipHeight / 2 + 1, measured - paddingX * 1.4);
  ctx.restore();
}

function drawFooterBrandBar(
  ctx: CanvasRenderingContext2D,
  siteTitle: string,
  siteUrl: string,
  palette: {
    divider: string;
    titleColor: string;
    urlColor: string;
    accentColor: string;
  },
): void {
  const marginX = 88;
  const lineY = STORY_HEIGHT - 196;

  ctx.save();
  ctx.strokeStyle = palette.divider;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(marginX, lineY);
  ctx.lineTo(STORY_WIDTH - marginX, lineY);
  ctx.stroke();

  // Small accent diamond on center of divider
  ctx.fillStyle = palette.accentColor;
  ctx.save();
  ctx.translate(STORY_WIDTH / 2, lineY);
  ctx.rotate(Math.PI / 4);
  ctx.fillRect(-6, -6, 12, 12);
  ctx.restore();

  // Right side (RTL): siteTitle
  ctx.direction = 'rtl';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  ctx.font = `700 34px ${STORY_FONT_FAMILY}`;
  ctx.fillStyle = palette.titleColor;
  ctx.fillText(siteTitle, STORY_WIDTH - marginX, lineY + 72, 470);

  // Left side (LTR domain): siteUrl
  ctx.direction = 'ltr';
  ctx.textAlign = 'left';
  ctx.font = `500 28px ${STORY_FONT_FAMILY}`;
  ctx.fillStyle = palette.urlColor;
  ctx.fillText(siteUrl, marginX, lineY + 72, 410);
  ctx.restore();
}

function renderCinematicDarkTemplate(
  ctx: CanvasRenderingContext2D,
  payload: StoryRenderPayload,
  thumbImg: HTMLImageElement | null,
): void {
  const marginX = 88;
  const contentWidth = STORY_WIDTH - marginX * 2;

  // Deep atmospheric background
  const bg = ctx.createLinearGradient(0, 0, STORY_WIDTH, STORY_HEIGHT);
  bg.addColorStop(0, '#090E1A');
  bg.addColorStop(0.45, '#111A2E');
  bg.addColorStop(1, '#070B14');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, STORY_WIDTH, STORY_HEIGHT);

  // Subtle warm gold radial glow behind visual frame
  const glow = ctx.createRadialGradient(
    STORY_WIDTH / 2,
    460,
    40,
    STORY_WIDTH / 2,
    460,
    540,
  );
  glow.addColorStop(0, 'rgba(212, 175, 106, 0.16)');
  glow.addColorStop(1, 'rgba(212, 175, 106, 0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, STORY_WIDTH, STORY_HEIGHT);

  // Outer subtle hairline frame
  ctx.save();
  ctx.strokeStyle = 'rgba(248, 250, 252, 0.1)';
  ctx.lineWidth = 2;
  traceRoundedRect(ctx, 42, 42, STORY_WIDTH - 84, STORY_HEIGHT - 84, 34);
  ctx.stroke();
  ctx.restore();

  // Top Topic pill if available
  if (payload.topicName) {
    drawTopicChip(ctx, payload.topicName, STORY_WIDTH / 2, 104, {
      bg: 'rgba(212, 175, 106, 0.14)',
      border: 'rgba(212, 175, 106, 0.42)',
      text: '#F3D8A0',
    });
  }

  // Hero thumbnail container
  const thumbY = 204;
  const thumbH = 560;
  ctx.save();
  ctx.shadowColor = 'rgba(0, 0, 0, 0.45)';
  ctx.shadowBlur = 36;
  ctx.shadowOffsetY = 18;
  traceRoundedRect(ctx, marginX, thumbY, contentWidth, thumbH, 28);
  ctx.fillStyle = '#121B30';
  ctx.fill();
  ctx.restore();

  if (thumbImg) {
    drawCoverImage(ctx, thumbImg, marginX, thumbY, contentWidth, thumbH, 28);
  } else {
    drawGeometricPlaceholder(ctx, marginX, thumbY, contentWidth, thumbH, 28, 'dark');
  }

  ctx.save();
  traceRoundedRect(ctx, marginX, thumbY, contentWidth, thumbH, 28);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.16)';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.restore();

  let cursorY = thumbY + thumbH + 74;

  // Optional Bold Title
  const cleanTitle = payload.showTitle ? payload.title.trim() : '';
  if (cleanTitle.length > 0) {
    ctx.save();
    ctx.direction = 'rtl';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'top';
    ctx.font = `800 48px ${STORY_FONT_FAMILY}`;
    ctx.fillStyle = '#F8FAFC';

    const titleLines = wrapRtlText(ctx, cleanTitle, contentWidth, 3);
    const titleLineHeight = 72;
    for (const line of titleLines) {
      ctx.fillText(line, STORY_WIDTH - marginX, cursorY);
      cursorY += titleLineHeight;
    }
    ctx.restore();
    cursorY += 36;
  }

  // Gold horizontal divider before quote
  ctx.save();
  ctx.strokeStyle = 'rgba(212, 175, 106, 0.48)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(STORY_WIDTH - marginX, cursorY);
  ctx.lineTo(STORY_WIDTH - marginX - 150, cursorY);
  ctx.stroke();
  ctx.restore();
  cursorY += 44;

  // Quote body
  const cleanQuote = payload.quote.trim();
  if (cleanQuote.length > 0) {
    ctx.save();
    ctx.direction = 'rtl';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'top';
    const fontSize = cleanTitle.length > 0 ? 36 : 42;
    const lineHeight = cleanTitle.length > 0 ? 64 : 74;
    const maxLines = cleanTitle.length > 0 ? 7 : 9;
    ctx.font = `500 ${fontSize}px ${STORY_FONT_FAMILY}`;
    ctx.fillStyle = '#E2E8F0';

    const quoteLines = wrapRtlText(ctx, cleanQuote, contentWidth, maxLines);
    for (const line of quoteLines) {
      if (cursorY + lineHeight > STORY_HEIGHT - 235) {
        break;
      }
      ctx.fillText(line, STORY_WIDTH - marginX, cursorY);
      cursorY += lineHeight;
    }
    ctx.restore();
  }

  drawFooterBrandBar(ctx, payload.siteTitle, payload.siteUrl, {
    divider: 'rgba(248, 250, 252, 0.16)',
    titleColor: '#F8FAFC',
    urlColor: '#CBD5E1',
    accentColor: '#D4AF6A',
  });
}

function renderLightMinimalTemplate(
  ctx: CanvasRenderingContext2D,
  payload: StoryRenderPayload,
  thumbImg: HTMLImageElement | null,
): void {
  const marginX = 96;
  const contentWidth = STORY_WIDTH - marginX * 2;

  // Warm archival paper canvas
  ctx.fillStyle = '#FBF9F5';
  ctx.fillRect(0, 0, STORY_WIDTH, STORY_HEIGHT);

  // Subtle top paper wash band
  ctx.fillStyle = '#F3EFE6';
  ctx.fillRect(0, 0, STORY_WIDTH, 200);

  // Clean hairline perimeter frame
  ctx.save();
  ctx.strokeStyle = '#D6CEBE';
  ctx.lineWidth = 2;
  ctx.strokeRect(48, 48, STORY_WIDTH - 96, STORY_HEIGHT - 96);
  ctx.restore();

  // Top Topic label
  if (payload.topicName) {
    drawTopicChip(ctx, payload.topicName, STORY_WIDTH / 2, 108, {
      bg: '#FFFFFF',
      border: '#D6CEBE',
      text: '#9A3412',
    });
  }

  // Thumbnail frame
  const thumbY = 236;
  const thumbH = 520;
  if (thumbImg) {
    drawCoverImage(ctx, thumbImg, marginX, thumbY, contentWidth, thumbH, 20);
  } else {
    drawGeometricPlaceholder(ctx, marginX, thumbY, contentWidth, thumbH, 20, 'light');
  }

  ctx.save();
  traceRoundedRect(ctx, marginX, thumbY, contentWidth, thumbH, 20);
  ctx.strokeStyle = '#D6CEBE';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.restore();

  let cursorY = thumbY + thumbH + 72;

  // Optional Editorial Title
  const cleanTitle = payload.showTitle ? payload.title.trim() : '';
  if (cleanTitle.length > 0) {
    ctx.save();
    ctx.direction = 'rtl';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'top';
    ctx.font = `800 46px ${STORY_FONT_FAMILY}`;
    ctx.fillStyle = '#1C1917';

    const titleLines = wrapRtlText(ctx, cleanTitle, contentWidth, 3);
    const titleLineHeight = 70;
    for (const line of titleLines) {
      ctx.fillText(line, STORY_WIDTH - marginX, cursorY);
      cursorY += titleLineHeight;
    }
    ctx.restore();
    cursorY += 30;
  }

  // Editorial pull-quote enclosed cleanly by hairline dividers (top & bottom)
  ctx.save();
  ctx.strokeStyle = '#9A3412';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(STORY_WIDTH - marginX, cursorY);
  ctx.lineTo(STORY_WIDTH - marginX - 140, cursorY);
  ctx.stroke();
  ctx.restore();
  cursorY += 42;

  const cleanQuote = payload.quote.trim();
  if (cleanQuote.length > 0) {
    ctx.save();
    ctx.direction = 'rtl';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'top';
    const fontSize = cleanTitle.length > 0 ? 35 : 41;
    const lineHeight = cleanTitle.length > 0 ? 64 : 74;
    const maxLines = cleanTitle.length > 0 ? 7 : 9;
    ctx.font = `500 ${fontSize}px ${STORY_FONT_FAMILY}`;
    ctx.fillStyle = '#292524';

    const quoteLines = wrapRtlText(ctx, cleanQuote, contentWidth, maxLines);
    for (const line of quoteLines) {
      if (cursorY + lineHeight > STORY_HEIGHT - 240) {
        break;
      }
      ctx.fillText(line, STORY_WIDTH - marginX, cursorY);
      cursorY += lineHeight;
    }
    ctx.restore();
  }

  drawFooterBrandBar(ctx, payload.siteTitle, payload.siteUrl, {
    divider: '#D6CEBE',
    titleColor: '#1C1917',
    urlColor: '#57534E',
    accentColor: '#9A3412',
  });
}

function renderQuoteFocusTemplate(
  ctx: CanvasRenderingContext2D,
  payload: StoryRenderPayload,
  thumbImg: HTMLImageElement | null,
): void {
  const marginX = 96;
  const contentWidth = STORY_WIDTH - marginX * 2;

  // Full-bleed background (scrimmed image or rich midnight gradient)
  if (thumbImg) {
    drawCoverImage(ctx, thumbImg, 0, 0, STORY_WIDTH, STORY_HEIGHT, 0);
  } else {
    const fallbackBg = ctx.createLinearGradient(0, 0, STORY_WIDTH, STORY_HEIGHT);
    fallbackBg.addColorStop(0, '#0F172A');
    fallbackBg.addColorStop(0.5, '#1E293B');
    fallbackBg.addColorStop(1, '#090D16');
    ctx.fillStyle = fallbackBg;
    ctx.fillRect(0, 0, STORY_WIDTH, STORY_HEIGHT);
  }

  // Measured contrast scrim (>= 4.5:1 text contrast over any thumbnail)
  const scrim = ctx.createLinearGradient(0, 0, 0, STORY_HEIGHT);
  scrim.addColorStop(0, 'rgba(9, 13, 24, 0.78)');
  scrim.addColorStop(0.5, 'rgba(9, 13, 24, 0.86)');
  scrim.addColorStop(1, 'rgba(6, 9, 18, 0.94)');
  ctx.fillStyle = scrim;
  ctx.fillRect(0, 0, STORY_WIDTH, STORY_HEIGHT);

  // Subtle double architectural frame
  ctx.save();
  ctx.strokeStyle = 'rgba(245, 158, 11, 0.28)';
  ctx.lineWidth = 2;
  ctx.strokeRect(46, 46, STORY_WIDTH - 92, STORY_HEIGHT - 92);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
  ctx.lineWidth = 1;
  ctx.strokeRect(62, 62, STORY_WIDTH - 124, STORY_HEIGHT - 124);
  ctx.restore();

  // Topic pill near top center
  if (payload.topicName) {
    drawTopicChip(ctx, payload.topicName, STORY_WIDTH / 2, 136, {
      bg: 'rgba(245, 158, 11, 0.15)',
      border: 'rgba(245, 158, 11, 0.45)',
      text: '#FCD34D',
    });
  }

  // Compute centered quote & optional title vertically
  ctx.save();
  ctx.direction = 'rtl';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';

  const cleanQuote = payload.quote.trim() || payload.title.trim();
  const cleanTitle = payload.showTitle ? payload.title.trim() : '';

  ctx.font = `700 46px ${STORY_FONT_FAMILY}`;
  const quoteLines = wrapRtlText(ctx, cleanQuote, contentWidth - 40, 8);
  const quoteLineHeight = 80;
  const quoteBlockHeight = quoteLines.length * quoteLineHeight;

  ctx.font = `600 32px ${STORY_FONT_FAMILY}`;
  const titleLines = cleanTitle
    ? wrapRtlText(ctx, cleanTitle, contentWidth - 80, 2)
    : [];
  const titleLineHeight = 52;
  const titleBlockHeight = titleLines.length > 0 ? titleLines.length * titleLineHeight + 70 : 0;

  const glyphHeight = 100;
  const totalBlockHeight = glyphHeight + quoteBlockHeight + titleBlockHeight;
  let cursorY = Math.max(300, Math.round((STORY_HEIGHT - 220 - totalBlockHeight) / 2) + 60);

  // Decorative quotation mark
  ctx.font = `800 92px ${STORY_FONT_FAMILY}`;
  ctx.fillStyle = '#F59E0B';
  ctx.fillText('«»', STORY_WIDTH / 2, cursorY);
  cursorY += glyphHeight;

  // Main centered quote
  ctx.font = `700 46px ${STORY_FONT_FAMILY}`;
  ctx.fillStyle = '#FFFFFF';
  for (const line of quoteLines) {
    ctx.fillText(line, STORY_WIDTH / 2, cursorY);
    cursorY += quoteLineHeight;
  }

  // Optional smaller title signature beneath quote
  if (titleLines.length > 0) {
    cursorY += 32;
    ctx.strokeStyle = 'rgba(245, 158, 11, 0.45)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(STORY_WIDTH / 2 - 90, cursorY);
    ctx.lineTo(STORY_WIDTH / 2 + 90, cursorY);
    ctx.stroke();
    cursorY += 34;

    ctx.font = `600 32px ${STORY_FONT_FAMILY}`;
    ctx.fillStyle = '#CBD5E1';
    for (const line of titleLines) {
      if (cursorY + titleLineHeight > STORY_HEIGHT - 225) {
        break;
      }
      ctx.fillText(line, STORY_WIDTH / 2, cursorY);
      cursorY += titleLineHeight;
    }
  }
  ctx.restore();

  drawFooterBrandBar(ctx, payload.siteTitle, payload.siteUrl, {
    divider: 'rgba(255, 255, 255, 0.18)',
    titleColor: '#FFFFFF',
    urlColor: '#CBD5E1',
    accentColor: '#F59E0B',
  });
}

async function ensureCanvasFontsReadyAsync(): Promise<void> {
  if (typeof document !== 'undefined' && document.fonts?.ready) {
    try {
      await document.fonts.ready;
    } catch {
      // Proceed gracefully with fallback font
    }
  }
}

export async function renderStoryToCanvasAsync(
  canvas: HTMLCanvasElement,
  payload: StoryRenderPayload,
): Promise<void> {
  canvas.width = STORY_WIDTH;
  canvas.height = STORY_HEIGHT;
  canvas.dir = 'rtl';

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('CANVAS_2D_CONTEXT_UNAVAILABLE');
  }

  const [thumbImg] = await Promise.all([
    loadImageFromUrlAsync(payload.thumbnailDataUrl),
    ensureCanvasFontsReadyAsync(),
  ]);

  ctx.clearRect(0, 0, STORY_WIDTH, STORY_HEIGHT);

  switch (payload.template) {
    case 'light-minimal':
      renderLightMinimalTemplate(ctx, payload, thumbImg);
      break;
    case 'quote-focus':
      renderQuoteFocusTemplate(ctx, payload, thumbImg);
      break;
    case 'cinematic-dark':
    default:
      renderCinematicDarkTemplate(ctx, payload, thumbImg);
      break;
  }
}

function canvasToPngBlobAsync(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    if (typeof canvas.toBlob === 'function') {
      canvas.toBlob(
        (blob) => {
          if (blob) {
            resolve(blob);
            return;
          }
          try {
            const dataUrl = canvas.toDataURL(STORY_MIME_TYPE);
            const parts = dataUrl.split(',');
            const binary = atob(parts[1] ?? '');
            const bytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i += 1) {
              bytes[i] = binary.charCodeAt(i);
            }
            resolve(new Blob([bytes], { type: STORY_MIME_TYPE }));
          } catch (err) {
            reject(err);
          }
        },
        STORY_MIME_TYPE,
        1,
      );
      return;
    }

    try {
      const dataUrl = canvas.toDataURL(STORY_MIME_TYPE);
      const parts = dataUrl.split(',');
      const binary = atob(parts[1] ?? '');
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) {
        bytes[i] = binary.charCodeAt(i);
      }
      resolve(new Blob([bytes], { type: STORY_MIME_TYPE }));
    } catch (err) {
      reject(err);
    }
  });
}

export async function renderStoryToPngBlobAsync(
  payload: StoryRenderPayload,
): Promise<RenderedStoryOutput> {
  if (typeof document === 'undefined') {
    throw new Error('CANVAS_DOCUMENT_UNAVAILABLE');
  }

  const canvas = document.createElement('canvas');
  await renderStoryToCanvasAsync(canvas, payload);
  const blob = await canvasToPngBlobAsync(canvas);

  return {
    blob,
    width: canvas.width,
    height: canvas.height,
  };
}
