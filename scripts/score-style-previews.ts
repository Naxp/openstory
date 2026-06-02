#!/usr/bin/env bun
/**
 * Score style preview thumbnails with a vision LLM (issue #718).
 *
 * For each image in preview/{slug}/{scene}.webp it asks a vision model — given
 * the style's intended look (its config) and the scene — to grade the preview
 * and flag the failure modes we hit by hand: literal-medium renders (a book, a
 * storyboard sheet), multi-frame/panel grids, malformed anatomy, stray text.
 *
 * Outputs (report-only — never deletes anything):
 *   preview/_scores.json      full per-scene verdicts
 *   preview/_thumbnails.json   { slug: bestScene } — auto-picked best scene per
 *                              style (feed to upload-style-previews-to-r2.ts
 *                              via --thumbnail-map)
 *   console: styles ranked worst-first + a re-roll list (below --threshold or
 *            a hard flag on the best scene). Exits non-zero if any style fails.
 *
 * Usage:
 *   bun scripts/score-style-previews.ts                       # score all
 *   bun scripts/score-style-previews.ts --filter "Pop-Up Book"
 *   bun scripts/score-style-previews.ts --scene action     # only the action scene of each style
 *   bun scripts/score-style-previews.ts --model openai/gpt-5.4 --threshold 6.5
 */
import type { TextModel } from '@/lib/ai/models';
import { callLLM } from '@/lib/ai/llm-client';
import {
  ANALYSIS_MODEL_IDS,
  isValidAnalysisModelId,
} from '@/lib/ai/models.config';
import type { StyleConfig } from '@/lib/db/schema/libraries';
import type { ChatMessage, ChatMessageContentPart } from '@/lib/prompts';
import { styleSlug } from '@/lib/style/style-slug';
import { DEFAULT_STYLE_TEMPLATES } from '@/lib/style/style-templates';
import { PhotonImage } from '@cf-wasm/photon';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';

const PREVIEW_DIR = path.join(process.cwd(), 'preview');
const DEFAULT_MODEL = 'google/gemini-3-flash-preview';

function parseArg(name: string): string | undefined {
  const pref = `--${name}=`;
  const eq = process.argv.find((a) => a.startsWith(pref));
  if (eq) return eq.slice(pref.length);
  const idx = process.argv.findIndex((a) => a === `--${name}`);
  return idx >= 0 ? process.argv[idx + 1] : undefined;
}

function resolveModel(): TextModel {
  const m = parseArg('model') ?? DEFAULT_MODEL;
  if (!isValidAnalysisModelId(m)) {
    console.error(
      `Invalid --model "${m}". Options:\n  ${ANALYSIS_MODEL_IDS.join('\n  ')}`
    );
    process.exit(1);
  }
  return m;
}

const MODEL = resolveModel();
const FILTER = parseArg('filter') ?? null;
const SCENE = parseArg('scene') ?? null; // e.g. --scene action (only that scene)
const THRESHOLD = Number(parseArg('threshold') ?? '6');
const CONCURRENCY = Number(parseArg('concurrency') ?? '6');
const openRouterKey = process.env.OPENROUTER_KEY;
if (!openRouterKey) {
  console.error('OPENROUTER_KEY is required to score previews.');
  process.exit(1);
}

const verdictSchema = z.object({
  styleAdherence: z.number().min(0).max(10),
  subjectMatch: z.number().min(0).max(10),
  thumbnailQuality: z.number().min(0).max(10),
  literalMedium: z.boolean(),
  multiFrame: z.boolean(),
  anatomy: z.boolean(),
  unwantedText: z.boolean(),
  notes: z.string(),
});
type Verdict = z.infer<typeof verdictSchema>;

