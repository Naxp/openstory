/**
 * Render drizzle-kit's nested migrations into the flat layout wrangler needs.
 *
 * drizzle-kit emits `drizzle/migrations/<timestamp>_<name>/migration.sql`,
 * but `wrangler d1 migrations apply` only reads flat `*.sql` files in
 * `migrations_dir` — against the nested layout it silently finds zero files
 * (see scripts/migrate-local-d1.ts). This script writes each migration to
 * `drizzle/migrations-wrangler/<timestamp>_<name>.sql` (gitignored, rebuilt
 * from scratch on every run), so the nested directory stays the single
 * source of truth. Lexicographic filename order == chronological order,
 * which is the order wrangler applies and records them in `d1_migrations`.
 *
 * Run automatically by the `deploy` and `db:migrate:prd` package scripts.
 */

import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync } from 'fs';
import { join } from 'path';

const REPO_ROOT = join(import.meta.dirname, '..');
const SOURCE_DIR = join(REPO_ROOT, 'drizzle/migrations');
const TARGET_DIR = join(REPO_ROOT, 'drizzle/migrations-wrangler');

const migrationDirs = readdirSync(SOURCE_DIR, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && entry.name !== 'meta')
  .map((entry) => entry.name)
  .sort();

const missing = migrationDirs.filter(
  (dir) => !existsSync(join(SOURCE_DIR, dir, 'migration.sql'))
);
if (missing.length > 0) {
  throw new Error(
    `[flatten-migrations] migration folders without migration.sql: ${missing.join(', ')}`
  );
}

rmSync(TARGET_DIR, { recursive: true, force: true });
mkdirSync(TARGET_DIR, { recursive: true });

for (const dir of migrationDirs) {
  copyFileSync(
    join(SOURCE_DIR, dir, 'migration.sql'),
    join(TARGET_DIR, `${dir}.sql`)
  );
}

console.log(
  `[flatten-migrations] ${migrationDirs.length} migrations → drizzle/migrations-wrangler/`
);
