import { describe, expect, it } from 'vitest';
import type { ShotVariant } from '@/lib/db/schema';
import { computeSceneModelStatuses } from './scene-model-status';

/**
 * Scene-granular per-model status (#909): a model covers the SCENE only when it
 * has completed every shot in it; the scene's chosen model always reads `set`.
 */

const baseVariant: ShotVariant = {
  id: 'v',
  shotId: 's1',
  sequenceId: 'seq1',
  variantType: 'video',
  model: 'seedance_v2',
  url: 'https://r2/clip.mp4',
  storagePath: 'team/seq/clip.mp4',
  previewUrl: null,
  shotVariantUrl: null,
  shotVariantPath: null,
  shotVariantStatus: null,
  shotVariantWorkflowRunId: null,
  status: 'completed',
  workflowRunId: null,
  generatedAt: null,
  error: null,
  promptHash: null,
  inputHash: null,
  divergedAt: null,
  discardedAt: null,
  durationMs: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

function variant(overrides: Partial<ShotVariant>): ShotVariant {
  return { ...baseVariant, ...overrides };
}

function byFrame(variants: ShotVariant[]): Map<string, ShotVariant[]> {
  const map = new Map<string, ShotVariant[]>();
  for (const v of variants) {
    const list = map.get(v.shotId) ?? [];
    list.push(v);
    map.set(v.shotId, list);
  }
  return map;
}

describe('computeSceneModelStatuses', () => {
  it('marks the scene chosen model as set regardless of coverage', () => {
    const statuses = computeSceneModelStatuses({
      shots: [{ id: 's1' }],
      variantsByFrame: byFrame([]),
      setModel: 'seedance_v2',
    });
    expect(statuses.get('seedance_v2')).toBe('set');
  });

  it('reports completed only when a model covers every shot in the scene', () => {
    const shots = [{ id: 's1' }, { id: 's2' }];
    const statuses = computeSceneModelStatuses({
      shots,
      variantsByFrame: byFrame([
        variant({ id: 'a', shotId: 's1', model: 'kling_v3_pro' }),
        variant({ id: 'b', shotId: 's2', model: 'kling_v3_pro' }),
      ]),
      setModel: 'seedance_v2',
    });
    expect(statuses.get('kling_v3_pro')).toBe('completed');
  });

  it('reports generating for partial scene coverage', () => {
    const shots = [{ id: 's1' }, { id: 's2' }];
    const statuses = computeSceneModelStatuses({
      shots,
      variantsByFrame: byFrame([
        // Only one of the two shots done for this model.
        variant({ id: 'a', shotId: 's1', model: 'kling_v3_pro' }),
      ]),
      setModel: 'seedance_v2',
    });
    expect(statuses.get('kling_v3_pro')).toBe('generating');
  });

  it('reports generating when a shot row is in flight', () => {
    const statuses = computeSceneModelStatuses({
      shots: [{ id: 's1' }],
      variantsByFrame: byFrame([
        variant({
          id: 'a',
          shotId: 's1',
          model: 'kling_v3_pro',
          status: 'generating',
        }),
      ]),
      setModel: 'seedance_v2',
    });
    expect(statuses.get('kling_v3_pro')).toBe('generating');
  });

  it('reports failed when the only row failed', () => {
    const statuses = computeSceneModelStatuses({
      shots: [{ id: 's1' }],
      variantsByFrame: byFrame([
        variant({
          id: 'a',
          shotId: 's1',
          model: 'kling_v3_pro',
          status: 'failed',
        }),
      ]),
      setModel: 'seedance_v2',
    });
    expect(statuses.get('kling_v3_pro')).toBe('failed');
  });

  it('excludes divergent and discarded alternates', () => {
    const statuses = computeSceneModelStatuses({
      shots: [{ id: 's1' }],
      variantsByFrame: byFrame([
        variant({
          id: 'a',
          shotId: 's1',
          model: 'kling_v3_pro',
          divergedAt: new Date(),
        }),
        variant({
          id: 'b',
          shotId: 's1',
          model: 'wan_v2_5',
          discardedAt: new Date(),
        }),
      ]),
      setModel: 'seedance_v2',
    });
    // Both alternates are excluded, so neither model registers a status.
    expect(statuses.has('kling_v3_pro')).toBe(false);
    expect(statuses.has('wan_v2_5')).toBe(false);
  });
});
