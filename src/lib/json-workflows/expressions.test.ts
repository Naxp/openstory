import { describe, expect, test } from 'bun:test';
import {
  createExpressionContext,
  evaluateCondition,
  resolveObject,
  resolveValue,
  type ExpressionContext,
} from './expressions';

function makeCtx(overrides?: Partial<ExpressionContext>): ExpressionContext {
  return {
    context: { userId: 'user-1', teamId: 'team-1', sequenceId: 'seq-1' },
    trigger: {},
    steps: {},
    item: {},
    inputs: {},
    ...overrides,
  };
}

describe('resolveValue', () => {
  test('returns non-string values as-is', () => {
    const ctx = makeCtx();
    expect(resolveValue(42, ctx)).toBe(42);
    expect(resolveValue(true, ctx)).toBe(true);
    expect(resolveValue(null, ctx)).toBe(null);
  });

  test('resolves a single expression to its typed value', () => {
    const ctx = makeCtx({
      steps: { 'get-frame': { thumbnailUrl: 'https://example.com/img.png' } },
    });
    expect(resolveValue('{{steps.get-frame.thumbnailUrl}}', ctx)).toBe(
      'https://example.com/img.png'
    );
  });

  test('preserves object type for single expression', () => {
    const frameData = { id: 'f1', metadata: { title: 'Scene 1' } };
    const ctx = makeCtx({ steps: { 'get-frame': frameData } });
    const result = resolveValue('{{steps.get-frame}}', ctx);
    expect(result).toEqual(frameData);
  });

  test('preserves array type for single expression', () => {
    const frames = [{ id: 'f1' }, { id: 'f2' }];
    const ctx = makeCtx({ steps: { 'list-frames': { frames } } });
    const result = resolveValue('{{steps.list-frames.frames}}', ctx);
    expect(result).toEqual(frames);
  });

  test('resolves nested dot-path', () => {
    const ctx = makeCtx({
      steps: {
        scene: {
          metadata: { prompts: { visual: { fullPrompt: 'a sunset' } } },
        },
      },
    });
    expect(
      resolveValue('{{steps.scene.metadata.prompts.visual.fullPrompt}}', ctx)
    ).toBe('a sunset');
  });

  test('interpolates mixed template strings', () => {
    const ctx = makeCtx({
      context: { userId: 'u1', teamId: 't1', sequenceId: 'seq-1' },
      trigger: { name: 'World' },
    });
    expect(resolveValue('Hello {{trigger.name}}!', ctx)).toBe('Hello World!');
  });

  test('returns empty string for missing values in mixed templates', () => {
    const ctx = makeCtx();
    expect(resolveValue('prefix-{{trigger.missing}}-suffix', ctx)).toBe(
      'prefix--suffix'
    );
  });

  test('returns undefined for missing single expression', () => {
    const ctx = makeCtx();
    expect(resolveValue('{{steps.nonexistent.value}}', ctx)).toBeUndefined();
  });

  test('resolves context namespace', () => {
    const ctx = makeCtx();
    expect(resolveValue('{{context.userId}}', ctx)).toBe('user-1');
    expect(resolveValue('{{context.teamId}}', ctx)).toBe('team-1');
    expect(resolveValue('{{context.sequenceId}}', ctx)).toBe('seq-1');
  });

  test('resolves item namespace for for-each loops', () => {
    const ctx = makeCtx({
      item: { frame: { id: 'f1', thumbnailStatus: 'pending' } },
    });
    expect(resolveValue('{{item.frame.id}}', ctx)).toBe('f1');
    expect(resolveValue('{{item.frame.thumbnailStatus}}', ctx)).toBe('pending');
  });

  test('resolves inputs namespace', () => {
    const ctx = makeCtx({ inputs: { model: 'flux_schnell' } });
    expect(resolveValue('{{inputs.model}}', ctx)).toBe('flux_schnell');
  });

  test('recursively resolves arrays', () => {
    const ctx = makeCtx({ trigger: { x: 'hello' } });
    const result = resolveValue(['{{trigger.x}}', 42], ctx);
    expect(result).toEqual(['hello', 42]);
  });

  test('recursively resolves objects', () => {
    const ctx = makeCtx({ trigger: { val: 'resolved' } });
    const result = resolveValue({ key: '{{trigger.val}}', num: 5 }, ctx);
    expect(result).toEqual({ key: 'resolved', num: 5 });
  });
});

