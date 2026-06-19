import { describe, expect, it } from 'vitest';
import { DEFAULT_IMAGE_MODEL, DEFAULT_VIDEO_MODEL } from '@/lib/ai/models';
import {
  resolveSceneImageModel,
  resolveSceneVideoModel,
} from './resolve-scene-model';

/**
 * The scene-level resolution chain (#909): scene override wins, otherwise the
 * scene inherits the sequence default. A valid model id flows through; an
 * unknown/retired one clamps to the global default.
 */
describe('resolveSceneImageModel', () => {
  it('uses the scene override when set', () => {
    expect(
      resolveSceneImageModel(
        { imageModel: 'nano_banana_pro', videoModel: null },
        { imageModel: 'nano_banana_2', videoModel: 'seedance_v2' }
      )
    ).toBe('nano_banana_pro');
  });

  it('falls back to the sequence model when the scene model is null', () => {
    expect(
      resolveSceneImageModel(
        { imageModel: null, videoModel: null },
        { imageModel: 'nano_banana_pro', videoModel: 'seedance_v2' }
      )
    ).toBe('nano_banana_pro');
  });

  it('falls back to the global default when neither is set', () => {
    expect(
      resolveSceneImageModel(
        { imageModel: null, videoModel: null },
        { imageModel: null, videoModel: null }
      )
    ).toBe(DEFAULT_IMAGE_MODEL);
  });

  it('clamps a retired persisted model to the default', () => {
    expect(
      resolveSceneImageModel(
        { imageModel: 'no_longer_a_real_model', videoModel: null },
        { imageModel: 'nano_banana_2', videoModel: 'seedance_v2' }
      )
    ).toBe(DEFAULT_IMAGE_MODEL);
  });

  it('handles an undefined scene (not yet loaded)', () => {
    expect(
      resolveSceneImageModel(undefined, {
        imageModel: 'nano_banana_pro',
        videoModel: 'seedance_v2',
      })
    ).toBe('nano_banana_pro');
  });
});

describe('resolveSceneVideoModel', () => {
  it('uses the scene override when set', () => {
    expect(
      resolveSceneVideoModel(
        { imageModel: null, videoModel: 'kling_v3_pro' },
        { imageModel: 'nano_banana_2', videoModel: 'seedance_v2' }
      )
    ).toBe('kling_v3_pro');
  });

  it('falls back to the sequence model when the scene model is null', () => {
    expect(
      resolveSceneVideoModel(
        { imageModel: null, videoModel: null },
        { imageModel: 'nano_banana_2', videoModel: 'kling_v3_pro' }
      )
    ).toBe('kling_v3_pro');
  });

  it('falls back to the global default when neither is set', () => {
    expect(
      resolveSceneVideoModel(
        { imageModel: null, videoModel: null },
        { imageModel: null, videoModel: null }
      )
    ).toBe(DEFAULT_VIDEO_MODEL);
  });
});
