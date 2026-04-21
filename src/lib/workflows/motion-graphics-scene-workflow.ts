/**
 * Motion Graphics Scene Workflow
 *
 * LLM pass: designs text/lower-third overlays for a single scene and
 * writes the result to `frame.graphicsOverlays`. The downstream
 * graphics-render-workflow composites them onto the motion video.
 */

import {
  motionGraphicsResponseSchema,
  normaliseOverlays,
} from '@/lib/hyperframes/motion-graphics.schema';
import type { FrameOverlay } from '@/lib/hyperframes/overlay.types';
import { createScopedWorkflow } from '@/lib/workflow/scoped-workflow';
import type { MotionGraphicsSceneWorkflowInput } from '@/lib/workflow/types';
import { durableLLMCall } from './llm-call-helper';

export const motionGraphicsSceneWorkflow = createScopedWorkflow<
  MotionGraphicsSceneWorkflowInput,
  { sceneId: string; overlays: FrameOverlay[] }
>(
  async (context, scopedDb) => {
    const input = context.requestPayload;
    const {
      scene,
      sceneBefore,
      characterBible,
      locationBible,
      styleConfig,
      analysisModelId,
      sequenceId,
      frameId,
      sceneDurationMs,
    } = input;

    console.log(
      `[MotionGraphicsSceneWorkflow] Designing overlays for scene ${scene.sceneId}`
    );

    const { promptVariables, additionalMetadata } = await context.run(
      'prepare-motion-graphics-design',
      async () => ({
        promptVariables: {
          sceneBefore: sceneBefore
            ? JSON.stringify(sceneBefore, null, 2)
            : '(none)',
          scene: JSON.stringify(scene, null, 2),
          characterBible: JSON.stringify(characterBible, null, 2),
          locationBible: JSON.stringify(locationBible, null, 2),
          styleConfig: JSON.stringify(styleConfig, null, 2),
          sceneDurationMs: String(sceneDurationMs),
        },
        additionalMetadata: { frameId },
      })
    );

    const response = await durableLLMCall(
      context,
      {
        name: 'motion-graphics',
        phase: { number: 5, name: 'Designing motion graphics…' },
        promptName: 'phase/motion-graphics-scene-generation-chat',
        promptVariables,
        modelId: analysisModelId,
        responseSchema: motionGraphicsResponseSchema,
        additionalMetadata,
      },
      { sequenceId, scopedDb }
    );

    const overlays = normaliseOverlays(
      response,
      scene.sceneId,
      sceneDurationMs
    );

    if (sequenceId && frameId && overlays.length > 0) {
      await context.run('save-graphics-overlays', async () => {
        await scopedDb.frames.updateGraphicsOverlays(frameId, overlays);
      });
    }

    return { sceneId: scene.sceneId, overlays };
  },
  {
    failureFunction: async () => {
      return `Motion graphics design failed`;
    },
  }
);
