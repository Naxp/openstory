import { describe, expect, it, vi } from 'vitest';
import {
  createSampleSequence,
  orderedFrameVideos,
  waitForSampleSequence,
  type SampleSequenceState,
} from './sample-pipeline';

const CONFIG = { baseUrl: 'http://localhost:3000', apiKey: 'osk_test' };

function jsonResponse(body: object, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** The public API's 429 shape — always carries Retry-After (here 0s for fast tests). */
function rateLimitResponse(): Response {
  return new Response(
    JSON.stringify({
      error: { code: 'RATE_LIMITED', message: 'API key rate limit exceeded.' },
    }),
    { status: 429, headers: { 'retry-after': '0' } }
  );
}

function stateFixture(
  overrides: Omit<Partial<SampleSequenceState>, 'counts'> & {
    counts?: Partial<SampleSequenceState['counts']>;
  } = {}
): SampleSequenceState {
  return {
    id: 'seq_1',
    status: 'processing',
    statusError: null,
    frames: [],
    ...overrides,
    counts: {
      frames: 0,
      imagesReady: 0,
      videosReady: 0,
      videosFailed: 0,
      ...overrides.counts,
    },
  };
}

describe('createSampleSequence', () => {
  it('posts the one-shot body and returns the created sequence', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        jsonResponse(
          { sequences: [{ id: 'seq_1', workflowRunId: 'run_1' }] },
          202
        )
      );

    const created = await createSampleSequence(
      { ...CONFIG, fetchImpl },
      {
        script: 'A violin maker at work.',
        title: 'Style sample — Documentary (canonical)',
        enhance: 'off',
        styleName: 'Documentary',
        aspectRatio: '16:9',
        imageModel: 'nano_banana_2',
        videoModel: 'kling_2_5_turbo_pro',
      }
    );

    expect(created).toEqual({
      id: 'seq_1',
      workflowRunId: 'run_1',
      enhancedScript: undefined,
    });
    const [url, init] = fetchImpl.mock.calls[0] ?? [];
    expect(url).toBe('http://localhost:3000/api/v1/sequences');
    expect(init.headers['x-api-key']).toBe('osk_test');
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({
      script: 'A violin maker at work.',
      enhance: 'off',
      style: 'Documentary',
      aspectRatio: '16:9',
      imageModels: ['nano_banana_2'],
      videoModels: ['kling_2_5_turbo_pro'],
      motion: true,
      music: true,
    });
    expect(body).not.toHaveProperty('targetSeconds');
  });

  it('passes enhance always + targetSeconds and returns the enhanced script', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(
        {
          sequences: [{ id: 'seq_2', workflowRunId: 'run_2' }],
          enhancedScript: 'INT. WORKSHOP - MORNING. Elena planes the spruce…',
        },
        202
      )
    );

    const created = await createSampleSequence(
      { ...CONFIG, fetchImpl },
      {
        script: 'A craftsperson at work in their studio.',
        title: 'Style sample — Documentary (canonical)',
        enhance: 'always',
        targetSeconds: 15,
        styleName: 'Documentary',
        aspectRatio: '16:9',
        imageModel: 'nano_banana_2',
        videoModel: 'kling_2_5_turbo_pro',
      }
    );

    expect(created).toEqual({
      id: 'seq_2',
      workflowRunId: 'run_2',
      enhancedScript: 'INT. WORKSHOP - MORNING. Elena planes the spruce…',
    });
    const [, init] = fetchImpl.mock.calls[0] ?? [];
    expect(JSON.parse(init.body)).toMatchObject({
      enhance: 'always',
      targetSeconds: 15,
    });
  });

  it('retries a 429 per Retry-After and succeeds', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(rateLimitResponse())
      .mockResolvedValueOnce(rateLimitResponse())
      .mockResolvedValue(
        jsonResponse(
          { sequences: [{ id: 'seq_3', workflowRunId: 'run_3' }] },
          202
        )
      );

    const created = await createSampleSequence(
      { ...CONFIG, fetchImpl },
      {
        script: 'A violin maker at work.',
        title: 't',
        enhance: 'off',
        styleName: 'Documentary',
        aspectRatio: '16:9',
        imageModel: 'nano_banana_2',
        videoModel: 'kling_2_5_turbo_pro',
      }
    );

    expect(created.id).toBe('seq_3');
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('gives up on a persistent 429 with the rate-limit detail', async () => {
    const fetchImpl = vi.fn(() => Promise.resolve(rateLimitResponse()));

    await expect(
      createSampleSequence(
        { ...CONFIG, fetchImpl },
        {
          script: 'x'.repeat(20),
          title: 't',
          enhance: 'off',
          styleName: 'Documentary',
          aspectRatio: '16:9',
          imageModel: 'nano_banana_2',
          videoModel: 'kling_2_5_turbo_pro',
        }
      )
    ).rejects.toThrow(/429.*RATE_LIMITED/s);
    // 1 initial + 10 retries
    expect(fetchImpl).toHaveBeenCalledTimes(11);
  });

  it('throws with status + body detail on a non-2xx response', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response('{"error":"No style found matching \\"Nope\\""}', {
        status: 404,
      })
    );

    await expect(
      createSampleSequence(
        { ...CONFIG, fetchImpl },
        {
          script: 'x'.repeat(20),
          title: 't',
          enhance: 'off',
          styleName: 'Nope',
          aspectRatio: '16:9',
          imageModel: 'nano_banana_2',
          videoModel: 'kling_2_5_turbo_pro',
        }
      )
    ).rejects.toThrow(/404.*No style found/s);
  });
});

