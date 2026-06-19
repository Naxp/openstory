import { describe, expect, it } from 'vitest';
import type { StyleConfig } from '@/lib/db/schema/libraries';
import { dbSceneId } from '@/lib/db/schema';
import type { Scene } from './scene-analysis.schema';
import {
  ACTIVE_MAX_SHOTS_PER_SCENE,
  buildSceneInserts,
  buildShotInsertsForScene,
  shotMetadataSceneId,
} from './scene-persistence';
import type { SceneWithShots } from './shot-list.schema';

const styleConfig: StyleConfig = {
  mood: 'tense',
  artStyle: 'neo-noir cinematic',
  lighting: 'low key',
  colorPalette: ['#111', '#eee'],
  cameraWork: 'handheld',
  referenceFilms: ['Blade Runner'],
  colorGrading: 'teal and orange',
};

function makeSceneWithShots(
  overrides: Partial<SceneWithShots> = {}
): SceneWithShots {
  return {
    sceneId: 'analysis-scene-1',
    sceneNumber: 1,
    originalScript: { extract: 'She opens the door.', dialogue: [] },
    metadata: {
      title: 'The Doorway',
      durationSeconds: 12,
      location: 'INT. HALLWAY - NIGHT',
      timeOfDay: 'night',
      storyBeat: 'rising tension',
    },
    continuity: {
      characterTags: ['sarah'],
      environmentTag: 'dim_hallway',
      elementTags: [],
      colorPalette: 'cold blues',
      lightingSetup: 'single overhead bulb',
      styleTag: 'noir',
    },
    dialoguePresent: false,
    continuousFromPrevious: false,
    shots: [
      {
        shotNumber: 1,
        framing: {
          shotSize: 'wide',
          angle: 'eye level',
          composition: 'centered',
          subjectStartState: 'Sarah at the far end',
        },
        action: 'Sarah walks toward the door',
        cameraMovement: { move: 'dolly', pacing: 'slow' },
        soundCue: 'distant hum',
        durationSeconds: 6,
      },
      {
        shotNumber: 2,
        framing: {
          shotSize: 'close-up',
          angle: 'low angle',
          composition: 'hand on handle',
          subjectStartState: "Sarah's fingers on the handle",
        },
        action: 'she turns the handle',
        cameraMovement: { move: 'push-in', pacing: 'gradual' },
        soundCue: 'handle click',
        durationSeconds: 6,
      },
    ],
    ...overrides,
  };
}

function makeScene(overrides: Partial<Scene> = {}): Scene {
  return {
    sceneId: 'analysis-scene-1',
    sceneNumber: 1,
    originalScript: { extract: 'A man walks in.', dialogue: [] },
    metadata: {
      title: 'Entrance',
      durationSeconds: 4,
      location: 'INT. OFFICE - DAY',
      timeOfDay: 'day',
      storyBeat: 'introduction',
    },
    continuity: {
      characterTags: ['man'],
      environmentTag: 'office',
      elementTags: [],
      colorPalette: 'warm',
      lightingSetup: 'soft daylight',
      styleTag: 'cinematic',
    },
    ...overrides,
  };
}

describe('buildSceneInserts', () => {
  it('maps scene-level fields onto scene rows with 0-based orderIndex', () => {
    const rows = buildSceneInserts('seq-1', [
      makeScene(),
      makeScene({ sceneId: 'analysis-scene-2', sceneNumber: 2 }),
    ]);

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      sequenceId: 'seq-1',
      orderIndex: 0,
      location: 'INT. OFFICE - DAY',
      timeOfDay: 'day',
      storyBeat: 'introduction',
      title: 'Entrance',
    });
    expect(rows[1]?.orderIndex).toBe(1);
  });

  it('carries continuity and original script onto the scene row', () => {
    const [row] = buildSceneInserts('seq-1', [makeScene()]);
    expect(row?.continuity?.environmentTag).toBe('office');
    expect(row?.originalScript?.extract).toBe('A man walks in.');
  });

  it('defaults missing scene metadata to null (no analysis metadata yet)', () => {
    const [row] = buildSceneInserts('seq-1', [
      makeScene({ metadata: undefined, continuity: undefined }),
    ]);
    expect(row?.location).toBeNull();
    expect(row?.timeOfDay).toBeNull();
    expect(row?.storyBeat).toBeNull();
    expect(row?.title).toBeNull();
    expect(row?.continuity).toBeNull();
  });

  it('returns an empty array for no scenes', () => {
    expect(buildSceneInserts('seq-1', [])).toEqual([]);
  });
});

