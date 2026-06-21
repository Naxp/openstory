import { GenerationProgressBanner } from '@/components/generation/generation-progress-banner';
import { MotionProgressBanner } from '@/components/generation/motion-progress-banner';
import { ScenePlayer } from '@/components/motion/scene-player';
import { MobileSceneDrawer } from '@/components/scenes/mobile-scene-drawer';
import { SceneList } from '@/components/scenes/scene-list';
import type { BatchGenerateMotionArgs } from '@/components/scenes/scene-list';
import { SceneModelHeader } from '@/components/scenes/scene-model-header';
import {
  SceneScriptPrompts,
  type TabValue,
} from '@/components/scenes/scene-script-prompts';
import { FailureSummaryBanner } from '@/components/sequence/failure-summary-banner';
import { ScrollArea } from '@/components/ui/scroll-area';
import { batchGenerateMotionFn } from '@/functions/motion-functions';
import { smartRetryFn } from '@/functions/smart-retry';
import { BILLING_BALANCE_KEY } from '@/hooks/use-billing-balance';
import {
  shotKeys,
  useDiscardVariant,
  useDivergentVariants,
  useShotsBySequence,
  usePromoteVariantToPrimary,
  useSequenceVideoVariants,
  useUndiscardVariant,
} from '@/hooks/use-shots';
import { useActiveImageModel } from '@/hooks/use-active-image-model';
import { useActiveVideoModel } from '@/hooks/use-active-video-model';
import { useScenes } from '@/hooks/use-scenes';
import {
  resolveSceneImageModel,
  resolveSceneVideoModel,
} from '@/lib/model/resolve-scene-model';
import { computeSceneModelStatuses } from '@/lib/model/scene-model-status';
import { useStaleDetected } from '@/lib/realtime/use-stale-detected';
import { DivergenceCompareDialog } from '@/components/scenes/divergence-compare-dialog';
import { getDivergentVariantPromptDiffFn } from '@/functions/prompt-variants';
import { sequenceKeys, useSequence } from '@/hooks/use-sequences';
import { useStyle } from '@/hooks/use-styles';
import {
  DEFAULT_IMAGE_MODEL,
  DEFAULT_MUSIC_MODEL,
  DEFAULT_VIDEO_MODEL,
  IMAGE_MODELS,
  isValidTextToImageModel,
  safeAudioModel,
  safeImageToVideoModel,
  safeTextToImageModel,
} from '@/lib/ai/models';
import {
  DEFAULT_ASPECT_RATIO,
  type AspectRatio,
} from '@/lib/constants/aspect-ratios';
import { analyzeFailures } from '@/lib/failures/failure-analysis';
import type { GenerationPhaseConfig } from '@/lib/realtime/generation-stream.reducer';
import { useGenerationStream } from '@/lib/realtime/use-generation-stream';
import { getSequenceImageVariantsFn } from '@/functions/shots';
import type { Shot, ShotVariant } from '@/lib/db/schema';
import type { Sequence } from '@/types/database';
import { usePostHog } from '@posthog/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';

type ScenesViewProps = {
  sequenceId: string;
};

const CompareWithPromptDiff: React.FC<{
  sequenceId: string;
  frame: Shot;
  variant: ShotVariant;
  onClose: () => void;
  onPromote: () => void;
  onDiscard: () => void;
  isPromoting: boolean;
  isDiscarding: boolean;
}> = ({
  sequenceId,
  frame,
  variant,
  onClose,
  onPromote,
  onDiscard,
  isPromoting,
  isDiscarding,
}) => {
  const { data: promptDiff } = useQuery({
    queryKey: ['variant-prompt-diff', sequenceId, variant.id],
    queryFn: () =>
      getDivergentVariantPromptDiffFn({
        data: { sequenceId, variantId: variant.id },
      }),
    staleTime: 30_000,
  });
  return (
    <DivergenceCompareDialog
      open={true}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      frame={frame}
      variant={variant}
      onPromote={onPromote}
      onDiscard={onDiscard}
      isPromoting={isPromoting}
      isDiscarding={isDiscarding}
      promptDiff={promptDiff ?? undefined}
    />
  );
};

// Full class names required for Tailwind JIT to detect at build time
// Split into max-width (for the wrapper, enables centering) and max-height (for the player div)
const PLAYER_MAX_W_BY_RATIO: Record<AspectRatio, string> = {
  '16:9': 'max-w-[calc(50vh*1.7777777777777777)]',
  '9:16': 'max-w-[calc(50vh*0.5625)]',
  '1:1': 'max-w-[50vh]',
};
const PLAYER_MAX_H = 'max-h-[50vh]';

