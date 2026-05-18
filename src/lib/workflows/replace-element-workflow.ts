/**
 * Replace Element Workflow
 *
 * Per-frame edits a sequence element across all affected frames using an
 * image edit endpoint. Unlike character/location recast (which fully
 * regenerates the frame), this swaps just the element while keeping the
 * rest of the frame intact.
 *
 * Steps:
 * 1. Re-run vision analysis on the new element image so token gets fresh
 *    description + consistencyTag (used by future scene generations).
 * 2. For each affected frame, invoke `image-workflow` with the existing
 *    frame thumbnail as PRIMARY SOURCE and the new element image as
 *    ELEMENT REF — the model edits the frame to swap the element.
 */

import { describeElementImage } from '@/lib/ai/element-vision';
import {
  DEFAULT_IMAGE_MODEL,
  safeTextToImageModel,
  supportsReferenceImages,
} from '@/lib/ai/models';
import { aspectRatioToImageSize } from '@/lib/constants/aspect-ratios';
import type { ElementVisionStatus } from '@/lib/db/schema';
import { getGenerationChannel } from '@/lib/realtime';
import { buildWorkflowLabel } from '@/lib/workflow/labels';
import { sanitizeFailResponse } from '@/lib/workflow/sanitize-fail-response';
import { createScopedWorkflow } from '@/lib/workflow/scoped-workflow';
import type {
  ImageWorkflowInput,
  ReplaceElementWorkflowInput,
  ReplaceElementWorkflowResult,
} from '@/lib/workflow/types';
import { getFalFlowControl } from './constants';
import { generateImageWorkflow } from './image-workflow';

export type FrameResult =
  | { frameId: string; success: true; imageUrl: string }
  | { frameId: string; success: false; error: string };

export type BatchOutcome =
  | { kind: 'complete'; successCount: number; failedCount: number }
  | { kind: 'fail'; sampleReason: string; total: number };

/**
 * Pure decision: given per-frame results, should the workflow emit `:complete`
 * or throw to trigger `failureFunction`? Skipped-deleted frames never enter
 * `results` so they don't count against the success floor.
 */
export function decideBatchOutcome(results: FrameResult[]): BatchOutcome {
  const successCount = results.filter((r) => r.success).length;
  const failedCount = results.length - successCount;
  if (results.length === 0) {
    return { kind: 'complete', successCount: 0, failedCount: 0 };
  }
  if (successCount === 0) {
    const firstFailure = results.find((r) => !r.success);
    const sampleReason =
      firstFailure && !firstFailure.success
        ? firstFailure.error
        : 'image edit failed';
    return { kind: 'fail', sampleReason, total: results.length };
  }
  return { kind: 'complete', successCount, failedCount };
}

/**
 * Pure decision: when the workflow's `failureFunction` fires, should the
 * element's `visionStatus` be downgraded to `'failed'`? Only when vision was
 * still in flight — if vision already succeeded, the failure was in a per-
 * frame edit and downgrading would mislead the element card into showing
 * "vision failed".
 */
export function shouldDowngradeVisionOnFailure(
  current: ElementVisionStatus
): boolean {
  return current !== 'completed';
}

/**
 * Best-effort string extraction from a `Promise.allSettled` rejection reason.
 * Errors thrown by application code are usually `Error`, but third-party
 * SDKs and async helpers can reject with strings, plain objects, or
 * DOMException-like values; serializing those preserves the production
 * trail instead of collapsing to a literal `'unknown'`.
 */
export function rejectionReasonMessage(reason: unknown): string {
  if (reason instanceof Error) return reason.message;
  if (typeof reason === 'string') return reason;
  try {
    const json = JSON.stringify(reason);
    if (json && json !== '{}') return json;
  } catch {
    // Circular references etc. fall through to the typeof tag.
  }
  return `non-error rejection (${typeof reason})`;
}

export function settledToResult(
  settled: PromiseSettledResult<FrameResult>,
  frameId: string | undefined
): FrameResult {
  if (settled.status === 'fulfilled') return settled.value;
  const message = rejectionReasonMessage(settled.reason);
  const id = frameId ?? 'unknown';
  console.error('[ReplaceElementWorkflow] Per-frame promise rejected', {
    frameId: id,
    reason: settled.reason,
  });
  return { frameId: id, success: false, error: message };
}

