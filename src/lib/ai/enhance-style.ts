/**
 * Shared mapping from a style row to the style-aware enhance inputs, so the UI
 * (`enhanceScriptStreamFn`) and the public API (`runOneShotCreate`) feed the
 * script enhancer IDENTICALLY (issue #855). Kept dependency-free (type-only
 * import of StyleConfig) so it is safe to import from the client bundle.
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

export function toEnhanceStyleInputs(style: StyleLike | null | undefined): {
  styleConfig?: Partial<StyleConfig>;
  styleMeta?: StyleMeta;
} {
  if (!style) return {};
  return {
    styleConfig: style.config ?? undefined,
    styleMeta: {
      name: style.name ?? undefined,
      category: style.category,
      description: style.description,
      tags: style.tags,
    },
  };
}
