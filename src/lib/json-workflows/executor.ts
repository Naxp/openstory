/**
 * JSON Workflow Executor
 *
 * A QStash durable workflow that interprets JSON workflow definitions at runtime.
 * Each step in the definition is executed via context.run() for durability.
 *
 * Registered as 'json-workflow' in serveMany.
 */

import type { ScopedDb } from '@/lib/db/scoped';
import type { WorkflowJsonValue } from '@/lib/db/schema/workflow-runs';
import { sanitizeFailResponse } from '@/lib/workflow/sanitize-fail-response';
import { createScopedWorkflow } from '@/lib/workflow/scoped-workflow';
import type { WorkflowContext } from '@upstash/workflow';
import { getAction } from './actions/registry';
import type { ActionContext } from './actions/types';
import {
  createExpressionContext,
  evaluateCondition,
  resolveObject,
  type ExpressionContext,
} from './expressions';
import { executeLLMStep } from './llm-step';
import type {
  ActionStep,
  ConditionalStep,
  ForEachStep,
  JsonWorkflowInput,
  LLMStep,
  ParallelStep,
  WorkflowStep,
} from './schema';

type ExecutorState = {
  expressionCtx: ExpressionContext;
  scopedDb: ScopedDb;
  workflowContext: WorkflowContext<JsonWorkflowInput>;
  runId: string;
};

/**
 * Execute a single workflow step, dispatching by type.
 */
async function executeStep(
  step: WorkflowStep,
  state: ExecutorState
): Promise<void> {
  switch (step.type) {
    case 'action':
      await executeActionStep(step, state);
      break;
    case 'llm':
      await executeLLMStepWrapper(step, state);
      break;
    case 'conditional':
      await executeConditionalStep(step, state);
      break;
    case 'for-each':
      await executeForEachStep(step, state);
      break;
    case 'parallel':
      await executeParallelStep(step, state);
      break;
  }
}

/**
 * Execute an action step: resolve inputs, look up action, run it durably.
 */
async function executeActionStep(
  step: ActionStep,
  state: ExecutorState
): Promise<void> {
  const action = getAction(step.action);
  if (!action) {
    throw new Error(`Unknown action "${step.action}" in step "${step.id}"`);
  }

  const result = await state.workflowContext.run(
    `action:${step.id}`,
    async () => {
      const resolvedInputs = step.inputs
        ? resolveObject(
            step.inputs as Record<string, unknown>,
            state.expressionCtx
          )
        : {};

      const actionCtx: ActionContext = {
        scopedDb: state.scopedDb,
        sequenceId: state.expressionCtx.context.sequenceId,
        frameId: state.expressionCtx.context.frameId,
      };

      return action.execute(resolvedInputs, actionCtx);
    }
  );

  // Store result for downstream steps
  state.expressionCtx.steps[step.id] = result;
}

/**
 * Execute an LLM step: resolve prompt + variables, call LLM, validate output.
 */
async function executeLLMStepWrapper(
  step: LLMStep,
  state: ExecutorState
): Promise<void> {
  const result = await state.workflowContext.run(`llm:${step.id}`, async () => {
    return executeLLMStep(step, state.expressionCtx, {
      scopedDb: state.scopedDb,
      sequenceId: state.expressionCtx.context.sequenceId,
    });
  });

  state.expressionCtx.steps[step.id] = result;
}

/**
 * Execute a conditional step: evaluate condition, run then/else branch.
 */
async function executeConditionalStep(
  step: ConditionalStep,
  state: ExecutorState
): Promise<void> {
  const conditionResult = evaluateCondition(
    step.condition,
    state.expressionCtx
  );

  const branch = conditionResult ? step.then : (step.else ?? []);

  for (const branchStep of branch) {
    await executeStep(branchStep, state);
  }
}

/**
 * Execute a for-each step: iterate over collection, run nested steps per item.
 */
