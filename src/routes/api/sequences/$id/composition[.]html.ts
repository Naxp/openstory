import { authWithTeamRequestMiddleware } from '@/functions/middleware';
import { buildSequenceComposition } from '@/components/theatre/sequence-composition';
import {
  DEFAULT_ASPECT_RATIO,
  aspectRatioSchema,
} from '@/lib/constants/aspect-ratios';
import { ulidSchema } from '@/lib/schemas/id.schemas';
import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/api/sequences/$id/composition.html')({
  server: {
    middleware: [authWithTeamRequestMiddleware],
    handlers: {
      GET: async ({ params, context }) => {
        const idParse = ulidSchema.safeParse(params.id);
        if (!idParse.success) {
          return new Response('Invalid sequence id', { status: 400 });
        }

        const data = await context.scopedDb.sequences.getWithFrames(
          idParse.data
        );
        if (!data) {
          return new Response('Sequence not found', { status: 404 });
        }

        const aspectRatioParse = aspectRatioSchema.safeParse(data.aspectRatio);
        const aspectRatio = aspectRatioParse.success
          ? aspectRatioParse.data
          : DEFAULT_ASPECT_RATIO;

        const { html } = buildSequenceComposition({
          sequenceId: data.id,
          frames: data.frames,
          musicUrl: data.musicUrl,
          aspectRatio,
        });

        if (!html) {
          return new Response('No playable frames', { status: 404 });
        }

        return new Response(html, {
          status: 200,
          headers: {
            'Content-Type': 'text/html; charset=utf-8',
            // The src URL carries an FNV-1a fingerprint over the playable
            // composition; identical URL ⇒ identical content. Treat it as
            // immutable so revisits hit the disk cache rather than the route.
            'Cache-Control': 'private, max-age=31536000, immutable',
          },
        });
      },
    },
  },
});
