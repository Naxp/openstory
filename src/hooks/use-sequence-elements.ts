import {
  analyzeDraftElementFn,
  deleteSequenceElementFn,
  finalizeElementUploadFn,
  listSequenceElementsFn,
  presignDraftElementUploadFn,
  presignElementUploadFn,
  renameSequenceElementTokenFn,
} from '@/functions/sequence-elements';
import type { SequenceElement } from '@/lib/db/schema';
import { putToR2 } from '@/lib/utils/upload';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

export const sequenceElementKeys = {
  all: ['sequence-elements'] as const,
  bySequence: (sequenceId: string) =>
    ['sequence-elements', sequenceId] as const,
};

export function useSequenceElements(sequenceId: string | undefined) {
  return useQuery({
    queryKey: sequenceId
      ? sequenceElementKeys.bySequence(sequenceId)
      : ['sequence-elements', 'none'],
    queryFn: () =>
      listSequenceElementsFn({ data: { sequenceId: sequenceId ?? '' } }),
    enabled: Boolean(sequenceId),
    // Poll while vision is still analyzing
    refetchInterval: (query) => {
      const data = query.state.data as SequenceElement[] | undefined;
      if (!data) return false;
      const hasPending = data.some(
        (el) => el.visionStatus === 'pending' || el.visionStatus === 'analyzing'
      );
      return hasPending ? 2000 : false;
    },
  });
}

/**
 * Upload an element file into an existing sequence: presign → R2 → finalize.
 */
export function useUploadElementToSequence() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: {
      file: File;
      sequenceId: string;
      onProgress?: (percent: number) => void;
    }) => {
      const presign = await presignElementUploadFn({
        data: { filename: data.file.name, sequenceId: data.sequenceId },
      });
      await putToR2(
        presign.uploadUrl,
        data.file,
        presign.contentType,
        data.onProgress
      );
      const element = await finalizeElementUploadFn({
        data: {
          sequenceId: data.sequenceId,
          publicUrl: presign.publicUrl,
          path: presign.path,
          filename: data.file.name,
        },
      });
      return element;
    },
    onSuccess: (_element, variables) => {
      void queryClient.invalidateQueries({
        queryKey: sequenceElementKeys.bySequence(variables.sequenceId),
      });
    },
  });
}

export type DraftElementUpload = {
  tempPath: string;
  tempPublicUrl: string;
  filename: string;
  token: string;
  /**
   * Vision-LLM description, populated during draft upload. `useUploadDraftElement`
   * rejects if vision fails, so successful uploads always carry both fields —
   * but `promoteTempElements` still accepts nullable values for backwards-compat
   * with E2E fixture paths and falls back to the async vision workflow there.
   */
  description: string | null;
  consistencyTag: string | null;
};

/**
 * Upload an element file as a *draft* (before a sequence exists). Returns the
 * temp storage path + public URL so the caller can persist it in local state
 * and pass it to the createSequence mutation for promotion.
 *
 * Runs vision analysis inline after the upload resolves so promoteTempElements
 * can write the row in `completed` state with description + consistencyTag
 * already populated. The mutation rejects on vision failure — the element
 * selector surfaces this as an error entry and the user must retry or remove
 * the upload before Generate can proceed. (This is what stops a `pending`
 * element from reaching the analyze workflow and poisoning prompt hashes.)
 */
export function useUploadDraftElement() {
  return useMutation({
    mutationFn: async (data: {
      file: File;
      onProgress?: (percent: number) => void;
      onAnalyzingChange?: (analyzing: boolean) => void;
    }): Promise<DraftElementUpload> => {
      const presign = await presignDraftElementUploadFn({
        data: { filename: data.file.name },
      });
      await putToR2(
        presign.uploadUrl,
        data.file,
        presign.contentType,
        data.onProgress
      );
      const token = data.file.name
        .replace(/\.[^.]+$/, '')
        .toUpperCase()
        .replace(/[^A-Z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');
      const finalToken = token.length > 0 ? token : 'ELEMENT';

      data.onAnalyzingChange?.(true);
      let result: { description: string; consistencyTag: string };
      try {
        result = await analyzeDraftElementFn({
          data: {
            publicUrl: presign.publicUrl,
            filename: data.file.name,
            token: finalToken,
          },
        });
      } finally {
        data.onAnalyzingChange?.(false);
      }

      return {
        tempPath: presign.path,
        tempPublicUrl: presign.publicUrl,
        filename: data.file.name,
        token: finalToken,
        description: result.description,
        consistencyTag: result.consistencyTag,
      };
    },
  });
}

export function useDeleteSequenceElement() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: { elementId: string; sequenceId: string }) =>
      deleteSequenceElementFn({ data }),
    onSuccess: (_res, variables) => {
      void queryClient.invalidateQueries({
        queryKey: sequenceElementKeys.bySequence(variables.sequenceId),
      });
    },
  });
}

export function useRenameSequenceElementToken() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: {
      elementId: string;
      sequenceId: string;
      token: string;
    }) => renameSequenceElementTokenFn({ data }),
    onSuccess: (_res, variables) => {
      void queryClient.invalidateQueries({
        queryKey: sequenceElementKeys.bySequence(variables.sequenceId),
      });
    },
  });
}
