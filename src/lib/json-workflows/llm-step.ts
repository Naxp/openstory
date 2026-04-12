/**
 * LLM Step Executor
 *
 * Executes LLM steps from JSON workflow definitions.
 * Supports two prompt modes:
 *   - Langfuse key: "phase/scene-splitting-chat" → fetched from prompt management
 *   - Inline prompt: literal text used as user message
 *
 * Wraps the existing durableLLMCall helper for durable execution.
 */

import type { ScopedDb } from '@/lib/db/scoped';
import type { LLMStep } from './schema';
import { getOutputSchema } from './schema-registry';
import type { ExpressionContext } from './expressions';
import { resolveValue } from './expressions';

export type LLMStepContext = {
  scopedDb: ScopedDb;
  sequenceId?: string;
};

/**
 * Execute an LLM step, resolving prompt + variables from the expression context.
 * Returns the parsed and optionally schema-validated LLM response.
 */
export async function executeLLMStep(
  step: LLMStep,
  expressionCtx: ExpressionContext,
  llmCtx: LLMStepContext
): Promise<unknown> {
  const { durableLLMCallDirect } = await import('./llm-call-direct');

  // Resolve variables through expression engine
  const resolvedVariables: Record<string, string> = {};
  if (step.variables) {
    for (const [key, value] of Object.entries(step.variables)) {
      const resolved = resolveValue(value, expressionCtx);
      resolvedVariables[key] =
        typeof resolved === 'string' ? resolved : JSON.stringify(resolved);
    }
  }

  // Resolve model (may be an expression like "{{trigger.analysisModelId}}")
  const resolvedModel = step.model
    ? resolveValue(step.model, expressionCtx)
    : undefined;
  const model = typeof resolvedModel === 'string' ? resolvedModel : undefined;

  // Resolve output schema from registry
  const outputSchema = step.outputSchema
    ? getOutputSchema(step.outputSchema)
    : undefined;

  if (step.outputSchema && !outputSchema) {
    throw new Error(
      `Unknown output schema "${step.outputSchema}". Available: ${(await import('./schema-registry')).getSchemaNames().join(', ')}`
    );
  }

  return durableLLMCallDirect({
    prompt: step.prompt,
    variables: resolvedVariables,
    modelId: model,
    responseSchema: outputSchema,
    scopedDb: llmCtx.scopedDb,
    sequenceId: llmCtx.sequenceId,
  });
}
