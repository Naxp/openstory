import type { Frame } from '@/lib/db/schema/frames';
import type { Sequence } from '@/lib/db/schema/sequences';
import { describe, expect, it } from 'vitest';
import { buildSequenceState } from './state';

function makeFrame(overrides: Partial<Frame> = {}): Frame {
  return {
    id: 'frame-1',
    sequenceId: 'seq-1',
    orderIndex: 0,
    description: 'A scene',
    durationMs: 3000,
    thumbnailUrl: null,
    thumbnailPath: null,
    thumbnailStatus: 'pending',
    thumbnailWorkflowRunId: null,
    thumbnailGeneratedAt: null,
    thumbnailError: null,
    imageModel: 'nano_banana_2',
    imagePrompt: null,
    variantImageUrl: null,
    variantImageStatus: 'pending',
    variantWorkflowRunId: null,
    variantImageGeneratedAt: null,
    variantImageError: null,
    videoUrl: null,
    videoPath: null,
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
    thumbnailInputHash: null,
    variantImageInputHash: null,
    videoInputHash: null,
    audioInputHash: null,
    visualPromptInputHash: null,
    motionPromptInputHash: null,
    previewThumbnailUrl: null,
    metadata: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeSequence(overrides: Partial<Sequence> = {}): Sequence {
  return {
    id: 'seq-1',
    teamId: 'team-1',
    title: 'Test Sequence',
    script: 'A test script',
    status: 'processing',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-02T00:00:00Z'),
    createdBy: null,
    updatedBy: null,
    styleId: 'style-1',
    aspectRatio: '16:9',
    analysisModel: 'anthropic/claude-haiku-4.5',
    analysisDurationMs: 0,
    imageModel: 'nano_banana_2',
    videoModel: 'wan_i2v',
    workflow: null,
    musicUrl: null,
    musicPath: null,
    musicStatus: 'pending',
    musicGeneratedAt: null,
    musicError: null,
    musicModel: null,
    musicPrompt: null,
    musicTags: null,
    musicPromptInputHash: null,
    statusError: null,
    posterUrl: null,
    autoGenerateMotion: false,
    autoGenerateMusic: false,
    suggestedTalentIds: null,
    suggestedLocationIds: null,
    ...overrides,
  };
}

function depsWithFrames(frames: Frame[]) {
  return { frames: { listBySequence: async () => frames } };
}

describe('buildSequenceState', () => {
  it('maps top-level sequence fields and ISO timestamps', async () => {
    const sequence = makeSequence({
      posterUrl: 'https://cdn/poster.png',
      musicStatus: 'completed',
      musicUrl: 'https://cdn/music.mp3',
      statusError: null,
    });
    const state = await buildSequenceState(depsWithFrames([]), sequence);

    expect(state).toMatchObject({
      id: 'seq-1',
      title: 'Test Sequence',
      status: 'processing',
      aspectRatio: '16:9',
      poster: { url: 'https://cdn/poster.png' },
      music: { status: 'completed', url: 'https://cdn/music.mp3' },
    });
    expect(state.createdAt).toBe('2026-01-01T00:00:00.000Z');
    expect(state.counts).toEqual({ frames: 0, imagesReady: 0, videosReady: 0 });
    expect(state.poster).not.toBeNull();
  });

  it('null poster and falls back to pending music status', async () => {
    const state = await buildSequenceState(
      depsWithFrames([]),
      makeSequence({ posterUrl: null, musicStatus: null })
    );
    expect(state.poster).toBeNull();
    expect(state.music.status).toBe('pending');
  });

  it('derives per-frame image/video status and counts, ordered by index', async () => {
    const frames = [
      makeFrame({
        id: 'f2',
        orderIndex: 1,
        videoUrl: 'https://cdn/v2.mp4',
        videoStatus: 'completed',
      }),
      makeFrame({
        id: 'f1',
        orderIndex: 0,
        thumbnailUrl: 'https://cdn/t1.png',
      }),
    ];
    const state = await buildSequenceState(
      depsWithFrames(frames),
      makeSequence()
    );

    // ordered by orderIndex
    expect(state.frames.map((f) => f.id)).toEqual(['f1', 'f2']);

    const [first, second] = state.frames;
    expect(first).toMatchObject({
      id: 'f1',
      image: { status: 'completed', url: 'https://cdn/t1.png' },
      video: { status: 'pending', url: null },
    });
    expect(second).toMatchObject({
      id: 'f2',
      image: { status: 'pending', url: null },
      video: { status: 'completed', url: 'https://cdn/v2.mp4' },
    });
    // No scene metadata set → title falls back to null.
    expect(first?.title).toBeNull();

    expect(state.counts).toEqual({
      frames: 2,
      imagesReady: 1,
      videosReady: 1,
    });
  });

  it('treats a preview thumbnail as an available image', async () => {
    const state = await buildSequenceState(
      depsWithFrames([
        makeFrame({
          thumbnailUrl: null,
          previewThumbnailUrl: 'https://cdn/p.png',
        }),
      ]),
      makeSequence()
    );
    expect(state.frames[0]?.image).toEqual({
      status: 'completed',
      url: 'https://cdn/p.png',
    });
  });
});
