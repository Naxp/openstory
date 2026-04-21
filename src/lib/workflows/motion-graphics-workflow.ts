/**
 * Motion Graphics Workflow
 *
 * Batch orchestrator: fans out per-scene motion-graphics design sub-workflows
 * in parallel, mirroring motion-prompt-workflow.
 */

import type { FrameOverlay } from '@/lib/hyperframes/overlay.types';
import { buildWorkflowLabel } from '@/lib/workflow/labels';
import { createScopedWorkflow } from '@/lib/workflow/scoped-workflow';
import type { MotionGraphicsDesignWorkflowInput } from '@/lib/workflow/types';
import { motionGraphicsSceneWorkflow } from './motion-graphics-scene-workflow';

export const motionGraphicsWorkflow = createScopedWorkflow<
  MotionGraphicsDesignWorkflowInput,
  { sceneId: string; overlays: FrameOverlay[] }[]
>(
  async (context, _scopedDb) => {
    const input = context.requestPayload;
    const {
      scenes,
      characterBible,
      locationBible,
      styleConfig,
      analysisModelId,
      frameMapping,
    } = input;

    const label = buildWorkflowLabel(input.sequenceId);

    console.log(
      `[MotionGraphicsWorkflow] Designing motion graphics for ${scenes.length} scenes`
    );

    const results = await Promise.all(
      scenes.map(async (scene, sceneIndex) => {
        const sceneBefore = sceneIndex > 0 ? scenes[sceneIndex - 1] : undefined;
        const sceneDurationMs = (scene.metadata?.durationSeconds ?? 5) * 1000;

        return await context.invoke('motion-graphics-scene', {
          workflow: motionGraphicsSceneWorkflow,
          label,
          body: {
            scene,
            sceneBefore,
            characterBible,
            locationBible,
            styleConfig,
            analysisModelId,
            teamId: input.teamId,
            userId: input.userId,
            sequenceId: input.sequenceId,
            frameId: frameMapping.find((f) => f.sceneId === scene.sceneId)
              ?.frameId,
            sceneDurationMs,
          },
        });
      })
    );

    return results.map((result) => {
      if (result.isFailed || result.isCanceled) {
        throw new Error('Motion graphics design failed');
      }
      return {
        sceneId: result.body.sceneId,
        overlays: result.body.overlays,
      };
    });
  },
  {
    failureFunction: async () => {
      return `Motion graphics design failed`;
    },
  }
);
