import { ImageModelSelector } from '@/components/model/image-model-selector';
import { MotionModelSelector } from '@/components/model/motion-model-selector';
import { type ModelGenerationStatus } from '@/components/model/base-model-selector';
import { useScenes, useUpdateSceneModels } from '@/hooks/use-scenes';
import {
  resolveSceneImageModel,
  resolveSceneVideoModel,
} from '@/lib/model/resolve-scene-model';
import {
  getCompatibleModel,
  type ImageToVideoModel,
  type TextToImageModel,
} from '@/lib/ai/models';
import type { AspectRatio } from '@/lib/constants/aspect-ratios';
import type { Sequence } from '@/types/database';
import { toast } from 'sonner';

type SceneModelHeaderProps = {
  sequenceId: string;
  /** The scene whose models this header controls (the selected shot's scene). */
  sceneId: string | null | undefined;
  sequence: Sequence | undefined;
  aspectRatio: AspectRatio;
  styleCategory?: string;
  styleName?: string;
  recommendedImageModel?: string | null;
  recommendedVideoModel?: string | null;
  /** Per-model generation status across the scene's shots — ✓/⟳/! markers. */
  imageModelStatuses?: Map<string, ModelGenerationStatus>;
  videoModelStatuses?: Map<string, ModelGenerationStatus>;
};

/**
 * Scene-level model pickers (#909). A scene owns one "look" (image model) and
 * one "motion character" (video model); these replace the former per-shot
 * pickers so every shot in the scene shares a model. Picking a model persists
 * `scene.imageModel` / `scene.videoModel` via {@link useUpdateSceneModels};
 * `null` columns inherit the sequence default through `resolveScene*Model`.
 */
export const SceneModelHeader: React.FC<SceneModelHeaderProps> = ({
  sequenceId,
  sceneId,
  sequence,
  aspectRatio,
  styleCategory,
  styleName,
  recommendedImageModel,
  recommendedVideoModel,
  imageModelStatuses,
  videoModelStatuses,
}) => {
  const { data: scenes } = useScenes(sequenceId);
  const updateModels = useUpdateSceneModels();

  const scene = scenes?.find((s) => s.id === sceneId);

  // Resolve through the scene → sequence → default chain so the selectors show
  // the effective model even before a scene override is set.
  const imageModel = resolveSceneImageModel(scene, sequence);
  const resolvedVideo = resolveSceneVideoModel(scene, sequence);
  // Keep the resolved motion model usable: snap to an aspect-ratio compatible
  // model so the selector never highlights an incompatible option.
  const videoModel: ImageToVideoModel = getCompatibleModel(
    resolvedVideo,
    aspectRatio
  );

  const handleImageModelChange = (model: TextToImageModel) => {
    if (!sceneId) return;
    updateModels.mutate(
      { sequenceId, sceneId, imageModel: model },
      {
        onError: (error) =>
          toast.error('Failed to set image model', {
            description:
              error instanceof Error ? error.message : 'Unknown error',
          }),
      }
    );
  };

  const handleVideoModelChange = (model: ImageToVideoModel) => {
    if (!sceneId) return;
    updateModels.mutate(
      { sequenceId, sceneId, videoModel: model },
      {
        onError: (error) =>
          toast.error('Failed to set video model', {
            description:
              error instanceof Error ? error.message : 'Unknown error',
          }),
      }
    );
  };

  const disabled = !sceneId || updateModels.isPending;

  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:gap-6">
      <div className="flex flex-1 flex-col gap-1.5">
        <span className="text-sm font-medium">Look</span>
        <ImageModelSelector
          selectedModel={imageModel}
          onModelChange={handleImageModelChange}
          disabled={disabled}
          recommendedImageModel={recommendedImageModel}
          styleName={styleName}
          generatedStatuses={imageModelStatuses}
        />
      </div>
      <div className="flex flex-1 flex-col gap-1.5">
        <span className="text-sm font-medium">Motion character</span>
        <MotionModelSelector
          selectedModel={videoModel}
          onModelChange={handleVideoModelChange}
          disabled={disabled}
          aspectRatio={aspectRatio}
          styleCategory={styleCategory}
          recommendedVideoModel={recommendedVideoModel}
          styleName={styleName}
          generatedStatuses={videoModelStatuses}
        />
      </div>
    </div>
  );
};