describe('waitForSampleSequence', () => {
  const wait = (fetchImpl: typeof fetch, onProgress?: () => void) =>
    waitForSampleSequence(
      { ...CONFIG, fetchImpl },
      { id: 'seq_1', pollDelayMs: 0, onProgress }
    );

  it('polls until terminal, emitting progress on each advance', async () => {
    const states = [
      stateFixture({ counts: { frames: 3, imagesReady: 1 } }),
      stateFixture({ counts: { frames: 3, imagesReady: 3, videosReady: 1 } }),
      stateFixture({
        status: 'completed',
        frames: [
          {
            id: 'f1',
            orderIndex: 0,
            title: null,
            image: { status: 'completed', url: 'https://r2/img1.webp' },
            video: { status: 'completed', url: 'https://r2/v1.mp4' },
          },
        ],
        counts: { frames: 1, imagesReady: 1, videosReady: 1 },
      }),
    ];
    let call = 0;
    const polledUrls: string[] = [];
    const fetchImpl = vi.fn((url: Parameters<typeof fetch>[0]) => {
      polledUrls.push(typeof url === 'string' ? url : 'non-string-url');
      const state = states[Math.min(call++, states.length - 1)];
      if (!state) throw new Error('empty state fixture');
      return Promise.resolve(jsonResponse(state));
    });
    const onProgress = vi.fn();

    const finalState = await wait(fetchImpl, onProgress);

    expect(finalState.status).toBe('completed');
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(onProgress).toHaveBeenCalledTimes(3);
    expect(onProgress).toHaveBeenLastCalledWith({
      status: 'completed',
      frames: 1,
      imagesReady: 1,
      videosReady: 1,
      videosFailed: 0,
    });
    expect(polledUrls[0]).toBe(
      'http://localhost:3000/api/v1/sequences/seq_1?wait=60s'
    );
  });

  it('throws when the sequence fails', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        jsonResponse(
          stateFixture({ status: 'failed', statusError: 'scene split blew up' })
        )
      );
    await expect(wait(fetchImpl)).rejects.toThrow(
      /ended failed.*scene split blew up/s
    );
  });

  it('backs off on a 429 and keeps polling instead of failing', async () => {
    const states = [
      rateLimitResponse(),
      jsonResponse(
        stateFixture({
          status: 'completed',
          frames: [
            {
              id: 'f1',
              orderIndex: 0,
              title: null,
              image: { status: 'completed', url: 'https://r2/img1.webp' },
              video: { status: 'completed', url: 'https://r2/v1.mp4' },
            },
          ],
          counts: { frames: 1, imagesReady: 1, videosReady: 1 },
        })
      ),
    ];
    let call = 0;
    const fetchImpl = vi.fn(() => {
      const res = states[Math.min(call++, states.length - 1)];
      if (!res) throw new Error('empty state fixture');
      return Promise.resolve(res);
    });

    const finalState = await wait(fetchImpl);

    expect(finalState.status).toBe('completed');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('accepts a failed status when every clip rendered (in_finite_state poisoning)', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(
        stateFixture({
          status: 'failed',
          statusError: 'instance.in_finite_state',
          counts: { frames: 3, imagesReady: 3, videosReady: 3 },
        })
      )
    );

    const state = await wait(fetchImpl);

    expect(state.status).toBe('failed');
    expect(state.counts.videosReady).toBe(3);
  });

  it('still throws on a failed status when clips are missing', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(
        stateFixture({
          status: 'failed',
          statusError: 'instance.in_finite_state',
          counts: { frames: 3, imagesReady: 3, videosReady: 2 },
        })
      )
    );
    await expect(wait(fetchImpl)).rejects.toThrow(
      /ended failed.*in_finite_state/s
    );
  });

  it('throws when completed with failed or missing videos', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(
        stateFixture({
          status: 'completed',
          counts: {
            frames: 3,
            imagesReady: 3,
            videosReady: 2,
            videosFailed: 1,
          },
        })
      )
    );
    await expect(wait(fetchImpl)).rejects.toThrow(
      /2\/3 videos ready.*1 failed/s
    );
  });

  it('throws when completed with no frames', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse(stateFixture({ status: 'completed' })));
    await expect(wait(fetchImpl)).rejects.toThrow(/no frames/);
  });

  it('times out when the sequence never reaches a terminal state', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(stateFixture()));
    await expect(
      waitForSampleSequence(
        { ...CONFIG, fetchImpl },
        { id: 'seq_1', pollDelayMs: 0, timeoutMs: 0 }
      )
    ).rejects.toThrow(/Timed out/);
  });
});

