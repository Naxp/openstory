import { describe, expect, it } from 'vitest';
import { apiCreateSequenceSchema } from './input-schema';

describe('apiCreateSequenceSchema', () => {
  it('applies boolean defaults (enhance/motion/music = false)', () => {
    const parsed = apiCreateSequenceSchema.parse({
      script: 'A short film about a robot learning to paint.',
    });
    expect(parsed.enhance).toBe(false);
    expect(parsed.motion).toBe(false);
    expect(parsed.music).toBe(false);
  });

  it('rejects scripts shorter than 10 characters', () => {
    const result = apiCreateSequenceSchema.safeParse({ script: 'short' });
    expect(result.success).toBe(false);
  });

  it('accepts a fully-specified request', () => {
    const result = apiCreateSequenceSchema.safeParse({
      script: 'A sweeping documentary about deep-sea creatures.',
      title: 'Deep Sea',
      enhance: true,
      targetSeconds: 60,
      style: 'Cinematic Noir',
      aspectRatio: '9:16',
      analysisModels: ['anthropic/claude-haiku-4.5'],
      imageModels: ['flux-pro'],
      videoModels: ['kling/kling-v1'],
      motion: true,
      music: true,
      audioModels: ['lyria2'],
      characters: ['Ada', 'char-123'],
      createCharacters: [{ name: 'Narrator', description: 'calm voice' }],
      locations: ['Rooftop'],
      createLocations: [{ name: 'Submarine' }],
      elements: [{ url: 'https://cdn/logo.png', token: 'LOGO' }],
      webhookUrl: 'https://example.com/hook',
    });
    expect(result.success).toBe(true);
  });

  it('rejects non-URL element and webhook values', () => {
    expect(
      apiCreateSequenceSchema.safeParse({
        script: 'A valid length script here.',
        elements: [{ url: 'not-a-url' }],
      }).success
    ).toBe(false);

    expect(
      apiCreateSequenceSchema.safeParse({
        script: 'A valid length script here.',
        webhookUrl: 'not-a-url',
      }).success
    ).toBe(false);
  });

  it('bounds targetSeconds to 5–180', () => {
    const base = { script: 'A valid length script here.', enhance: true };
    expect(
      apiCreateSequenceSchema.safeParse({ ...base, targetSeconds: 4 }).success
    ).toBe(false);
    expect(
      apiCreateSequenceSchema.safeParse({ ...base, targetSeconds: 181 }).success
    ).toBe(false);
    expect(
      apiCreateSequenceSchema.safeParse({ ...base, targetSeconds: 30 }).success
    ).toBe(true);
  });
});
