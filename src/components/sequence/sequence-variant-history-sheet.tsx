/**
 * Replaces the old `SequenceVariantCompareDialog`. The compare dialog only
 * surfaced the *oldest pending* divergent alternate; this sheet shows the
 * full variant history for a sequence (primary + every divergent + every
 * discarded) so the user can preview, promote, or restore any of them.
 *
 * Same shell for video and music — the row body switches on `kind`. Issue #741.
 */

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { VideoPlayer } from '@/components/motion/video-player';
import type {
  SequenceMusicVariant,
  SequenceVideoVariant,
} from '@/lib/db/schema';
import { cn } from '@/lib/utils';
import type { Sequence } from '@/types/database';
import { MoreVertical, Loader2 } from 'lucide-react';
import { useState } from 'react';

type CommonProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sequence: Sequence;
  onPromote: (variantId: string) => void;
  onDiscard: (variantId: string) => void;
  onUndiscard: (variantId: string) => void;
  isPromoting?: boolean;
  isDiscarding?: boolean;
  promotingVariantId?: string | null;
};

type VideoProps = CommonProps & {
  kind: 'video';
  variants: SequenceVideoVariant[] | undefined;
};

type MusicProps = CommonProps & {
  kind: 'music';
  variants: SequenceMusicVariant[] | undefined;
};

export type SequenceVariantHistorySheetProps = VideoProps | MusicProps;

function formatShortHash(hash: string | null): string {
  if (!hash) return '—';
  return hash.slice(0, 7);
}

function formatTimestamp(date: Date | null): string {
  if (!date) return '—';
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(date);
}

