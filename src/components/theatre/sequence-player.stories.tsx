/* eslint-disable @typescript-eslint/no-unsafe-type-assertion -- Storybook mock data uses intentional type assertions */
import type { Frame } from '@/types/database';
import type { Meta, StoryObj } from '@storybook/react';
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
      'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4',
    durationMs: 5000,
  }),
  frame({
    id: '2',
    orderIndex: 1,
    videoStatus: 'completed',
    videoUrl:
      'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ElephantsDream.mp4',
    durationMs: 5000,
  }),
];

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
};

export const TwoClipsWithMusic: Story = {
  args: {
    sequenceId: 'seq_123',
    frames: completed,
    musicUrl:
      'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/audio/T-Rex-Roar.mp3',
    aspectRatio: '16:9',
  },
};

export const Portrait: Story = {
  args: {
    sequenceId: 'seq_123',
    frames: completed,
    musicUrl: null,
    aspectRatio: '9:16',
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
