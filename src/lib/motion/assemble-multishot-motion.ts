/**
 * Multi-shot motion-prompt assembly (#910)
 * ============================================================================
 *
 * When a scene's resolved video model `supportsMultiShot`, the whole shot list
 * renders in ONE generation. This module weaves the scene's ordered per-shot
 * `MotionPrompt`s into the syntax each capable model expects:
 *
 *   - Seedance 2.0 (`prose-labels`): one prompt string with `Shot 1: … Shot 2:
 *     …` prose labels and the per-shot sound/dialogue prose woven in. The
 *     single-shot no-cuts guard is DELIBERATELY omitted — a multi-shot render
 *     must contain cuts.
 *   - Kling v3 Pro (`multi-prompt-array`): the structured `multi_prompt` array
 *     (`{ duration, prompt }` per shot) consumed with `shot_type: 'customize'`.
 *
 * Per-shot enrichment reuses `assembleMotionPrompt` (the single-shot builder)
 * so dialogue/audio formatting stays identical to per-shot rendering — the
 * only difference is the outer weave. The single-shot path is untouched.
 */

import {
  type ImageToVideoModel,
  videoModelMultiShotSyntax,
} from '@/lib/ai/models';
import type { MotionPrompt } from '@/lib/ai/scene-analysis.schema';
import { assembleMotionPrompt } from './assemble-motion-prompt';

/** One shot's structured motion prompt plus its (already snapped) duration. */
export type MultiShotItem = {
  shotNumber: number;
  motionPrompt: MotionPrompt;
  durationSeconds: number;
};

/** Kling `multi_prompt` element: `{ duration, prompt }` (duration is seconds). */
type KlingMultiPromptShot = {
  duration: number;
  prompt: string;
};

/**
 * The assembled multi-shot render instruction, discriminated by the model's
 * `multiShotSyntax`. The render layer forwards `prompt` / `multiPrompt` into the
 * provider input. `totalDurationSeconds` is the summed (clamped) scene length.
 */
export type MultiShotAssembly =
  | {
      syntax: 'prose-labels';
      prompt: string;
      totalDurationSeconds: number;
    }
  | {
      syntax: 'multi-prompt-array';
      multiPrompt: KlingMultiPromptShot[];
      totalDurationSeconds: number;
    };

/**
 * Sort shots by `shotNumber` so the woven order is deterministic regardless of
 * how the caller collected them.
 */
function ordered(shots: readonly MultiShotItem[]): MultiShotItem[] {
  return [...shots].sort((a, b) => a.shotNumber - b.shotNumber);
}

/**
 * Build the per-shot prompt body via the single-shot assembler, stripping the
 * trailing single-shot no-cuts guard if present — a multi-shot render must keep
 * its cuts. The guard is the last paragraph Seedance's builder appends; we drop
 * any paragraph that is exactly the guard sentence.
 */
const NO_CUTS_GUARD = 'Single continuous shot, no cuts.';

function shotBody(
  item: MultiShotItem,
  model: ImageToVideoModel,
  characterTags: readonly string[] | undefined
): string {
  const assembled = assembleMotionPrompt({
    motionPrompt: item.motionPrompt,
    model,
    characterTags,
  });
  // Remove the no-cuts guard SENTENCE (Seedance appends it for one-take
  // scenes; it is wrong inside a multi-shot weave) while keeping any sibling
  // guard in the same paragraph (e.g. "Avoid jitter and bent limbs.").
  return assembled
    .split('\n\n')
    .map((para) =>
      para
        .replace(NO_CUTS_GUARD, '')
        .replace(/\s{2,}/g, ' ')
        .trim()
    )
    .filter((para) => para.length > 0)
    .join('\n\n')
    .trim();
}

/**
 * Weave a scene's ordered shots into the model's multi-shot syntax.
 *
 * @param model        the scene's resolved (multi-shot-capable) video model
 * @param shots        the scene's ordered per-shot motion prompts + durations
 * @param characterTags scene continuity character tags (for in-prompt guards)
 * @param maxDurationSeconds clamp on the summed scene duration (model ceiling)
 * @returns the assembled instruction, or `null` if the model isn't multi-shot
 *   capable (caller should fall back to per-shot rendering)
 */
export function assembleMultiShotMotion({
  model,
  shots,
  characterTags,
  maxDurationSeconds,
}: {
  model: ImageToVideoModel;
  shots: readonly MultiShotItem[];
  characterTags?: readonly string[];
  maxDurationSeconds: number;
}): MultiShotAssembly | null {
  const syntax = videoModelMultiShotSyntax(model);
  if (syntax === null) return null;

  const orderedShots = ordered(shots);

  // Clamp the summed scene duration to the model ceiling. The LLM can overshoot
  // the per-scene cap, so we proportionally scale each shot's duration down to
  // fit one call rather than rejecting the render. Durations stay ≥1s.
  const rawTotal = orderedShots.reduce((sum, s) => sum + s.durationSeconds, 0);
  const scale =
    rawTotal > maxDurationSeconds && rawTotal > 0
      ? maxDurationSeconds / rawTotal
      : 1;
  const scaledDurations = orderedShots.map((s) =>
    Math.max(1, Math.round(s.durationSeconds * scale))
  );
  const totalDurationSeconds = scaledDurations.reduce((a, b) => a + b, 0);

  if (syntax === 'multi-prompt-array') {
    const multiPrompt: KlingMultiPromptShot[] = orderedShots.map((item, i) => ({
      duration: scaledDurations[i] ?? item.durationSeconds,
      prompt: shotBody(item, model, characterTags),
    }));
    return { syntax, multiPrompt, totalDurationSeconds };
  }

  // prose-labels (Seedance): "Shot 1: …\n\nShot 2: …"
  const prompt = orderedShots
    .map((item, i) => `Shot ${i + 1}: ${shotBody(item, model, characterTags)}`)
    .join('\n\n');
  return { syntax, prompt, totalDurationSeconds };
}
