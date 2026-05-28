/**
 * Test Database Client for E2E Tests
 *
 * Uses wrangler's `getPlatformProxy()` so fixtures read/write the same
 * Miniflare-backed local D1 that the worker (running under cf-plugin) sees.
 * No more separate `file:test.db` libsql connection — schema is applied via
 * `scripts/migrate-local-d1.ts --test` against `wrangler.jsonc` [env.test].
 *
 * Top-level await runs once per process at module load. Fixtures don't need
 * to remember to await an init promise.
 */

import { drizzle } from 'drizzle-orm/d1';
import { getPlatformProxy } from 'wrangler';
import { relations } from '@/lib/db/schema/relations';

// remoteBindings: false — fixtures only touch local D1; R2 traffic happens
// through the worker (storage-cloudflare.ts → r2-mock sidecar), not via this
// proxy. Avoiding the remote-proxy session means no CLOUDFLARE_API_TOKEN is
// needed in the playwright process.
const proxy = await getPlatformProxy<{ DB?: D1Database }>({
  environment: 'test',
  remoteBindings: false,
});

const d1 = proxy.env.DB;
if (!d1) {
  throw new Error(
    "[e2e/db-client] D1 binding 'DB' missing from wrangler.jsonc [env.test]"
  );
}

export const testDb = drizzle(d1, { relations });

/**
 * No-op kept for backwards compatibility with callers that used to await an
 * init promise. The top-level await above already ran by the time anything
 * imports `ensureDbInit`.
 */
export const ensureDbInit = (): Promise<void> => Promise.resolve();
