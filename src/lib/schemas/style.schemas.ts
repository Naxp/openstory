import {
  styles,
  StyleConfigSchema,
  StyleSampleVideoSchema,
} from '@/lib/db/schema';
import { createInsertSchema, createUpdateSchema } from 'drizzle-orm/zod';
import { z } from 'zod';

/**
 * Shared Zod schemas for style operations
 */

// Create: identity is required-with-defaults (issue #858). `category` is
// load-bearing (drives sample briefs + enhancer genre) so it's required; tags
// and useCases default to [] rather than being nullable.
const createTagsSchema = z.array(z.string()).default([]);
const createUseCasesSchema = z.array(z.string()).default([]);
// Update is a partial patch: each field optional, but never null.
const updateTagsSchema = z.array(z.string()).optional();
const updateUseCasesSchema = z.array(z.string()).optional();
const sampleVideosSchema = z.array(StyleSampleVideoSchema).nullish();

// Columns the client must never set. usageCount is server-managed (popularity
// ranking), id/teamId/createdBy/createdAt/updatedAt are injected by the scoped
// layer, and isTemplate/version/sortOrder are admin/migration-only.
const SERVER_MANAGED_COLUMNS = {
  id: true,
  teamId: true,
  createdBy: true,
  createdAt: true,
  updatedAt: true,
  usageCount: true,
  version: true,
  isTemplate: true,
  sortOrder: true,
} as const;

export const createStyleSchema = createInsertSchema(styles, {
  config: () => StyleConfigSchema,
  category: () => z.string().min(1),
  tags: () => createTagsSchema,
  useCases: () => createUseCasesSchema,
  sampleVideos: () => sampleVideosSchema,
}).omit(SERVER_MANAGED_COLUMNS);
// Update stays whole-or-omitted for `config` (not `.partial()`): the aesthetic
// recipe is replaced as a unit, never patched field-by-field.
export const updateStyleSchema = createUpdateSchema(styles, {
  config: () => StyleConfigSchema.optional(),
  tags: () => updateTagsSchema,
  useCases: () => updateUseCasesSchema,
  sampleVideos: () => sampleVideosSchema,
}).omit(SERVER_MANAGED_COLUMNS);

export type CreateStyleInput = z.infer<typeof createStyleSchema>;
export type UpdateStyleInput = z.infer<typeof updateStyleSchema>;
