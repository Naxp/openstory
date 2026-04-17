import { getChannelHistoryFn } from '@/functions/realtime-history';
import { useRealtime } from '@/lib/realtime/client';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useState } from 'react';
import { talentKeys } from './use-talent';

type GenerationPhase = 'sheet' | 'portrait';

type SheetProgressEvent = {
  event: string;
  data: {
    talentId: string;
    status: 'generating' | 'sheet_ready' | 'completed' | 'failed';
    sheetId?: string;
    sheetImageUrl?: string;
    headshotImageUrl?: string;
    error?: string;
  };
};

/**
 * Determine the current generation state from a sequence of history events.
 * Returns the phase if generation is still in flight, null otherwise.
 */
function resolveStatusFromHistory(
  events: { event: string; data: string }[],
  talentId: string
): GenerationPhase | null {
  let lastStatus: string | null = null;

  for (const evt of events) {
    if (evt.event !== 'talent.sheet:progress') continue;
    try {
      const parsed = JSON.parse(evt.data);
      if (parsed.talentId !== talentId) continue;
      lastStatus = parsed.status;
    } catch {
      // skip unparseable events
    }
  }

  if (lastStatus === 'generating') return 'sheet';
  if (lastStatus === 'sheet_ready') return 'portrait';
  return null;
}

/**
 * Hook for subscribing to real-time talent sheet generation events.
 *
 * Replays channel history on mount so that in-flight generation is detected
 * even if the page was opened after the 'generating' event was emitted.
 *
 * @param talentId - The talent ID to subscribe to
 * @returns Generation status, current phase, and any error message
 */
export function useTalentSheetRealtime(talentId?: string) {
  const queryClient = useQueryClient();
  const [isGenerating, setIsGenerating] = useState(false);
  const [phase, setPhase] = useState<GenerationPhase>('sheet');
  const [error, setError] = useState<string | null>(null);

  // Replay channel history on mount to catch in-flight generation
  useEffect(() => {
    if (!talentId) return;

    getChannelHistoryFn({ data: { channel: `talent:${talentId}` } })
      .then((events) => {
        const historyPhase = resolveStatusFromHistory(events, talentId);
        if (historyPhase) {
          setIsGenerating(true);
          setPhase(historyPhase);
          setError(null);
          // If sheet is already ready, refresh data to show it
          if (historyPhase === 'portrait') {
            void queryClient.invalidateQueries({
              queryKey: talentKeys.detail(talentId),
            });
          }
        }
      })
      .catch((err: Error) => {
        console.error(
          `[useTalentSheetRealtime] Failed to fetch history for talent:${talentId}:`,
          err
        );
      });
  }, [talentId, queryClient]);

  const handleEvent = useCallback(
    (event: SheetProgressEvent) => {
      const { event: eventName, data } = event;

      if (eventName !== 'talent.sheet:progress') return;
      if (data.talentId !== talentId) return;

      switch (data.status) {
        case 'generating':
          setIsGenerating(true);
          setPhase('sheet');
          setError(null);
          break;

        case 'sheet_ready':
          // Sheet is done, now generating portrait headshot
          setPhase('portrait');
          // Invalidate to show the new sheet immediately
          void queryClient.invalidateQueries({
            queryKey: talentKeys.detail(data.talentId),
          });
          break;

        case 'completed':
          setIsGenerating(false);
          setPhase('sheet');
          setError(null);
          // Invalidate talent queries to refresh sheets and headshot
          void queryClient.invalidateQueries({
            queryKey: talentKeys.detail(data.talentId),
          });
          // Also invalidate list to show new headshot in talent grid
          void queryClient.invalidateQueries({
            queryKey: talentKeys.lists(),
          });
          break;

        case 'failed':
          setIsGenerating(false);
          setError(data.error ?? 'Sheet generation failed');
          break;
      }
    },
    [talentId, queryClient]
  );

  const { status } = useRealtime({
    channels: talentId ? [`talent:${talentId}`] : [],
    events: ['talent.sheet:progress'] as const,
    onData: handleEvent,
    enabled: !!talentId,
  });

  // Allow starting generation optimistically (before realtime event arrives)
  const startGenerating = useCallback(() => {
    setIsGenerating(true);
    setPhase('sheet');
    setError(null);
  }, []);

  return {
    isGenerating,
    phase,
    error,
    connectionStatus: status,
    startGenerating,
  };
}
