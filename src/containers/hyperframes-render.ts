/**
 * Worker-side Durable Object that fronts the Hyperframes render container.
 * Routes requests over the container's internal port and spins it down after idle.
 */

import { Container } from '@cloudflare/containers';

export class HyperframesRender extends Container {
  override defaultPort = 8080;
  override sleepAfter = '2m';
}
