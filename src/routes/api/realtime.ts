import { getEnv } from '#env';
import { createFileRoute } from '@tanstack/react-router';
import { authRequestMiddleware } from '@/functions/middleware';

/**
 * SSE subscription endpoint. One channel per request — the client opens one
 * `EventSource` per distinct channel (see `client.tsx`). The request is routed
 * to that channel's `RealtimeChannel` Durable Object, which holds the stream
 * open and fans out emitted events (#802).
 */
export const Route = createFileRoute('/api/realtime')({
  server: {
    middleware: [authRequestMiddleware],
    handlers: {
      GET: async ({ request }) => {
        const channel = new URL(request.url).searchParams.get('channel');
        if (!channel) {
          return new Response('missing channel', { status: 400 });
        }

        // getEnv()'s type is platform-dependent; the Cloudflare runtime
        // guarantees the Cloudflare.Env shape with the REALTIME binding.
        // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- platform-dependent env shape
        const namespace = (getEnv() as unknown as Cloudflare.Env).REALTIME;
        const stub = namespace.get(namespace.idFromName(channel));
        // Forward the original request (carries the abort signal so the DO can
        // detect client disconnect) but rewrite the URL to the DO's route.
        return stub.fetch(
          new Request(
            `https://realtime.do/subscribe?channel=${encodeURIComponent(channel)}`,
            request
          )
        );
      },
    },
  },
});
