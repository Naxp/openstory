/**
 * Cloudflare Workflows port of `locationMatchingWorkflow`.
 *
 * Mirrors the QStash version (`src/lib/workflows/location-matching-workflow.ts`)
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
 * binds to Upstash's `WorkflowContext` (uses `context.run`, observability
 * headers, etc.) and has no CF equivalent yet. Until that helper grows a CF
 * code path, this workflow must be routed via QStash. See
 * docs/investigations/cloudflare-workflows-poc.md.
 *
 * This workflow does not invoke any child workflows — the QStash version is
 * a leaf orchestrator that runs a single LLM call and assembles matches.
 * No `spawnAndAwaitChild` is needed.
 *
 * The QStash version stays as-is — both run side by side until
 * `engine-registry.ts` flips `location-matching` to `'cloudflare'`.
 */

import type { ScopedDb } from '@/lib/db/scoped';
import { getGenerationChannel } from '@/lib/realtime';
import { OpenStoryWorkflowEntrypoint } from '@/lib/workflow/cf/base-workflow';
import type {
  LibraryLocationMatch,
  LocationMatchingWorkflowInput,
  LocationMatchingWorkflowOutput,
} from '@/lib/workflow/types';
import type { WorkflowEvent, WorkflowStep } from 'cloudflare:workers';
import { NonRetryableError } from 'cloudflare:workflows';

type LocationMatchEntry = {
  libraryLocationId: string;
  locationId: string;
  confidence: number;
};

export class LocationMatchingWorkflow extends OpenStoryWorkflowEntrypoint<LocationMatchingWorkflowInput> {
  protected override async runImpl(
    event: Readonly<WorkflowEvent<LocationMatchingWorkflowInput>>,
    step: WorkflowStep,
    scopedDb: ScopedDb
  ): Promise<LocationMatchingWorkflowOutput> {
    const input = event.payload;
    const { suggestedLocationIds, sequenceId } = input;

    const locationBible = input.locationBible;

    // Location matching (conditional) — DB read to resolve suggested library
    // locations. When no suggestions are present, short-circuit to an empty
    // list so we never run the LLM step.
    const { libraryLocationList } = await step.do(
      'get-library-locations',
      async () => {
        if (!suggestedLocationIds?.length || !input.teamId) {
          return { libraryLocationList: [] };
        }
        const libraryLocationList =
          await scopedDb.locations.getByIds(suggestedLocationIds);
        return { libraryLocationList };
      }
    );

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
    const locationMatches: LocationMatchEntry[] =
      libraryLocationList.length > 0
        ? await step.do(
            'location-matching',
            async (): Promise<LocationMatchEntry[]> => {
              throw new NonRetryableError(
                'Child invocation pending Pattern 3 batch; route this workflow via QStash',
                'WorkflowValidationError'
              );
            }
          )
        : [];

    const libraryLocationMatches: LibraryLocationMatch[] = await step.do(
      'build-location-matches',
      async () => {
        const usedLibraryIds = new Set<string>();
        const usedLocationIds = new Set<string>();
        const matches: LibraryLocationMatch[] = [];

        for (const match of locationMatches) {
          if (usedLibraryIds.has(match.libraryLocationId)) continue;
          if (usedLocationIds.has(match.locationId)) continue;
          if (match.confidence < 0.5) continue;

          const libraryLoc = libraryLocationList.find(
            (lib) => lib.id === match.libraryLocationId
          );
          if (!libraryLoc?.referenceImageUrl) continue;

          const location = locationBible.find(
            (loc) => loc.locationId === match.locationId
          );
          if (!location) continue;

          usedLibraryIds.add(match.libraryLocationId);
          usedLocationIds.add(match.locationId);
          matches.push({
            locationId: match.locationId,
            libraryLocationId: match.libraryLocationId,
            libraryLocationName: libraryLoc.name,
            referenceImageUrl: libraryLoc.referenceImageUrl,
            description: libraryLoc.description ?? undefined,
          });
        }

        if (matches.length > 0 && sequenceId) {
          await getGenerationChannel(sequenceId).emit(
            'generation.location:matched',
            {
              matches: matches.map((m) => {
                const loc = locationBible.find(
                  (l) => l.locationId === m.locationId
                );
                return {
                  locationId: m.locationId,
                  locationName: loc?.name ?? m.locationId,
                  libraryLocationId: m.libraryLocationId,
                  libraryLocationName: m.libraryLocationName,
                  referenceImageUrl: m.referenceImageUrl,
                  description: m.description ?? undefined,
                };
              }),
            }
          );
        }

        return matches;
      }
    );

    console.log(
      '[LocationMatchingWorkflow:cf]',
      `Resolved ${libraryLocationMatches.length} library location match(es) for sequence ${sequenceId ?? '(none)'}`
    );

    return {
      matches: libraryLocationMatches,
    };
  }

  protected override async onFailure({
    event,
    error,
  }: {
    event: Readonly<WorkflowEvent<LocationMatchingWorkflowInput>>;
    error: string;
    scopedDb: ScopedDb;
  }): Promise<void> {
    const input = event.payload;
    console.error(
      '[LocationMatchingWorkflow:cf]',
      `Location matching failed for sequence ${input.sequenceId ?? '(none)'}: ${error}`
    );
  }
}
