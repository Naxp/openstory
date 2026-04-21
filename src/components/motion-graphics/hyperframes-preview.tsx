/**
 * HyperframesPreview — client-side live preview of a frame composition using
 * the @hyperframes/player web component. Lets users see overlays immediately
 * without waiting for the server render.
 */

import { buildFrameComposition } from '@/lib/hyperframes/compose';
import type { FrameOverlay } from '@/lib/hyperframes/overlay.types';
import type { AspectRatio } from '@/lib/constants/aspect-ratios';
import { getAspectRatioClassName } from '@/lib/constants/aspect-ratios';
import { cn } from '@/lib/utils';
import { useEffect, useMemo, useRef, useState } from 'react';

type HyperframesPreviewProps = {
  compositionId: string;
  videoUrl: string;
  overlays: FrameOverlay[];
  durationMs: number;
  aspectRatio: AspectRatio;
  className?: string;
};

export const HyperframesPreview: React.FC<HyperframesPreviewProps> = ({
  compositionId,
  videoUrl,
  overlays,
  durationMs,
  aspectRatio,
  className,
}) => {
  const [ready, setReady] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    import('@hyperframes/player')
      .then(() => {
        if (!cancelled) setReady(true);
      })
      .catch((err) => {
        console.error('[HyperframesPreview] failed to load player', err);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const html = useMemo(
    () =>
      buildFrameComposition({
        compositionId,
        videoUrl,
        durationMs,
        aspectRatio,
        overlays,
      }).html,
    [compositionId, videoUrl, durationMs, aspectRatio, overlays]
  );

  // The player custom element accepts an inline composition via attribute or
  // a src URL; here we inject the HTML via a Blob URL so we avoid attribute
  // size limits. Re-created when the composition changes.
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  useEffect(() => {
    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    setBlobUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [html]);

  return (
    <div
      ref={containerRef}
      className={cn(
        'relative w-full overflow-hidden bg-black',
        getAspectRatioClassName(aspectRatio),
        className
      )}
    >
      {ready && blobUrl && (
        <hyperframes-player
          src={blobUrl}
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
          }}
        />
      )}
    </div>
  );
};
