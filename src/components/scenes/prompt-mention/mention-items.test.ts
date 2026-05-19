import { describe, expect, it } from 'bun:test';
import {
  buildMentionItems,
  filterMentionItems,
  SECTION_ORDER,
  type MentionCharacterInput,
  type MentionElementInput,
  type MentionLocationInput,
} from './mention-items';

const noopCharacter: MentionCharacterInput = {
  id: 'c1',
  characterId: 'char_001',
  name: 'Jack',
  consistencyTag: 'char_001: jack-denim-jacket',
  sheetImageUrl: null,
};

const noopElement: MentionElementInput = {
  id: 'e1',
  token: 'red-hex-logo',
  description: 'A red hex logo',
  imageUrl: 'https://example.com/logo.png',
  consistencyTag: null,
};

const noopLocation: MentionLocationInput = {
  id: 'l1',
  locationId: 'loc_001',
  name: 'INT. OFFICE',
  consistencyTag: 'loc_001: office-modern-steel',
  referenceImageUrl: null,
};

describe('buildMentionItems', () => {
  it('produces tagged entries for elements, cast, locations', () => {
    const items = buildMentionItems({
      characters: [noopCharacter],
      elements: [noopElement],
      locations: [noopLocation],
    });

    const byId = Object.fromEntries(items.map((i) => [i.id, i]));
    expect(byId['element:e1']?.tag).toBe('RED-HEX-LOGO');
    expect(byId['element:e1']?.section).toBe('elements');
    expect(byId['character:c1']?.tag).toBe('jack-denim-jacket');
    expect(byId['character:c1']?.section).toBe('cast');
    expect(byId['location:l1']?.tag).toBe('office-modern-steel');
    expect(byId['location:l1']?.section).toBe('locations');
  });

  it('falls back to characterId / locationId when no consistencyTag slug', () => {
    const items = buildMentionItems({
      characters: [{ ...noopCharacter, consistencyTag: null }],
      elements: [],
      locations: [{ ...noopLocation, consistencyTag: null }],
    });
    expect(items.find((i) => i.id === 'character:c1')?.tag).toBe('char_001');
    expect(items.find((i) => i.id === 'location:l1')?.tag).toBe('loc_001');
  });

  it('orders elements before cast before locations in SECTION_ORDER', () => {
    expect(SECTION_ORDER).toEqual(['elements', 'cast', 'locations']);
  });
});

describe('filterMentionItems', () => {
  const items = buildMentionItems({
    characters: [noopCharacter],
    elements: [noopElement],
    locations: [noopLocation],
  });

  it('matches on the canonical tag', () => {
    expect(filterMentionItems(items, 'jack').map((i) => i.id)).toContain(
      'character:c1'
    );
  });

  it('matches on the human name (case-insensitive)', () => {
    expect(filterMentionItems(items, 'OFFICE').map((i) => i.id)).toContain(
      'location:l1'
    );
  });

  it('returns all items for empty query', () => {
    expect(filterMentionItems(items, '').length).toBe(items.length);
  });

  it('matches on the element token (uppercased)', () => {
    expect(filterMentionItems(items, 'red-hex').map((i) => i.id)).toContain(
      'element:e1'
    );
  });
});