const SYSTEM_PROMPT = `You are a strict art director scoring AI-generated STYLE PREVIEW thumbnails for a video-style picker. You receive ONE image, the scene it was meant to depict, and the STYLE's intended look. Score how well the image works as a preview of that style.

Return ONLY a JSON object (no markdown, no prose):
{ "styleAdherence": 0-10, "subjectMatch": 0-10, "thumbnailQuality": 0-10, "literalMedium": true|false, "multiFrame": true|false, "anatomy": true|false, "unwantedText": true|false, "notes": "<=200 chars" }

Definitions:
- styleAdherence: how well the look matches the intended artStyle/mood/lighting/camera/colorGrading.
- subjectMatch: does it depict the requested scene? (character = a portrait of a person; environment = a wide establishing location; action = a dynamic scene with movement.)
- thumbnailQuality: clear single subject, well composed, in focus, appealing at small size.
- literalMedium (hard fail): the image depicts the MEDIUM / FORMAT / ARTIFACT as the object — a physical book, a storyboard sheet, a sheet of panels, a TV/monitor/phone showing the scene — INSTEAD of a scene rendered in that style. IMPORTANT: if the intended look IS a device/medium/setup (a phone in-hand, a product on a white background, a product on a turntable, a UI screen, a stage), then showing it is CORRECT — set literalMedium=false. Only set true when the artifact contradicts a scene-based style.
- multiFrame (hard fail): a grid, multiple panels, a collage, split-screen, or several separate images in one frame.
- anatomy (hard fail): look carefully at every person and COUNT the hands and fingers. Flag extra, missing, duplicated, or floating hands; extra or missing fingers; extra/missing limbs; or distorted faces.
- unwantedText: any text, caption, watermark, logo, or frame number.

Be strict and consistent.`;

function userPrompt(name: string, scene: string, c: StyleConfig): string {
  return [
    `STYLE: ${name}`,
    `SCENE REQUESTED: ${scene}`,
    '',
    'Intended look:',
    `- Art style: ${c.artStyle}`,
    `- Mood: ${c.mood}`,
    `- Lighting: ${c.lighting}`,
    `- Camera: ${c.cameraWork}`,
    `- Color grading: ${c.colorGrading}`,
    '',
    'Score the attached image.',
  ].join('\n');
}

/** Decode a webp file and return a base64 JPEG for the vision payload. */
async function toJpegBase64(filePath: string): Promise<string> {
  const bytes = new Uint8Array(await readFile(filePath));
  const image = PhotonImage.new_from_byteslice(bytes);
  try {
    return Buffer.from(image.get_bytes_jpeg(85)).toString('base64');
  } finally {
    image.free();
  }
}

/** Extract the JSON object from an LLM reply, tolerating ```json fences / prose. */
function extractJson(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = (fenced?.[1] ?? text).trim();
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) {
    throw new Error('Scorer returned no JSON object');
  }
  return candidate.slice(start, end + 1);
}

async function scoreImage(
  name: string,
  scene: string,
  config: StyleConfig,
  filePath: string
): Promise<Verdict> {
  const base64 = await toJpegBase64(filePath);
  const content: ChatMessageContentPart[] = [
    { type: 'text', content: userPrompt(name, scene, config) },
    {
      type: 'image',
      source: { type: 'data', value: base64, mimeType: 'image/jpeg' },
    },
  ];
  const messages: ChatMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content },
  ];
  const reply = await callLLM({
    model: MODEL,
    messages,
    max_tokens: 600,
    temperature: 0,
    observationName: 'score-style-preview',
    apiKey: openRouterKey,
  });
  return verdictSchema.parse(JSON.parse(extractJson(reply)));
}

function flagCount(v: Verdict): number {
  return [v.literalMedium, v.multiFrame, v.anatomy].filter(Boolean).length;
}
function composite(v: Verdict): number {
  const mean = (v.styleAdherence + v.subjectMatch + v.thumbnailQuality) / 3;
  return Math.max(0, Math.round((mean - 3 * flagCount(v)) * 10) / 10);
}
function flagLabels(v: Verdict): string {
  const f: string[] = [];
  if (v.literalMedium) f.push('LITERAL');
  if (v.multiFrame) f.push('MULTIFRAME');
  if (v.anatomy) f.push('ANATOMY');
  if (v.unwantedText) f.push('text');
  return f.join(',');
}

type SceneResult = { scene: string; verdict: Verdict; composite: number };
type StyleResult = {
  name: string;
  slug: string;
  scenes: SceneResult[];
  bestScene: string;
  bestComposite: number;
};

