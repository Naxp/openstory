import { getEnv } from '#env';
import { moveFile, getSignedUploadUrl } from '#storage';
import { generateId } from '@/lib/db/id';
import { ulidSchema } from '@/lib/schemas/id.schemas';
import { STORAGE_BUCKETS, getPublicUrl } from '@/lib/storage/buckets';
import {
  getExtensionFromUrl,
  getMimeTypeFromExtension,
} from '@/lib/utils/file';
import { triggerWorkflow } from '@/lib/workflow/client';
import { buildWorkflowLabel } from '@/lib/workflow/labels';
import type { ElementVisionWorkflowInput } from '@/lib/workflow/types';
import { createServerFn } from '@tanstack/react-start';
import { zodValidator } from '@tanstack/zod-adapter';
import { z } from 'zod';
import { authWithTeamMiddleware, sequenceAccessMiddleware } from './middleware';

/**
 * Derive an uppercase token from a filename stem.
 * Strips extension, non-alphanumeric characters, collapses runs to `_`.
 */
export function deriveTokenFromFilename(filename: string): string {
  const stem = filename.replace(/\.[^.]+$/, '');
  const cleaned = stem
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return cleaned.length > 0 ? cleaned : 'ELEMENT';
}

/**
 * Ensure a token is unique within a sequence. Appends `_2`, `_3` if taken.
 */
async function ensureUniqueToken(
  scopedDb: {
    sequenceElements: {
      getByToken: (
        sequenceId: string,
        token: string
      ) => Promise<unknown | null>;
    };
  },
  sequenceId: string,
  token: string
): Promise<string> {
  let candidate = token;
  let suffix = 2;
  while (
    (await scopedDb.sequenceElements.getByToken(sequenceId, candidate)) !== null
  ) {
    candidate = `${token}_${suffix}`;
    suffix += 1;
    if (suffix > 100)
      throw new Error('Unable to generate unique element token');
  }
  return candidate;
}

async function triggerElementVision(
  elementId: string,
  sequenceId: string,
  imageUrl: string,
  filename: string,
  teamId: string,
  userId: string
): Promise<void> {
  const input: ElementVisionWorkflowInput = {
    userId,
    teamId,
    sequenceId,
    elementId,
    imageUrl,
    filename,
  };
  await triggerWorkflow('/element-vision', input, {
    label: buildWorkflowLabel(sequenceId),
  });
}

// ============================================================================
// Presign upload
// ============================================================================

export const presignElementUploadFn = createServerFn({ method: 'POST' })
  .middleware([authWithTeamMiddleware])
  .inputValidator(
    zodValidator(
      z.object({
        filename: z.string().min(1),
        sequenceId: ulidSchema.optional(),
      })
    )
  )
  .handler(async ({ context, data }) => {
    const ext = getExtensionFromUrl(data.filename);
    const uploadId = generateId();
    const contentType = getMimeTypeFromExtension(ext);

    const storagePath = data.sequenceId
      ? `${context.teamId}/${data.sequenceId}/${uploadId}.${ext}`
      : `${context.teamId}/temp/${uploadId}.${ext}`;

    return getSignedUploadUrl(
      STORAGE_BUCKETS.ELEMENTS,
      storagePath,
      contentType
    );
  });

// ============================================================================
// Finalize upload to an existing sequence
// ============================================================================

export const finalizeElementUploadFn = createServerFn({ method: 'POST' })
  .middleware([sequenceAccessMiddleware])
  .inputValidator(
    zodValidator(
      z.object({
        sequenceId: ulidSchema,
        publicUrl: z.string().url(),
        path: z.string().min(1),
        filename: z.string().min(1),
      })
    )
  )
  .handler(async ({ context, data }) => {
    if (!data.path.startsWith(`elements/${context.teamId}/`)) {
      throw new Error('Invalid storage path');
    }

    const rawToken = deriveTokenFromFilename(data.filename);
    const token = await ensureUniqueToken(
      context.scopedDb,
      data.sequenceId,
      rawToken
    );

    const element = await context.scopedDb.sequenceElements.create({
      id: generateId(),
      sequenceId: data.sequenceId,
      uploadedFilename: data.filename,
      token,
      imageUrl: data.publicUrl,
      imagePath: data.path,
      visionStatus: 'pending',
    });

    // Kick off vision workflow — do not block the upload response
    if (getEnv().E2E_TEST !== 'true') {
      await triggerElementVision(
        element.id,
        element.sequenceId,
        element.imageUrl,
        element.uploadedFilename,
        context.teamId,
        context.user.id
      );
    }

    return element;
  });

