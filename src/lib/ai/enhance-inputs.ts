/**
 * Shared construction of the style/element inputs the script enhancer reads, so
 * the UI (`enhanceScriptStreamFn`) and the public API (`runOneShotCreate`) feed
 * the enhancer IDENTICALLY (issue #855). Depends only on the drizzle-free
 * `style-config` module (zod) so it is safe to import from the client bundle.
 */
import {
  parseStyleConfig,
  type StyleConfig,
  type StyleProjection,
} from '@/lib/style/style-config';

/**
 * A style as the enhancer sees it: the aesthetic recipe (`config`) plus the
 * identity that drives WHAT HAPPENS — name/category/tags decide whether "action"
 * gets a chase and "rom-com" gets a meet-cute, not just how the frame looks. A
 * narrowing of the canonical {@link StyleProjection} rather than a parallel bag.
 */
export type EnhanceStyle = Partial<
  Pick<StyleProjection, 'name' | 'category' | 'description' | 'tags' | 'config'>
>;

/** A style row, narrowed to the fields the enhancer reads. `config` is the raw
 * stored blob (v1 or v2) — up-converted via `parseStyleConfig` below. */
type StyleLike = {
  config?: StyleConfig | null;
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
 * Narrow a style row + ingested elements to the enhancer inputs. Spread the
 * result into the enhance request so both call sites stay in lockstep.
 */
export function toEnhanceInputs(args: {
  style?: StyleLike | null;
  elements?: readonly ElementLike[] | null;
}): {
  style?: EnhanceStyle;
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
    style: style
      ? {
          config: style.config ? parseStyleConfig(style.config) : undefined,
          name: style.name ?? undefined,
          category: style.category ?? undefined,
          description: style.description ?? undefined,
          tags: style.tags ?? undefined,
        }
      : undefined,
    elements: mapped.length > 0 ? mapped : undefined,
  };
}
