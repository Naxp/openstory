import { describe, expect, it } from 'vitest';
import type { FrameVariant } from '@/lib/db/schema';
import { computeSequenceModelCoverage } from './sequence-model-coverage';

/**
 * Tests for the header dropdowns' sequence-wide per-model coverage (#547):
 * "has this model generated across the whole sequence, and is it the primary".
 */

const baseVariant: FrameVariant = {
  id: 'v',
  frameId: 'f1',
  sequenceId: 'seq1',
  variantType: 'image',
  model: 'nano_banana_2',
  url: 'https://r2/img.png',
  storagePath: 'team/seq/img.png',
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

function variant(overrides: Partial<FrameVariant>): FrameVariant {
  return { ...baseVariant, ...overrides };
}

describe('computeSequenceModelCoverage', () => {
  it('marks the primary model as set and reports partial coverage for an added model', () => {
    const variants = [
      // Primary model: generated for all 3 frames.
      variant({ id: 'a1', frameId: 'f1', model: 'nano_banana_2' }),
      variant({ id: 'a2', frameId: 'f2', model: 'nano_banana_2' }),
      variant({ id: 'a3', frameId: 'f3', model: 'nano_banana_2' }),
      // Added model: generated for only 1 of the 3.
      variant({ id: 'b1', frameId: 'f1', model: 'flux_pro' }),
    ];

    const coverage = computeSequenceModelCoverage({
      variants,
      variantType: 'image',
      primaryModel: 'nano_banana_2',
    });

    expect(coverage.get('nano_banana_2')).toEqual({
      status: 'set',
      completed: 3,
      total: 3,
    });
    expect(coverage.get('flux_pro')).toEqual({
      status: 'completed',
      completed: 1,
      total: 3,
    });
  });

  it('reports generating when an added model has pending rows and nothing completed', () => {
    const variants = [
      variant({ id: 'a1', frameId: 'f1', model: 'nano_banana_2' }),
      variant({
        id: 'b1',
        frameId: 'f1',
        model: 'flux_pro',
        status: 'generating',
        url: null,
      }),
    ];

    const coverage = computeSequenceModelCoverage({
      variants,
      variantType: 'image',
      primaryModel: 'nano_banana_2',
    });

    expect(coverage.get('flux_pro')?.status).toBe('generating');
    expect(coverage.get('flux_pro')?.completed).toBe(0);
  });

  it('ignores divergent and discarded alternates', () => {
    const variants = [
      variant({ id: 'a1', frameId: 'f1', model: 'nano_banana_2' }),
      variant({
        id: 'd1',
        frameId: 'f1',
        model: 'flux_pro',
        divergedAt: new Date(),
      }),
      variant({
        id: 'x1',
        frameId: 'f2',
        model: 'flux_pro',
        discardedAt: new Date(),
      }),
    ];

    const coverage = computeSequenceModelCoverage({
      variants,
      variantType: 'image',
      primaryModel: 'nano_banana_2',
    });

    // flux_pro had only divergent/discarded rows → no live coverage.
    expect(coverage.get('flux_pro')).toBeUndefined();
    expect(coverage.get('nano_banana_2')?.total).toBe(1);
  });

  it('filters by variant type', () => {
    const variants = [
      variant({ id: 'a1', frameId: 'f1', variantType: 'image', model: 'm1' }),
      variant({ id: 'v1', frameId: 'f1', variantType: 'video', model: 'm1' }),
    ];

    const videoCoverage = computeSequenceModelCoverage({
      variants,
      variantType: 'video',
      primaryModel: null,
    });
    expect(videoCoverage.get('m1')).toEqual({
      status: 'completed',
      completed: 1,
      total: 1,
    });
  });

  it('returns an empty map for undefined variants', () => {
    expect(
      computeSequenceModelCoverage({
        variants: undefined,
        variantType: 'image',
      }).size
    ).toBe(0);
  });
});