type RegenerationType = 'image' | 'motion' | 'scene-variants';

function addToSet(prev: Set<string>, id: string): Set<string> {
  return new Set(prev).add(id);
}

function removeFromSet(prev: Set<string>, id: string): Set<string> {
  const next = new Set(prev);
  next.delete(id);
  return next;
}

function addAllToSet(prev: Set<string>, ids: string[]): Set<string> {
  const next = new Set(prev);
  for (const id of ids) next.add(id);
  return next;
}

function removeAllFromSet(prev: Set<string>, ids: string[]): Set<string> {
  const next = new Set(prev);
  for (const id of ids) next.delete(id);
  return next;
}

function isTerminalStatus(status: string | null): boolean {
  return status === 'completed' || status === 'failed';
}

function isInsufficientCreditsError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.message.includes('INSUFFICIENT_CREDITS') ||
      error.message.includes('Insufficient credits'))
  );
}

export const ScenesView: React.FC<ScenesViewProps> = ({ sequenceId }) => {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const posthog = usePostHog();

  const [selectedFrameId, setSelectedFrameId] = useState<string | undefined>();
  const [selectedTab, setSelectedTab] = useState<TabValue>('scene-variants');

  const [regeneratingImages, setRegeneratingImages] = useState<Set<string>>(
    () => new Set()
  );
  const [regeneratingMotion, setRegeneratingMotion] = useState<Set<string>>(
    () => new Set()
  );
  const [regeneratingSceneVariants, setRegeneratingSceneVariants] = useState<
    Set<string>
  >(() => new Set());

  // Poll sequence while a motion batch is in flight so per-frame statuses stay
  // fresh. The refetchInterval fn reads from the query cache each tick to
  // avoid a circular dependency between sequence state and the poll condition.
  const { data: sequence } = useSequence(sequenceId, {
    refetchInterval: (query) => {
      const seq = query.state.data;
      if (!seq) return false;
      const cachedFrames = queryClient.getQueryData<Shot[]>(
        shotKeys.list(sequenceId)
      );
      return cachedFrames?.some((f) => f.videoStatus === 'generating')
        ? 2000
        : false;
    },
  });
  const aspectRatio = sequence?.aspectRatio || DEFAULT_ASPECT_RATIO;
  const isProcessing = sequence?.status === 'processing';
  const { data: style } = useStyle(sequence?.styleId ?? '');
  const styleCategory = style?.category ?? undefined;
  const sequenceMusicModel = safeAudioModel(
    sequence?.musicModel,
    DEFAULT_MUSIC_MODEL
  );
  const styleName = style?.name ?? undefined;
  const recommendedImageModel = style?.recommendedImageModel ?? null;
  const recommendedVideoModel = style?.recommendedVideoModel ?? null;

  // Phase config from DB — set in stone when the workflow was triggered
  const phaseConfig = useMemo<GenerationPhaseConfig>(
    () => ({
      autoGenerateMotion: sequence?.autoGenerateMotion ?? false,
      autoGenerateMusic: sequence?.autoGenerateMusic ?? false,
    }),
    [sequence?.autoGenerateMotion, sequence?.autoGenerateMusic]
  );

  // Subscribe to real-time generation events when sequence is processing.
  // Skip history replay for non-processing sequences to avoid a brief flash of
  // the progress banner on tab re-mount caused by replaying old phase events.
  const {
    state: generationState,
    status: realtimeStatus,
    reset: resetGenerationStream,
  } = useGenerationStream(sequenceId, phaseConfig, {
    replayHistory: isProcessing,
  });

  // Hybrid polling: only poll when processing AND realtime has failed
  // - 'connecting' → wait for connection, don't poll
  // - 'connected' → use realtime, don't poll
  // - 'disconnected'/'error' → poll as fallback
  const realtimeFailed = realtimeStatus === 'error';
  const shouldPoll = isProcessing && realtimeFailed;

  // Fetch frames — only poll when processing AND realtime has failed.
  // Otherwise realtime events keep the cache fresh via updateQueryCacheFromEvent.
  const { data: frames } = useShotsBySequence(
    sequenceId,
    shouldPoll ? { refetchInterval: 2000 } : undefined
  );

  // Fetch image variants for this sequence
  const { data: imageVariants } = useQuery<ShotVariant[]>({
    queryKey: ['sequence-image-variants', sequenceId],
    queryFn: () => getSequenceImageVariantsFn({ data: { sequenceId } }),
    staleTime: 30_000,
    enabled: !!sequenceId,
  });

  // Video variants + viewer-local active video model (#545). When the viewer
  // pins a model in the header dropdown, the player resolves every frame's
  // video through that model's variant; "Mixed" (null) keeps each frame's own
  // (legacy) video.
  const { data: videoVariants } = useSequenceVideoVariants(sequenceId);
  const { activeVideoModel } = useActiveVideoModel(sequenceId);

  const videoVariantsByFrame = useMemo(() => {
    const map = new Map<string, ShotVariant[]>();
    if (!videoVariants) return map;
    for (const v of videoVariants) {
      if (v.variantType !== 'video') continue;
      const list = map.get(v.shotId) ?? [];
      list.push(v);
      map.set(v.shotId, list);
    }
    return map;
  }, [videoVariants]);

  // Viewer-local active image model (#547). When pinned, the player shows that
  // model's image for each frame (falling back to the legacy thumbnail when the
  // model has no completed image for a frame).
  const { activeImageModel } = useActiveImageModel(sequenceId);
  const imageVariantsByFrame = useMemo(() => {
    const map = new Map<string, ShotVariant[]>();
    if (!imageVariants) return map;
    for (const v of imageVariants) {
      if (v.variantType !== 'image') continue;
      const list = map.get(v.shotId) ?? [];
      list.push(v);
      map.set(v.shotId, list);
    }
    return map;
  }, [imageVariants]);

  // Scenes the pinned image model has NOT generated yet (#547). When a model is
  // pinned, the player + scene list flag these so a viewer isn't shown the
  // primary image as if it were the pinned model's output.
  const activeImageModelLabel =
    activeImageModel && isValidTextToImageModel(activeImageModel)
      ? IMAGE_MODELS[activeImageModel].name
      : null;
  const framesMissingActiveImage = useMemo(() => {
    const missing = new Set<string>();
    if (!activeImageModel || !frames) return missing;
    for (const f of frames) {
      const hasModel = imageVariantsByFrame
        .get(f.id)
        ?.some(
          (v) =>
            v.model === activeImageModel &&
            v.divergedAt === null &&
            v.discardedAt === null &&
            v.status === 'completed' &&
            v.url
        );
      if (!hasModel) missing.add(f.id);
    }
    return missing;
  }, [activeImageModel, frames, imageVariantsByFrame]);

  // Divergent alternates + realtime stale:detected wiring (issue #625).
  // Mirror the frames-list polling fallback so the corner-dot still updates
  // when realtime is down.
  const { data: divergentVariants } = useDivergentVariants(
    sequenceId,
    shouldPoll ? { refetchInterval: 2000 } : undefined
  );
  useStaleDetected(sequenceId);
  const promoteVariant = usePromoteVariantToPrimary();
  const discardVariant = useDiscardVariant();
  const undiscardVariant = useUndiscardVariant();
  const [compareVariant, setCompareVariant] = useState<ShotVariant | null>(
    null
  );

  const handleDiscardWithUndo = useCallback(
    (variant: ShotVariant) => {
      const restore = () => {
        undiscardVariant.mutate(
          {
            sequenceId,
            shotId: variant.shotId,
            variantId: variant.id,
          },
          {
            onError: (error) => {
              toast.error('Failed to restore alternate', {
                description:
                  error instanceof Error ? error.message : 'Unknown error',
              });
            },
          }
        );
      };
      discardVariant.mutate(
        { sequenceId, shotId: variant.shotId, variantId: variant.id },
        {
          onSuccess: () => {
            // Only close the dialog after the mutation succeeds — on failure
            // the user keeps the dialog open and can retry from there.
            setCompareVariant(null);
            toast('Alternate discarded', {
              action: { label: 'Undo', onClick: restore },
            });
          },
          onError: (error) => {
            toast.error('Failed to discard alternate', {
              description:
                error instanceof Error ? error.message : 'Unknown error',
            });
          },
        }
      );
    },
    [sequenceId, discardVariant, undiscardVariant]
  );

  // If the frame backing the open compare dialog disappears (e.g. concurrent
  // delete from another tab), close the dialog explicitly with a toast rather
  // than silently null-rendering it.
  useEffect(() => {
    if (!compareVariant || !frames) return;
    const stillExists = frames.some((f) => f.id === compareVariant.shotId);
    if (!stillExists) {
      toast.info('Scene was removed.');
      setCompareVariant(null);
    }
  }, [compareVariant, frames]);

  const handlePromote = useCallback(
    (variant: ShotVariant) => {
      promoteVariant.mutate(
        { sequenceId, shotId: variant.shotId, variantId: variant.id },
        {
          onSuccess: () => {
            setCompareVariant(null);
            toast.success('Alternate promoted');
          },
          onError: (error) => {
            toast.error('Failed to promote alternate', {
              description:
                error instanceof Error ? error.message : 'Unknown error',
            });
          },
        }
      );
    },
    [sequenceId, promoteVariant]
  );

  const curSelectedFrameId = selectedFrameId || frames?.[0]?.id;
  const selectedFrame = useMemo(
    () => frames?.find((frame) => frame.id === curSelectedFrameId),
    [frames, curSelectedFrameId]
  );

  // Scene-level model selection (#909): the image/video model is owned by the
  // selected shot's scene. Resolve it through scene → sequence → default so the
  // prompts panel + variant preview target the scene's chosen model rather than
  // a per-shot picker.
  const { data: scenes } = useScenes(sequenceId);
  const selectedSceneId = selectedFrame?.sceneId ?? null;
  const selectedScene = useMemo(
    () => scenes?.find((s) => s.id === selectedSceneId),
    [scenes, selectedSceneId]
  );
  const sceneImageModel = resolveSceneImageModel(selectedScene, sequence);
  const sceneVideoModel = resolveSceneVideoModel(selectedScene, sequence);

  // #910: when the selected scene was rendered as ONE multi-shot video
  // (`renderStrategy='multi-shot'`), the clip lives on the SCENE row, not the
  // shots — play `scenes.videoUrl` for any shot in that scene. A null/per-shot
  // renderStrategy (every legacy + per-shot scene) leaves this null, so the
  // player keeps using each shot's own `videoUrl` exactly as before.
  const multiShotSceneVideoUrl = useMemo(
    () =>
      selectedScene?.renderStrategy === 'multi-shot' &&
      selectedScene.videoStatus === 'completed' &&
      selectedScene.videoUrl
        ? selectedScene.videoUrl
        : null,
    [
      selectedScene?.renderStrategy,
      selectedScene?.videoStatus,
      selectedScene?.videoUrl,
    ]
  );

  // In-flight retry state (#882) for the selected frame. Image retry matters
  // before the thumbnail exists; video retry after — the image entry is cleared
  // once it completes, so preferring it is correct in both stages.
  const selectedFrameRetry = useMemo(() => {
    if (!curSelectedFrameId) return undefined;
    const r = generationState.frameRetries.get(curSelectedFrameId);
    return r?.image ?? r?.video;
  }, [generationState.frameRetries, curSelectedFrameId]);

  // Filter variants for the currently selected frame
  const selectedShotVariants = useMemo(() => {
    if (!imageVariants || !curSelectedFrameId) return undefined;
    return imageVariants.filter(
      (v) => v.shotId === curSelectedFrameId && v.variantType === 'image'
    );
  }, [imageVariants, curSelectedFrameId]);

  // Variant preview tracks the scene's chosen models (#909): the prompts panel's
  // Generate/Set state and previewed variant target the model the scene is set
  // to render with, replacing the former per-shot override.
  const variantForSelectedModel = useMemo(() => {
    if (!selectedShotVariants) return undefined;
    return selectedShotVariants.find((v) => v.model === sceneImageModel);
  }, [selectedShotVariants, sceneImageModel]);

  // Video equivalent: the selected scene's video variant for the scene's chosen
  // video model. Excludes divergent / discarded alternates so only the primary
  // per-model row is matched.
  const videoVariantForSelectedModel = useMemo(() => {
    if (!curSelectedFrameId) return undefined;
    return videoVariantsByFrame
      .get(curSelectedFrameId)
      ?.find(
        (v) =>
          v.model === sceneVideoModel &&
          v.divergedAt === null &&
          v.discardedAt === null
      );
  }, [videoVariantsByFrame, curSelectedFrameId, sceneVideoModel]);

  // The shots that make up the selected scene. Today every scene is a single
  // shot (#907 1:1), but the scene-granular coverage below aggregates across
  // these so the markers stay correct once #910 lands multi-shot scenes.
  const selectedSceneShots = useMemo(() => {
    if (!frames) return [];
    if (selectedSceneId) {
      return frames.filter((f) => f.sceneId === selectedSceneId);
    }
    // Orphan shot (no scene yet) — treat the shot itself as its scene.
    return selectedFrame ? [selectedFrame] : [];
  }, [frames, selectedSceneId, selectedFrame]);

  // Per-model generation status for the selected SCENE (#909) — feeds the
  // ✓/⟳/! markers in the scene header model pickers. A model is the scene's
  // "set" model when it's the scene's chosen model (sceneImage/VideoModel);
  // other models that have a completed variant for every shot in the scene read
  // `completed`, any in-flight reads `generating`, else `failed`/`pending`.
  // Primary rows only (divergent/discarded alternates excluded).
  const imageModelStatuses = useMemo(
    () =>
      computeSceneModelStatuses({
        shots: selectedSceneShots,
        variantsByFrame: imageVariantsByFrame,
        setModel: sceneImageModel,
      }),
    [selectedSceneShots, imageVariantsByFrame, sceneImageModel]
  );

  const videoModelStatuses = useMemo(
    () =>
      computeSceneModelStatuses({
        shots: selectedSceneShots,
        variantsByFrame: videoVariantsByFrame,
        setModel: sceneVideoModel,
      }),
    [selectedSceneShots, videoVariantsByFrame, sceneVideoModel]
  );

  const { previewVariantUrl, previewVariantVideoUrl, playerBadgeMessage } =
    useMemo(() => {
      const none = {
        previewVariantUrl: null,
        previewVariantVideoUrl: null,
        playerBadgeMessage: null,
      };
      if (!selectedFrame) return none;

      // Image preview (image-prompt tab)
      if (selectedTab === 'image-prompt') {
        if (
          variantForSelectedModel?.status === 'completed' &&
          variantForSelectedModel.url &&
          variantForSelectedModel.url !== selectedFrame.thumbnailUrl
        ) {
          return {
            ...none,
            previewVariantUrl: variantForSelectedModel.url,
            playerBadgeMessage: 'Click Set Image to use',
          };
        }
        const frameImageModel = safeTextToImageModel(
          selectedFrame.imageModel,
          DEFAULT_IMAGE_MODEL
        );
        if (sceneImageModel !== frameImageModel && !variantForSelectedModel) {
          return {
            ...none,
            playerBadgeMessage: 'Click Generate Image to create',
          };
        }
        return none;
      }

      // Video preview (motion-prompt tab) — mirror of the image flow (#545)
      if (selectedTab === 'motion-prompt') {
        if (
          videoVariantForSelectedModel?.status === 'completed' &&
          videoVariantForSelectedModel.url &&
          videoVariantForSelectedModel.url !== selectedFrame.videoUrl
        ) {
          return {
            ...none,
            previewVariantVideoUrl: videoVariantForSelectedModel.url,
            playerBadgeMessage: 'Click Set Video to use',
          };
        }
        const frameVideoModel = safeImageToVideoModel(
          selectedFrame.motionModel,
          DEFAULT_VIDEO_MODEL
        );
        // Prompt when the scene's video model differs from the frame's current
        // one with no variant yet.
        if (
          sceneVideoModel !== frameVideoModel &&
          !videoVariantForSelectedModel
        ) {
          return {
            ...none,
            playerBadgeMessage: 'Click Generate Motion to create',
          };
        }
        return none;
      }

      return none;
    }, [
      selectedTab,
      selectedFrame,
      sceneImageModel,
      sceneVideoModel,
      variantForSelectedModel,
      videoVariantForSelectedModel,
    ]);

  // Frames as shown by the player: when an image and/or video model is pinned,
  // swap each frame's image / video for that model's variant. Only the player
  // display is remapped — every other consumer keeps the raw `frames`
  // (generation status, selection, the per-frame preview overlay, etc.).
  const playerFrames = useMemo(() => {
    if (!frames) return frames;
    // Wait for the relevant variants query before remapping, so we don't blank
    // a pinned type while its data is still loading. The image pin is suppressed
    // on the image-prompt tab, where the per-frame preview overlay + prompt
    // panel govern the displayed image (avoids desyncing them from the header).
    const pinImage =
      activeImageModel && imageVariants && selectedTab !== 'image-prompt';
    const pinVideo = activeVideoModel && videoVariants;
    if (!pinImage && !pinVideo) return frames;
    return frames.map((f) => {
      let next = f;
      if (pinImage) {
        // Image: swap the displayed image; fall back to the legacy thumbnail
        // when the pinned model has no completed image for this frame (never
        // leave a frame imageless).
        const iv = imageVariantsByFrame
          .get(f.id)
          ?.find(
            (v) =>
              v.model === activeImageModel &&
              v.divergedAt === null &&
              v.discardedAt === null &&
              v.status === 'completed' &&
              v.url
          );
        if (iv?.url) next = { ...next, thumbnailUrl: iv.url };
      }
      if (pinVideo) {
        // Video: show only the pinned model's output (no fallback — a missing
        // variant means that model hasn't produced this frame yet).
        const vv = videoVariantsByFrame
          .get(f.id)
          ?.find(
            (v) =>
              v.model === activeVideoModel &&
              v.divergedAt === null &&
              v.discardedAt === null
          );
        next = vv
          ? {
              ...next,
              videoUrl: vv.status === 'completed' ? vv.url : null,
              videoStatus: vv.status,
            }
          : { ...next, videoUrl: null, videoStatus: 'pending' as const };
      }
      return next;
    });
  }, [
    frames,
    selectedTab,
    activeImageModel,
    imageVariants,
    imageVariantsByFrame,
    activeVideoModel,
    videoVariants,
    videoVariantsByFrame,
  ]);

  const setterForType = useCallback((type: RegenerationType) => {
    switch (type) {
      case 'image':
        return setRegeneratingImages;
      case 'motion':
        return setRegeneratingMotion;
      case 'scene-variants':
        return setRegeneratingSceneVariants;
    }
  }, []);

  const handleRegenerateStart = useCallback(
    (shotId: string, type: RegenerationType) => {
      setterForType(type)((prev) => addToSet(prev, shotId));
    },
    [setterForType]
  );

  const handleRegenerateEnd = useCallback(
    (shotId: string, type: RegenerationType) => {
      setterForType(type)((prev) => removeFromSet(prev, shotId));
    },
    [setterForType]
  );

  // Auto-remove frames from regenerating sets when generation completes or fails
  useEffect(() => {
    if (!frames) return;

    for (const frame of frames) {
      if (
        regeneratingImages.has(frame.id) &&
        isTerminalStatus(frame.thumbnailStatus)
      )
        handleRegenerateEnd(frame.id, 'image');
      if (
        regeneratingMotion.has(frame.id) &&
        isTerminalStatus(frame.videoStatus)
      )
        handleRegenerateEnd(frame.id, 'motion');
      if (
        regeneratingSceneVariants.has(frame.id) &&
        isTerminalStatus(frame.variantImageStatus)
      )
        handleRegenerateEnd(frame.id, 'scene-variants');
    }
  }, [
    frames,
    regeneratingImages,
    regeneratingMotion,
    regeneratingSceneVariants,
    handleRegenerateEnd,
  ]);

  // Derive motion banner state from query data so it persists naturally across
  // tab switches — no local state needed. startedAt uses the earliest
  // generating frame's updatedAt so elapsed time stays accurate.
  const motionBannerState = useMemo(() => {
    if (!frames || !sequence) return null;
    const anyGenerating = frames.some((f) => f.videoStatus === 'generating');
    if (!anyGenerating) return null;
    const generatingTimes = frames
      .filter((f) => f.videoStatus === 'generating')
      .map((f) => f.updatedAt.getTime());
    const startedAt =
      generatingTimes.length > 0 ? Math.min(...generatingTimes) : Date.now();
    return {
      startedAt,
      includeMusic: sequence.musicStatus === 'generating',
    };
  }, [frames, sequence]);

  const [isRetrying, setIsRetrying] = useState(false);

  const failureSummary = useMemo(
    () => (sequence ? analyzeFailures(frames ?? [], sequence) : null),
    [frames, sequence]
  );

  const handleFullRetry = useCallback(() => {
    void navigate({ to: '/sequences/$id/script', params: { id: sequenceId } });
  }, [sequenceId, navigate]);

  const handleSmartRetry = useCallback(async () => {
    setIsRetrying(true);
    try {
      const result = await smartRetryFn({ data: { sequenceId } });
      toast.success(`Retrying: ${result.retriedItems.join(', ')}`);
      void queryClient.invalidateQueries({
        queryKey: ['sequence', sequenceId],
      });
      void queryClient.invalidateQueries({ queryKey: ['shots', sequenceId] });
    } catch (error) {
      if (isInsufficientCreditsError(error)) {
        toast.error('Insufficient credits', {
          description: 'Add credits to retry.',
          action: {
            label: 'Add Credits',
            onClick: () => {
              window.location.href = '/credits';
            },
          },
        });
        void queryClient.invalidateQueries({
          queryKey: BILLING_BALANCE_KEY,
        });
      } else {
        toast.error('Failed to retry', {
          description: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    } finally {
      setIsRetrying(false);
    }
  }, [sequenceId, queryClient]);

  // Handler for batch motion generation (server determines eligible frames).
  // The video model is resolved per-scene server-side (#909), so no model is
  // passed here — each shot renders with its scene's chosen model.
  const handleBatchMotionGeneration = useCallback(
    async ({
      includeMusic,
      musicModel,
      generateAudio,
    }: BatchGenerateMotionArgs) => {
      // Optimistic: compute eligible frames locally (same filter as backend)
      const eligibleFrameIds = (frames ?? [])
        .filter(
          (f) =>
            f.thumbnailStatus === 'completed' &&
            (f.videoStatus === 'pending' || f.videoStatus === 'failed')
        )
        .map((f) => f.id);

      setRegeneratingMotion((prev) => addAllToSet(prev, eligibleFrameIds));

      // Optimistically mark frames as generating in the query cache so the
      // derived banner state shows the banner immediately — no separate state.
      const eligibleSet = new Set(eligibleFrameIds);
      const now = new Date();
      queryClient.setQueryData<Shot[]>(shotKeys.list(sequenceId), (old) =>
        old?.map((f) =>
          eligibleSet.has(f.id)
            ? { ...f, videoStatus: 'generating', updatedAt: now }
            : f
        )
      );
      if (includeMusic) {
        queryClient.setQueryData<Sequence>(
          sequenceKeys.detail(sequenceId),
          (old) => (old ? { ...old, musicStatus: 'generating' } : old)
        );
      }

      posthog.capture('motion_generation_started', {
        sequence_id: sequenceId,
        include_music: includeMusic,
        eligible_frame_count: eligibleFrameIds.length,
        music_model: includeMusic ? musicModel : undefined,
        generate_audio: generateAudio,
      });

      try {
        await batchGenerateMotionFn({
          data: {
            sequenceId,
            includeMusic,
            musicModel: includeMusic ? musicModel : undefined,
            generateAudio,
          },
        });
        // Server may have updated sequence.musicModel to the batch pick;
        // invalidate so the header badge and footer pre-fill reflect it.
        void queryClient.invalidateQueries({
          queryKey: sequenceKeys.detail(sequenceId),
        });
      } catch (error) {
        setRegeneratingMotion((prev) =>
          removeAllFromSet(prev, eligibleFrameIds)
        );
        // Roll back optimistic cache updates
        queryClient.setQueryData<Shot[]>(shotKeys.list(sequenceId), (old) =>
          old?.map((f) =>
            eligibleSet.has(f.id) ? { ...f, videoStatus: 'pending' } : f
          )
        );
        if (includeMusic) {
          void queryClient.invalidateQueries({
            queryKey: sequenceKeys.detail(sequenceId),
          });
        }

        if (isInsufficientCreditsError(error)) {
          toast.error('Insufficient credits', {
            description: 'Add credits to generate motion for all frames.',
            action: {
              label: 'Add Credits',
              onClick: () => {
                window.location.href = '/credits';
              },
            },
          });
          void queryClient.invalidateQueries({
            queryKey: BILLING_BALANCE_KEY,
          });
        } else {
          throw error;
        }
      }
    },
    [sequenceId, frames, queryClient, posthog]
  );

  const musicPromptsReady = !!(sequence?.musicPrompt && sequence.musicTags);

  // GenerationProgressBanner is owned by the script-analysis pipeline
  // (sequence.status === 'processing'). Standalone motion gen runs when the
  // sequence is already 'completed' / 'ready', so it must render via the
  // dedicated MotionProgressBanner — never the 5-stage banner. Trusting
  // generationState.currentPhase here would let leftover phase events from
  // past runs hijack the UI back to the 5-stage banner.
  const isGenerationActive = isProcessing;

  return (
    <div className="flex h-full flex-col">
      {/* Generation progress banner */}
      {isGenerationActive && (
        <div className="pl-4 pr-4 pt-4 md:pr-8">
          <GenerationProgressBanner
            generationState={generationState}
            isProcessing={isProcessing}
            startedAt={sequence.updatedAt}
            script={sequence.script ?? undefined}
          />
        </div>
      )}

      {/* Motion generation progress banner */}
      {!isGenerationActive &&
        motionBannerState !== null &&
        sequence &&
        frames && (
          <div className="pl-4 pr-4 pt-4 md:pr-8">
            <MotionProgressBanner
              shots={frames}
              sequence={sequence}
              includeMusic={motionBannerState.includeMusic}
              startedAt={motionBannerState.startedAt}
              onComplete={resetGenerationStream}
            />
          </div>
        )}

      {/* Failure summary with smart retry */}
      {failureSummary?.hasFailed && (
        <FailureSummaryBanner
          summary={failureSummary}
          onRetry={() => void handleSmartRetry()}
          onFullRetry={handleFullRetry}
          isRetrying={isRetrying}
        />
      )}

      <div className="flex flex-1 min-h-0">
        {/* Desktop: Scene List sidebar */}
        <div className="hidden md:block pl-4 py-4">
          <SceneList
            shots={frames}
            selectedFrameId={curSelectedFrameId}
            aspectRatio={aspectRatio}
            onSelectShot={setSelectedFrameId}
            regeneratingImages={regeneratingImages}
            regeneratingMotion={regeneratingMotion}
            onBatchGenerateMotion={handleBatchMotionGeneration}
            musicPromptsReady={musicPromptsReady}
            hideBatchButton={
              phaseConfig.autoGenerateMotion && isGenerationActive
            }
            divergentVariants={divergentVariants}
            onCompareDivergent={(variant) => setCompareVariant(variant)}
            initialMusicModel={sequenceMusicModel}
            modelMissingFrameIds={framesMissingActiveImage}
            modelMissingLabel={activeImageModelLabel}
          />
        </div>

        {/* Mobile: Bottom drawer */}
        <div className="md:hidden">
          <MobileSceneDrawer
            shots={frames}
            selectedFrameId={curSelectedFrameId}
            aspectRatio={aspectRatio}
            onSelectShot={setSelectedFrameId}
            regeneratingImages={regeneratingImages}
            regeneratingMotion={regeneratingMotion}
            onBatchGenerateMotion={handleBatchMotionGeneration}
            musicPromptsReady={musicPromptsReady}
            hideBatchButton={
              phaseConfig.autoGenerateMotion && isGenerationActive
            }
            initialMusicModel={sequenceMusicModel}
          />
        </div>

        {/* Main content area */}
        <ScrollArea className="flex-1 px-4 md:px-8 gap-8 flex flex-col pb-20 md:pb-0 pt-4">
          <div className="flex flex-1 min-h-0 justify-center pb-8">
            <ScenePlayer
              shots={playerFrames}
              selectedFrameId={curSelectedFrameId}
              aspectRatio={aspectRatio}
              onSelectShot={setSelectedFrameId}
              selectedTab={selectedTab}
              overrideImageUrl={previewVariantUrl}
              // Variant preview (explicit user pick) wins; otherwise play the
              // scene-level multi-shot clip when this scene rendered as one.
              overrideVideoUrl={
                previewVariantVideoUrl ?? multiShotSceneVideoUrl
              }
              badgeMessage={playerBadgeMessage}
              modelMismatchLabel={
                selectedTab === 'scene-variants' &&
                activeImageModelLabel &&
                curSelectedFrameId &&
                framesMissingActiveImage.has(curSelectedFrameId)
                  ? `Not generated with ${activeImageModelLabel}`
                  : null
              }
              progressMessage={
                generationState.phases.find((p) => p.status === 'active')
                  ?.phaseName
              }
              retry={selectedFrameRetry}
              posterUrl={sequence?.posterUrl ?? undefined}
              className={PLAYER_MAX_H}
              wrapperClassName={PLAYER_MAX_W_BY_RATIO[aspectRatio]}
            />
          </div>
          {/* Scene-level model pickers (#909): one look + one motion character
              per scene, replacing the former per-shot pickers. */}
          <SceneModelHeader
            sequenceId={sequenceId}
            sceneId={selectedSceneId}
            sequence={sequence}
            aspectRatio={aspectRatio}
            styleCategory={styleCategory}
            styleName={styleName}
            recommendedImageModel={recommendedImageModel}
            recommendedVideoModel={recommendedVideoModel}
            imageModelStatuses={imageModelStatuses}
            videoModelStatuses={videoModelStatuses}
          />
          <SceneScriptPrompts
            frame={selectedFrame}
            sequenceId={sequenceId}
            selectedTab={selectedTab}
            onTabChange={setSelectedTab}
            regeneratingImages={regeneratingImages}
            regeneratingMotion={regeneratingMotion}
            regeneratingSceneVariants={regeneratingSceneVariants}
            onRegenerateStart={handleRegenerateStart}
            aspectRatio={aspectRatio}
            variantForSelectedModel={variantForSelectedModel}
            videoVariantForSelectedModel={videoVariantForSelectedModel}
            sceneImageModel={sceneImageModel}
            sceneVideoModel={sceneVideoModel}
            frameDivergentVariants={divergentVariants?.filter(
              (v) => v.shotId === curSelectedFrameId
            )}
            onCompareDivergent={(variant) => setCompareVariant(variant)}
          />
        </ScrollArea>
      </div>

      {compareVariant &&
        (() => {
          const targetFrame = frames?.find(
            (f) => f.id === compareVariant.shotId
          );
          if (!targetFrame) return null;
          return (
            <CompareWithPromptDiff
              sequenceId={sequenceId}
              frame={targetFrame}
              variant={compareVariant}
              onClose={() => setCompareVariant(null)}
              onPromote={() => handlePromote(compareVariant)}
              onDiscard={() => handleDiscardWithUndo(compareVariant)}
              isPromoting={promoteVariant.isPending}
              isDiscarding={discardVariant.isPending}
            />
          );
        })()}
    </div>
  );
};
