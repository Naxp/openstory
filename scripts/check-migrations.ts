#!/usr/bin/env bun
/**
 * Migration safety check.
 *
 * Flags destructive SQL in drizzle migrations. The standard SQLite
 * "table rebuild" pattern (DROP X -> INSERT SELECT -> RENAME __new_X) is
 * structurally unsafe on Cloudflare D1 and Turso libSQL because their HTTP
 * /query endpoints wrap multi-statement bodies in an implicit transaction,
 * inside which `PRAGMA foreign_keys=OFF` is silently ignored — so any
 * inbound `ON DELETE CASCADE` fires when the parent table is dropped.
 *
 * See GitHub issue #612 for the verified mechanism and the production
 * incident on 2026-04-29.
 *
 * Modes:
 *   bun scripts/check-migrations.ts                       Local pre-migrate
 *                                                         gate against pending
 *                                                         migrations.
 *   bun scripts/check-migrations.ts --allow-destructive   Bypass for local.
 *   bun scripts/check-migrations.ts --all                 Scan all, not just
 *                                                         pending.
 *   bun scripts/check-migrations.ts --ci                  Scan all, emit
 *                                                         SARIF, exit 1 on
 *                                                         findings, no prose.
 *   bun scripts/check-migrations.ts --sarif-out=<path>    Write SARIF to path
 *                                                         (used with --ci).
 *
 * Exit codes:
 *   0 — no findings
 *   1 — findings found and not bypassed
 */

import { existsSync, readFileSync, readdirSync, writeFileSync } from 'fs';
import { basename, join } from 'path';

const REPO_ROOT = join(import.meta.dir, '..');
const MIGRATIONS_DIR = join(REPO_ROOT, 'drizzle/migrations');
const JOURNAL_PATH = join(MIGRATIONS_DIR, 'meta/_journal.json');
const SCHEMA_DIR = join(REPO_ROOT, 'src/lib/db/schema');
const MANUAL_APPLY_HINT =
  'Apply manually via `wrangler d1` after exporting a snapshot, then dismiss this alert. See issue #612.';

type DestructiveOperation = {
  file: string;
  line: number;
  operation: string;
  statement: string;
  table: string;
  cascadeChildCount: number;
};

type Journal = {
  entries: Array<{ idx: number; tag: string }>;
};

const DESTRUCTIVE_PATTERNS = [
  {
    pattern: /DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?`?([^`\s;]+)`?/gi,
    name: 'DROP TABLE',
  },
  {
    pattern: /TRUNCATE\s+(?:TABLE\s+)?`?([^`\s;]+)`?/gi,
    name: 'TRUNCATE',
  },
  {
    pattern: /DELETE\s+FROM\s+`?([^`\s;]+)`?\s*(?:;|$)/gi,
    name: 'DELETE ALL',
  },
  {
    pattern: /ALTER\s+TABLE\s+`?([^`\s;]+)`?\s+DROP\s+COLUMN/gi,
    name: 'DROP COLUMN',
  },
] as const;

function getAppliedMigrations(): Set<string> {
  if (!existsSync(JOURNAL_PATH)) return new Set();
  const journal: Journal = JSON.parse(readFileSync(JOURNAL_PATH, 'utf-8'));
  return new Set(journal.entries.map((e) => `${e.tag}.sql`));
}

/**
 * Build a map of parent table -> number of inbound CASCADE FKs by scanning
 * the Drizzle schema. Used to escalate DROP TABLE findings against
 * cascade-heavy parents to SARIF "error" level. Best-effort regex parser:
 * if a schema file uses an unusual definition style it just won't contribute,
 * which only loses precision — every DROP TABLE is still flagged.
 */
