import { useMemo } from 'react';
import { useQueries } from '@tanstack/react-query';
import { useSequences } from './use-sequences';
import { shotKeys } from './use-shots';
import { getShotsFn } from '@/functions/shots';
import type { Sequence, Shot } from '@/types/database';

export type SequenceWithShots = Sequence & {
  shots: Shot[];
  // Present only when fetched via the admin/support endpoint. Optional on the
  // base type so components render a single CreatorIdentity regardless of source.
  creatorName?: string | null;
  creatorEmail?: string | null;
};

/**
 * Fetches all sequences and their shots in parallel.
 * Returns sequences as soon as they resolve so the UI can render rows
 * progressively; shots are reported via `shotsLoadingMap` per sequence.
 */
export function useSequencesWithShots() {
  const {
    data: sequences,
    isLoading: seqLoading,
    error: seqError,
  } = useSequences();

  const shotsQueries = useQueries({
    queries: (sequences || []).map((seq: Sequence) => ({
      queryKey: shotKeys.list(seq.id),
      queryFn: async (): Promise<Shot[]> => {
        const data = await getShotsFn({ data: { sequenceId: seq.id } });
        return data;
      },
      staleTime: 5 * 60 * 1000,
      enabled: !!sequences && sequences.length > 0,
    })),
  });

  const data = useMemo<SequenceWithShots[]>(() => {
    if (!sequences) return [];

    return sequences.map((seq: Sequence, i: number) => ({
      ...seq,
      shots: shotsQueries[i]?.data ?? [],
    }));
  }, [sequences, shotsQueries]);

  const shotsLoadingMap = useMemo<Record<string, boolean>>(() => {
    const map: Record<string, boolean> = {};
    (sequences ?? []).forEach((seq, i) => {
      const q = shotsQueries[i];
      map[seq.id] = Boolean(q?.isLoading);
    });
    return map;
  }, [sequences, shotsQueries]);

  const error = seqError || shotsQueries.find((q) => q.error)?.error;

  return {
    data,
    isLoading: seqLoading,
    shotsLoadingMap,
    error,
  };
}
