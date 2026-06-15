/**
 * Fork deploy: provision Cloudflare resources, then patch wrangler.jsonc.
 *
 * Runs in a fork's CI (see .github/workflows/fork-deploy.yml) before
 * `wrangler deploy`. A plain `wrangler deploy` does NOT auto-create D1/R2 the
 * way the Deploy-to-Cloudflare button does, and the default wrangler block
 * ships a placeholder D1 id (`dev-local-d1`) that only resolves to a local
 * Miniflare DB. So we:
 *
 *   1. Ensure a real D1 database exists and capture its id.
 *   2. Ensure the R2 buckets exist.
 *   3. Rewrite the default block's bindings to the real names + id.
 *
 * This mirrors how PR previews patch the config in deploy-cloudflare.yml.
 * Requires CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN in the environment.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import JSON5 from 'json5';
import { z } from 'zod';

const DB_NAME = 'openstory';
const PUBLIC_ASSETS_BUCKET = 'openstory-public-assets';
const STORAGE_BUCKET = 'openstory-storage';
const WRANGLER_PATH = 'wrangler.jsonc';

const accountId = required('CLOUDFLARE_ACCOUNT_ID');
const apiToken = required('CLOUDFLARE_API_TOKEN');
const API = `https://api.cloudflare.com/client/v4/accounts/${accountId}`;

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing required env var: ${name}`);
    process.exit(1);
  }
  return value;
}

function cf(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${API}${path}`, {
    method: init?.method,
    body: init?.body,
    headers: {
      Authorization: `Bearer ${apiToken}`,
      'Content-Type': 'application/json',
    },
  });
}

const d1ListSchema = z.object({
  result: z.array(z.object({ uuid: z.string(), name: z.string() })).nullish(),
});
const d1CreateSchema = z.object({
  success: z.boolean(),
  result: z.object({ uuid: z.string() }).nullish(),
  errors: z.unknown().optional(),
});
const errorsSchema = z.object({
  errors: z
    .array(
      z.object({ code: z.number().optional(), message: z.string().optional() })
    )
    .nullish(),
});

/** Find or create the D1 database, returning its uuid. */
async function ensureD1(): Promise<string> {
  const listRes = await cf(`/d1/database?name=${encodeURIComponent(DB_NAME)}`);
  const list = d1ListSchema.parse(await listRes.json());
  const existing = list.result?.find((d) => d.name === DB_NAME)?.uuid;
  if (existing) {
    console.log(`Found D1 database ${DB_NAME}: ${existing}`);
    return existing;
  }

  const createRes = await cf('/d1/database', {
    method: 'POST',
    body: JSON.stringify({ name: DB_NAME }),
  });
  const created = d1CreateSchema.parse(await createRes.json());
  if (!created.success || !created.result?.uuid) {
    console.error('Failed to create D1 database:', created.errors);
    process.exit(1);
  }
  console.log(`Created D1 database ${DB_NAME}: ${created.result.uuid}`);
  return created.result.uuid;
}

/** Create an R2 bucket, treating "already exists" as success. */
async function ensureBucket(name: string): Promise<void> {
  const res = await cf('/r2/buckets', {
    method: 'POST',
    body: JSON.stringify({ name }),
  });
  if (res.ok) {
    console.log(`Created R2 bucket ${name}`);
    return;
  }
  const body = errorsSchema
    .catch({ errors: [] })
    .parse(await res.json().catch(() => ({})));
  // 10004 = bucket already exists.
  const alreadyExists = body.errors?.some(
    (e) => e.code === 10004 || /exist/i.test(e.message ?? '')
  );
  if (alreadyExists) {
    console.log(`R2 bucket ${name} already exists`);
    return;
  }
  console.error(`Failed to create R2 bucket ${name}:`, body.errors);
  process.exit(1);
}

/** Rewrite the default wrangler block to use the provisioned resources. */
function patchWranglerConfig(databaseId: string): void {
  const raw = readFileSync(WRANGLER_PATH, 'utf8');
  const config: Record<string, unknown> = JSON5.parse(raw);

  config.d1_databases = [
    {
      binding: 'DB',
      database_name: DB_NAME,
      database_id: databaseId,
      migrations_dir: 'drizzle/migrations-wrangler',
    },
  ];
  config.r2_buckets = [
    { bucket_name: PUBLIC_ASSETS_BUCKET, binding: 'R2_PUBLIC_ASSETS_BUCKET' },
    { binding: 'R2_STORAGE_BUCKET', bucket_name: STORAGE_BUCKET },
  ];

  writeFileSync(WRANGLER_PATH, JSON.stringify(config, null, 2));
  console.log(`Patched ${WRANGLER_PATH} (D1 id ${databaseId})`);
}

const databaseId = await ensureD1();
await ensureBucket(PUBLIC_ASSETS_BUCKET);
await ensureBucket(STORAGE_BUCKET);
patchWranglerConfig(databaseId);
