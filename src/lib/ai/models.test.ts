import { describe, expect, it } from 'vitest';
import {
  DEFAULT_IMAGE_MODEL,
  DEFAULT_VIDEO_MODEL,
  IMAGE_MODELS,
  IMAGE_TO_VIDEO_MODELS,
  isValidImageToVideoModel,
  isValidTextToImageModel,
  safeImageToVideoModel,
  safeTextToImageModel,
  videoModelMaxDurationSeconds,
  videoModelMultiShotSyntax,
  videoModelSupportsAudio,
  videoModelSupportsEndFrame,
  videoModelSupportsMultiShot,
} from './models';

describe('videoModelSupportsAudio', () => {
  it('returns true for audio-capable video models', () => {
    expect(videoModelSupportsAudio('seedance_v2')).toBe(true);
    expect(videoModelSupportsAudio('kling_v3_pro')).toBe(true);
    expect(videoModelSupportsAudio('veo3_1')).toBe(true);
  });

  it('returns false for models without audio', () => {
    expect(videoModelSupportsAudio('grok_imagine_video_1_5')).toBe(false);
  });
});

describe('Model Validation', () => {
  describe('isValidTextToImageModel', () => {
    it('returns true for valid model keys', () => {
      expect(isValidTextToImageModel('nano_banana_2')).toBe(true);
      expect(isValidTextToImageModel('nano_banana_pro')).toBe(true);
      expect(isValidTextToImageModel('flux_2_dev')).toBe(true);
    });

    it('returns false for invalid model keys', () => {
      expect(isValidTextToImageModel('invalid_model')).toBe(false);
      expect(isValidTextToImageModel('flux_pro_invalid')).toBe(false);
      expect(isValidTextToImageModel('')).toBe(false);
    });

    it('returns false for null/undefined', () => {
      expect(isValidTextToImageModel(null)).toBe(false);
      expect(isValidTextToImageModel(undefined)).toBe(false);
    });
  });

  describe('isValidImageToVideoModel', () => {
    it('returns true for valid model keys', () => {
      expect(isValidImageToVideoModel('kling_v3_pro')).toBe(true);
      expect(isValidImageToVideoModel('veo3_1')).toBe(true);
      expect(isValidImageToVideoModel('seedance_v2')).toBe(true);
    });

    it('returns false for invalid model keys', () => {
      expect(isValidImageToVideoModel('invalid_model')).toBe(false);
      expect(isValidImageToVideoModel('wan_invalid')).toBe(false);
      expect(isValidImageToVideoModel('')).toBe(false);
    });

    it('returns false for null/undefined', () => {
      expect(isValidImageToVideoModel(null)).toBe(false);
      expect(isValidImageToVideoModel(undefined)).toBe(false);
    });
  });

  describe('safeTextToImageModel', () => {
    it('returns the model key when valid', () => {
      expect(safeTextToImageModel('nano_banana_2')).toBe('nano_banana_2');
      expect(safeTextToImageModel('nano_banana_pro')).toBe('nano_banana_pro');
    });

    it('returns default when invalid', () => {
      expect(safeTextToImageModel('invalid_model')).toBe(DEFAULT_IMAGE_MODEL);
      expect(safeTextToImageModel('')).toBe(DEFAULT_IMAGE_MODEL);
      expect(safeTextToImageModel(null)).toBe(DEFAULT_IMAGE_MODEL);
      expect(safeTextToImageModel(undefined)).toBe(DEFAULT_IMAGE_MODEL);
    });

    it('uses custom fallback when provided', () => {
      const customFallback = 'flux_2_dev';
      expect(safeTextToImageModel('invalid_model', customFallback)).toBe(
        customFallback
      );
    });

    it('validates all IMAGE_MODELS keys', () => {
      for (const key of Object.keys(IMAGE_MODELS)) {
        expect(safeTextToImageModel(key) as string).toBe(key);
      }
    });
  });

  describe('safeImageToVideoModel', () => {
    it('returns the model key when valid', () => {
      expect(safeImageToVideoModel('kling_v3_pro')).toBe('kling_v3_pro');
      expect(safeImageToVideoModel('veo3_1')).toBe('veo3_1');
    });

    it('returns default when invalid', () => {
      expect(safeImageToVideoModel('invalid_model')).toBe(DEFAULT_VIDEO_MODEL);
      expect(safeImageToVideoModel('')).toBe(DEFAULT_VIDEO_MODEL);
      expect(safeImageToVideoModel(null)).toBe(DEFAULT_VIDEO_MODEL);
      expect(safeImageToVideoModel(undefined)).toBe(DEFAULT_VIDEO_MODEL);
    });

    it('uses custom fallback when provided', () => {
      const customFallback = 'veo3_1';
      expect(safeImageToVideoModel('invalid_model', customFallback)).toBe(
        customFallback
      );
    });

    it('validates all IMAGE_TO_VIDEO_MODELS keys', () => {
      for (const key of Object.keys(IMAGE_TO_VIDEO_MODELS)) {
        expect(safeImageToVideoModel(key) as string).toBe(key);
      }
    });
  });

  describe('Type Guards', () => {
    it('isValidTextToImageModel acts as a type guard', () => {
      const maybeModel: string = 'nano_banana_2';
      if (isValidTextToImageModel(maybeModel)) {
        // TypeScript should infer maybeModel as TextToImageModel here
        const model = maybeModel;
        expect(IMAGE_MODELS[model]).toBeDefined();
      }
    });

    it('isValidImageToVideoModel acts as a type guard', () => {
      const maybeModel: string = 'kling_v3_pro';
      if (isValidImageToVideoModel(maybeModel)) {
        // TypeScript should infer maybeModel as ImageToVideoModel here
        const model = maybeModel;
        expect(IMAGE_TO_VIDEO_MODELS[model]).toBeDefined();
      }
    });
  });

  // #910 — multi-shot capability flags on IMAGE_TO_VIDEO_MODELS.
  describe('multi-shot capability flags', () => {
    it('marks Seedance 2.0 as a prose-labels multi-shot model', () => {
      expect(videoModelSupportsMultiShot('seedance_v2')).toBe(true);
      expect(videoModelMultiShotSyntax('seedance_v2')).toBe('prose-labels');
      expect(videoModelSupportsEndFrame('seedance_v2')).toBe(true);
      expect(videoModelMaxDurationSeconds('seedance_v2')).toBe(15);
    });

    it('marks Kling v3 Pro as a multi-prompt-array multi-shot model', () => {
      expect(videoModelSupportsMultiShot('kling_v3_pro')).toBe(true);
      expect(videoModelMultiShotSyntax('kling_v3_pro')).toBe(
        'multi-prompt-array'
      );
      expect(videoModelSupportsEndFrame('kling_v3_pro')).toBe(true);
      expect(videoModelMaxDurationSeconds('kling_v3_pro')).toBe(15);
    });

    it('treats single-shot models as per-shot only', () => {
      for (const model of [
        'grok_imagine_video_1_5',
        'veo3_1',
        'minimax_hailuo_02',
        'ltx_2_3_pro',
      ] as const) {
        expect(videoModelSupportsMultiShot(model)).toBe(false);
        expect(videoModelMultiShotSyntax(model)).toBeNull();
      }
    });
  });
});
