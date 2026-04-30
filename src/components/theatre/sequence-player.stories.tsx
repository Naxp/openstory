/* eslint-disable @typescript-eslint/no-unsafe-type-assertion -- Storybook mock data uses intentional type assertions */
import type { AspectRatio } from '@/lib/constants/aspect-ratios';
import type { Frame } from '@/types/database';
import type { Meta, StoryObj } from '@storybook/react';
import { http, HttpResponse } from 'msw';
import { buildSequenceComposition } from './sequence-composition';
import { SequencePlayer } from './sequence-player';

const frame = (overrides: Partial<Frame>): Frame =>
  ({
    id: overrides.id ?? 'f',
    sequenceId: 'seq_123',
    orderIndex: 0,
    description: null,
    durationMs: 5000,
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
    imageModel: 'nano_banana_pro',
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
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }) as Frame;

const completed: Frame[] = [
  frame({
    id: '1',
    orderIndex: 0,
    videoStatus: 'completed',
    videoUrl:
      'https://test-videos.co.uk/vids/bigbuckbunny/mp4/h264/360/Big_Buck_Bunny_360_10s_1MB.mp4',
    durationMs: 5000,
  }),
  frame({
    id: '2',
    orderIndex: 1,
    videoStatus: 'completed',
    videoUrl:
      'https://test-videos.co.uk/vids/sintel/mp4/h264/360/Sintel_360_10s_1MB.mp4',
    durationMs: 5000,
  }),
];

// In production the iframe pulls /api/sequences/:id/composition.html from the
// server. Storybook has no backend, so each story registers an MSW handler
// that returns the same HTML the server would have built.
const compositionHandler = (
  sequenceId: string,
  frames: Frame[],
  musicUrl: string | null,
  aspectRatio: AspectRatio
) =>
  http.get(`/api/sequences/${sequenceId}/composition.html`, () => {
    const { html } = buildSequenceComposition({
      sequenceId,
      frames,
      musicUrl,
      aspectRatio,
    });
    return new HttpResponse(html, {
      status: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  });

const meta: Meta<typeof SequencePlayer> = {
  title: 'Theatre/SequencePlayer',
  component: SequencePlayer,
  parameters: { layout: 'padded' },
};

export default meta;
type Story = StoryObj<typeof SequencePlayer>;

export const TwoClipsNoMusic: Story = {
  args: {
    sequenceId: 'seq_123',
    frames: completed,
    musicUrl: null,
    aspectRatio: '16:9',
  },
  parameters: {
    msw: { handlers: [compositionHandler('seq_123', completed, null, '16:9')] },
  },
};

export const TwoClipsWithMusic: Story = {
  args: {
    sequenceId: 'seq_123',
    frames: completed,
    musicUrl: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3',
    aspectRatio: '16:9',
  },
  parameters: {
    msw: {
      handlers: [
        compositionHandler(
          'seq_123',
          completed,
          'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3',
          '16:9'
        ),
      ],
    },
  },
};

export const Portrait: Story = {
  args: {
    sequenceId: 'seq_123',
    frames: completed,
    musicUrl: null,
    aspectRatio: '9:16',
  },
  parameters: {
    msw: { handlers: [compositionHandler('seq_123', completed, null, '9:16')] },
  },
};

export const NoCompletedFrames: Story = {
  args: {
    sequenceId: 'seq_123',
    frames: [
      frame({ id: '1', orderIndex: 0, videoStatus: 'pending' }),
      frame({ id: '2', orderIndex: 1, videoStatus: 'generating' }),
    ],
    musicUrl: null,
    aspectRatio: '16:9',
  },
};