function buildCascadeMap(): Map<string, number> {
  const cascadesByParent = new Map<string, number>();
  if (!existsSync(SCHEMA_DIR)) return cascadesByParent;

  const files = readdirSync(SCHEMA_DIR).filter((f) => f.endsWith('.ts'));

  // Pass 1: variable name -> SQL table name
  const varToTable = new Map<string, string>();
  for (const f of files) {
    const content = readFileSync(join(SCHEMA_DIR, f), 'utf-8');
    const re =
      /export\s+const\s+(\w+)\s*=\s*sqliteTable\s*\(\s*['"]([^'"]+)['"]/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(content)) !== null) {
      varToTable.set(m[1], m[2]);
    }
  }

  // Pass 2: count cascade FKs per parent
  for (const f of files) {
    const content = readFileSync(join(SCHEMA_DIR, f), 'utf-8');
    // Matches: .references(() => parentVar.id, { onDelete: 'cascade' })
    // Tolerates whitespace/newlines between the arrow and onDelete.
    const re =
      /references\s*\(\s*\(\s*\)\s*=>\s*(\w+)\.\w+\s*,\s*\{[^}]*onDelete\s*:\s*['"]cascade['"]/gs;
    let m: RegExpExecArray | null;
    while ((m = re.exec(content)) !== null) {
      const parentTable = varToTable.get(m[1]);
      if (!parentTable) continue;
      cascadesByParent.set(
        parentTable,
        (cascadesByParent.get(parentTable) ?? 0) + 1
      );
    }
  }

  return cascadesByParent;
}

function findDestructiveOperations(
  filePath: string,
  cascadesByParent: Map<string, number>
): DestructiveOperation[] {
  const content = readFileSync(filePath, 'utf-8');
  const fileName = basename(filePath);
  const lines = content.split('\n');
  const operations: DestructiveOperation[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const { pattern, name } of DESTRUCTIVE_PATTERNS) {
      pattern.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(line)) !== null) {
        const table = match[1].replace(/[`"[\]]/g, '');
        // Ignore the staging tables drizzle creates during a rebuild — they
        // are intra-migration scratch space, not the real concern.
        if (table.startsWith('__new_')) continue;
        operations.push({
          file: fileName,
          line: i + 1,
          operation: name,
          statement: line.trim().slice(0, 120),
          table,
          cascadeChildCount: cascadesByParent.get(table) ?? 0,
        });
      }
    }
  }

  return operations;
}

type SarifResult = {
  ruleId: string;
  level: 'warning' | 'error';
  message: { text: string };
  locations: Array<{
    physicalLocation: {
      artifactLocation: { uri: string };
      region: { startLine: number };
    };
  }>;
  partialFingerprints: { migrationTag: string };
};

function sarifFor(
  ops: Array<DestructiveOperation & { migrationDir: string }>
): unknown {
  const results: SarifResult[] = ops.map((op) => {
    const isDropTable = op.operation === 'DROP TABLE';
    const cascading = isDropTable && op.cascadeChildCount > 0;
    const level: 'warning' | 'error' = cascading ? 'error' : 'warning';
    const cascadeNote = cascading
      ? ` Schema has ${op.cascadeChildCount} inbound ON DELETE CASCADE FK${op.cascadeChildCount === 1 ? '' : 's'} pointing at this table; on D1/Turso these will fire and delete child rows.`
      : '';
    return {
      ruleId: 'D1_DESTRUCTIVE_TABLE_REBUILD',
      level,
      message: {
        text: `${op.operation} on \`${op.table}\` is unsafe on Cloudflare D1 and Turso libSQL: drizzle-kit's HTTP migrator joins all statements into one body which gets wrapped in an implicit transaction, inside which PRAGMA foreign_keys=OFF is silently ignored.${cascadeNote} ${MANUAL_APPLY_HINT}`,
      },
      locations: [
        {
          physicalLocation: {
            artifactLocation: {
              uri: `drizzle/migrations/${op.migrationDir}/${op.file}`,
            },
            region: { startLine: op.line },
          },
        },
      ],
      partialFingerprints: { migrationTag: op.migrationDir },
    };
  });

  return {
    version: '2.1.0',
    $schema:
      'https://raw.githubusercontent.com/oasis-tcs/sarif-spec/master/Schemata/sarif-schema-2.1.0.json',
    runs: [
      {
        tool: {
          driver: {
            name: 'openstory-migration-safety',
            informationUri:
              'https://github.com/openstory-so/openstory/issues/612',
            rules: [
              {
                id: 'D1_DESTRUCTIVE_TABLE_REBUILD',
                name: 'D1DestructiveTableRebuild',
                shortDescription: {
                  text: 'Destructive SQL is unsafe on D1/Turso HTTP migrator',
                },
                fullDescription: {
                  text: 'drizzle-kit emits the SQLite table-rebuild pattern (DROP TABLE -> INSERT SELECT -> RENAME) for many schema changes, and posts all statements in one HTTP body. D1 and Turso wrap multi-statement bodies in an implicit transaction; SQLite silently ignores PRAGMA foreign_keys=OFF inside a transaction; ON DELETE CASCADE fires on the implicit per-row deletes that DROP TABLE performs. Verified in production on 2026-04-29.',
                },
                helpUri: 'https://github.com/openstory-so/openstory/issues/612',
                defaultConfiguration: { level: 'warning' },
              },
            ],
          },
        },
        results,
      },
    ],
  };
}