describe('orderedFrameVideos', () => {
  const frame = (
    orderIndex: number,
    videoUrl: string | null
  ): SampleSequenceState['frames'][number] => ({
    id: `f${orderIndex}`,
    orderIndex,
    title: null,
    image: { status: 'completed', url: `https://r2/img${orderIndex}.webp` },
    video: { status: 'completed', url: videoUrl },
  });

  it('sorts by orderIndex and surfaces video + image URLs', () => {
    const state = stateFixture({
      status: 'completed',
      frames: [frame(2, 'https://r2/v2.mp4'), frame(0, 'https://r2/v0.mp4')],
      counts: { frames: 2, imagesReady: 2, videosReady: 2 },
    });
    expect(orderedFrameVideos(state)).toEqual([
      {
        frameId: 'f0',
        orderIndex: 0,
        videoUrl: 'https://r2/v0.mp4',
        imageUrl: 'https://r2/img0.webp',
      },
      {
        frameId: 'f2',
        orderIndex: 2,
        videoUrl: 'https://r2/v2.mp4',
        imageUrl: 'https://r2/img2.webp',
      },
    ]);
  });

  it('throws when a frame is missing its video URL', () => {
    const state = stateFixture({
      status: 'completed',
      frames: [frame(0, null)],
      counts: { frames: 1, imagesReady: 1, videosReady: 1 },
    });
    expect(() => orderedFrameVideos(state)).toThrow(/no video URL/);
  });
});
