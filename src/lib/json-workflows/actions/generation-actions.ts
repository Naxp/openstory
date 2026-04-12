/**
 * Generation Actions
 *
 * AI generation operations: image, motion, music, variant, merge.
 * These wrap existing service functions.
 */

import { z } from 'zod';
import type { ActionDefinition } from './types';

const generateImageInputSchema = z.object({
  prompt: z.string(),
  model: z.string().optional(),
  imageSize: z.string().optional(),
  numImages: z.number().optional(),
  seed: z.number().optional(),
  frameId: z.string().optional(),
  sequenceId: z.string().optional(),
  referenceImages: z.array(z.any()).optional(),
  skipStorage: z.boolean().optional(),
});

const generateImage: ActionDefinition = {
  name: 'generate-image',
  description:
    'Generate an image using AI, optionally upload to R2 and update frame',
  inputSchema: generateImageInputSchema,
  outputSchema: z.object({
    imageUrl: z.string(),
    imagePath: z.string().optional(),
  }),
  execute: async (input, ctx) => {
    const { generateImageWithProvider } =
      await import('@/lib/image/image-generation');
    const { uploadImageToStorage } = await import('@/lib/image/image-storage');
    const { DEFAULT_IMAGE_MODEL, safeTextToImageModel } =
      await import('@/lib/ai/models');
    const { DEFAULT_IMAGE_SIZE } =
      await import('@/lib/constants/aspect-ratios');

    const params = generateImageInputSchema.parse(input);

    const model = safeTextToImageModel(params.model ?? DEFAULT_IMAGE_MODEL);
    const imageSizeResult = z
      .enum(['square_hd', 'portrait_16_9', 'landscape_16_9'])
      .safeParse(params.imageSize);
    const imageSize = imageSizeResult.success
      ? imageSizeResult.data
      : DEFAULT_IMAGE_SIZE;
    const imageResult = await generateImageWithProvider(
      {
        model,
        prompt: params.prompt,
        imageSize,
        numImages: params.numImages ?? 1,
        seed: params.seed,
        traceName: 'json-workflow-image',
      },
      { scopedDb: ctx.scopedDb }
    );

    let imageUrl = imageResult.imageUrls[0];
    let imagePath: string | undefined;

    if (
      imageUrl &&
      params.frameId &&
      params.sequenceId &&
      ctx.scopedDb.teamId &&
      !params.skipStorage
    ) {
      const result = await uploadImageToStorage({
        imageUrl,
        teamId: ctx.scopedDb.teamId,
        sequenceId: params.sequenceId,
        frameId: params.frameId,
      });

      if (result.url) {
        imageUrl = result.url;
        imagePath = result.path;

        await ctx.scopedDb.frames.update(params.frameId, {
          thumbnailUrl: result.url,
          thumbnailPath: result.path || null,
          thumbnailStatus: 'completed',
          thumbnailGeneratedAt: new Date(),
          thumbnailError: null,
          imageModel: model,
          imagePrompt: params.prompt,
        });
      }
    }

    return { imageUrl, imagePath };
  },
};

const generateMotionInputSchema = z.object({
  imageUrl: z.string(),
  prompt: z.string(),
  model: z.string().optional(),
  frameId: z.string().optional(),
  duration: z.number().optional(),
  aspectRatio: z.string().optional(),
});

const generateMotion: ActionDefinition = {
  name: 'generate-motion',
  description:
    'Generate motion video from an image. Uses invoke-workflow internally.',
  inputSchema: generateMotionInputSchema,
  outputSchema: z.object({ videoUrl: z.string() }),
  execute: async (input, ctx) => {
    const { triggerWorkflow } = await import('@/lib/workflow/client');
    const params = generateMotionInputSchema.parse(input);

    const workflowRunId = await triggerWorkflow('/motion', {
      userId: ctx.scopedDb.userId,
      teamId: ctx.scopedDb.teamId,
      frameId: params.frameId,
      sequenceId: ctx.sequenceId,
      imageUrl: params.imageUrl,
      prompt: params.prompt,
      model: params.model,
      duration: params.duration,
      aspectRatio: params.aspectRatio,
    });

    return { videoUrl: '', workflowRunId };
  },
};

const generateMusic: ActionDefinition = {
  name: 'generate-music',
  description: 'Generate music from a prompt and tags',
  inputSchema: z.object({
    prompt: z.string(),
    tags: z.string(),
    duration: z.number(),
    model: z.string().optional(),
    sequenceId: z.string().optional(),
  }),
  outputSchema: z.object({ audioUrl: z.string() }),
  execute: async () => {
    throw new Error(
      'generate-music action not yet implemented. Use invoke-workflow with name "music" instead.'
    );
  },
};

const generateVariantImage: ActionDefinition = {
  name: 'generate-variant-image',
  description: 'Generate a variant grid image from an existing thumbnail',
  inputSchema: z.object({
    thumbnailUrl: z.string(),
    frameId: z.string().optional(),
    scenePrompt: z.string().optional(),
    aspectRatio: z.string().optional(),
    model: z.string().optional(),
  }),
  outputSchema: z.object({ variantImageUrl: z.string() }),
  execute: async () => {
    throw new Error(
      'generate-variant-image action not yet implemented. Use invoke-workflow with name "variant-image" instead.'
    );
  },
};

const mergeVideos: ActionDefinition = {
  name: 'merge-videos',
  description: 'Stitch frame videos into a single merged video',
  inputSchema: z.object({
    videoUrls: z.array(z.string()),
    sequenceId: z.string().optional(),
  }),
  outputSchema: z.object({
    mergedVideoUrl: z.string(),
    mergedVideoPath: z.string().nullable(),
  }),
  execute: async () => {
    throw new Error(
      'merge-videos action not yet implemented. Use invoke-workflow with name "merge-video" instead.'
    );
  },
};

const mergeAudioVideo: ActionDefinition = {
  name: 'merge-audio-video',
  description: 'Mux audio onto a merged video',
  inputSchema: z.object({
    mergedVideoUrl: z.string(),
    musicUrl: z.string(),
    sequenceId: z.string().optional(),
  }),
  outputSchema: z.object({
    mergedVideoUrl: z.string(),
  }),
  execute: async () => {
    throw new Error(
      'merge-audio-video action not yet implemented. Use invoke-workflow with name "merge-audio-video" instead.'
    );
  },
};

const invokeWorkflowInputSchema = z.object({
  name: z.string(),
  body: z.record(z.string(), z.any()),
});

const invokeWorkflow: ActionDefinition = {
  name: 'invoke-workflow',
  description:
    'Invoke an existing registered workflow by name (escape hatch to TS workflows)',
  inputSchema: invokeWorkflowInputSchema,
  outputSchema: z.any(),
  execute: async (input, ctx) => {
    const { triggerWorkflow } = await import('@/lib/workflow/client');

    const params = invokeWorkflowInputSchema.parse(input);

    const workflowRunId = await triggerWorkflow(`/${params.name}`, {
      userId: ctx.scopedDb.userId,
      teamId: ctx.scopedDb.teamId,
      ...params.body,
    });

    return { workflowRunId };
  },
};

export const generationActions: ActionDefinition[] = [
  generateImage,
  generateMotion,
  generateMusic,
  generateVariantImage,
  mergeVideos,
  mergeAudioVideo,
  invokeWorkflow,
];