export function buildEditPrompt(args: {
  token: string;
  newDescription: string;
  previousDescription: string | null;
}): string {
  const previous = args.previousDescription
    ? ` (previously: ${args.previousDescription})`
    : '';
  return [
    `Edit the PRIMARY SOURCE image to replace the existing ${args.token} element${previous} with the new version shown in the ELEMENT REF image.`,
    `Render the new ${args.token} naturally where the old one appeared, matching scale, perspective, lighting, and occlusion of the original placement.`,
    `Keep all other content — characters, environment, framing, camera angle, color grading, and composition — exactly as they appear in the PRIMARY SOURCE. Only the ${args.token} element should change.`,
    args.newDescription
      ? `New element description: ${args.newDescription}`
      : '',
  ]
    .filter(Boolean)
    .join('\n\n');
}

/**
 * Emit a realtime event without letting transient Redis failures take down a
 * successful generation. The element card polls for the row's vision status,
 * so a dropped event degrades UX (no toast) but never blocks completion.
 */
async function safeEmit(
  sequenceId: string,
  label: string,
  fn: () => Promise<unknown> | null
): Promise<void> {
  try {
    await fn();
  } catch (e) {
    console.error(
      `[ReplaceElementWorkflow] emit ${label} for ${sequenceId} failed:`,
      e
    );
  }
}

export const replaceElementWorkflow = createScopedWorkflow<
  ReplaceElementWorkflowInput,
  ReplaceElementWorkflowResult
