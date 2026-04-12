/**
 * JSON Workflow Definition Schema
 *
 * Zod schemas for validating user-created workflow definitions.
 * Workflows are stored as JSON in the database and interpreted
 * by the executor at runtime.
 */

import { z } from 'zod';

// ── Expression strings ──────────────────────────────────────────
// Expressions like "{{steps.get-frame.thumbnailUrl}}" are resolved at runtime.
// At schema level we just validate they're present (z.any() for Zod v4 compat).
const expressionOrValue = z.any();

// ── Trigger types ───────────────────────────────────────────────

export const manualTriggerSchema = z.object({
  type: z.literal('manual'),
  scope: z.enum(['sequence', 'frame']),
});

export const eventTriggerSchema = z.object({
  type: z.literal('event'),
  event: z.string().min(1),
  filter: z.record(z.string(), z.any()).optional(),
});

export const triggerSchema = z.discriminatedUnion('type', [
  manualTriggerSchema,
  eventTriggerSchema,
]);

// ── Input parameter definitions ─────────────────────────────────

export const inputParameterSchema = z.object({
  type: z.enum(['string', 'number', 'boolean', 'object', 'array']),
  required: z.boolean().optional(),
  default: z.any().optional(),
  description: z.string().optional(),
});

// ── Step types ──────────────────────────────────────────────────

// Forward-declare for recursive step types (manual type to avoid circular reference)
export type WorkflowStep =
  | z.infer<typeof actionStepSchema>
  | z.infer<typeof llmStepSchema>
  | {
      id: string;
      type: 'conditional';
      condition: string;
      then: WorkflowStep[];
      else?: WorkflowStep[];
    }
  | {
      id: string;
      type: 'for-each';
      collection: string;
      itemVariable: string;
      steps: WorkflowStep[];
      maxConcurrency?: number;
    }
  | { id: string; type: 'parallel'; branches: WorkflowStep[][] };

export const actionStepSchema = z.object({
  id: z.string().min(1),
  type: z.literal('action'),
  action: z.string().min(1),
  inputs: z.record(z.string(), expressionOrValue).optional(),
  dependsOn: z.array(z.string()).optional(),
  continueOnError: z.boolean().optional(),
});

export const llmStepSchema = z.object({
  id: z.string().min(1),
  type: z.literal('llm'),
  prompt: z.string().min(1), // Langfuse key or inline prompt text
  variables: z.record(z.string(), expressionOrValue).optional(),
  model: z.string().optional(), // defaults to sequence's analysisModel
  outputSchema: z.string().optional(), // registered schema name
});

// Lazy schemas for recursive step types
const lazyStepsArray: z.ZodType<WorkflowStep[]> = z.lazy(() =>
  z.array(workflowStepSchema)
);

export const conditionalStepSchema = z.object({
  id: z.string().min(1),
  type: z.literal('conditional'),
  condition: z.string().min(1), // expression that evaluates to truthy/falsy
  then: lazyStepsArray,
  else: lazyStepsArray.optional(),
});

export const forEachStepSchema = z.object({
  id: z.string().min(1),
  type: z.literal('for-each'),
  collection: z.string().min(1), // expression resolving to array
  itemVariable: z.string().min(1),
  steps: lazyStepsArray,
  maxConcurrency: z.number().int().positive().optional(),
});

export const parallelStepSchema = z.object({
  id: z.string().min(1),
  type: z.literal('parallel'),
  branches: z.array(lazyStepsArray).min(2),
});

export const workflowStepSchema: z.ZodType<WorkflowStep> = z.discriminatedUnion(
  'type',
  [
    actionStepSchema,
    llmStepSchema,
    conditionalStepSchema,
    forEachStepSchema,
    parallelStepSchema,
  ]
);

// ── Workflow definition ─────────────────────────────────────────

export const workflowDefinitionSchema = z.object({
  version: z.literal(1),
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  trigger: triggerSchema,
  inputs: z.record(z.string(), inputParameterSchema).optional(),
  steps: z.array(workflowStepSchema).min(1),
});

export type WorkflowDefinitionJson = z.infer<typeof workflowDefinitionSchema>;
export type ManualTrigger = z.infer<typeof manualTriggerSchema>;
export type EventTrigger = z.infer<typeof eventTriggerSchema>;
export type Trigger = z.infer<typeof triggerSchema>;
export type InputParameter = z.infer<typeof inputParameterSchema>;
export type ActionStep = z.infer<typeof actionStepSchema>;
export type LLMStep = z.infer<typeof llmStepSchema>;
export type ConditionalStep = z.infer<typeof conditionalStepSchema>;
export type ForEachStep = z.infer<typeof forEachStepSchema>;
export type ParallelStep = z.infer<typeof parallelStepSchema>;

// ── Executor input (what QStash receives) ───────────────────────

export const jsonWorkflowInputSchema = z.object({
  userId: z.string().min(1),
  teamId: z.string().min(1),
  definitionId: z.string().min(1),
  sequenceId: z.string().optional(),
  frameId: z.string().optional(),
  triggerData: z.record(z.string(), z.any()).optional(),
  inputs: z.record(z.string(), z.any()).optional(),
});

export type JsonWorkflowInput = z.infer<typeof jsonWorkflowInputSchema>;
