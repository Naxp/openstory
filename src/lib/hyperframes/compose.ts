/**
 * Build Hyperframes composition HTML from a frame + overlays.
 * Pure TypeScript: runs in the Worker, no DOM or binary deps.
 *
 * Output is an HTML string that the render container feeds to
 * @hyperframes/producer (Puppeteer + FFmpeg).
 */

import type { AspectRatio } from '@/lib/constants/aspect-ratios';
import type {
  FrameOverlay,
  ImageOverlay,
  LowerThirdOverlay,
  OverlayPosition,
  OverlayStyle,
  TextOverlay,
} from './overlay.types';

const RENDER_DIMENSIONS: Record<
  AspectRatio,
  { width: number; height: number }
> = {
  '16:9': { width: 1920, height: 1080 },
  '9:16': { width: 1080, height: 1920 },
  '1:1': { width: 1080, height: 1080 },
};

const DEFAULT_FPS = 30;

type BuildFrameCompositionParams = {
  compositionId: string;
  videoUrl: string;
  durationMs: number;
  aspectRatio: AspectRatio;
  overlays: FrameOverlay[];
  fps?: number;
};

type BuildStandaloneCompositionParams = {
  compositionId: string;
  durationMs: number;
  aspectRatio: AspectRatio;
  overlay: FrameOverlay;
  fps?: number;
  backgroundColor?: string;
};

export type Composition = {
  html: string;
  width: number;
  height: number;
  fps: number;
  durationMs: number;
};

export function buildFrameComposition(
  params: BuildFrameCompositionParams
): Composition {
  const { width, height } = RENDER_DIMENSIONS[params.aspectRatio];
  const fps = params.fps ?? DEFAULT_FPS;
  const durationSec = params.durationMs / 1000;

  const videoLayer = `<video data-start="0" data-duration="${durationSec}" data-track-index="0" src="${escapeAttr(params.videoUrl)}" playsinline muted preload="auto"></video>`;

  const overlayLayers = params.overlays
    .map((overlay, idx) => renderOverlay(overlay, idx + 1))
    .join('');

  const html = wrapComposition({
    compositionId: params.compositionId,
    width,
    height,
    fps,
    body: videoLayer + overlayLayers,
  });

  return { html, width, height, fps, durationMs: params.durationMs };
}

export function buildStandaloneOverlayComposition(
  params: BuildStandaloneCompositionParams
): Composition {
  const { width, height } = RENDER_DIMENSIONS[params.aspectRatio];
  const fps = params.fps ?? DEFAULT_FPS;
  const bg = params.backgroundColor ?? '#000';

  const background = `<div data-start="0" data-duration="${params.durationMs / 1000}" data-track-index="0" class="bg-fill" style="background:${escapeAttr(bg)};"></div>`;
  const overlay = renderOverlay(params.overlay, 1);

  const html = wrapComposition({
    compositionId: params.compositionId,
    width,
    height,
    fps,
    body: background + overlay,
  });

  return { html, width, height, fps, durationMs: params.durationMs };
}

function wrapComposition(params: {
  compositionId: string;
  width: number;
  height: number;
  fps: number;
  body: string;
}): string {
  return `<!doctype html>
<html>
<head><meta charset="utf-8" /><style>${STAGE_STYLES}</style></head>
<body>
<div id="stage" data-composition-id="${escapeAttr(params.compositionId)}" data-width="${params.width}" data-height="${params.height}" data-fps="${params.fps}">${params.body}</div>
</body>
</html>`;
}

function renderOverlay(overlay: FrameOverlay, trackIndex: number): string {
  switch (overlay.kind) {
    case 'text':
      return renderTextOverlay(overlay, trackIndex);
    case 'lowerThird':
      return renderLowerThirdOverlay(overlay, trackIndex);
    case 'image':
      return renderImageOverlay(overlay, trackIndex);
  }
}

function renderTextOverlay(overlay: TextOverlay, trackIndex: number): string {
  const timing = timingAttrs(overlay.startMs, overlay.durationMs, trackIndex);
  const style = inlineOverlayStyle(overlay.style, {
    defaultFontSizePx: 72,
    defaultColor: '#fff',
  });
  const positionClass = overlay.position;
  return `<div ${timing} class="overlay overlay-text overlay-${positionClass}" style="${style}">${escapeHtml(overlay.text)}</div>`;
}

