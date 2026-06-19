/**
 * Playable-clip resolution (#910)
 * ============================================================================
 *
 * The Theatre player and the MP4 export both need the ordered list of rendered
 * video clips for a sequence. With multi-shot scene rendering, a clip can live
 * in one of two places:
 *
 *   - per-shot render: each shot carries its own `shots.video*`.
 *   - multi-shot render (`scenes.renderStrategy='multi-shot'`): the WHOLE scene
 *     is one clip on `scenes.video*`, and its shots have no per-shot video.
 *
 * This resolves both into a single ordered clip list keyed by `orderIndex`, and
 * reports how many render UNITS are ready vs total — so callers can show "N of M
 * still generating" without assuming one-clip-per-shot. A sequence with no
 * multi-shot scenes (every legacy sequence) collapses to exactly the old
 * per-shot list, so existing playback/export is unchanged.
 *
 * Pure + framework-free so it is unit-tested without React.
 */

import { normalizeRenderStrategy } from '@/lib/model/resolve-render-strategy';

/** Minimal shot shape this resolver reads. */
export type ClipShot = {
  sceneId: string | null;
  orderIndex: number;
  videoUrl: string | null;
  videoStatus: string | null;
};

/** Minimal scene shape this resolver reads. */
export type ClipScene = {
  id: string;
  orderIndex: number;
  videoUrl: string | null;
  videoStatus: string | null;
  renderStrategy: string | null;
};

/** One ordered, playable clip. `orderIndex` drives sequence order. */
type PlayableClip = {
  orderIndex: number;
  videoUrl: string;
};

export type PlayableClipsResult = {
  /** Ordered clips that are ready to play, by `orderIndex`. */
  clips: PlayableClip[];
  /** Total render units (multi-shot scene = 1; per-shot shots = 1 each). */
  total: number;
  /** Render units with a completed video. */
  ready: number;
};

/**
 * Resolve a sequence's ordered playable clips from its shots + scenes.
 *
 * Multi-shot scenes contribute ONE clip (their `scenes.video*`); every other
 * shot contributes its own `shots.video*`. A shot belonging to a multi-shot
 * scene is NOT counted on its own — its scene is the render unit.
 */
export function resolvePlayableClips(
  shots: readonly ClipShot[],
  scenes: readonly ClipScene[]
): PlayableClipsResult {
  const scenesById = new Map(scenes.map((s) => [s.id, s]));
  const multiShotSceneIds = new Set(
    scenes
      .filter((s) => normalizeRenderStrategy(s.renderStrategy) === 'multi-shot')
      .map((s) => s.id)
  );

  // A multi-shot scene's clip sorts at the GLOBAL position of its first shot
  // (shot `orderIndex` is the flat sequence order; scene `orderIndex` is a
  // separate 0-based scene counter), so interleaving with per-shot clips is
  // correct in a mixed sequence.
  const firstShotOrderByScene = new Map<string, number>();
  for (const shot of shots) {
    if (shot.sceneId === null || !multiShotSceneIds.has(shot.sceneId)) continue;
    const prev = firstShotOrderByScene.get(shot.sceneId);
    if (prev === undefined || shot.orderIndex < prev) {
      firstShotOrderByScene.set(shot.sceneId, shot.orderIndex);
    }
  }

  const clips: PlayableClip[] = [];
  let total = 0;
  let ready = 0;

  // Per-shot units: every shot NOT in a multi-shot scene.
  for (const shot of shots) {
    if (shot.sceneId !== null && multiShotSceneIds.has(shot.sceneId)) {
      continue; // its scene is the render unit (handled below)
    }
    total += 1;
    if (shot.videoStatus === 'completed' && shot.videoUrl) {
      clips.push({ orderIndex: shot.orderIndex, videoUrl: shot.videoUrl });
      ready += 1;
    }
  }

  // Multi-shot scene units: one clip per multi-shot scene.
  for (const sceneId of multiShotSceneIds) {
    const scene = scenesById.get(sceneId);
    if (!scene) continue;
    total += 1;
    if (scene.videoStatus === 'completed' && scene.videoUrl) {
      clips.push({
        orderIndex: firstShotOrderByScene.get(sceneId) ?? scene.orderIndex,
        videoUrl: scene.videoUrl,
      });
      ready += 1;
    }
  }

  clips.sort((a, b) => a.orderIndex - b.orderIndex);
  return { clips, total, ready };
}