const VariantRowChrome: React.FC<{
  isCurrent: boolean;
  isDiscarded: boolean;
  isDivergent: boolean;
  generatedAt: Date | null;
  inputHash: string | null;
  onPromote: () => void;
  onDiscard: () => void;
  onUndiscard: () => void;
  busy?: boolean;
  children: React.ReactNode;
  extraChips?: React.ReactNode;
}> = ({
  isCurrent,
  isDiscarded,
  isDivergent,
  generatedAt,
  inputHash,
  onPromote,
  onDiscard,
  onUndiscard,
  busy,
  children,
  extraChips,
}) => {
  return (
    <li
      data-slot="variant-history-row"
      data-current={isCurrent || undefined}
      data-discarded={isDiscarded || undefined}
      className={cn(
        'flex flex-col gap-3 rounded-md border bg-card p-3',
        isDiscarded && 'opacity-60'
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          {isCurrent && <Badge variant="default">Current</Badge>}
          {isDivergent && !isCurrent && (
            <Badge variant="outline">Inputs changed</Badge>
          )}
          {isDiscarded && <Badge variant="secondary">Discarded</Badge>}
          <span className="text-xs text-muted-foreground">
            {formatTimestamp(generatedAt)}
          </span>
          <span
            className="font-mono text-xs text-muted-foreground"
            title={inputHash ?? undefined}
          >
            {formatShortHash(inputHash)}
          </span>
          {extraChips}
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="Variant actions"
              disabled={busy}
            >
              {busy ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <MoreVertical className="h-4 w-4" />
              )}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {!isCurrent && !isDiscarded && (
              <DropdownMenuItem onClick={onPromote}>
                Promote to current
              </DropdownMenuItem>
            )}
            {!isDiscarded && !isCurrent && (
              <DropdownMenuItem onClick={onDiscard}>Discard</DropdownMenuItem>
            )}
            {isDiscarded && (
              <DropdownMenuItem onClick={onUndiscard}>Restore</DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {children}
    </li>
  );
};

const VideoVariantRow: React.FC<{
  variant: SequenceVideoVariant;
  isCurrent: boolean;
  aspectRatio: Sequence['aspectRatio'];
  onPromote: () => void;
  onDiscard: () => void;
  onUndiscard: () => void;
  busy: boolean;
}> = ({
  variant,
  isCurrent,
  aspectRatio,
  onPromote,
  onDiscard,
  onUndiscard,
  busy,
}) => {
  const [expanded, setExpanded] = useState(isCurrent);
  return (
    <VariantRowChrome
      isCurrent={isCurrent}
      isDiscarded={variant.discardedAt !== null}
      isDivergent={variant.divergedAt !== null}
      generatedAt={variant.generatedAt}
      inputHash={variant.inputHash}
      onPromote={onPromote}
      onDiscard={onDiscard}
      onUndiscard={onUndiscard}
      busy={busy}
    >
      {variant.url ? (
        <>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
          >
            {expanded ? 'Hide preview' : 'Preview'}
          </Button>
          {expanded && (
            <VideoPlayer src={variant.url} aspectRatio={aspectRatio} />
          )}
        </>
      ) : (
        <span className="text-xs text-muted-foreground">No asset</span>
      )}
    </VariantRowChrome>
  );
};

const MusicVariantRow: React.FC<{
  variant: SequenceMusicVariant;
  isCurrent: boolean;
  onPromote: () => void;
  onDiscard: () => void;
  onUndiscard: () => void;
  busy: boolean;
}> = ({ variant, isCurrent, onPromote, onDiscard, onUndiscard, busy }) => {
  const chips: React.ReactNode[] = [];
  if (variant.model) {
    chips.push(
      <Badge key="model" variant="outline" className="font-normal">
        {variant.model}
      </Badge>
    );
  }
  if (variant.durationSeconds !== null) {
    chips.push(
      <Badge key="duration" variant="outline" className="font-normal">
        {variant.durationSeconds}s
      </Badge>
    );
  }
  return (
    <VariantRowChrome
      isCurrent={isCurrent}
      isDiscarded={variant.discardedAt !== null}
      isDivergent={variant.divergedAt !== null}
      generatedAt={variant.generatedAt}
      inputHash={variant.inputHash}
      onPromote={onPromote}
      onDiscard={onDiscard}
      onUndiscard={onUndiscard}
      busy={busy}
      extraChips={chips}
    >
      {variant.url ? (
        // eslint-disable-next-line jsx-a11y/media-has-caption -- generated music without captions
        <audio
          src={variant.url}
          controls
          preload="metadata"
          className="h-10 w-full"
        />
      ) : (
        <span className="text-xs text-muted-foreground">No asset</span>
      )}
      {(variant.prompt || variant.tags) && (
        <div className="flex flex-col gap-1 text-xs text-muted-foreground">
          {variant.prompt && (
            <span className="line-clamp-3">
              <span className="font-medium">Prompt:</span> {variant.prompt}
            </span>
          )}
          {variant.tags && (
            <span className="line-clamp-2">
              <span className="font-medium">Tags:</span> {variant.tags}
            </span>
          )}
        </div>
      )}
    </VariantRowChrome>
  );
};

export const SequenceVariantHistorySheet: React.FC<
  SequenceVariantHistorySheetProps
> = (props) => {
  const {
    open,
    onOpenChange,
    sequence,
    onPromote,
    onDiscard,
    onUndiscard,
    isPromoting = false,
    isDiscarding = false,
    promotingVariantId,
    kind,
    variants,
  } = props;
  const busy = isPromoting || isDiscarding;

  const label = kind === 'video' ? 'merged video' : 'music';
  const liveUrl =
    kind === 'video' ? sequence.mergedVideoUrl : sequence.musicUrl;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex flex-col gap-0 sm:max-w-md">
        <SheetHeader>
          <SheetTitle>
            {kind === 'video' ? 'Merged video' : 'Music'} history
          </SheetTitle>
          <SheetDescription>
            Every {label} rendered for this sequence. Promote any version to
            make it current; discard the ones you don&apos;t want.
          </SheetDescription>
        </SheetHeader>
        <div className="flex-1 overflow-y-auto px-4 pb-4">
          {!variants && (
            <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
            </div>
          )}
          {variants && variants.length === 0 && (
            <p className="py-12 text-center text-sm text-muted-foreground">
              No {label} versions yet.
            </p>
          )}
          {variants && variants.length > 0 && (
            <ul className="flex flex-col gap-2">
              {props.kind === 'video'
                ? props.variants?.map((variant) => (
                    <VideoVariantRow
                      key={variant.id}
                      variant={variant}
                      isCurrent={
                        variant.url !== null && variant.url === liveUrl
                      }
                      aspectRatio={sequence.aspectRatio}
                      onPromote={() => onPromote(variant.id)}
                      onDiscard={() => onDiscard(variant.id)}
                      onUndiscard={() => onUndiscard(variant.id)}
                      busy={busy && promotingVariantId === variant.id}
                    />
                  ))
                : props.variants?.map((variant) => (
                    <MusicVariantRow
                      key={variant.id}
                      variant={variant}
                      isCurrent={
                        variant.url !== null && variant.url === liveUrl
                      }
                      onPromote={() => onPromote(variant.id)}
                      onDiscard={() => onDiscard(variant.id)}
                      onUndiscard={() => onUndiscard(variant.id)}
                      busy={busy && promotingVariantId === variant.id}
                    />
                  ))}
            </ul>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
};
