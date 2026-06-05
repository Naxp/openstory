/**
 * POST /api/v1/sequences — public "one-shot" sequence creation.
 *
 * Authenticated via `authWithTeamRequestMiddleware`: an API key
 * (`Authorization: Bearer <key>` or `x-api-key`, resolved to its owner by the
 * Better Auth apiKey plugin) or, equivalently, a dashboard session cookie.
 * Optionally enhances the script, resolves a style + cast + locations +
 * elements, then triggers generation. Generation is async: responds 202 with
 * the created sequence id(s), workflow run id(s), a status URL to poll, and a
 * HAL `_links` catalog of next actions.
 *
 * Pass `?wait=60s` to additionally block until each new sequence shows its first
 * progress (or a terminal state) and embed that snapshot in the response — handy
 * for agents that have no sleep tool of their own.
 */

import { authWithTeamRequestMiddleware } from '@/functions/middleware';
import { runOneShotCreate } from '@/lib/api-v1/create';
import { apiJsonError, runApiV1Handler } from '@/lib/api-v1/errors';
import { apiCreateSequenceSchema } from '@/lib/api-v1/input-schema';
import {
  buildSequenceState,
  isTerminalSequenceState,
  sequenceStateCursor,
  withSequenceStateLinks,
} from '@/lib/api-v1/state';
import { getWaitMs, longPoll } from '@/lib/api-v1/wait';
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

          // When `?wait` is set, share the create deadline across all new
          // sequences and embed the first progress snapshot of each.
          const waitMs = getWaitMs(request);
          if (waitMs > 0) {
            const sequences = await Promise.all(
              result.sequences.map(async (entry) => {
                const { value } = await longPoll({
                  waitMs,
                  signal: request.signal,
                  load: async () => {
                    const sequence = await context.scopedDb.sequences.getById(
                      entry.id
                    );
                    // The row was just created in this request; treat a
                    // (theoretical) miss as "no snapshot yet" rather than 404.
                    return sequence
                      ? await buildSequenceState(context.scopedDb, sequence)
                      : null;
                  },
                  cursor: (state) => (state ? sequenceStateCursor(state) : ''),
                  done: (state) => !!state && isTerminalSequenceState(state),
                });
                return {
                  ...entry,
                  state: value ? withSequenceStateLinks(value) : null,
                };
              })
            );
            return Response.json({ ...result, sequences }, { status: 202 });
          }

          return Response.json(result, { status: 202 });
        }),
    },
  },
});
