import {
  BaseModelSelector,
  type ModelGenerationStatus,
} from './base-model-selector';
import {
  IMAGE_TO_VIDEO_MODELS,
  isModelCompatibleWithAspectRatio,
  isValidImageToVideoModel,
  type ImageToVideoModel,
} from '@/lib/ai/models';
import type { AspectRatio } from '@/lib/constants/aspect-ratios';
import { useMemo } from 'react';

const GROUP_ORDER = ['all'] as const;

type MotionModelFilterProps = {
  aspectRatio?: AspectRatio;
  /** When set, models with a matching `requiredStyleCategory` are included */
  styleCategory?: string;
  /** Style-recommended model key — renders a "Recommended" badge on the match. */
  recommendedVideoModel?: string | null;
  /** Style name, used in the recommendation tooltip. */
  styleName?: string;
};

/**
 * Build the filtered, sorted motion-model option list. Shared by the single-
 * and multi-select variants so aspect-ratio compatibility, style-category
 * gating, and the recommendation badge behave identically across both.
 */
function useMotionModels({
  aspectRatio,
  styleCategory,
  recommendedVideoModel,
  styleName,
}: MotionModelFilterProps) {
  return useMemo(
    () =>
      Object.entries(IMAGE_TO_VIDEO_MODELS)
        .filter(([key, m]) => {
          if (!isValidImageToVideoModel(key)) return false;
          if ('hidden' in m) return false;
          if (
            'requiredStyleCategory' in m &&
            m.requiredStyleCategory !== styleCategory
          )
            return false;
          return aspectRatio
            ? isModelCompatibleWithAspectRatio(key, aspectRatio)
            : true;
        })
        .sort(([, a], [, b]) => a.qualityRank - b.qualityRank)
        .map(([key, m]) => {
          const isRecommended = key === recommendedVideoModel;
          const recommendedFor = isRecommended
            ? styleName
              ? `Recommended for ${styleName}`
              : 'Recommended for this style'
            : undefined;
          return {
            id: key,
            name: m.name,
            group: 'all',
            badge: m.license,
            recommendedFor,
          };
        }),
    [aspectRatio, styleCategory, recommendedVideoModel, styleName]
  );
}

function useRecommendationStatus(
  recommendedVideoModel: string | null | undefined,
  aspectRatio: AspectRatio | undefined
): 'matched' | 'incompatible-ratio' | 'unknown' | 'none' {
  return useMemo(() => {
    if (!recommendedVideoModel) return 'none';
    if (!isValidImageToVideoModel(recommendedVideoModel)) return 'unknown';
    if (
      aspectRatio &&
      !isModelCompatibleWithAspectRatio(recommendedVideoModel, aspectRatio)
    ) {
      return 'incompatible-ratio';
    }
    return 'matched';
  }, [recommendedVideoModel, aspectRatio]);
}

function RecommendationHint({
  status,
  recommendedVideoModel,
  styleName,
}: {
  status: 'matched' | 'incompatible-ratio' | 'unknown' | 'none';
  recommendedVideoModel: string | null | undefined;
  styleName: string | undefined;
}) {
  const recommendedModelName =
    recommendedVideoModel && isValidImageToVideoModel(recommendedVideoModel)
      ? IMAGE_TO_VIDEO_MODELS[recommendedVideoModel].name
      : undefined;

  if (status === 'incompatible-ratio' && recommendedModelName) {
    return (
      <p className="text-[10px] text-muted-foreground">
        {styleName ? `${styleName} recommends` : 'Recommended'}{' '}
        <span className="font-medium">{recommendedModelName}</span>, but it's
        not compatible with the current aspect ratio.
      </p>
    );
  }
  if (status === 'unknown') {
    return (
      <p className="text-[10px] text-muted-foreground">
        {styleName ? `${styleName} recommends` : 'Recommended'} a model that's
        no longer available.
      </p>
    );
  }
  return null;
}

type MotionModelSelectorProps = {
  selectedModel: ImageToVideoModel;
  onModelChange: (model: ImageToVideoModel) => void;
  disabled?: boolean;
  /** Per-scene generation status by model (#545); renders ✓/⟳/! in the list. */
  generatedStatuses?: Map<string, ModelGenerationStatus>;
} & MotionModelFilterProps;

export const MotionModelSelector: React.FC<MotionModelSelectorProps> = ({
  selectedModel,
  onModelChange,
  disabled = false,
  aspectRatio,
  styleCategory,
  recommendedVideoModel,
  styleName,
  generatedStatuses,
}) => {
  const baseModels = useMotionModels({
    aspectRatio,
    styleCategory,
    recommendedVideoModel,
    styleName,
  });
  const models = useMemo(
    () =>
      baseModels.map((m) => ({
        ...m,
        generationStatus: generatedStatuses?.get(m.id),
      })),
    [baseModels, generatedStatuses]
  );
  const recommendationStatus = useRecommendationStatus(
    recommendedVideoModel,
    aspectRatio
  );

  return (
    <div className="flex flex-col gap-1">
      <BaseModelSelector
        label="Motion Model"
        models={models}
        groupOrder={GROUP_ORDER}
        selectedIds={[selectedModel]}
        onSelectionChange={(ids) => {
          const firstId = ids[0];
          if (firstId && isValidImageToVideoModel(firstId)) {
            onModelChange(firstId);
          }
        }}
        disabled={disabled}
        multiSelect={false}
      />
      <RecommendationHint
        status={recommendationStatus}
        recommendedVideoModel={recommendedVideoModel}
        styleName={styleName}
      />
    </div>
  );
};

type MotionModelMultiSelectorProps = {
  selectedModels: ImageToVideoModel[];
  onModelsChange: (models: ImageToVideoModel[]) => void;
  disabled?: boolean;
} & MotionModelFilterProps;

export const MotionModelMultiSelector: React.FC<
  MotionModelMultiSelectorProps
> = ({
  selectedModels,
  onModelsChange,
  disabled = false,
  aspectRatio,
  styleCategory,
  recommendedVideoModel,
  styleName,
}) => {
  const models = useMotionModels({
    aspectRatio,
    styleCategory,
    recommendedVideoModel,
    styleName,
  });
  const recommendationStatus = useRecommendationStatus(
    recommendedVideoModel,
    aspectRatio
  );

  return (
    <div className="flex flex-col gap-1">
      <BaseModelSelector
        label="Motion Models"
        models={models}
        groupOrder={GROUP_ORDER}
        selectedIds={selectedModels}
        onSelectionChange={(ids) => {
          const validIds = ids.filter(isValidImageToVideoModel);
          if (validIds.length > 0) {
            onModelsChange(validIds);
          }
        }}
        disabled={disabled}
        multiSelect={true}
      />
      <RecommendationHint
        status={recommendationStatus}
        recommendedVideoModel={recommendedVideoModel}
        styleName={styleName}
      />
    </div>
  );
};
