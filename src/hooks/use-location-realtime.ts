import { getChannelHistoryFn } from '@/functions/realtime-history';
import { useRealtime } from '@/lib/realtime/client';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useState } from 'react';
import { locationLibraryKeys } from './use-location-library';
import { libraryLocationKeys } from './use-sequence-locations';

type SheetProgressEvent = {
  event: string;
  data: {
    locationId: string;
    status: 'generating' | 'completed' | 'failed';
    sheetImageUrl?: string;
    error?: string;
  };
};

type StaleDetectedEvent = {
  event: string;
  data: {
    entityType: string;
    entityId: string;
    artifact?: string;
    snapshotInputHash: string;
    divergedVariantId?: string;
  };
};

type LocationRealtimeEvent = SheetProgressEvent | StaleDetectedEvent;

/**
 * Determine the current generation state from channel history.
 */
function resolveStatusFromHistory(
  events: { event: string; data: string }[],
  locationId: string
): 'generating' | null {
  let lastStatus: string | null = null;

  for (const evt of events) {
    if (evt.event !== 'location.sheet:progress') continue;
    try {
      const parsed = JSON.parse(evt.data);
      if (parsed.locationId !== locationId) continue;
      lastStatus = parsed.status;
    } catch {
      // skip
    }
  }

  return lastStatus === 'generating' ? 'generating' : null;
}

/**
 * Hook for subscribing to real-time location sheet generation events.
 * Replays channel history on mount to catch in-flight generation.
 */
export function useLocationSheetRealtime(locationId?: string) {
  const queryClient = useQueryClient();
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Replay channel history on mount
  useEffect(() => {
    if (!locationId) return;

    getChannelHistoryFn({ data: { channel: `location:${locationId}` } })
      .then((events) => {
        if (resolveStatusFromHistory(events, locationId) === 'generating') {
          setIsGenerating(true);
          setError(null);
        }
      })
      .catch((err: Error) => {
        console.error(
          `[useLocationSheetRealtime] Failed to fetch history for location:${locationId}:`,
          err
        );
      });
  }, [locationId]);

  const handleEvent = useCallback(
    (event: LocationRealtimeEvent) => {
      const { event: eventName, data } = event;

      if (eventName === 'generation.stale:detected') {
        if ('entityType' in data && data.entityType !== 'library-location') {
          return;
        }
        // Library-location reference diverged into `location_sheet_variants`.
        // The library row's primary reference is unchanged. Refetch detail
        // and list so any variant-surfacing UI picks up the new alternate.
        if (locationId) {
          void queryClient.invalidateQueries({
            queryKey: locationLibraryKeys.detail(locationId),
          });
        }
        void queryClient.invalidateQueries({
          queryKey: libraryLocationKeys.all,
        });
        return;
      }

      if (eventName !== 'location.sheet:progress') return;
      if (!('locationId' in data) || data.locationId !== locationId) return;
      const sheetData = data;

      switch (sheetData.status) {
        case 'generating':
          setIsGenerating(true);
          setError(null);
          break;

        case 'completed':
          setIsGenerating(false);
          setError(null);
          if (locationId) {
            void queryClient.invalidateQueries({
              queryKey: locationLibraryKeys.detail(locationId),
            });
          }
          void queryClient.invalidateQueries({
            queryKey: libraryLocationKeys.all,
          });
          break;

        case 'failed':
          setIsGenerating(false);
          setError(sheetData.error ?? 'Sheet generation failed');
          break;
      }
    },
    [locationId, queryClient]
  );

  const { status } = useRealtime({
    channels: locationId ? [`location:${locationId}`] : [],
    events: ['location.sheet:progress', 'generation.stale:detected'] as const,
    onData: handleEvent,
    enabled: !!locationId,
  });

  const startGenerating = useCallback(() => {
    setIsGenerating(true);
    setError(null);
  }, []);

  return {
    isGenerating,
    error,
    connectionStatus: status,
    startGenerating,
  };
}
