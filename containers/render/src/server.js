// Hyperframes render container entrypoint.
// Reachable only via the HYPERFRAMES_RENDER Durable Object binding in the Worker.
// Accepts composition HTML + output spec, renders MP4 with @hyperframes/producer,
// and streams the MP4 back as the response body.

import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { createRenderJob, executeRenderJob } from '@hyperframes/producer';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';

const renderRequestSchema = z.object({
  compositionId: z.string().min(1).max(128),
  html: z.string().min(1),
  width: z.number().int().min(64).max(4096),
  height: z.number().int().min(64).max(4096),
  fps: z.number().int().min(1).max(60).default(30),
  durationMs: z
    .number()
    .int()
    .min(100)
    .max(5 * 60 * 1000),
  quality: z.enum(['draft', 'standard', 'high']).default('standard'),
});

const app = new Hono();

app.get('/health', (c) => c.json({ ok: true }));

app.post('/render', async (c) => {
  let parsed;
  try {
    parsed = renderRequestSchema.parse(await c.req.json());
  } catch (err) {
    return c.json(
      { error: 'Invalid render request', details: err.errors ?? String(err) },
      400
    );
  }

  const workDir = await mkdtemp(join(tmpdir(), 'hyperframes-'));
  const inputPath = join(workDir, `${parsed.compositionId}.html`);
  const outputPath = join(workDir, `${parsed.compositionId}.mp4`);

  try {
    await writeFile(inputPath, parsed.html, 'utf8');

    const job = createRenderJob({
      inputPath,
      outputPath,
      width: parsed.width,
      height: parsed.height,
      fps: parsed.fps,
      quality: parsed.quality,
    });

    const started = Date.now();
    const result = await executeRenderJob(job, (progress) => {
      if (progress?.percent !== undefined) {
        // Structured log line the Worker can scrape via Container stdout.
        console.log(
          JSON.stringify({
            evt: 'render.progress',
            compositionId: parsed.compositionId,
            percent: progress.percent,
          })
        );
      }
    });

    const mp4 = await readFile(result.outputPath);
    const elapsedMs = Date.now() - started;

    return new Response(mp4, {
      status: 200,
      headers: {
        'content-type': 'video/mp4',
        'content-length': String(mp4.byteLength),
        'x-render-composition-id': parsed.compositionId,
        'x-render-duration-ms': String(parsed.durationMs),
        'x-render-elapsed-ms': String(elapsedMs),
      },
    });
  } catch (err) {
    console.error('[hyperframes-render] render failed', err);
    return c.json(
      {
        error: 'Render failed',
        message: err instanceof Error ? err.message : String(err),
        compositionId: parsed.compositionId,
      },
      500
    );
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
});

const port = Number(process.env.PORT ?? 8080);
serve({ fetch: app.fetch, port }, ({ port }) => {
  console.log(`[hyperframes-render] listening on :${port}`);
});
