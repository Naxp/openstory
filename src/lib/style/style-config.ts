/**
 * Canonical style schema (v2) — the single source of truth for "a style" as the
 * generation pipeline sees it. Deliberately dependency-free (only `zod`) so it is
 * safe to import from the client bundle and from the drizzle table definition
 * (`src/lib/db/schema/libraries.ts` re-exports these for `config.$type<>()`).
 *
 * A style encodes three signatures:
 *   - NARRATIVE (what happens): `summary`, `tone` here + name/category/tags on the row.
 *   - LOOK (the still): `look` — prescriptive; drives every image prompt.
 *   - MOTION (shot selection + i2v): `motion` — core; cannot be derived from a still.
 * Plus `references` (grounding) and an optional surround (design/casting/sound) +
 * `source` provenance for the future LLM/vision creation flows. The schema is a
 * small required core + a wide OPTIONAL surround, so quick/LLM/vision-generated
 * styles stay compact while curated templates stay rich.
 */
import { z } from 'zod';

// ── Sample videos (moved verbatim from libraries.ts; pure-zod, no drizzle) ──

export const StyleSampleVideoKindSchema = z.enum([
  'canonical',
  'category',
  'bespoke',
]);
export type StyleSampleVideoKind = z.infer<typeof StyleSampleVideoKindSchema>;

export const StyleSampleVideoSchema = z.object({
  url: z.string().url(),
  kind: StyleSampleVideoKindSchema,
  label: z.string(),
  durationSeconds: z.number().nonnegative(),
  order: z.number().int().nonnegative(),
});
export type StyleSampleVideo = z.infer<typeof StyleSampleVideoSchema>;

// ── Look — the STILL signature (prescriptive) ──
// The 5 v1 look fields keep their exact constraints so the v1→v2 backfill is a
// 1:1 move; the extras are new and OPTIONAL.

// These sub-schemas are composed into StyleConfigSchema below; kept module-local
// until a consumer needs them directly (e.g. the future LLM/vision contract).
const StyleLookSchema = z.object({
  mood: z.string().min(3).max(1000),
  artStyle: z.string().min(3).max(1000),
  lighting: z.string().min(3).max(1000),
  colorPalette: z.array(z.string().min(1)).min(1).max(20),
  colorGrading: z.string().min(3).max(1000),
  medium: z
    .enum([
      'live-action',
      'animation-3d',
      'animation-2d',
      'illustration',
      'mixed',
    ])
    .optional(),
  texture: z.string().min(3).max(1000).optional(),
  composition: z.string().min(3).max(1000).optional(),
});

// ── Motion — the SHOT-SELECTION + i2v signature (core) ──
// `camera` <- v1 `cameraWork`; the granularity (shots/pace/energy) is new + optional.

const StyleMotionSchema = z.object({
  camera: z.string().min(3).max(1000),
  shots: z.string().min(3).max(1000).optional(),
  pace: z.enum(['languid', 'measured', 'energetic', 'frenetic']).optional(),
  energy: z.number().int().min(1).max(5).optional(),
});

// ── Provenance — how the style was authored (drives the future create flows) ──

const StyleSourceSchema = z.object({
  kind: z.enum(['manual', 'llm', 'vision-image', 'vision-video', 'template']),
  prompt: z.string().optional(),
  referenceImageUrls: z.array(z.string().url()).optional(),
});

// ── The canonical config blob ──

export const StyleConfigSchema = z.object({
  // narrative extras — compact handle for the enhancer + future semantic search
  summary: z.string().min(3).max(280).optional(),
  tone: z.string().min(3).max(500).optional(),
  look: StyleLookSchema,
  motion: StyleMotionSchema,
  references: z.array(z.string().min(1)).max(50),
  // optional surround — future-proofing slots (no consumer reads them yet)
  design: z
    .object({
      wardrobe: z.string().min(3).max(1000).optional(),
      setDressing: z.string().min(3).max(1000).optional(),
      era: z.string().min(1).max(200).optional(),
      worldTexture: z.string().min(1).max(200).optional(),
    })
    .optional(),
  casting: z.string().min(3).max(1000).optional(),
  sound: z
    .object({
      musicStyle: z.string().min(3).max(500).optional(),
      mood: z.string().min(3).max(500).optional(),
    })
    .optional(),
  source: StyleSourceSchema.optional(),
});
export type StyleConfig = z.infer<typeof StyleConfigSchema>;

// ── v1 shape + converter ──
// The pre-v2 flat blob. Kept here solely so existing rows can be up-converted on
// read (transitional tolerance) and by the one-off backfill script. Once prod is
// fully backfilled, the v1 branch in `parseStyleConfig` can be dropped.

const StyleConfigV1Schema = z.object({
  mood: z.string(),
  artStyle: z.string(),
  lighting: z.string(),
  colorPalette: z.array(z.string()),
  cameraWork: z.string(),
  referenceFilms: z.array(z.string()),
  colorGrading: z.string(),
});
export type StyleConfigV1 = z.infer<typeof StyleConfigV1Schema>;

/** True when the raw blob is already in the v2 (grouped) shape. */
function isStyleConfigV2(raw: unknown): boolean {
  return typeof raw === 'object' && raw !== null && 'look' in raw;
}

/**
 * Mechanically map a v1 flat config to v2 (no LLM). New v2-only fields are left
 * unset — existing rows simply don't have them until re-authored.
 */
export function migrateStyleConfigV1ToV2(raw: unknown): StyleConfig {
  const v1 = StyleConfigV1Schema.parse(raw);
  return {
    look: {
      mood: v1.mood,
      artStyle: v1.artStyle,
      lighting: v1.lighting,
      colorPalette: v1.colorPalette,
      colorGrading: v1.colorGrading,
    },
    motion: { camera: v1.cameraWork },
    references: v1.referenceFilms,
  };
}

/**
 * Parse a stored `config` blob, tolerating the legacy v1 shape by up-converting
 * it. Use this at every boundary that first reads a `Style` row's `config` from
 * the DB, so reads never crash on un-backfilled rows during the rollout window.
 */
export function parseStyleConfig(raw: unknown): StyleConfig {
  return isStyleConfigV2(raw)
    ? StyleConfigSchema.parse(raw)
    : migrateStyleConfigV1ToV2(raw);
}

// ── Canonical projection — "a style as the generation pipeline sees it" ──
// The single narrowing that the ad-hoc re-projections (EnhanceStyle and
// enhanceScriptInputSchema.style) derive from: identity columns + the canonical
// config blob, one cohesive shape. `tags` is a non-null array so `tags?.length`
// guards die downstream.

export type StyleProjection = {
  name: string;
  description?: string | null;
  category?: string | null;
  tags: string[];
  config: StyleConfig;
};
