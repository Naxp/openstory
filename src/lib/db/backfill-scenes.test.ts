/**
 * In-memory DB tests for the #907 scenes backfill.
 *
 * Runs the real migrations (including the new scenes table + shots.scene_id /
 * shot_number columns) against an in-memory libsql DB, then exercises the
 * backfill end-to-end. The staleness-compat test is the milestone's #1 QA
 * risk: a freshly-backfilled shot must still report isStale() === false.
 */

import type { Scene } from '@/lib/ai/scene-analysis.schema';
import type { Database } from '@/lib/db/client';
import { generateId } from '@/lib/db/id';
import type { NewShot } from '@/lib/db/schema';
import { scenes, sequences, shots, styles, teams } from '@/lib/db/schema';
import { relations } from '@/lib/db/schema/relations';
import { createShotsMethods } from '@/lib/db/scoped/shots';
import { type Client, createClient } from '@libsql/client';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/libsql';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { backfillScenes, buildSceneRow } from './backfill-scenes';

let client: Client;
let db: Database;
let teamId = '';
let sequenceId = '';

function sceneFixture(overrides: Partial<Scene> = {}): Scene {
  return {
    sceneId: 'scene-1',
    sceneNumber: 1,
    originalScript: { extract: 'INT. OFFICE - DAY', dialogue: [] },
    metadata: {
      title: 'The meeting',
      durationSeconds: 5,
      location: 'INT. OFFICE - DAY',
      timeOfDay: 'day',
      storyBeat: 'Setup',
    },
    continuity: {
      characterTags: ['sarah'],
      environmentTag: 'office',
      elementTags: [],
      colorPalette: 'cool blues',
      lightingSetup: 'overhead fluorescent',
      styleTag: 'corporate',
    },
    musicDesign: {
      presence: 'minimal',
      style: 'ambient',
      mood: 'tense',
      atmosphere: 'office hum',
    },
    ...overrides,
  };
}

async function seedSequence(): Promise<void> {
  teamId = generateId();
  sequenceId = generateId();
  await db.insert(teams).values({ id: teamId, name: 'T', slug: `t-${teamId}` });
  const [style] = await db
    .insert(styles)
    .values({
      teamId,
      name: 'default',
      config: {
        mood: 'neutral',
        artStyle: 'cinematic',
        lighting: 'natural',
        colorPalette: ['#000', '#fff'],
        cameraWork: 'static',
        referenceFilms: [],
        colorGrading: 'neutral',
      },
    })
    .returning();
  if (!style) throw new Error('test setup: style insert returned nothing');
  await db.insert(sequences).values({
    id: sequenceId,
    teamId,
    title: 'S',
    styleId: style.id,
  });
}

async function insertShot(data: Partial<NewShot> & { orderIndex: number }) {
  const [shot] = await db
    .insert(shots)
    .values({ sequenceId, ...data } satisfies NewShot)
    .returning();
  if (!shot) throw new Error('test setup: shot insert returned nothing');
  return shot;
}

beforeAll(async () => {
  client = createClient({ url: ':memory:' });
  db = drizzle({ client, relations });
  await migrate(db, { migrationsFolder: './drizzle/migrations' });
});

afterAll(() => {
  client.close();
});

beforeEach(async () => {
  await db.delete(shots);
  await db.delete(scenes);
  await db.delete(sequences);
  await db.delete(styles);
  await db.delete(teams);
  await seedSequence();
});

describe('buildSceneRow', () => {
  it('splits scene-level fields out of the shot metadata onto the scene row', () => {
    const row = buildSceneRow(sequenceId, 3, sceneFixture());
    expect(row.sequenceId).toBe(sequenceId);
    expect(row.orderIndex).toBe(3);
    expect(row.location).toBe('INT. OFFICE - DAY');
    expect(row.timeOfDay).toBe('day');
    expect(row.storyBeat).toBe('Setup');
    expect(row.title).toBe('The meeting');
    expect(row.continuity?.environmentTag).toBe('office');
    expect(row.musicDesign?.mood).toBe('tense');
    expect(row.originalScript?.extract).toBe('INT. OFFICE - DAY');
  });

  it('yields null scene fields for null metadata without crashing', () => {
    const row = buildSceneRow(sequenceId, 0, null);
    expect(row.location).toBeNull();
    expect(row.title).toBeNull();
    expect(row.continuity).toBeNull();
    expect(row.musicDesign).toBeNull();
    expect(row.originalScript).toBeNull();
  });
});

