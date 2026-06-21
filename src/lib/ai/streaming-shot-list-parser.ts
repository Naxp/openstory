/**
 * Streaming Shot-List Parser (#910)
 * ============================================================================
 *
 * The shot-list analysis pass (#908 schema) emits scenes that each own a
 * `shots[]` array. This parser is the streaming sibling of
 * `streaming-scene-parser.ts`: it incrementally extracts SCENE-level tiles from
 * the partial JSON stream so the UI can show scenes as they arrive.
 *
 * It deliberately only surfaces SCENE-level fields (title / script extract /
 * duration / continuity). The per-shot rows are NOT built from the stream —
 * they are derived from the final, fully-validated `SceneWithShotsResult` in the
 * workflow's persist step (`deriveShotScenes`). Mid-stream a scene's `shots[]`
 * is usually incomplete, and the live tile only needs scene-level data, so
 * keeping shots out of the stream avoids parsing half-formed shot objects.
 *
 * Mirrors the lenient-completion strategy of `streaming-scene-parser.ts`:
 * `originalScript` + `metadata` are required KEYS (a scene missing either is
 * "not complete yet") with defaulted contents.
 */

import { parsePartialJSON } from '@tanstack/ai';
import { z } from 'zod';
import {
  type CharacterBibleEntry,
  characterBibleEntrySchema,
  dialogueLineSchema,
  type LocationBibleEntry,
  locationBibleEntrySchema,
} from './scene-analysis.schema';
import {
  collectComplete,
  isRecord,
  stripCodeFences,
} from './streaming-scene-parser';

const lenientOriginalScript = z.object({
  extract: z.string().catch(''),
  dialogue: z.array(dialogueLineSchema).catch([]),
});

const lenientMetadata = z.object({
  title: z.string().catch('Untitled Scene'),
  durationSeconds: z.number().catch(3),
  location: z.string().catch(''),
  timeOfDay: z.string().catch(''),
  storyBeat: z.string().catch(''),
});

const lenientContinuity = z
  .object({
    characterTags: z.array(z.string()).catch([]),
    environmentTag: z.string().catch(''),
    elementTags: z.array(z.string()).catch([]),
    colorPalette: z.string().catch(''),
    lightingSetup: z.string().catch(''),
    styleTag: z.string().catch(''),
  })
  .catch({
    characterTags: [],
    environmentTag: '',
    elementTags: [],
    colorPalette: '',
    lightingSetup: '',
    styleTag: '',
  });

/**
 * Scene-level shape for streaming tiles. `shots` is intentionally NOT parsed
 * here — it is allowed to be absent/partial mid-stream and is rebuilt from the
 * final validated result downstream.
 */
const shotListSceneSchema = z.object({
  sceneId: z.string(),
  sceneNumber: z.number(),
  originalScript: lenientOriginalScript,
  metadata: lenientMetadata,
  continuity: lenientContinuity,
});

export type ShotListStreamedScene = z.infer<typeof shotListSceneSchema>;

export type StreamedShotListEvent =
  | { type: 'title'; title: string }
  | { type: 'scene'; scene: ShotListStreamedScene; index: number }
  | { type: 'scene:updated'; scene: ShotListStreamedScene; index: number }
  | { type: 'characterBible'; bible: CharacterBibleEntry[] }
  | { type: 'locationBible'; bible: LocationBibleEntry[] };

export function createStreamingShotListParser() {
  let lastEmittedSceneCount = 0;
  let titleEmitted = false;
  let characterBibleEmitted = false;
  let locationBibleEmitted = false;
  let emittedTitles: Map<number, string> = new Map();

  return {
    feed(accumulated: string): StreamedShotListEvent[] {
      const events: StreamedShotListEvent[] = [];

      const raw = parsePartialJSON(stripCodeFences(accumulated));
      if (raw === undefined) return events;
      if (!isRecord(raw)) return events;

      if (!titleEmitted) {
        const pm = raw.projectMetadata;
        if (
          isRecord(pm) &&
          typeof pm.title === 'string' &&
          pm.title.length > 0
        ) {
          titleEmitted = true;
          events.push({ type: 'title', title: pm.title });
        }
      }

      const scenes = raw.scenes;
      if (!Array.isArray(scenes)) return events;

      // Updates to previously emitted scenes (title fills in late).
      for (let i = 0; i < lastEmittedSceneCount && i < scenes.length; i++) {
        const result = shotListSceneSchema.safeParse(scenes[i]);
        if (result.success) {
          const currentTitle = result.data.metadata.title || '';
          if (currentTitle !== emittedTitles.get(i)) {
            emittedTitles.set(i, currentTitle);
            events.push({
              type: 'scene:updated',
              scene: result.data,
              index: i,
            });
          }
        }
      }

      // Newly complete scenes.
      for (let i = lastEmittedSceneCount; i < scenes.length; i++) {
        const result = shotListSceneSchema.safeParse(scenes[i]);
        if (result.success) {
          emittedTitles.set(i, result.data.metadata.title || '');
          events.push({ type: 'scene', scene: result.data, index: i });
          lastEmittedSceneCount = i + 1;
        } else {
          break;
        }
      }

      if (!characterBibleEmitted && Array.isArray(raw.characterBible)) {
        const complete = collectComplete(
          raw.characterBible,
          characterBibleEntrySchema
        );
        if (complete.length > 0) {
          characterBibleEmitted = true;
          events.push({ type: 'characterBible', bible: complete });
        }
      }

      if (!locationBibleEmitted && Array.isArray(raw.locationBible)) {
        const complete = collectComplete(
          raw.locationBible,
          locationBibleEntrySchema
        );
        if (complete.length > 0) {
          locationBibleEmitted = true;
          events.push({ type: 'locationBible', bible: complete });
        }
      }

      return events;
    },

    reset() {
      lastEmittedSceneCount = 0;
      titleEmitted = false;
      characterBibleEmitted = false;
      locationBibleEmitted = false;
      emittedTitles = new Map();
    },
  };
}