async function main() {
  const bySlug = new Map(
    DEFAULT_STYLE_TEMPLATES.map((s) => [styleSlug(s.name), s])
  );

  // Build the task list from what's actually on disk.
  const dirs = (await readdir(PREVIEW_DIR, { withFileTypes: true })).filter(
    (d) => d.isDirectory()
  );
  type Task = {
    name: string;
    slug: string;
    scene: string;
    file: string;
    config: StyleConfig;
  };
  const tasks: Task[] = [];
  for (const dir of dirs) {
    const slug = dir.name;
    const style = bySlug.get(slug);
    if (!style) continue; // skip non-style dirs (talent/locations/etc.)
    if (FILTER && FILTER !== style.name && FILTER !== slug) continue;
    for (const file of await readdir(path.join(PREVIEW_DIR, slug))) {
      if (path.extname(file).toLowerCase() !== '.webp') continue;
      const scene = path.basename(file, '.webp');
      if (SCENE && scene !== SCENE) continue;
      tasks.push({
        name: style.name,
        slug,
        scene,
        file: path.join(PREVIEW_DIR, slug, file),
        config: style.config,
      });
    }
  }

  if (tasks.length === 0) {
    console.error(
      'No preview images found. Run generate-style-previews.ts first.'
    );
    process.exit(1);
  }
  console.log(
    `Scoring ${tasks.length} images with ${MODEL} (concurrency ${CONCURRENCY})…\n`
  );

  // Concurrency-limited scoring.
  const scored = new Map<string, SceneResult[]>(); // slug -> results
  let index = 0;
  let done = 0;
  const failures: string[] = [];
  const worker = async () => {
    while (index < tasks.length) {
      const t = tasks[index++];
      if (!t) break;
      try {
        const verdict = await scoreImage(t.name, t.scene, t.config, t.file);
        const list = scored.get(t.slug) ?? [];
        list.push({ scene: t.scene, verdict, composite: composite(verdict) });
        scored.set(t.slug, list);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        failures.push(`${t.slug}/${t.scene}: ${msg}`);
      }
      done++;
      if (done % 10 === 0 || done === tasks.length) {
        process.stderr.write(`  scored ${done}/${tasks.length}\n`);
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, tasks.length) }, worker)
  );

  // Aggregate per style (best scene wins for the thumbnail).
  const results: StyleResult[] = [];
  for (const [slug, scenes] of scored) {
    const best = scenes.reduce((a, b) => (b.composite > a.composite ? b : a));
    const style = bySlug.get(slug);
    results.push({
      name: style?.name ?? slug,
      slug,
      scenes,
      bestScene: best.scene,
      bestComposite: best.composite,
    });
  }
  results.sort((a, b) => a.bestComposite - b.bestComposite);

  // Write artifacts.
  await writeFile(
    path.join(PREVIEW_DIR, '_scores.json'),
    JSON.stringify({ model: MODEL, threshold: THRESHOLD, results }, null, 2)
  );
  const thumbnailMap = Object.fromEntries(
    results.map((r) => [r.slug, r.bestScene])
  );
  await writeFile(
    path.join(PREVIEW_DIR, '_thumbnails.json'),
    JSON.stringify(thumbnailMap, null, 2)
  );

  // Console report — worst first.
  console.log('\nStyle scores (worst first) — best-scene composite /10:\n');
  for (const r of results) {
    const best = r.scenes.find((s) => s.scene === r.bestScene)?.verdict;
    const flags = best ? flagLabels(best) : '';
    console.log(
      `  ${r.bestComposite.toFixed(1).padStart(4)}  ${r.slug.padEnd(28)} best=${r.bestScene.padEnd(12)} ${flags}`
    );
  }

  const reroll = results.filter((r) => {
    const best = r.scenes.find((s) => s.scene === r.bestScene)?.verdict;
    return r.bestComposite < THRESHOLD || (best ? flagCount(best) > 0 : true);
  });
  console.log(
    `\n${results.length} styles scored. ${reroll.length} below threshold ${THRESHOLD} or flagged on best scene:`
  );
  for (const r of reroll)
    console.log(`  - ${r.slug} (${r.bestComposite.toFixed(1)})`);
  console.log(`\nWrote preview/_scores.json and preview/_thumbnails.json`);

  if (failures.length > 0) {
    console.error(`\n${failures.length} images failed to score:`);
    for (const f of failures) console.error(`  - ${f}`);
  }
  if (reroll.length > 0 || failures.length > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
