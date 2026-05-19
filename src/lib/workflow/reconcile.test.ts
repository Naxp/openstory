/**
 * Tests for the lazy on-load reconciler. Covers the audio-pipeline branch
 * added alongside issue #727 and the basic per-state mapping.
 */

import { beforeEach, describe, expect, mock, test } from 'bun:test';
import type { Frame } from '@/lib/db/schema';
import type { WorkflowRunState } from './status';

type LogsResult = {
  runs: ReadonlyArray<{ workflowState: WorkflowRunState }>;
};

const logsMock = mock<
  (args: { workflowRunId: string; count: number }) => Promise<LogsResult>
>(async () => ({ runs: [] }));

mock.module('./client', () => ({
  getWorkflowClient: () => ({ logs: logsMock }),
}));

function makeFrame(overrides: Partial<Frame> = {}): Frame {
  const base: Frame = {
    id: 'frm_test',
    sequenceId: 'seq_test',
    orderIndex: 0,
    description: null,
    durationMs: 3000,
    thumbnailUrl: null,
    previewThumbnailUrl: null,
    thumbnailPath: null,
    variantImageUrl: null,
    variantImageStatus: 'pending',
    variantWorkflowRunId: null,
    variantImageGeneratedAt: null,
    variantImageError: null,
    videoUrl: null,
    videoPath: null,
    thumbnailStatus: 'pending',
    thumbnailWorkflowRunId: null,
    thumbnailGeneratedAt: null,
    thumbnailError: null,
    imageModel: 'test-model',
    imagePrompt: null,
    videoStatus: 'pending',
    videoWorkflowRunId: null,
    videoGeneratedAt: null,
    videoError: null,
    motionPrompt: null,
    motionModel: null,
    audioUrl: null,
    audioPath: null,
    audioStatus: 'pending',
    audioWorkflowRunId: null,
    audioGeneratedAt: null,
    audioError: null,
    audioModel: null,
    thumbnailInputHash: null,
    variantImageInputHash: null,
    videoInputHash: null,
    audioInputHash: null,
    visualPromptInputHash: null,
    motionPromptInputHash: null,
    metadata: null,
    createdAt: new Date(),
    updatedAt: new Date(Date.now() - 10 * 60 * 1000), // 10min old → stale
    ...overrides,
  };
  return base;
}

describe('resolveRunState', () => {
  beforeEach(() => {
    logsMock.mockReset();
  });

  test('returns "failed" when QStash reports RUN_CANCELED', async () => {
    logsMock.mockResolvedValueOnce({
      runs: [{ workflowState: 'RUN_CANCELED' }],
    });
    const { resolveRunState } = await import('./reconcile');
    expect(await resolveRunState('run_1')).toBe('failed');
  });

  test('returns "failed" when QStash reports RUN_FAILED', async () => {
    logsMock.mockResolvedValueOnce({ runs: [{ workflowState: 'RUN_FAILED' }] });
    const { resolveRunState } = await import('./reconcile');
    expect(await resolveRunState('run_2')).toBe('failed');
  });

  test('returns "completed" on RUN_SUCCESS', async () => {
    logsMock.mockResolvedValueOnce({
      runs: [{ workflowState: 'RUN_SUCCESS' }],
    });
    const { resolveRunState } = await import('./reconcile');
    expect(await resolveRunState('run_3')).toBe('completed');
  });

  test('returns null on RUN_STARTED (still running, leave alone)', async () => {
    logsMock.mockResolvedValueOnce({
      runs: [{ workflowState: 'RUN_STARTED' }],
    });
    const { resolveRunState } = await import('./reconcile');
    expect(await resolveRunState('run_4')).toBeNull();
  });

  test('returns null when QStash returns an empty runs array (safer: leave row alone)', async () => {
    // Conservative: an empty response could be a transient blip or a
    // not-yet-logged run. We'd rather skip and retry than falsely mark
    // a healthy row failed.
    logsMock.mockResolvedValueOnce({ runs: [] });
    const { resolveRunState } = await import('./reconcile');
    expect(await resolveRunState('run_5')).toBeNull();
  });

  test('returns "failed" when runId is empty (workflow was never tracked)', async () => {
    const { resolveRunState } = await import('./reconcile');
    expect(await resolveRunState('')).toBe('failed');
    expect(logsMock).not.toHaveBeenCalled();
  });

  test('swallows QStash errors and returns null (best-effort)', async () => {
    logsMock.mockRejectedValueOnce(new Error('network'));
    const { resolveRunState } = await import('./reconcile');
    expect(await resolveRunState('run_6')).toBeNull();
  });
});

