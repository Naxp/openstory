/**
 * Theatre View
 * Live preview of a sequence using @hyperframes/player. Plays motion clips
 * + music without waiting for a server-side merge. The merge workflow is
 * still available (and required) for downloading a single shareable MP4.
 */

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Skeleton } from '@/components/ui/skeleton';
import type { Frame, Sequence } from '@/types/database';
import {
  AlertCircle,
  Download,
  Film,
  Link,
  Loader2,
  Share2,
  Sparkles,
} from 'lucide-react';
import { usePostHog } from '@posthog/react';
import { useCallback } from 'react';
import { toast } from 'sonner';
import { SequencePlayer } from './sequence-player';

type TheatreViewProps = {
  sequence: Sequence;
  frames: Frame[];
  onGenerateMergedVideo?: () => void;
  isGenerating?: boolean;
};

const countByStatus = (frames: Frame[]) => {
  let completed = 0;
  let pending = 0;
  let failed = 0;
  for (const f of frames) {
    if (f.videoStatus === 'completed' && f.videoUrl) completed += 1;
    else if (f.videoStatus === 'failed') failed += 1;
    else pending += 1;
  }
  return { completed, pending, failed };
};

export const TheatreView: React.FC<TheatreViewProps> = ({
  sequence,
  frames,
  onGenerateMergedVideo,
  isGenerating = false,
}) => {
  const { mergedVideoStatus, mergedVideoUrl, aspectRatio } = sequence;
  const posthog = usePostHog();

  const { completed, pending, failed } = countByStatus(frames);

  const handleCopyVideoUrl = useCallback(async () => {
    if (!mergedVideoUrl) return;
    try {
      await navigator.clipboard.writeText(mergedVideoUrl);
      toast.success('Video URL copied');
      posthog.capture('video_url_copied', { sequence_id: sequence.id });
    } catch (err) {
      toast.error('Failed to copy URL');
      posthog.captureException(err);
    }
  }, [mergedVideoUrl, sequence.id, posthog]);

  const handleDownloadVideo = useCallback(() => {
    if (!mergedVideoUrl) return;
    const a = document.createElement('a');
    a.href = mergedVideoUrl;
    a.download = `${sequence.title || 'sequence'}_openstory.mp4`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    posthog.capture('video_downloaded', { sequence_id: sequence.id });
  }, [mergedVideoUrl, sequence.id, sequence.title, posthog]);

  if (completed === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-16">
        <Film className="h-8 w-8 text-muted-foreground" />
        <p className="text-muted-foreground">No motion clips yet</p>
        <p className="text-sm text-muted-foreground max-w-md text-center">
          {pending > 0
            ? `Waiting for ${pending} motion ${pending === 1 ? 'clip' : 'clips'} to render…`
            : 'Generate motion for at least one scene to start previewing.'}
        </p>
      </div>
    );
  }

  const isMerging = mergedVideoStatus === 'merging';
  const hasMergedVideo = mergedVideoStatus === 'completed' && !!mergedVideoUrl;
  const mergeFailed = mergedVideoStatus === 'failed';

  return (
    <div className="relative">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="absolute top-2 right-2 z-10 h-8 w-8 bg-black/50 text-white hover:bg-black/70"
            aria-label="Share"
          >
            <Share2 className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {hasMergedVideo && (
            <>
              <DropdownMenuItem onClick={() => void handleCopyVideoUrl()}>
                <Link className="h-4 w-4" />
                Copy video URL
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleDownloadVideo}>
                <Download className="h-4 w-4" />
                Download video
              </DropdownMenuItem>
              <DropdownMenuSeparator />
            </>
          )}
          {onGenerateMergedVideo && (
            <DropdownMenuItem
              onClick={onGenerateMergedVideo}
              disabled={isGenerating || isMerging}
            >
              {isGenerating || isMerging ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="h-4 w-4" />
              )}
              {hasMergedVideo
                ? 'Re-render shareable MP4'
                : mergeFailed
                  ? 'Retry shareable MP4'
                  : 'Render shareable MP4'}
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <SequencePlayer
        sequenceId={sequence.id}
        frames={frames}
        musicUrl={sequence.musicUrl}
        aspectRatio={aspectRatio}
        posterUrl={sequence.posterUrl}
      />

      {(pending > 0 || failed > 0) && (
        <div className="mt-2 flex items-center gap-3 text-xs text-muted-foreground">
          {pending > 0 && (
            <span className="inline-flex items-center gap-1">
              <Loader2 className="h-3 w-3 animate-spin" />
              {pending} clip{pending === 1 ? '' : 's'} still rendering
            </span>
          )}
          {failed > 0 && (
            <span className="inline-flex items-center gap-1 text-destructive">
              <AlertCircle className="h-3 w-3" />
              {failed} clip{failed === 1 ? '' : 's'} failed
            </span>
          )}
        </div>
      )}
    </div>
  );
};

export const TheatreViewSkeleton: React.FC = () => (
  <Skeleton className="aspect-video w-full" />
);
