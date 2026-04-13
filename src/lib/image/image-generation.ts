import { calculateImageCost } from '@/lib/ai/fal-cost';
import {
  getEditEndpoint,
  getTextToImageModelId,
  IMAGE_MODELS,
  type TextToImageModel,
} from '@/lib/ai/models';
import { type Microdollars, microsToUsd } from '@/lib/billing/money';
import {
  DEFAULT_IMAGE_SIZE,
  type ImageSize,
} from '@/lib/constants/aspect-ratios';
import { type ImageDto, imagesCreate, imagesGet } from '@/lib/letzai/sdk';
import {
  endSpanError,
  endSpanSuccess,
  startGenAISpan,
} from '@/lib/observability/tracer';

import { getEnv } from '#env';
import type { ScopedDb } from '@/lib/db/scoped';
import { generateImage } from '@tanstack/ai';
import { falImage } from '@tanstack/ai-fal';

export type ImageGenerationParams = {
  model: TextToImageModel;
  prompt: string;
  imageSize?: ImageSize;
  numImages?: number;
  seed?: number;
  outputFormat?: 'jpeg' | 'png' | 'webp';
  numInferenceSteps?: number;
  guidanceScale?: number;
  negativePrompt?: string;
  loras?: Array<{ path: string; scale: number }>;
  embeddings?: Array<{ path: string; tokens: string[] }>;

  // LetzAI-specific
  quality?: number;
  creativity?: number;
  hasWatermark?: boolean;
  systemVersion?: number;
  mode?: 'default' | 'sigma';

  // Model-specific
  style?: string;
  colors?: Array<{ r: number; g: number; b: number }>;
  resolution?: '1K' | '2K' | '4K';
  enhancePrompt?: boolean;
  safetyTolerance?: number;
  acceleration?: 'none' | 'regular' | 'high';
  enablePromptExpansion?: boolean;
  referenceImageUrls?: string[];
  traceName?: string;
};

/** Non-serializable options passed separately from ImageGenerationParams */
export type ImageGenerationOptions = {
  scopedDb?: ScopedDb;
  onQueueUpdate?: (update: {
    status: 'IN_QUEUE' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED';
    logs?: string[];
    progress?: number;
  }) => void;
};

export type ImageGenerationResult = {
  imageUrls: string[];
  parameters: ImageGenerationParams;
  generatedAt: string;
  processingTimeMs: number;
  provider: 'letzai' | 'fal';
  metadata: {
    prompt: string;
    model: string;
    dimensions: { width: number; height: number }[];
    file_sizes: number[];
    seed?: number;
    has_nsfw_concepts?: boolean[];
    cost?: Microdollars;
    requestId?: string;
    usedOwnKey: boolean;
  };
};

const ASPECT_RATIO_MAP: Record<ImageSize, string> = {
  square_hd: '1:1',
  portrait_16_9: '9:16',
  landscape_16_9: '16:9',
};

const LETZAI_DIMENSIONS: Record<ImageSize, { width: number; height: number }> =
  {
    square_hd: { width: 1024, height: 1024 },
    portrait_16_9: { width: 576, height: 1024 },
    landscape_16_9: { width: 1600, height: 900 },
  };

function imageSizeToAspectRatio(imageSize: ImageSize): string {
  return ASPECT_RATIO_MAP[imageSize];
}

function createFalAdapter(modelId: string, falApiKey?: string) {
  const key = falApiKey ?? getEnv().FAL_KEY;
  return key ? falImage(modelId, { apiKey: key }) : falImage(modelId);
}

function truncatePromptForModel(
  prompt: string,
  model: TextToImageModel
): string {
  const maxLength = IMAGE_MODELS[model].maxPromptLength;
  if (!maxLength || prompt.length <= maxLength) return prompt;

  console.warn(
    `[Image Generation] Prompt truncated from ${prompt.length} to ${maxLength} chars for ${model}`
  );
  return prompt.slice(0, maxLength - 3) + '...';
}