function listSqlFiles(dir: string, all: boolean): string[] {
  if (!existsSync(dir)) return [];
  const top = readdirSync(dir).filter((f) => f.endsWith('.sql'));
  const fromDirs: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const inner = join(dir, entry.name, 'migration.sql');
    if (existsSync(inner)) fromDirs.push(`${entry.name}/migration.sql`);
  }
  const all_ = [...top, ...fromDirs];
  if (all) return all_;
  const applied = getAppliedMigrations();
  if (applied.size === 0) return all_;
  return all_.filter(
    (f) => !applied.has(f) && !applied.has(f.split('/').pop() ?? f)
  );
}

function main(): void {
  const args = process.argv.slice(2);
  const ci = args.includes('--ci');
  const allowDestructive = args.includes('--allow-destructive');
  const checkAll = args.includes('--all') || ci;
  const sarifOut = args
    .find((a) => a.startsWith('--sarif-out='))
    ?.slice('--sarif-out='.length);

  const cascadesByParent = buildCascadeMap();
  const migrations = listSqlFiles(MIGRATIONS_DIR, checkAll);

  type Op = DestructiveOperation & { migrationDir: string };
  const allOps: Op[] = [];
  for (const m of migrations) {
    const filePath = join(MIGRATIONS_DIR, m);
    const dir = m.includes('/') ? m.split('/')[0] : m.replace(/\.sql$/, '');
    const ops = findDestructiveOperations(filePath, cascadesByParent);
    for (const op of ops) allOps.push({ ...op, migrationDir: dir });
  }

  if (sarifOut) {
    writeFileSync(sarifOut, JSON.stringify(sarifFor(allOps), null, 2));
  }

  if (ci) {
    if (allOps.length === 0) {
      console.log('No destructive operations detected.');
      process.exit(0);
    }
    const errors = allOps.filter(
      (op) => op.operation === 'DROP TABLE' && op.cascadeChildCount > 0
    );
    const warnings = allOps.length - errors.length;
    console.log(
      `Found ${allOps.length} destructive operation(s): ${errors.length} error, ${warnings} warning.`
    );
    for (const op of allOps) {
      const tag =
        op.operation === 'DROP TABLE' && op.cascadeChildCount > 0
          ? 'ERROR'
          : 'WARN';
      const cascade =
        op.cascadeChildCount > 0
          ? ` (${op.cascadeChildCount} cascade child FK${op.cascadeChildCount === 1 ? '' : 's'})`
          : '';
      console.log(
        `  [${tag}] ${op.migrationDir}/${op.file}:${op.line} ${op.operation} \`${op.table}\`${cascade}`
      );
    }
    process.exit(1);
  }

  // Local interactive mode
  console.log('Checking migrations for destructive operations…\n');
  if (migrations.length === 0) {
    console.log('No pending migrations.');
    process.exit(0);
  }
  if (allOps.length === 0) {
    console.log('No destructive operations found.');
    process.exit(0);
  }
  console.log('DESTRUCTIVE OPERATIONS DETECTED:\n');
  for (const op of allOps) {
    const cascade =
      op.operation === 'DROP TABLE' && op.cascadeChildCount > 0
        ? ` ⚠ ${op.cascadeChildCount} cascade child FK(s)`
        : '';
    console.log(
      `  ${op.migrationDir}/${op.file}:${op.line} — ${op.operation} \`${op.table}\`${cascade}`
    );
    console.log(`    ${op.statement}`);
  }
  console.log('');
  console.log(
    'These are unsafe on D1/Turso HTTP migrators (issue #612). Either:'
  );
  console.log('  1. Refactor the schema change to use ALTER TABLE column ops,');
  console.log('  2. Apply manually via `wrangler d1` after a snapshot,');
  console.log(
    '  3. Or pass --allow-destructive if you know what you are doing.'
  );

  if (allowDestructive) {
    console.log('\n--allow-destructive set; proceeding.');
    process.exit(0);
  }
  process.exit(1);
}

main();
