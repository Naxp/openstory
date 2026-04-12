/**
 * Data Actions
 *
 * Read and write operations on sequences, frames, characters, and locations.
 * These wrap the existing scoped DB methods.
 */

import { z } from 'zod';
import type { ActionDefinition } from './types';

// ── Shared schemas ──────────────────────────────────────────────

const frameIdInput = z.object({ frameId: z.string() });
const sequenceIdInput = z.object({ sequenceId: z.string() });

// ── Read Actions ────────────────────────────────────────────────

const getFrame: ActionDefinition = {
  name: 'get-frame',
  description: 'Fetch a single frame by ID',
  inputSchema: frameIdInput,
  outputSchema: z.any(),
  execute: async (input, ctx) => {
    const { frameId } = frameIdInput.parse(input);
    const frame = await ctx.scopedDb.frames.getById(frameId);
    if (!frame) throw new Error(`Frame ${frameId} not found`);
    return frame;
  },
};

const getFrameWithSequence: ActionDefinition = {
  name: 'get-frame-with-sequence',
  description: 'Fetch a frame with its parent sequence context',
  inputSchema: frameIdInput,
  outputSchema: z.any(),
  execute: async (input, ctx) => {
    const { frameId } = frameIdInput.parse(input);
    const frame = await ctx.scopedDb.frames.getWithSequence(frameId);
    if (!frame) throw new Error(`Frame ${frameId} not found`);
    return frame;
  },
};

const listFramesInputSchema = z.object({
  sequenceId: z.string(),
  filter: z
    .object({
      hasThumbnail: z.boolean().optional(),
      hasVideo: z.boolean().optional(),
      limit: z.number().optional(),
    })
    .optional(),
});

const listFrames: ActionDefinition = {
  name: 'list-frames',
  description: 'List all frames in a sequence',
  inputSchema: listFramesInputSchema,
  outputSchema: z.object({ frames: z.array(z.any()) }),
  execute: async (input, ctx) => {
    const { sequenceId, filter } = listFramesInputSchema.parse(input);
    const frames = await ctx.scopedDb.frames.listBySequence(sequenceId, filter);
    return { frames };
  },
};

const getSequence: ActionDefinition = {
  name: 'get-sequence',
  description: 'Fetch a single sequence by ID',
  inputSchema: sequenceIdInput,
  outputSchema: z.any(),
  execute: async (input, ctx) => {
    const { sequenceId } = sequenceIdInput.parse(input);
    const sequence = await ctx.scopedDb.sequences.getById(sequenceId);
    if (!sequence) throw new Error(`Sequence ${sequenceId} not found`);
    return sequence;
  },
};

const getSequenceWithFrames: ActionDefinition = {
  name: 'get-sequence-with-frames',
  description: 'Fetch a sequence with all its frames and style',
  inputSchema: sequenceIdInput,
  outputSchema: z.any(),
  execute: async (input, ctx) => {
    const { sequenceId } = sequenceIdInput.parse(input);
    return ctx.scopedDb.sequences.getWithFrames(sequenceId);
  },
};

const getCharacters: ActionDefinition = {
  name: 'get-characters',
  description: 'List all characters in a sequence',
  inputSchema: sequenceIdInput,
  outputSchema: z.any(),
  execute: async (input, ctx) => {
    const { sequenceId } = sequenceIdInput.parse(input);
    return ctx.scopedDb.characters.list(sequenceId);
  },
};

const getLocations: ActionDefinition = {
  name: 'get-locations',
  description: 'List all locations in a sequence',
  inputSchema: sequenceIdInput,
  outputSchema: z.any(),
  execute: async (input, ctx) => {
    const { sequenceId } = sequenceIdInput.parse(input);
    return ctx.scopedDb.sequenceLocations.list(sequenceId);
  },
};

const styleIdInput = z.object({ styleId: z.string() });

