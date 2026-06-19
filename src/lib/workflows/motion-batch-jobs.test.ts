import { describe, expect, it } from 'vitest';
import { DEFAULT_VIDEO_MODEL, type ImageToVideoModel } from '@/lib/ai/models';
import {
  buildMotionJobs,
  groupShotsForRender,
  type RenderShot,
} from './motion-batch-jobs';

type Shot = { shotId: string; model?: ImageToVideoModel };

const A: ImageToVideoModel = 'kling_v3_pro';
const B: ImageToVideoModel = 'veo3_1';

const shots: Shot[] = [{ shotId: 'f0' }, { shotId: 'f1' }, { shotId: 'f2' }];

describe('buildMotionJobs', () => {
  it('expands each shot across every top-level video model (N×M jobs)', () => {
    const jobs = buildMotionJobs(shots, [A, B]);
    expect(jobs.length).toBe(shots.length * 2);
    // Shots keep their order; each shot gets one job per model.
    expect(jobs.map((j) => [j.shotIndex, j.model])).toEqual([
      [0, A],
      [0, B],
      [1, A],
      [1, B],
      [2, A],
      [2, B],
    ]);
    // The original shot object is carried through unchanged.
    expect(jobs[0]?.shot).toBe(shots[0]);
  });

  it('dedupes the top-level model list so a model is never billed twice per shot', () => {
    const oneShot: Shot[] = [{ shotId: 'f0' }];
    const jobs = buildMotionJobs(oneShot, [A, A, B, A]);
    expect(jobs.map((j) => j.model)).toEqual([A, B]);
  });

  it('keeps each (shotIndex, model) pair unique so child instance ids never collide', () => {
    const jobs = buildMotionJobs(shots, [A, B, A]);
    const keys = jobs.map((j) => `${j.shotIndex}:${j.model}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("falls back to each shot's own model when no top-level models are given", () => {
    const perShot: Shot[] = [
      { shotId: 'f0', model: A },
      { shotId: 'f1', model: B },
    ];
    expect(buildMotionJobs(perShot, undefined).map((j) => j.model)).toEqual([
      A,
      B,
    ]);
    // An empty list is treated the same as absent (single-model fallback).
    expect(buildMotionJobs(perShot, []).map((j) => j.model)).toEqual([A, B]);
  });

  it('falls back to DEFAULT_VIDEO_MODEL when a shot has no model and none are given', () => {
    const oneShot: Shot[] = [{ shotId: 'f0' }];
    const jobs = buildMotionJobs(oneShot, undefined);
    expect(jobs.map((j) => j.model)).toEqual([DEFAULT_VIDEO_MODEL]);
  });

  it('top-level models win over per-shot model', () => {
    const perShot: Shot[] = [{ shotId: 'f0', model: A }];
    expect(buildMotionJobs(perShot, [B]).map((j) => j.model)).toEqual([B]);
  });

  it('returns no jobs for no shots', () => {
    expect(buildMotionJobs([], [A, B])).toEqual([]);
  });
});

// kling_v3_pro supports multi-shot; veo3_1 does not (degrade path).
const MULTI: ImageToVideoModel = 'kling_v3_pro';
const SINGLE: ImageToVideoModel = 'veo3_1';

function renderShot(
  shotId: string,
  sceneDbId: string | null,
  shotNumber: number
): RenderShot<Shot> {
  return { shotId, sceneDbId, shotNumber };
}

describe('groupShotsForRender', () => {
  it('groups a multi-shot scene into ONE multi-shot unit on a capable model', () => {
    const units = groupShotsForRender(
      [
        renderShot('s0', 'sceneA', 1),
        renderShot('s1', 'sceneA', 2),
        renderShot('s2', 'sceneA', 3),
      ],
      MULTI
    );
    expect(units).toHaveLength(1);
    const unit = units[0];
    if (unit?.strategy !== 'multi-shot') throw new Error('expected multi-shot');
    expect(unit.sceneDbId).toBe('sceneA');
    expect(unit.shots.map((s) => s.shotId)).toEqual(['s0', 's1', 's2']);
  });

  it('orders a multi-shot unit by shotNumber regardless of input order', () => {
    const units = groupShotsForRender(
      [
        renderShot('s2', 'sceneA', 3),
        renderShot('s0', 'sceneA', 1),
        renderShot('s1', 'sceneA', 2),
      ],
      MULTI
    );
    const unit = units[0];
    if (unit?.strategy !== 'multi-shot') throw new Error('expected multi-shot');
    expect(unit.shots.map((s) => s.shotNumber)).toEqual([1, 2, 3]);
  });

  it('degrades a multi-shot scene to per-shot on a single-shot model', () => {
    const units = groupShotsForRender(
      [renderShot('s0', 'sceneA', 1), renderShot('s1', 'sceneA', 2)],
      SINGLE
    );
    expect(units.map((u) => u.strategy)).toEqual(['per-shot', 'per-shot']);
  });

  it('renders a single-shot scene per-shot even on a capable model', () => {
    const units = groupShotsForRender([renderShot('s0', 'sceneA', 1)], MULTI);
    expect(units).toHaveLength(1);
    expect(units[0]?.strategy).toBe('per-shot');
  });

  it('renders scene-less (legacy) shots per-shot, after scene units', () => {
    const units = groupShotsForRender(
      [
        renderShot('s0', 'sceneA', 1),
        renderShot('s1', 'sceneA', 2),
        renderShot('legacy', null, 1),
      ],
      MULTI
    );
    expect(units.map((u) => u.strategy)).toEqual(['multi-shot', 'per-shot']);
    const last = units[1];
    if (last?.strategy !== 'per-shot') throw new Error('expected per-shot');
    expect(last.shot.shotId).toBe('legacy');
  });

  it('preserves first-seen scene order across multiple scenes', () => {
    const units = groupShotsForRender(
      [
        renderShot('b0', 'sceneB', 1),
        renderShot('b1', 'sceneB', 2),
        renderShot('a0', 'sceneA', 1),
        renderShot('a1', 'sceneA', 2),
      ],
      MULTI
    );
    const sceneIds = units.map((u) =>
      u.strategy === 'multi-shot' ? u.sceneDbId : null
    );
    expect(sceneIds).toEqual(['sceneB', 'sceneA']);
  });
});
