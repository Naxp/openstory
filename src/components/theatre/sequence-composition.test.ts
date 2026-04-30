import { describe, expect, test } from 'bun:test';
import type { Frame } from '@/types/database';
import {
  buildSequenceComposition,
  computeCompositionSrc,
} from './sequence-composition';

const baseFrame = (overrides: Partial<Frame>): Frame =>
  ({
    id: overrides.id ?? 'f',
    sequenceId: 'seq1',
    orderIndex: 0,
    description: null,
    durationMs: 3000,
    thumbnailUrl: null,
    previewThumbnailUrl: null,
    thumbnailPath: null,
    variantImageUrl: null,
    variantImageStatus: 'pending',
    variantWorkflowRunId: null,
    videoUrl: null,
    videoPath: null,
    thumbnailStatus: 'pending',
    thumbnailWorkflowRunId: null,
    thumbnailGeneratedAt: null,
    thumbnailError: null,
    imageModel: 'x',
    imagePrompt: null,
    videoStatus: 'pending',
    videoWorkflowRunId: null,
    videoGeneratedAt: null,
    videoError: null,
    motionPrompt: null,
    motionModel: null,
    audioUrl: null,
    audioPath: null,
    audioStatus: 'pending',
    audioWorkflowRunId: null,
    audioGeneratedAt: null,
    audioError: null,
    audioModel: null,
    metadata: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    ...overrides,
  }) as Frame;

describe('buildSequenceComposition', () => {
  test('returns empty composition when no playable frames', () => {
    const result = buildSequenceComposition({
      sequenceId: 'seq1',
      frames: [],
      musicUrl: null,
      aspectRatio: '16:9',
    });
    expect(result.playableFrameCount).toBe(0);
    expect(result.totalDurationSeconds).toBe(0);
    expect(result.html).toBe('');
  });

  test('orders frames by orderIndex and accumulates start times', () => {
    const frames = [
      baseFrame({
        id: 'b',
        orderIndex: 1,
        videoStatus: 'completed',
        videoUrl: 'https://r2/b.mp4',
        durationMs: 4500,
      }),
      baseFrame({
        id: 'a',
        orderIndex: 0,
        videoStatus: 'completed',
        videoUrl: 'https://r2/a.mp4',
        durationMs: 3000,
      }),
    ];
    const result = buildSequenceComposition({
      sequenceId: 'seq1',
      frames,
      musicUrl: null,
      aspectRatio: '16:9',
    });

    expect(result.playableFrameCount).toBe(2);
    expect(result.totalDurationSeconds).toBe(7.5);

    const aIdx = result.html.indexOf('https://r2/a.mp4');
    const bIdx = result.html.indexOf('https://r2/b.mp4');
    expect(aIdx).toBeGreaterThan(-1);
    expect(bIdx).toBeGreaterThan(aIdx); // 'a' (orderIndex 0) appears first

    expect(result.html).toContain('data-start="0" data-duration="3"');
    expect(result.html).toContain('data-start="3" data-duration="4.5"');
  });

  test('skips frames that are not completed or have no videoUrl', () => {
    const frames = [
      baseFrame({
        id: 'a',
        orderIndex: 0,
        videoStatus: 'completed',
        videoUrl: 'https://r2/a.mp4',
      }),
      baseFrame({
        id: 'b',
        orderIndex: 1,
        videoStatus: 'generating',
        videoUrl: null,
      }),
      baseFrame({
        id: 'c',
        orderIndex: 2,
        videoStatus: 'completed',
        videoUrl: null,
      }),
      baseFrame({
        id: 'd',
        orderIndex: 3,
        videoStatus: 'failed',
        videoUrl: 'https://r2/d.mp4',
      }),
    ];
    const result = buildSequenceComposition({
      sequenceId: 'seq1',
      frames,
      musicUrl: null,
      aspectRatio: '16:9',
    });
    expect(result.playableFrameCount).toBe(1);
    expect(result.html).toContain('https://r2/a.mp4');
    expect(result.html).not.toContain('https://r2/d.mp4');
  });

  test('omits audio track when musicUrl is missing', () => {
    const result = buildSequenceComposition({
      sequenceId: 'seq1',
      frames: [
        baseFrame({
          orderIndex: 0,
          videoStatus: 'completed',
          videoUrl: 'https://r2/a.mp4',
        }),
      ],
      musicUrl: null,
      aspectRatio: '16:9',
    });
    expect(result.html).not.toContain('<audio');
  });

  test('includes audio track spanning full duration when musicUrl present', () => {
    const result = buildSequenceComposition({
      sequenceId: 'seq1',
      frames: [
        baseFrame({
          id: 'a',
          orderIndex: 0,
          videoStatus: 'completed',
          videoUrl: 'https://r2/a.mp4',
          durationMs: 2000,
        }),
        baseFrame({
          id: 'b',
          orderIndex: 1,
          videoStatus: 'completed',
          videoUrl: 'https://r2/b.mp4',
          durationMs: 3000,
        }),
      ],
      musicUrl: 'https://r2/music.mp3',
      aspectRatio: '16:9',
    });
    expect(result.html).toContain('https://r2/music.mp3');
    expect(result.html).toContain(
      'data-start="0" data-duration="5" data-track-index="1"'
    );
  });

  test('uses aspect-ratio-derived stage dimensions', () => {
    const portrait = buildSequenceComposition({
      sequenceId: 'seq1',
      frames: [
        baseFrame({
          orderIndex: 0,
          videoStatus: 'completed',
          videoUrl: 'https://r2/a.mp4',
        }),
      ],
      musicUrl: null,
      aspectRatio: '9:16',
    });
    expect(portrait.html).toContain('data-width="900"');
    expect(portrait.html).toContain('data-height="1600"');
  });

  test('escapes attribute-breaking characters in URLs', () => {
    const result = buildSequenceComposition({
      sequenceId: 'seq1',
      frames: [
        baseFrame({
          orderIndex: 0,
          videoStatus: 'completed',
          videoUrl: 'https://r2/a.mp4?token="abc"&x=1',
        }),
      ],
      musicUrl: null,
      aspectRatio: '16:9',
    });
    expect(result.html).not.toMatch(/src="https:\/\/r2\/a\.mp4\?token="/);
    expect(result.html).toContain('&quot;abc&quot;');
    expect(result.html).toContain('&amp;x=1');
  });

  test('references vendored runtime scripts, not the CDN', () => {
    const result = buildSequenceComposition({
      sequenceId: 'seq1',
      frames: [
        baseFrame({
          orderIndex: 0,
          videoStatus: 'completed',
          videoUrl: 'https://r2/a.mp4',
        }),
      ],
      musicUrl: null,
      aspectRatio: '16:9',
    });
    expect(result.html).toContain(
      '<script src="/vendor/gsap.min.js"></script>'
    );
    expect(result.html).toContain(
      '<script src="/vendor/hyperframe.runtime.iife.js"></script>'
    );
    expect(result.html).not.toContain('cdn.jsdelivr.net');
  });
});

