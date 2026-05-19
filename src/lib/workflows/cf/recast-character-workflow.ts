/**
 * Cloudflare Workflows port of `recastCharacterWorkflow`.
 *
 * Mirrors the QStash version (`src/lib/workflows/recast-character-workflow.ts`)
 * step for step — same step names, same control flow, same side effects.
 * The only differences are:
 *
 *   - Extends `OpenStoryWorkflowEntrypoint` instead of being built by
 *     `createScopedWorkflow`. Failure parity comes from the base class
 *     (see `cf/base-workflow.ts`).
 *   - Uses `step.do` instead of `context.run`.
 *   - Reads the workflow run id from `event.instanceId` instead of
 *     `context.workflowRunId` (not needed for this workflow, but listed
 *     here for parity with the other CF ports).
 *   - Calls the snapshot DTO computers directly instead of going through
 *     the `context.snapshot.*` extension.
 *   - The chained `character-sheet` and `regenerate-frames` child invocations
 *     are stubbed out pending Pattern 3 (fan-out helpers) — exercised in a
 *     later batch after all leaves are ported. The `build-regenerate-snapshot`
 *     step lives in `regenerateFramesIfNeeded` for diff parity with the
 *     QStash original; it becomes reachable once the sheet stub is replaced
 *     with a real child spawn.
 *
 * The QStash version stays as-is — both run side by side until
 * `engine-registry.ts` flips `recast-character` to `'cloudflare'`. See
 * docs/investigations/cloudflare-workflows-poc.md.
 */

import { DEFAULT_IMAGE_MODEL } from '@/lib/ai/models';
import type { ScopedDb } from '@/lib/db/scoped';
import { getGenerationChannel } from '@/lib/realtime';
import { OpenStoryWorkflowEntrypoint } from '@/lib/workflow/cf/base-workflow';
import { WorkflowValidationError } from '@/lib/workflow/errors';
import type {
  CharacterSheetWorkflowInput,
  RecastCharacterWorkflowInput,
  RegenerateFramesWorkflowInput,
} from '@/lib/workflow/types';
import {
  buildRegenerateFrameSnapshot,
  computeRegenerateFramesBatchHash,
} from '@/lib/workflows/regenerate-frames-snapshot';
import {
  computeCharacterSheetHashFromDto,
  resolveTalentSheetHash,
} from '@/lib/workflows/sheet-snapshots';
import type { WorkflowEvent, WorkflowStep } from 'cloudflare:workers';

type RecastCharacterWorkflowResult = {
  sheetImageUrl: string;
  framesRegenerated: number;
  framesFailed: number;
};

/**
 * Build the regenerate-frames snapshot and (eventually) invoke the
 * `regenerate-frames` child. Today this throws at the invoke site —
 * Pattern 3 will wire up the actual `context.invoke` equivalent.
 *
 * Lives in its own helper to mirror the QStash original's flow: snapshot
 * building runs as its own step before the child kicks off.
 */
async function regenerateFramesIfNeeded(
  step: WorkflowStep,
  scopedDb: ScopedDb,
  input: RecastCharacterWorkflowInput
): Promise<{ framesRegenerated: number; framesFailed: number }> {
  if (input.affectedFrameIds.length === 0) {
    return { framesRegenerated: 0, framesFailed: 0 };
  }

  const sequenceId = input.sequenceId;
  if (!sequenceId) {
    throw new WorkflowValidationError(
      '[RecastCharacterWorkflow:cf] sequenceId is required to regenerate frames'
    );
  }
  const imageModel = input.imageModel ?? DEFAULT_IMAGE_MODEL;

  await step.do(
    'build-regenerate-snapshot',
    async (): Promise<RegenerateFramesWorkflowInput> => {
      const sequence = await scopedDb.sequences.getById(sequenceId);
      if (!sequence) {
        throw new Error(
          `[RecastCharacterWorkflow:cf] Sequence ${sequenceId} not found`
        );
      }
      const [characters, locations, frames] = await Promise.all([
        scopedDb.characters.listWithSheets(sequenceId),
        scopedDb.sequenceLocations.listWithReferences(sequenceId),
        scopedDb.frames.getByIds(input.affectedFrameIds),
      ]);
      // Reject silent drops: getByIds returns only existing rows, so a
      // missing frame would shrink frameSnapshots below frameIds without
      // any signal. Surface the gap so the caller can fix data drift
      // instead of zero-counting frames that never ran.
      if (frames.length !== input.affectedFrameIds.length) {
        const found = new Set(frames.map((f) => f.id));
        const missing = input.affectedFrameIds.filter((id) => !found.has(id));
        throw new Error(
          `[RecastCharacterWorkflow:cf] Missing frames for ${input.characterName}: ${missing.join(', ')}`
        );
      }
      const aspectRatio = sequence.aspectRatio;
      const frameSnapshots = await Promise.all(
        frames.map((frame) =>
          buildRegenerateFrameSnapshot({
            frame,
            characters,
            locations,
            imageModel,
            aspectRatio,
          })
        )
      );
      const partial = {
        sequenceId,
        imageModel,
        aspectRatio,
        frameSnapshots,
      };
      const snapshotInputHash = await computeRegenerateFramesBatchHash(partial);
      return {
        userId: input.userId,
        teamId: input.teamId,
        sequenceId,
        frameIds: input.affectedFrameIds,
        triggerKind: 'character' as const,
        triggerId: input.characterDbId,
        imageModel,
        aspectRatio,
        frameSnapshots,
        snapshotInputHash,
      };
    }
  );

  // Stub for `regenerate-frames` child invocation. Pattern 3 will replace
  // this with the equivalent of context.invoke('regenerate-frames', { ... }).
  throw new WorkflowValidationError(
    'Child invocation pending Pattern 3 batch; route this workflow via QStash'
  );
}