>(
  async (context, scopedDb) => {
    const input = context.requestPayload;
    const { sequenceId, elementId, token, affectedFrameIds, newImageUrl } =
      input;
    const label = buildWorkflowLabel(sequenceId);

    console.log(
      '[ReplaceElementWorkflow]',
      `Starting replace for element ${token} (${elementId}) — ${affectedFrameIds.length} affected frames`
    );

    // Fires before vision so subscribers see the full lifecycle even if
    // vision throws.
    await context.run('emit-start', () =>
      safeEmit(sequenceId, 'start', () =>
        getGenerationChannel(sequenceId).emit(
          'generation.replace-element:start',
          { elementId, frameCount: affectedFrameIds.length }
        )
      )
    );

    const visionResult = await context.run('describe-new-element', async () => {
      await scopedDb.sequenceElements.updateVisionStatus(
        elementId,
        'analyzing'
      );
      const openRouterApiKeyInfo =
        await scopedDb.apiKeys.resolveKey('openrouter');
      const result = await describeElementImage({
        imageUrl: newImageUrl,
        filename: input.newFilename,
        token,
        openRouterApiKey: openRouterApiKeyInfo.key,
      });
      await scopedDb.sequenceElements.updateVisionResult(
        elementId,
        result.description,
        result.consistencyTag
      );
      return result;
    });

    if (affectedFrameIds.length === 0) {
      await context.run('emit-complete-empty', () =>
        safeEmit(sequenceId, 'complete-empty', () =>
          getGenerationChannel(sequenceId).emit(
            'generation.replace-element:complete',
            { elementId, successCount: 0, failedCount: 0 }
          )
        )
      );
      return {
        elementId,
        successCount: 0,
        failedCount: 0,
      };
    }

    const sequence = await context.run('load-sequence', () =>
      scopedDb.sequences.getById(sequenceId)
    );
    if (!sequence) {
      throw new Error(
        `[ReplaceElementWorkflow] Sequence ${sequenceId} not found`
      );
    }

    const aspectRatio = sequence.aspectRatio;
    const imageModel = input.imageModel ?? DEFAULT_IMAGE_MODEL;

    // Frames captured at trigger time may have been deleted mid-flight. Treat
    // missing frames as skipped rather than aborting the whole batch.
    const liveFrames = await context.run('load-frames', () =>
      scopedDb.frames.getByIds(affectedFrameIds)
    );
    const liveFrameIds = new Set(liveFrames.map((f) => f.id));
    const skippedDeletedFrameIds = affectedFrameIds.filter(
      (id) => !liveFrameIds.has(id)
    );
    if (skippedDeletedFrameIds.length > 0) {
      console.warn(
        '[ReplaceElementWorkflow]',
        `Skipping ${skippedDeletedFrameIds.length} deleted frame(s): ${skippedDeletedFrameIds.join(', ')}`
      );
    }

    const editPrompt = buildEditPrompt({
      token,
      newDescription: visionResult.description,
      previousDescription: input.previousDescription,
    });

    // Parallel fan-out — flowControl + per-invoke retries handle backpressure.
    // `allSettled` so a per-frame throw (e.g. invoke rejection that bypasses
    // the isFailed/isCanceled return path) doesn't abort sibling frames.
    const settled = await Promise.allSettled(
      liveFrames.map(async (frame): Promise<FrameResult> => {
        const sourceImageUrl = frame.thumbnailUrl;
        if (!sourceImageUrl) {
          // Replacement is only meaningful when a primary thumbnail exists;
          // text-to-image regeneration would silently invent a frame from
          // prose alone.
          return {
            frameId: frame.id,
            success: false,
            error: 'no source thumbnail to edit',
          };
        }

        // Prefer the frame's own model when it supports edits, so the swap
        // reads as a continuation of the original render. Fall back to the
        // workflow's edit-capable default otherwise.
        const frameModel = safeTextToImageModel(
          frame.imageModel,
          DEFAULT_IMAGE_MODEL
        );
        const model = supportsReferenceImages(frameModel)
          ? frameModel
          : imageModel;

        const body: ImageWorkflowInput = {
          userId: input.userId,
          teamId: input.teamId,
          sequenceId,
          frameId: frame.id,
          prompt: editPrompt,
          model,
          imageSize: aspectRatioToImageSize(aspectRatio),
          numImages: 1,
          referenceImages: [
            {
              referenceImageUrl: sourceImageUrl,
              description: 'Existing frame to edit',
              role: 'primary',
            },
            {
              referenceImageUrl: newImageUrl,
              description: `${token} - ${visionResult.description}`,
              role: 'element',
            },
          ],
        };

        const {
          body: invokeResult,
          isFailed,
          isCanceled,
        } = await context.invoke('image', {
          workflow: generateImageWorkflow,
          label,
          body,
          retries: 3,
          retryDelay: 'pow(2, retried) * 1000',
          flowControl: getFalFlowControl(),
        });

        // oxlint-disable-next-line typescript-eslint/no-unnecessary-condition -- runtime guard
        if (isFailed || isCanceled || !invokeResult?.imageUrl) {
          const reason = isCanceled
            ? 'canceled'
            : isFailed
              ? 'failed'
              : 'no imageUrl';
          console.error(
            '[ReplaceElementWorkflow]',
            `Image edit failed frame=${frame.id} reason=${reason}`
          );
          return {
            frameId: frame.id,
            success: false,
            error: `Image edit ${reason}`,
          };
        }

        return {
          frameId: frame.id,
          success: true,
          imageUrl: invokeResult.imageUrl,
        };
      })
    );

    const results: FrameResult[] = settled.map((s, i) =>
      settledToResult(s, liveFrames[i]?.id)
    );

    const outcome = decideBatchOutcome(results);
    if (outcome.kind === 'fail') {
      throw new Error(
        `[ReplaceElementWorkflow] All ${outcome.total} frame edit(s) failed for ${token}: ${outcome.sampleReason}`
      );
    }

    await context.run('emit-complete', () =>
      safeEmit(sequenceId, 'complete', () =>
        getGenerationChannel(sequenceId).emit(
          'generation.replace-element:complete',
          {
            elementId,
            successCount: outcome.successCount,
            failedCount: outcome.failedCount,
          }
        )
      )
    );

    console.log(
      '[ReplaceElementWorkflow]',
      `Completed: ${outcome.successCount} edited, ${outcome.failedCount} failed, ${skippedDeletedFrameIds.length} skipped-deleted for element ${token}`
    );

    return {
      elementId,
      successCount: outcome.successCount,
      failedCount: outcome.failedCount,
    };
  },
  {
    failureFunction: async ({ context, scopedDb, failResponse }) => {
      const input = context.requestPayload;
      const error = sanitizeFailResponse(failResponse);

      // The failure could be in vision (status still `analyzing`) or in a
      // per-frame edit (vision succeeded → status is `completed`). Only
      // downgrade in the first case; otherwise the element card would
      // mislead the user about which step failed.
      //
      // If reading the row throws (Turso blip), default to writing `failed`
      // anyway — better to mislabel as vision-failed than leave the row
      // stuck in `analyzing` forever (the whole point of this recovery).
      let shouldDowngrade = true;
      try {
        const current = await scopedDb.sequenceElements.getById(
          input.elementId
        );
        if (current) {
          shouldDowngrade = shouldDowngradeVisionOnFailure(
            current.visionStatus
          );
        }
      } catch (e) {
        console.error(
          '[ReplaceElementWorkflow] Failed to read current element status; assuming vision in-flight:',
          e
        );
      }

      if (shouldDowngrade) {
        try {
          await scopedDb.sequenceElements.updateVisionStatus(
            input.elementId,
            'failed',
            error
          );
        } catch (e) {
          console.error(
            '[ReplaceElementWorkflow] Failed to persist vision-failed status:',
            e
          );
        }
      }

      await safeEmit(input.sequenceId, 'failed', () =>
        getGenerationChannel(input.sequenceId).emit(
          'generation.replace-element:failed',
          { elementId: input.elementId, error }
        )
      );

      console.error(
        '[ReplaceElementWorkflow]',
        `Replace failed for element ${input.token}: ${error}`
      );

      return `Replace element failed for ${input.token}`;
    },
  }
);
