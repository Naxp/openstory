/**
 * Scoped Sequence Elements Sub-module
 * Element CRUD for per-sequence uploaded reference images.
 */

import { and, eq, inArray } from 'drizzle-orm';
import type { Database } from '@/lib/db/client';
import type {
  ElementVisionStatus,
  NewSequenceElement,
  SequenceElement,
} from '@/lib/db/schema';
import { sequenceElements } from '@/lib/db/schema';

export function createSequenceElementsMethods(db: Database) {
  const update = async (
    id: string,
    data: Partial<NewSequenceElement>
  ): Promise<SequenceElement> => {
    const [element] = await db
      .update(sequenceElements)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(sequenceElements.id, id))
      .returning();

    // oxlint-disable-next-line typescript-eslint/no-unnecessary-condition -- runtime guard: DB may return undefined
    if (!element) {
      throw new Error(`SequenceElement ${id} not found`);
    }

    return element;
  };

  return {
    getById: async (id: string): Promise<SequenceElement | null> => {
      const result = await db
        .select()
        .from(sequenceElements)
        .where(eq(sequenceElements.id, id));
      return result[0] ?? null;
    },

    getByToken: async (
      sequenceId: string,
      token: string
    ): Promise<SequenceElement | null> => {
      const result = await db
        .select()
        .from(sequenceElements)
        .where(
          and(
            eq(sequenceElements.sequenceId, sequenceId),
            eq(sequenceElements.token, token)
          )
        );
      return result[0] ?? null;
    },

    list: async (sequenceId: string): Promise<SequenceElement[]> => {
      return await db
        .select()
        .from(sequenceElements)
        .where(eq(sequenceElements.sequenceId, sequenceId))
        .orderBy(sequenceElements.createdAt);
    },

    listByIds: async (ids: string[]): Promise<SequenceElement[]> => {
      if (ids.length === 0) return [];
      return await db
        .select()
        .from(sequenceElements)
        .where(inArray(sequenceElements.id, ids));
    },

    create: async (data: NewSequenceElement): Promise<SequenceElement> => {
      const [element] = await db
        .insert(sequenceElements)
        .values(data)
        .returning();
      // oxlint-disable-next-line typescript-eslint/no-unnecessary-condition -- DB may return undefined
      if (!element) {
        throw new Error('Failed to insert sequence element');
      }
      return element;
    },

    update,

    updateVisionStatus: async (
      id: string,
      status: ElementVisionStatus,
      error?: string
    ): Promise<SequenceElement> => {
      return await update(id, {
        visionStatus: status,
        visionError: error ?? null,
        ...(status === 'completed' && { visionGeneratedAt: new Date() }),
      });
    },

    updateVisionResult: async (
      id: string,
      description: string,
      consistencyTag: string
    ): Promise<SequenceElement> => {
      return await update(id, {
        description,
        consistencyTag,
        visionStatus: 'completed',
        visionGeneratedAt: new Date(),
        visionError: null,
      });
    },

    updateFirstMention: async (
      id: string,
      firstMention: {
        sceneId: string;
        text: string;
        lineNumber: number;
      }
    ): Promise<SequenceElement> => {
      return await update(id, {
        firstMentionSceneId: firstMention.sceneId,
        firstMentionText: firstMention.text,
        firstMentionLine: firstMention.lineNumber,
      });
    },

    delete: async (id: string): Promise<boolean> => {
      const result = await db
        .delete(sequenceElements)
        .where(eq(sequenceElements.id, id));
      // oxlint-disable-next-line typescript-eslint/no-unnecessary-condition -- DB result may be undefined
      return (result.rowsAffected ?? 0) > 0;
    },
  };
}