// ============================================================================
// Promote temp uploads (created before sequence existed) into a new sequence
// ============================================================================

const tempUploadSchema = z.object({
  tempPath: z.string().min(1),
  tempPublicUrl: z.string().url(),
  filename: z.string().min(1),
});

export async function promoteTempElements(params: {
  scopedDb: import('@/lib/db/scoped').ScopedDb;
  teamId: string;
  userId: string;
  sequenceId: string;
  uploads: Array<z.infer<typeof tempUploadSchema>>;
  triggerVision?: boolean;
}): Promise<void> {
  const {
    scopedDb,
    teamId,
    userId,
    sequenceId,
    uploads,
    triggerVision = true,
  } = params;
  if (uploads.length === 0) return;

  for (const upload of uploads) {
    const tempPrefix = `elements/${teamId}/temp/`;
    if (!upload.tempPath.startsWith(tempPrefix)) {
      console.warn(
        '[promoteTempElements] Skipping non-temp path:',
        upload.tempPath
      );
      continue;
    }

    const relativeTempPath = upload.tempPath.slice('elements/'.length); // teamId/temp/xxx.ext
    const ext = getExtensionFromUrl(upload.tempPath);
    const newId = generateId();
    const permanentRelative = `${teamId}/${sequenceId}/${newId}.${ext}`;
    const permanentPath = `elements/${permanentRelative}`;

    if (getEnv().E2E_TEST !== 'true') {
      await moveFile(
        STORAGE_BUCKETS.ELEMENTS,
        relativeTempPath,
        permanentRelative
      );
    }

    const publicUrl =
      getEnv().E2E_TEST === 'true'
        ? upload.tempPublicUrl
        : getPublicUrl(STORAGE_BUCKETS.ELEMENTS, permanentRelative);

    const rawToken = deriveTokenFromFilename(upload.filename);
    const token = await ensureUniqueToken(scopedDb, sequenceId, rawToken);

    const element = await scopedDb.sequenceElements.create({
      id: newId,
      sequenceId,
      uploadedFilename: upload.filename,
      token,
      imageUrl: publicUrl,
      imagePath: permanentPath,
      visionStatus: 'pending',
    });

    if (triggerVision && getEnv().E2E_TEST !== 'true') {
      await triggerElementVision(
        element.id,
        sequenceId,
        element.imageUrl,
        element.uploadedFilename,
        teamId,
        userId
      );
    }
  }
}

// ============================================================================
// List / delete / rename
// ============================================================================

export const listSequenceElementsFn = createServerFn({ method: 'GET' })
  .middleware([sequenceAccessMiddleware])
  .inputValidator(zodValidator(z.object({ sequenceId: ulidSchema })))
  .handler(async ({ context }) => {
    return context.scopedDb.sequenceElements.list(context.sequence.id);
  });

export const deleteSequenceElementFn = createServerFn({ method: 'POST' })
  .middleware([sequenceAccessMiddleware])
  .inputValidator(
    zodValidator(z.object({ sequenceId: ulidSchema, elementId: ulidSchema }))
  )
  .handler(async ({ context, data }) => {
    const element = await context.scopedDb.sequenceElements.getById(
      data.elementId
    );
    if (!element || element.sequenceId !== context.sequence.id) {
      throw new Error('Element not found');
    }
    await context.scopedDb.sequenceElements.delete(data.elementId);
    return { success: true };
  });

export const renameSequenceElementTokenFn = createServerFn({ method: 'POST' })
  .middleware([sequenceAccessMiddleware])
  .inputValidator(
    zodValidator(
      z.object({
        sequenceId: ulidSchema,
        elementId: ulidSchema,
        token: z.string().min(1).max(100),
      })
    )
  )
  .handler(async ({ context, data }) => {
    const element = await context.scopedDb.sequenceElements.getById(
      data.elementId
    );
    if (!element || element.sequenceId !== context.sequence.id) {
      throw new Error('Element not found');
    }

    const cleaned = deriveTokenFromFilename(data.token);
    const unique = await ensureUniqueToken(
      context.scopedDb,
      context.sequence.id,
      cleaned
    );

    return await context.scopedDb.sequenceElements.update(data.elementId, {
      token: unique,
    });
  });
