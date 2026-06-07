/**
 * Tests for `triggerCfWorkflow`'s `instance.already_exists` tolerance.
 *
 * Mirror-image of the `spawnAndAwaitChild` swallow (await-child.test.ts): when
 * the caller passed a deterministic `deduplicationId` and CF rejects the
 * create with `already_exists`, the existing instance belongs to this same
 * logical trigger (a `step.do` replay re-running its closure), so the trigger
 * must succeed and return the deterministic id — otherwise a multi-create
 * step can never complete once one sibling fails (issue #846 RC3). The
 * random-suffix path can't collide legitimately, so it keeps throwing.
 */

import { describe, expect, test, vi } from 'vitest';
import { triggerCfWorkflow } from './trigger-bindings';
import type { CloudflareEnv } from '@/lib/workflow/types';

// oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- minimal env stub: triggerCfWorkflow only reads VITE_APP_URL (via buildInstanceId)
const env = {
  VITE_APP_URL: 'https://openstory.so',
} as unknown as CloudflareEnv;

const body = { userId: 'u1', teamId: 't1' };

function harness(
  createImpl: (opts: { id: string; params: unknown }) => Promise<unknown>
) {
  const create =
    vi.fn<(opts: { id: string; params: unknown }) => Promise<unknown>>(
      createImpl
    );
  const bindingStub = { create };
  // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- minimal Workflow binding stub exposing only create
  const binding = bindingStub as unknown as Workflow<typeof body>;
  return { binding, create };
}

const alreadyExists = () =>
  Promise.reject(
    new Error('(instance.already_exists) Instance already exists')
  );

describe('triggerCfWorkflow', () => {
  test('returns the created instance id on success', async () => {
    const { binding, create } = harness((opts) =>
      Promise.resolve({ id: opts.id })
    );

    const result = await triggerCfWorkflow({
      binding,
      triggerPath: '/variant-image',
      body,
      env,
      deduplicationId: 'variant-f1-m1-abc',
    });

    const attempted = create.mock.calls[0]?.[0];
    if (!attempted) throw new Error('binding.create was not called');
    expect(result.workflowRunId).toBe(attempted.id);
    expect(attempted.id).toContain('variant-f1-m1-abc');
    expect(attempted.params).toEqual(body);
  });

  test('deterministic deduplicationId is stable across calls (replay-safe)', async () => {
    const { binding, create } = harness((opts) =>
      Promise.resolve({ id: opts.id })
    );

    const a = await triggerCfWorkflow({
      binding,
      triggerPath: '/image',
      body,
      env,
      deduplicationId: 'preview-frame1-h4sh',
    });
    const b = await triggerCfWorkflow({
      binding,
      triggerPath: '/image',
      body,
      env,
      deduplicationId: 'preview-frame1-h4sh',
    });

    expect(create).toHaveBeenCalledTimes(2);
    expect(a.workflowRunId).toBe(b.workflowRunId);
  });

  test('swallows already_exists and returns the deterministic id when deduplicationId was provided', async () => {
    const { binding, create } = harness(alreadyExists);

    const result = await triggerCfWorkflow({
      binding,
      triggerPath: '/variant-image',
      body,
      env,
      deduplicationId: 'variant-f1-m1-abc',
    });

    const attempted = create.mock.calls[0]?.[0];
    if (!attempted) throw new Error('binding.create was not called');
    expect(result.workflowRunId).toBe(attempted.id);
  });

  test('rethrows already_exists when no deduplicationId was provided (random-suffix path)', async () => {
    const { binding } = harness(alreadyExists);

    await expect(
      triggerCfWorkflow({ binding, triggerPath: '/image', body, env })
    ).rejects.toThrow(/already exists/i);
  });

  test('rethrows unrelated create errors even with a deduplicationId', async () => {
    const { binding } = harness(() =>
      Promise.reject(new Error('network down'))
    );

    await expect(
      triggerCfWorkflow({
        binding,
        triggerPath: '/image',
        body,
        env,
        deduplicationId: 'preview-frame1-h4sh',
      })
    ).rejects.toThrow('network down');
  });
});
