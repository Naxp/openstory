/**
 * One-shot create orchestrator for `POST /api/v1/sequences`. Turns the public,
 * human-friendly input into a fully-resolved `CreateSequenceInput` and hands it
 * to the shared `createSequences` core:
 *
 *   enhance (optional) → resolve style/talent/location/elements →
 *   validate via createSequenceSchema → createSequences → response
 *
 * Returns the created sequence ids + workflow run ids (generation is async) and
 * the enhanced script when enhancement ran.
 */

import { enhanceScriptToString } from '@/functions/ai';
import { DEFAULT_ASPECT_RATIO } from '@/lib/constants/aspect-ratios';
import type { ScopedDb } from '@/lib/db/scoped';
import { createSequenceSchema } from '@/lib/schemas/sequence.schemas';
import { createSequences } from '@/lib/sequences/create-sequences';
import type { ApiCreateSequenceInput } from './input-schema';
import {
  ingestElements,
  resolveLocationIds,
  resolveStyle,
  resolveTalentIds,
} from './resolve';

export type OneShotContext = {
  scopedDb: ScopedDb;
  user: { id: string };
  teamId: string;
};

export type OneShotResult = {
  sequences: Array<{
    id: string;
    status: string;
    workflowRunId: string;
    statusUrl: string;
  }>;
  enhancedScript?: string;
};

export async function runOneShotCreate(
  input: ApiCreateSequenceInput,
  ctx: OneShotContext
): Promise<OneShotResult> {
  // 1. Optionally enhance the script to completion before generating.
  let script = input.script;
  let enhancedScript: string | undefined;
  if (input.enhance) {
    const result = await enhanceScriptToString(
      {
        script: input.script,
        targetDuration: input.targetSeconds,
        aspectRatio: input.aspectRatio,
      },
      { scopedDb: ctx.scopedDb, userId: ctx.user.id, teamId: ctx.teamId }
    );
    if (result.length > 0) {
      enhancedScript = result;
      script = result;
    }
  }

  // 2. Resolve references in parallel — style, cast, locations, elements.
  const [style, suggestedTalentIds, suggestedLocationIds, elementUploads] =
    await Promise.all([
      resolveStyle(ctx.scopedDb, input.style),
      resolveTalentIds(ctx.scopedDb, input.characters, input.createCharacters),
      resolveLocationIds(ctx.scopedDb, input.locations, input.createLocations),
      ingestElements(ctx.scopedDb, ctx.teamId, input.elements),
    ]);

  // 3. Assemble + validate the strict create input. createSequenceSchema applies
  //    model defaults and validates every model key, so an invalid model id
  //    surfaces as a 400 rather than a downstream throw.
  const parsed = createSequenceSchema.parse({
    title: input.title,
    script,
    styleId: style.id,
    // Mirror the new-sequence page: fall back to the style's recommended aspect
    // ratio when the caller doesn't pin one.
    aspectRatio:
      input.aspectRatio ?? style.defaultAspectRatio ?? DEFAULT_ASPECT_RATIO,
    analysisModels: input.analysisModels,
    imageModels: input.imageModels,
    videoModels: input.videoModels,
    autoGenerateMotion: input.motion,
    autoGenerateMusic: input.music,
    audioModels: input.audioModels,
    suggestedTalentIds: suggestedTalentIds.length
      ? suggestedTalentIds
      : undefined,
    suggestedLocationIds: suggestedLocationIds.length
      ? suggestedLocationIds
      : undefined,
    elementUploads: elementUploads.length ? elementUploads : undefined,
  });

  // 4. Run the shared create core (credits → fan-out → trigger storyboard).
  const { entries } = await createSequences(parsed, ctx);

  return {
    sequences: entries.map(({ sequence, workflowRunId }) => ({
      id: sequence.id,
      status: sequence.status,
      workflowRunId,
      statusUrl: `/api/v1/sequences/${sequence.id}`,
    })),
    enhancedScript,
  };
}
