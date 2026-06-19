/**
 * Backfill: one `scenes` row per existing `shots` row (#907, expand phase).
 *
 * Each shot becomes scenes-of-one-shot:
 *   - create a scene with the shot's order, copying scene-level fields out of
 *     the shot's `metadata` (the Scene object) into dedicated columns + typed
 *     JSON columns,
 *   - point `shot.sceneId` at the new scene and set `shot.shotNumber = 1`.
 *
 * ZERO behavior change is the contract:
 *   - the shot's `metadata` is left intact (transitional duplicate — existing
 *     reads keep using it), and
 *   - no staleness-hash input column is touched, so `isStale()` returns false
 *     for every backfilled shot exactly as before.
 *
 * IDEMPOTENT: shots that already have a `sceneId` are skipped, so re-running
 * never creates duplicate scenes.
 *
 * Core logic lives in `src/lib/db/backfill-scenes.ts` (testable without wrangler).
 *
 * Usage:
 *   bun scripts/backfill-scenes.ts            # local D1 (default env)
 *   bun scripts/backfill-scenes.ts --test     # local D1 ([env.test])
 *   bun scripts/backfill-scenes.ts --remote   # Cloudflare D1 over HTTP API
 *   bun scripts/backfill-scenes.ts --d1       # alias for --remote
 *   bun scripts/backfill-scenes.ts --dry-run  # report only, no writes
 */

import type { Database } from '@/lib/db/client';
import { backfillScenes } from '@/lib/db/backfill-scenes';
import {
  createSeedDb,
  parseSeedTarget,
  type SeedTarget,
} from './seed-db-client';

async function run(target: SeedTarget, dryRun: boolean): Promise<void> {
  const { db, dispose } = await createSeedDb(target);
  try {
    // Driver-boundary cast: the seed client is a D1 (or D1-HTTP) drizzle
    // instance; `backfillScenes` only uses the query-builder surface shared by
    // every drizzle driver (the same surface unit tests exercise via libsql).
    // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- drizzle driver boundary
    const result = await backfillScenes(db as unknown as Database, {
      dryRun,
      log: (msg) => console.log(msg),
    });
    console.log(
      `✅ ${dryRun ? 'Would create' : 'Created'} ${result.createdScenes} scene(s) across ${result.scannedShots} shot(s) without a scene.`
    );
  } finally {
    await dispose();
  }
}

// `--remote` is the issue-facing alias for the HTTP-API ('d1') target.
const argv = process.argv.slice(2);
const target: SeedTarget = argv.includes('--remote')
  ? 'd1'
  : parseSeedTarget(argv);
const dryRun = argv.includes('--dry-run');
await run(target, dryRun);
