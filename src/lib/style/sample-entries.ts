/**
 * Pure builders for the style sample-video gallery/showcase (#956).
 *
 * Flattens public styles into displayable sample entries. Kept free of React so
 * it can be unit-tested directly and shared by the logged-out showcase and the
 * gallery page.
 */
import {
  DEFAULT_ASPECT_RATIO,
  type AspectRatio,
} from '@/lib/constants/aspect-ratios';
import type { StyleSampleVideo } from '@/lib/db/schema/libraries';
import { briefForStyle } from '@/lib/style/brief-for-style';
import { styleSlug } from '@/lib/style/style-slug';
import type { Style } from '@/types/database';

export type SampleEntry = {
  /** Stable list key — a style can contribute more than one sample (kinds). */
  key: string;
  styleId: string;
  styleName: string;
  /** Human-readable slug (`cinematic-noir`) — the composer prefill link uses it
   *  as `?style=<slug>` instead of the opaque id. */
  slug: string;
  video: StyleSampleVideo;
  aspectRatio: AspectRatio;
  /** True when this style resolves a brief, so the composer can be seeded. */
  hasBrief: boolean;
};

function aspectRatioOf(style: Style): AspectRatio {
  switch (style.defaultAspectRatio) {
    case '9:16':
      return '9:16';
    case '1:1':
      return '1:1';
    default:
      return DEFAULT_ASPECT_RATIO;
  }
}

/** Whether a style resolves a brief (a future unmapped style would throw). */
function styleHasBrief(style: Style): boolean {
  try {
    return briefForStyle({ name: style.name, category: style.category }) !== '';
  } catch {
    return false;
  }
}

/**
 * Flatten styles into displayable sample entries.
 * - `canonical`: one representative clip per style (the canonical sample, else
 *   the lowest-order one) — used by the curated logged-out showcase.
 * - `all`: every sample across every style, ordered, mixed aspect ratios —
 *   used by the gallery page.
 *
 * Styles with no sample videos are skipped.
 */
export function buildSampleEntries(
  styles: Style[],
  mode: 'canonical' | 'all'
): SampleEntry[] {
  const entries: SampleEntry[] = [];
  for (const style of styles) {
    const samples = style.sampleVideos ?? [];
    if (samples.length === 0) continue;
    const ordered = [...samples].sort((a, b) => a.order - b.order);
    const aspectRatio = aspectRatioOf(style);
    const hasBrief = styleHasBrief(style);
    const slug = styleSlug(style.name);

    const chosen =
      mode === 'all'
        ? ordered
        : [ordered.find((s) => s.kind === 'canonical') ?? ordered[0]].filter(
            (s): s is StyleSampleVideo => s !== undefined
          );

    for (const video of chosen) {
      entries.push({
        key: `${style.id}:${video.kind}`,
        styleId: style.id,
        styleName: style.name,
        slug,
        video,
        aspectRatio,
        hasBrief,
      });
    }
  }
  return entries;
}
