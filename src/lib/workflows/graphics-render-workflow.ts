/**
 * Graphics render workflow — composites a frame's motion video with its
 * Hyperframes overlay list into a new MP4 (compositedVideoUrl).
 *
 * Runs on the Worker but delegates the actual Puppeteer/FFmpeg render to the
 * HYPERFRAMES_RENDER Durable Object + Container binding.
 */

import { generateId } from '@/lib/db/id';
import { buildFrameComposition } from '@/lib/hyperframes/compose';
import { renderComposition } from '@/lib/hyperframes/render-client';
import { getGenerationChannel } from '@/lib/realtime';
import { STORAGE_BUCKETS } from '@/lib/storage/buckets';
import { uploadResponse } from '@/lib/storage/upload-response';
import {
  getExtensionFromUrl,
  getMimeTypeFromExtension,
} from '@/lib/utils/file';
import { triggerWorkflow } from '@/lib/workflow/client';
import { WorkflowValidationError } from '@/lib/workflow/errors';
import { buildWorkflowLabel } from '@/lib/workflow/labels';
import { sanitizeFailResponse } from '@/lib/workflow/sanitize-fail-response';
import { createScopedWorkflow } from '@/lib/workflow/scoped-workflow';
import type {
  GraphicsRenderWorkflowInput,
  GraphicsRenderWorkflowResult,
  MergeVideoWorkflowInput,
} from '@/lib/workflow/types';

export const graphicsRenderWorkflow = createScopedWorkflow<
  GraphicsRenderWorkflowInput,
  GraphicsRenderWorkflowResult
>(
  async (context, scopedDb) => {
    const input = context.requestPayload;

    if (!input.frameId) {
      throw new WorkflowValidationError('frameId is required');
    }
    if (!input.videoUrl) {
      throw new WorkflowValidationError('videoUrl is required');
    }
    if (!input.sequenceId) {
      throw new WorkflowValidationError('sequenceId is required');
    }
    const { frameId, sequenceId, videoUrl, teamId, userId } = input;

    const frame = await context.run('load-frame', async () => {
      const row = await scopedDb.frames.getById(frameId);
      if (!row) {
        throw new WorkflowValidationError(`Frame ${frameId} not found`);
      }
      return row;
    });

    const overlays = frame.graphicsOverlays ?? [];
    if (overlays.length === 0) {
      // Nothing to composite — fall through so downstream stages use videoUrl as-is.
      return {
        compositedVideoUrl: videoUrl,
        compositedVideoPath: '',
      };
    }

    await context.run('set-rendering-status', async () => {
      await scopedDb.frames.updateCompositedVideoFields(frameId, {
        compositedVideoStatus: 'rendering',
        compositedVideoWorkflowRunId: context.workflowRunId,
        compositedVideoError: null,
      });

      void getGenerationChannel(sequenceId).emit(
        'generation.graphics:progress',
        {
          frameId,
          status: 'rendering',
        }
      );
    });

    const composition = buildFrameComposition({
      compositionId: `frame-${frameId}`,
      videoUrl,
      durationMs: input.durationMs,
      aspectRatio: input.aspectRatio,
      overlays,
    });

    const uploadResult = await context.run('render-and-upload', async () => {
      const { videoResponse } = await renderComposition({
        compositionId: `frame-${frameId}`,
        composition,
        routingKey: sequenceId,
        quality: input.quality,
      });

      const extension = getExtensionFromUrl(videoUrl) || 'mp4';
      const contentType = getMimeTypeFromExtension(extension);
      const shortHash = generateId().slice(-8);
      const path = `teams/${teamId}/sequences/${sequenceId}/frames/${frameId}/composited/${shortHash}.${extension}`;

      const result = await uploadResponse(
        videoResponse,
        STORAGE_BUCKETS.VIDEOS,
        path,
        { contentType }
      );

      return { path, url: result.publicUrl };
    });

    await context.run('update-frame-composited', async () => {
      await scopedDb.frames.updateCompositedVideoFields(frameId, {
        compositedVideoStatus: 'completed',
        compositedVideoUrl: uploadResult.url,
        compositedVideoPath: uploadResult.path,
        compositedVideoGeneratedAt: new Date(),
        compositedVideoError: null,
      });

      void getGenerationChannel(sequenceId).emit(
        'generation.graphics:progress',
        {
          frameId,
          status: 'completed',
          compositedVideoUrl: uploadResult.url,
        }
      );
    });

    // If this was the last frame waiting on motion graphics, trigger the
    // sequence-level merge workflow now.
    await context.run('check-merge-trigger', async () => {
      if (!teamId || !userId) return;

      const allFrames = await scopedDb.frames.listBySequence(sequenceId);
      if (allFrames.length === 0) return;
      if (!allFrames.every((f) => f.videoStatus === 'completed')) return;

      const stillWaiting = allFrames.some(
        (f) =>
          (f.graphicsOverlays?.length ?? 0) > 0 &&
          f.compositedVideoStatus !== 'completed' &&
          f.compositedVideoStatus !== 'failed'
      );
      if (stillWaiting) return;

      const videoUrls = allFrames
        .sort((a, b) => a.orderIndex - b.orderIndex)
        .map((f) =>
          f.compositedVideoStatus === 'completed' && f.compositedVideoUrl
            ? f.compositedVideoUrl
            : f.videoUrl
        )
        .filter((url): url is string => Boolean(url));

      if (videoUrls.length !== allFrames.length) return;

      const mergeInput: MergeVideoWorkflowInput = {
        userId,
        teamId,
        sequenceId,
        videoUrls,
      };

      await triggerWorkflow('/merge-video', mergeInput, {
        deduplicationId: `merge-${sequenceId}-${Date.now()}`,
        label: buildWorkflowLabel(sequenceId),
      });
    });

    return {
      compositedVideoUrl: uploadResult.url,
      compositedVideoPath: uploadResult.path,
    };
  },
  {
    failureFunction: async ({ context, scopedDb, failResponse }) => {
      const input = context.requestPayload;
      const error = sanitizeFailResponse(failResponse);

      if (input.frameId) {
        await scopedDb.frames.updateCompositedVideoFields(input.frameId, {
          compositedVideoStatus: 'failed',
          compositedVideoError: error,
        });
      }

      if (input.sequenceId && input.frameId) {
        try {
          void getGenerationChannel(input.sequenceId).emit(
            'generation.graphics:progress',
            { frameId: input.frameId, status: 'failed' }
          );
        } catch {
          // emit errors shouldn't mask the original failure
        }
      }

      console.error(
        `[GraphicsRenderWorkflow] Failed for frame ${input.frameId}: ${error}`
      );
      return `Graphics render failed for frame ${input.frameId}`;
    },
  }
);