export class RecastCharacterWorkflow extends OpenStoryWorkflowEntrypoint<RecastCharacterWorkflowInput> {
  protected override async runImpl(
    event: Readonly<WorkflowEvent<RecastCharacterWorkflowInput>>,
    step: WorkflowStep,
    scopedDb: ScopedDb
  ): Promise<RecastCharacterWorkflowResult> {
    const input = event.payload;

    // Step 1: Generate character sheet showing talent in costume.
    // Resolve the upstream talent-sheet hash and inline it so the child
    // workflow can detect divergence if the talent sheet is regenerated
    // mid-flight.
    await step.do(
      'build-character-sheet-snapshot',
      async (): Promise<CharacterSheetWorkflowInput> => {
        console.log(
          '[RecastCharacterWorkflow:cf]',
          `Starting recast for ${input.characterName} with ${input.affectedFrameIds.length} affected frames`
        );
        const talentSheetInputHash = await resolveTalentSheetHash(
          scopedDb,
          input.characterDbId
        );
        const partial: CharacterSheetWorkflowInput = {
          characterDbId: input.characterDbId,
          characterName: input.characterName,
          characterMetadata: input.characterMetadata,
          sequenceId: input.sequenceId,
          teamId: input.teamId,
          userId: input.userId,
          imageModel: input.imageModel,
          referenceImageUrl: input.referenceImageUrl,
          talentMetadata: input.talentMetadata,
          talentDescription: input.talentDescription,
          styleConfig: input.styleConfig,
          talentSheetInputHash,
        };
        partial.snapshotInputHash =
          await computeCharacterSheetHashFromDto(partial);
        return partial;
      }
    );

    // Stub for `character-sheet` child invocation. Pattern 3 will replace
    // this with the equivalent of context.invoke('character-sheet', { ... }).
    // The follow-on `regenerateFramesIfNeeded` call lives below (and is
    // unreachable today) so the structure mirrors the QStash original.
    throw new WorkflowValidationError(
      'Child invocation pending Pattern 3 batch; route this workflow via QStash'
    );

    // oxlint-disable no-unreachable -- gated by Pattern 3 stub above
    const sheetImageUrl = '';
    const { framesRegenerated, framesFailed } = await regenerateFramesIfNeeded(
      step,
      scopedDb,
      input
    );

    return { sheetImageUrl, framesRegenerated, framesFailed };
    // oxlint-enable no-unreachable
  }

  protected override async onFailure({
    event,
    error,
  }: {
    event: Readonly<WorkflowEvent<RecastCharacterWorkflowInput>>;
    error: string;
    scopedDb: ScopedDb;
  }): Promise<void> {
    const input = event.payload;

    await getGenerationChannel(input.sequenceId).emit(
      'generation.recast:failed',
      {
        characterId: input.characterDbId,
        error,
      }
    );

    console.error(
      '[RecastCharacterWorkflow:cf]',
      `Recast failed for ${input.characterName}: ${error}`
    );
  }
}
