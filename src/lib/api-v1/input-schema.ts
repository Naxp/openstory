/**
 * Public input schema for `POST /api/v1/sequences`. Deliberately ergonomic and
 * lenient: callers pass human-friendly references (style by id or name, talent
 * and locations by id or name) and a single `enhance` flag. The orchestrator
 * resolves these into the strict `CreateSequenceInput`, which re-validates model
 * keys etc. — so this schema only needs to police shape, not model validity.
 */

import { aspectRatioSchema } from '@/lib/constants/aspect-ratios';
import { z } from 'zod';

/** Create a new library talent/location inline before generation. */
const createEntitySchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().max(2000).optional(),
});

export const apiCreateSequenceSchema = z.object({
  /** Raw script or, with `enhance: true`, a one-liner / brief to expand. */
  script: z.string().min(10).max(50000),
  title: z.string().min(1).max(500).optional(),

  /** When true, run script enhancement to completion before generating. */
  enhance: z.boolean().default(false),
  /** Target video length in seconds for enhancement (5–180). */
  targetSeconds: z.number().int().min(5).max(180).optional(),

  /** Style by id, name, or slugified name. Omit to auto-pick a default. */
  style: z.string().min(1).optional(),
  aspectRatio: aspectRatioSchema.optional(),

  /** Model keys/ids. Validated downstream against the model registry. */
  analysisModels: z.array(z.string()).min(1).optional(),
  imageModels: z.array(z.string()).min(1).optional(),
  videoModels: z.array(z.string()).min(1).optional(),

  /** Generate motion (video) for each frame. */
  motion: z.boolean().default(false),
  /** Generate sequence music. */
  music: z.boolean().default(false),
  audioModels: z.array(z.string()).min(1).optional(),

  /** Existing talent to cast, by id or name. */
  characters: z.array(z.string().min(1)).optional(),
  /** New talent to create inline (name + description). */
  createCharacters: z.array(createEntitySchema).optional(),

  /** Existing library locations to use, by id or name. */
  locations: z.array(z.string().min(1)).optional(),
  /** New library locations to create inline (name + description). */
  createLocations: z.array(createEntitySchema).optional(),

  /** Reference elements (logos, products) by hosted image URL. */
  elements: z
    .array(
      z.object({
        url: z.string().url(),
        /** Optional UPPERCASE token; derived by vision when omitted. */
        token: z.string().min(1).max(100).optional(),
        filename: z.string().min(1).optional(),
      })
    )
    .optional(),

  /**
   * Reserved for phase 2: a URL to receive a signed completion webhook. Stored
   * intent only — delivery is not implemented yet (see follow-up issue).
   */
  webhookUrl: z.string().url().optional(),
});

export type ApiCreateSequenceInput = z.infer<typeof apiCreateSequenceSchema>;
