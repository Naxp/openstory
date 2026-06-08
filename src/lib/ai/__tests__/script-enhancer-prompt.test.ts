import { describe, expect, it } from 'vitest';
import { toEnhanceInputs } from '../enhance-inputs';
import { createUserPrompt } from '../script-enhancer';

describe('createUserPrompt (issue #855)', () => {
  it('embeds the brief and the image-to-video non-negotiables', () => {
    const prompt = createUserPrompt('a new product launch');
    expect(prompt).toContain('a new product launch');
    // Every scene needs a concrete subject, an event, and visible motion —
    // and must avoid un-renderable furniture.
    expect(prompt).toContain('concrete subject in scene 1');
    expect(prompt).toContain('event driven by a subject');
    expect(prompt).toContain('visible motion');
    expect(prompt).toMatch(/No title cards.*logos/);
  });

  it('threads style name/category/tags so the genre drives the events', () => {
    const prompt = createUserPrompt('a cinematic short-film scene', {
      styleMeta: {
        name: 'Action',
        category: 'film',
        description: 'Kinetic chases and stunts',
        tags: ['action', 'blockbuster', 'explosive'],
      },
    });
    expect(prompt).toContain('drive WHAT HAPPENS');
    expect(prompt).toContain('Action / film');
    expect(prompt).toContain('Kinetic chases and stunts');
    expect(prompt).toContain('Genre cues: action, blockbuster, explosive');
  });

  it('omits the style block entirely when no style meta is given', () => {
    const prompt = createUserPrompt('a brief');
    expect(prompt).not.toContain('drive WHAT HAPPENS');
  });

  it('still renders aesthetic styleConfig fields independently of meta', () => {
    const prompt = createUserPrompt('a brief', {
      styleConfig: { mood: 'tense', lighting: 'low-key' },
    });
    expect(prompt).toContain('apply these aesthetics throughout');
    expect(prompt).toContain('Mood: tense');
    expect(prompt).toContain('Lighting: low-key');
  });
});

describe('toEnhanceInputs (UI/API parity, issue #855)', () => {
  it('maps a style row to the same inputs the UI and API both send', () => {
    const result = toEnhanceInputs({
      style: {
        config: { mood: 'tense' },
        name: 'Action',
        category: 'film',
        description: 'Kinetic chases',
        tags: ['action', 'blockbuster'],
      },
    });
    expect(result.styleConfig).toEqual({ mood: 'tense' });
    expect(result.styleMeta).toEqual({
      name: 'Action',
      category: 'film',
      description: 'Kinetic chases',
      tags: ['action', 'blockbuster'],
    });
  });

  it('maps tokened elements to the enhancer shape and drops tokenless ones', () => {
    const result = toEnhanceInputs({
      elements: [
        {
          token: 'LOGO',
          tempPublicUrl: 'https://x/logo.png',
          description: 'red',
        },
        // No token → cannot be referenced in the script → dropped.
        { token: null, tempPublicUrl: 'https://x/anon.png' },
      ],
    });
    expect(result.elements).toEqual([
      { token: 'LOGO', imageUrl: 'https://x/logo.png', description: 'red' },
    ]);
  });

  it('returns no keys for a missing style and no elements', () => {
    expect(toEnhanceInputs({})).toEqual({
      styleConfig: undefined,
      styleMeta: undefined,
      elements: undefined,
    });
  });
});
