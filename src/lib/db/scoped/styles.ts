/**
 * Scoped Styles Sub-module
 * Team-scoped style library CRUD (includes public styles in listing).
 */

import type { Database } from '@/lib/db/client';
import type { NewStyle, Style } from '@/lib/db/schema';
import { styles } from '@/lib/db/schema';
import { ValidationError } from '@/lib/errors';
import { styleSlug } from '@/lib/style/style-slug';
import { and, asc, desc, eq, ne, or, sql } from 'drizzle-orm';

import { getLogger } from '@/lib/observability/logger';

const logger = getLogger(['openstory', 'db', 'styles']);

type StylesListOptions = {
  orderBy?: 'popular' | 'sortOrder';
};

/**
 * A style's URL/asset slug is derived from its name (`styleSlug`) and is the key
 * the `?style=<slug>` composer prefill (and every style asset path) resolves on.
 * A team only ever sees its own styles plus public ones, so the slug must be
 * unique within that union — otherwise a slug would be ambiguous for that
 * account. Enforced here (no DB constraint can express "unique across this team
 * ∪ all public") on create + rename. `excludeId` skips the row being renamed.
 *
 * This guards against the future where teams can author styles; public styles
 * are seeded with already-unique names.
 */
async function assertSlugAvailable(
  db: Database,
  teamId: string,
  name: string,
  excludeId?: string
): Promise<void> {
  const slug = styleSlug(name);
  const visible = await db
    .select({ id: styles.id, name: styles.name })
    .from(styles)
    .where(
      and(
        or(eq(styles.teamId, teamId), eq(styles.isPublic, true)),
        excludeId ? ne(styles.id, excludeId) : undefined
      )
    );
  const clash = visible.find((s) => styleSlug(s.name) === slug);
  if (clash) {
    throw new ValidationError(
      `A style named “${clash.name}” already exists, which would share the URL slug “${slug}”. Choose a more distinct name.`,
      { slug, conflictsWith: clash.name }
    );
  }
}

function createStylesReadMethods(db: Database, teamId: string) {
  return {
    list: async (options: StylesListOptions = {}): Promise<Style[]> => {
      const orderBy = options.orderBy ?? 'sortOrder';
      const order =
        orderBy === 'popular'
          ? [desc(styles.usageCount), asc(styles.name)]
          : [asc(styles.sortOrder), asc(styles.name)];
      return await db
        .select()
        .from(styles)
        .where(or(eq(styles.teamId, teamId), eq(styles.isPublic, true)))
        .orderBy(...order);
    },

    getById: async (styleId: string): Promise<Style | null> => {
      const result = await db
        .select()
        .from(styles)
        .where(eq(styles.id, styleId))
        .limit(1);
      return result[0] ?? null;
    },
  };
}

/**
 * Public (anonymous) styles reads. Takes no team scope at all, so this code
 * path cannot express a team-scoped query — the isPublic filter is the entire
 * data boundary for the unauthenticated style-catalogue endpoint.
 */
export function createPublicStylesReadMethods(db: Database) {
  return {
    list: async (): Promise<Style[]> => {
      return await db
        .select()
        .from(styles)
        .where(eq(styles.isPublic, true))
        .orderBy(asc(styles.sortOrder), asc(styles.name));
    },
  };
}

export function createStylesMethods(
  db: Database,
  teamId: string,
  userId: string
) {
  return {
    ...createStylesReadMethods(db, teamId),

    create: async (
      data: Omit<NewStyle, 'teamId' | 'createdBy'>
    ): Promise<Style> => {
      await assertSlugAvailable(db, teamId, data.name);
      const result = await db
        .insert(styles)
        .values({ ...data, teamId, createdBy: userId })
        .returning();
      const style = result[0];
      if (!style) {
        throw new Error(`Failed to create Style for team ${teamId}`);
      }
      return style;
    },

    update: async (
      styleId: string,
      data: Partial<Omit<Style, 'id' | 'teamId' | 'createdAt' | 'createdBy'>>
    ): Promise<Style | undefined> => {
      if (data.name !== undefined) {
        await assertSlugAvailable(db, teamId, data.name, styleId);
      }
      const result = await db
        .update(styles)
        .set(data)
        .where(and(eq(styles.id, styleId), eq(styles.teamId, teamId)))
        .returning();
      return Array.isArray(result) ? result[0] : undefined;
    },

    delete: async (styleId: string): Promise<void> => {
      await db
        .delete(styles)
        .where(and(eq(styles.id, styleId), eq(styles.teamId, teamId)));
    },

    incrementUsage: async (styleId: string): Promise<void> => {
      const rows = await db
        .update(styles)
        .set({ usageCount: sql`${styles.usageCount} + 1` })
        .where(eq(styles.id, styleId))
        .returning({ id: styles.id });
      if (rows.length === 0) {
        logger.warn('incrementUsage matched zero rows', { styleId });
      }
    },
  };
}
