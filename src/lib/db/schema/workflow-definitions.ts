/**
 * Workflow Definitions Schema
 * Stores user-created JSON workflow definitions (team-scoped)
 */

import type { WorkflowDefinitionJson } from '@/lib/json-workflows/schema';
import { type InferInsertModel, type InferSelectModel } from 'drizzle-orm';
import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { generateId } from '../id';
import { user } from './auth';
import { teams } from './teams';

const TRIGGER_TYPES = ['manual', 'event'] as const;
export type WorkflowTriggerType = (typeof TRIGGER_TYPES)[number];

export const workflowDefinitions = sqliteTable(
  'workflow_definitions',
  {
    id: text()
      .$defaultFn(() => generateId())
      .primaryKey()
      .notNull(),
    teamId: text('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    name: text().notNull(),
    description: text(),
    definition: text({ mode: 'json' })
      .$type<WorkflowDefinitionJson>()
      .notNull(),
    triggerType: text('trigger_type').$type<WorkflowTriggerType>().notNull(),
    triggerEvent: text('trigger_event'),
    enabled: integer({ mode: 'boolean' }).default(true).notNull(),
    version: integer().default(1).notNull(),
    createdBy: text('created_by').references(() => user.id, {
      onDelete: 'set null',
    }),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .$defaultFn(() => new Date())
      .notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp' })
      .$defaultFn(() => new Date())
      .notNull(),
  },
  (table) => [
    index('idx_wf_def_team_id').on(table.teamId),
    index('idx_wf_def_trigger').on(
      table.teamId,
      table.triggerType,
      table.triggerEvent
    ),
  ]
);

export type WorkflowDefinition = InferSelectModel<typeof workflowDefinitions>;
export type NewWorkflowDefinition = InferInsertModel<
  typeof workflowDefinitions
>;
