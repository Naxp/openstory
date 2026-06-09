import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';
import { Brain, ChevronDown } from 'lucide-react';
import { useEffect, useRef, useState, type FC } from 'react';

/**
 * Collapsible "Thinking…" panel that renders the model's streaming
 * reasoning/thinking tokens (OpenRouter unified reasoning). Reasoning arrives
 * as a separate stream from the answer, so this sits *above* whatever the
 * answer feeds (the enhanced script, a regenerated prompt) and never mixes into
 * it.
 *
 * While `isStreaming`, the panel is expanded and auto-scrolls to follow the
 * latest tokens. Once streaming ends it auto-collapses (the reasoning is scratch
 * work, not the deliverable) but stays available behind the toggle. Renders
 * nothing until the first reasoning token arrives.
 */
export const ReasoningPanel: FC<{
  text: string;
  isStreaming: boolean;
  className?: string;
}> = ({ text, isStreaming, className }) => {
  const [open, setOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Follow the stream: expand while reasoning is arriving, collapse once it
  // finishes. The user can still toggle manually at any point — this only
  // drives the transitions, not every render.
  const prevStreamingRef = useRef(isStreaming);
  useEffect(() => {
    if (isStreaming && !prevStreamingRef.current) setOpen(true);
    if (!isStreaming && prevStreamingRef.current) setOpen(false);
    prevStreamingRef.current = isStreaming;
  }, [isStreaming]);

  useEffect(() => {
    if (!open || !isStreaming) return;
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [text, open, isStreaming]);

  if (!text) return null;

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className={cn(
        'rounded-md border border-border/60 bg-muted/30 text-muted-foreground',
        className
      )}
    >
      <CollapsibleTrigger className="flex w-full items-center gap-2 px-3 py-2 text-xs font-medium">
        <Brain
          className={cn('size-3.5 shrink-0', isStreaming && 'animate-pulse')}
          aria-hidden
        />
        <span>{isStreaming ? 'Thinking…' : 'Reasoning'}</span>
        <ChevronDown
          className={cn(
            'ml-auto size-3.5 shrink-0 transition-transform',
            open && 'rotate-180'
          )}
          aria-hidden
        />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div
          ref={scrollRef}
          aria-live="polite"
          className="max-h-40 overflow-y-auto whitespace-pre-wrap px-3 pb-3 text-xs leading-relaxed"
        >
          {text}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
};
