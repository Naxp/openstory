/**
 * Action Definition Types
 *
 * Each action is a named operation with typed input/output schemas
 * that can be composed in JSON workflow definitions.
 */

import type { ScopedDb } from '@/lib/db/scoped';
import type { z } from 'zod';

export type ActionContext = {
  scopedDb: ScopedDb;
  sequenceId?: string;
  frameId?: string;
};

export type ActionDefinition<TInput = unknown, TOutput = unknown> = {
  name: string;
  description: string;
  inputSchema: z.ZodType<TInput>;
  outputSchema: z.ZodType<TOutput>;
  execute: (input: TInput, ctx: ActionContext) => Promise<TOutput>;
};
