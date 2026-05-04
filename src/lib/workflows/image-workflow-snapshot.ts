/**
 * Snapshot DTO hashers for `generateImageWorkflow`.
 *
 * `computeFromDto` hashes the inlined per-scene snapshot for the start-time
 * tamper check. `computeCurrent` re-resolves the live character / location /
 * element sheet hashes from the scoped DB so the workflow can detect upstream
 * drift between trigger and write time and route divergent results into
 * `frame_variants` instead of overwriting the primary thumbnail.
 *
 * See docs/architecture/workflow-snapshots-and-content-hash-staleness.md
 * § "Pillar 3: Divergence-on-completion".
 */

import { DEFAULT_IMAGE_MODEL } from '@/lib/ai/models';
import type { NewFrame, NewFrameVariant } from '@/lib/db/schema';
import type { ScopedDb } from '@/lib/db/scoped';
import { WorkflowValidationError } from '@/lib/workflow/errors';
import type {
  FrameImageSceneSnapshot,
  ImageWorkflowInput,
} from '@/lib/workflow/types';
import { computeFrameImageSceneHash } from './sheet-snapshots';
import {
  matchCharactersToScene,
  matchElementsToScene,
  matchLocationsToScene,
} from './scene-matching';

export type ImageStorageResult = { url: string; path: string };

const NO_SNAPSHOT_SENTINEL = '';

function sortedHashes(values: Array<string | null | undefined>): string[] {
  return values
    .filter((v): v is string => typeof v === 'string' && v.length > 0)
    .sort();
}

function requireAspectRatio(
  input: ImageWorkflowInput
): NonNullable<ImageWorkflowInput['aspectRatio']> {
  if (!input.aspectRatio) {
    throw new WorkflowValidationError(
      'aspectRatio is required when sceneSnapshot is present; trigger-time and write-time hashes would otherwise diverge'
    );
  }
  return input.aspectRatio;
}

export function computeImageWorkflowHashFromDto(
  input: ImageWorkflowInput
): Promise<string> | string {
  if (!input.sceneSnapshot) {
    // No snapshot opted in. The body must not call `validate()` in this path;
    // returning the inlined hash (or empty sentinel) keeps validate() honest
    // for callers that *do* opt in via a missing snapshotInputHash (which
    // would mismatch and throw).
    return input.snapshotInputHash ?? NO_SNAPSHOT_SENTINEL;
  }
  return computeFrameImageSceneHash(
    input.sceneSnapshot,
    input.model ?? DEFAULT_IMAGE_MODEL,
    requireAspectRatio(input)
  );
}

/**
 * Re-resolve the live sheet hashes for the frame's scene and recompute the
 * snapshot hash. Falls back to the DTO hash when the workflow has no scene
 * snapshot or the frame has been deleted — the caller treats matching hashes
 * as "convergent" so a missing frame collapses to the convergent path
 * (image-workflow already short-circuits on deleted frames upstream).
 */
