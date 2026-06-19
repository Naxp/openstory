import { describe, expect, it } from 'vitest';
import {
  normalizeRenderStrategy,
  resolveRenderStrategy,
} from './resolve-render-strategy';

describe('resolveRenderStrategy', () => {
  it('renders a multi-shot scene in one call on a capable model', () => {
    expect(resolveRenderStrategy('seedance_v2', 3)).toBe('multi-shot');
    expect(resolveRenderStrategy('kling_v3_pro', 2)).toBe('multi-shot');
  });

  it('falls back to per-shot for a capable model with a single shot', () => {
    // Nothing to weave, and the no-cuts guard applies to one-shot renders.
    expect(resolveRenderStrategy('seedance_v2', 1)).toBe('per-shot');
    expect(resolveRenderStrategy('kling_v3_pro', 1)).toBe('per-shot');
  });

  it('renders per-shot on a single-shot model even with many shots', () => {
    // Graceful degradation: switching to a non-multi-shot model re-renders the
    // scene as per-shot clips.
    expect(resolveRenderStrategy('grok_imagine_video_1_5', 4)).toBe('per-shot');
    expect(resolveRenderStrategy('veo3_1', 3)).toBe('per-shot');
    expect(resolveRenderStrategy('minimax_hailuo_02', 5)).toBe('per-shot');
    expect(resolveRenderStrategy('ltx_2_3_pro', 2)).toBe('per-shot');
  });

  it('treats a zero-shot scene as per-shot', () => {
    expect(resolveRenderStrategy('seedance_v2', 0)).toBe('per-shot');
  });
});

describe('normalizeRenderStrategy', () => {
  it('reads NULL/undefined legacy rows as per-shot', () => {
    expect(normalizeRenderStrategy(null)).toBe('per-shot');
    expect(normalizeRenderStrategy(undefined)).toBe('per-shot');
  });

  it('preserves an explicit multi-shot value', () => {
    expect(normalizeRenderStrategy('multi-shot')).toBe('multi-shot');
  });

  it('reads an explicit per-shot value as per-shot', () => {
    expect(normalizeRenderStrategy('per-shot')).toBe('per-shot');
  });

  it('degrades any unrecognised value to per-shot', () => {
    expect(normalizeRenderStrategy('something-else')).toBe('per-shot');
  });
});
