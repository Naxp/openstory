/**
 * Core backfill logic for #907 — extracted from the CLI entry so it can be
 * unit-tested against an in-memory libsql DB without pulling in the wrangler
 * platform proxy. See `scripts/backfill-scenes.ts` for the runnable script.
 */

import type { Scene } from '@/lib/ai/scene-analysis.schema';
import type { Database } from '@/lib/db/client';
import { generateId } from '@/lib/db/id';
import type { NewScene } from '@/lib/db/schema';
import { dbSceneId, scenes, shots } from '@/lib/db/schema';
import { eq, isNull } from 'drizzle-orm';

const BACKFILL_BATCH_SIZE = 50;

/**
 * Build the additive scene-row payload for a shot, splitting scene-level fields
 * out of the shot's `metadata` (the Scene object). Null/absent metadata yields
 * a scene with null fields rather than crashing.
 */
export function buildSceneRow(
  sequenceId: string,
  orderIndex: number,
  metadata: Scene | null
): NewScene {
  const sceneMeta = metadata?.metadata;
  return {
    id: dbSceneId(generateId()),
    sequenceId,
    orderIndex,
    location: sceneMeta?.location ?? null,
    timeOfDay: sceneMeta?.timeOfDay ?? null,
    storyBeat: sceneMeta?.storyBeat ?? null,
    title: sceneMeta?.title ?? null,
    continuity: metadata?.continuity ?? null,
    musicDesign: metadata?.musicDesign ?? null,
    originalScript: metadata?.originalScript ?? null,
  };
}

export type BackfillResult = { createdScenes: number; scannedShots: number };

/**
 * Create one scene per shot that lacks a `sceneId`, then point the shot at it
 * with `shotNumber = 1`. Idempotent (skips shots that already have a scene) and
 * staleness-neutral (touches ONLY `sceneId` + `shotNumber`, never `metadata`
 * or any `*InputHash` column).
 */
export async function backfillScenes(
  db: Database,
  options: {
    dryRun?: boolean;
    batchSize?: number;
    log?: (msg: string) => void;
  } = {}
): Promise<BackfillResult> {
  const {
    dryRun = false,
    batchSize = BACKFILL_BATCH_SIZE,
    log = () => {},
  } = options;

  // Only shots without a scene yet — this is what makes the run idempotent.
  const pending = await db.select().from(shots).where(isNull(shots.sceneId));

  log(
    `Found ${pending.length} shot(s) without a scene${dryRun ? ' (dry run — no writes)' : ''}.`
  );

  let createdScenes = 0;
  for (let i = 0; i < pending.length; i += batchSize) {
    const batch = pending.slice(i, i + batchSize);
    for (const shot of batch) {
      const sceneRow = buildSceneRow(
        shot.sequenceId,
        shot.orderIndex,
        shot.metadata
      );

      if (dryRun) {
        createdScenes++;
        continue;
      }

      await db.insert(scenes).values(sceneRow);
      await db
        .update(shots)
        .set({ sceneId: sceneRow.id, shotNumber: 1 })
        .where(eq(shots.id, shot.id));
      createdScenes++;
    }
    log(
      `  …processed ${Math.min(i + batchSize, pending.length)}/${pending.length}`
    );
  }

  return { createdScenes, scannedShots: pending.length };
}
