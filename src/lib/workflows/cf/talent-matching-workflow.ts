/**
 * Cloudflare Workflows port of `talentMatchingWorkflow`.
 *
 * Mirrors the QStash version (`src/lib/workflows/talent-matching-workflow.ts`)
 * step for step — same step names, same control flow, same side effects. The
 * only differences are:
 *
 *   - Extends `OpenStoryWorkflowEntrypoint` instead of being built by
 *     `createScopedWorkflow`. Failure parity comes from the base class
 *     (see `cf/base-workflow.ts`).
 *   - Uses `step.do` instead of `context.run`.
 *   - Reads payload from `event.payload` instead of `context.requestPayload`.
 *
 * NOTE: the LLM step is stubbed pending Pattern 3 batch — `durableLLMCall`
 * takes an Upstash `WorkflowContext` and is not yet portable to a
 * Cloudflare `WorkflowStep`. Until that helper grows a CF code path, this
 * workflow must be routed via QStash. See
 * docs/investigations/cloudflare-workflows-poc.md.
 *
 * The QStash version stays as-is — both run side by side until
 * `engine-registry.ts` flips `talent-matching` to `'cloudflare'`.
 */

import { buildMatchingPromptVariables } from '@/lib/ai/talent-matching-prompt';
import type { ScopedDb } from '@/lib/db/scoped';
import { getGenerationChannel } from '@/lib/realtime';
import { OpenStoryWorkflowEntrypoint } from '@/lib/workflow/cf/base-workflow';
import type {
  TalentCharacterMatch,
  TalentMatchingWorkflowInput,
  TalentMatchingWorkflowOutput,
} from '@/lib/workflow/types';
import type { WorkflowEvent, WorkflowStep } from 'cloudflare:workers';
import { NonRetryableError } from 'cloudflare:workflows';

export class TalentMatchingWorkflow extends OpenStoryWorkflowEntrypoint<TalentMatchingWorkflowInput> {
  protected override async runImpl(
    event: Readonly<WorkflowEvent<TalentMatchingWorkflowInput>>,
    step: WorkflowStep,
    scopedDb: ScopedDb
  ): Promise<TalentMatchingWorkflowOutput> {
    const input = event.payload;
    const { suggestedTalentIds, sequenceId } = input;

    // Use pre-extracted bible from scene splitting (always provided by upstream)
    const characterBible = input.characterBible;

    // Talent matching is conditional and does NOT block on talent sheets:
    // it only runs against pre-selected talent IDs. Characters without a
    // pre-cast talent are auto-extracted later in the pipeline and given
    // AI-generated portraits — script generation never waits for sheets.
    const { talentList } = await step.do('get-talent-list', async () => {
      if (!suggestedTalentIds?.length || !input.teamId) {
        return { talentList: [], matchingPromptVariables: {} };
      }
      const talentList = await scopedDb.talent.getByIds(suggestedTalentIds);
      return {
        talentList,
        matchingPromptVariables: buildMatchingPromptVariables(
          characterBible,
          talentList
        ),
      };
    });

    // `durableLLMCall` is the QStash-flavored LLM step from
    // `src/lib/workflows/llm-call-helper.ts`. It binds to Upstash's
    // `WorkflowContext` (uses `context.run`, observability headers, etc.)
    // and has no CF equivalent yet — porting it is the Pattern 3 batch.
    // Until then we surface a non-retryable validation error so the
    // dispatcher falls back to QStash and the instance fails fast on CF.
    // Use CF's `NonRetryableError` directly so the step machinery doesn't
    // retry the stub up to 5×. `WorkflowValidationError` would also surface
    // as non-retryable at the runImpl boundary (the base class re-wraps),
    // but only AFTER the step has burned its retry budget.
    const { matches: talentMatches } =
      talentList.length > 0
        ? await step.do(
            'talent-matching',
            async (): Promise<{
              matches: Array<{ characterId: string; talentId: string }>;
            }> => {
              throw new NonRetryableError(
                'Child invocation pending Pattern 3 batch; route this workflow via QStash',
                'WorkflowValidationError'
              );
            }
          )
        : { matches: [] };

    const talentCharacterMatches: TalentCharacterMatch[] = await step.do(
      'build-matches',
      async () => {
        const usedTalentIds = new Set<string>();
        const matches: TalentCharacterMatch[] = [];

        for (const match of talentMatches) {
          // Ensure each talent is only cast once (but characters can have multiple talents
          // when there are more talents than characters)
          if (usedTalentIds.has(match.talentId)) {
            console.warn(
              `[TalentMatchingWorkflow:cf] Skipping duplicate talent ${match.talentId}`
            );
            continue;
          }

          const talent = talentList.find((t) => t.id === match.talentId);
          if (!talent) {
            console.warn(
              `[TalentMatchingWorkflow:cf] Talent ${match.talentId} not found in list`
            );
            continue;
          }

          const character = characterBible.find(
            (c) => c.characterId === match.characterId
          );
          if (!character) {
            console.warn(
              `[TalentMatchingWorkflow:cf] Character ${match.characterId} not found in bible`
            );
            continue;
          }

          usedTalentIds.add(match.talentId);
          matches.push({
            characterId: match.characterId,
            talentId: match.talentId,
            talentName: talent.name,
            sheetImageUrl: talent.defaultSheet?.imageUrl ?? '',
            sheetMetadata: talent.defaultSheet?.metadata ?? undefined,
          });
        }

        if (matches.length > 0) {
          await getGenerationChannel(sequenceId).emit(
            'generation.talent:matched',
            {
              matches: matches.map((m) => {
                const char = characterBible.find(
                  (c) => c.characterId === m.characterId
                );
                return {
                  characterId: m.characterId,
                  characterName: char?.name ?? m.characterId,
                  talentId: m.talentId,
                  talentName: m.talentName,
                };
              }),
            }
          );
        }

        return matches;
      }
    );

    return {
      matches: talentCharacterMatches,
    };
  }
}
