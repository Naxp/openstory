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

import { describe, expect, test } from 'vitest';
import { sanitizeEventType } from './await-child';

// Cloudflare's documented event-type rule.
const CF_EVENT_TYPE = /^[a-zA-Z0-9_][a-zA-Z0-9-_]*$/;

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
