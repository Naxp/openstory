import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useStyles } from '@/hooks/use-styles';
import { getAspectRatioClassName } from '@/lib/constants/aspect-ratios';
import {
  optimizedVideoUrl,
  videoPosterUrl,
} from '@/lib/media/cloudflare-video';
import {
  buildSampleEntries,
  type SampleEntry,
} from '@/lib/style/sample-entries';
import { cn } from '@/lib/utils';
import { Route as GalleryRoute } from '@/routes/_app/gallery/index';
import { Route as NewSequenceRoute } from '@/routes/_app/sequences/new';
import { Link } from '@tanstack/react-router';
import { ArrowRight, Wand2 } from 'lucide-react';
import { useCallback, useRef } from 'react';

/** Max styles to feature in the curated showcase so it stays a teaser, not a dump. */
const MAX_STYLES = 9;

/**
 * Logged-out showcase for the new-sequence screen (#956): a curated grid of
 * canonical style sample videos so anonymous visitors can see the sort of thing
 * they can create, each labelled with the style that produced it. Each card's
 * "Try this style" button links to `/sequences/new?style=<id>`; the composer
 * seeds itself from that param (see new.tsx), so the transport is URL-driven
 * and shareable.
 */
export const SampleVideoShowcase: React.FC = () => {
  const { data: styles, isPending } = useStyles();

  if (isPending) {
    return (
      <section className="flex flex-col gap-4">
        <ShowcaseHeading />
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="aspect-video w-full rounded-lg" />
          ))}
        </div>
      </section>
    );
  }

  const entries = buildSampleEntries(styles ?? []).slice(0, MAX_STYLES);
  if (entries.length === 0) return null;

  return (
    <section className="flex flex-col gap-4">
      <ShowcaseHeading />
      <Link
        to={GalleryRoute.to}
        className="inline-flex items-center justify-center gap-1 self-center text-sm font-medium text-muted-foreground hover:text-foreground"
      >
        Browse the full gallery
        <ArrowRight className="size-4" />
      </Link>
      <div className="grid grid-cols-2 items-start gap-4 md:grid-cols-3">
        {entries.map((entry) => (
          <SampleVideoCard key={entry.key} entry={entry} />
        ))}
      </div>
    </section>
  );
};

const ShowcaseHeading: React.FC = () => (
  <div className="flex flex-col gap-1 text-center">
    <h2 className="text-lg font-semibold tracking-tight">
      See what you can create
    </h2>
    <p className="text-sm text-muted-foreground">
      Every clip below was generated from a one-line idea, in a different style.
    </p>
  </div>
);

export const SampleVideoCard: React.FC<{ entry: SampleEntry }> = ({
  entry,
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);

  // Resting state is a cheap Cloudflare-extracted poster frame (~36KB jpg) and
  // `preload="none"`, so the page paints without fetching a single video byte.
  // The downscaled clip (Cloudflare `mode=video`, ~6× smaller than the master)
  // is only fetched + played on hover. Touch devices that fire no hover keep
  // showing the poster — a tap on the card plays it.
  const poster = videoPosterUrl(entry.video.url);
  const src = optimizedVideoUrl(entry.video.url);

  const play = useCallback(() => {
    const el = videoRef.current;
    if (!el) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    void el.play().catch(() => {});
  }, []);

  const stop = useCallback(() => {
    const el = videoRef.current;
    if (!el) return;
    el.pause();
    el.currentTime = 0;
  }, []);

  return (
    <div
      className={cn(
        'group relative w-full overflow-hidden rounded-lg border bg-muted',
        getAspectRatioClassName(entry.aspectRatio)
      )}
      onMouseEnter={play}
      onMouseLeave={stop}
    >
      <video
        ref={videoRef}
        src={src}
        poster={poster}
        className="absolute inset-0 h-full w-full object-cover"
        muted
        loop
        playsInline
        preload="none"
        aria-label={`${entry.styleName} sample video`}
        onClick={play}
      />
      <span className="pointer-events-none absolute bottom-2 left-2 rounded-md bg-background/70 px-2 py-0.5 text-xs font-medium backdrop-blur-sm">
        {entry.styleName}
      </span>
      {entry.hasBrief && (
        <Button
          asChild
          size="sm"
          variant="secondary"
          className="absolute bottom-2 right-2 gap-1.5 opacity-90 backdrop-blur-sm transition-opacity group-hover:opacity-100"
        >
          <Link
            to={NewSequenceRoute.to}
            search={{ style: entry.slug }}
            hash="compose"
            aria-label={`Try the ${entry.styleName} style`}
          >
            <Wand2 className="size-3.5" />
            Try
          </Link>
        </Button>
      )}
    </div>
  );
};