describe('reconcileStaleFrameStatuses', () => {
  beforeEach(() => {
    logsMock.mockReset();
  });

  test('reconciles a stuck audio pipeline (new in #727)', async () => {
    logsMock.mockResolvedValueOnce({
      runs: [{ workflowState: 'RUN_CANCELED' }],
    });

    const updates: Array<{ id: string; data: Record<string, unknown> }> = [];
    const framesDb = {
      update: async (id: string, data: Record<string, unknown>) => {
        updates.push({ id, data });
        return undefined;
      },
    };

    const frame = makeFrame({
      audioStatus: 'generating',
      audioWorkflowRunId: 'wf_audio_1',
    });

    const { reconcileStaleFrameStatuses } = await import('./reconcile');
    await reconcileStaleFrameStatuses([frame], framesDb);

    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({
      id: frame.id,
      data: expect.objectContaining({ audioStatus: 'failed' }),
    });
  });

  test('skips frames that updated within the staleness window', async () => {
    const updates: Array<{ id: string; data: Record<string, unknown> }> = [];
    const framesDb = {
      update: async (id: string, data: Record<string, unknown>) => {
        updates.push({ id, data });
        return undefined;
      },
    };

    const fresh = makeFrame({
      thumbnailStatus: 'generating',
      thumbnailWorkflowRunId: 'wf_fresh',
      updatedAt: new Date(), // just updated → not stale
    });

    const { reconcileStaleFrameStatuses } = await import('./reconcile');
    await reconcileStaleFrameStatuses([fresh], framesDb);

    expect(updates).toHaveLength(0);
    expect(logsMock).not.toHaveBeenCalled();
  });

  test('leaves RUN_STARTED runs alone', async () => {
    logsMock.mockResolvedValueOnce({
      runs: [{ workflowState: 'RUN_STARTED' }],
    });

    const updates: Array<{ id: string; data: Record<string, unknown> }> = [];
    const framesDb = {
      update: async (id: string, data: Record<string, unknown>) => {
        updates.push({ id, data });
        return undefined;
      },
    };

    const frame = makeFrame({
      videoStatus: 'generating',
      videoWorkflowRunId: 'wf_running',
    });

    const { reconcileStaleFrameStatuses } = await import('./reconcile');
    await reconcileStaleFrameStatuses([frame], framesDb);

    expect(updates).toHaveLength(0);
  });

  test('reconciles all four pipelines on the same frame', async () => {
    logsMock.mockResolvedValue({ runs: [{ workflowState: 'RUN_CANCELED' }] });

    const updates: Array<{ id: string; data: Record<string, unknown> }> = [];
    const framesDb = {
      update: async (id: string, data: Record<string, unknown>) => {
        updates.push({ id, data });
        return undefined;
      },
    };

    const frame = makeFrame({
      thumbnailStatus: 'generating',
      thumbnailWorkflowRunId: 'wf_t',
      videoStatus: 'generating',
      videoWorkflowRunId: 'wf_v',
      variantImageStatus: 'generating',
      variantWorkflowRunId: 'wf_vi',
      audioStatus: 'generating',
      audioWorkflowRunId: 'wf_a',
    });

    const { reconcileStaleFrameStatuses } = await import('./reconcile');
    await reconcileStaleFrameStatuses([frame], framesDb);

    const updatedFields = updates.map((u) => Object.keys(u.data)[0]);
    expect(updatedFields).toEqual(
      expect.arrayContaining([
        'thumbnailStatus',
        'videoStatus',
        'variantImageStatus',
        'audioStatus',
      ])
    );
  });
});
