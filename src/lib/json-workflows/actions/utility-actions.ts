/**
 * Utility Actions
 *
 * Emit realtime events, log messages, billing operations, storage uploads.
 */

import { z } from 'zod';
import type { ActionDefinition } from './types';

const emitEventInputSchema = z.object({
  sequenceId: z.string(),
  event: z.string(),
  data: z.record(z.string(), z.any()),
});

const emitEvent: ActionDefinition = {
  name: 'emit-event',
  description: 'Emit a realtime event for UI progress updates',
  inputSchema: emitEventInputSchema,
  outputSchema: z.void(),
  execute: async (input) => {
    const { emitDynamicEvent } = await import('@/lib/realtime');
    const params = emitEventInputSchema.parse(input);
    await emitDynamicEvent(params.sequenceId, params.event, params.data);
  },
};

const logInputSchema = z.object({
  message: z.string(),
  level: z.enum(['info', 'warn', 'error']).optional(),
});

const log: ActionDefinition = {
  name: 'log',
  description: 'Log a message for debugging',
  inputSchema: logInputSchema,
  outputSchema: z.void(),
  execute: async (input) => {
    const params = logInputSchema.parse(input);
    const level = params.level ?? 'info';
    const prefix = '[JsonWorkflow]';

    switch (level) {
      case 'warn':
        console.warn(prefix, params.message);
        break;
      case 'error':
        console.error(prefix, params.message);
        break;
      default:
        console.log(prefix, params.message);
    }
  },
};

const deductCreditsInputSchema = z.object({
  costMicros: z.number(),
  description: z.string(),
  metadata: z.record(z.string(), z.any()).optional(),
});

const deductCredits: ActionDefinition = {
  name: 'deduct-credits',
  description: 'Deduct credits for an AI operation',
  inputSchema: deductCreditsInputSchema,
  outputSchema: z.void(),
  execute: async (input, ctx) => {
    const { deductWorkflowCredits } =
      await import('@/lib/billing/workflow-deduction');
    const { micros } = await import('@/lib/billing/money');
    const params = deductCreditsInputSchema.parse(input);
    await deductWorkflowCredits({
      scopedDb: ctx.scopedDb,
      costMicros: micros(params.costMicros),
      usedOwnKey: false,
      description: params.description,
      metadata: params.metadata,
    });
  },
};

const checkCreditsInputSchema = z.object({
  costMicros: z.number(),
});

const checkCredits: ActionDefinition = {
  name: 'check-credits',
  description: 'Check if team has enough credits for an operation',
  inputSchema: checkCreditsInputSchema,
  outputSchema: z.object({ hasCredits: z.boolean() }),
  execute: async (input, ctx) => {
    const params = checkCreditsInputSchema.parse(input);
    const { micros } = await import('@/lib/billing/money');
    const hasCredits = await ctx.scopedDb.billing.hasEnoughCredits(
      micros(params.costMicros)
    );
    return { hasCredits };
  },
};

const uploadInputSchema = z.object({
  imageUrl: z.string(),
  teamId: z.string(),
  sequenceId: z.string(),
  frameId: z.string(),
});

const uploadToStorage: ActionDefinition = {
  name: 'upload-to-storage',
  description: 'Upload an image URL to R2 storage',
  inputSchema: uploadInputSchema,
  outputSchema: z.object({
    url: z.string().nullable(),
    path: z.string().nullable(),
  }),
  execute: async (input) => {
    const { uploadImageToStorage } = await import('@/lib/image/image-storage');
    const params = uploadInputSchema.parse(input);
    return uploadImageToStorage(params);
  },
};

export const utilityActions: ActionDefinition[] = [
  emitEvent,
  log,
  deductCredits,
  checkCredits,
  uploadToStorage,
];
