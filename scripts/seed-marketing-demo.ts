/**
 * Seed the marketing demo sequence into test.db.
 *
 * Used by the marketing repo's recording pipeline (see
 * marketing/flows/global-setup.ts). Runs after the e2e auth setup, which
 * creates the shared test user and writes user-info.json. We attach a
 * deterministic demo sequence to that user's team so the recording specs
 * have something realistic to drive.
 *
 * Idempotent: find-or-create on (teamId, title). Re-running just returns
 * the existing sequence id.
 *
 * Writes the sequence id to e2e/.auth/marketing-demo.json so the recording
 * spec can locate it without re-querying the database.
 *
 * Usage (from this repo):
 *   E2E_TEST=true bun --bun scripts/seed-marketing-demo.ts
 */

import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { and, eq } from 'drizzle-orm';
import { frames, sequences, styles, teams } from '@/lib/db/schema';
import { generateId } from '@/lib/db/id';
import type { Scene } from '@/lib/ai/scene-analysis.schema';

const AUTH_DIR = path.resolve('e2e/.auth');
const USER_INFO_FILE = path.join(AUTH_DIR, 'user-info.json');
const DEMO_INFO_FILE = path.join(AUTH_DIR, 'marketing-demo.json');

const DEMO_TITLE = 'Marketing Demo — Scene Editing';

// Pre-rendered media from the existing recorded r2 fixtures. These URLs
// point at real persisted CDN objects, so the frame loads in the editor
// exactly like a freshly-generated scene would.
//
// If these specific fixtures get pruned upstream, swap in any other
// publicUrl from e2e/fixtures/recorded/r2/{thumbnails,videos}/*.json.
const DEMO_THUMBNAIL_URL =
  'https://storage-dev.openstory.so/thumbnails/teams/01KRMKS88ZRXB9Z8RAX8MSZKJ5/sequences/01KRMKTJ3HZZBFMFJEC5H25FVH/frames/01KRMKVZG8SGSBAKZPPF01Q8AY/01KRMKYX4M2A19VFF5VTQ04YEA.png';
const DEMO_VIDEO_URL =
  'https://storage-dev.openstory.so/videos/teams/01KRMKS88ZRXB9Z8RAX8MSZKJ5/sequences/01KRMKTJ3HZZBFMFJEC5H25FVH/frames/01KRMKVZG8SGSBAKZPPF01Q8AY/coral-a-summer-launch_promenade-walk_h0vz41_openstory.mp4';

// Sentinel hash — different from anything the app will compute from the
// frame's current state, so editing the prompt in the recording immediately
// triggers the staleness indicator. The app's isStale check is a plain
// string compare (see src/lib/db/scoped/frames.ts), so any non-matching
// value works; using a sentinel makes intent obvious in the DB.
const SENTINEL_HASH = 'sha256:marketing-demo-baseline';

type TestUser = { id: string; email: string; name: string; teamId: string };

function readTestUser(): TestUser {
  if (!fs.existsSync(USER_INFO_FILE)) {
    throw new Error(
      `Missing ${USER_INFO_FILE}. Run the e2e auth setup first ` +
        `(bunx playwright test --project=setup).`
    );
  }
  return JSON.parse(fs.readFileSync(USER_INFO_FILE, 'utf-8'));
}

function buildSceneMetadata(): Scene {
  return {
    sceneId: 'demo-scene-1',
    sceneNumber: 1,
    originalScript: {
      extract:
        'A founder steps out onto the promenade at golden hour. The product launch poster glows behind her.',
      dialogue: [],
    },
  };
}

async function main() {
  const testUser = readTestUser();
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

  // Pick the first available style — seeded system templates are the
  // realistic fallback when the user's own team has no custom styles yet.
  const style = await db.select().from(styles).limit(1).get();
  if (!style) {
    throw new Error(
      'No styles in test.db. Make sure the seed script has run ' +
        '(bun --bun scripts/seed.ts --test).'
    );
  }

  // Find-or-create the demo sequence.
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
      id: sequenceId,
      teamId: testUser.teamId,
      title: DEMO_TITLE,
      script:
        'INT. STUDIO - DAY\n\nThe founder reviews the campaign poster.\n\nEXT. PROMENADE - GOLDEN HOUR\n\nShe walks past it, glancing back once.',
      status: 'completed',
      styleId: style.id,
      createdBy: testUser.id,
      updatedBy: testUser.id,
    });
    sequence = await db
      .select()
      .from(sequences)
      .where(eq(sequences.id, sequenceId))
      .get();
    if (!sequence) {
      throw new Error('Insert succeeded but sequence not found on re-read');
    }
    console.log(`[seed-marketing-demo] created sequence ${sequenceId}`);
  } else {
    console.log(
      `[seed-marketing-demo] reusing existing sequence ${sequence.id}`
    );
  }

  // Find-or-create the first frame. The walkthrough drives this frame —
  // edits its prompt, expects the stale badge, picks a video model.
  const existingFrame = await db
    .select()
    .from(frames)
    .where(and(eq(frames.sequenceId, sequence.id), eq(frames.orderIndex, 0)))
    .get();

  if (!existingFrame) {
    await db.insert(frames).values({
      sequenceId: sequence.id,
      orderIndex: 0,
      description: 'Founder walking the promenade at golden hour',
      durationMs: 4000,
      imagePrompt:
        'medium shot, founder walking past launch poster, soft afternoon light',
      motionPrompt: 'slow dolly forward as she glances back over her shoulder',
      // Pre-rendered media — points at real fixture CDN URLs so the editor
      // displays the frame as "already generated".
      thumbnailUrl: DEMO_THUMBNAIL_URL,
      previewThumbnailUrl: DEMO_THUMBNAIL_URL,
      thumbnailStatus: 'completed',
      thumbnailGeneratedAt: new Date(),
      variantImageStatus: 'completed',
      videoUrl: DEMO_VIDEO_URL,
      videoStatus: 'completed',
      videoGeneratedAt: new Date(),
      // Sentinel hashes — see comment at top of file.
      variantImageInputHash: SENTINEL_HASH,
      videoInputHash: SENTINEL_HASH,
      visualPromptInputHash: SENTINEL_HASH,
      motionPromptInputHash: SENTINEL_HASH,
      metadata: buildSceneMetadata(),
    });
    console.log('[seed-marketing-demo] created demo frame');
  } else {
    console.log('[seed-marketing-demo] reusing existing demo frame');
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