export async function computeImageWorkflowHashCurrent(
  input: ImageWorkflowInput,
  scopedDb: ScopedDb
): Promise<string> {
  if (!input.sceneSnapshot)
    return input.snapshotInputHash ?? NO_SNAPSHOT_SENTINEL;

  const model = input.model ?? DEFAULT_IMAGE_MODEL;
  const aspectRatio = requireAspectRatio(input);

  if (!input.sequenceId || !input.frameId) {
    return computeFrameImageSceneHash(input.sceneSnapshot, model, aspectRatio);
  }

  const frame = await scopedDb.frames.getById(input.frameId);
  // Deleted mid-flight: fall back to DTO hash so the divergence check returns
  // "convergent". image-workflow's storage step already returns early on
  // deleted frames, so this branch is just belt-and-braces.
  if (!frame) {
    return computeFrameImageSceneHash(input.sceneSnapshot, model, aspectRatio);
  }
  // Frame exists but its scene metadata is gone — that's data corruption,
  // not a deletion race. Refuse to write a thumbnail to a row whose scene we
  // can't re-hash.
  if (!frame.metadata) {
    throw new WorkflowValidationError(
      `Frame ${input.frameId} exists but has null metadata; snapshot recompute requires scene metadata`
    );
  }

  const [characters, locations, elements] = await Promise.all([
    scopedDb.characters.listWithSheets(input.sequenceId),
    scopedDb.sequenceLocations.listWithReferences(input.sequenceId),
    scopedDb.sequenceElements.list(input.sequenceId),
  ]);

  const scene = frame.metadata;
  const matchedCharacters = matchCharactersToScene(
    characters,
    scene.continuity?.characterTags ?? []
  );
  const matchedLocations = matchLocationsToScene(
    locations,
    scene.continuity?.environmentTag ?? '',
    scene.metadata?.location ?? ''
  );
  const matchedElements = matchElementsToScene(
    elements,
    scene.continuity?.elementTags ?? [],
    scene.originalScript?.extract ?? ''
  );

  const currentSnapshot: FrameImageSceneSnapshot = {
    sceneId: input.sceneSnapshot.sceneId,
    visualPrompt: input.sceneSnapshot.visualPrompt,
    characterSheetHashes: sortedHashes(
      matchedCharacters.map((c) => c.sheetInputHash)
    ),
    locationSheetHashes: sortedHashes(
      matchedLocations.map((l) => l.referenceInputHash)
    ),
    elementReferenceHashes: sortedHashes(
      matchedElements.map((e) => e.imageUrl)
    ),
  };

  return computeFrameImageSceneHash(currentSnapshot, model, aspectRatio);
}

/**
 * Writes to apply when the per-frame snapshot hash matches between trigger
 * and write time: stamp the new thumbnail onto the primary frame row + primary
 * frame_variants row and record the snapshot hash so downstream staleness
 * reads compare against it.
 *
 * Clears `previewUrl` on the variant row so a prior preview-mode run can't
 * leave a stale preview pointer attached to the converged primary.
 */
export function buildImageConvergentWrites(opts: {
  upload: ImageStorageResult;
  snapshotHash: string | null;
  promptHash: string | null;
  generatedAt: Date;
}): {
  frame: Partial<NewFrame>;
  variant: Partial<NewFrameVariant>;
} {
  const { upload, snapshotHash, promptHash, generatedAt } = opts;
  return {
    frame: {
      thumbnailPath: upload.path,
      thumbnailUrl: upload.url,
      thumbnailStatus: 'completed',
      thumbnailGeneratedAt: generatedAt,
      thumbnailError: null,
      thumbnailInputHash: snapshotHash,
      videoUrl: null,
      videoPath: null,
      videoStatus: 'pending',
      videoWorkflowRunId: null,
      videoGeneratedAt: null,
      videoError: null,
    },
    variant: {
      url: upload.url,
      storagePath: upload.path,
      previewUrl: null,
      status: 'completed',
      generatedAt,
      error: null,
      promptHash,
      inputHash: snapshotHash,
    },
  };
}

/**
 * Writes to apply when current inputs no longer match the snapshot.
 *
 *   - `frame`: revert the speculative primary thumbnail back to `pending` and
 *     fully clear url/path so an already-completed frame doesn't end up with
 *     `status=pending` while a stale URL persists.
 *   - `primaryRevert`: clear the speculative URL/status that the start-step
 *     pre-wrote to the primary variant row, so the primary slot stops pointing
 *     at the diverged work.
 *   - `divergentRow`: full payload for an INSERT that preserves the diverged
 *     result as an alternate. The caller supplies the workflow context fields
 *     (frameId/sequenceId/variantType/model); this helper supplies the
 *     content fields including the divergence-specific `inputHash` +
 *     `divergedAt` that key the divergent partial unique index.
 */
