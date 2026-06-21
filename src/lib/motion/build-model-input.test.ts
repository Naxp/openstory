import { describe, expect, it } from 'vitest';
import {
  IMAGE_TO_VIDEO_MODELS,
  safeImageToVideoModel,
  type ImageToVideoModel,
} from '../ai/models';
import { typedEntries } from '../utils/typed-object';
import { buildModelInput } from './build-model-input';
import type { GenerateMotionOptions } from './motion-generation';

const baseOptions: GenerateMotionOptions = {
  prompt: 'Camera dolly forward slowly',
  imageUrl: 'https://example.com/frame.jpg',
  duration: 5,
  aspectRatio: '16:9',
};

function build<T extends ImageToVideoModel>(
  modelKey: T,
  overrides: Partial<GenerateMotionOptions> = {}
) {
  return buildModelInput<T>(
    { ...baseOptions, ...overrides },
    IMAGE_TO_VIDEO_MODELS[modelKey],
    modelKey
  );
}

describe('buildModelInput', () => {
  describe('Kling v3 Pro (audio)', () => {
    it('uses start_image_url (not image_url)', () => {
      const result = build('kling_v3_pro');
      expect(result).toHaveProperty('start_image_url', baseOptions.imageUrl);
      expect(result).not.toHaveProperty('image_url');
    });

    it('applies schema defaults for cfg_scale and negative_prompt', () => {
      const result = build('kling_v3_pro');
      expect(result.cfg_scale).toBe(0.5);
      expect(result.negative_prompt).toBe('blur, distort, and low quality');
    });

    it('sets generate_audio to true from schema default', () => {
      const result = build('kling_v3_pro');
      expect(result.generate_audio).toBe(true);
    });

    it('forwards generate_audio=false when caller suppresses audio', () => {
      const result = build('kling_v3_pro', { generateAudio: false });
      expect(result.generate_audio).toBe(false);
    });
  });

  describe('Grok Imagine Video 1.5 (default)', () => {
    it('uses image_url and strips aspect_ratio (schema has none)', () => {
      // v1.5's fal schema dropped aspect_ratio; the output ratio is driven by
      // the input image instead. The transform must strip the aspect_ratio we
      // pass so no unsupported param reaches the API.
      const result = build('grok_imagine_video_1_5');
      expect(result).toHaveProperty('image_url', baseOptions.imageUrl);
      expect(result).not.toHaveProperty('start_image_url');
      expect(result).not.toHaveProperty('aspect_ratio');
      expect(result.resolution).toBe('720p'); // schema default
    });
  });

  describe('Veo 3.1 (audio)', () => {
    it('overrides resolution to 1080p', () => {
      const result = build('veo3_1');
      expect(result.resolution).toBe('1080p');
    });

    it('sets generate_audio to true from schema default', () => {
      const result = build('veo3_1');
      expect(result.generate_audio).toBe(true);
    });

    it('forwards generate_audio=false when caller suppresses audio', () => {
      const result = build('veo3_1', { generateAudio: false });
      expect(result.generate_audio).toBe(false);
    });

    it('uses image_url', () => {
      const result = build('veo3_1');
      expect(result).toHaveProperty('image_url', baseOptions.imageUrl);
    });
  });

  describe('MiniMax Hailuo 2.3', () => {
    it('uses image_url', () => {
      const result = build('minimax_hailuo_02');
      expect(result).toHaveProperty('image_url', baseOptions.imageUrl);
    });

    it('includes prompt', () => {
      const result = build('minimax_hailuo_02');
      expect(result.prompt).toBe(baseOptions.prompt);
    });
  });

  describe('LTX 2.3 Pro', () => {
    it('uses image_url', () => {
      const result = build('ltx_2_3_pro');
      expect(result).toHaveProperty('image_url', baseOptions.imageUrl);
    });

    it('includes prompt', () => {
      const result = build('ltx_2_3_pro');
      expect(result.prompt).toBe(baseOptions.prompt);
    });
  });

  describe('Seedance 2.0 (audio)', () => {
    it('uses image_url', () => {
      const result = build('seedance_v2');
      expect(result).toHaveProperty('image_url', baseOptions.imageUrl);
    });

    it('sets generate_audio to true from schema default', () => {
      const result = build('seedance_v2');
      expect(result.generate_audio).toBe(true);
    });

    it('forwards generate_audio=false when caller suppresses audio', () => {
      const result = build('seedance_v2', { generateAudio: false });
      expect(result.generate_audio).toBe(false);
    });
  });

  describe('duration snapping (1–30s)', () => {
    const valid: Record<ImageToVideoModel, readonly (string | number)[]> = {
      kling_v3_pro: [
        '3',
        '4',
        '5',
        '6',
        '7',
        '8',
        '9',
        '10',
        '11',
        '12',
        '13',
        '14',
        '15',
      ],
      grok_imagine_video_1_5: [
        1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15,
      ],
      veo3_1: ['4s', '6s', '8s'],
      ltx_2_3_pro: [6, 8, 10],
      seedance_v2: [
        '4',
        '5',
        '6',
        '7',
        '8',
        '9',
        '10',
        '11',
        '12',
        '13',
        '14',
        '15',
      ],
      minimax_hailuo_02: [],
    };

    for (const [model, allowed] of typedEntries(valid)) {
      it(model, () => {
        for (let d = 1; d <= 30; d++) {
          const modelInputResult = build(model, { duration: d });
          const duration =
            'duration' in modelInputResult
              ? modelInputResult.duration
              : undefined;

          if (typeof duration === 'undefined') {
            expect(allowed).toHaveLength(0);
          } else {
            expect(allowed).toContain(duration);
          }
        }
      });
    }
  });

  describe('common behavior', () => {
    it('always includes prompt', () => {
      for (const key of Object.keys(IMAGE_TO_VIDEO_MODELS)) {
        const result = build(safeImageToVideoModel(key));
        expect(result.prompt).toBe(baseOptions.prompt);
      }
    });

    it('passes aspect_ratio from options', () => {
      const result = build('seedance_v2', { aspectRatio: '9:16' });
      expect(result.aspect_ratio).toBe('9:16');
    });

    it('falls back to the schema default for aspect_ratio when not provided', () => {
      const result = build('seedance_v2', { aspectRatio: undefined });
      expect(result.aspect_ratio).toBe('auto');
    });
  });

  // #910 multi-shot render pass-throughs.
  describe('multi-shot render pass-throughs', () => {
    it('forwards multi_prompt + shot_type for Kling', () => {
      const result = build('kling_v3_pro', {
        multiPrompt: [
          { duration: 4, prompt: 'shot one' },
          { duration: 6, prompt: 'shot two' },
        ],
      });
      // Kling durations are string-enum seconds.
      expect(result.multi_prompt).toEqual([
        { duration: '4', prompt: 'shot one' },
        { duration: '6', prompt: 'shot two' },
      ]);
      expect(result.shot_type).toBe('customize');
    });

    it('forwards end_image_url and elements for Kling', () => {
      const result = build('kling_v3_pro', {
        endImageUrl: 'https://example.com/end.jpg',
        elementImageUrls: ['https://example.com/ref2.jpg'],
      });
      expect(result.end_image_url).toBe('https://example.com/end.jpg');
      expect(result.elements).toEqual([
        { frontal_image_url: 'https://example.com/ref2.jpg' },
      ]);
    });

    it('forwards end_image_url for Seedance', () => {
      const result = build('seedance_v2', {
        endImageUrl: 'https://example.com/end.jpg',
      });
      expect(result.end_image_url).toBe('https://example.com/end.jpg');
    });

    it('strips multi-shot fields for a single-shot model (Grok)', () => {
      const result = build('grok_imagine_video_1_5', {
        multiPrompt: [{ duration: 4, prompt: 'shot one' }],
        endImageUrl: 'https://example.com/end.jpg',
        elementImageUrls: ['https://example.com/ref2.jpg'],
      });
      expect(result).not.toHaveProperty('multi_prompt');
      expect(result).not.toHaveProperty('shot_type');
      expect(result).not.toHaveProperty('end_image_url');
      expect(result).not.toHaveProperty('elements');
    });

    it('omits multi-shot fields entirely when not requested', () => {
      const result = build('kling_v3_pro');
      expect(result).not.toHaveProperty('multi_prompt');
      expect(result).not.toHaveProperty('end_image_url');
      expect(result).not.toHaveProperty('elements');
    });
  });
});
