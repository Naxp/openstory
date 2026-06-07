import { describe, expect, it } from 'vitest';
import { toEnhanceStyleInputs } from '../enhance-style';
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

describe('toEnhanceStyleInputs (UI/API parity, issue #855)', () => {
  it('maps a style row to the same inputs the UI and API both send', () => {
    const result = toEnhanceStyleInputs({
      config: { mood: 'tense' },
      name: 'Action',
      category: 'film',
      description: 'Kinetic chases',
      tags: ['action', 'blockbuster'],
    });
    expect(result.styleConfig).toEqual({ mood: 'tense' });
    expect(result.styleMeta).toEqual({
      name: 'Action',
      category: 'film',
      description: 'Kinetic chases',
      tags: ['action', 'blockbuster'],
    });
  });

  it('returns empty inputs for a missing style (no spread keys)', () => {
    expect(toEnhanceStyleInputs(undefined)).toEqual({});
  });
});
