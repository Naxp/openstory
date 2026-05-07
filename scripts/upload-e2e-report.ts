#!/usr/bin/env bun
/**
 * Upload E2E Report to R2
 *
 * Uploads the full Playwright HTML report to R2 for viewing.
 * Also uploads trace files with links to the trace viewer.
 *
 * Usage (CI):
 *   bun scripts/upload-e2e-report.ts
 *
 * Required env vars:
 *   R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY,
 *   R2_BUCKET_NAME, R2_PUBLIC_STORAGE_DOMAIN, GITHUB_RUN_ID
 */

import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { readdir, readFile, appendFile, stat } from 'node:fs/promises';
import path from 'node:path';

const REPORT_DIR = path.join(process.cwd(), 'playwright-report');
const RESULTS_DIR = path.join(process.cwd(), 'e2e/results');
const TRACE_VIEWER_URL = 'https://trace.playwright.dev/?trace=';

function getRequiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function createR2Client(): S3Client {
  const accountId = getRequiredEnv('R2_ACCOUNT_ID');
  const accessKeyId = getRequiredEnv('R2_ACCESS_KEY_ID');
  const secretAccessKey = getRequiredEnv('R2_SECRET_ACCESS_KEY');

  return new S3Client({
    region: 'auto',
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
  });
}

/**
 * Get content type for a file based on extension
 */
function isEnoentError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'ENOENT'
  );
}

function getContentType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  const contentTypes: Record<string, string> = {
    '.html': 'text/html',
    '.js': 'application/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.zip': 'application/zip',
    '.webp': 'image/webp',
  };
  return contentTypes[ext] || 'application/octet-stream';
}

/**
 * Recursively get all files in a directory
 */
async function getAllFiles(dir: string): Promise<string[]> {
  const files: string[] = [];

  try {
    const entries = await readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        const nested = await getAllFiles(fullPath);
        files.push(...nested);
      } else {
        files.push(fullPath);
      }
    }
  } catch (error) {
    if (!isEnoentError(error)) {
      throw error;
    }
  }

  return files;
}

/**
 * Recursively find all trace.zip files in directory
 */
async function findTraceFiles(dir: string): Promise<string[]> {
  const traces: string[] = [];

  try {
    const entries = await readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        const nested = await findTraceFiles(fullPath);
        traces.push(...nested);
      } else if (entry.name === 'trace.zip') {
        traces.push(fullPath);
      }
    }
  } catch (error) {
    if (!isEnoentError(error)) {
      throw error;
    }
  }

  return traces;
}

/**
 * Extract a readable test name from the trace path
 */
function getTestNameFromPath(tracePath: string): string {
  const relativePath = path.relative(RESULTS_DIR, tracePath);
  const parts = relativePath.split(path.sep);
  const testDir = parts[parts.length - 2] || 'unknown';

  return testDir
    .replace(/-chromium$/, '')
    .replace(/-spec-ts-/, '-')
    .replace(/-retry\d+$/, '');
}

async function main() {
  const runId = process.env.GITHUB_RUN_ID || Date.now().toString();
  const bucketName = getRequiredEnv('R2_BUCKET_NAME');
  const publicDomain = getRequiredEnv('R2_PUBLIC_STORAGE_DOMAIN');
  const client = createR2Client();

  const baseKey = `e2e-reports/${runId}`;
  let reportUrl = '';
  const traceLinks: { name: string; url: string }[] = [];

  // Upload HTML report
  console.log('Uploading Playwright HTML report to R2...\n');

  try {
    await stat(REPORT_DIR);
    const reportFiles = await getAllFiles(REPORT_DIR);

    if (reportFiles.length > 0) {
      console.log(`Found ${reportFiles.length} report file(s)\n`);

      for (const filePath of reportFiles) {
        const relativePath = path.relative(REPORT_DIR, filePath);
        const r2Key = `${baseKey}/report/${relativePath}`;

        try {
          const fileContent = await readFile(filePath);

          await client.send(
            new PutObjectCommand({
              Bucket: bucketName,
              Key: r2Key,
              Body: fileContent,
              ContentType: getContentType(filePath),
              CacheControl: 'public, max-age=2592000',
            })
          );
        } catch (error) {
          console.error(
            `  Failed to upload ${relativePath}: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      }

      reportUrl = `https://${publicDomain}/${baseKey}/report/index.html`;
      console.log(`\nHTML Report: ${reportUrl}\n`);
    }
  } catch {
    console.log('No HTML report found at', REPORT_DIR);
  }

  // Upload trace files
  console.log('Uploading trace files...\n');

  const tracePaths = await findTraceFiles(RESULTS_DIR);

  if (tracePaths.length > 0) {
    console.log(`Found ${tracePaths.length} trace file(s)\n`);

    for (const tracePath of tracePaths) {
      const testName = getTestNameFromPath(tracePath);
      const r2Key = `${baseKey}/traces/${testName}.zip`;

      try {
        const fileContent = await readFile(tracePath);

        await client.send(
          new PutObjectCommand({
            Bucket: bucketName,
            Key: r2Key,
            Body: fileContent,
            ContentType: 'application/zip',
            CacheControl: 'public, max-age=2592000',
          })
        );

        const publicUrl = `https://${publicDomain}/${r2Key}`;
        const viewerUrl = `${TRACE_VIEWER_URL}${encodeURIComponent(publicUrl)}`;
        traceLinks.push({ name: testName, url: viewerUrl });

        console.log(`  - ${testName}`);
      } catch (error) {
        console.error(
          `  Failed: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
  } else {
    console.log('No trace files found');
  }

  // Upload aimock unmatched-request dump (only present when fixture matching
  // failed — diagnostic for fixture drift).
  const unmatchedPath = path.join(RESULTS_DIR, 'aimock-unmatched.json');
  let unmatchedUrl = '';
  try {
    await stat(unmatchedPath);
    const r2Key = `${baseKey}/aimock-unmatched.json`;
    await client.send(
      new PutObjectCommand({
        Bucket: bucketName,
        Key: r2Key,
        Body: await readFile(unmatchedPath),
        ContentType: 'application/json',
        CacheControl: 'public, max-age=2592000',
      })
    );
    unmatchedUrl = `https://${publicDomain}/${r2Key}`;
    console.log(`\naimock unmatched dump: ${unmatchedUrl}`);
  } catch {
    // Common case — no unmatched requests means file doesn't exist.
  }

  // Write to GitHub Actions step summary
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (summaryPath && (reportUrl || traceLinks.length > 0 || unmatchedUrl)) {
    const summaryLines: string[] = ['## E2E Test Report', ''];

    if (reportUrl) {
      summaryLines.push(`**[View Full Report](${reportUrl})**`, '');
    }

    if (traceLinks.length > 0) {
      summaryLines.push('### Traces', '');
      for (const trace of traceLinks) {
        summaryLines.push(`- [${trace.name}](${trace.url})`);
      }
      summaryLines.push('');
    }

    if (unmatchedUrl) {
      summaryLines.push(
        '### aimock fixture drift',
        `- [Unmatched request bodies](${unmatchedUrl})`,
        ''
      );
    }

    await appendFile(summaryPath, summaryLines.join('\n'));
    console.log('\nReport links added to GitHub Actions summary');
  }
}

main().catch((error) => {
  console.error('Error uploading report:', error);
  process.exit(1);
});
