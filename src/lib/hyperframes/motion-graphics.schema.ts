/**
 * LLM response schema for motion-graphics design.
 * Intentionally looser than the persisted FrameOverlay schema — we normalise
 * (clamp timings, drop bad overlays, prepend stable id prefix) before write.
 */

import { z } from 'zod';
import type { FrameOverlay } from './overlay.types';
import { OVERLAY_POSITIONS } from './overlay.types';

const llmTextOverlaySchema = z.object({
  kind: z.literal('text'),
  id: z.string().min(1).max(64),
  text: z.string().min(1).max(128),
  position: z.enum(OVERLAY_POSITIONS),
  startMs: z.number().int().min(0).max(60_000),
  durationMs: z.number().int().min(500).max(10_000),
});

const llmLowerThirdOverlaySchema = z.object({
  kind: z.literal('lowerThird'),
  id: z.string().min(1).max(64),
  title: z.string().min(1).max(96),
  subtitle: z.string().max(128).optional(),
  startMs: z.number().int().min(0).max(60_000),
  durationMs: z.number().int().min(500).max(10_000),
});

const llmOverlaySchema = z.discriminatedUnion('kind', [
  llmTextOverlaySchema,
  llmLowerThirdOverlaySchema,
]);

export const motionGraphicsResponseSchema = z.object({
  overlays: z.array(llmOverlaySchema).max(4),
});

export type MotionGraphicsResponse = z.infer<
  typeof motionGraphicsResponseSchema
>;

/**
 * Normalise an LLM overlay into a persisted FrameOverlay:
 * - clamps timing into [0, sceneDurationMs]
 * - drops overlays with a <500ms effective window
 * - prefixes ids with the sceneId so they're unique across frames
 */
export function normaliseOverlays(
  raw: MotionGraphicsResponse,
  sceneId: string,
  sceneDurationMs: number
): FrameOverlay[] {
  const minWindow = 500;
  const result: FrameOverlay[] = [];

  for (const overlay of raw.overlays) {
    const startMs = Math.max(
      0,
      Math.min(overlay.startMs, sceneDurationMs - minWindow)
    );
    const maxDuration = sceneDurationMs - startMs;
    const durationMs = Math.max(
      minWindow,
      Math.min(overlay.durationMs, maxDuration)
    );
    if (durationMs < minWindow) continue;

    const id = `${sceneId}:${overlay.id}`;

    if (overlay.kind === 'text') {
      result.push({
        kind: 'text',
        id,
        text: overlay.text,
        position: overlay.position,
        startMs,
        durationMs,
      });
    } else {
      result.push({
        kind: 'lowerThird',
        id,
        title: overlay.title,
        subtitle: overlay.subtitle,
        startMs,
        durationMs,
      });
    }
  }

  return result;
}
