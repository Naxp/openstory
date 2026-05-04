/**
 * Behavioural tests for the per-frame image-workflow snapshot helpers.
 *
 * `generateImageWorkflow` opts into the snapshot pattern so it can detect
 * drift between trigger-time and write-time and route divergent results into
 * `frame_variants`. These tests pin the two contract paths the workflow
 * branches on:
 *
 *   - convergent: live state matches the inlined snapshot → primary write
 *   - divergent: a character sheet was re-hashed mid-flight → alternate write
 */

import { describe, expect, it } from 'bun:test';
import type { ScopedDb } from '@/lib/db/scoped';
import type {
  FrameImageSceneSnapshot,
  ImageWorkflowInput,
} from '@/lib/workflow/types';
import {
  buildImageConvergentWrites,
  buildImageDivergentWrites,
  computeImageWorkflowHashCurrent,
  computeImageWorkflowHashFromDto,
  persistImageResult,
} from './image-workflow-snapshot';

function asScopedDb<T>(stub: T): ScopedDb {
  // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- test stub
  return stub as unknown as ScopedDb;
}

const baseScene: FrameImageSceneSnapshot = {
  sceneId: 's1',
  visualPrompt: 'A wide establishing shot of Jack at the docks at dusk',
  characterSheetHashes: ['jack-hash-v1'],
  locationSheetHashes: ['docks-hash-v1'],
  elementReferenceHashes: [],
};

const baseInput: ImageWorkflowInput = {
  userId: 'u1',
  teamId: 't1',
  sequenceId: 'seq1',
  frameId: 'f1',
  prompt: baseScene.visualPrompt,
  model: 'nano_banana_2',
  aspectRatio: '16:9',
  sceneSnapshot: baseScene,
};

function buildScopedDbStub(opts: {
  characterSheetHash?: string | null;
  locationReferenceHash?: string | null;
  elementImageUrl?: string | null;
  frameMetadata?: unknown;
}) {
  const defaultMetadata = {
    sceneId: 's1',
    continuity: {
      characterTags: ['jack'],
      environmentTag: 'docks',
      elementTags: [],
    },
    metadata: { location: 'Docks' },
    originalScript: { extract: '' },
  };
  // Use `in` check so an explicit `frameMetadata: null` flows through (data
  // corruption case) rather than collapsing to the default via `??`.
  const metadata =
    'frameMetadata' in opts ? opts.frameMetadata : defaultMetadata;
  return asScopedDb({
    frames: {
      getById: async () => ({ id: 'f1', metadata }),
    },
    characters: {
      listWithSheets: async () =>
        opts.characterSheetHash === undefined
          ? []
          : [
              {
                id: 'c1',
                sequenceId: 'seq1',
                characterId: 'jack',
                consistencyTag: 'jack',
                name: 'Jack',
                sheetImageUrl: 'https://example.com/jack.png',
                sheetInputHash: opts.characterSheetHash,
              },
            ],
    },
    sequenceLocations: {
      listWithReferences: async () =>
        opts.locationReferenceHash === undefined
          ? []
          : [
              {
                id: 'l1',
                sequenceId: 'seq1',
                locationId: 'docks',
                consistencyTag: 'docks',
                name: 'Docks',
                referenceImageUrl: 'https://example.com/docks.png',
                referenceInputHash: opts.locationReferenceHash,
              },
            ],
    },
    sequenceElements: {
      list: async () =>
        opts.elementImageUrl === undefined
          ? []
          : [
              {
                id: 'e1',
                token: 'LOGO',
                description: null,
                consistencyTag: 'logo',
                imageUrl: opts.elementImageUrl,
              },
            ],
    },
  });
}

