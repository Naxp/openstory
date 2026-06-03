/**
 * Resolvers that turn the public API's human-friendly references into the
 * concrete ids / uploads `createSequences` expects:
 *   - style:   id | name | slug  → styleId (auto-pick a default when omitted)
 *   - talent:  id | name         → suggestedTalentIds
 *   - location:id | name         → suggestedLocationIds
 *   - element: hosted URL        → promoted TempElementUpload
 *
 * Every lookup goes through the team-scoped `list()` (team-owned + public), so
 * a caller can never resolve another team's private library entry.
 */

import { describeElementImage } from '@/lib/ai/element-vision';
import type { Style } from '@/lib/db/schema';
import type { ScopedDb } from '@/lib/db/scoped';
import { generateId } from '@/lib/db/id';
import { NotFoundError } from '@/lib/errors';
import type { TempElementUpload } from '@/lib/sequence-elements/promote-temp-elements';
import { getPublicUrl, STORAGE_BUCKETS } from '@/lib/storage/buckets';
import { uploadFile } from '#storage';
import type { ApiCreateSequenceInput } from './input-schema';
import { fetchSafeImage } from './safe-fetch';

/** lowercase, non-alphanumerics → single hyphens; for forgiving name matching. */
function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function matchesRef(ref: string, candidate: { id: string; name: string }) {
  if (candidate.id === ref) return true;
  const r = ref.toLowerCase().trim();
  return (
    candidate.name.toLowerCase().trim() === r ||
    slugify(candidate.name) === slugify(ref)
  );
}

// Narrow dependency surfaces: each resolver depends only on the scoped-db
// methods it actually calls, so a test double is a plain object with those
// methods (no casts) and the real coupling is self-documenting. A full
// `ScopedDb` is structurally assignable to each.
type StyleDeps = { styles: Pick<ScopedDb['styles'], 'list'> };
type TalentDeps = { talent: Pick<ScopedDb['talent'], 'list' | 'create'> };
type LocationDeps = {
  locations: Pick<ScopedDb['locations'], 'list' | 'create'>;
};
type ElementDeps = { apiKeys: Pick<ScopedDb['apiKeys'], 'resolveKey'> };

/**
 * Resolve a style reference to the full style row. With no reference, auto-pick
 * the most popular team-or-public style. Throws 404 if a given reference matches
 * nothing. Returns the row (not just the id) so callers can apply the style's
 * recommended aspect ratio, mirroring the new-sequence page.
 */
export async function resolveStyle(
  scopedDb: StyleDeps,
  styleRef: string | undefined
): Promise<Style> {
  const styles = await scopedDb.styles.list({ orderBy: 'popular' });

  // list() is ordered by popularity desc, so the first row is the default.
  const [mostPopular] = styles;
  if (!mostPopular) {
    throw new NotFoundError(
      'No styles are available to this team. Create a style first.'
    );
  }
  if (!styleRef) {
    return mostPopular;
  }

  const match = styles.find((s) => matchesRef(styleRef, s));
  if (!match) {
    throw new NotFoundError(`No style found matching "${styleRef}".`);
  }
  return match;
}

/**
 * Resolve existing talent refs (id|name) plus any inline create requests into a
 * deduped list of talent ids suitable for `suggestedTalentIds`.
 */
export async function resolveTalentIds(
  scopedDb: TalentDeps,
  refs: string[] | undefined,
  creates: ApiCreateSequenceInput['createCharacters']
): Promise<string[]> {
  const ids: string[] = [];

  if (refs && refs.length > 0) {
    const all = await scopedDb.talent.list();
    for (const ref of refs) {
      const match = all.find((t) => matchesRef(ref, t));
      if (!match) {
        throw new NotFoundError(`No character/talent found matching "${ref}".`);
      }
      ids.push(match.id);
    }
  }

  if (creates && creates.length > 0) {
    for (const c of creates) {
      const created = await scopedDb.talent.create({
        name: c.name,
        description: c.description,
        isInTeamLibrary: true,
      });
      ids.push(created.id);
    }
  }

  return [...new Set(ids)];
}

/**
 * Resolve existing location refs (id|name) plus any inline create requests into
 * a deduped list of location ids suitable for `suggestedLocationIds`.
 */
export async function resolveLocationIds(
  scopedDb: LocationDeps,
  refs: string[] | undefined,
  creates: ApiCreateSequenceInput['createLocations']
): Promise<string[]> {
  const ids: string[] = [];

  if (refs && refs.length > 0) {
    const all = await scopedDb.locations.list();
    for (const ref of refs) {
      const match = all.find((l) => matchesRef(ref, l));
      if (!match) {
        throw new NotFoundError(`No location found matching "${ref}".`);
      }
      ids.push(match.id);
    }
  }

  if (creates && creates.length > 0) {
    for (const c of creates) {
      const created = await scopedDb.locations.create({
        name: c.name,
        description: c.description,
      });
      ids.push(created.id);
    }
  }

  return [...new Set(ids)];
}

/**
 * Ingest a caller-hosted reference image into temp storage, run vision to
 * derive description/consistencyTag/token, and return a `TempElementUpload`
 * ready for `promoteTempElements`. Mirrors the dashboard's presign → analyze
 * draft flow, but server-side from a URL since API callers can't presign.
 */
export async function ingestElements(
  scopedDb: ElementDeps,
  teamId: string,
  elements: ApiCreateSequenceInput['elements']
): Promise<TempElementUpload[]> {
  if (!elements || elements.length === 0) return [];

  const openRouter = await scopedDb.apiKeys.resolveKey('openrouter');

  return Promise.all(
    elements.map(async (el) => {
      // SSRF-hardened: validates the host, refuses redirects, and derives the
      // type/extension from the verified response (never the URL extension).
      const { bytes, contentType, extension } = await fetchSafeImage(el.url);
      const filename = el.filename ?? `element.${extension}`;
      const uploadId = generateId();
      // Bucket-relative path used for the put + public URL; the promote contract
      // wants the bucket-prefixed `elements/` form for `tempPath`.
      const relative = `${teamId}/temp/${uploadId}.${extension}`;

      await uploadFile(STORAGE_BUCKETS.ELEMENTS, relative, bytes, {
        contentType,
      });

      const tempPublicUrl = getPublicUrl(STORAGE_BUCKETS.ELEMENTS, relative);
      const vision = await describeElementImage({
        imageUrl: tempPublicUrl,
        filename,
        openRouterApiKey: openRouter.key,
      });

      return {
        tempPath: `elements/${relative}`,
        tempPublicUrl,
        filename,
        token: el.token ?? vision.suggestedToken,
        description: vision.description,
        consistencyTag: vision.consistencyTag,
      };
    })
  );
}
