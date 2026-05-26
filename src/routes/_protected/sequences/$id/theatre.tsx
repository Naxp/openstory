import { TheatreView } from '@/components/theatre/theatre-view';
import { SequenceVariantHistorySheet } from '@/components/sequence/sequence-variant-history-sheet';
import { DivergentAlternateBanner } from '@/components/staleness/divergent-alternate-banner';
import { Skeleton } from '@/components/ui/skeleton';
import {
  useDiscardSequenceVideoVariant,
  usePromoteSequenceVideoVariant,
  useSequenceDivergentVideoVariants,
  useSequenceVideoVariantHistory,
  useUndiscardSequenceVideoVariant,
} from '@/hooks/use-sequence-variants';
import { useSequence } from '@/hooks/use-sequences';
import type { AspectRatio } from '@/lib/constants/aspect-ratios';
import { useSequenceStaleDetected } from '@/lib/realtime/use-sequence-stale-detected';
import type { SequenceVideoVariant } from '@/lib/db/schema';
import { createFileRoute } from '@tanstack/react-router';
import { useCallback, useState } from 'react';
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

  const { data: sequence, isLoading } = useSequence(sequenceId, {
    refetchInterval: (query) => {
      if (query.state.data?.mergedVideoStatus === 'merging') return 2000;
      return false;
    },
  });

  // Only poll while merging in case realtime is down. Otherwise rely on
  // `useSequenceStaleDetected` + realtime invalidation.
  const merging = sequence?.mergedVideoStatus === 'merging';
  const { data: divergentVideoVariants } = useSequenceDivergentVideoVariants(
    sequenceId,
    merging ? { refetchInterval: 2000 } : undefined
  );
  useSequenceStaleDetected(sequenceId);

  const promoteVariant = usePromoteSequenceVideoVariant();
  const discardVariant = useDiscardSequenceVideoVariant();
  const undiscardVariant = useUndiscardSequenceVideoVariant();

  const [historyOpen, setHistoryOpen] = useState(false);
  const { data: historyVariants } = useSequenceVideoVariantHistory(
    sequenceId,
    historyOpen
  );

  const discardWithUndo = useCallback(
    (variantId: string) => {
      const restore = () => {
        undiscardVariant.mutate(
          { sequenceId, variantId },
          {
            onError: (error) => {
              toast.error('Failed to restore alternate', {
                description:
                  error instanceof Error ? error.message : 'Unknown error',
              });
            },
          }
        );
      };
      discardVariant.mutate(
        { sequenceId, variantId },
        {
          onSuccess: () => {
            toast('Alternate discarded', {
              action: { label: 'Undo', onClick: restore },
            });
          },
          onError: (error) => {
            toast.error('Failed to discard alternate', {
              description:
                error instanceof Error ? error.message : 'Unknown error',
            });
          },
        }
      );
    },
    [sequenceId, discardVariant, undiscardVariant]
  );

  const handlePromote = useCallback(
    (variantId: string) => {
      promoteVariant.mutate(
        { sequenceId, variantId },
        {
          onSuccess: () => {
            toast.success('Alternate promoted');
          },
          onError: (error) => {
            toast.error('Failed to promote alternate', {
              description:
                error instanceof Error ? error.message : 'Unknown error',
            });
          },
        }
      );
    },
    [sequenceId, promoteVariant]
  );

  const handleUndiscard = useCallback(
    (variantId: string) => {
      undiscardVariant.mutate(
        { sequenceId, variantId },
        {
          onError: (error) => {
            toast.error('Failed to restore alternate', {
              description:
                error instanceof Error ? error.message : 'Unknown error',
            });
          },
        }
      );
    },
    [sequenceId, undiscardVariant]
  );

  // Reader orders by divergedAt asc — first row is the oldest pending.
  const latestDivergent: SequenceVideoVariant | undefined =
    divergentVideoVariants?.[0];

  const divergentBanner = latestDivergent ? (
    <DivergentAlternateBanner
      variantId={latestDivergent.id}
      artifact="merged-video"
      entityType="sequence"
      compareLabel="View history"
      onCompare={() => setHistoryOpen(true)}
      onPromote={() => handlePromote(latestDivergent.id)}
      onDiscard={() => discardWithUndo(latestDivergent.id)}
    />
  ) : null;

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
        <TheatreView sequence={sequence} divergentBanner={divergentBanner} />
      </div>
      <SequenceVariantHistorySheet
        kind="video"
        open={historyOpen}
        onOpenChange={setHistoryOpen}
        sequence={sequence}
        variants={historyVariants}
        onPromote={handlePromote}
        onDiscard={discardWithUndo}
        onUndiscard={handleUndiscard}
        isPromoting={promoteVariant.isPending}
        isDiscarding={discardVariant.isPending}
        promotingVariantId={promoteVariant.variables?.variantId ?? null}
      />
    </div>
  );
}
