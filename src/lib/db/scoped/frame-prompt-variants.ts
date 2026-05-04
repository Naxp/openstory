/**
 * Scoped Frame Prompt Variants Sub-module
 *
 * Appends a new revision row to `frame_prompt_variants` and updates the
 * cached pointer column on `frames` (`imagePrompt` for visual prompts,
 * `motionPrompt` for motion prompts) plus the matching
 * `*_prompt_input_hash` column. The two writes are sequential, not
 * transactional — see `write` for the durability story.
 *
 * Callers go through these helpers instead of writing the cached column
 * directly so prompt history is never lost. Read-path (read the cached
 * column) is unchanged.
 *
 * See docs/architecture/workflow-snapshots-and-content-hash-staleness.md
 * § "Stage 4: prompt versioning".
 */

import type { MotionPromptParameters } from '@/lib/ai/scene-analysis.schema';
import type { Database } from '@/lib/db/client';
import { framePromptVariants, frames } from '@/lib/db/schema';
import type {
  FramePromptType,
  FramePromptVariant,
  FramePromptVariantComponents,
  PromptVariantSource,
} from '@/lib/db/schema';
import { and, desc, eq } from 'drizzle-orm';

export type WriteFramePromptVariantInput = {
  frameId: string;
  promptType: FramePromptType;
  text: string;
  components?: FramePromptVariantComponents | null;
  parameters?: MotionPromptParameters | null;
  source: PromptVariantSource;
  /**
   * SHA-256 of the upstream context that produced an AI prompt. Required for
   * `'ai-generated'` and `'regenerated'`; omitted for `'user-edit'`.
   */
  inputHash?: string | null;
  analysisModel?: string | null;
  createdBy?: string | null;
};

const cachedColumnsForType = (promptType: FramePromptType) =>
  promptType === 'visual'
    ? {
        text: frames.imagePrompt,
        hash: frames.visualPromptInputHash,
        textKey: 'imagePrompt' as const,
        hashKey: 'visualPromptInputHash' as const,
      }
    : {
        text: frames.motionPrompt,
        hash: frames.motionPromptInputHash,
        textKey: 'motionPrompt' as const,
        hashKey: 'motionPromptInputHash' as const,
      };

export function createFramePromptVariantsMethods(db: Database) {
  return {
    /**
     * Append a new prompt variant row and update the cached pointer on
     * `frames`. Returns the inserted row.
     *
     * Durability: the insert + update pair is sequential, not transactional —
     * the scoped-DB layer doesn't expose a transaction primitive yet. The
     * variant row is the source of truth; the cached column on `frames` is a
     * read-path optimization that can be reconciled from the latest variant
     * if a process crashes between the two writes.
     *
     * Caller responsibility: duplicate-detection — "what counts as a
     * meaningful change" varies (user-edit whitespace shouldn't create a
     * row; AI regeneration with identical output should). Skip the call if
     * the change is a no-op.
     */
    write: async (
      input: WriteFramePromptVariantInput
    ): Promise<FramePromptVariant> => {
      const cached = cachedColumnsForType(input.promptType);

      // Append first so a crash can't leave a stale pointer with no row
      // behind it. The reverse order would be unrecoverable.
      const [variant] = await db
        .insert(framePromptVariants)
        .values({
          frameId: input.frameId,
          promptType: input.promptType,
          text: input.text,
          components: input.components,
          parameters: input.parameters,
          source: input.source,
          inputHash: input.inputHash ?? null,
          analysisModel: input.analysisModel ?? null,
          createdBy: input.createdBy ?? null,
        })
        .returning();

      if (!variant) {
        throw new Error('Failed to insert frame prompt variant');
      }

      // User-edits clear the input hash on the cached pointer (the cached
      // value is no longer derived from upstream context). AI-generated /
      // regenerated rows set it.
      const nextHash =
        input.source === 'user-edit' ? null : (input.inputHash ?? null);

      await db
        .update(frames)
        .set({
          [cached.textKey]: input.text,
          [cached.hashKey]: nextHash,
          updatedAt: new Date(),
        })
        .where(eq(frames.id, input.frameId));

      return variant;
    },

    /** List the revision history for a frame's prompt, newest first. */
    listByFrame: async (
      frameId: string,
      promptType: FramePromptType
    ): Promise<FramePromptVariant[]> => {
      return await db
        .select()
        .from(framePromptVariants)
        .where(
          and(
            eq(framePromptVariants.frameId, frameId),
            eq(framePromptVariants.promptType, promptType)
          )
        )
        .orderBy(desc(framePromptVariants.createdAt));
    },

    /** Most recent variant of a given type, or null if none exists. */
    getLatest: async (
      frameId: string,
      promptType: FramePromptType
    ): Promise<FramePromptVariant | null> => {
      const [row] = await db
        .select()
        .from(framePromptVariants)
        .where(
          and(
            eq(framePromptVariants.frameId, frameId),
            eq(framePromptVariants.promptType, promptType)
          )
        )
        .orderBy(desc(framePromptVariants.createdAt))
        .limit(1);
      return row ?? null;
    },
  };
}
