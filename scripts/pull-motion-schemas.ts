/**
 * Fetch OpenAPI specs for motion (image-to-video) models from fal.ai
 *
 * Downloads per-endpoint OpenAPI specs for each model in IMAGE_TO_VIDEO_MODELS,
 * saves them as json/fal.models.motion.json in the format expected by
 * @hey-api/openapi-ts, then runs codegen to generate types + Zod schemas.
 *
 * Usage: bun scripts/pull-motion-schemas.ts
 */

import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { IMAGE_TO_VIDEO_MODELS } from '@/lib/ai/models';

function runCommand(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { stdio: 'inherit' });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} ${args.join(' ')} exited with ${code}`));
    });
  });
}

type OpenAPISpec = {
  info?: { 'x-fal-metadata'?: { endpointId?: string }; [key: string]: unknown };
  [key: string]: unknown;
};

async function fetchOpenApiSpec(endpointId: string): Promise<OpenAPISpec> {
  const url = `https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=${encodeURIComponent(endpointId)}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} fetching spec for ${endpointId}`);
  }
  return response.json();
}

// fal serves no public OpenAPI spec for unlisted enterprise endpoints (the
// endpoint itself works, but the spec URL 404s). Their schema is identical to
// the base endpoint's, so derive the spec from it via string renames of the
// endpoint path and component schema names.
const DERIVED_SPECS: Record<
  string,
  { baseId: string; renames: Array<[from: string, to: string]> }
> = {
  'bytedance/seedance-2.0/enterprise/image-to-video': {
    baseId: 'bytedance/seedance-2.0/image-to-video',
    renames: [
      [
        'bytedance/seedance-2.0/image-to-video',
        'bytedance/seedance-2.0/enterprise/image-to-video',
      ],
      ['Seedance20ImageToVideo', 'Seedance20EnterpriseImageToVideo'],
      ['Seedance2I2V', 'Seedance2I2VEnterprise'],
    ],
  },
};

function deriveSpec(
  baseSpec: OpenAPISpec,
  renames: Array<[from: string, to: string]>
): OpenAPISpec {
  let text = JSON.stringify(baseSpec);
  for (const [from, to] of renames) {
    text = text.replaceAll(from, to);
  }
  return JSON.parse(text);
}

async function main() {
  // Deduplicate endpoint IDs (kling_v3_pro and kling_v3_pro_no_audio share one)
  const endpointIds = [
    ...new Set(Object.values(IMAGE_TO_VIDEO_MODELS).map((m) => m.id)),
  ];

  console.log(
    `Fetching OpenAPI specs for ${endpointIds.length} motion models...\n`
  );

  const models = [];
  const fetched = new Map<string, OpenAPISpec>();

  for (const id of endpointIds) {
    process.stdout.write(`  ${id} ... `);
    const derived = DERIVED_SPECS[id];
    let spec: OpenAPISpec;
    if (derived) {
      const baseSpec =
        fetched.get(derived.baseId) ?? (await fetchOpenApiSpec(derived.baseId));
      fetched.set(derived.baseId, baseSpec);
      spec = deriveSpec(baseSpec, derived.renames);
    } else {
      spec = await fetchOpenApiSpec(id);
      fetched.set(id, spec);
    }

    // Add endpoint metadata (same format as fetch-openapi-models.ts)
    if (!spec.info) spec.info = {};
    spec.info['x-fal-metadata'] = { endpointId: id };

    models.push({
      endpoint_id: id,
      openapi: spec,
    });
    console.log(derived ? `derived from ${derived.baseId}` : 'ok');
  }

  // Save in the same format fetch-openapi-models.ts uses
  const jsonDir = join(import.meta.dirname, '..', 'json');
  mkdirSync(jsonDir, { recursive: true });

  const outputPath = join(jsonDir, 'fal.models.motion.json');
  const data = {
    generated_at: new Date().toISOString(),
    total_models: models.length,
    category: 'motion',
    models,
  };

  writeFileSync(outputPath, JSON.stringify(data, null, 2));
  console.log(`\nSaved ${models.length} specs to ${outputPath}`);

  // Run hey-api codegen
  console.log('\nRunning @hey-api/openapi-ts codegen...\n');
  await runCommand('bunx', [
    '@hey-api/openapi-ts',
    '-f',
    'scripts/motion-openapi-ts.config.ts',
  ]);

  // Generate endpoint map + prompt limits from the generated types
  console.log('\nGenerating endpoint map...\n');
  await runCommand('bun', ['scripts/generate-motion-endpoint-map.ts']);

  console.log('\nDone! Generated types in src/lib/motion/generated/');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
