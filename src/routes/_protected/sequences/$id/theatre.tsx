import { TheatreView } from '@/components/theatre/theatre-view';
import { Skeleton } from '@/components/ui/skeleton';
import { mergeVideoAndMusicFn } from '@/functions/sequences';
import { useFramesBySequence } from '@/hooks/use-frames';
import { sequenceKeys, useSequence } from '@/hooks/use-sequences';
import type { AspectRatio } from '@/lib/constants/aspect-ratios';
import type { Sequence } from '@/types/database';
import { usePostHog } from '@posthog/react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { toast } from 'sonner';

export const Route = createFileRoute('/_protected/sequences/$id/theatre')({
  component: TheatrePage,
  staticData: { breadcrumb: 'Theatre' },
});

// Constrain player to fit viewport. Header+tabs ≈ 10rem, so available ≈ 100dvh - 11rem.
// Full class names required for Tailwind JIT to detect at build time.
const THEATRE_MAX_CLASS_BY_RATIO: Record<AspectRatio, string> = {
  '16:9': 'w-full max-h-[calc(100dvh-15rem)] max-w-4xl',
  '9:16':
    'w-full max-h-[calc(100dvh-15rem)] max-w-[calc((100dvh-15rem)*0.5625)]',
  '1:1': 'w-full max-h-[calc(100dvh-15rem)] max-w-[calc(100dvh-15rem)]',
};

function TheatrePage() {
  const { id: sequenceId } = Route.useParams();
  const queryClient = useQueryClient();
  const posthog = usePostHog();

  const { data: sequence, isLoading } = useSequence(sequenceId, {
    refetchInterval: (query) => {
      if (query.state.data?.mergedVideoStatus === 'merging') return 2000;
      return false;
    },
  });

  const { data: frames = [] } = useFramesBySequence(sequenceId);

  const mergeVideoAndMusic = useMutation({
    mutationFn: () => mergeVideoAndMusicFn({ data: { sequenceId } }),
    onMutate: () => {
      queryClient.setQueryData<Sequence>(
        sequenceKeys.detail(sequenceId),
        (old) => (old ? { ...old, mergedVideoStatus: 'merging' as const } : old)
      );
      posthog.capture('merged_video_generation_started', {
        sequence_id: sequenceId,
        source: 'theatre',
      });
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Failed to start merge');
    },
  });

  if (isLoading || !sequence) {
    return (
      <div className="flex-1 p-4">
        <Skeleton className="aspect-video w-full max-w-4xl mx-auto" />
      </div>
    );
  }

  return (
    <div className="flex h-full items-center justify-center p-4">
      <div className={THEATRE_MAX_CLASS_BY_RATIO[sequence.aspectRatio]}>
        <TheatreView
          sequence={sequence}
          frames={frames}
          onGenerateMergedVideo={() => mergeVideoAndMusic.mutate()}
          isGenerating={mergeVideoAndMusic.isPending}
        />
      </div>
    </div>
  );
}
