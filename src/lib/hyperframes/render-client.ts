/**
 * Render client — calls the Hyperframes container via the HYPERFRAMES_RENDER
 * Durable Object binding. Private to the Worker; the container itself is not
 * publicly addressable.
 */

import { getEnv } from '#env';
import type { HyperframesRender } from '@/containers/hyperframes-render';
import type { Composition } from './compose';

export type RenderRequest = {
  compositionId: string;
  composition: Composition;
  /** Stable key used to route to a warm container (e.g. sequenceId). */
  routingKey: string;
  quality?: 'draft' | 'standard' | 'high';
};

export type RenderResult = {
  videoResponse: Response;
  elapsedMs: number | null;
};

/**
 * Extract the Hyperframes render binding from the ambient env.
 * `#env` resolves to `process.env` under Node/Bun (strings) and to
 * `cloudflare:workers` env (typed bindings) under workerd. We assert
 * the workerd shape at runtime before returning.
 */
function getHyperframesBinding():
  | DurableObjectNamespace<HyperframesRender>
  | undefined {
  const env: Record<string, unknown> = getEnv();
  const binding = env.HYPERFRAMES_RENDER;
  if (
    binding &&
    typeof binding === 'object' &&
    'idFromName' in binding &&
    'get' in binding
  ) {
    // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- runtime-narrowed above via `idFromName`/`get` presence checks
    return binding as DurableObjectNamespace<HyperframesRender>;
  }
  return undefined;
}

export async function renderComposition(
  request: RenderRequest
): Promise<RenderResult> {
  const binding = getHyperframesBinding();
  if (!binding) {
    throw new Error(
      'HYPERFRAMES_RENDER binding is not configured on this environment'
    );
  }

  const id = binding.idFromName(request.routingKey);
  const stub = binding.get(id);

  const response = await stub.fetch('http://container/render', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      compositionId: request.compositionId,
      html: request.composition.html,
      width: request.composition.width,
      height: request.composition.height,
      fps: request.composition.fps,
      durationMs: request.composition.durationMs,
      quality: request.quality ?? 'standard',
    }),
  });

  if (!response.ok) {
    const bodyText = await response.text().catch(() => '');
    throw new Error(
      `Hyperframes render failed (${response.status}): ${bodyText || response.statusText}`
    );
  }

  const elapsedHeader = response.headers.get('x-render-elapsed-ms');
  const elapsedMs = elapsedHeader ? Number(elapsedHeader) : null;

  return { videoResponse: response, elapsedMs };
}
