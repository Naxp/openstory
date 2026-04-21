import { z } from 'zod';
import type {
  FrameOverlay,
  ImageOverlay,
  LowerThirdOverlay,
  TextOverlay,
} from './overlay.types';
import { OVERLAY_POSITIONS } from './overlay.types';

const overlayStyleSchema = z
  .object({
    color: z.string().max(64).optional(),
    background: z.string().max(64).optional(),
    fontWeight: z.number().int().min(100).max(900).optional(),
    fontSizePx: z.number().int().min(8).max(400).optional(),
    fontFamily: z.string().max(128).optional(),
  })
  .strict();

const overlayIdSchema = z.string().min(1).max(64);

const timingSchema = {
  startMs: z
    .number()
    .int()
    .min(0)
    .max(10 * 60 * 1000),
  durationMs: z
    .number()
    .int()
    .min(100)
    .max(10 * 60 * 1000),
};

const textOverlaySchema = z
  .object({
    kind: z.literal('text'),
    id: overlayIdSchema,
    text: z.string().min(1).max(512),
    position: z.enum(OVERLAY_POSITIONS),
    style: overlayStyleSchema.optional(),
    ...timingSchema,
  })
  .strict() satisfies z.ZodType<TextOverlay>;

const lowerThirdOverlaySchema = z
  .object({
    kind: z.literal('lowerThird'),
    id: overlayIdSchema,
    title: z.string().min(1).max(128),
    subtitle: z.string().max(128).optional(),
    style: overlayStyleSchema.optional(),
    ...timingSchema,
  })
  .strict() satisfies z.ZodType<LowerThirdOverlay>;

const imageOverlaySchema = z
  .object({
    kind: z.literal('image'),
    id: overlayIdSchema,
    assetUrl: z.string().url().max(2048),
    position: z.enum(OVERLAY_POSITIONS),
    widthPct: z.number().min(5).max(100).optional(),
    ...timingSchema,
  })
  .strict() satisfies z.ZodType<ImageOverlay>;

export const frameOverlaySchema = z.discriminatedUnion('kind', [
  textOverlaySchema,
  lowerThirdOverlaySchema,
  imageOverlaySchema,
]) satisfies z.ZodType<FrameOverlay>;

export const frameOverlaysSchema = z.array(frameOverlaySchema).max(32);
