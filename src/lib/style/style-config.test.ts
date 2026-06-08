import { describe, expect, it } from 'vitest';
import {
  migrateStyleConfigV1ToV2,
  parseStyleConfig,
  StyleConfigSchema,
} from './style-config';

const v1 = {
  mood: 'tense',
  artStyle: 'neo-noir',
  lighting: 'low-key',
  colorPalette: ['#000', '#fff'],
  cameraWork: 'dutch angles',
  referenceFilms: ['rain-slicked neon noir'],
  colorGrading: 'desaturated',
};

describe('migrateStyleConfigV1ToV2', () => {
  it('maps every flat v1 field into the grouped v2 shape', () => {
    expect(migrateStyleConfigV1ToV2(v1)).toEqual({
      look: {
        mood: 'tense',
        artStyle: 'neo-noir',
        lighting: 'low-key',
        colorPalette: ['#000', '#fff'],
        colorGrading: 'desaturated',
      },
      motion: { camera: 'dutch angles' },
      references: ['rain-slicked neon noir'],
    });
  });

  it('produces a config that validates against the v2 schema', () => {
    expect(() =>
      StyleConfigSchema.parse(migrateStyleConfigV1ToV2(v1))
    ).not.toThrow();
  });
});

describe('parseStyleConfig', () => {
  it('up-converts a legacy v1 blob on read', () => {
    expect(parseStyleConfig(v1).motion.camera).toBe('dutch angles');
  });

  it('passes a v2 blob through unchanged', () => {
    const v2 = migrateStyleConfigV1ToV2(v1);
    expect(parseStyleConfig(v2)).toEqual(v2);
  });
});