const getStyle: ActionDefinition = {
  name: 'get-style',
  description: 'Fetch a style config by ID',
  inputSchema: styleIdInput,
  outputSchema: z.any(),
  execute: async (input, ctx) => {
    const { styleId } = styleIdInput.parse(input);
    const style = await ctx.scopedDb.styles.getById(styleId);
    if (!style) throw new Error(`Style ${styleId} not found`);
    return style;
  },
};

// ── Write Actions ───────────────────────────────────────────────

const updateFrameInputSchema = z.object({
  frameId: z.string(),
  fields: z.record(z.string(), z.any()),
});

const updateFrame: ActionDefinition = {
  name: 'update-frame',
  description: 'Update frame fields (status, URLs, metadata, etc.)',
  inputSchema: updateFrameInputSchema,
  outputSchema: z.any(),
  execute: async (input, ctx) => {
    const { frameId, fields } = updateFrameInputSchema.parse(input);
    return ctx.scopedDb.frames.update(frameId, fields);
  },
};

/**
 * Zod schema for frame inserts. Validates required fields and passes through
 * optional columns so the parsed result is compatible with NewFrame.
 */
const frameInsertSchema = z
  .object({
    sequenceId: z.string(),
    orderIndex: z.number(),
  })
  .passthrough();

const bulkUpsertInputSchema = z.object({
  frames: z.array(frameInsertSchema),
});

const bulkUpsertFrames: ActionDefinition = {
  name: 'bulk-upsert-frames',
  description: 'Bulk upsert frames into a sequence (idempotent on orderIndex)',
  inputSchema: bulkUpsertInputSchema,
  outputSchema: z.any(),
  execute: async (input, ctx) => {
    const { frames } = bulkUpsertInputSchema.parse(input);
    // Each frame is validated to have required sequenceId + orderIndex;
    // remaining optional columns pass through to the DB insert.
    return ctx.scopedDb.frames.bulkUpsert(
      frames.map((f) => ({
        ...f,
        sequenceId: f.sequenceId,
        orderIndex: f.orderIndex,
      }))
    );
  },
};

const reorderInputSchema = z.object({
  sequenceId: z.string(),
  frameOrders: z.array(z.object({ id: z.string(), order_index: z.number() })),
});

const reorderFrames: ActionDefinition = {
  name: 'reorder-frames',
  description: 'Reorder frames in a sequence',
  inputSchema: reorderInputSchema,
  outputSchema: z.any(),
  execute: async (input, ctx) => {
    const { sequenceId, frameOrders } = reorderInputSchema.parse(input);
    return ctx.scopedDb.frames.reorder(sequenceId, frameOrders);
  },
};

const updateSequenceInputSchema = z.object({
  sequenceId: z.string(),
  fields: z.record(z.string(), z.any()),
});

const updateSequence: ActionDefinition = {
  name: 'update-sequence',
  description: 'Update sequence fields',
  inputSchema: updateSequenceInputSchema,
  outputSchema: z.any(),
  execute: async (input, ctx) => {
    const { sequenceId, fields } = updateSequenceInputSchema.parse(input);
    return ctx.scopedDb.sequences.update({ id: sequenceId, ...fields });
  },
};

const updateStatusInputSchema = z.object({
  sequenceId: z.string(),
  status: z.enum(['draft', 'processing', 'completed', 'failed', 'archived']),
  error: z.string().optional(),
});

const updateSequenceStatus: ActionDefinition = {
  name: 'update-sequence-status',
  description: 'Set sequence processing status',
  inputSchema: updateStatusInputSchema,
  outputSchema: z.any(),
  execute: async (input, ctx) => {
    const { sequenceId, status, error } = updateStatusInputSchema.parse(input);
    return ctx.scopedDb.sequence(sequenceId).updateStatus(status, error);
  },
};

export const dataActions: ActionDefinition[] = [
  getFrame,
  getFrameWithSequence,
  listFrames,
  getSequence,
  getSequenceWithFrames,
  getCharacters,
  getLocations,
  getStyle,
  updateFrame,
  bulkUpsertFrames,
  reorderFrames,
  updateSequence,
  updateSequenceStatus,
];