describe('computeImageWorkflowHashFromDto', () => {
  it('returns the inlined hash sentinel when no snapshot is opted in', async () => {
    const result = await computeImageWorkflowHashFromDto({
      ...baseInput,
      sceneSnapshot: undefined,
      snapshotInputHash: undefined,
    });
    expect(result).toBe('');
  });

  it('produces a deterministic hash for identical snapshots', async () => {
    const a = await computeImageWorkflowHashFromDto(baseInput);
    const b = await computeImageWorkflowHashFromDto(baseInput);
    expect(a).toBe(b);
    expect(a.length).toBeGreaterThan(0);
  });

  it('changes the hash when the model changes', async () => {
    const a = await computeImageWorkflowHashFromDto(baseInput);
    const b = await computeImageWorkflowHashFromDto({
      ...baseInput,
      model: 'seedream_v5',
    });
    expect(a).not.toBe(b);
  });

  it('changes the hash when a character sheet hash changes', async () => {
    const a = await computeImageWorkflowHashFromDto(baseInput);
    const b = await computeImageWorkflowHashFromDto({
      ...baseInput,
      sceneSnapshot: {
        ...baseScene,
        characterSheetHashes: ['jack-hash-v2'],
      },
    });
    expect(a).not.toBe(b);
  });
});

describe('computeImageWorkflowHashCurrent', () => {
  it('matches the DTO hash on the convergent path (live state == snapshot)', async () => {
    const dtoHash = await computeImageWorkflowHashFromDto(baseInput);
    const currentHash = await computeImageWorkflowHashCurrent(
      baseInput,
      buildScopedDbStub({
        characterSheetHash: 'jack-hash-v1',
        locationReferenceHash: 'docks-hash-v1',
      })
    );
    expect(currentHash).toBe(dtoHash);
  });

  it('diverges from the DTO hash when a character sheet was re-hashed mid-flight', async () => {
    const dtoHash = await computeImageWorkflowHashFromDto(baseInput);
    const currentHash = await computeImageWorkflowHashCurrent(
      baseInput,
      buildScopedDbStub({
        characterSheetHash: 'jack-hash-v2',
        locationReferenceHash: 'docks-hash-v1',
      })
    );
    expect(currentHash).not.toBe(dtoHash);
  });

  it('diverges when an element reference image was swapped', async () => {
    const inputWithElement: ImageWorkflowInput = {
      ...baseInput,
      sceneSnapshot: {
        ...baseScene,
        elementReferenceHashes: ['https://example.com/logo-v1.png'],
      },
    };
    const stub = buildScopedDbStub({
      characterSheetHash: 'jack-hash-v1',
      locationReferenceHash: 'docks-hash-v1',
      elementImageUrl: 'https://example.com/logo-v2.png',
      frameMetadata: {
        sceneId: 's1',
        continuity: {
          characterTags: ['jack'],
          environmentTag: 'docks',
          elementTags: ['LOGO'],
        },
        metadata: { location: 'Docks' },
        originalScript: { extract: 'see LOGO at the door' },
      },
    });
    const dtoHash = await computeImageWorkflowHashFromDto(inputWithElement);
    const currentHash = await computeImageWorkflowHashCurrent(
      inputWithElement,
      stub
    );
    expect(currentHash).not.toBe(dtoHash);
  });

  it('returns the inlined hash sentinel when no snapshot is opted in', async () => {
    const stub = asScopedDb({});
    const result = await computeImageWorkflowHashCurrent(
      { ...baseInput, sceneSnapshot: undefined, snapshotInputHash: undefined },
      stub
    );
    expect(result).toBe('');
  });

  it('throws when sceneSnapshot is present but aspectRatio is missing', () => {
    expect(
      computeImageWorkflowHashCurrent(
        { ...baseInput, aspectRatio: undefined },
        buildScopedDbStub({
          characterSheetHash: 'jack-hash-v1',
          locationReferenceHash: 'docks-hash-v1',
        })
      )
    ).rejects.toThrow(/aspectRatio is required/);
  });

  it('throws when the frame exists but has null metadata (data corruption)', () => {
    const stub = buildScopedDbStub({
      characterSheetHash: 'jack-hash-v1',
      locationReferenceHash: 'docks-hash-v1',
      frameMetadata: null,
    });
    expect(computeImageWorkflowHashCurrent(baseInput, stub)).rejects.toThrow(
      /null metadata/
    );
  });
});

