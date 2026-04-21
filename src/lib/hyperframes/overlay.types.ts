/**
 * Motion graphics overlay types.
 * Attached per-frame (graphicsOverlays) or per-sequence (introOverlay/outroOverlay)
 * and composited onto the underlying video by the Hyperframes render container.
 */

export const OVERLAY_POSITIONS = ['top', 'center', 'bottom'] as const;
export type OverlayPosition = (typeof OVERLAY_POSITIONS)[number];

export type OverlayStyle = {
  color?: string;
  background?: string;
  fontWeight?: number;
  fontSizePx?: number;
  fontFamily?: string;
};

export type TextOverlay = {
  kind: 'text';
  id: string;
  text: string;
  position: OverlayPosition;
  startMs: number;
  durationMs: number;
  style?: OverlayStyle;
};

export type LowerThirdOverlay = {
  kind: 'lowerThird';
  id: string;
  title: string;
  subtitle?: string;
  startMs: number;
  durationMs: number;
  style?: OverlayStyle;
};

export type ImageOverlay = {
  kind: 'image';
  id: string;
  assetUrl: string;
  startMs: number;
  durationMs: number;
  position: OverlayPosition;
  widthPct?: number;
};

export type FrameOverlay = TextOverlay | LowerThirdOverlay | ImageOverlay;

export const COMPOSITED_VIDEO_STATUSES = [
  'pending',
  'rendering',
  'completed',
  'failed',
] as const;
export type CompositedVideoStatus = (typeof COMPOSITED_VIDEO_STATUSES)[number];
