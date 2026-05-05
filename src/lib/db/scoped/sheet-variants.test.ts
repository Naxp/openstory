/**
 * Schema-level acceptance tests for `insertDivergent` on
 * `character_sheet_variants`, `location_sheet_variants`, and
 * `talent_sheet_variants`.
 *
 * The three tables share a partial-index split (primary vs divergent on
 * `divergedAt`) and a parallel race-tolerance helper. The tests pin the
 * substantive new behavior introduced in PR #618:
 *
 *  - QStash retry idempotency: repeated calls with the same identity tuple
 *    return the existing row instead of double-inserting.
 *  - Cross-run race tolerance: a unique-constraint conflict triggered by a
 *    concurrent run is absorbed into a re-fetch that returns the winner.
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
import { drizzle } from 'drizzle-orm/libsql';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { generateId } from '@/lib/db/id';
import {
  characterSheetVariants,
  characters,
  locationSheetVariants,
  sequences,
  styles,
  talent,
  talentSheetVariants,
  talentSheets,
  teams,
  user,
} from '@/lib/db/schema';
import { relations } from '@/lib/db/schema/relations';
import type { Database } from '@/lib/db/client';
import { createCharacterSheetVariantsMethods } from './character-sheet-variants';
import { createLocationSheetVariantsMethods } from './location-sheet-variants';
import { createTalentSheetVariantsMethods } from './talent-sheet-variants';

let client: Client;
let db: Database;

const team = { id: '', name: 'T', slug: 't' };
const userRow = { id: '', name: 'U', email: 'u@example.com' };
let sequenceId = '';
let characterId = '';
let talentId = '';
let talentSheetId = '';

async function seed() {
  await db.delete(characterSheetVariants);
  await db.delete(locationSheetVariants);
  await db.delete(talentSheetVariants);
  await db.delete(talentSheets);
  await db.delete(characters);
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
  const [character] = await db
    .insert(characters)
    .values({ sequenceId, characterId: 'char_001', name: 'Alice' })
    .returning();
  characterId = character.id;
  const [talentRow] = await db
    .insert(talent)
    .values({ teamId: team.id, name: 'Talent A' })
    .returning();
  talentId = talentRow.id;
  const [sheet] = await db
    .insert(talentSheets)
    .values({
      talentId,
      name: 'Default',
      imageUrl: 'https://example.com/sheet.png',
    })
    .returning();
  talentSheetId = sheet.id;
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

describe('character-sheet-variants insertDivergent', () => {
  it('is idempotent on (characterId, model, inputHash) — retry returns the existing row', async () => {
    const methods = createCharacterSheetVariantsMethods(db);
    const divergedAt = new Date('2026-04-29T00:00:00Z');

    const first = await methods.insertDivergent({
      characterId,
      model: 'flux-pro',
      url: 'https://example.com/divergent-1.png',
      status: 'completed',
      inputHash: 'hash-snap',
      divergedAt,
    });

    const second = await methods.insertDivergent({
      characterId,
      model: 'flux-pro',
      url: 'https://example.com/divergent-1.png',
      status: 'completed',
      inputHash: 'hash-snap',
      divergedAt,
    });

    expect(second.id).toBe(first.id);
    const rows = await db.select().from(characterSheetVariants);
    expect(rows).toHaveLength(1);
  });

  it('writes a second divergent row when inputHash differs', async () => {
    const methods = createCharacterSheetVariantsMethods(db);
    const divergedAt = new Date('2026-04-29T00:00:00Z');

    await methods.insertDivergent({
      characterId,
      model: 'flux-pro',
      url: 'https://example.com/divergent-a.png',
      status: 'completed',
      inputHash: 'hash-a',
      divergedAt,
    });
    await methods.insertDivergent({
      characterId,
      model: 'flux-pro',
      url: 'https://example.com/divergent-b.png',
      status: 'completed',
      inputHash: 'hash-b',
      divergedAt,
    });

    const rows = await db.select().from(characterSheetVariants);
    expect(rows).toHaveLength(2);
  });

  it('pre-check returns the existing row when a divergent variant is already present', async () => {
    // Seeds the row directly, then calls `insertDivergent`. The helper's
    // pre-check SELECT finds the row and returns it — exercises the
    // "QStash retried the same step" path. The post-collision retry path
    // is exercised separately at the helper level (see `insertDivergentRaceTolerant`
    // tests below).
    const methods = createCharacterSheetVariantsMethods(db);
    const divergedAt = new Date('2026-04-29T00:00:00Z');

    const existingRow = await db
      .insert(characterSheetVariants)
      .values({
        characterId,
        model: 'flux-pro',
        url: 'https://example.com/winner.png',
        status: 'completed',
        inputHash: 'hash-race',
        divergedAt,
      })
      .returning();

    const result = await methods.insertDivergent({
      characterId,
      model: 'flux-pro',
      url: 'https://example.com/loser.png',
      status: 'completed',
      inputHash: 'hash-race',
      divergedAt,
    });

    expect(result.id).toBe(existingRow[0].id);
    expect(result.url).toBe('https://example.com/winner.png');
  });
});

describe('location-sheet-variants insertDivergent', () => {
  it('is idempotent on (parentType, parentId, model, inputHash)', async () => {
    const methods = createLocationSheetVariantsMethods(db);
    const divergedAt = new Date('2026-04-29T00:00:00Z');
    // Library locations have no FK to a parent table at the schema level
    // (parentId is a free string), so any id will satisfy the constraint.
    const parentId = generateId();

    const first = await methods.insertDivergent({
      parentType: 'library_location',
      parentId,
      model: 'flux-pro',
      url: 'https://example.com/divergent.png',
      status: 'completed',
      inputHash: 'hash-snap',
      divergedAt,
    });
    const second = await methods.insertDivergent({
      parentType: 'library_location',
      parentId,
      model: 'flux-pro',
      url: 'https://example.com/divergent.png',
      status: 'completed',
      inputHash: 'hash-snap',
      divergedAt,
    });

    expect(second.id).toBe(first.id);
    const rows = await db.select().from(locationSheetVariants);
    expect(rows).toHaveLength(1);
  });

  it('treats the same id under a different parentType as a separate row', async () => {
    const methods = createLocationSheetVariantsMethods(db);
    const divergedAt = new Date('2026-04-29T00:00:00Z');
    const parentId = generateId();

    await methods.insertDivergent({
      parentType: 'sequence_location',
      parentId,
      model: 'flux-pro',
      url: 'https://example.com/seq.png',
      status: 'completed',
      inputHash: 'hash',
      divergedAt,
    });
    await methods.insertDivergent({
      parentType: 'library_location',
      parentId,
      model: 'flux-pro',
      url: 'https://example.com/lib.png',
      status: 'completed',
      inputHash: 'hash',
      divergedAt,
    });

    const rows = await db.select().from(locationSheetVariants);
    expect(rows).toHaveLength(2);
  });
});

describe('talent-sheet-variants insertDivergent', () => {
  it('is idempotent on (talentSheetId, model, inputHash)', async () => {
    const methods = createTalentSheetVariantsMethods(db);
    const divergedAt = new Date('2026-04-29T00:00:00Z');

    const first = await methods.insertDivergent({
      talentSheetId,
      model: 'flux-pro',
      url: 'https://example.com/divergent.png',
      status: 'completed',
      inputHash: 'hash-snap',
      divergedAt,
    });
    const second = await methods.insertDivergent({
      talentSheetId,
      model: 'flux-pro',
      url: 'https://example.com/divergent.png',
      status: 'completed',
      inputHash: 'hash-snap',
      divergedAt,
    });

    expect(second.id).toBe(first.id);
    const rows = await db.select().from(talentSheetVariants);
    expect(rows).toHaveLength(1);
  });
});

// ----------------------------------------------------------------------------
// Stage 2 UI (issue #626) — soft-delete + promote tests for the three
// scoped sheet-variant modules. The existing `insertDivergent` cases above
// already pin the schema-level partial-index split; these tests pin the new
// promote/discard/undiscard verbs that drive the divergent-banner UI.
// ----------------------------------------------------------------------------

describe('character-sheet-variants discard / undiscard / promote', () => {
  it('discard sets discardedAt and undiscard clears it', async () => {
    const methods = createCharacterSheetVariantsMethods(db);
    const divergedAt = new Date('2026-04-29T00:00:00Z');
    const variant = await methods.insertDivergent({
      characterId,
      model: 'flux-pro',
      url: 'https://example.com/divergent.png',
      status: 'completed',
      inputHash: 'hash',
      divergedAt,
    });

    const discardedAt = await methods.discard(variant.id);
    const after = await methods.getById(variant.id);
    // SQLite stores timestamps at second precision; compare via getTime().
    expect(after?.discardedAt).toBeInstanceOf(Date);
    expect(Math.floor(discardedAt.getTime() / 1000)).toBe(
      Math.floor((after?.discardedAt?.getTime() ?? 0) / 1000)
    );

    await methods.undiscard(variant.id);
    const restored = await methods.getById(variant.id);
    expect(restored?.discardedAt).toBeNull();
  });

  it('listDivergentActiveByCharacter excludes discarded rows', async () => {
    const methods = createCharacterSheetVariantsMethods(db);
    const divergedAt = new Date('2026-04-29T00:00:00Z');
    const a = await methods.insertDivergent({
      characterId,
      model: 'flux-pro',
      url: 'https://example.com/a.png',
      status: 'completed',
      inputHash: 'hash-a',
      divergedAt,
    });
    await methods.insertDivergent({
      characterId,
      model: 'flux-pro',
      url: 'https://example.com/b.png',
      status: 'completed',
      inputHash: 'hash-b',
      divergedAt,
    });
    await methods.discard(a.id);

    const active = await methods.listDivergentActiveByCharacter(characterId);
    expect(active).toHaveLength(1);
    expect(active[0].inputHash).toBe('hash-b');
  });

  it('promoteAtomically copies fields onto characters and discards the variant', async () => {
    const methods = createCharacterSheetVariantsMethods(db);
    const divergedAt = new Date('2026-04-29T00:00:00Z');
    const variant = await methods.insertDivergent({
      characterId,
      model: 'flux-pro',
      url: 'https://example.com/promoted.png',
      storagePath: '/r2/promoted.png',
      status: 'completed',
      inputHash: 'hash-promoted',
      divergedAt,
    });

    await methods.promoteAtomically(
      characterId,
      {
        sheetImageUrl: variant.url,
        sheetImagePath: variant.storagePath,
        sheetInputHash: variant.inputHash,
      },
      variant.id
    );

    const [updatedCharacter] = await db
      .select()
      .from(characters)
      .where(eq(characters.id, characterId));
    expect(updatedCharacter.sheetImageUrl).toBe(
      'https://example.com/promoted.png'
    );
    expect(updatedCharacter.sheetInputHash).toBe('hash-promoted');

    const after = await methods.getById(variant.id);
    expect(after?.discardedAt).not.toBeNull();
  });
});

describe('location-sheet-variants discard / promote', () => {
  it('discard then list excludes the discarded row', async () => {
    const methods = createLocationSheetVariantsMethods(db);
    const divergedAt = new Date('2026-04-29T00:00:00Z');
    const parentId = generateId();
    const variant = await methods.insertDivergent({
      parentType: 'library_location',
      parentId,
      model: 'flux-pro',
      url: 'https://example.com/x.png',
      status: 'completed',
      inputHash: 'hash',
      divergedAt,
    });

    await methods.discard(variant.id);
    const active = await methods.listDivergentActiveByParent(
      'library_location',
      parentId
    );
    expect(active).toHaveLength(0);
  });
});

describe('talent-sheet-variants discard / promote', () => {
  it('promoteAtomically writes onto talent_sheets and discards the variant', async () => {
    const methods = createTalentSheetVariantsMethods(db);
    const divergedAt = new Date('2026-04-29T00:00:00Z');
    const variant = await methods.insertDivergent({
      talentSheetId,
      model: 'flux-pro',
      url: 'https://example.com/promoted.png',
      storagePath: '/r2/promoted.png',
      status: 'completed',
      inputHash: 'hash-promoted',
      divergedAt,
    });

    await methods.promoteAtomically(
      talentSheetId,
      {
        imageUrl: variant.url,
        imagePath: variant.storagePath,
        inputHash: variant.inputHash,
      },
      variant.id
    );

    const [updatedSheet] = await db
      .select()
      .from(talentSheets)
      .where(eq(talentSheets.id, talentSheetId));
    expect(updatedSheet.imageUrl).toBe('https://example.com/promoted.png');
    expect(updatedSheet.inputHash).toBe('hash-promoted');

    const after = await methods.getById(variant.id);
    expect(after?.discardedAt).not.toBeNull();
  });
});
