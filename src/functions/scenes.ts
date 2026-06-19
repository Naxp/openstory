/**
 * Scene server functions (#909).
 *
 * Scenes are the narrative unit that owns a "look" (image model) and a "motion
 * character" (video model). These endpoints read the scene rows for a sequence
 * and persist the scene-level model choice. NULL on either column means inherit
 * the sequence default — see `resolveScene{Image,Video}Model`.
 */

import { dbSceneId, type SceneRow } from '@/lib/db/schema';
import {
  isValidImageToVideoModel,
  isValidTextToImageModel,
} from '@/lib/ai/models';
import { ulidSchema } from '@/lib/schemas/id.schemas';
import { createServerFn } from '@tanstack/react-start';
import { zodValidator } from '@tanstack/zod-adapter';
import { z } from 'zod';
import { sequenceAccessMiddleware } from './middleware';

export const getScenesFn = createServerFn({ method: 'GET' })
  .middleware([sequenceAccessMiddleware])
  .handler(async ({ context }): Promise<SceneRow[]> => {
    return context.scopedDb.scenes.listBySequence(context.sequence.id);
  });

/**
 * Persist a scene's image and/or video model. A `null` value clears the
 * override so the scene re-inherits the sequence default; omitting a field
 * leaves it unchanged. Validates the scene belongs to the sequence in scope
 * before writing.
 */
export const updateSceneModelsFn = createServerFn({ method: 'POST' })
  .middleware([sequenceAccessMiddleware])
  .inputValidator(
    zodValidator(
      z.object({
        sequenceId: ulidSchema,
        sceneId: ulidSchema,
        imageModel: z
          .string()
          .nullable()
          .optional()
          .refine((v) => v == null || isValidTextToImageModel(v), {
            message: 'Unknown image model',
          }),
        videoModel: z
          .string()
          .nullable()
          .optional()
          .refine((v) => v == null || isValidImageToVideoModel(v), {
            message: 'Unknown video model',
          }),
      })
    )
  )
  .handler(async ({ data, context }): Promise<SceneRow> => {
    const sceneId = dbSceneId(data.sceneId);
    const scene = await context.scopedDb.scenes.getById(sceneId);
    if (!scene || scene.sequenceId !== context.sequence.id) {
      throw new Error('Scene not found in this sequence');
    }

    const update: { imageModel?: string | null; videoModel?: string | null } =
      {};
    if (data.imageModel !== undefined) update.imageModel = data.imageModel;
    if (data.videoModel !== undefined) update.videoModel = data.videoModel;

    const updated = await context.scopedDb.scenes.update(sceneId, update);
    if (!updated) {
      throw new Error('Scene update returned no data');
    }
    return updated;
  });
