import type { Style } from '@/types/database';

/**
 * Client-safe helpers for deriving a style's public media assets from the
 * `previewUrl` that every seeded style carries.
 *
 * Every style's assets live under a single `/styles/{slug}/` folder on the
 * public assets bucket (see `style-slug.ts`). The seeded `previewUrl` is always
 * `…/styles/{slug}/thumbnail.webp`, so the hover clip, canonical sample video,
 * and the three preview stills are all reachable by swapping the trailing
 * filename — no need to re-derive the slug or know the assets domain here.
 */

/** The suffix every seeded `previewUrl` ends with. */
const THUMBNAIL_SUFFIX = '/thumbnail.webp';

/**
 * Swap the `thumbnail.webp` filename on a style's preview URL for another asset
 * in the same folder. Returns null when the style has no preview URL or it
 * isn't the expected thumbnail shape (e.g. a user-uploaded custom style), so
 * callers degrade to the gradient/no-video fallback rather than 404.
 */
function styleAssetUrl(style: Style, file: string): string | null {
  const url = style.previewUrl;
  if (!url || !url.endsWith(THUMBNAIL_SUFFIX)) return null;
  return url.slice(0, -'thumbnail.webp'.length) + file;
}

/**
 * The looping hover-preview clip (`hover.mp4`) — a short, silent, square video
 * that animates the same composition the thumbnail was cut from. Null when the
 * style has no derivable asset folder.
 */
export function styleHoverVideoUrl(style: Style): string | null {
  return styleAssetUrl(style, 'hover.mp4');
}

/**
 * The canonical sample video for the style. Prefers the persisted
 * `sampleVideos` entry (authoritative URL + metadata) and falls back to the
 * derived `canonical.mp4` path for styles seeded before that column existed.
 */
export function styleCanonicalVideoUrl(style: Style): string | null {
  const canonical = style.sampleVideos?.find((v) => v.kind === 'canonical');
  if (canonical) return canonical.url;
  return styleAssetUrl(style, 'canonical.mp4');
}

/**
 * Categories whose preview stills are shot as products (hero/detail/context)
 * rather than people (character/environment/action). Mirrors the scene split in
 * `scripts/generate-style-previews.ts` so the URLs we derive here line up with
 * the renders that script produced.
 */
const PRODUCT_CATEGORIES = new Set(['ecommerce', 'food', 'automotive']);

const PEOPLE_SCENES = ['character', 'environment', 'action'] as const;
const PRODUCT_SCENES = ['hero', 'detail', 'context'] as const;

/** The three preview scene names rendered for a style (product vs. people). */
export function stylePreviewSceneNames(style: Style): readonly string[] {
  const isProduct =
    PRODUCT_CATEGORIES.has(style.category ?? '') ||
    (style.category === 'commercial' && style.useCases?.[0] === 'product');
  return isProduct ? PRODUCT_SCENES : PEOPLE_SCENES;
}

/**
 * URLs for the three full-res preview stills (`{scene}.webp`) shown in the
 * style detail view. Empty when the style has no derivable asset folder. Some
 * older styles never rendered all three scenes, so individual URLs may 404 —
 * callers should hide a still that fails to load rather than show a broken box.
 */
export function stylePreviewImageUrls(style: Style): string[] {
  return stylePreviewSceneNames(style)
    .map((scene) => styleAssetUrl(style, `${scene}.webp`))
    .filter((url): url is string => url !== null);
}

/**
 * Display order + friendly labels for the style categories used across the
 * template catalogue. Categories not listed here fall back to a title-cased
 * version of the raw value and sort to the end (see `groupStylesByCategory`).
 */
const STYLE_CATEGORY_ORDER = [
  'commercial',
  'ecommerce',
  'influencer',
  'film',
  'animation',
  'animatic',
  'kids',
  'corporate',
  'realestate',
  'photography',
  'food',
  'fitness',
  'healthcare',
  'edtech',
  'automotive',
  'nonprofit',
  'travel',
] as const;

const STYLE_CATEGORY_LABELS: Record<string, string> = {
  commercial: 'Commercial',
  ecommerce: 'E-commerce',
  influencer: 'Influencer & UGC',
  film: 'Film & Cinematic',
  animation: 'Animation',
  animatic: 'Animatic & Previz',
  kids: 'Kids',
  corporate: 'Corporate',
  realestate: 'Real Estate',
  photography: 'Photography',
  food: 'Food & Beverage',
  fitness: 'Fitness',
  healthcare: 'Healthcare',
  edtech: 'Education',
  automotive: 'Automotive',
  nonprofit: 'Nonprofit',
  travel: 'Travel',
};

/** Friendly heading for a style category (title-cases unknown values). */
export function styleCategoryLabel(
  category: string | null | undefined
): string {
  if (!category) return 'Other';
  return (
    STYLE_CATEGORY_LABELS[category] ??
    category.charAt(0).toUpperCase() + category.slice(1)
  );
}

export type StyleCategoryGroup = {
  category: string;
  label: string;
  styles: Style[];
};

/**
 * Bucket styles into category groups in the canonical display order. Known
 * categories follow `STYLE_CATEGORY_ORDER`; unknown ones are appended
 * alphabetically; styles with no category land in a trailing "Other" group.
 */
export function groupStylesByCategory(styles: Style[]): StyleCategoryGroup[] {
  const byCategory = new Map<string, Style[]>();
  for (const style of styles) {
    const key = style.category ?? '__other__';
    const bucket = byCategory.get(key);
    if (bucket) bucket.push(style);
    else byCategory.set(key, [style]);
  }

  const orderIndex = (key: string) => {
    if (key === '__other__') return Number.MAX_SAFE_INTEGER;
    const idx = STYLE_CATEGORY_ORDER.findIndex((c) => c === key);
    return idx === -1 ? STYLE_CATEGORY_ORDER.length : idx;
  };

  return [...byCategory.entries()]
    .sort(([a], [b]) => {
      const ai = orderIndex(a);
      const bi = orderIndex(b);
      if (ai !== bi) return ai - bi;
      return a.localeCompare(b);
    })
    .map(([category, groupStyles]) => ({
      category: category === '__other__' ? 'other' : category,
      label: category === '__other__' ? 'Other' : styleCategoryLabel(category),
      styles: groupStyles,
    }));
}
