/**
 * Scoped Workflow Definitions Sub-module
 * CRUD operations for workflow definitions (team-scoped).
 */

import type { Database } from '@/lib/db/client';
import {
  workflowDefinitions,
  type NewWorkflowDefinition,
  type WorkflowDefinition,
} from '@/lib/db/schema';
import { and, eq } from 'drizzle-orm';

export function createWorkflowDefinitionsMethods(
  db: Database,
  teamId: string,
  userId: string
) {
  return {
    list: async (): Promise<WorkflowDefinition[]> => {
      return db
        .select()
        .from(workflowDefinitions)
        .where(eq(workflowDefinitions.teamId, teamId));
    },

    getById: async (id: string): Promise<WorkflowDefinition | null> => {
      const result = await db
        .select()
        .from(workflowDefinitions)
        .where(
          and(
            eq(workflowDefinitions.id, id),
            eq(workflowDefinitions.teamId, teamId)
          )
        );
      return result[0] ?? null;
    },

    getByTriggerEvent: async (event: string): Promise<WorkflowDefinition[]> => {
      return db
        .select()
        .from(workflowDefinitions)
        .where(
          and(
            eq(workflowDefinitions.teamId, teamId),
            eq(workflowDefinitions.triggerType, 'event'),
            eq(workflowDefinitions.triggerEvent, event),
            eq(workflowDefinitions.enabled, true)
          )
        );
    },

    create: async (
      data: Omit<
        NewWorkflowDefinition,
        'id' | 'teamId' | 'createdBy' | 'createdAt' | 'updatedAt'
      >
    ): Promise<WorkflowDefinition> => {
      const [created] = await db
        .insert(workflowDefinitions)
        .values({
          ...data,
          teamId,
          createdBy: userId,
        })
        .returning();
      return created;
    },

    update: async (
      id: string,
      data: Partial<
        Pick<
          WorkflowDefinition,
          | 'name'
          | 'description'
          | 'definition'
          | 'triggerType'
          | 'triggerEvent'
          | 'enabled'
        >
      >
    ): Promise<WorkflowDefinition | null> => {
      const results = await db
        .update(workflowDefinitions)
        .set({
          ...data,
          updatedAt: new Date(),
          version: data.definition
            ? // Bump version when definition changes
              (
                await db
                  .select({ version: workflowDefinitions.version })
                  .from(workflowDefinitions)
                  .where(eq(workflowDefinitions.id, id))
              )[0].version + 1
            : undefined,
        })
        .where(
          and(
            eq(workflowDefinitions.id, id),
            eq(workflowDefinitions.teamId, teamId)
          )
        )
        .returning();
      return results[0] ?? null;
    },

    delete: async (id: string): Promise<void> => {
      await db
        .delete(workflowDefinitions)
        .where(
          and(
            eq(workflowDefinitions.id, id),
            eq(workflowDefinitions.teamId, teamId)
          )
        );
    },
  };
}

/**
 * Read-only workflow definitions methods (no userId needed).
 * Used by event trigger system and system operations.
 */
export function createWorkflowDefinitionsReadMethods(
  db: Database,
  teamId: string
) {
  return {
    list: async (): Promise<WorkflowDefinition[]> => {
      return db
        .select()
        .from(workflowDefinitions)
        .where(eq(workflowDefinitions.teamId, teamId));
    },

    getById: async (id: string): Promise<WorkflowDefinition | null> => {
      const result = await db
        .select()
        .from(workflowDefinitions)
        .where(
          and(
            eq(workflowDefinitions.id, id),
            eq(workflowDefinitions.teamId, teamId)
          )
        );
      return result[0] ?? null;
    },

    getByTriggerEvent: async (event: string): Promise<WorkflowDefinition[]> => {
      return db
        .select()
        .from(workflowDefinitions)
        .where(
          and(
            eq(workflowDefinitions.teamId, teamId),
            eq(workflowDefinitions.triggerType, 'event'),
            eq(workflowDefinitions.triggerEvent, event),
            eq(workflowDefinitions.enabled, true)
          )
        );
    },
  };
}
