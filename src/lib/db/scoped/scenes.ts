/**
 * Scoped Scenes Sub-module
 * Scene CRUD and ordered listing within a sequence.
 *
 * Scenes are the narrative units introduced in #907. Each owns an ordered list
 * of shots; this stage keeps every sequence as scenes-of-one-shot.
 */

import type { Database } from '@/lib/db/client';
import { dbSceneId, scenes } from '@/lib/db/schema';
import type { DbSceneId, NewScene, SceneRow } from '@/lib/db/schema';
import { asc, desc, eq, inArray } from 'drizzle-orm';

type SceneOrderBy = 'orderIndex' | 'createdAt' | 'updatedAt';

type SceneFilters = {
  orderBy?: SceneOrderBy;
  ascending?: boolean;
};

// drizzle infers `id` as a plain string; the row type brands it as DbSceneId.
// Brand at this single boundary so callers get branded ids without casts.
type RawSceneRow = Omit<SceneRow, 'id'> & { id: string };
const brand = (row: RawSceneRow): SceneRow => ({
  ...row,
  id: dbSceneId(row.id),
});

export function createScenesMethods(db: Database) {
  return {
    getById: async (sceneId: DbSceneId): Promise<SceneRow | null> => {
      const result = await db
        .select()
        .from(scenes)
        .where(eq(scenes.id, sceneId));
      return result[0] ? brand(result[0]) : null;
    },

    listBySequence: async (
      sequenceId: string,
      options?: SceneFilters
    ): Promise<SceneRow[]> => {
      const { orderBy = 'orderIndex', ascending = true } = options ?? {};

      const orderColumn =
        orderBy === 'orderIndex'
          ? scenes.orderIndex
          : orderBy === 'createdAt'
            ? scenes.createdAt
            : scenes.updatedAt;

      const orderFn = ascending ? asc : desc;

      const rows = await db
        .select()
        .from(scenes)
        .where(eq(scenes.sequenceId, sequenceId))
        .orderBy(orderFn(orderColumn));
      return rows.map(brand);
    },

    create: async (data: NewScene): Promise<SceneRow> => {
      const [scene] = await db.insert(scenes).values(data).returning();
      if (!scene) {
        throw new Error(
          `Failed to create scene for sequence ${data.sequenceId}`
        );
      }
      return brand(scene);
    },

    update: async (
      sceneId: DbSceneId,
      data: Partial<NewScene>,
      options?: { throwOnMissing?: boolean }
    ): Promise<SceneRow | undefined> => {
      const [scene] = await db
        .update(scenes)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(scenes.id, sceneId))
        .returning();

      if (!scene && options?.throwOnMissing !== false) {
        throw new Error(`Scene ${sceneId} not found`);
      }

      return scene ? brand(scene) : undefined;
    },

    delete: async (sceneId: DbSceneId): Promise<boolean> => {
      const result = await db.delete(scenes).where(eq(scenes.id, sceneId));
      // oxlint-disable-next-line typescript-eslint/no-unnecessary-condition -- DB result may be undefined at runtime
      return (result.rowsAffected ?? 0) > 0;
    },

    deleteBySequence: async (sequenceId: string): Promise<number> => {
      const result = await db
        .delete(scenes)
        .where(eq(scenes.sequenceId, sequenceId));
      // oxlint-disable-next-line typescript-eslint/no-unnecessary-condition -- DB result may be undefined at runtime
      return result.rowsAffected ?? 0;
    },

    createBulk: async (sceneData: NewScene[]): Promise<SceneRow[]> => {
      const BATCH_SIZE = 5;
      const results: SceneRow[] = [];

      for (let i = 0; i < sceneData.length; i += BATCH_SIZE) {
        const batch = sceneData.slice(i, i + BATCH_SIZE);
        const batchResults = await db.insert(scenes).values(batch).returning();
        results.push(...batchResults.map(brand));
      }

      return results;
    },

    getByIds: async (sceneIds: DbSceneId[]): Promise<SceneRow[]> => {
      if (sceneIds.length === 0) return [];
      const rows = await db
        .select()
        .from(scenes)
        .where(inArray(scenes.id, sceneIds));
      return rows.map(brand);
    },
  };
}
