/**
 * Scoped Sequence Variants Sub-module
 * CRUD for sequence-level merged-video and music variants. Promotion writes
 * back to the matching `sequences.*` columns so existing UI keeps reading
 * those.
 */

import type { Database } from '@/lib/db/client';
import {
  sequenceMusicVariants,
  sequenceVideoVariants,
  sequences,
} from '@/lib/db/schema';
import type {
  NewSequenceMusicVariant,
  NewSequenceVideoVariant,
  SequenceMusicVariant,
  SequenceVideoVariant,
} from '@/lib/db/schema';
import { and, eq, sql } from 'drizzle-orm';

export function createSequenceVariantsMethods(db: Database) {
  return {
    // ── Video variants ────────────────────────────────────────────────────
    listVideosBySequence: async (
      sequenceId: string
    ): Promise<SequenceVideoVariant[]> => {
      return db
        .select()
        .from(sequenceVideoVariants)
        .where(eq(sequenceVideoVariants.sequenceId, sequenceId));
    },

    getVideoPrimary: async (
      sequenceId: string,
      workflow: string
    ): Promise<SequenceVideoVariant | null> => {
      const [row] = await db
        .select()
        .from(sequenceVideoVariants)
        .where(
          and(
            eq(sequenceVideoVariants.sequenceId, sequenceId),
            eq(sequenceVideoVariants.workflow, workflow),
            sql`${sequenceVideoVariants.divergedAt} IS NULL`
          )
        );
      return row ?? null;
    },

    upsertVideoPrimary: async (
      data: NewSequenceVideoVariant
    ): Promise<SequenceVideoVariant> => {
      const [variant] = await db
        .insert(sequenceVideoVariants)
        .values(data)
        .onConflictDoUpdate({
          target: [
            sequenceVideoVariants.sequenceId,
            sequenceVideoVariants.workflow,
          ],
          targetWhere: sql`${sequenceVideoVariants.divergedAt} IS NULL`,
          set: {
            url: sql.raw(`excluded."url"`),
            storagePath: sql.raw(`excluded."storage_path"`),
            status: sql.raw(`excluded."status"`),
            workflowRunId: sql.raw(`excluded."workflow_run_id"`),
            generatedAt: sql.raw(`excluded."generated_at"`),
            error: sql.raw(`excluded."error"`),
            inputHash: sql.raw(`excluded."input_hash"`),
            updatedAt: new Date(),
          },
        })
        .returning();
      return variant;
    },

    insertDivergentVideo: async (
      data: NewSequenceVideoVariant & { inputHash: string; divergedAt: Date }
    ): Promise<SequenceVideoVariant> => {
      const existing = await db
        .select()
        .from(sequenceVideoVariants)
        .where(
          and(
            eq(sequenceVideoVariants.sequenceId, data.sequenceId),
            eq(sequenceVideoVariants.workflow, data.workflow),
            eq(sequenceVideoVariants.inputHash, data.inputHash),
            sql`${sequenceVideoVariants.divergedAt} IS NOT NULL`
          )
        );
      if (existing.length > 0) {
        return existing[0];
      }
      const [variant] = await db
        .insert(sequenceVideoVariants)
        .values(data)
        .returning();
      return variant;
    },

    /**
     * Promote a video variant: copies its url/path onto the live
     * `sequences.mergedVideo*` columns. Existing UI keeps reading those.
     */
    promoteVideoVariant: async (variantId: string): Promise<void> => {
      const [variant] = await db
        .select()
        .from(sequenceVideoVariants)
        .where(eq(sequenceVideoVariants.id, variantId));
      if (!variant) {
        throw new Error(`SequenceVideoVariant ${variantId} not found`);
      }
      await db
        .update(sequences)
        .set({
          mergedVideoUrl: variant.url,
          mergedVideoPath: variant.storagePath,
          mergedVideoStatus: 'completed',
          mergedVideoGeneratedAt: variant.generatedAt ?? new Date(),
          mergedVideoError: null,
          updatedAt: new Date(),
        })
        .where(eq(sequences.id, variant.sequenceId));
    },

    // ── Music variants ────────────────────────────────────────────────────
    listMusicBySequence: async (
      sequenceId: string
    ): Promise<SequenceMusicVariant[]> => {
      return db
        .select()
        .from(sequenceMusicVariants)
        .where(eq(sequenceMusicVariants.sequenceId, sequenceId));
    },

    getMusicPrimary: async (
      sequenceId: string,
      model: string
    ): Promise<SequenceMusicVariant | null> => {
      const [row] = await db
        .select()
        .from(sequenceMusicVariants)
        .where(
          and(
            eq(sequenceMusicVariants.sequenceId, sequenceId),
            eq(sequenceMusicVariants.model, model),
            sql`${sequenceMusicVariants.divergedAt} IS NULL`
          )
        );
      return row ?? null;
    },

    getMusicById: async (
      variantId: string
    ): Promise<SequenceMusicVariant | null> => {
      const [row] = await db
        .select()
        .from(sequenceMusicVariants)
        .where(eq(sequenceMusicVariants.id, variantId));
      return row ?? null;
    },

    getVideoById: async (
      variantId: string
    ): Promise<SequenceVideoVariant | null> => {
      const [row] = await db
        .select()
        .from(sequenceVideoVariants)
        .where(eq(sequenceVideoVariants.id, variantId));
      return row ?? null;
    },

    upsertMusicPrimary: async (
      data: NewSequenceMusicVariant
    ): Promise<SequenceMusicVariant> => {
      const [variant] = await db
        .insert(sequenceMusicVariants)
        .values(data)
        .onConflictDoUpdate({
          target: [
            sequenceMusicVariants.sequenceId,
            sequenceMusicVariants.model,
          ],
          targetWhere: sql`${sequenceMusicVariants.divergedAt} IS NULL`,
          set: {
            url: sql.raw(`excluded."url"`),
            storagePath: sql.raw(`excluded."storage_path"`),
            prompt: sql.raw(`excluded."prompt"`),
            tags: sql.raw(`excluded."tags"`),
            durationSeconds: sql.raw(`excluded."duration_seconds"`),
            status: sql.raw(`excluded."status"`),
            workflowRunId: sql.raw(`excluded."workflow_run_id"`),
            generatedAt: sql.raw(`excluded."generated_at"`),
            error: sql.raw(`excluded."error"`),
            inputHash: sql.raw(`excluded."input_hash"`),
            updatedAt: new Date(),
          },
        })
        .returning();
      return variant;
    },

    insertDivergentMusic: async (
      data: NewSequenceMusicVariant & { inputHash: string; divergedAt: Date }
    ): Promise<SequenceMusicVariant> => {
      const existing = await db
        .select()
        .from(sequenceMusicVariants)
        .where(
          and(
            eq(sequenceMusicVariants.sequenceId, data.sequenceId),
            eq(sequenceMusicVariants.model, data.model),
            eq(sequenceMusicVariants.inputHash, data.inputHash),
            sql`${sequenceMusicVariants.divergedAt} IS NOT NULL`
          )
        );
      if (existing.length > 0) {
        return existing[0];
      }
      const [variant] = await db
        .insert(sequenceMusicVariants)
        .values(data)
        .returning();
      return variant;
    },

    /**
     * Promote a music variant: copies prompt/tags/url/path/model onto the
     * live `sequences.music*` columns.
     */
    promoteMusicVariant: async (variantId: string): Promise<void> => {
      const [variant] = await db
        .select()
        .from(sequenceMusicVariants)
        .where(eq(sequenceMusicVariants.id, variantId));
      if (!variant) {
        throw new Error(`SequenceMusicVariant ${variantId} not found`);
      }
      await db
        .update(sequences)
        .set({
          musicUrl: variant.url,
          musicPath: variant.storagePath,
          musicPrompt: variant.prompt,
          musicTags: variant.tags,
          musicModel: variant.model,
          musicStatus: 'completed',
          musicGeneratedAt: variant.generatedAt ?? new Date(),
          musicError: null,
          updatedAt: new Date(),
        })
        .where(eq(sequences.id, variant.sequenceId));
    },
  };
}
