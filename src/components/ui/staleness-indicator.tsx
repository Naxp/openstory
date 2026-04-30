import { useState } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export type StalenessArtifact =
  | 'thumbnail'
  | 'video'
  | 'audio'
  | 'sheet'
  | 'visual-prompt'
  | 'motion-prompt'
  | 'music-prompt';

export type StalenessEntityType =
  | 'frame'
  | 'character'
  | 'location'
  | 'library-location'
  | 'talent'
  | 'sequence';

export type StalenessIndicatorDensity = 'inline' | 'corner-dot';

type StalenessIndicatorProps = {
  artifact: StalenessArtifact;
  entityType: StalenessEntityType;
  onRegenerate: () => void;
  onDismiss?: () => void;
  density?: StalenessIndicatorDensity;
  className?: string;
};

const ARTIFACT_LABEL: Record<StalenessArtifact, string> = {
  thumbnail: 'image',
  video: 'video',
  audio: 'audio',
  sheet: 'sheet',
  'visual-prompt': 'visual prompt',
  'motion-prompt': 'motion prompt',
  'music-prompt': 'music prompt',
};

export const StalenessIndicator: React.FC<StalenessIndicatorProps> = ({
  artifact,
  entityType,
  onRegenerate,
  onDismiss,
  density = 'inline',
  className,
}) => {
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) return null;

  const handleDismiss = () => {
    setDismissed(true);
    onDismiss?.();
  };

  const ariaLabel = `Stale ${ARTIFACT_LABEL[artifact]} on this ${entityType} — inputs changed since it was generated`;

  if (density === 'corner-dot') {
    return (
      <button
        type="button"
        onClick={onRegenerate}
        aria-label={ariaLabel}
        title="Inputs changed — click to regenerate"
        data-slot="staleness-indicator-dot"
        data-artifact={artifact}
        data-entity-type={entityType}
        className={cn(
          // 24px hit target; visually 8px amber dot centered inside.
          'group relative inline-flex h-6 w-6 items-center justify-center rounded-full',
          'outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
          className
        )}
      >
        <span
          aria-hidden="true"
          className={cn(
            'block h-2 w-2 rounded-full bg-amber-500 ring-2 ring-amber-500/30',
            'transition-transform group-hover:scale-110',
            'motion-reduce:transition-none motion-reduce:group-hover:scale-100'
          )}
        />
      </button>
    );
  }

  return (
    <Alert
      data-slot="staleness-indicator"
      data-density="inline"
      data-artifact={artifact}
      data-entity-type={entityType}
      className={cn(
        'flex flex-row items-center gap-3 border-amber-500/30',
        'bg-amber-50 text-amber-900',
        'dark:bg-amber-950/30 dark:text-amber-100',
        '[&>svg]:text-amber-600 dark:[&>svg]:text-amber-400',
        className
      )}
    >
      <AlertTriangle aria-hidden="true" />
      <AlertDescription
        className={cn(
          'col-start-2 flex-1 self-center text-amber-900 dark:text-amber-100'
        )}
      >
        Inputs changed since this {ARTIFACT_LABEL[artifact]} was generated.
      </AlertDescription>
      <div className="ml-auto flex shrink-0 items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={onRegenerate}
          className="border-amber-500/40 hover:bg-amber-500/10"
        >
          Regenerate
        </Button>
        {onDismiss && (
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            onClick={handleDismiss}
            aria-label="Dismiss staleness indicator"
            className="hover:bg-amber-500/10"
          >
            <X aria-hidden="true" />
          </Button>
        )}
      </div>
    </Alert>
  );
};
