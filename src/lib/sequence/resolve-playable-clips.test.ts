import { describe, expect, it } from 'vitest';
import {
  resolvePlayableClips,
  type ClipScene,
  type ClipShot,
} from './resolve-playable-clips';

function shot(
  orderIndex: number,
  sceneId: string | null,
  videoUrl: string | null
): ClipShot {
  return {
    sceneId,
    orderIndex,
    videoUrl,
    videoStatus: videoUrl ? 'completed' : 'pending',
  };
}

function scene(
  id: string,
  orderIndex: number,
  videoUrl: string | null,
  renderStrategy: string | null
): ClipScene {
  return {
    id,
    orderIndex,
    videoUrl,
    videoStatus: videoUrl ? 'completed' : 'pending',
    renderStrategy,
  };
}

describe('resolvePlayableClips', () => {
  it('legacy per-shot sequence collapses to the per-shot list unchanged', () => {
    const shots = [
      shot(0, 'sceneA', '/r2/a.mp4'),
      shot(1, 'sceneB', '/r2/b.mp4'),
    ];
    const scenes = [
      scene('sceneA', 0, null, null),
      scene('sceneB', 1, null, null),
    ];
    const result = resolvePlayableClips(shots, scenes);
    expect(result.total).toBe(2);
    expect(result.ready).toBe(2);
    expect(result.clips.map((c) => c.videoUrl)).toEqual([
      '/r2/a.mp4',
      '/r2/b.mp4',
    ]);
  });

  it('a multi-shot scene contributes ONE clip from the scene video', () => {
    // sceneA is a 3-shot multi-shot render: its shots have no video; the clip
    // is on the scene row.
    const shots = [
      shot(0, 'sceneA', null),
      shot(1, 'sceneA', null),
      shot(2, 'sceneA', null),
    ];
    const scenes = [scene('sceneA', 0, '/r2/sceneA.mp4', 'multi-shot')];
    const result = resolvePlayableClips(shots, scenes);
    expect(result.total).toBe(1);
    expect(result.ready).toBe(1);
    expect(result.clips).toEqual([
      { orderIndex: 0, videoUrl: '/r2/sceneA.mp4' },
    ]);
  });

  it('interleaves a multi-shot scene clip with per-shot clips by global order', () => {
    // Order: shot0 (per-shot), sceneB multi-shot (shots 1,2), shot3 (per-shot).
    const shots = [
      shot(0, 'sceneA', '/r2/a.mp4'),
      shot(1, 'sceneB', null),
      shot(2, 'sceneB', null),
      shot(3, 'sceneC', '/r2/c.mp4'),
    ];
    const scenes = [
      scene('sceneA', 0, null, null),
      scene('sceneB', 1, '/r2/b.mp4', 'multi-shot'),
      scene('sceneC', 2, null, null),
    ];
    const result = resolvePlayableClips(shots, scenes);
    expect(result.clips.map((c) => c.videoUrl)).toEqual([
      '/r2/a.mp4',
      '/r2/b.mp4',
      '/r2/c.mp4',
    ]);
    expect(result.total).toBe(3); // shot0 + sceneB + shot3
  });

  it('counts a not-yet-rendered multi-shot scene as 1 unit not ready', () => {
    const shots = [shot(0, 'sceneA', null), shot(1, 'sceneA', null)];
    const scenes = [scene('sceneA', 0, null, 'multi-shot')];
    const result = resolvePlayableClips(shots, scenes);
    expect(result.total).toBe(1);
    expect(result.ready).toBe(0);
    expect(result.clips).toEqual([]);
  });

  it('treats an unknown/null renderStrategy as per-shot', () => {
    const shots = [shot(0, 'sceneA', '/r2/a.mp4')];
    const scenes = [scene('sceneA', 0, '/r2/ignored.mp4', null)];
    const result = resolvePlayableClips(shots, scenes);
    // Per-shot path: the shot's video is used, the scene video is ignored.
    expect(result.clips).toEqual([{ orderIndex: 0, videoUrl: '/r2/a.mp4' }]);
    expect(result.total).toBe(1);
  });
});
