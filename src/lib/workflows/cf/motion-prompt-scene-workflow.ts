/**
 * Cloudflare Workflows port of `motionPromptSceneWorkflow`.
 *
 * Mirrors the QStash version (`src/lib/workflows/motion-prompt-scene-workflow.ts`)
 * step for step — same step names, same control flow, same side effects. The
 * only differences are:
 *
 *   - Extends `OpenStoryWorkflowEntrypoint` instead of being built by
 *     `createScopedWorkflow`. Failure parity comes from the base class
 *     (see `cf/base-workflow.ts`).
 *   - Uses `step.do` instead of `context.run`.
 *   - Reads payload from `event.payload` instead of `context.requestPayload`.
 *   - The streaming LLM call (`durableStreamingLLMCall`) still requires the
 *     QStash `WorkflowContext` — until the helper is ported in the
 *     Pattern 3 batch, the LLM step throws `WorkflowValidationError` so
 *     callers stay routed through QStash via `engine-registry.ts`.
 *
 * The QStash version stays as-is — both run side by side until
 * `engine-registry.ts` flips `motion-prompt-scene` to `'cloudflare'`. See
 * docs/investigations/cloudflare-workflows-poc.md.
 */

import { computeMotionPromptInputHash } from '@/lib/ai/input-hash';
import { narrowFramePromptContext } from '@/lib/ai/prompt-context';
import type { MotionPrompt } from '@/lib/ai/scene-analysis.schema';
import type { ScopedDb } from '@/lib/db/scoped';
import { getFramePromptChannel, getGenerationChannel } from '@/lib/realtime';
import { OpenStoryWorkflowEntrypoint } from '@/lib/workflow/cf/base-workflow';
import { WorkflowValidationError } from '@/lib/workflow/errors';
import type { MotionPromptSceneWorkflowInput } from '@/lib/workflow/types';
import type { WorkflowEvent, WorkflowStep } from 'cloudflare:workers';

type MotionPromptSceneWorkflowResult = {
  sceneId: string;
  motionPrompt: MotionPrompt;
};

export class MotionPromptSceneWorkflow extends OpenStoryWorkflowEntrypoint<MotionPromptSceneWorkflowInput> {
  protected override async runImpl(
    event: Readonly<WorkflowEvent<MotionPromptSceneWorkflowInput>>,
    step: WorkflowStep,
    scopedDb: ScopedDb
  ): Promise<MotionPromptSceneWorkflowResult> {
    const input = event.payload;
    const {
      scene,
      sceneBefore,
      sceneAfter,
      aspectRatio,
      characterBible,
      locationBible,
      elementBible = [],
      styleConfig,
      analysisModelId,
      sequenceId,
      frameId,
    } = input;

    // ============================================================
    // PHASE 3: Motion Prompt Generation (using durableLLMCall helper)
    // ============================================================

    await step.do('prepare-motion-prompt-generation', async () => {
      console.log(
        `[MotionPromptSceneWorkflow:cf] Generating motion prompt for scene ${scene.sceneId}`
      );
      return {
        promptVariables: {
          sceneBefore: sceneBefore
            ? JSON.stringify(sceneBefore, null, 2)
            : '(none)',
          sceneAfter: sceneAfter
            ? JSON.stringify(sceneAfter, null, 2)
            : '(none)',
          scene: JSON.stringify(scene, null, 2),
          characterBible: JSON.stringify(characterBible, null, 2),
          locationBible: JSON.stringify(locationBible, null, 2),
          elementBible: JSON.stringify(elementBible, null, 2),
          styleConfig: JSON.stringify(styleConfig, null, 2),
          aspectRatio,
        },
        additionalMetadata: { frameId },
      };
    });

    // `durableStreamingLLMCall` is bound to the QStash `WorkflowContext` and
    // has not been ported yet. Stub the LLM step so the engine registry keeps
    // this workflow on QStash until the Pattern 3 batch lands a CF-native
    // helper.
    const motionPrompt: MotionPrompt = await step.do(
      'motion-prompts',
      async () => {
        throw new WorkflowValidationError(
          'Child invocation pending Pattern 3 batch; route this workflow via QStash'
        );
      }
    );

    if (sequenceId && frameId) {
      if (!motionPrompt.fullPrompt) {
        throw new Error(
          `Motion prompt generation returned empty fullPrompt for scene ${scene.sceneId}`
        );
      }

      // Hash inputs are narrowed by the scene's continuity (populated upstream
      // by the visual-prompt workflow) so unreferenced entities don't poison
      // the stored hash.
      const narrowed = narrowFramePromptContext({
        scene,
        styleConfig,
        characterBible,
        locationBible,
        elementBible,
        aspectRatio,
        analysisModel: analysisModelId,
      });
      const inputHash = await computeMotionPromptInputHash(narrowed);

      const enrichedScene = {
        ...scene,
        prompts: {
          ...scene.prompts,
          motion: motionPrompt,
        },
      };

      await step.do('save-motion-prompt-to-db', async () => {
        const previous = await scopedDb.framePromptVariants.getLatest(
          frameId,
          'motion'
        );
        const source = previous ? 'regenerated' : 'ai-generated';

        // Clear `frame.motionPrompt` user-override when regenerating; see
        // the matching note in visual-prompt-scene-workflow.ts. The variant
        // row below preserves the new prompt; the prior user override is
        // restorable from the prompt-history sheet.
        await scopedDb.frames.update(frameId, {
          metadata: enrichedScene,
          motionPrompt: null,
        });

        await scopedDb.framePromptVariants.write({
          frameId,
          promptType: 'motion',
          text: motionPrompt.fullPrompt,
          components: motionPrompt.components,
          parameters: motionPrompt.parameters,
          source,
          inputHash,
          analysisModel: analysisModelId,
        });

        await getGenerationChannel(sequenceId).emit(
          'generation.frame:updated',
          {
            frameId,
            updateType: 'motion-prompt',
            metadata: enrichedScene,
          }
        );

        if (input.emitStreaming) {
          await getFramePromptChannel(frameId).emit('framePrompt.completed', {
            promptType: 'motion',
          });
        }
      });
    }
    return { sceneId: scene.sceneId, motionPrompt };
  }

  protected override async onFailure({
    event,
    error,
  }: {
    event: Readonly<WorkflowEvent<MotionPromptSceneWorkflowInput>>;
    error: string;
    scopedDb: ScopedDb;
  }): Promise<void> {
    console.error('[MotionPromptSceneWorkflow:cf] Failed', { error });
    try {
      const payload = event.payload;
      if (payload.emitStreaming && payload.frameId) {
        await getFramePromptChannel(payload.frameId).emit(
          'framePrompt.failed',
          { promptType: 'motion', error }
        );
      }
    } catch (emitErr) {
      console.warn(
        '[MotionPromptSceneWorkflow:cf] failed to emit failure',
        emitErr
      );
    }
  }
}