describe('resolveObject', () => {
  test('resolves all values in an object', () => {
    const ctx = makeCtx({
      steps: { 'get-frame': { id: 'f1', url: 'https://example.com' } },
    });
    const result = resolveObject(
      {
        frameId: '{{steps.get-frame.id}}',
        imageUrl: '{{steps.get-frame.url}}',
        staticValue: 'hello',
      },
      ctx
    );
    expect(result).toEqual({
      frameId: 'f1',
      imageUrl: 'https://example.com',
      staticValue: 'hello',
    });
  });
});

describe('evaluateCondition', () => {
  test('truthy check on resolved value', () => {
    const ctx = makeCtx({
      steps: { 'get-frame': { thumbnailUrl: 'https://img.png' } },
    });
    expect(evaluateCondition('{{steps.get-frame.thumbnailUrl}}', ctx)).toBe(
      true
    );
  });

  test('falsy check on null value', () => {
    const ctx = makeCtx({ steps: { 'get-frame': { thumbnailUrl: null } } });
    expect(evaluateCondition('{{steps.get-frame.thumbnailUrl}}', ctx)).toBe(
      false
    );
  });

  test('falsy check on undefined value', () => {
    const ctx = makeCtx();
    expect(evaluateCondition('{{steps.missing.value}}', ctx)).toBe(false);
  });

  test('equality comparison with null', () => {
    const ctx = makeCtx({ steps: { x: { val: null } } });
    expect(evaluateCondition('{{steps.x.val}} == null', ctx)).toBe(true);
  });

  test('equality comparison with string', () => {
    const ctx = makeCtx({ steps: { x: { status: 'pending' } } });
    expect(evaluateCondition('{{steps.x.status}} == pending', ctx)).toBe(true);
    expect(evaluateCondition('{{steps.x.status}} == completed', ctx)).toBe(
      false
    );
  });

  test('equality comparison with boolean', () => {
    const ctx = makeCtx({ trigger: { autoGenerate: true } });
    expect(evaluateCondition('{{trigger.autoGenerate}} == true', ctx)).toBe(
      true
    );
    expect(evaluateCondition('{{trigger.autoGenerate}} == false', ctx)).toBe(
      false
    );
  });

  test('inequality comparison', () => {
    const ctx = makeCtx({ steps: { x: { status: 'pending' } } });
    expect(evaluateCondition('{{steps.x.status}} != completed', ctx)).toBe(
      true
    );
    expect(evaluateCondition('{{steps.x.status}} != pending', ctx)).toBe(false);
  });

  test('numeric comparison', () => {
    const ctx = makeCtx({ steps: { x: { count: 5 } } });
    expect(evaluateCondition('{{steps.x.count}} == 5', ctx)).toBe(true);
    expect(evaluateCondition('{{steps.x.count}} == 3', ctx)).toBe(false);
  });
});

describe('createExpressionContext', () => {
  test('creates context with all namespaces', () => {
    const ctx = createExpressionContext({
      userId: 'u1',
      teamId: 't1',
      sequenceId: 's1',
      frameId: 'f1',
      triggerData: { event: 'test' },
      inputs: { model: 'flux' },
    });
    expect(ctx.context.userId).toBe('u1');
    expect(ctx.context.teamId).toBe('t1');
    expect(ctx.context.sequenceId).toBe('s1');
    expect(ctx.context.frameId).toBe('f1');
    expect(ctx.trigger).toEqual({ event: 'test' });
    expect(ctx.inputs).toEqual({ model: 'flux' });
    expect(ctx.steps).toEqual({});
    expect(ctx.item).toEqual({});
  });

  test('defaults optional fields', () => {
    const ctx = createExpressionContext({
      userId: 'u1',
      teamId: 't1',
    });
    expect(ctx.trigger).toEqual({});
    expect(ctx.inputs).toEqual({});
  });
});
