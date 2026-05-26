/**
 * Seed the marketing demo sequence into test.db.
 *
 * Used by the marketing repo's recording pipeline (see
 * marketing/flows/global-setup.ts). Runs after the e2e auth setup, which
 * creates the shared test user and writes user-info.json. We attach a
 * deterministic demo sequence to that user's team so the recording specs
 * have something realistic to drive.
 *
 * Loads its sequence + frame rows from e2e/fixtures/marketing-demo-sequence.json,
 * which is a snapshot of a real sequence produced by the full pipeline. See
 * scripts/snapshot-sequence.ts for how to (re-)generate that fixture. This
 * "snapshot once, replay forever" approach avoids fighting the editor's data
 * expectations — the snapshot IS exactly what the app produces, so the UI
 * renders it as a real completed sequence rather than a skeleton.
 *
 * Idempotent: find-or-create on (teamId, title). Re-running just returns
 * the existing sequence id.
 *
 * Writes the sequence id to e2e/.auth/marketing-demo.json so the recording
 * specs can locate it without re-querying the database.
 *
 * Usage (from this repo):
 *   E2E_TEST=true bun --bun scripts/seed-marketing-demo.ts
 */

import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { and, eq } from 'drizzle-orm';
import {
  frames,
  sequences,
  styles,
  teams,
  type Frame,
  type Sequence,
} from '@/lib/db/schema';
import { generateId } from '@/lib/db/id';

const AUTH_DIR = path.resolve('e2e/.auth');
const USER_INFO_FILE = path.join(AUTH_DIR, 'user-info.json');
const DEMO_INFO_FILE = path.join(AUTH_DIR, 'marketing-demo.json');
const SNAPSHOT_FILE = path.resolve('e2e/fixtures/marketing-demo-sequence.json');

const DEMO_TITLE = 'Marketing Demo — Scene Editing';

type TestUser = { id: string; email: string; name: string; teamId: string };

type Snapshot = {
  capturedAt: string;
  sourceSequenceId: string;
  // Sequence row with the runtime-bound ids stripped by snapshot-sequence.ts.
  sequence: Omit<
    Sequence,
    | 'id'
    | 'teamId'
    | 'createdBy'
    | 'updatedBy'
    | 'styleId'
    | 'createdAt'
    | 'updatedAt'
  >;
  frames: Omit<Frame, 'id' | 'sequenceId' | 'createdAt' | 'updatedAt'>[];
};

function readTestUser(): TestUser {
  if (!fs.existsSync(USER_INFO_FILE)) {
    throw new Error(
      `Missing ${USER_INFO_FILE}. Run the e2e auth setup first ` +
        `(bunx playwright test --project=setup).`
    );
  }
  return JSON.parse(fs.readFileSync(USER_INFO_FILE, 'utf-8'));
}

// Columns drizzle exposes as Date on select but that JSON.stringify flattens
// to ISO strings. We revive them so drizzle's insert (which calls .getTime())
// doesn't throw. Listed explicitly — silently coercing every string-shaped
// field would mask real schema drift.
const SEQUENCE_DATE_COLS = [
  'mergedVideoGeneratedAt',
  'musicGeneratedAt',
] as const;
const FRAME_DATE_COLS = [
  'thumbnailGeneratedAt',
  'variantImageGeneratedAt',
  'videoGeneratedAt',
  'audioGeneratedAt',
] as const;

function reviveDates<T extends Record<string, unknown>>(
  row: T,
  cols: readonly string[]
): T {
  for (const c of cols) {
    const v = row[c];
    if (typeof v === 'string') {
      (row as Record<string, unknown>)[c] = new Date(v);
    }
  }
  return row;
}

function readSnapshot(): Snapshot {
  if (!fs.existsSync(SNAPSHOT_FILE)) {
    throw new Error(
      `Missing snapshot at ${SNAPSHOT_FILE}.\n\n` +
        `Bootstrap by running the full pipeline once, then snapshotting the\n` +
        `resulting sequence:\n` +
        `  PLAYWRIGHT_FULL_PIPELINE=true bun test:e2e:full\n` +
        `  bun --bun scripts/snapshot-sequence.ts <sequenceId>\n`
    );
  }
  // Trust the JSON shape — it's written by our own snapshot-sequence.ts and
  // committed to the repo. The schema-change protection is the type
  // signature in snapshot-sequence.ts, not a runtime validator here.
  const raw: Snapshot = JSON.parse(fs.readFileSync(SNAPSHOT_FILE, 'utf-8'));
  reviveDates(
    raw.sequence as unknown as Record<string, unknown>,
    SEQUENCE_DATE_COLS
  );
  for (const f of raw.frames)
    reviveDates(f as unknown as Record<string, unknown>, FRAME_DATE_COLS);
  return raw;
}

