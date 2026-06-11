/**
 * Zero-touch local env bootstrap — runs as the first step of `bun dev` so
 * `bun install && bun dev` works with no manual setup.
 *
 * Everything beyond the generated minimum (AI keys, OAuth, Stripe, …) is
 * optional — `bun setup` prompts for the AI keys, and .env.example documents
 * the rest.
 */

import { ensureLocalEnv } from './env-file';

const added = ensureLocalEnv();
if (added.length > 0) {
  console.log(`[ensure-env] .env.local: added ${added.join(', ')}`);
}
