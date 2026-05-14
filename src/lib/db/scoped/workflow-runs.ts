/**
 * Scoped Workflow Runs Sub-module
 * CRUD operations for workflow run instances (team-scoped).
 */

import type { Database } from '@/lib/db/client';
import {
  workflowRuns,
  type NewWorkflowRun,
  type WorkflowRun,
  type WorkflowRunStatus,
} from '@/lib/db/schema';
import { and, desc, eq } from 'drizzle-orm';

export function createWorkflowRunsMethods(db: Database, teamId: string) {
  return {
    list: async (options?: {
      workflowDefinitionId?: string;
      status?: WorkflowRunStatus;
      limit?: number;
    }): Promise<WorkflowRun[]> => {
      const conditions = [eq(workflowRuns.teamId, teamId)];

      if (options?.workflowDefinitionId) {
        conditions.push(
          eq(workflowRuns.workflowDefinitionId, options.workflowDefinitionId)
        );
      }

      if (options?.status) {
        conditions.push(eq(workflowRuns.status, options.status));
      }

      return db
        .select()
        .from(workflowRuns)
        .where(and(...conditions))
        .orderBy(desc(workflowRuns.createdAt))
        .limit(options?.limit ?? 100);
    },

    getById: async (id: string): Promise<WorkflowRun | null> => {
      const result = await db
        .select()
        .from(workflowRuns)
        .where(and(eq(workflowRuns.id, id), eq(workflowRuns.teamId, teamId)));
      return result[0] ?? null;
    },

    getByQstashRunId: async (
      qstashRunId: string
    ): Promise<WorkflowRun | null> => {
      const result = await db
        .select()
        .from(workflowRuns)
        .where(
          and(
            eq(workflowRuns.qstashWorkflowRunId, qstashRunId),
            eq(workflowRuns.teamId, teamId)
          )
        );
      return result[0] ?? null;
    },

    create: async (
      data: Omit<NewWorkflowRun, 'id' | 'teamId' | 'createdAt'>
    ): Promise<WorkflowRun> => {
      const [created] = await db
        .insert(workflowRuns)
        .values({
          ...data,
          teamId,
        })
        .returning();
      return created;
    },

    update: async (
      id: string,
      data: Partial<
        Pick<WorkflowRun, 'status' | 'stepResults' | 'error' | 'completedAt'>
      >
    ): Promise<WorkflowRun | null> => {
      const results = await db
        .update(workflowRuns)
        .set(data)
        .where(and(eq(workflowRuns.id, id), eq(workflowRuns.teamId, teamId)))
        .returning();
      return results[0] ?? null;
    },
  };
}