describe('computeCompositionSrc', () => {
  test('returns null src when no playable frames', () => {
    const result = computeCompositionSrc({
      sequenceId: 'seq1',
      frames: [],
      musicUrl: null,
      aspectRatio: '16:9',
    });
    expect(result.src).toBeNull();
    expect(result.playableFrameCount).toBe(0);
    expect(result.totalDurationSeconds).toBe(0);
  });

  test('builds same-origin path with cache-bust version', () => {
    const result = computeCompositionSrc({
      sequenceId: 'seq1',
      frames: [
        baseFrame({
          orderIndex: 0,
          videoStatus: 'completed',
          videoUrl: 'https://r2/a.mp4',
          durationMs: 3000,
        }),
      ],
      musicUrl: null,
      aspectRatio: '16:9',
    });
    expect(result.src).toMatch(
      /^\/api\/sequences\/seq1\/composition\.html\?v=[0-9a-z]+$/
    );
    expect(result.playableFrameCount).toBe(1);
    expect(result.totalDurationSeconds).toBe(3);
  });

  test('version key changes when playable content changes', () => {
    const a = computeCompositionSrc({
      sequenceId: 'seq1',
      frames: [
        baseFrame({
          id: 'a',
          orderIndex: 0,
          videoStatus: 'completed',
          videoUrl: 'https://r2/a.mp4',
        }),
      ],
      musicUrl: null,
      aspectRatio: '16:9',
    });
    const b = computeCompositionSrc({
      sequenceId: 'seq1',
      frames: [
        baseFrame({
          id: 'a',
          orderIndex: 0,
          videoStatus: 'completed',
          videoUrl: 'https://r2/a.mp4',
        }),
        baseFrame({
          id: 'b',
          orderIndex: 1,
          videoStatus: 'completed',
          videoUrl: 'https://r2/b.mp4',
        }),
      ],
      musicUrl: null,
      aspectRatio: '16:9',
    });
    expect(a.src).not.toBe(b.src);
  });

  test('version key is stable across pending-only changes', () => {
    const playable = baseFrame({
      id: 'a',
      orderIndex: 0,
      videoStatus: 'completed',
      videoUrl: 'https://r2/a.mp4',
    });
    const a = computeCompositionSrc({
      sequenceId: 'seq1',
      frames: [playable],
      musicUrl: null,
      aspectRatio: '16:9',
    });
    const b = computeCompositionSrc({
      sequenceId: 'seq1',
      frames: [
        playable,
        baseFrame({ id: 'b', orderIndex: 1, videoStatus: 'pending' }),
      ],
      musicUrl: null,
      aspectRatio: '16:9',
    });
    expect(a.src).toBe(b.src);
  });
});
