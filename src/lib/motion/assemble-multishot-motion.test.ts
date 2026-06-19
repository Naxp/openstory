import { describe, expect, it } from 'vitest';
import type { MotionPrompt } from '../ai/scene-analysis.schema';
import {
  assembleMultiShotMotion,
  type MultiShotItem,
} from './assemble-multishot-motion';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const baseComponents: MotionPrompt['components'] = {
  cameraMovement: 'pan',
  startPosition: 'medium shot',
  endPosition: '',
  durationSeconds: 5,
  speed: 'smooth',
  smoothness: 'smooth',
  subjectTracking: '',
  equipment: '',
};

const baseParameters: MotionPrompt['parameters'] = {
  durationSeconds: 5,
  fps: 24,
  motionAmount: 'medium',
  cameraControl: { pan: 0, tilt: 0, zoom: 1, movement: 'pan' },
};

function makeMotionPrompt(fullPrompt: string): MotionPrompt {
  return {
    fullPrompt,
    components: baseComponents,
    parameters: baseParameters,
    dialogue: null,
    audio: null,
  };
}

function shot(
  shotNumber: number,
  fullPrompt: string,
  durationSeconds: number
): MultiShotItem {
  return {
    shotNumber,
    motionPrompt: makeMotionPrompt(fullPrompt),
    durationSeconds,
  };
}

// ---------------------------------------------------------------------------
// Seedance (prose-labels)
// ---------------------------------------------------------------------------

describe('assembleMultiShotMotion — Seedance prose-labels', () => {
  it('weaves shots into "Shot N:" prose, ordered by shotNumber', () => {
    const result = assembleMultiShotMotion({
      model: 'seedance_v2',
      shots: [
        shot(2, 'she opens the door. Camera: smooth pan', 5),
        shot(1, 'she walks down the hall. Camera: slow dolly', 5),
      ],
      maxDurationSeconds: 15,
    });

    expect(result).not.toBeNull();
    if (result?.syntax !== 'prose-labels') throw new Error('wrong syntax');
    expect(result.prompt).toContain('Shot 1: she walks down the hall');
    expect(result.prompt).toContain('Shot 2: she opens the door');
    expect(result.prompt.indexOf('Shot 1:')).toBeLessThan(
      result.prompt.indexOf('Shot 2:')
    );
  });

  it('omits the single-shot no-cuts guard from a multi-shot weave', () => {
    const result = assembleMultiShotMotion({
      model: 'seedance_v2',
      shots: [shot(1, 'a wide establishing shot', 5), shot(2, 'a close-up', 5)],
      maxDurationSeconds: 15,
    });

    if (result?.syntax !== 'prose-labels') throw new Error('wrong syntax');
    expect(result.prompt).not.toContain('Single continuous shot, no cuts.');
  });

  it('keeps the jitter guard for character scenes while dropping no-cuts', () => {
    const result = assembleMultiShotMotion({
      model: 'seedance_v2',
      shots: [shot(1, 'she turns', 5), shot(2, 'she smiles', 5)],
      characterTags: ['girl_one'],
      maxDurationSeconds: 15,
    });

    if (result?.syntax !== 'prose-labels') throw new Error('wrong syntax');
    expect(result.prompt).not.toContain('Single continuous shot, no cuts.');
    expect(result.prompt).toContain('Avoid jitter and bent limbs.');
  });
});

// ---------------------------------------------------------------------------
// Kling (multi-prompt-array)
// ---------------------------------------------------------------------------

describe('assembleMultiShotMotion — Kling multi-prompt-array', () => {
  it('produces one multi_prompt entry per shot with its duration', () => {
    const result = assembleMultiShotMotion({
      model: 'kling_v3_pro',
      shots: [
        shot(1, 'a slow push-in', 4),
        shot(2, 'a quick cut to a face', 6),
      ],
      maxDurationSeconds: 15,
    });

    if (result?.syntax !== 'multi-prompt-array')
      throw new Error('wrong syntax');
    expect(result.multiPrompt).toHaveLength(2);
    expect(result.multiPrompt[0]?.duration).toBe(4);
    expect(result.multiPrompt[0]?.prompt).toContain('a slow push-in');
    expect(result.multiPrompt[1]?.duration).toBe(6);
    expect(result.multiPrompt[1]?.prompt).toContain('a quick cut to a face');
    expect(result.totalDurationSeconds).toBe(10);
  });
});

// ---------------------------------------------------------------------------
// Duration clamping + non-capable models
// ---------------------------------------------------------------------------

describe('assembleMultiShotMotion — duration + capability', () => {
  it('scales shot durations down to fit the model ceiling', () => {
    // 3 shots × 8s = 24s, clamp to 15s. Proportional scale ≈ 0.625 → 5s each.
    const result = assembleMultiShotMotion({
      model: 'kling_v3_pro',
      shots: [shot(1, 'a', 8), shot(2, 'b', 8), shot(3, 'c', 8)],
      maxDurationSeconds: 15,
    });

    if (result?.syntax !== 'multi-prompt-array')
      throw new Error('wrong syntax');
    expect(result.totalDurationSeconds).toBeLessThanOrEqual(15);
    for (const s of result.multiPrompt) {
      expect(s.duration).toBeGreaterThanOrEqual(1);
    }
  });

  it('leaves durations untouched when the sum already fits', () => {
    const result = assembleMultiShotMotion({
      model: 'seedance_v2',
      shots: [shot(1, 'a', 4), shot(2, 'b', 5)],
      maxDurationSeconds: 15,
    });
    if (result?.syntax !== 'prose-labels') throw new Error('wrong syntax');
    expect(result.totalDurationSeconds).toBe(9);
  });

  it('returns null for a model that does not support multi-shot', () => {
    expect(
      assembleMultiShotMotion({
        model: 'grok_imagine_video_1_5',
        shots: [shot(1, 'a', 5), shot(2, 'b', 5)],
        maxDurationSeconds: 15,
      })
    ).toBeNull();
  });
});
