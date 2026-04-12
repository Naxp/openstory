/**
 * Event Trigger System
 *
 * Checks for workflow definitions that match a given event and fires them.
 * Called after realtime events are emitted in existing workflows.
 */

import { createReadOnlyScopedDb } from '@/lib/db/scoped';
import { triggerWorkflow } from '@/lib/workflow/client';

/**
 * Check if event data matches a trigger's optional filter criteria.
 * Each filter key must match the corresponding value in the event data.
 */
function matchesFilter(
  filter: Record<string, unknown> | undefined,
  data: Record<string, unknown>
): boolean {
  if (!filter) return true;

  for (const [key, expectedValue] of Object.entries(filter)) {
    if (data[key] !== expectedValue) return false;
  }

  return true;
}

/**
 * Check for workflow definitions triggered by a given event and fire them.
 *
 * This is fire-and-forget — errors are logged but don't propagate.
 * Call this after emitting realtime events in existing workflows.
 *
 * @param teamId - The team that owns the workflows
 * @param event - The event name (e.g., "generation.image:completed")
 * @param data - The event payload
 * @param userId - The user who triggered the event (for auth context)
 */
export async function checkWorkflowTriggers(
  teamId: string,
  event: string,
  data: Record<string, unknown>,
  userId?: string
): Promise<void> {
  try {
    const scopedDb = createReadOnlyScopedDb(teamId);
    const matchingWorkflows =
      await scopedDb.workflowDefinitions.getByTriggerEvent(event);

    if (matchingWorkflows.length === 0) return;

    for (const workflow of matchingWorkflows) {
      const trigger = workflow.definition.trigger;
      const filter = 'filter' in trigger ? trigger.filter : undefined;

      if (!matchesFilter(filter, data)) continue;

      console.log(
        `[WorkflowTrigger] Firing workflow "${workflow.name}" (${workflow.id}) for event "${event}"`
      );

      const sequenceId =
        typeof data.sequenceId === 'string' ? data.sequenceId : undefined;
      const frameId =
        typeof data.frameId === 'string' ? data.frameId : undefined;

      await triggerWorkflow('/json-workflow', {
        userId: userId ?? 'system',
        teamId,
        definitionId: workflow.id,
        sequenceId,
        frameId,
        triggerData: data,
      });
    }
  } catch (error) {
    // Fire-and-forget: log but don't propagate
    console.error(
      `[WorkflowTrigger] Error checking triggers for event "${event}":`,
      error
    );
  }
}