describe('shotMetadataSceneId', () => {
  it('keeps the bare analysis id for a single-shot scene', () => {
    expect(shotMetadataSceneId('scene-1', 1, 1)).toBe('scene-1');
  });

  it('suffixes #shotNumber for a multi-shot scene', () => {
    expect(shotMetadataSceneId('scene-1', 1, 3)).toBe('scene-1#1');
    expect(shotMetadataSceneId('scene-1', 2, 3)).toBe('scene-1#2');
  });
});

describe('buildShotInsertsForScene', () => {
  const sceneId = dbSceneId('scene-row-ulid');

  it('gates a multi-shot scene to ONE persisted shot until #953 (bare token)', () => {
    // makeSceneWithShots() emits 2 shots; ACTIVE_MAX_SHOTS_PER_SCENE caps
    // persistence to 1 (multi-shot emission gated off pending per-shot images).
    // shotCount → 1 ⇒ the metadata.sceneId token stays the BARE analysis id.
    const rows = buildShotInsertsForScene({
      sequenceId: 'seq-1',
      sceneId,
      scene: makeSceneWithShots(),
      styleConfig,
      baseOrderIndex: 0,
    });

    expect(rows).toHaveLength(ACTIVE_MAX_SHOTS_PER_SCENE);
    expect(rows).toHaveLength(1);
    // Bare id (no `#shotNumber` suffix) — so the per-shot downstream chain and
    // render strategy behave exactly as a single-shot scene.
    expect(rows[0]?.metadata?.sceneId).toBe('analysis-scene-1');
    expect(rows[0]?.shotNumber).toBe(1);
    expect(rows[0]?.orderIndex).toBe(0);
    expect(rows[0]?.sceneId).toBe(sceneId);
  });

  it('preserves the bare analysis id for a single-shot scene (legacy parity)', () => {
    const oneShot = makeSceneWithShots({
      shots: makeSceneWithShots().shots.slice(0, 1),
    });
    const rows = buildShotInsertsForScene({
      sequenceId: 'seq-1',
      sceneId,
      scene: oneShot,
      styleConfig,
      baseOrderIndex: 5,
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]?.metadata?.sceneId).toBe('analysis-scene-1');
    expect(rows[0]?.shotNumber).toBe(1);
    expect(rows[0]?.orderIndex).toBe(5);
  });

  it('carries the derived visual and motion prompts onto each shot', () => {
    const [shot] = buildShotInsertsForScene({
      sequenceId: 'seq-1',
      sceneId,
      scene: makeSceneWithShots(),
      styleConfig,
      baseOrderIndex: 0,
    });
    expect(shot?.metadata?.prompts?.visual?.fullPrompt).toBeTruthy();
    expect(shot?.metadata?.prompts?.motion?.fullPrompt).toBeTruthy();
  });

  it('starts each scene at its baseOrderIndex (one shot while gated)', () => {
    // Gated to 1 shot/scene: a scene at base 2 persists a single shot at 2.
    // (#953 re-enables N shots → baseOrderIndex..baseOrderIndex+N-1.)
    const rowsB = buildShotInsertsForScene({
      sequenceId: 'seq-1',
      sceneId,
      scene: makeSceneWithShots({ sceneId: 'analysis-scene-2' }),
      styleConfig,
      baseOrderIndex: 2,
    });
    expect(rowsB.map((r) => r.orderIndex)).toEqual([2]);
  });
});
