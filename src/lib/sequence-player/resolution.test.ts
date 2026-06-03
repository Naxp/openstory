/**
 * Unit tests for the resolution-reconciliation arithmetic used by
 * `ConcatenatedVideoSource` to normalize mixed-model sequences (#791).
 * Pure math; no Mediabunny or WebCodecs surface needed.
 */

import { describe, expect, test } from 'vitest';
import {
  computeTargetResolution,
  describeResolutions,
  detectMixedResolutions,
  type SceneDimensions,
} from './resolution';

describe('computeTargetResolution', () => {
  test('throws on empty input', () => {
    expect(() => computeTargetResolution([])).toThrow();
  });

  test('single scene returns its own (even) dimensions', () => {
    expect(computeTargetResolution([{ width: 1920, height: 1080 }])).toEqual({
      width: 1920,
      height: 1080,
    });
  });

  test('uniform scenes return the shared dimensions', () => {
    const dims: SceneDimensions[] = [
      { width: 1280, height: 720 },
      { width: 1280, height: 720 },
      { width: 1280, height: 720 },
    ];
    expect(computeTargetResolution(dims)).toEqual({ width: 1280, height: 720 });
  });

  test('mixed scenes return the bounding box (max width, max height)', () => {
    // The issue example: 1920×1080 + 1280×1280 → 1920×1280 box, so neither
    // scene is cropped; each is letterboxed into the common target.
    const dims: SceneDimensions[] = [
      { width: 1920, height: 1080 },
      { width: 1280, height: 1280 },
    ];
    expect(computeTargetResolution(dims)).toEqual({
      width: 1920,
      height: 1280,
    });
  });

  test('rounds odd dimensions up to even for codec compatibility', () => {
    expect(computeTargetResolution([{ width: 1281, height: 719 }])).toEqual({
      width: 1282,
      height: 720,
    });
  });

  test('never returns below the 2px floor', () => {
    expect(computeTargetResolution([{ width: 1, height: 1 }])).toEqual({
      width: 2,
      height: 2,
    });
  });
});

describe('detectMixedResolutions', () => {
  test('empty or single scene is never mixed', () => {
    expect(detectMixedResolutions([])).toBe(false);
    expect(detectMixedResolutions([{ width: 1920, height: 1080 }])).toBe(false);
  });

  test('identical scenes are not mixed', () => {
    expect(
      detectMixedResolutions([
        { width: 1920, height: 1080 },
        { width: 1920, height: 1080 },
      ])
    ).toBe(false);
  });

  test('differing width or height flags a mismatch', () => {
    expect(
      detectMixedResolutions([
        { width: 1920, height: 1080 },
        { width: 1280, height: 720 },
      ])
    ).toBe(true);
    expect(
      detectMixedResolutions([
        { width: 1920, height: 1080 },
        { width: 1920, height: 1280 },
      ])
    ).toBe(true);
  });
});

describe('describeResolutions', () => {
  test('lists distinct resolutions in first-seen order, de-duplicated', () => {
    expect(
      describeResolutions([
        { width: 1920, height: 1080 },
        { width: 1280, height: 1280 },
        { width: 1920, height: 1080 },
      ])
    ).toBe('1920×1080, 1280×1280');
  });

  test('single resolution renders one label', () => {
    expect(describeResolutions([{ width: 1280, height: 720 }])).toBe(
      '1280×720'
    );
  });
});
