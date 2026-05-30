/**
 * Tests for `sanitizeEventType`, the guard that keeps parent→child fan-in event
 * types within Cloudflare's `^[a-zA-Z0-9_][a-zA-Z0-9-_]*$` (≤100 char) rule.
 *
 * Regression for the migration bug where `buildEventType` emitted a colon
 * (`WorkflowImpl-done:scene-split_…`), which CF rejects with
 * `workflow.invalid_event_type` — deterministically failing `sendEvent` so the
 * parent's `waitForEvent` hung until timeout. Miniflare doesn't enforce the
 * charset, so only a unit assert like this catches it before deploy.
 */

import { describe, expect, test, vi } from 'vitest';
import {
  notifyParentOfFailure,
  type ParentNotifyHint,
  sanitizeEventType,
} from './await-child';
import type { CloudflareEnv } from '@/lib/workflow/types';
import type { WorkflowStep } from 'cloudflare:workers';

// Cloudflare's documented event-type rule.
const CF_EVENT_TYPE = /^[a-zA-Z0-9_][a-zA-Z0-9-_]*$/;

/** Minimal `step` stub that runs the durable callback once (one engine attempt). */
function fakeStep(): { step: WorkflowStep; doSpy: ReturnType<typeof vi.fn> } {
  const doSpy = vi.fn((_name: string, fn: () => Promise<unknown>) => fn());
  // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- minimal WorkflowStep stub: notifyParentOfFailure only uses `do`
  const step = { do: doSpy } as unknown as WorkflowStep;
  return { step, doSpy };
}

/** Env whose `get()` returns an instance exposing the given `sendEvent`. */
function fakeEnv(sendEvent: ReturnType<typeof vi.fn>): {
  env: CloudflareEnv;
  get: ReturnType<typeof vi.fn>;
} {
  const get = vi.fn(() => ({ sendEvent }));
  // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- minimal CloudflareEnv stub exposing only the parent binding under test
  const env = {
    IMAGE_WORKFLOW: { get, create: vi.fn() },
  } as unknown as CloudflareEnv;
  return { env, get };
}

const HINT: ParentNotifyHint = {
  bindingName: 'IMAGE_WORKFLOW',
  parentInstanceId: 'parent_01ABC',
  eventType: 'WorkflowImpl-done-child_01XYZ',
};

describe('sanitizeEventType', () => {
  test('replaces the colon that caused workflow.invalid_event_type', () => {
    const result = sanitizeEventType(
      'WorkflowImpl-done:scene-split_01KSVEPBM8DAW72MKN9AM16V3V'
    );
    expect(result).not.toContain(':');
    // The colon is neutralised to `_` (buildEventType separately joins with a
    // hyphen; the sanitizer's job is only to make any input CF-valid).
    expect(result).toBe(
      'WorkflowImpl-done_scene-split_01KSVEPBM8DAW72MKN9AM16V3V'
    );
    expect(result).toMatch(CF_EVENT_TYPE);
  });

  test('replaces periods (also rejected by CF)', () => {
    expect(sanitizeEventType('a.b.c')).toBe('a_b_c');
    expect(sanitizeEventType('a.b.c')).toMatch(CF_EVENT_TYPE);
  });

  test('collapses runs of invalid chars to a single underscore', () => {
    expect(sanitizeEventType('foo:::bar')).toBe('foo_bar');
  });

  test('preserves already-valid characters (letters, digits, - and _)', () => {
    const valid = 'WorkflowImpl-done-img_01ABC-xyz';
    expect(sanitizeEventType(valid)).toBe(valid);
    expect(sanitizeEventType(valid)).toMatch(CF_EVENT_TYPE);
  });

  test('coerces an invalid first char (leading hyphen) to a valid prefix', () => {
    const result = sanitizeEventType('-leading-hyphen');
    expect(result).toMatch(CF_EVENT_TYPE);
    expect(result.startsWith('w_')).toBe(true);
  });

  test('sanitizes minified-style qualifiers containing `$`', () => {
    const result = sanitizeEventType('Mod$abc-done-child_123');
    expect(result).toBe('Mod_abc-done-child_123');
    expect(result).toMatch(CF_EVENT_TYPE);
  });

  test('truncates to 100 chars and stays valid', () => {
    const result = sanitizeEventType('x'.repeat(250));
    expect(result.length).toBe(100);
    expect(result).toMatch(CF_EVENT_TYPE);
  });

  test('over-length input that needed a prefix is still capped at 100', () => {
    const result = sanitizeEventType(`:${'y'.repeat(250)}`);
    expect(result.length).toBe(100);
    expect(result).toMatch(CF_EVENT_TYPE);
  });
});

describe('notifyParentOfFailure', () => {
  test('no-ops without a parent hint (top-level workflow)', async () => {
    const sendEvent = vi.fn();
    const { env } = fakeEnv(sendEvent);
    const { step, doSpy } = fakeStep();

    await notifyParentOfFailure(step, env, undefined, 'boom');

    expect(doSpy).not.toHaveBeenCalled();
    expect(sendEvent).not.toHaveBeenCalled();
  });

  test('sends a failed outcome through a durable step.do', async () => {
    const sendEvent = vi.fn().mockResolvedValue(undefined);
    const { env, get } = fakeEnv(sendEvent);
    const { step, doSpy } = fakeStep();

    await notifyParentOfFailure(step, env, HINT, 'edit timeout');

    expect(doSpy).toHaveBeenCalledWith(
      'notify-parent-failure',
      expect.any(Function)
    );
    expect(get).toHaveBeenCalledWith(HINT.parentInstanceId);
    expect(sendEvent).toHaveBeenCalledWith({
      type: HINT.eventType,
      payload: { status: 'failed', error: 'edit timeout' },
    });
  });

  test('propagates (no longer swallows) so the engine retries a failed send', async () => {
    const sendEvent = vi.fn().mockRejectedValue(new Error('transient blip'));
    const { env } = fakeEnv(sendEvent);
    const { step } = fakeStep();

    await expect(
      notifyParentOfFailure(step, env, HINT, 'edit timeout')
    ).rejects.toThrow('transient blip');
  });
});