describe('computeImageWorkflowHashFromDto — aspectRatio guard', () => {
  it('throws when sceneSnapshot is present but aspectRatio is missing', () => {
    expect(() =>
      computeImageWorkflowHashFromDto({
        ...baseInput,
        aspectRatio: undefined,
      })
    ).toThrow(/aspectRatio is required/);
  });
});

describe('buildImageConvergentWrites', () => {
  const upload = {
    url: 'https://r2/jack-final.png',
    path: 'team/seq/jack.png',
  };
  const generatedAt = new Date('2026-05-04T00:00:00Z');

  it('stamps the new thumbnail + records snapshot hash + clears stale preview/video', () => {
    const writes = buildImageConvergentWrites({
      upload,
      snapshotHash: 'hash-abc',
      promptHash: 'prompt-xyz',
      generatedAt,
    });

    // Frame: new thumbnail + reset video lifecycle (regen invalidates motion).
    expect(writes.frame).toEqual({
      thumbnailPath: upload.path,
      thumbnailUrl: upload.url,
      thumbnailStatus: 'completed',
      thumbnailGeneratedAt: generatedAt,
      thumbnailError: null,
      thumbnailInputHash: 'hash-abc',
      videoUrl: null,
      videoPath: null,
      videoStatus: 'pending',
      videoWorkflowRunId: null,
      videoGeneratedAt: null,
      videoError: null,
    });

    // Variant: new thumbnail + previewUrl cleared (no stale preview-mode
    // pointer left attached after the converged primary write).
    expect(writes.variant).toEqual({
      url: upload.url,
      storagePath: upload.path,
      previewUrl: null,
      status: 'completed',
      generatedAt,
      error: null,
      promptHash: 'prompt-xyz',
      inputHash: 'hash-abc',
    });
  });

  it('writes a null inputHash when the workflow did not opt into snapshots', () => {
    const writes = buildImageConvergentWrites({
      upload,
      snapshotHash: null,
      promptHash: null,
      generatedAt,
    });
    expect(writes.frame.thumbnailInputHash).toBeNull();
    expect(writes.variant.inputHash).toBeNull();
  });
});

describe('buildImageDivergentWrites', () => {
  const upload = { url: 'https://r2/jack-alt.png', path: 'team/seq/alt.png' };
  const divergedAt = new Date('2026-05-04T00:00:00Z');

  it('reverts the speculative primary (incl. thumbnailUrl/Path) and emits an alternate row', () => {
    const writes = buildImageDivergentWrites({
      upload,
      snapshotHash: 'hash-xyz',
      promptHash: 'prompt-pqr',
      divergedAt,
    });

    // Frame: fully revert primary thumbnail. Critically, thumbnailUrl AND
    // thumbnailPath are both nulled so an already-completed frame doesn't
    // get left at status=pending while a stale URL persists.
    expect(writes.frame).toEqual({
      thumbnailUrl: null,
      thumbnailPath: null,
      thumbnailStatus: 'pending',
      thumbnailWorkflowRunId: null,
      thumbnailGeneratedAt: null,
      thumbnailError: null,
      thumbnailInputHash: null,
    });

    // Primary variant row: speculative URL/status cleared so the primary
    // slot stops pointing at diverged work.
    expect(writes.primaryRevert).toEqual({
      url: null,
      storagePath: null,
      previewUrl: null,
      status: 'pending',
      workflowRunId: null,
      generatedAt: null,
      error: null,
      inputHash: null,
    });

    // Divergent alternate: full content payload incl. divergence keys
    // (inputHash + divergedAt) so insertDivergent can match the partial
    // unique index for idempotency on QStash retry.
    expect(writes.divergentRow).toEqual({
      url: upload.url,
      storagePath: upload.path,
      status: 'completed',
      generatedAt: divergedAt,
      error: null,
      promptHash: 'prompt-pqr',
      inputHash: 'hash-xyz',
      divergedAt,
    });
  });
});

