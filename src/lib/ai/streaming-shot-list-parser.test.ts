import { describe, expect, test } from 'vitest';
import { createStreamingShotListParser } from './streaming-shot-list-parser';

const makeScene = (n: number, shots: unknown[] = []) => ({
  sceneId: `scene-${n}`,
  sceneNumber: n,
  originalScript: { extract: `Scene ${n} action`, dialogue: [] },
  metadata: {
    title: `Scene ${n} Title`,
    durationSeconds: 5,
    location: 'INT. OFFICE',
    timeOfDay: 'day',
    storyBeat: 'exposition',
  },
  continuity: {
    characterTags: [],
    environmentTag: 'office',
    elementTags: [],
    colorPalette: 'cool blues',
    lightingSetup: 'soft key',
    styleTag: 'cinematic',
  },
  shots,
});

describe('createStreamingShotListParser', () => {
  test('emits title from projectMetadata', () => {
    const parser = createStreamingShotListParser();
    const events = parser.feed(
      '{"status":"success","projectMetadata":{"title":"Shot List Movie"'
    );
    expect(events).toEqual([{ type: 'title', title: 'Shot List Movie' }]);
  });

  test('emits a scene tile even when its shots[] is still streaming', () => {
    const parser = createStreamingShotListParser();
    // A scene whose shots array is present but only partially streamed: the
    // scene-level fields are complete, so the tile should emit.
    const partial = JSON.stringify({
      status: 'success',
      projectMetadata: { title: 'M' },
      scenes: [makeScene(1, [{ shotNumber: 1, action: 'she wal' }])],
    });
    const events = parser.feed(partial);
    const sceneEvents = events.filter((e) => e.type === 'scene');
    expect(sceneEvents).toHaveLength(1);
    if (sceneEvents[0]?.type !== 'scene') throw new Error('expected scene');
    expect(sceneEvents[0].scene.sceneId).toBe('scene-1');
    expect(sceneEvents[0].scene.metadata.title).toBe('Scene 1 Title');
  });

  test('emits multiple scenes as they complete, in order', () => {
    const parser = createStreamingShotListParser();
    const full = JSON.stringify({
      status: 'success',
      projectMetadata: { title: 'M' },
      scenes: [
        makeScene(1, [{ shotNumber: 1 }]),
        makeScene(2, [{ shotNumber: 1 }, { shotNumber: 2 }]),
      ],
    });
    const events = parser.feed(full);
    const ids = events
      .filter((e) => e.type === 'scene')
      .map((e) => e.scene.sceneId);
    expect(ids).toEqual(['scene-1', 'scene-2']);
  });

  test('does not re-emit an already-emitted scene', () => {
    const parser = createStreamingShotListParser();
    const one = JSON.stringify({
      projectMetadata: { title: 'M' },
      scenes: [makeScene(1)],
    });
    parser.feed(one);
    const again = parser.feed(one);
    expect(again.filter((e) => e.type === 'scene')).toHaveLength(0);
  });

  test('emits a character bible when its entries fully stream', () => {
    const parser = createStreamingShotListParser();
    const withBible = JSON.stringify({
      projectMetadata: { title: 'M' },
      scenes: [makeScene(1)],
      characterBible: [
        {
          characterId: 'jack',
          name: 'Jack',
          age: '30s',
          gender: 'male',
          ethnicity: 'white',
          physicalDescription: 'weathered, tall',
          standardClothing: 'denim jacket',
          distinguishingFeatures: 'scar on cheek',
          consistencyTag: 'jack-weathered',
        },
      ],
    });
    const events = parser.feed(withBible);
    expect(events.some((e) => e.type === 'characterBible')).toBe(true);
  });
});
