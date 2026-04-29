/**
 * Schema-level acceptance test for the Stage-1 input-hash columns.
 *
 * The matching `isStale` wrappers (frames, frameVariants, characters,
 * locationLibrary, locationSheets, talent.sheets) are trivial factory
 * closures over these columns; the project's `mock.module` in
 * scoped.test.ts stubs out those factories process-wide when the full
 * suite runs (per the comment at the top of `./talent.test.ts`), so we
 * verify the storage layer directly rather than fighting the mock.
 *
 * Type-checking proves the wrapper methods are callable; this file
 * proves the columns persist and default to null (the "unknown, treat
 * as non-stale" baseline that the wrappers branch on).
 */

import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'bun:test';
import { type Client, createClient } from '@libsql/client';
import { eq } from 'drizzle-orm';
import { drizzle, type LibSQLDatabase } from 'drizzle-orm/libsql';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { generateId } from '@/lib/db/id';
import {
  characters,
  frameVariants,
  frames,
  locationLibrary,
  locationSheets,
  sequences,
  styles,
  talent,
  talentSheets,
  teams,
  user,
} from '@/lib/db/schema';
import { relations } from '@/lib/db/schema/relations';

type TestDb = LibSQLDatabase<Record<string, never>, typeof relations>;

let client: Client;
let db: TestDb;

const team = { id: '', name: 'T', slug: 't' };
const userRow = { id: '', name: 'U', email: 'u@example.com' };
let sequenceId = '';

async function seed() {
  await db.delete(frameVariants);
  await db.delete(frames);
  await db.delete(characters);
  await db.delete(locationSheets);
  await db.delete(locationLibrary);
  await db.delete(talentSheets);
  await db.delete(talent);
  await db.delete(sequences);
  await db.delete(styles);
  await db.delete(teams);
  await db.delete(user);

  team.id = generateId();
  userRow.id = generateId();
  sequenceId = generateId();

  await db.insert(user).values([userRow]);
  await db.insert(teams).values([team]);
  const [style] = await db
    .insert(styles)
    .values({
      teamId: team.id,
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
  await db
    .insert(sequences)
    .values([
      { id: sequenceId, teamId: team.id, title: 'S', styleId: style.id },
    ]);
}

beforeAll(async () => {
  client = createClient({ url: ':memory:' });
  db = drizzle({ client, relations, casing: 'snake_case' });
  await migrate(db, { migrationsFolder: './drizzle/migrations' });
});

afterAll(() => {
  client.close();
});

beforeEach(async () => {
  await seed();
});

describe('frames input-hash columns', () => {
  it('default to null and persist when set', async () => {
    const [frame] = await db
      .insert(frames)
      .values({ sequenceId, orderIndex: 0 })
      .returning();
    expect(frame.thumbnailInputHash).toBeNull();
    expect(frame.variantImageInputHash).toBeNull();
    expect(frame.videoInputHash).toBeNull();
    expect(frame.audioInputHash).toBeNull();

    await db
      .update(frames)
      .set({
        thumbnailInputHash: 't',
        variantImageInputHash: 'v',
        videoInputHash: 'm',
        audioInputHash: 'a',
      })
      .where(eq(frames.id, frame.id));
    const [refreshed] = await db
      .select()
      .from(frames)
      .where(eq(frames.id, frame.id));
    expect(refreshed.thumbnailInputHash).toBe('t');
    expect(refreshed.variantImageInputHash).toBe('v');
    expect(refreshed.videoInputHash).toBe('m');
    expect(refreshed.audioInputHash).toBe('a');
  });
});

describe('frame_variants input-hash + diverged_at columns', () => {
  it('default to null and persist when set', async () => {
    const [frame] = await db
      .insert(frames)
      .values({ sequenceId, orderIndex: 0 })
      .returning();
    const [variant] = await db
      .insert(frameVariants)
      .values({
        frameId: frame.id,
        sequenceId,
        variantType: 'image',
        model: 'm1',
      })
      .returning();
    expect(variant.inputHash).toBeNull();
    expect(variant.divergedAt).toBeNull();

    const divergedAt = new Date('2026-04-29T00:00:00Z');
    await db
      .update(frameVariants)
      .set({ inputHash: 'h', divergedAt })
      .where(eq(frameVariants.id, variant.id));
    const [refreshed] = await db
      .select()
      .from(frameVariants)
      .where(eq(frameVariants.id, variant.id));
    expect(refreshed.inputHash).toBe('h');
    expect(refreshed.divergedAt?.getTime()).toBe(divergedAt.getTime());
  });
});

describe('characters.sheet_input_hash', () => {
  it('defaults to null and persists when set', async () => {
    const [c] = await db
      .insert(characters)
      .values({ sequenceId, characterId: 'c1', name: 'C', age: '30s' })
      .returning();
    expect(c.sheetInputHash).toBeNull();

    await db
      .update(characters)
      .set({ sheetInputHash: 'h' })
      .where(eq(characters.id, c.id));
    const [refreshed] = await db
      .select()
      .from(characters)
      .where(eq(characters.id, c.id));
    expect(refreshed.sheetInputHash).toBe('h');
  });
});

describe('locationLibrary.reference_input_hash', () => {
  it('defaults to null and persists when set', async () => {
    const [loc] = await db
      .insert(locationLibrary)
      .values({ teamId: team.id, name: 'L' })
      .returning();
    expect(loc.referenceInputHash).toBeNull();

    await db
      .update(locationLibrary)
      .set({ referenceInputHash: 'h' })
      .where(eq(locationLibrary.id, loc.id));
    const [refreshed] = await db
      .select()
      .from(locationLibrary)
      .where(eq(locationLibrary.id, loc.id));
    expect(refreshed.referenceInputHash).toBe('h');
  });
});

describe('locationSheets.input_hash', () => {
  it('defaults to null and persists when set', async () => {
    const [loc] = await db
      .insert(locationLibrary)
      .values({ teamId: team.id, name: 'L' })
      .returning();
    const [sheet] = await db
      .insert(locationSheets)
      .values({ locationId: loc.id, name: 'night' })
      .returning();
    expect(sheet.inputHash).toBeNull();

    await db
      .update(locationSheets)
      .set({ inputHash: 'h' })
      .where(eq(locationSheets.id, sheet.id));
    const [refreshed] = await db
      .select()
      .from(locationSheets)
      .where(eq(locationSheets.id, sheet.id));
    expect(refreshed.inputHash).toBe('h');
  });
});

describe('talent_sheets.input_hash', () => {
  it('defaults to null and persists when set', async () => {
    const [t] = await db
      .insert(talent)
      .values({ teamId: team.id, name: 'T' })
      .returning();
    const [sheet] = await db
      .insert(talentSheets)
      .values({ talentId: t.id, name: 'casual' })
      .returning();
    expect(sheet.inputHash).toBeNull();

    await db
      .update(talentSheets)
      .set({ inputHash: 'h' })
      .where(eq(talentSheets.id, sheet.id));
    const [refreshed] = await db
      .select()
      .from(talentSheets)
      .where(eq(talentSheets.id, sheet.id));
    expect(refreshed.inputHash).toBe('h');
  });
});
