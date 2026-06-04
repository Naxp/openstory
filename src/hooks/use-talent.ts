import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createTalentFn,
  deleteTalentFn,
  generateTalentSheetFn,
  getTalentByIdFn,
  getTalentFn,
  presignTalentUploadFn,
  finalizeTalentUploadFn,
  setDefaultSheetFn,
  toggleTalentFavoriteFn,
  updateTalentFn,
  deleteTalentMediaFn,
} from '@/functions/talent';
import { useSession } from '@/lib/auth/client';
import { putToR2 } from '@/lib/utils/upload';
import type {
  CreateTalentInput,
  UpdateTalentInput,
} from '@/lib/schemas/talent.schemas';

/**
 * Query keys for talent data
 */
export const talentKeys = {
  all: ['talent'] as const,
  lists: () => [...talentKeys.all, 'list'] as const,
  list: (filters: { favoritesOnly?: boolean }) =>
    [...talentKeys.lists(), filters] as const,
  details: () => [...talentKeys.all, 'detail'] as const,
  detail: (id: string) => [...talentKeys.details(), id] as const,
};

/**
 * Hook to fetch all talent for the current team
 */
export function useTalent(options?: { favoritesOnly?: boolean }) {
  // Talent is team-scoped; skip the request entirely for anonymous visitors
  // (e.g. the suggestion picker on the public new-sequence screen).
  const { data: session } = useSession();
  return useQuery({
    queryKey: talentKeys.list(options ?? {}),
    queryFn: () => getTalentFn({ data: options }),
    enabled: !!session,
  });
}

/**
 * Hook to fetch a single talent with all relations
 */
export function useTalentById(talentId: string) {
  return useQuery({
    queryKey: talentKeys.detail(talentId),
    queryFn: () => getTalentByIdFn({ data: { talentId } }),
    enabled: !!talentId,
  });
}

/**
 * Hook to create new talent
 */
export function useCreateTalent() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreateTalentInput) => createTalentFn({ data }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: talentKeys.lists() });
    },
  });
}

/**
 * Hook to update talent
 */
export function useUpdateTalent() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: UpdateTalentInput & { talentId: string }) =>
      updateTalentFn({ data }),
    onSuccess: (_, variables) => {
      void queryClient.invalidateQueries({
        queryKey: talentKeys.detail(variables.talentId),
      });
      void queryClient.invalidateQueries({ queryKey: talentKeys.lists() });
    },
  });
}

/**
 * Hook to delete talent
 */
export function useDeleteTalent() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (talentId: string) => deleteTalentFn({ data: { talentId } }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: talentKeys.lists() });
    },
  });
}

/**
 * Hook to toggle talent favorite status
 */
export function useToggleTalentFavorite() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (talentId: string) =>
      toggleTalentFavoriteFn({ data: { talentId } }),
    onSuccess: (data) => {
      void queryClient.invalidateQueries({
        queryKey: talentKeys.detail(data.id),
      });
      void queryClient.invalidateQueries({ queryKey: talentKeys.lists() });
    },
  });
}

/**
 * Hook to upload talent media via presigned URL
 */
export function useUploadTalentMedia() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: {
      talentId: string;
      type: 'image' | 'video' | 'recording';
      file: File;
      onProgress?: (percent: number) => void;
    }) => {
      const presign = await presignTalentUploadFn({
        data: {
          filename: data.file.name,
          type: data.type,
          talentId: data.talentId,
        },
      });

      await putToR2(
        presign.uploadUrl,
        data.file,
        presign.contentType,
        data.onProgress
      );

      await finalizeTalentUploadFn({
        data: {
          talentId: data.talentId,
          type: data.type,
          mediaId: presign.mediaId,
          publicUrl: presign.publicUrl,
          path: presign.path,
        },
      });

      return {
        url: presign.publicUrl,
        path: presign.path,
        mediaId: presign.mediaId,
      };
    },
    onSuccess: (_, variables) => {
      void queryClient.invalidateQueries({
        queryKey: talentKeys.detail(variables.talentId),
      });
    },
  });
}

/**
 * Hook to upload temporary talent media (before talent record exists)
 */
export function useUploadTempMedia() {
  return useMutation({
    mutationFn: async (data: {
      file: File;
      type: 'image' | 'video';
      onProgress?: (percent: number) => void;
    }) => {
      const presign = await presignTalentUploadFn({
        data: {
          filename: data.file.name,
          type: data.type,
        },
      });

      await putToR2(
        presign.uploadUrl,
        data.file,
        presign.contentType,
        data.onProgress
      );

      return { url: presign.publicUrl, path: presign.path };
    },
  });
}

/**
 * Hook to delete talent media
 */
export function useDeleteTalentMedia() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: { mediaId: string; talentId: string }) =>
      deleteTalentMediaFn({ data: { mediaId: data.mediaId } }),
    onSuccess: (_, variables) => {
      void queryClient.invalidateQueries({
        queryKey: talentKeys.detail(variables.talentId),
      });
    },
  });
}

/**
 * Hook to generate a talent sheet from reference media
 */
export function useGenerateTalentSheet() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: { talentId: string; sheetName?: string }) =>
      generateTalentSheetFn({ data }),
    onSuccess: (_, variables) => {
      // Optimistically update the query - the realtime hook will handle the actual update
      void queryClient.invalidateQueries({
        queryKey: talentKeys.detail(variables.talentId),
      });
    },
  });
}

/**
 * Hook to set a talent sheet as the default
 */
export function useSetDefaultSheet() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: { sheetId: string; talentId: string }) =>
      setDefaultSheetFn({ data: { sheetId: data.sheetId } }),
    onSuccess: (_, variables) => {
      void queryClient.invalidateQueries({
        queryKey: talentKeys.detail(variables.talentId),
      });
      void queryClient.invalidateQueries({ queryKey: talentKeys.lists() });
    },
  });
}
