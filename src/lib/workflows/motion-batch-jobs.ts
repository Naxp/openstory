/**
 * N+M fan-out expansion for `MotionBatchWorkflow` (#545).
 *
 * Multi-model video generation runs one motion child per `(frame, model)` —
 * the motion analog of frame-images' per-`(scene, model)` fan-out. Pulled out
 * of the workflow body (mirroring `motion-workflow-persist`) so the expansion's
 * invariants are unit-testable without bootstrapping a `WorkflowEntrypoint`.
 *
 * Resolution rules (kept deliberately distinct from `resolveVideoModels`, which
 * has different defaulting):
 *   - top-level `videoModels` (deduped) applies to every frame when present;
 *   - otherwise each frame falls back to its own `model` (single-model paths);
 *   - a frame with neither falls back to `DEFAULT_VIDEO_MODEL`.
 *
 * Models are deduped per the top-level list so a model is never generated (or
 * billed) twice for the same frame, which also keeps the `(frameIndex, model)`
 * pair — and therefore each child's CF instance id — unique.
 */

import { DEFAULT_VIDEO_MODEL, type ImageToVideoModel } from '@/lib/ai/models';
import { resolveRenderStrategy } from '@/lib/model/resolve-render-strategy';

export type MotionJob<F> = {
  shot: F;
  shotIndex: number;
  model: ImageToVideoModel;
};

export function buildMotionJobs<F extends { model?: ImageToVideoModel }>(
  shots: readonly F[],
  videoModels: readonly ImageToVideoModel[] | undefined
): MotionJob<F>[] {
  const topVideoModels =
    videoModels && videoModels.length > 0 ? [...new Set(videoModels)] : null;

  return shots.flatMap((shot, shotIndex) => {
    const models: ImageToVideoModel[] =
      topVideoModels ?? (shot.model ? [shot.model] : [DEFAULT_VIDEO_MODEL]);
    return models.map((model) => ({ shot, shotIndex, model }));
  });
}

// ===========================================================================
// #910 — Render-unit grouping (scene vs per-shot)
// ===========================================================================

/**
 * A shot ready to render, with the scene it belongs to. `sceneDbId` is the
 * persisted `scenes` row id (ULID); shots with the same `sceneDbId` belong to
 * one scene and may render as a single multi-shot call. `sceneDbId` is null for
 * a shot with no linked scene row (legacy / orphan) — such shots always render
 * per-shot.
 */
export type RenderShot<F> = F & {
  sceneDbId: string | null;
  shotNumber: number;
};

/**
 * A grouped render unit produced by {@link groupShotsForRender}:
 *   - `multi-shot`: the scene's ordered shots render in ONE call (writes
 *     `scenes.video*`). Only chosen when the resolved video model supports
 *     multi-shot AND the scene has >1 shot.
 *   - `per-shot`: a single shot rendered on its own (writes `shots.video*`),
 *     exactly today's behaviour. Every legacy / single-shot scene is per-shot.
 */
export type RenderUnit<F> =
  | { strategy: 'multi-shot'; sceneDbId: string; shots: RenderShot<F>[] }
  | { strategy: 'per-shot'; shot: RenderShot<F> };

/**
 * Group per-shot render units into render units by scene, choosing the strategy
 * from the resolved video model's capability profile.
 *
 * Order is preserved: scenes appear in the order their first shot appears, and a
 * scene's shots are ordered by `shotNumber`. Shots with no `sceneDbId`, and
 * single-shot scenes, become `per-shot` units (today's path, untouched).
 *
 * `videoModel` is the model resolved for the run; the same model decides every
 * scene's strategy here (per-scene model resolution feeds in upstream via the
 * shots' own resolved model when that path lands).
 */
export function groupShotsForRender<F>(
  shots: readonly RenderShot<F>[],
  videoModel: ImageToVideoModel
): RenderUnit<F>[] {
  // Bucket shots by scene, preserving first-seen scene order.
  const sceneOrder: string[] = [];
  const byScene = new Map<string, RenderShot<F>[]>();
  const looseShots: RenderShot<F>[] = [];

  for (const shot of shots) {
    if (shot.sceneDbId === null) {
      looseShots.push(shot);
      continue;
    }
    const existing = byScene.get(shot.sceneDbId);
    if (existing) {
      existing.push(shot);
    } else {
      byScene.set(shot.sceneDbId, [shot]);
      sceneOrder.push(shot.sceneDbId);
    }
  }

  const units: RenderUnit<F>[] = [];

  for (const sceneDbId of sceneOrder) {
    const sceneShots = (byScene.get(sceneDbId) ?? [])
      .slice()
      .sort((a, b) => a.shotNumber - b.shotNumber);
    const strategy = resolveRenderStrategy(videoModel, sceneShots.length);
    if (strategy === 'multi-shot') {
      units.push({ strategy: 'multi-shot', sceneDbId, shots: sceneShots });
    } else {
      for (const shot of sceneShots) {
        units.push({ strategy: 'per-shot', shot });
      }
    }
  }

  // Loose (scene-less) shots always render per-shot, after the scene units.
  for (const shot of looseShots) {
    units.push({ strategy: 'per-shot', shot });
  }

  return units;
}
