/**
 * Desktop runtime entry for TanStack Start.
 *
 * This file intentionally avoids Cloudflare Worker exports (`scheduled`,
 * workflow exports, DO exports) and keeps only a plain request-handler path so
 * Tauri can host the app through a local Node process.
 */

import './instrumentation';
import handler from '@tanstack/react-start/server-entry';

import { getEnv } from '#env';
import { isLocalRuntimeMode } from '@/lib/runtime-mode';
import { getDb } from '#db-client';
import { reconcileAllStuckJobs } from '@/lib/cron/reconcile-all';
import { ensureSystemTemplatesSeeded } from '@/lib/db/seed-system-templates';
import {
  acceptsMarkdown,
  getMarkdownForPath,
  markdownResponse,
  withDiscoveryLinkHeader,
  withHtmlAccept,
} from '@/lib/agent/discovery';
import { getLogger, toErrorPayload } from '@/lib/observability/logger';

const logger = getLogger(['openstory', 'server', 'desktop']);

// System templates self-seed on first request.
const SEED_RETRY_COOLDOWN_MS = 60_000;
let seedPromise: Promise<void> | null = null;
let seedRetryAt = 0;

async function ensureSeededOnce(): Promise<void> {
  if (seedPromise === null && Date.now() < seedRetryAt) {
    return;
  }
  seedPromise ??= ensureSystemTemplatesSeeded(getDb(), (message) =>
    logger.info(`[seed] ${message}`)
  ).catch((error) => {
    seedPromise = null;
    seedRetryAt = Date.now() + SEED_RETRY_COOLDOWN_MS;
    logger.error('System template self-seed failed', {
      err: toErrorPayload(error),
    });
  });
  return seedPromise;
}

const RECONCILE_INTERVAL_MS = 5 * 60 * 1000;
let reconcileTimer: ReturnType<typeof setInterval> | null = null;
function startBackgroundReconcile(): void {
  if (reconcileTimer !== null) return;
  reconcileTimer = setInterval(() => {
    void reconcileAllStuckJobs().catch((error) => {
      logger.error('reconcileAllStuckJobs failed:', { err: error });
    });
  }, RECONCILE_INTERVAL_MS);
}

function shouldSkipDesktopBootstrap(pathname: string): boolean {
  return (
    pathname.startsWith('/r2/') ||
    pathname.startsWith('/@') ||
    pathname.startsWith('/assets/') ||
    pathname === '/favicon.ico'
  );
}

const exportedHandler = {
  async fetch(request: Request): Promise<Response> {
    const env = getEnv();
    const pathname = new URL(request.url).pathname;

    if (!shouldSkipDesktopBootstrap(pathname)) {
      void ensureSeededOnce().catch((error) => {
        logger.error('seed bootstrap failed in desktop server path', {
          err: error,
          runtimeMode: isLocalRuntimeMode(env) ? 'local' : 'unknown',
        });
      });
      startBackgroundReconcile();
    }

    const wantsMarkdown = acceptsMarkdown(request);
    if (wantsMarkdown) {
      const markdown = getMarkdownForPath(pathname);
      if (markdown !== null) {
        return markdownResponse(markdown, request.method);
      }
    }

    const response = await handler.fetch(
      wantsMarkdown ? withHtmlAccept(request) : request
    );
    return withDiscoveryLinkHeader(response, pathname);
  },
};

export default exportedHandler;