export async function generateImageWithProvider(
  params: ImageGenerationParams,
  options?: ImageGenerationOptions
): Promise<ImageGenerationResult> {
  const modelId = getTextToImageModelId(params.model);

  const span = startGenAISpan(params.traceName ?? 'fal-image', {
    model: params.model,
    provider: 'fal',
    operation: 'generate_content',
    input: {
      prompt: params.prompt,
      imageSize: params.imageSize,
      ...(params.referenceImageUrls?.length && {
        referenceImageUrls: params.referenceImageUrls,
      }),
    },
  });

  try {
    const result = await generateImageInternal(params, modelId, options);

    if (result.metadata.cost) {
      span.setAttribute('gen_ai.usage.cost', microsToUsd(result.metadata.cost));
    }
    endSpanSuccess(span, { imageUrls: result.imageUrls });
    return result;
  } catch (error) {
    endSpanError(span, error);
    throw error;
  }
}
// @TODO: TB Mar 2026 - this needs to be updated to be typesafe. Especially after the work put in on Tanstack AI to keep it safe
async function generateImageInternal(
  params: ImageGenerationParams,
  modelId: string,
  options?: ImageGenerationOptions
): Promise<ImageGenerationResult> {
  const prompt = truncatePromptForModel(params.prompt, params.model);
  const startTime = Date.now();

  if (params.model === 'letzai') {
    return generateLetzaiImage(params, prompt);
  }
  // Get the fal API key - byok or global
  const falApiKeyInfo = options?.scopedDb
    ? await options.scopedDb.apiKeys.resolveKey('fal')
    : { key: getEnv().FAL_KEY, source: 'platform' as const };

  const modelOptions = buildFalModelOptions(params);

  // Switch to edit endpoint for models with reference images
  let endpoint = modelId;
  const editEndpoint = getEditEndpoint(params.model);
  if (editEndpoint && params.referenceImageUrls?.length) {
    endpoint = editEndpoint;
  }

  const adapter = createFalAdapter(endpoint, falApiKeyInfo.key);
  const result = await generateImage({ adapter, prompt, modelOptions });

  const imageUrls = result.images
    .map((img) => img.url)
    .filter((url): url is string => !!url);

  if (imageUrls.length === 0) {
    throw new Error('No images returned from generation');
  }

  const processingTimeMs = Date.now() - startTime;

  const imageSize = params.imageSize ?? DEFAULT_IMAGE_SIZE;
  const dims = IMAGE_SIZE_DIMENSIONS[imageSize];
  const sizeMap: Record<ImageSize, string> = {
    square_hd: '1024x1024',
    portrait_16_9: '1024x1536',
    landscape_16_9: '1536x1024',
  };
  const cost = calculateImageCost({
    endpointId: endpoint,
    numImages: imageUrls.length,
    widthPx: dims.width,
    heightPx: dims.height,
    resolution: params.resolution,
    style: params.style,
    quality: params.model === 'gpt_image_1_5' ? 'high' : undefined,
    imageSize: sizeMap[imageSize],
  });

  return {
    imageUrls,
    parameters: params,
    generatedAt: new Date().toISOString(),
    processingTimeMs,
    provider: 'fal',
    metadata: {
      prompt: params.prompt,
      model: params.model,
      dimensions: imageUrls.map(() => ({ width: 0, height: 0 })),
      file_sizes: imageUrls.map(() => 0),
      seed: params.seed,
      cost,
      usedOwnKey: falApiKeyInfo.source === 'team',
    },
  };
}

