/**
 * Cloudflare Worker entrypoint.
 * Wraps the TanStack Start default handler and re-exports Durable Object
 * classes the Worker runtime needs to instantiate (e.g. HyperframesRender).
 */

import {
  createStartHandler,
  defaultStreamHandler,
} from '@tanstack/react-start/server';

export { HyperframesRender } from './containers/hyperframes-render';

const fetch = createStartHandler(defaultStreamHandler);

export default { fetch };
