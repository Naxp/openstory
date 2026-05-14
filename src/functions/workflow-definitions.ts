/**
 * Workflow Definition Server Functions
 *
 * CRUD operations for user-created JSON workflow definitions.
 */

import type { WorkflowDefinition } from '@/lib/db/schema';
import { workflowDefinitionSchema } from '@/lib/json-workflows/schema';
import { ulidSchema } from '@/lib/schemas/id.schemas';
import { triggerWorkflow } from '@/lib/workflow/client';
import { createServerFn } from '@tanstack/react-start';
import { zodValidator } from '@tanstack/zod-adapter';
import { z } from 'zod';
import { authWithTeamMiddleware } from './middleware';

// ── List ────────────────────────────────────────────────────────

export const listWorkflowDefinitionsFn = createServerFn({ method: 'GET' })
  .middleware([authWithTeamMiddleware])
  .handler(async ({ context }) => {
    return context.scopedDb.workflowDefinitions.list();
  });

// ── Get by ID ───────────────────────────────────────────────────

export const getWorkflowDefinitionFn = createServerFn({ method: 'POST' })
  .middleware([authWithTeamMiddleware])
  .inputValidator(zodValidator(z.object({ id: ulidSchema })))
  .handler(async ({ data, context }) => {
    const def = await context.scopedDb.workflowDefinitions.getById(data.id);
    if (!def) throw new Error(`Workflow definition ${data.id} not found`);
    return def;
  });

// ── Create ──────────────────────────────────────────────────────

const createSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  definition: workflowDefinitionSchema,
});

export const createWorkflowDefinitionFn = createServerFn({ method: 'POST' })
  .middleware([authWithTeamMiddleware])
  .inputValidator(zodValidator(createSchema))
  .handler(async ({ data, context }) => {
    const trigger = data.definition.trigger;

    return context.scopedDb.workflowDefinitions.create({
      name: data.name,
      description: data.description ?? null,
      definition: data.definition,
      triggerType: trigger.type,
      triggerEvent: trigger.type === 'event' ? trigger.event : null,
      enabled: true,
      version: 1,
    });
  });

// ── Update ──────────────────────────────────────────────────────

const updateSchema = z.object({
  id: ulidSchema,
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).optional(),
  definition: workflowDefinitionSchema.optional(),
  enabled: z.boolean().optional(),
});

export const updateWorkflowDefinitionFn = createServerFn({ method: 'POST' })
  .middleware([authWithTeamMiddleware])
  .inputValidator(zodValidator(updateSchema))
  .handler(async ({ data, context }) => {
    const { id, name, description, definition, enabled } = data;

    const updateData: Partial<
      Pick<
        WorkflowDefinition,
        | 'name'
        | 'description'
        | 'definition'
        | 'triggerType'
        | 'triggerEvent'
        | 'enabled'
      >
    > = {};
    if (name !== undefined) updateData.name = name;
    if (description !== undefined) updateData.description = description;
    if (enabled !== undefined) updateData.enabled = enabled;

    if (definition) {
      updateData.definition = definition;
      updateData.triggerType = definition.trigger.type;
      updateData.triggerEvent =
        definition.trigger.type === 'event' ? definition.trigger.event : null;
    }

    const updated = await context.scopedDb.workflowDefinitions.update(
      id,
      updateData
    );
    if (!updated) throw new Error(`Workflow definition ${id} not found`);
    return updated;
  });

// ── Delete ──────────────────────────────────────────────────────

export const deleteWorkflowDefinitionFn = createServerFn({ method: 'POST' })
  .middleware([authWithTeamMiddleware])
  .inputValidator(zodValidator(z.object({ id: ulidSchema })))
  .handler(async ({ data, context }) => {
    await context.scopedDb.workflowDefinitions.delete(data.id);
    return { success: true };
  });

// ── Trigger (manual run) ────────────────────────────────────────

const triggerSchema = z.object({
  definitionId: ulidSchema,
  sequenceId: z.string().optional(),
  frameId: z.string().optional(),
  inputs: z.record(z.string(), z.any()).optional(),
});

export const triggerWorkflowDefinitionFn = createServerFn({ method: 'POST' })
  .middleware([authWithTeamMiddleware])
  .inputValidator(zodValidator(triggerSchema))
  .handler(async ({ data, context }) => {
    const def = await context.scopedDb.workflowDefinitions.getById(
      data.definitionId
    );
    if (!def)
      throw new Error(`Workflow definition ${data.definitionId} not found`);

    const workflowRunId = await triggerWorkflow('/json-workflow', {
      userId: context.user.id,
      teamId: context.teamId,
      definitionId: data.definitionId,
      sequenceId: data.sequenceId,
      frameId: data.frameId,
      triggerData: data.inputs ?? {},
      inputs: data.inputs ?? {},
    });

    return { workflowRunId };
  });

// ── List Runs ───────────────────────────────────────────────────

const listRunsSchema = z.object({
  workflowDefinitionId: ulidSchema.optional(),
  status: z.enum(['pending', 'running', 'completed', 'failed']).optional(),
  limit: z.number().int().positive().max(100).optional(),
});

export const listWorkflowRunsFn = createServerFn({ method: 'POST' })
  .middleware([authWithTeamMiddleware])
  .inputValidator(zodValidator(listRunsSchema))
  .handler(async ({ data, context }) => {
    return context.scopedDb.workflowRuns.list({
      workflowDefinitionId: data.workflowDefinitionId,
      status: data.status,
      limit: data.limit ?? 50,
    });
  });

// ── Get Run ─────────────────────────────────────────────────────

export const getWorkflowRunFn = createServerFn({ method: 'POST' })
  .middleware([authWithTeamMiddleware])
  .inputValidator(zodValidator(z.object({ id: ulidSchema })))
  .handler(async ({ data, context }) => {
    const run = await context.scopedDb.workflowRuns.getById(data.id);
    if (!run) throw new Error(`Workflow run ${data.id} not found`);
    return run;
  });