describe('backfillScenes', () => {
  it('creates one scene per shot and links them with shotNumber=1', async () => {
    await insertShot({ orderIndex: 0, metadata: sceneFixture() });
    await insertShot({
      orderIndex: 1,
      metadata: sceneFixture({ sceneId: 'scene-2', sceneNumber: 2 }),
    });

    const result = await backfillScenes(db);
    expect(result.createdScenes).toBe(2);

    const allScenes = await db.select().from(scenes);
    expect(allScenes).toHaveLength(2);

    const allShots = await db.select().from(shots);
    for (const shot of allShots) {
      expect(shot.sceneId).not.toBeNull();
      expect(shot.shotNumber).toBe(1);
      // The created scene's orderIndex mirrors the shot's.
      const scene = allScenes.find((s) => s.id === shot.sceneId);
      expect(scene?.orderIndex).toBe(shot.orderIndex);
    }
  });

  it('lands scene-level JSON on the scene row (split correctness)', async () => {
    const shot = await insertShot({ orderIndex: 0, metadata: sceneFixture() });
    await backfillScenes(db);

    const [scene] = await db
      .select()
      .from(scenes)
      .where(eq(scenes.sequenceId, sequenceId));
    expect(scene?.location).toBe('INT. OFFICE - DAY');
    expect(scene?.continuity?.characterTags).toEqual(['sarah']);
    expect(scene?.musicDesign?.presence).toBe('minimal');

    // The shot's metadata is left intact (transitional duplicate).
    const [reread] = await db.select().from(shots).where(eq(shots.id, shot.id));
    expect(reread?.metadata?.metadata?.location).toBe('INT. OFFICE - DAY');
  });

  it('backfills a null-metadata shot without crashing', async () => {
    await insertShot({ orderIndex: 0, metadata: null });
    const result = await backfillScenes(db);
    expect(result.createdScenes).toBe(1);

    const [scene] = await db.select().from(scenes);
    expect(scene?.location).toBeNull();
    expect(scene?.title).toBeNull();

    const [shot] = await db.select().from(shots);
    expect(shot?.sceneId).toBe(scene?.id);
    expect(shot?.shotNumber).toBe(1);
  });

  it('is idempotent: a second run creates no duplicate scenes', async () => {
    await insertShot({ orderIndex: 0, metadata: sceneFixture() });
    await insertShot({
      orderIndex: 1,
      metadata: sceneFixture({ sceneId: 'scene-2' }),
    });

    const first = await backfillScenes(db);
    expect(first.createdScenes).toBe(2);

    const second = await backfillScenes(db);
    expect(second.createdScenes).toBe(0);
    expect(second.scannedShots).toBe(0);

    expect(await db.select().from(scenes)).toHaveLength(2);
    const allShots = await db.select().from(shots);
    expect(allShots.every((s) => s.sceneId !== null)).toBe(true);
  });

  it('does not write when dryRun is set', async () => {
    await insertShot({ orderIndex: 0, metadata: sceneFixture() });
    const result = await backfillScenes(db, { dryRun: true });
    expect(result.createdScenes).toBe(1);
    expect(await db.select().from(scenes)).toHaveLength(0);
    const [shot] = await db.select().from(shots);
    expect(shot?.sceneId).toBeNull();
  });

  it('staleness compat: a freshly-backfilled shot is NOT stale', async () => {
    // A shot whose video artifact has a recorded input hash — the real path
    // where staleness matters. Backfill must not perturb it.
    const knownHash = 'abc123-video-input-hash';
    const shot = await insertShot({
      orderIndex: 0,
      metadata: sceneFixture(),
      videoInputHash: knownHash,
    });

    await backfillScenes(db);

    const shotsMethods = createShotsMethods(db);
    // Same hash → not stale. Backfill touched only sceneId + shotNumber, so the
    // stored videoInputHash is unchanged.
    expect(await shotsMethods.isStale(shot.id, 'video', knownHash)).toBe(false);

    // Sanity: a different hash WOULD be stale, proving the check is live.
    expect(await shotsMethods.isStale(shot.id, 'video', 'different')).toBe(
      true
    );

    // And the stored hash itself survived the backfill untouched.
    const [reread] = await db.select().from(shots).where(eq(shots.id, shot.id));
    expect(reread?.videoInputHash).toBe(knownHash);
  });
});
