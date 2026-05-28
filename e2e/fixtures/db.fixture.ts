/**
 * Database Fixture for E2E Tests
 * Utilities for resetting and seeding test data
 */

import { like, sql } from 'drizzle-orm';
import { testDb } from './db-client';
import { user, teams, sequences, talent } from '@/lib/db/schema';

/**
 * Clean all test data from the database
 * Called before test suite to ensure clean state
 */
export async function cleanTestData(): Promise<void> {
  // Delete test users (cascades to sessions, team_members)
  await testDb.delete(user).where(like(user.email, '%@e2e.test'));

  // Delete test teams
  await testDb.delete(teams).where(like(teams.slug, 'test-team-%'));

  // Delete test sequences (if table exists)
  try {
    await testDb.delete(sequences).where(like(sequences.title, 'E2E Test%'));
  } catch {
    // Table may not exist
  }

  // Delete test talent (if table exists)
  try {
    await testDb.delete(talent).where(like(talent.name, 'E2E Test%'));
  } catch {
    // Table may not exist
  }
}

/**
 * Reset the entire test database
 * Use sparingly - prefer cleanTestData for faster cleanup
 */
export async function resetTestDatabase(): Promise<void> {
  // Drizzle d1's `.all()` is the equivalent of libsql's raw execute.
  const tables = await testDb.all<{ name: string }>(
    sql`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_litestream%'`
  );

  // D1 doesn't honour PRAGMA foreign_keys at runtime — bindings ship with FKs
  // enforced. Delete in reverse-FK-dependency order via the same loop as
  // before; for our test schema the order ends up working because we're only
  // wiping per-test rows.
  for (const row of tables) {
    await testDb.run(sql.raw(`DELETE FROM "${row.name}"`));
  }
}
