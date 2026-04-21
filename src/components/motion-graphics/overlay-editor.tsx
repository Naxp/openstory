/**
 * OverlayEditor — minimal text-overlay authoring UI for a frame.
 *
 * MVP scope: text overlays with a position + timing. Lower thirds / images
 * can be added later; the schema and renderer already support them.
 */

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { setFrameOverlaysFn } from '@/functions/frames';
import type { Frame } from '@/lib/db/schema';
import type {
  FrameOverlay,
  TextOverlay,
} from '@/lib/hyperframes/overlay.types';
import { OVERLAY_POSITIONS } from '@/lib/hyperframes/overlay.types';
import { useMutation } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

type OverlayEditorProps = {
  frame: Frame;
  sequenceId: string;
  /** Max clip duration; used as the default overlay duration */
  durationMs: number;
  onSaved?: (overlays: FrameOverlay[]) => void;
};

function nextId(): string {
  return `ov_${Math.random().toString(36).slice(2, 10)}`;
}

function createTextOverlay(durationMs: number): TextOverlay {
  return {
    kind: 'text',
    id: nextId(),
    text: 'Title',
    position: 'bottom',
    startMs: 0,
    durationMs: Math.min(durationMs, 3000),
  };
}

export const OverlayEditor: React.FC<OverlayEditorProps> = ({
  frame,
  sequenceId,
  durationMs,
  onSaved,
}) => {
  const [overlays, setOverlays] = useState<FrameOverlay[]>(
    frame.graphicsOverlays ?? []
  );

  const mutation = useMutation({
    mutationFn: async (next: FrameOverlay[]) => {
      return setFrameOverlaysFn({
        data: {
          sequenceId,
          frameId: frame.id,
          overlays: next.length > 0 ? next : null,
        },
      });
    },
    onSuccess: () => {
      toast.success('Motion graphics saved');
      onSaved?.(overlays);
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Save failed');
    },
  });

  const addText = () =>
    setOverlays((curr) => [...curr, createTextOverlay(durationMs)]);

  const remove = (id: string) =>
    setOverlays((curr) => curr.filter((o) => o.id !== id));

  const updateTextOverlay = (id: string, patch: Partial<TextOverlay>) => {
    setOverlays((curr) =>
      curr.map((o) =>
        o.kind === 'text' && o.id === id ? { ...o, ...patch } : o
      )
    );
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Motion graphics</CardTitle>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={addText}>
            <Plus className="mr-1 h-4 w-4" />
            Add text
          </Button>
          <Button
            size="sm"
            onClick={() => mutation.mutate(overlays)}
            disabled={mutation.isPending}
          >
            {mutation.isPending ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {overlays.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No overlays yet. Add one to composite text on top of this clip.
          </p>
        )}
        {overlays.map((overlay) =>
          overlay.kind === 'text' ? (
            <TextOverlayRow
              key={overlay.id}
              overlay={overlay}
              durationMs={durationMs}
              onChange={(patch) => updateTextOverlay(overlay.id, patch)}
              onRemove={() => remove(overlay.id)}
            />
          ) : null
        )}
      </CardContent>
    </Card>
  );
};

type TextOverlayRowProps = {
  overlay: TextOverlay;
  durationMs: number;
  onChange: (patch: Partial<TextOverlay>) => void;
  onRemove: () => void;
};

const TextOverlayRow: React.FC<TextOverlayRowProps> = ({
  overlay,
  durationMs,
  onChange,
  onRemove,
}) => {
  return (
    <div className="flex flex-col gap-3 rounded-md border p-3">
      <div className="flex items-start gap-3">
        <div className="flex flex-1 flex-col gap-1">
          <Label htmlFor={`text-${overlay.id}`}>Text</Label>
          <Input
            id={`text-${overlay.id}`}
            value={overlay.text}
            onChange={(e) => onChange({ text: e.target.value })}
            maxLength={512}
          />
        </div>
        <Button
          size="icon"
          variant="ghost"
          onClick={onRemove}
          aria-label="Remove overlay"
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="flex flex-col gap-1">
          <Label htmlFor={`pos-${overlay.id}`}>Position</Label>
          <Select
            id={`pos-${overlay.id}`}
            value={overlay.position}
            options={OVERLAY_POSITIONS.map((p) => ({ value: p, label: p }))}
            onChange={(value) => {
              const position = OVERLAY_POSITIONS.find((p) => p === value);
              if (position) onChange({ position });
            }}
          />
        </div>

        <div className="flex flex-col gap-1">
          <Label htmlFor={`start-${overlay.id}`}>Start (s)</Label>
          <Input
            id={`start-${overlay.id}`}
            type="number"
            min={0}
            step="0.1"
            value={(overlay.startMs / 1000).toFixed(1)}
            onChange={(e) =>
              onChange({
                startMs: Math.max(0, Math.round(Number(e.target.value) * 1000)),
              })
            }
          />
        </div>

        <div className="flex flex-col gap-1">
          <Label htmlFor={`dur-${overlay.id}`}>Duration (s)</Label>
          <Input
            id={`dur-${overlay.id}`}
            type="number"
            min="0.1"
            step="0.1"
            value={(overlay.durationMs / 1000).toFixed(1)}
            onChange={(e) =>
              onChange({
                durationMs: Math.max(
                  100,
                  Math.min(
                    durationMs,
                    Math.round(Number(e.target.value) * 1000)
                  )
                ),
              })
            }
          />
        </div>
      </div>
    </div>
  );
};