function renderLowerThirdOverlay(
  overlay: LowerThirdOverlay,
  trackIndex: number
): string {
  const timing = timingAttrs(overlay.startMs, overlay.durationMs, trackIndex);
  const style = inlineOverlayStyle(overlay.style, {
    defaultFontSizePx: 48,
    defaultColor: '#fff',
  });
  const subtitle = overlay.subtitle
    ? `<div class="lt-subtitle">${escapeHtml(overlay.subtitle)}</div>`
    : '';
  return `<div ${timing} class="overlay overlay-lower-third" style="${style}"><div class="lt-title">${escapeHtml(overlay.title)}</div>${subtitle}</div>`;
}

function renderImageOverlay(overlay: ImageOverlay, trackIndex: number): string {
  const timing = timingAttrs(overlay.startMs, overlay.durationMs, trackIndex);
  const widthStyle =
    overlay.widthPct !== undefined
      ? `width:${clampPct(overlay.widthPct)}%;`
      : '';
  return `<img ${timing} class="overlay overlay-image overlay-${overlay.position}" style="${widthStyle}" src="${escapeAttr(overlay.assetUrl)}" alt="" />`;
}

function timingAttrs(
  startMs: number,
  durationMs: number,
  trackIndex: number
): string {
  const start = Math.max(0, startMs / 1000);
  const duration = Math.max(0, durationMs / 1000);
  return `data-start="${start}" data-duration="${duration}" data-track-index="${trackIndex}"`;
}

function inlineOverlayStyle(
  style: OverlayStyle | undefined,
  defaults: { defaultFontSizePx: number; defaultColor: string }
): string {
  const parts: string[] = [];
  parts.push(`color:${escapeAttr(style?.color ?? defaults.defaultColor)};`);
  parts.push(
    `font-size:${Math.max(8, style?.fontSizePx ?? defaults.defaultFontSizePx)}px;`
  );
  if (style?.background) {
    parts.push(`background:${escapeAttr(style.background)};`);
  }
  if (style?.fontWeight !== undefined) {
    parts.push(`font-weight:${Math.round(style.fontWeight)};`);
  }
  if (style?.fontFamily) {
    parts.push(`font-family:${escapeAttr(style.fontFamily)};`);
  }
  return parts.join('');
}

function clampPct(pct: number): number {
  return Math.min(100, Math.max(5, pct));
}

function escapeAttr(value: string): string {
  return value.replace(/[&"<>]/g, (ch) => {
    if (ch === '&') return '&amp;';
    if (ch === '"') return '&quot;';
    if (ch === '<') return '&lt;';
    return '&gt;';
  });
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>]/g, (ch) => {
    if (ch === '&') return '&amp;';
    if (ch === '<') return '&lt;';
    return '&gt;';
  });
}

const STAGE_STYLES = `
  html, body { margin:0; padding:0; background:#000; }
  #stage { position:relative; overflow:hidden; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif; }
  #stage > * { position:absolute; }
  #stage > video { top:0; left:0; width:100%; height:100%; object-fit:cover; }
  #stage > .bg-fill { top:0; left:0; width:100%; height:100%; }
  .overlay { left:0; right:0; padding:24px 64px; text-align:center; line-height:1.2; box-sizing:border-box; }
  .overlay-top { top:48px; }
  .overlay-center { top:50%; transform:translateY(-50%); }
  .overlay-bottom { bottom:48px; }
  .overlay-lower-third { bottom:96px; left:64px; right:auto; text-align:left; background:rgba(0,0,0,0.55); padding:16px 24px; border-left:4px solid #fff; }
  .overlay-lower-third .lt-title { font-weight:700; }
  .overlay-lower-third .lt-subtitle { font-size:0.6em; opacity:0.85; margin-top:4px; }
  .overlay-image { max-width:100%; height:auto; }
  .overlay-image.overlay-top { top:48px; left:50%; transform:translateX(-50%); right:auto; }
  .overlay-image.overlay-center { top:50%; left:50%; transform:translate(-50%,-50%); right:auto; }
  .overlay-image.overlay-bottom { bottom:48px; left:50%; transform:translateX(-50%); right:auto; }
`;

export function getRenderDimensions(aspectRatio: AspectRatio): {
  width: number;
  height: number;
} {
  return RENDER_DIMENSIONS[aspectRatio];
}

export type {
  FrameOverlay,
  ImageOverlay,
  LowerThirdOverlay,
  OverlayPosition,
  TextOverlay,
};
