/**
 * Workflow Runs Schema
 * Tracks execution instances of JSON workflow definitions
 */

import { type InferInsertModel, type InferSelectModel } from 'drizzle-orm';
import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { generateId } from '../id';
import { teams } from './teams';
import { workflowDefinitions } from './workflow-definitions';

const RUN_STATUSES = ['pending', 'running', 'completed', 'failed'] as const;
export type WorkflowRunStatus = (typeof RUN_STATUSES)[number];

export const workflowRuns = sqliteTable(
  'workflow_runs',
  {
    id: text()
      .$defaultFn(() => generateId())
      .primaryKey()
      .notNull(),
    workflowDefinitionId: text('workflow_definition_id')
      .notNull()
      .references(() => workflowDefinitions.id, { onDelete: 'cascade' }),
    teamId: text('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    status: text().$type<WorkflowRunStatus>().default('pending').notNull(),
    triggerData: text('trigger_data', { mode: 'json' }).$type<
      Record<string, {}>
    >(),
    stepResults: text('step_results', { mode: 'json' }).$type<
      Record<string, {}>
    >(),
    error: text(),
    qstashWorkflowRunId: text('qstash_workflow_run_id'),
    startedAt: integer('started_at', { mode: 'timestamp' }),
    completedAt: integer('completed_at', { mode: 'timestamp' }),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .$defaultFn(() => new Date())
      .notNull(),
  },
  (table) => [
    index('idx_wf_run_def_id').on(table.workflowDefinitionId),
    index('idx_wf_run_team_id').on(table.teamId),
    index('idx_wf_run_status').on(table.status),
  ]
);

export type WorkflowRun = InferSelectModel<typeof workflowRuns>;
export type NewWorkflowRun = InferInsertModel<typeof workflowRuns>;
