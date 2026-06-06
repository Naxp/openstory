import { describe, expect, test } from 'vitest';
import type { ElementBibleEntry } from '@/lib/ai/scene-analysis.schema';
import { findMissingElementEntries } from './element-sheet-workflow';

const entry = (token: string): ElementBibleEntry => ({
  token,
  description: `Visual description of ${token}`,
  consistencyTag: token.toLowerCase().replaceAll('_', '-'),
  firstMention: { sceneId: 'scene_1', text: `the ${token}`, lineNumber: 1 },
});

describe('findMissingElementEntries', () => {
  test('returns entries whose token has no uploaded element', () => {
    const bible = [entry('LOGO'), entry('CORAL_LIPSTICK')];

    const missing = findMissingElementEntries(bible, [{ token: 'LOGO' }]);

    expect(missing.map((e) => e.token)).toEqual(['CORAL_LIPSTICK']);
  });

  test('returns all entries when nothing was uploaded', () => {
    const bible = [entry('HERO_PRODUCT')];

    expect(findMissingElementEntries(bible, [])).toEqual(bible);
  });

  test('returns nothing when every entry is covered by an upload', () => {
    const bible = [entry('LOGO'), entry('BOTTLE')];
    const uploaded = [{ token: 'LOGO' }, { token: 'BOTTLE' }];

    expect(findMissingElementEntries(bible, uploaded)).toEqual([]);
  });

  test('is exact-match on token (no case folding)', () => {
    const bible = [entry('LOGO')];

    expect(findMissingElementEntries(bible, [{ token: 'logo' }])).toEqual(
      bible
    );
  });
});