export function buildImageDivergentWrites(opts: {
  upload: ImageStorageResult;
  snapshotHash: string;
  promptHash: string | null;
  divergedAt: Date;
}): {
  frame: Partial<NewFrame>;
  primaryRevert: Partial<NewFrameVariant>;
  divergentRow: Partial<NewFrameVariant> & {
    url: string;
    storagePath: string;
    inputHash: string;
    divergedAt: Date;
    status: 'completed';
  };
} {
  const { upload, snapshotHash, promptHash, divergedAt } = opts;
  return {
    frame: {
      thumbnailUrl: null,
      thumbnailPath: null,
      thumbnailStatus: 'pending',
      thumbnailWorkflowRunId: null,
      thumbnailGeneratedAt: null,
      thumbnailError: null,
      thumbnailInputHash: null,
    },
    primaryRevert: {
      url: null,
      storagePath: null,
      previewUrl: null,
      status: 'pending',
      workflowRunId: null,
      generatedAt: null,
      error: null,
      inputHash: null,
    },
    divergentRow: {
      url: upload.url,
      storagePath: upload.path,
      status: 'completed',
      generatedAt: divergedAt,
      error: null,
      promptHash,
      inputHash: snapshotHash,
      divergedAt,
    },
  };
}

export type PersistImageOutcome =
  | { status: 'divergent'; imageUrl: string }
  | { status: 'convergent'; imageUrl: string }
  | { status: 'frame-deleted' };

/**
 * Orchestrates the divergence branch + DB writes for the image workflow.
 *
 * Pulled out of the workflow body so the call sequence (which scopedDb
 * methods get called, in what order, with what payload) is testable without
 * bootstrapping `createWorkflow`. The workflow remains responsible for the
 * `context.run` boundary and for resolving `currentHash` via
 * `context.snapshot.computeCurrent()` — that lets retries re-resolve the
 * live state cheaply without re-running this orchestration on a successful
 * step.
 *
 * Idempotent on retry:
 *   - `frames.update` is last-write-wins,
 *   - `frameVariants.updateByFrameAndModel` is last-write-wins,
 *   - `frameVariants.insertDivergent` pre-checks `(frame, type, model, hash)`.
 */
export async function persistImageResult(opts: {
  scopedDb: ScopedDb;
  frameId: string;
  sequenceId: string;
  model: string;
  upload: ImageStorageResult;
  snapshotHash: string | null;
  currentHash: string | null;
  promptHash: string | null;
  emit: (
    event: 'generation.image:progress',
    payload: {
      frameId: string;
      status: 'pending' | 'completed';
      model: string;
      thumbnailUrl?: string;
    }
  ) => Promise<void>;
  now?: () => Date;
}): Promise<PersistImageOutcome> {
  const {
    scopedDb,
    frameId,
    sequenceId,
    model,
    upload,
    snapshotHash,
    currentHash,
    promptHash,
    emit,
    now = () => new Date(),
  } = opts;

  const divergent = !!snapshotHash && currentHash !== snapshotHash;

  if (divergent && snapshotHash) {
    const writes = buildImageDivergentWrites({
      upload,
      snapshotHash,
      promptHash,
      divergedAt: now(),
    });

    const updatedFrame = await scopedDb.frames.update(frameId, writes.frame, {
      throwOnMissing: false,
    });
    if (!updatedFrame) return { status: 'frame-deleted' };

    await scopedDb.frameVariants.updateByFrameAndModel(
      frameId,
      'image',
      model,
      writes.primaryRevert
    );

    await scopedDb.frameVariants.insertDivergent({
      frameId,
      sequenceId,
      variantType: 'image',
      model,
      ...writes.divergentRow,
    });

    await emit('generation.image:progress', {
      frameId,
      status: 'pending',
      model,
    });

    return { status: 'divergent', imageUrl: upload.url };
  }

  const writes = buildImageConvergentWrites({
    upload,
    snapshotHash,
    promptHash,
    generatedAt: now(),
  });

  const updatedFrame = await scopedDb.frames.update(frameId, writes.frame, {
    throwOnMissing: false,
  });
  if (!updatedFrame) return { status: 'frame-deleted' };

  await scopedDb.frameVariants.updateByFrameAndModel(
    frameId,
    'image',
    model,
    writes.variant
  );

  await emit('generation.image:progress', {
    frameId,
    status: 'completed',
    thumbnailUrl: upload.url,
    model,
  });

  return { status: 'convergent', imageUrl: upload.url };
}
