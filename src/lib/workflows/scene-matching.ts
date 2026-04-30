/**
 * Scene matching utilities
 *
 * Pure functions for matching characters and locations to scenes
 * by their continuity tags. Used by analyze-script and frame-images workflows.
 */

import type {
  CharacterMinimal,
  SequenceElementMinimal,
  SequenceLocationMinimal,
} from '@/lib/db/schema';

type CharacterMatchInput = Pick<
  CharacterMinimal,
  'name' | 'characterId' | 'consistencyTag'
>;

// Normalizes any cased/spaced/punctuated form to a snake_case slug so
// `"GIRL ONE"` and `"girl_one"` compare equal.
function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/**
 * Boolean: does any tag in `characterTags` refer to this character?
 *
 * Authoritative match key is the slugified `name` — it's stable across
 * recast and is what the LLM is told to emit. `characterId` and
 * `consistencyTag` remain as fallbacks.
 */
export function matchCharacterToFrameTags(
  character: CharacterMatchInput,
  characterTags: string[]
): boolean {
  if (characterTags.length === 0) return false;

  const nameSlug = slugify(character.name);
  const idSlug = slugify(character.characterId);
  const consistencySlug = character.consistencyTag
    ? slugify(character.consistencyTag)
    : '';

  return characterTags.some((rawTag) => {
    const tagSlug = slugify(rawTag);
    if (!tagSlug) return false;

    if (nameSlug && tagSlug.includes(nameSlug)) return true;
    if (nameSlug && tagSlug.length >= 3 && nameSlug.includes(tagSlug))
      return true;
    if (idSlug && tagSlug.includes(idSlug)) return true;
    if (consistencySlug && tagSlug.includes(consistencySlug)) return true;
    if (
      consistencySlug &&
      tagSlug.length >= 3 &&
      consistencySlug.includes(tagSlug)
    )
      return true;
    return false;
  });
}

/**
 * Match characters to a scene by their continuity tags.
 * Pure function that works in-memory without DB queries.
 */
export function matchCharactersToScene<T extends CharacterMatchInput>(
  allCharacters: T[],
  characterTags: string[]
): T[] {
  if (characterTags.length === 0) return [];
  return allCharacters.filter((c) =>
    matchCharacterToFrameTags(c, characterTags)
  );
}

/**
 * Match locations to a scene by environment tag or location name.
 * Pure function that works in-memory without DB queries.
 */
export function matchLocationsToScene(
  allLocations: SequenceLocationMinimal[],
  environmentTag: string,
  sceneLocation: string
): SequenceLocationMinimal[] {
  if (!environmentTag && !sceneLocation) return [];

  const envTagLower = environmentTag.toLowerCase();
  const sceneLocLower = sceneLocation.toLowerCase();

  return allLocations.filter((loc) => {
    const consistencyTag = (loc.consistencyTag ?? '').toLowerCase();
    const locName = loc.name.toLowerCase();
    const locId = loc.locationId.toLowerCase();
    const searchTerms = [
      locName,
      locId,
      ...(consistencyTag ? [consistencyTag] : []),
    ];

    // Check if any location identifier appears in the environment tag or scene location
    return searchTerms.some(
      (term) =>
        envTagLower.includes(term) ||
        sceneLocLower.includes(term) ||
        // Reverse match: location name contains the search terms
        term.includes(envTagLower) ||
        term.includes(sceneLocLower)
    );
  });
}

/**
 * Match user-uploaded elements to a scene by UPPERCASE token.
 *
 * Primary match: `elementTags[]` (emitted by the LLM during scene-split).
 * Fallback match: token appears in the raw scene script text — catches
 * cases where the model forgets to populate `elementTags`.
 */
export function matchElementsToScene(
  allElements: SequenceElementMinimal[],
  elementTags: string[],
  sceneScript?: string
): SequenceElementMinimal[] {
  if (allElements.length === 0) return [];

  const tagsUpper = new Set(elementTags.map((t) => t.toUpperCase()));
  const scriptUpper = (sceneScript ?? '').toUpperCase();

  return allElements.filter((el) => {
    const token = el.token.toUpperCase();
    if (tagsUpper.has(token)) return true;
    // Match whole-token occurrence in script text (avoid substring hits in a longer word)
    const re = new RegExp(`(?:^|[^A-Z0-9_])${token}(?:[^A-Z0-9_]|$)`);
    return re.test(scriptUpper);
  });
}
