/**
 * POST /api/v1/sequences — public "one-shot" sequence creation.
 *
 * Authenticated via `authWithTeamRequestMiddleware`: an API key
 * (`Authorization: Bearer <key>` or `x-api-key`, resolved to its owner by the
 * Better Auth apiKey plugin) or, equivalently, a dashboard session cookie.
 * Optionally enhances the script, resolves a style + cast + locations +
 * elements, then triggers generation. Generation is async: responds 202 with
 * the created sequence id(s), workflow run id(s), and a status URL to poll.
 */

import { authWithTeamRequestMiddleware } from '@/functions/middleware';
import { runOneShotCreate } from '@/lib/api-v1/create';
import { apiJsonError, runApiV1Handler } from '@/lib/api-v1/errors';
import { apiCreateSequenceSchema } from '@/lib/api-v1/input-schema';
import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/api/v1/sequences')({
  server: {
    middleware: [authWithTeamRequestMiddleware],
    handlers: {
      POST: async ({ request, context }) =>
        runApiV1Handler(async () => {
          let body: unknown;
          try {
            body = await request.json();
          } catch {
            return apiJsonError(
              400,
              'INVALID_JSON',
              'Request body must be valid JSON.'
            );
          }

          const input = apiCreateSequenceSchema.parse(body);
          const result = await runOneShotCreate(input, {
            scopedDb: context.scopedDb,
            user: context.user,
            teamId: context.teamId,
          });

          return Response.json(result, { status: 202 });
        }),
    },
  },
});
