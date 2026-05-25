/**
 * Snapshot a fully-populated sequence from test.db into a JSON fixture.
 *
 * Companion to scripts/seed-marketing-demo.ts, which replays this fixture to
 * give marketing recordings a realistic editor state without re-running the
 * full pipeline every time.
 *
 * Workflow:
 *   1. Run the full pipeline once against test.db:
 *        PLAYWRIGHT_FULL_PIPELINE=true bun test:e2e:full
 *      (Needs qstash running + recorded openrouter/fal/r2 fixtures present.)
 *   2. Find the resulting sequence id (printed by the test, or query
 *      `select id, title from sequences order by created_at desc limit 1;`).
 *   3. Snapshot it:
 *        bun --bun scripts/snapshot-sequence.ts <sequenceId>
 *      Writes e2e/fixtures/marketing-demo-sequence.json.
 *   4. Commit the JSON. The marketing seed replays it on every run.
 *
 * What gets captured:
 *   - The `sequences` row, minus team/user/style ids (substituted at replay).
 *   - All `frames` rows for that sequence, with their ids remapped to
 *     placeholders so replay can mint fresh ULIDs.
 *
 * What's NOT captured (yet):
 *   - sequence_locations, sequence_elements, sequence_music_variants, etc.
 *     Add tables here as the marketing flows start exercising features that
 *     depend on them.
 */

import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { eq } from 'drizzle-orm';
import { frames, sequences } from '@/lib/db/schema';

const OUT_FILE = path.resolve('e2e/fixtures/marketing-demo-sequence.json');

const sequenceId = process.argv[2];
if (!sequenceId) {
  console.error('Usage: bun --bun scripts/snapshot-sequence.ts <sequenceId>');
  process.exit(1);
}

async function main() {
  const db = drizzle({ client: createClient({ url: 'file:test.db' }) });

  const seq = await db
    .select()
    .from(sequences)
    .where(eq(sequences.id, sequenceId!))
    .get();
  if (!seq) {
    throw new Error(`Sequence ${sequenceId} not found in test.db`);
  }

  const frameRows = await db
    .select()
    .from(frames)
    .where(eq(frames.sequenceId, sequenceId!));

  if (frameRows.length === 0) {
    console.warn(
      `[snapshot-sequence] sequence has no frames — snapshot will be empty`
    );
  }

  // Strip runtime-bound ids. The seed will substitute fresh values.
  const {
    id: _id,
    teamId: _teamId,
    createdBy: _createdBy,
    updatedBy: _updatedBy,
    styleId: _styleId,
    createdAt: _createdAt,
    updatedAt: _updatedAt,
    ...sequenceCore
  } = seq;

  const frameCore = frameRows
    .sort((a, b) => a.orderIndex - b.orderIndex)
    .map((f) => {
      const {
        id: _id,
        sequenceId: _seqId,
        createdAt: _createdAt,
        updatedAt: _updatedAt,
        ...rest
      } = f;
      return rest;
    });

  const snapshot = {
    capturedAt: new Date().toISOString(),
    sourceSequenceId: sequenceId,
    sequence: sequenceCore,
    frames: frameCore,
  };

  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify(snapshot, null, 2));
  console.log(
    `[snapshot-sequence] wrote ${OUT_FILE} (1 sequence + ${frameCore.length} frames)`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
