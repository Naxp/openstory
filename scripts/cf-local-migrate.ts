/**
 * Apply Drizzle migrations to the wrangler-local D1 emulator's SQLite file.
 *
 * The Cloudflare Vite plugin (via miniflare) stores its D1 emulator at
 * `.wrangler/state/v3/d1/miniflare-D1DatabaseObject/<hash>.sqlite`. The hash
 * is derived from the binding/database id, but we don't need to know it —
 * there's only one D1 binding (`DB`) in this project, so we glob for the
 * single .sqlite file. If none exists yet (first cf:dev run), we create the
 * directory + an empty .sqlite file with a deterministic name so miniflare
 * picks it up on startup.
 *
 * Then we use drizzle-orm's libsql migrator to apply every pending migration
 * — the same code path drizzle-kit uses internally, just pointed at the
 * wrangler-local file instead of `local.db`.
 */

import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { migrate } from 'drizzle-orm/libsql/migrator';

const D1_DIR = '.wrangler/state/v3/d1/miniflare-D1DatabaseObject';
const BOOTSTRAP_NAME = 'DB.sqlite';
// miniflare keeps its own bookkeeping sqlite alongside the per-binding DB —
// it's a fixed name, not a hash, so we exclude it from the database scan.
const IGNORED_SQLITE = new Set(['metadata.sqlite']);

function resolveD1Path(): string {
  if (!existsSync(D1_DIR)) {
    mkdirSync(D1_DIR, { recursive: true });
  }
  const sqliteFiles = readdirSync(D1_DIR).filter(
    (f) => f.endsWith('.sqlite') && !IGNORED_SQLITE.has(f)
  );
  if (sqliteFiles.length > 1) {
    throw new Error(
      `[cf-local-migrate] Found multiple D1 sqlite files in ${D1_DIR}: ${sqliteFiles.join(
        ', '
      )} — this script assumes a single 'DB' binding. Delete the stale files or extend this script.`
    );
  }
  const sole = sqliteFiles[0];
  if (sole) {
    return join(D1_DIR, sole);
  }
  // First run — bootstrap an empty file so miniflare opens it instead of
  // creating a new one with a different hash next time `bun cf:dev` starts.
  const bootstrap = join(D1_DIR, BOOTSTRAP_NAME);
  writeFileSync(bootstrap, '');
  console.log(`[cf-local-migrate] Bootstrapped empty D1 at ${bootstrap}`);
  return bootstrap;
}

async function main() {
  const dbPath = resolveD1Path();
  console.log(`[cf-local-migrate] Applying migrations to ${dbPath}`);

  const client = createClient({ url: `file:${dbPath}` });
  const db = drizzle({ client });

  await migrate(db, { migrationsFolder: './drizzle/migrations' });

  console.log('[cf-local-migrate] ✅ Migrations applied');
  client.close();
}

main().catch((error) => {
  console.error('[cf-local-migrate] failed:', error);
  process.exit(1);
});