function buildFalModelOptions(
  params: ImageGenerationParams
): Record<string, unknown> {
  switch (params.model) {
    case 'flux_pro':
    case 'flux_dev':
    case 'flux_schnell':
    case 'flux_krea_lora':
    case 'flux_pro_v1_1_ultra': {
      const isUltra = params.model === 'flux_pro_v1_1_ultra';
      const defaultSteps = params.model === 'flux_schnell' ? 4 : 28;
      return {
        ...(isUltra
          ? {
              aspect_ratio: imageSizeToAspectRatio(
                params.imageSize ?? DEFAULT_IMAGE_SIZE
              ),
            }
          : { image_size: params.imageSize ?? DEFAULT_IMAGE_SIZE }),
        ...(!isUltra && {
          num_inference_steps: params.numInferenceSteps ?? defaultSteps,
          guidance_scale: params.guidanceScale ?? 3.5,
        }),
        ...(params.model !== 'flux_pro' && { enable_safety_checker: true }),
        ...(isUltra && { raw: false }),
        ...(params.seed !== undefined && { seed: params.seed }),
        ...(params.numImages !== undefined && { num_images: params.numImages }),
        ...(params.outputFormat && { output_format: params.outputFormat }),
        ...((params.model === 'flux_pro' || isUltra) &&
          params.safetyTolerance !== undefined && {
            safety_tolerance: params.safetyTolerance.toString(),
          }),
        ...((params.model === 'flux_pro' || isUltra) &&
          params.enhancePrompt !== undefined && {
            enhance_prompt: params.enhancePrompt,
          }),
        ...((params.model === 'flux_dev' || params.model === 'flux_schnell') &&
          params.acceleration && { acceleration: params.acceleration }),
        ...(params.model === 'flux_krea_lora' &&
          params.loras && { loras: params.loras }),
        sync_mode: false,
      };
    }

    case 'flux_2':
      return {
        image_size: params.imageSize ?? DEFAULT_IMAGE_SIZE,
        num_inference_steps: params.numInferenceSteps ?? 28,
        guidance_scale: params.guidanceScale ?? 2.5,
        enable_safety_checker: true,
        ...(params.seed !== undefined && { seed: params.seed }),
        ...(params.numImages !== undefined && { num_images: params.numImages }),
        ...(params.outputFormat && { output_format: params.outputFormat }),
        ...(params.acceleration && { acceleration: params.acceleration }),
        ...(params.enablePromptExpansion !== undefined && {
          enable_prompt_expansion: params.enablePromptExpansion,
        }),
        sync_mode: false,
      };

    case 'flux_2_turbo':
      return {
        image_size: params.imageSize ?? DEFAULT_IMAGE_SIZE,
        num_inference_steps: params.numInferenceSteps ?? 4,
        guidance_scale: params.guidanceScale ?? 2.5,
        enable_safety_checker: true,
        ...(params.seed !== undefined && { seed: params.seed }),
        ...(params.numImages !== undefined && { num_images: params.numImages }),
        ...(params.outputFormat && { output_format: params.outputFormat }),
        sync_mode: false,
      };

    case 'sdxl':
    case 'sdxl_lightning': {
      const isSDXL = params.model === 'sdxl';
      return {
        image_size: params.imageSize ?? DEFAULT_IMAGE_SIZE,
        num_inference_steps: params.numInferenceSteps ?? (isSDXL ? 25 : 4),
        enable_safety_checker: true,
        ...(isSDXL && {
          guidance_scale: params.guidanceScale ?? 7.5,
        }),
        ...(isSDXL &&
          params.negativePrompt && {
            negative_prompt: params.negativePrompt,
          }),
        ...(isSDXL && params.loras && { loras: params.loras }),
        ...(params.seed !== undefined && { seed: params.seed }),
        ...(params.numImages !== undefined && { num_images: params.numImages }),
        ...(params.outputFormat && { format: params.outputFormat }),
        ...(params.embeddings && { embeddings: params.embeddings }),
        sync_mode: false,
      };
    }

    case 'imagen4_preview_ultra':
      return {
        aspect_ratio: imageSizeToAspectRatio(
          params.imageSize ?? DEFAULT_IMAGE_SIZE
        ),
        resolution: params.resolution ?? '1K',
        num_images: 1,
        ...(params.negativePrompt && {
          negative_prompt: params.negativePrompt,
        }),
        ...(params.seed !== undefined && { seed: params.seed }),
      };

    case 'nano_banana':
      return {
        aspect_ratio: imageSizeToAspectRatio(
          params.imageSize ?? DEFAULT_IMAGE_SIZE
        ),
        safety_tolerance: '6',
        ...(params.numImages !== undefined && { num_images: params.numImages }),
        ...(params.outputFormat && { output_format: params.outputFormat }),
        sync_mode: false,
      };

    case 'nano_banana_pro':
    case 'nano_banana_2':
      return {
        aspect_ratio: imageSizeToAspectRatio(
          params.imageSize ?? DEFAULT_IMAGE_SIZE
        ),
        resolution: params.resolution ?? '2K',
        safety_tolerance: '6',
        ...(params.numImages !== undefined && { num_images: params.numImages }),
        ...(params.outputFormat && { output_format: params.outputFormat }),
        ...(params.referenceImageUrls?.length && {
          image_urls: params.referenceImageUrls,
        }),
        sync_mode: false,
      };

    case 'recraft_v3':
      return {
        image_size: params.imageSize ?? DEFAULT_IMAGE_SIZE,
        style: params.style ?? 'realistic_image',
        enable_safety_checker: false,
        ...(params.colors?.length && { colors: params.colors }),
      };

    case 'hidream_i1_full':
      return {
        image_size: { width: 1024, height: 1024 },
        num_inference_steps: params.numInferenceSteps ?? 50,
        guidance_scale: params.guidanceScale ?? 5,
        enable_safety_checker: true,
        ...(params.negativePrompt && {
          negative_prompt: params.negativePrompt,
        }),
        ...(params.seed !== undefined && { seed: params.seed }),
        ...(params.numImages !== undefined && { num_images: params.numImages }),
        ...(params.outputFormat && { output_format: params.outputFormat }),
        ...(params.loras && { loras: params.loras }),
        sync_mode: false,
      };

    case 'seedream_v4_5':
      return {
        image_size: params.imageSize ?? DEFAULT_IMAGE_SIZE,
        enable_safety_checker: true,
        ...(params.seed !== undefined && { seed: params.seed }),
        ...(params.numImages !== undefined && { num_images: params.numImages }),
        sync_mode: false,
      };

    case 'kling_image_v3':
      return {
        aspect_ratio: imageSizeToAspectRatio(
          params.imageSize ?? DEFAULT_IMAGE_SIZE
        ),
        resolution: params.resolution ?? '1K',
        ...(params.numImages !== undefined && { num_images: params.numImages }),
        ...(params.outputFormat && { output_format: params.outputFormat }),
      };

    case 'flux_2_klein_4b':
      return {
        image_size: params.imageSize ?? DEFAULT_IMAGE_SIZE,
        num_inference_steps: params.numInferenceSteps ?? 4,
        enable_safety_checker: true,
        ...(params.seed !== undefined && { seed: params.seed }),
        ...(params.numImages !== undefined && { num_images: params.numImages }),
        ...(params.outputFormat && { output_format: params.outputFormat }),
        sync_mode: false,
      };

    case 'gpt_image_1_5': {
      const sizeMap: Record<ImageSize, string> = {
        square_hd: '1024x1024',
        portrait_16_9: '1024x1536',
        landscape_16_9: '1536x1024',
      };
      return {
        image_size: sizeMap[params.imageSize ?? DEFAULT_IMAGE_SIZE],
        quality: 'high',
        ...(params.numImages !== undefined && { num_images: params.numImages }),
        ...(params.outputFormat && { output_format: params.outputFormat }),
        sync_mode: false,
      };
    }

    case 'grok_imagine_image':
      return {
        aspect_ratio: imageSizeToAspectRatio(
          params.imageSize ?? DEFAULT_IMAGE_SIZE
        ),
        resolution: params.resolution ?? '2K',
        ...(params.numImages !== undefined && { num_images: params.numImages }),
        ...(params.outputFormat && { output_format: params.outputFormat }),
        ...(params.referenceImageUrls?.length && {
          image_urls: params.referenceImageUrls,
        }),
        sync_mode: false,
      };

    case 'letzai':
      return {}; // Handled before this switch in generateImageInternal

    default: {
      const _exhaustive: never = params.model;
      throw new Error(`Unsupported model: ${String(_exhaustive)}`);
    }
  }
}

