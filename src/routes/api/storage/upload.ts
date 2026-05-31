import { uploadFile } from '#storage';
import { authRequestMiddleware } from '@/functions/middleware';
import { resolveUserTeam } from '@/lib/db/scoped';
import { handleApiError } from '@/lib/errors';
import { getLogger } from '@/lib/observability/logger';
import { STORAGE_BUCKETS, type StorageBucket } from '@/lib/storage/buckets';
import { createFileRoute } from '@tanstack/react-router';

const bucketByName = new Map<string, StorageBucket>(
  Object.values(STORAGE_BUCKETS).map((b) => [b, b])
);

const logger = getLogger(['openstory', 'api', 'storage-upload']);

// DEBUG: bound the R2 put so a hung upload still returns (and flushes its tail
// logs). Shorter than the client-side timeout so the server wins the race and
// we get the diagnostic 504 + byte counts. Remove once the hang is fixed.
const UPLOAD_PUT_TIMEOUT_MS = 30_000;

export const Route = createFileRoute('/api/storage/upload')({
  server: {
    middleware: [authRequestMiddleware],
    handlers: {
      PUT: async ({ request, context }) => {
        const startedAt = Date.now();
        logger.info('[upload] handler entered', {
          url: request.url,
          contentLengthHeader: request.headers.get('content-length'),
          contentTypeHeader: request.headers.get('content-type'),
          hasBody: request.body !== null,
        });
        try {
          const team = await resolveUserTeam(context.user.id);
          if (!team) {
            return Response.json(
              { success: false, error: 'No team found' },
              { status: 403 }
            );
          }

          const url = new URL(request.url);
          const bucket = url.searchParams.get('bucket');
          const path = url.searchParams.get('path');
          const contentType = url.searchParams.get('contentType');

          if (!bucket || !path || !contentType) {
            return Response.json(
              {
                success: false,
                error:
                  'Missing required query params: bucket, path, contentType',
              },
              { status: 400 }
            );
          }

          const validBucket = bucketByName.get(bucket);
          if (!validBucket) {
            return Response.json(
              { success: false, error: `Invalid bucket: ${bucket}` },
              { status: 400 }
            );
          }

          if (!path.includes(team.teamId)) {
            return Response.json(
              { success: false, error: 'Path must contain your team ID' },
              { status: 403 }
            );
          }

          const body = request.body;
          if (!body) {
            return Response.json(
              { success: false, error: 'Request body is empty' },
              { status: 400 }
            );
          }

          // workerd's R2 binding rejects ReadableStreams without a known
          // length. The browser sends Content-Length (the body is a Blob),
          // but once `request.body` has been routed through TanStack Start
          // the length link is lost — so we re-establish it explicitly via
          // FixedLengthStream. See issue #738. Streaming (rather than
          // buffering) keeps the route within the 128MB Worker memory limit
          // for large exports.
          const contentLengthHeader = request.headers.get('content-length');
          const contentLength = contentLengthHeader
            ? Number.parseInt(contentLengthHeader, 10)
            : Number.NaN;

          if (!Number.isFinite(contentLength) || contentLength <= 0) {
            return Response.json(
              {
                success: false,
                error: 'Content-Length header required for upload',
              },
              { status: 411 }
            );
          }

          logger.info('[upload] validated; piping body → R2', {
            bucket: validBucket,
            path,
            contentLength,
          });

          const fixedLength = new FixedLengthStream(contentLength);
          // Count bytes in-transit via a pass-through transform so the tail can
          // show whether the body fully arrived (pipe resolves with
          // bytesPiped === contentLength) or stalled/errored partway — the
          // route previously swallowed the pipe outcome entirely, hiding the
          // cause of hangs.
          let bytesPiped = 0;
          const counter = new TransformStream<Uint8Array, Uint8Array>({
            transform(chunk, controller) {
              bytesPiped += chunk.byteLength;
              controller.enqueue(chunk);
            },
          });
          body
            .pipeThrough(counter)
            .pipeTo(fixedLength.writable)
            .then(() =>
              logger.info('[upload] body pipe complete', {
                path,
                bytesPiped,
                contentLength,
              })
            )
            .catch((err: unknown) =>
              logger.error('[upload] body pipe failed', {
                path,
                bytesPiped,
                contentLength,
                err: err instanceof Error ? err.message : String(err),
              })
            );

          logger.info('[upload] calling r2.put', { path, contentLength });
          // DEBUG: bound r2.put against a server-side timeout so a hung upload
          // still RETURNS a response. `wrangler tail` only flushes an
          // invocation's logs when the request completes, so a forever-pending
          // upload shows nothing in the tail — this 504 forces completion and
          // surfaces how far the body actually got (bytesPiped vs
          // contentLength). Remove once the root cause is fixed.
          const putPromise = uploadFile(
            validBucket,
            path,
            fixedLength.readable,
            {
              contentType,
            }
          );
          const TIMED_OUT = Symbol('timed-out');
          const race = await Promise.race([
            putPromise.then(() => 'ok' as const),
            new Promise<typeof TIMED_OUT>((resolve) =>
              setTimeout(() => resolve(TIMED_OUT), UPLOAD_PUT_TIMEOUT_MS)
            ),
          ]);
          if (race === TIMED_OUT) {
            // Avoid an unhandled rejection if the put later settles.
            void putPromise.catch(() => {});
            logger.error('[upload] r2.put TIMED OUT', {
              path,
              bytesPiped,
              contentLength,
              timeoutMs: UPLOAD_PUT_TIMEOUT_MS,
              durationMs: Date.now() - startedAt,
            });
            return Response.json(
              {
                success: false,
                error: 'upload timed out server-side',
                bytesPiped,
                contentLength,
              },
              { status: 504 }
            );
          }
          logger.info('[upload] r2.put complete', {
            path,
            bytesPiped,
            contentLength,
            durationMs: Date.now() - startedAt,
          });

          return Response.json({ success: true });
        } catch (error) {
          logger.error('[upload] handler failed', {
            durationMs: Date.now() - startedAt,
            err: error instanceof Error ? error.message : String(error),
          });
          const handledError = handleApiError(error);
          return Response.json(
            { success: false, error: handledError.toJSON() },
            { status: handledError.statusCode }
          );
        }
      },
    },
  },
});
