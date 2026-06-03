/**
 * The shared "state document" for a sequence — the single representation the
 * status endpoint returns today, and the same shape the phase-2 SSE stream and
 * webhook payloads will carry. It is derived from the DB (authoritative), so it
 * is correct even when the realtime channel has expired or a client never
 * subscribed. Keyed-by-id frame entries make it trivially mergeable with the
 * out-of-order realtime deltas a stream would later apply.
 */

import type { ScopedDb } from '@/lib/db/scoped';
import type { Sequence } from '@/types/database';

type FrameGenStatus = 'pending' | 'generating' | 'completed' | 'failed';

type SequenceStateFrame = {
  id: string;
  orderIndex: number;
  title: string | null;
  image: { status: FrameGenStatus; url: string | null };
  video: { status: FrameGenStatus; url: string | null };
};

export type SequenceState = {
  id: string;
  title: string;
  /** draft | processing | completed | failed | archived */
  status: string;
  statusError: string | null;
  aspectRatio: string;
  createdAt: string;
  updatedAt: string;
  poster: { url: string } | null;
  music: { status: string; url: string | null };
  frames: SequenceStateFrame[];
  counts: { frames: number; imagesReady: number; videosReady: number };
};

export async function buildSequenceState(
  scopedDb: { frames: Pick<ScopedDb['frames'], 'listBySequence'> },
  sequence: Sequence
): Promise<SequenceState> {
  const frames = await scopedDb.frames.listBySequence(sequence.id);
  const ordered = [...frames].sort((a, b) => a.orderIndex - b.orderIndex);

  const stateFrames: SequenceStateFrame[] = ordered.map((frame) => {
    const imageUrl = frame.thumbnailUrl ?? frame.previewThumbnailUrl ?? null;
    return {
      id: frame.id,
      orderIndex: frame.orderIndex,
      title: frame.metadata?.metadata?.title ?? null,
      image: {
        // Frames track video status explicitly; image readiness is signalled by
        // the presence of a thumbnail URL.
        status: imageUrl ? 'completed' : 'pending',
        url: imageUrl,
      },
      video: {
        status: frame.videoStatus ?? 'pending',
        url: frame.videoUrl ?? null,
      },
    };
  });

  return {
    id: sequence.id,
    title: sequence.title,
    status: sequence.status,
    statusError: sequence.statusError ?? null,
    aspectRatio: sequence.aspectRatio,
    createdAt: sequence.createdAt.toISOString(),
    updatedAt: sequence.updatedAt.toISOString(),
    poster: sequence.posterUrl ? { url: sequence.posterUrl } : null,
    music: {
      status: sequence.musicStatus ?? 'pending',
      url: sequence.musicUrl ?? null,
    },
    frames: stateFrames,
    counts: {
      frames: stateFrames.length,
      imagesReady: stateFrames.filter((f) => f.image.status === 'completed')
        .length,
      videosReady: stateFrames.filter((f) => f.video.status === 'completed')
        .length,
    },
  };
}