async function generateLetzaiImage(
  params: ImageGenerationParams,
  prompt: string
): Promise<ImageGenerationResult> {
  const dims = LETZAI_DIMENSIONS[params.imageSize ?? DEFAULT_IMAGE_SIZE];

  const resp = await imagesCreate({
    // @ts-expect-error - webhookUrl is not required for imagesCreate
    body: {
      prompt,
      width: dims.width,
      height: dims.height,
      quality: params.quality ?? 5,
      creativity: params.creativity ?? 2,
      hasWatermark: params.hasWatermark ?? false,
      systemVersion: params.systemVersion ?? 3,
      mode: params.mode ?? 'default',
      hideFromUserProfile: false,
    },
  });

  if (!resp.data) throw new Error('No data returned from LetzAI');
  let imageDto: ImageDto = resp.data;
  do {
    const imageStatusResp = await imagesGet({ path: { id: resp.data.id } });
    if (!imageStatusResp.data) throw new Error('No data returned from LetzAI');

    imageDto = imageStatusResp.data;
    await new Promise((resolve) => setTimeout(resolve, 5000));
  } while (
    imageDto.status !== 'ready' &&
    imageDto.status !== 'failed' &&
    imageDto.status !== 'interrupted'
  );
  if (imageDto.status === 'failed') {
    throw new Error('Image generation failed');
  }
  if (imageDto.status === 'interrupted') {
    throw new Error('Image generation interrupted');
  }

  const originalUrl = imageDto.imageVersions?.original;
  return {
    imageUrls: typeof originalUrl === 'string' ? [originalUrl] : [],
    parameters: params,
    generatedAt: new Date().toISOString(),
    processingTimeMs: 0,
    provider: 'letzai',
    metadata: {
      prompt: params.prompt,
      model: params.model,
      dimensions: [dims],
      file_sizes: [],
      usedOwnKey: false,
    },
  };
}

/** Pixel dimensions for megapixel-based cost calculation */
const IMAGE_SIZE_DIMENSIONS: Record<
  ImageSize,
  { width: number; height: number }
> = {
  square_hd: { width: 1024, height: 1024 },
  portrait_16_9: { width: 576, height: 1024 },
  landscape_16_9: { width: 1344, height: 768 },
};
