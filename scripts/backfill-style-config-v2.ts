/**
 * One-off backfill: rewrite every `styles.config` blob from the flat v1 shape to
 * the grouped v2 `StyleConfig` (look / motion / references). Issue #858.
 *
 * It is a pure column-data UPDATE — no DDL, no table rebuild — so it sidesteps
 * the D1 ON DELETE CASCADE trap documented in CLAUDE.md. Reuses the SAME
 * `migrateStyleConfigV1ToV2` converter the runtime read-tolerance and template
 * seed use, so there is one tested transformation path.
 *
 * Safe to re-run: rows already in v2 (`'look' in config`) are skipped. Every
 * mapped row is validated with the v2 schema BEFORE any write; if any row fails,
 * nothing is written (abort-loudly, no partial writes).
 *
 * Usage:
 *   bun scripts/backfill-style-config-v2.ts --local [--dry-run]
 *   bun scripts/backfill-style-config-v2.ts --test  [--dry-run]
 *   bun scripts/backfill-style-config-v2.ts --d1    [--dry-run]
 */
import { styles } from '@/lib/db/schema';
import {
  migrateStyleConfigV1ToV2,
  type StyleConfig,
  StyleConfigSchema,
} from '@/lib/style/style-config';
import { eq } from 'drizzle-orm';
import { createSeedDb, parseSeedTarget } from './seed-db-client';

const target = parseSeedTarget(process.argv.slice(2));
const dryRun = process.argv.includes('--dry-run');

function isV2(config: unknown): boolean {
  return typeof config === 'object' && config !== null && 'look' in config;
}

const { db, dispose } = await createSeedDb(target);

try {
  const rows = await db.select().from(styles);

  console.log(`🎨 Found ${rows.length} style rows`);

  const toMigrate: { id: string; name: string; config: StyleConfig }[] = [];
  let skipped = 0;
  const failures: { id: string; name: string; error: string }[] = [];

  for (const row of rows) {
    if (isV2(row.config)) {
      skipped++;
      continue;
    }
    try {
      // Validate the converted shape up front; collect (don't write yet).
      const v2 = StyleConfigSchema.parse(migrateStyleConfigV1ToV2(row.config));
      toMigrate.push({ id: row.id, name: row.name, config: v2 });
    } catch (error) {
      failures.push({
        id: row.id,
        name: row.name,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (failures.length > 0) {
    console.error(`\n❌ ${failures.length} row(s) failed v1→v2 conversion:`);
    for (const f of failures) {
      console.error(`  - ${f.name} (${f.id}): ${f.error}`);
    }
    console.error('\nAborting — no rows written.');
    process.exit(1);
  }

  console.log(
    `✅ ${toMigrate.length} to migrate, ${skipped} already v2${dryRun ? ' (dry run — no writes)' : ''}`
  );

  if (!dryRun) {
    for (const row of toMigrate) {
      await db
        .update(styles)
        .set({ config: row.config, updatedAt: new Date() })
        .where(eq(styles.id, row.id));
      console.log(`  ↑ ${row.name}`);
    }
    console.log(`\n✅ Migrated ${toMigrate.length} style row(s) to v2`);
  }
} finally {
  await dispose();
}
