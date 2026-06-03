/**
 * GET /api/v1/sequences/$id — sequence status.
 *
 * Returns the shared state document (overall status, per-frame image/video
 * status + URLs, music, poster, counts) derived from the DB. Team-scoped via
 * the API key's owner, so a key can only read its own team's sequences.
 */

import { authWithTeamRequestMiddleware } from '@/functions/middleware';
import { runApiV1Handler } from '@/lib/api-v1/errors';
import { buildSequenceState } from '@/lib/api-v1/state';
import { NotFoundError } from '@/lib/errors';
import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/api/v1/sequences/$id')({
  server: {
    middleware: [authWithTeamRequestMiddleware],
    handlers: {
      GET: async ({ params, context }) =>
        runApiV1Handler(async () => {
          const sequence = await context.scopedDb.sequences.getById(params.id);
          if (!sequence) {
            throw new NotFoundError('Sequence not found');
          }
          const state = await buildSequenceState(context.scopedDb, sequence);
          return Response.json(state);
        }),
    },
  },
});
