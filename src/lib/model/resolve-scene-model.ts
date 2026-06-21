/**
 * Scene-level model resolution (#909).
 *
 * A scene owns one "look" (image model) and one "motion character" (video
 * model). Both columns are nullable: NULL = inherit the sequence default. The
 * sequence keeps non-null defaults (its own columns), so resolution is a single
 * coalesce — the scene override wins, otherwise the sequence value applies.
 *
 * `safe*` clamps the resolved string to a valid model id, defaulting if a
 * persisted value has since been retired.
 */

import {
  DEFAULT_IMAGE_MODEL,
  DEFAULT_VIDEO_MODEL,
  safeImageToVideoModel,
  safeTextToImageModel,
  type ImageToVideoModel,
  type TextToImageModel,
} from '@/lib/ai/models';

// Each resolver reads only its own field, so both fields are independently
// optional — callers can pass a partial row (e.g. the middleware's
// PartialSequence, which carries videoModel but not imageModel) without widening
// to `unknown`. The scene override and the sequence default have the same shape.
type ModelSource = {
  imageModel?: string | null;
  videoModel?: string | null;
};

/**
 * Effective image model for a scene: scene override → sequence default →
 * global default. Pass `null`/`undefined` for either source when it isn't
 * loaded yet; the chain falls through to the next level.
 */
export function resolveSceneImageModel(
  scene: ModelSource | null | undefined,
  sequence: ModelSource | null | undefined
): TextToImageModel {
  return safeTextToImageModel(
    scene?.imageModel ?? sequence?.imageModel,
    DEFAULT_IMAGE_MODEL
  );
}

/**
 * Effective video model for a scene: scene override → sequence default →
 * global default. Mirrors {@link resolveSceneImageModel}.
 */
export function resolveSceneVideoModel(
  scene: ModelSource | null | undefined,
  sequence: ModelSource | null | undefined
): ImageToVideoModel {
  return safeImageToVideoModel(
    scene?.videoModel ?? sequence?.videoModel,
    DEFAULT_VIDEO_MODEL
  );
}
