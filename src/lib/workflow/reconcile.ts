/**
 * Lazy reconciliation for stale frame statuses.
 *
 * When frames are stuck in 'generating' for >5 minutes, we check QStash
 * to see if the workflow actually finished (success/fail/canceled).
 * If so, we update the DB to reflect reality.
 *
 * Called as fire-and-forget when frames are loaded — doesn't block responses.
 *
 * See `reconcile-all.ts` for the broad cron-driven sweep that covers every
 * status-bearing table (frame variants, sequence video variants, sequences,
 * sequence elements) and runs on a schedule rather than on user load.
 */

import type { Frame } from '@/lib/db/schema';
import { getWorkflowClient } from './client';
import type { WorkflowRunState } from './status';

export const STALE_THRESHOLD_MS = 5 * 60 * 1000;

type StatusField =
  | 'thumbnailStatus'
  | 'videoStatus'
  | 'variantImageStatus'
  | 'audioStatus';

type RunIdField =
  | 'thumbnailWorkflowRunId'
  | 'videoWorkflowRunId'
  | 'variantWorkflowRunId'
  | 'audioWorkflowRunId';

const STATUS_TO_RUN_ID_FIELD: Record<StatusField, RunIdField> = {
  thumbnailStatus: 'thumbnailWorkflowRunId',
  videoStatus: 'videoWorkflowRunId',
  variantImageStatus: 'variantWorkflowRunId',
  audioStatus: 'audioWorkflowRunId',
};

const STATUS_FIELDS: StatusField[] = [
  'thumbnailStatus',
  'videoStatus',
  'variantImageStatus',
  'audioStatus',
];

type FrameUpdater = {
  update: (
    frameId: string,
    data: Record<string, string | Date>,
    options?: { throwOnMissing?: boolean }
  ) => Promise<Frame | undefined>;
};

/**
 * Resolve a stale workflow run via QStash.
 *
 * Returns:
 *   - 'failed'    when the runId is empty (workflow was never tracked) or
 *                 QStash reports RUN_FAILED / RUN_CANCELED
 *   - 'completed' on RUN_SUCCESS
 *   - null        when the row should be left alone:
 *                   • RUN_STARTED (still running)
 *                   • QStash returned an empty `runs` array (could be a
 *                     transient blip or a not-yet-logged run — being
 *                     conservative beats falsely marking a healthy row failed)
 *                   • the QStash call threw (errors logged, not propagated,
 *                     so the cron stays best-effort)
 *
 * Callers should treat `null` as "skip and retry next sweep."
 */
export async function resolveRunState(
  runId: string
): Promise<'failed' | 'completed' | null> {
  if (runId === '') return 'failed';

  try {
    const client = getWorkflowClient();
    const { runs } = await client.logs({ workflowRunId: runId, count: 1 });
    const run = runs[0];

    // oxlint-disable-next-line typescript-eslint/no-unnecessary-condition -- runtime guard: SDK type promises non-empty, but a transient API response with `runs: []` would silently mark a healthy row failed.
    if (!run) return null;

    const state: WorkflowRunState = run.workflowState;
    if (state === 'RUN_FAILED' || state === 'RUN_CANCELED') return 'failed';
    if (state === 'RUN_SUCCESS') return 'completed';
    return null;
  } catch (error) {
    console.error(
      `[reconcile] Failed to check workflow ${runId}:`,
      error instanceof Error ? error.message : error
    );
    return null;
  }
}

/**
 * Check frames stuck in 'generating' for >5 minutes against QStash.
 * If the workflow is no longer running, mark the frame as 'failed' or
 * 'completed' to match QStash truth.
 *
 * @param frameList - frames to check
 * @param framesDb - scopedDb.frames (or equivalent with .update method)
 */
export async function reconcileStaleFrameStatuses(
  frameList: Frame[],
  framesDb: FrameUpdater
): Promise<void> {
  const now = Date.now();

  const staleEntries: Array<{ frame: Frame; field: StatusField }> = [];

  for (const frame of frameList) {
    if (now - frame.updatedAt.getTime() < STALE_THRESHOLD_MS) continue;

    for (const field of STATUS_FIELDS) {
      if (frame[field] === 'generating') {
        staleEntries.push({ frame, field });
      }
    }
  }

  if (staleEntries.length === 0) return;

  for (const { frame, field } of staleEntries) {
    const runId = frame[STATUS_TO_RUN_ID_FIELD[field]] ?? '';
    const next = await resolveRunState(runId);
    if (next === null) continue;

    await framesDb.update(
      frame.id,
      { [field]: next, updatedAt: new Date() },
      { throwOnMissing: false }
    );
  }
}