describe('persistImageResult — orchestration', () => {
  type Call = { method: string; args: unknown[] };
  const upload = { url: 'https://r2/jack.png', path: 'team/seq/jack.png' };
  const NOW = new Date('2026-05-04T00:00:00Z');

  function buildScopedDbSpy(opts: { frameMissing?: boolean } = {}): {
    scopedDb: ScopedDb;
    calls: Call[];
  } {
    const calls: Call[] = [];
    const scopedDb = asScopedDb({
      frames: {
        update: async (
          frameId: string,
          data: unknown,
          options: { throwOnMissing: boolean }
        ) => {
          calls.push({
            method: 'frames.update',
            args: [frameId, data, options],
          });
          if (opts.frameMissing) return null;
          return { id: frameId };
        },
      },
      frameVariants: {
        updateByFrameAndModel: async (
          frameId: string,
          variantType: string,
          model: string,
          data: unknown
        ) => {
          calls.push({
            method: 'frameVariants.updateByFrameAndModel',
            args: [frameId, variantType, model, data],
          });
          return { id: 'v1' };
        },
        insertDivergent: async (data: unknown) => {
          calls.push({ method: 'frameVariants.insertDivergent', args: [data] });
          return { id: 'v2' };
        },
      },
    });
    return { scopedDb, calls };
  }

  it('divergent path: reverts primary frames row, reverts primary variant, inserts divergent alternate, emits pending', async () => {
    const { scopedDb, calls } = buildScopedDbSpy();
    const emits: Array<{ event: string; payload: unknown }> = [];

    const outcome = await persistImageResult({
      scopedDb,
      frameId: 'f1',
      sequenceId: 'seq1',
      model: 'nano_banana_2',
      upload,
      snapshotHash: 'snapshot-abc',
      currentHash: 'current-xyz',
      promptHash: 'prompt-1',
      emit: async (event, payload) => {
        emits.push({ event, payload });
      },
      now: () => NOW,
    });

    expect(outcome).toEqual({ status: 'divergent', imageUrl: upload.url });

    // Frame revert was called first with the divergent revert payload
    // (incl. nulled url/path so an already-completed frame doesn't carry
    // a stale URL into pending state).
    expect(calls[0].method).toBe('frames.update');
    const frameUpdateData = calls[0].args[1] as Record<string, unknown>;
    expect(frameUpdateData.thumbnailUrl).toBeNull();
    expect(frameUpdateData.thumbnailPath).toBeNull();
    expect(frameUpdateData.thumbnailStatus).toBe('pending');
    expect(frameUpdateData.thumbnailInputHash).toBeNull();

    // Primary variant reverted (cleared) — primary slot must stop pointing at
    // diverged work.
    expect(calls[1].method).toBe('frameVariants.updateByFrameAndModel');
    const variantRevert = calls[1].args[3] as Record<string, unknown>;
    expect(variantRevert.url).toBeNull();
    expect(variantRevert.previewUrl).toBeNull();
    expect(variantRevert.status).toBe('pending');
    expect(variantRevert.inputHash).toBeNull();

    // Divergent alternate inserted with snapshot hash + divergedAt for the
    // partial-unique-index idempotency key.
    expect(calls[2].method).toBe('frameVariants.insertDivergent');
    const divergentRow = calls[2].args[0] as Record<string, unknown>;
    expect(divergentRow.frameId).toBe('f1');
    expect(divergentRow.sequenceId).toBe('seq1');
    expect(divergentRow.variantType).toBe('image');
    expect(divergentRow.model).toBe('nano_banana_2');
    expect(divergentRow.url).toBe(upload.url);
    expect(divergentRow.inputHash).toBe('snapshot-abc');
    expect(divergentRow.divergedAt).toBe(NOW);
    expect(divergentRow.status).toBe('completed');

    // Emit signals "pending" so the UI doesn't briefly show a completed
    // primary while the alternate is being routed.
    expect(emits).toEqual([
      {
        event: 'generation.image:progress',
        payload: { frameId: 'f1', status: 'pending', model: 'nano_banana_2' },
      },
    ]);
  });

  it('convergent path: stamps primary frames row + primary variant with snapshot hash, emits completed, NO insertDivergent call', async () => {
    const { scopedDb, calls } = buildScopedDbSpy();
    const emits: Array<{ event: string; payload: unknown }> = [];

    const outcome = await persistImageResult({
      scopedDb,
      frameId: 'f1',
      sequenceId: 'seq1',
      model: 'nano_banana_2',
      upload,
      snapshotHash: 'snapshot-abc',
      currentHash: 'snapshot-abc', // matches → convergent
      promptHash: 'prompt-1',
      emit: async (event, payload) => {
        emits.push({ event, payload });
      },
      now: () => NOW,
    });

    expect(outcome).toEqual({ status: 'convergent', imageUrl: upload.url });

    // Frame primary write with snapshot hash recorded.
    expect(calls[0].method).toBe('frames.update');
    const frameUpdateData = calls[0].args[1] as Record<string, unknown>;
    expect(frameUpdateData.thumbnailUrl).toBe(upload.url);
    expect(frameUpdateData.thumbnailStatus).toBe('completed');
    expect(frameUpdateData.thumbnailInputHash).toBe('snapshot-abc');

    // Variant primary write with snapshot hash recorded + previewUrl cleared.
    expect(calls[1].method).toBe('frameVariants.updateByFrameAndModel');
    const variantWrite = calls[1].args[3] as Record<string, unknown>;
    expect(variantWrite.url).toBe(upload.url);
    expect(variantWrite.status).toBe('completed');
    expect(variantWrite.inputHash).toBe('snapshot-abc');
    expect(variantWrite.previewUrl).toBeNull();

    // Critically: no insertDivergent call on the convergent path.
    expect(
      calls.some((c) => c.method === 'frameVariants.insertDivergent')
    ).toBe(false);

    expect(emits).toEqual([
      {
        event: 'generation.image:progress',
        payload: {
          frameId: 'f1',
          status: 'completed',
          thumbnailUrl: upload.url,
          model: 'nano_banana_2',
        },
      },
    ]);
  });

  it('non-snapshot mode (snapshotHash null): convergent write with null inputHash, NO insertDivergent', async () => {
    const { scopedDb, calls } = buildScopedDbSpy();
    const emits: Array<{ event: string; payload: unknown }> = [];

    const outcome = await persistImageResult({
      scopedDb,
      frameId: 'f1',
      sequenceId: 'seq1',
      model: 'nano_banana_2',
      upload,
      snapshotHash: null,
      currentHash: null,
      promptHash: null,
      emit: async (event, payload) => {
        emits.push({ event, payload });
      },
      now: () => NOW,
    });

    expect(outcome.status).toBe('convergent');
    const frameUpdateData = calls[0].args[1] as Record<string, unknown>;
    expect(frameUpdateData.thumbnailInputHash).toBeNull();
    const variantWrite = calls[1].args[3] as Record<string, unknown>;
    expect(variantWrite.inputHash).toBeNull();
    expect(
      calls.some((c) => c.method === 'frameVariants.insertDivergent')
    ).toBe(false);
  });

  it('frame deleted mid-flight: short-circuits without touching frame_variants', async () => {
    const { scopedDb, calls } = buildScopedDbSpy({ frameMissing: true });

    const outcome = await persistImageResult({
      scopedDb,
      frameId: 'f1',
      sequenceId: 'seq1',
      model: 'nano_banana_2',
      upload,
      snapshotHash: 'snapshot-abc',
      currentHash: 'current-xyz',
      promptHash: null,
      emit: async () => {},
      now: () => NOW,
    });

    expect(outcome).toEqual({ status: 'frame-deleted' });
    // Only the initial frames.update was attempted; bail out before any
    // variant writes when the frame is gone.
    expect(calls.length).toBe(1);
    expect(calls[0].method).toBe('frames.update');
  });
});
