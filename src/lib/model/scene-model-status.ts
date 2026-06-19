import type { ModelGenerationStatus } from '@/components/model/base-model-selector';
import type { ShotVariant } from '@/lib/db/schema';

/**
 * Scene-granular per-model generation status (#909).
 *
 * The render unit is the SCENE, so a model's marker reflects how it covered the
 * whole scene rather than a single shot: a model reads `completed` only when it
 * has a completed primary variant for EVERY shot in the scene, `generating`
 * when any shot's row for it is in flight, `failed` when a shot's row failed
 * (and nothing more advanced), else `pending`. The scene's chosen model
 * (`setModel`) always shows the distinct `set` marker.
 *
 * Divergent/discarded alternates are excluded — only primary per-model rows
 * count. With one shot per scene (today's 1:1 backfill) this degenerates to the
 * shot's own status, and stays correct as scenes gain multiple shots (#910).
 */
export function computeSceneModelStatuses(opts: {
  /** The shots that make up the scene — only their ids are read. */
  shots: readonly { id: string }[];
  variantsByFrame: ReadonlyMap<string, ShotVariant[]>;
  /** The scene's chosen model — marked `set` regardless of coverage. */
  setModel: string;
}): Map<string, ModelGenerationStatus> {
  const { shots, variantsByFrame, setModel } = opts;
  const map = new Map<string, ModelGenerationStatus>();
  const shotCount = shots.length;

  // Per-model tallies across the scene's shots.
  const completedShots = new Map<string, number>();
  const generating = new Set<string>();
  const failed = new Set<string>();

  for (const shot of shots) {
    const variants = (variantsByFrame.get(shot.id) ?? []).filter(
      (v) => v.divergedAt === null && v.discardedAt === null
    );
    // De-dupe to one row per model per shot — prefer the most advanced status.
    const byModel = new Map<string, ShotVariant['status']>();
    for (const v of variants) {
      const prev = byModel.get(v.model);
      if (!prev || statusRank(v.status) > statusRank(prev)) {
        byModel.set(v.model, v.status);
      }
    }
    for (const [model, status] of byModel) {
      if (status === 'completed') {
        completedShots.set(model, (completedShots.get(model) ?? 0) + 1);
      } else if (status === 'generating' || status === 'pending') {
        generating.add(model);
      } else {
        // status === 'failed'
        failed.add(model);
      }
    }
  }

  const models = new Set<string>([
    ...completedShots.keys(),
    ...generating,
    ...failed,
    setModel,
  ]);

  for (const model of models) {
    if (model === setModel) {
      map.set(model, 'set');
      continue;
    }
    const covered = completedShots.get(model) ?? 0;
    if (shotCount > 0 && covered === shotCount) {
      map.set(model, 'completed');
    } else if (generating.has(model)) {
      map.set(model, 'generating');
    } else if (covered > 0) {
      // Partial coverage across the scene — still in progress conceptually.
      map.set(model, 'generating');
    } else if (failed.has(model)) {
      map.set(model, 'failed');
    } else {
      map.set(model, 'pending');
    }
  }

  return map;
}

// "More advanced" ordering so a per-shot model with mixed rows reports its
// furthest-along status.
function statusRank(status: ShotVariant['status']): number {
  switch (status) {
    case 'completed':
      return 3;
    case 'generating':
      return 2;
    case 'pending':
      return 1;
    case 'failed':
      return 0;
  }
}
