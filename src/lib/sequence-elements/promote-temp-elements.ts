import { getEnv } from '#env';
import { moveFile } from '#storage';
import type { ScopedDb } from '@/lib/db/scoped';
import { generateId } from '@/lib/db/id';
import { STORAGE_BUCKETS, getPublicUrl } from '@/lib/storage/buckets';
import { getExtensionFromUrl } from '@/lib/utils/file';
import { triggerWorkflow } from '@/lib/workflow/client';
import { buildWorkflowLabel } from '@/lib/workflow/labels';
import type { ElementVisionWorkflowInput } from '@/lib/workflow/types';
import { z } from 'zod';
import { deriveTokenFromFilename } from './derive-token';

const tempUploadSchema = z.object({
  tempPath: z.string().min(1),
  tempPublicUrl: z.string().url(),
  filename: z.string().min(1),
});

export type TempElementUpload = z.infer<typeof tempUploadSchema>;

async function ensureUniqueToken(
  scopedDb: ScopedDb,
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

export async function promoteTempElements(params: {
  scopedDb: ScopedDb;
  teamId: string;
  userId: string;
  sequenceId: string;
  uploads: TempElementUpload[];
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

    const relativeTempPath = upload.tempPath.slice('elements/'.length);
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
