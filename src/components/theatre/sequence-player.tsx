import type { HyperframesPlayer } from '@hyperframes/player';
import {
  type AspectRatio,
  aspectRatioToDimensions,
  getAspectRatioClassName,
} from '@/lib/constants/aspect-ratios';
import { cn } from '@/lib/utils';
import type { Frame } from '@/types/database';
import { useEffect, useRef } from 'react';
import { useSequenceCompositionSrc } from './sequence-composition';

// Browser-only registration of <hyperframes-player>. The package's top-level
// code calls customElements.define() which is undefined on the server, so we
// lazy-import on first client mount. The element renders as unknown briefly,
// then gets upgraded by the platform once registration resolves.
let registrationPromise: Promise<unknown> | null = null;
const ensureRegistered = (): Promise<unknown> => {
  if (typeof window === 'undefined') return Promise.resolve();
  registrationPromise ??= import('@hyperframes/player');
  return registrationPromise;
};

declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      'hyperframes-player': React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement> & {
          src?: string;
          srcdoc?: string;
          poster?: string;
          width?: number | string;
          height?: number | string;
          controls?: boolean | '';
          muted?: boolean | '';
          autoplay?: boolean | '';
          loop?: boolean | '';
          'playback-rate'?: number | string;
          'audio-src'?: string;
        },
        HTMLElement
      >;
    }
  }
}

type SequencePlayerProps = {
  sequenceId: string;
  frames: Frame[];
  musicUrl: string | null | undefined;
  aspectRatio: AspectRatio;
  posterUrl?: string | null;
  className?: string;
  onTimeUpdate?: (currentTime: number) => void;
  onEnded?: () => void;
  onReady?: (duration: number) => void;
};

export const SequencePlayer: React.FC<SequencePlayerProps> = ({
  sequenceId,
  frames,
  musicUrl,
  aspectRatio,
  posterUrl,
  className,
  onTimeUpdate,
  onEnded,
  onReady,
}) => {
  const { src, playableFrameCount } = useSequenceCompositionSrc({
    sequenceId,
    frames,
    musicUrl,
    aspectRatio,
  });

  const playerRef = useRef<HyperframesPlayer | null>(null);
  const callbacksRef = useRef({ onTimeUpdate, onEnded, onReady });
  callbacksRef.current = { onTimeUpdate, onEnded, onReady };

  const hasContent = playableFrameCount > 0 && src !== null;

  useEffect(() => {
    if (!hasContent) return;
    void ensureRegistered();
    const el = playerRef.current;
    if (!el) return;

    // The web component exposes currentTime/duration as properties; reading
    // them on the event target keeps us free of CustomEvent type assertions.
    const handleTimeUpdate = () => {
      callbacksRef.current.onTimeUpdate?.(el.currentTime);
    };
    const handleEnded = () => callbacksRef.current.onEnded?.();
    const handleReady = () => {
      callbacksRef.current.onReady?.(el.duration);
    };

    el.addEventListener('timeupdate', handleTimeUpdate);
    el.addEventListener('ended', handleEnded);
    el.addEventListener('ready', handleReady);
    return () => {
      el.removeEventListener('timeupdate', handleTimeUpdate);
      el.removeEventListener('ended', handleEnded);
      el.removeEventListener('ready', handleReady);
    };
  }, [hasContent]);

  if (!hasContent) {
    return null;
  }

  const { width, height } = aspectRatioToDimensions(aspectRatio);

  return (
    <hyperframes-player
      ref={playerRef}
      src={src}
      width={width}
      height={height}
      controls={true}
      poster={posterUrl ?? undefined}
      className={cn(
        'block w-full',
        getAspectRatioClassName(aspectRatio),
        className
      )}
    />
  );
};
