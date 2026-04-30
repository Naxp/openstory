/* eslint-disable @typescript-eslint/no-unsafe-type-assertion -- Storybook mock data uses intentional type assertions */
import type { Frame, Sequence } from '@/types/database';
import type { Meta, StoryObj } from '@storybook/react';
import { fn } from 'storybook/test';
import { TheatreView } from './theatre-view';

const baseSequence: Sequence = {
  id: 'seq_123',
  teamId: 'team_123',
  title: 'My Awesome Sequence',
  script: 'A short film about nature.',
  status: 'completed',
  createdAt: new Date(),
  updatedAt: new Date(),
  createdBy: 'user_123',
  updatedBy: 'user_123',
  styleId: 'style_123',
  aspectRatio: '16:9',
  analysisModel: 'anthropic/claude-haiku-4.5',
  analysisDurationMs: 5000,
  imageModel: 'nano_banana_pro',
  videoModel: 'kling_v2_5_turbo_pro',
  workflow: null,
  mergedVideoUrl: null,
  mergedVideoPath: null,
  mergedVideoStatus: 'pending',
  mergedVideoGeneratedAt: null,
  mergedVideoError: null,
  musicUrl: null,
  musicPath: null,
  musicStatus: 'pending',
  musicGeneratedAt: null,
  musicError: null,
  musicModel: null,
  musicPrompt: null,
  musicTags: null,
  statusError: null,
  posterUrl: null,
  autoGenerateMotion: false,
  autoGenerateMusic: false,
  suggestedTalentIds: null,
  suggestedLocationIds: null,
};

const frame = (overrides: Partial<Frame>): Frame =>
  ({
    id: overrides.id ?? 'f',
    sequenceId: 'seq_123',
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

const completedFrames: Frame[] = [
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

const meta: Meta<typeof TheatreView> = {
  title: 'Theatre/TheatreView',
  component: TheatreView,
  parameters: { layout: 'padded' },
  args: {
    onGenerateMergedVideo: fn(),
  },
};

export default meta;
type Story = StoryObj<typeof TheatreView>;

export const NoMotionYet: Story = {
  args: {
    sequence: baseSequence,
    frames: [
      frame({ id: '1', orderIndex: 0, videoStatus: 'pending' }),
      frame({ id: '2', orderIndex: 1, videoStatus: 'generating' }),
    ],
  },
};

export const LivePreviewNoMerge: Story = {
  args: {
    sequence: baseSequence,
    frames: completedFrames,
  },
};

export const LivePreviewWithMusic: Story = {
  args: {
    sequence: {
      ...baseSequence,
      musicUrl: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3',
      musicStatus: 'completed',
    },
    frames: completedFrames,
  },
};

export const LivePreviewMixedStates: Story = {
  args: {
    sequence: baseSequence,
    frames: [
      ...completedFrames,
      frame({ id: '3', orderIndex: 2, videoStatus: 'generating' }),
      frame({ id: '4', orderIndex: 3, videoStatus: 'failed' }),
    ],
  },
};

export const WithMergedVideoAvailable: Story = {
  args: {
    sequence: {
      ...baseSequence,
      mergedVideoStatus: 'completed',
      mergedVideoUrl:
        'https://test-videos.co.uk/vids/bigbuckbunny/mp4/h264/360/Big_Buck_Bunny_360_10s_1MB.mp4',
      mergedVideoPath:
        'teams/team_123/sequences/seq_123/merged/abc123_openstory.mp4',
      mergedVideoGeneratedAt: new Date(),
    },
    frames: completedFrames,
  },
};

export const Portrait: Story = {
  args: {
    sequence: {
      ...baseSequence,
      aspectRatio: '9:16',
      mergedVideoStatus: 'completed',
      mergedVideoUrl:
        'https://test-videos.co.uk/vids/bigbuckbunny/mp4/h264/360/Big_Buck_Bunny_360_10s_1MB.mp4',
      mergedVideoPath:
        'teams/team_123/sequences/seq_123/merged/abc123_openstory.mp4',
      mergedVideoGeneratedAt: new Date(),
    },
    frames: completedFrames,
  },
};

export const RenderingMergedMP4: Story = {
  args: {
    sequence: { ...baseSequence, mergedVideoStatus: 'merging' },
    frames: completedFrames,
    isGenerating: true,
  },
};
