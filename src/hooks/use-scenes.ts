/**
 * Scene queries + the scene-model mutation (#909).
 *
 * Scenes own the image/video model for their shots. The list is read with
 * Suspense (consumers wrap in `<Suspense>`); the model mutation optimistically
 * patches the cached scene so the picker reflects the choice immediately, then
 * reconciles with the server row on success.
 */

import { getScenesFn, updateSceneModelsFn } from '@/functions/scenes';
import type { SceneRow } from '@/lib/db/schema';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

const sceneKeys = {
  all: ['scenes'] as const,
  lists: () => [...sceneKeys.all, 'list'] as const,
  list: (sequenceId: string) => [...sceneKeys.lists(), sequenceId] as const,
};

/** All scenes for a sequence, ordered by `orderIndex`. */
export function useScenes(sequenceId: string) {
  return useQuery<SceneRow[]>({
    queryKey: sceneKeys.list(sequenceId),
    queryFn: () => getScenesFn({ data: { sequenceId } }),
    staleTime: 30_000,
    enabled: !!sequenceId,
  });
}

type UpdateSceneModelsVars = {
  sequenceId: string;
  sceneId: string;
  imageModel?: string | null;
  videoModel?: string | null;
};

/** Persist a scene's image and/or video model, with optimistic cache patch. */
export function useUpdateSceneModels() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (vars: UpdateSceneModelsVars) =>
      updateSceneModelsFn({ data: vars }),
    onMutate: async (vars) => {
      const key = sceneKeys.list(vars.sequenceId);
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<SceneRow[]>(key);
      queryClient.setQueryData<SceneRow[]>(key, (old) =>
        old?.map((scene) =>
          scene.id === vars.sceneId
            ? {
                ...scene,
                ...(vars.imageModel !== undefined
                  ? { imageModel: vars.imageModel }
                  : {}),
                ...(vars.videoModel !== undefined
                  ? { videoModel: vars.videoModel }
                  : {}),
              }
            : scene
        )
      );
      return { previous };
    },
    onError: (_error, vars, ctx) => {
      if (ctx?.previous) {
        queryClient.setQueryData(sceneKeys.list(vars.sequenceId), ctx.previous);
      }
    },
    onSuccess: (updated, vars) => {
      queryClient.setQueryData<SceneRow[]>(
        sceneKeys.list(vars.sequenceId),
        (old) =>
          old?.map((scene) => (scene.id === updated.id ? updated : scene))
      );
    },
  });
}