async function executeForEachStep(
  step: ForEachStep,
  state: ExecutorState
): Promise<void> {
  const { resolveValue } = await import('./expressions');
  const collection = resolveValue(step.collection, state.expressionCtx);

  if (!Array.isArray(collection)) {
    throw new Error(
      `for-each step "${step.id}": collection resolved to ${typeof collection}, expected array`
    );
  }

  for (let i = 0; i < collection.length; i++) {
    // Set the item variable in expression context
    const prevItem = { ...state.expressionCtx.item };
    state.expressionCtx.item[step.itemVariable] = collection[i];

    for (const innerStep of step.steps) {
      // Namespace inner step IDs to avoid collisions across iterations
      const namespacedStep = {
        ...innerStep,
        id: `${innerStep.id}[${i}]`,
      } as WorkflowStep;
      await executeStep(namespacedStep, state);
    }

    // Restore previous item context
    state.expressionCtx.item = prevItem;
  }
}

/**
 * Execute a parallel step: run all branches concurrently.
 */
async function executeParallelStep(
  step: ParallelStep,
  state: ExecutorState
): Promise<void> {
  await Promise.all(
    step.branches.map(async (branch, branchIdx) => {
      for (const branchStep of branch) {
        const namespacedStep = {
          ...branchStep,
          id: `${branchStep.id}:b${branchIdx}`,
        } as WorkflowStep;
        await executeStep(namespacedStep, state);
      }
    })
  );
}

/**
 * Execute all steps in a workflow definition sequentially.
 */
async function executeSteps(
  steps: WorkflowStep[],
  state: ExecutorState
): Promise<void> {
  for (const step of steps) {
    await executeStep(step, state);
  }
}

// ── QStash Workflow ─────────────────────────────────────────────

export const jsonWorkflowExecutor = createScopedWorkflow<JsonWorkflowInput>(
  async (context, scopedDb) => {
    const input = context.requestPayload;
    const { definitionId, triggerData, inputs, sequenceId, frameId } = input;

    // Step 1: Load workflow definition from DB
    const definition = await context.run('load-definition', async () => {
      const def = await scopedDb.workflowDefinitions.getById(definitionId);
      if (!def) {
        throw new Error(`Workflow definition ${definitionId} not found`);
      }
      return def;
    });

    // Step 2: Create a run record
    const run = await context.run('create-run', async () => {
      return scopedDb.workflowRuns.create({
        workflowDefinitionId: definitionId,
        status: 'running',
        triggerData: triggerData ?? null,
        qstashWorkflowRunId: context.workflowRunId,
        startedAt: new Date(),
      });
    });

    // Step 3: Build expression context
    const expressionCtx = createExpressionContext({
      userId: input.userId,
      teamId: input.teamId,
      sequenceId,
      frameId,
      triggerData,
      inputs,
    });

    const state: ExecutorState = {
      expressionCtx,
      scopedDb,
      workflowContext: context,
      runId: run.id,
    };

    // Step 4: Execute all steps
    await executeSteps(definition.definition.steps, state);

    // Step 5: Mark run as completed
    await context.run('mark-complete', async () => {
      // Coerce step results through JSON to enforce serializability — actions
      // may return Date / class instances; libSQL stores via JSON.stringify
      // anyway, so we do it here to match the typed column contract.
      const stepResults: Record<string, WorkflowJsonValue> = JSON.parse(
        JSON.stringify(state.expressionCtx.steps)
      );
      await scopedDb.workflowRuns.update(run.id, {
        status: 'completed',
        stepResults,
        completedAt: new Date(),
      });
    });

    console.log(
      `[JsonWorkflow] Completed run ${run.id} for definition "${definition.name}"`
    );
  },
  {
    failureFunction: async ({ context, scopedDb, failResponse }) => {
      const input = context.requestPayload;
      const error = sanitizeFailResponse(failResponse);

      console.error(
        `[JsonWorkflow] Failed for definition ${input.definitionId}: ${error}`
      );

      try {
        const run = await scopedDb.workflowRuns.getByQstashRunId(
          context.workflowRunId
        );
        if (!run) {
          console.error(
            `[JsonWorkflow] No run record found for qstashWorkflowRunId=${context.workflowRunId}`
          );
        } else {
          await scopedDb.workflowRuns.update(run.id, {
            status: 'failed',
            error,
            completedAt: new Date(),
          });
        }
      } catch (cleanupError) {
        console.error(
          `[JsonWorkflow] Failed to mark run as failed for qstashWorkflowRunId=${context.workflowRunId}:`,
          cleanupError
        );
      }

      return `JSON workflow failed: ${error}`;
    },
  }
);
