/**
 * Expression Resolver
 *
 * Resolves {{template}} expressions in workflow step inputs.
 * Expressions reference values from the execution context using dot-path notation.
 *
 * Available namespaces:
 *   context.userId, context.teamId, context.sequenceId
 *   trigger.*        — event payload or manual trigger data
 *   steps.<id>.*     — output from a previous step
 *   item.<var>.*     — current item in a for-each loop
 *   inputs.*         — workflow-level input parameters
 */

const EXPRESSION_PATTERN = /\{\{([^}]+)\}\}/g;

export type ExpressionContext = {
  context: {
    userId: string;
    teamId: string;
    sequenceId?: string;
    frameId?: string;
  };
  trigger: Record<string, unknown>;
  steps: Record<string, unknown>;
  item: Record<string, unknown>;
  inputs: Record<string, unknown>;
};

/**
 * Resolve a dot-path like "steps.get-frame.thumbnailUrl" against the context.
 */
function resolvePath(path: string, ctx: ExpressionContext): unknown {
  const parts = path.trim().split('.');
  let current: unknown = ctx;

  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    if (typeof current !== 'object') return undefined;
    // biome-ignore lint: safe property access on validated object
    current = Object.getOwnPropertyDescriptor(current, part)?.value;
  }

  return current;
}

/**
 * Resolve all {{expressions}} in a value.
 *
 * - If the entire value is a single expression (e.g., "{{steps.x.result}}"),
 *   return the resolved value directly (preserving its type: object, array, number, etc.)
 * - If the value contains expressions mixed with text (e.g., "Hello {{name}}"),
 *   return a string with the expressions interpolated.
 * - Non-string values are returned as-is (no expression resolution).
 */
export function resolveValue(value: unknown, ctx: ExpressionContext): unknown {
  if (typeof value !== 'string') {
    // Recursively resolve objects and arrays
    if (Array.isArray(value)) {
      return value.map((item) => resolveValue(item, ctx));
    }
    if (value !== null && typeof value === 'object') {
      return resolveObject(Object.fromEntries(Object.entries(value)), ctx);
    }
    return value;
  }

  // Check if the entire string is a single expression
  const trimmed = value.trim();
  if (
    trimmed.startsWith('{{') &&
    trimmed.endsWith('}}') &&
    trimmed.indexOf('{{', 2) === -1
  ) {
    const path = trimmed.slice(2, -2);
    return resolvePath(path, ctx);
  }

  // Mixed template: interpolate expressions within string
  return value.replace(EXPRESSION_PATTERN, (_match, path: string) => {
    const resolved = resolvePath(path, ctx);
    if (resolved === undefined || resolved === null) return '';
    if (typeof resolved === 'object') return JSON.stringify(resolved);
    return String(resolved);
  });
}

/**
 * Resolve all expressions in an object's values.
 */
export function resolveObject(
  obj: Record<string, unknown>,
  ctx: ExpressionContext
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    result[key] = resolveValue(value, ctx);
  }
  return result;
}

/**
 * Evaluate a simple condition expression for conditional steps.
 *
 * Supports:
 *   "{{expr}} == value"
 *   "{{expr}} != value"
 *   "{{expr}} == null"
 *   "{{expr}} == true"
 *   "{{expr}} == false"
 *   "{{expr}}"  (truthy check)
 */
export function evaluateCondition(
  condition: string,
  ctx: ExpressionContext
): boolean {
  const trimmed = condition.trim();

  // Check for comparison operators
  for (const op of ['!=', '=='] as const) {
    const idx = trimmed.indexOf(op);
    if (idx === -1) continue;

    const left = resolveValue(trimmed.slice(0, idx).trim(), ctx);
    const rightRaw = trimmed.slice(idx + op.length).trim();

    let right: unknown;
    if (rightRaw === 'null') right = null;
    else if (rightRaw === 'undefined') right = undefined;
    else if (rightRaw === 'true') right = true;
    else if (rightRaw === 'false') right = false;
    else if (/^-?\d+(\.\d+)?$/.test(rightRaw)) right = Number(rightRaw);
    else if (rightRaw.startsWith('{{')) right = resolveValue(rightRaw, ctx);
    else right = rightRaw.replace(/^["']|["']$/g, '');

    if (op === '==') return left == right;
    if (op === '!=') return left != right;
  }

  // No operator: truthy check
  const resolved = resolveValue(trimmed, ctx);
  return Boolean(resolved);
}

/**
 * Create an empty expression context with auth info.
 */
export function createExpressionContext(params: {
  userId: string;
  teamId: string;
  sequenceId?: string;
  frameId?: string;
  triggerData?: Record<string, unknown>;
  inputs?: Record<string, unknown>;
}): ExpressionContext {
  return {
    context: {
      userId: params.userId,
      teamId: params.teamId,
      sequenceId: params.sequenceId,
      frameId: params.frameId,
    },
    trigger: params.triggerData ?? {},
    steps: {},
    item: {},
    inputs: params.inputs ?? {},
  };
}