async function main() {
  const testUser = readTestUser();
  const snapshot = readSnapshot();
  const db = drizzle({ client: createClient({ url: 'file:test.db' }) });

  // Sanity: the test user's team must exist (auth setup creates it).
  const team = await db
    .select()
    .from(teams)
    .where(eq(teams.id, testUser.teamId))
    .get();
  if (!team) {
    throw new Error(`Team ${testUser.teamId} not found in test.db`);
  }

  // Pick the first available style — system templates are the realistic
  // fallback when the user's team has no custom styles yet.
  const style = await db.select().from(styles).limit(1).get();
  if (!style) {
    throw new Error(
      'No styles in test.db. Make sure the seed script has run ' +
        '(bun --bun scripts/seed.ts --test).'
    );
  }

  // Find-or-create the demo sequence by (teamId, title). The title is the
  // stable handle — sequence ids regenerate on every replay.
  let sequence = await db
    .select()
    .from(sequences)
    .where(
      and(
        eq(sequences.teamId, testUser.teamId),
        eq(sequences.title, DEMO_TITLE)
      )
    )
    .get();

  if (!sequence) {
    const sequenceId = generateId();
    await db.insert(sequences).values({
      ...snapshot.sequence,
      id: sequenceId,
      title: DEMO_TITLE,
      teamId: testUser.teamId,
      createdBy: testUser.id,
      updatedBy: testUser.id,
      styleId: style.id,
    });
    sequence = await db
      .select()
      .from(sequences)
      .where(eq(sequences.id, sequenceId))
      .get();
    if (!sequence) {
      throw new Error('Insert succeeded but sequence not found on re-read');
    }
    console.log(
      `[seed-marketing-demo] created sequence ${sequenceId} ` +
        `from snapshot of ${snapshot.sourceSequenceId}`
    );
  } else {
    console.log(
      `[seed-marketing-demo] reusing existing sequence ${sequence.id}`
    );
  }

  // Find-or-create frames. We use orderIndex as the natural key — if the
  // sequence exists with the right frame count, assume it's already seeded
  // from a prior run and skip.
  const existingFrames = await db
    .select()
    .from(frames)
    .where(eq(frames.sequenceId, sequence.id));

  if (existingFrames.length === snapshot.frames.length) {
    console.log(
      `[seed-marketing-demo] reusing ${existingFrames.length} existing frames`
    );
  } else {
    if (existingFrames.length > 0) {
      await db.delete(frames).where(eq(frames.sequenceId, sequence.id));
      console.log(
        `[seed-marketing-demo] cleared ${existingFrames.length} stale frames before re-seeding`
      );
    }
    for (const f of snapshot.frames) {
      await db.insert(frames).values({
        ...f,
        sequenceId: sequence.id,
        // Null out the prompt hashes so the frame loads as "not stale".
        // The snapshot's hashes were computed under the original team's
        // context and won't match what the app re-computes here.
        //
        // The app's updateFrameFn (see src/functions/frames.ts) has a
        // bootstrap path: when the frame has a prompt but no stored
        // hash, the first edit computes the pre-edit hash, stores it,
        // THEN applies the edit. That produces the exact divergence we
        // want for the cascade demo — one edit, and the visual prompt
        // (and any downstream artifacts) become stale.
        visualPromptInputHash: null,
        motionPromptInputHash: null,
      });
    }
    console.log(
      `[seed-marketing-demo] inserted ${snapshot.frames.length} frames`
    );
  }

  fs.mkdirSync(AUTH_DIR, { recursive: true });
  fs.writeFileSync(
    DEMO_INFO_FILE,
    JSON.stringify({ sequenceId: sequence.id, title: DEMO_TITLE }, null, 2)
  );
  console.log(`[seed-marketing-demo] wrote ${DEMO_INFO_FILE}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
