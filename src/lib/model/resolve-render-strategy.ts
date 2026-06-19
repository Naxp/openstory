/**
 * Render-strategy resolution (#910).
 *
 * A scene is the render unit. How it is rendered depends on the scene's
 * resolved video model and how many shots the scene holds:
 *
 *   - `multi-shot`: ONE generation renders the whole shot list. Only available
 *     when the resolved model `supportsMultiShot` AND the scene has >1 shot.
 *     The video asset attaches to the SCENE (`scenes.video*`).
 *   - `per-shot`:  N per-shot i2v generations (today's behaviour). The video
 *     asset attaches to each SHOT (`shots.video*`). This is the path for any
 *     single-shot scene and for multi-shot scenes on a model that can't render
 *     them in one call (graceful degradation on model switch — see #910).
 *
 * `renderStrategy` is also the discriminator the player/export read to decide
 * whether to play the scene-level video or the per-shot clips. A scene whose
 * `renderStrategy` is NULL (every pre-#910 sequence) is treated as `per-shot`,
 * so existing sequences keep playing their per-shot clips unchanged.
 */

import {
  videoModelSupportsMultiShot,
  type ImageToVideoModel,
} from '@/lib/ai/models';

/**
 * Persisted render strategy for a scene. NULL on the row means "not yet
 * decided / legacy" and is read as `per-shot`.
 */
export type RenderStrategy = 'multi-shot' | 'per-shot';

/**
 * Decide how to render a scene given its resolved video model and shot count.
 *
 * A single-shot scene is always `per-shot` (there is nothing to weave, and the
 * no-cuts guard applies). A multi-shot scene renders in one call only when the
 * model supports it; otherwise it falls back to per-shot clips.
 */
export function resolveRenderStrategy(
  videoModel: ImageToVideoModel,
  shotCount: number
): RenderStrategy {
  if (shotCount > 1 && videoModelSupportsMultiShot(videoModel)) {
    return 'multi-shot';
  }
  return 'per-shot';
}

/**
 * Normalise a persisted `scenes.renderStrategy` value (which may be NULL on
 * legacy rows or an unrecognised string) to a definite strategy. NULL and any
 * non-`multi-shot` value read as `per-shot`, so existing sequences and unknown
 * data degrade to today's behaviour.
 */
export function normalizeRenderStrategy(
  value: string | null | undefined
): RenderStrategy {
  return value === 'multi-shot' ? 'multi-shot' : 'per-shot';
}
