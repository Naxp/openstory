#!/usr/bin/env bun
/**
 * Sync iframe-runtime third-party scripts from node_modules into public/vendor/.
 * Runs as a postinstall hook so the committed `public/vendor/*.js` files always
 * track the installed package versions.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { z } from 'zod';

type VendorEntry = {
  packageDir: string;
  source: string;
  destination: string;
};

const repoRoot = join(import.meta.dir, '..');
const vendorDir = join(repoRoot, 'public', 'vendor');

const entries: VendorEntry[] = [
  {
    packageDir: join(repoRoot, 'node_modules', 'gsap'),
    source: 'dist/gsap.min.js',
    destination: 'gsap.min.js',
  },
  {
    packageDir: join(repoRoot, 'node_modules', '@hyperframes', 'core'),
    source: 'dist/hyperframe.runtime.iife.js',
    destination: 'hyperframe.runtime.iife.js',
  },
];

const packageJsonSchema = z.object({
  name: z.string(),
  version: z.string(),
});

const readPackageVersion = (packageDir: string): string => {
  const parsed = packageJsonSchema.parse(
    JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8'))
  );
  return `${parsed.name}@${parsed.version}`;
};

const syncEntry = (entry: VendorEntry): { changed: boolean; label: string } => {
  const sourcePath = join(entry.packageDir, entry.source);
  const destPath = join(vendorDir, entry.destination);
  const label = readPackageVersion(entry.packageDir);

  const sourceContent = readFileSync(sourcePath);
  const destExists = existsSync(destPath);
  const matchesExisting =
    destExists && readFileSync(destPath).equals(sourceContent);

  if (matchesExisting) {
    return { changed: false, label };
  }

  mkdirSync(dirname(destPath), { recursive: true });
  writeFileSync(destPath, sourceContent);
  return { changed: true, label };
};

const run = () => {
  for (const entry of entries) {
    const { changed, label } = syncEntry(entry);
    const verb = changed ? 'wrote' : 'unchanged';
    console.log(
      `[vendor] ${verb}: public/vendor/${entry.destination} (${label})`
    );
  }
};

run();
