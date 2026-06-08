/**
 * One place that turns a v2 `StyleConfig` into the compact aesthetic prose the
 * "blob" consumers want (the script enhancer's style block, observability dumps).
 * Required look/motion fields are always emitted; the new OPTIONAL fields are
 * guarded here ONCE, so consumers don't each re-implement the `config.look?.x`
 * dance. Pure string-building — safe to import anywhere.
 */
import type { StyleConfig } from '@/lib/style/style-config';

/**
 * Render the look + motion signature of a style as labelled bullet lines under a
 * single header. Returns a multi-line string (no leading/trailing newline).
 */
export function toStyleBrief(config: StyleConfig): string {
  const { look, motion } = config;
  const lines = ['Style context (apply these aesthetics throughout):'];

  if (config.summary) lines.push(`- Summary: ${config.summary}`);
  if (config.tone) lines.push(`- Tone: ${config.tone}`);
  lines.push(`- Mood: ${look.mood}`);
  lines.push(`- Art style: ${look.artStyle}`);
  if (look.medium) lines.push(`- Medium: ${look.medium}`);
  lines.push(`- Lighting: ${look.lighting}`);
  lines.push(`- Color palette: ${look.colorPalette.join(', ')}`);
  lines.push(`- Color grading: ${look.colorGrading}`);
  if (look.texture) lines.push(`- Texture: ${look.texture}`);
  if (look.composition) lines.push(`- Composition: ${look.composition}`);
  lines.push(`- Camera: ${motion.camera}`);
  if (motion.shots) lines.push(`- Shots: ${motion.shots}`);
  if (motion.pace) lines.push(`- Pace: ${motion.pace}`);
  if (motion.energy) lines.push(`- Motion energy: ${motion.energy}/5`);
  if (config.references.length)
    lines.push(`- Reference films: ${config.references.join(', ')}`);
  if (config.design?.wardrobe)
    lines.push(`- Wardrobe: ${config.design.wardrobe}`);
  if (config.design?.setDressing)
    lines.push(`- Set dressing: ${config.design.setDressing}`);
  if (config.design?.era) lines.push(`- Era: ${config.design.era}`);
  if (config.casting) lines.push(`- Casting: ${config.casting}`);
  if (config.sound?.musicStyle)
    lines.push(`- Music: ${config.sound.musicStyle}`);

  return lines.join('\n');
}
