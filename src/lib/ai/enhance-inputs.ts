/**
 * Shared construction of the style/element inputs the script enhancer reads, so
 * the UI (`enhanceScriptStreamFn`) and the public API (`runOneShotCreate`) feed
 * the enhancer IDENTICALLY (issue #855). Kept dependency-free (type-only import
 * of StyleConfig) so it is safe to import from the client bundle.
 */
import type { StyleConfig } from '@/lib/db/schema/libraries';

/**
 * Identity of the chosen style — name/category/description/tags — threaded into
 * the enhancer so the genre drives WHAT HAPPENS, not just the look. The
 * aesthetic fields (mood, lighting, …) live on {@link StyleConfig}; these do not.
 */
export type StyleMeta = {
  name?: string;
  category?: string | null;
  description?: string | null;
  tags?: string[] | null;
};

/** A style row, narrowed to the fields the enhancer reads. */
type StyleLike = {
  config?: Partial<StyleConfig> | null;
  name?: string | null;
  category?: string | null;
  description?: string | null;
  tags?: string[] | null;
};

/**
 * An ingested element, narrowed to the fields the enhancer reads. Both the UI's
 * `DraftElementUpload` and the API's `TempElementUpload` satisfy this shape.
 */
type ElementLike = {
  token?: string | null;
  tempPublicUrl: string;
  description?: string | null;
};

/** The enhancer's element shape: an UPPERCASE token + an image to look at. */
type EnhanceElement = {
  token: string;
  imageUrl: string;
  description?: string;
};

/**
 * Map a style row + ingested elements to the enhancer inputs. Spread the result
 * into the enhance request so both call sites stay in lockstep.
 */
export function toEnhanceInputs(args: {
  style?: StyleLike | null;
  elements?: readonly ElementLike[] | null;
}): {
  styleConfig?: Partial<StyleConfig>;
  styleMeta?: StyleMeta;
  elements?: EnhanceElement[];
} {
  const { style, elements } = args;
  // Only elements with a token can be referenced in the script; drop the rest.
  const mapped = (elements ?? []).flatMap((el): EnhanceElement[] =>
    el.token
      ? [
          {
            token: el.token,
            imageUrl: el.tempPublicUrl,
            ...(el.description ? { description: el.description } : {}),
          },
        ]
      : []
  );

  return {
    styleConfig: style?.config ?? undefined,
    styleMeta: style
      ? {
          name: style.name ?? undefined,
          category: style.category,
          description: style.description,
          tags: style.tags,
        }
      : undefined,
    elements: mapped.length > 0 ? mapped : undefined,
  };
}
