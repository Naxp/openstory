/**
 * GET /api/fork/status — current fork-deploy progress for the active session.
 *
 * Reads the encrypted fork cookie and reports the dispatched workflow run's
 * status so the /fork page can poll and surface a link to the deployed worker
 * when CI finishes. Returns `{ step: 'idle' }` when no flow is in progress.
 */

import { getForkConfig } from '@/lib/fork/config';
import { getLatestWorkflowRun } from '@/lib/fork/github';
import { readForkCookie, unsealForkState } from '@/lib/fork/state-cookie';
import { getServerAppUrl } from '@/lib/utils/environment';
import { createFileRoute } from '@tanstack/react-router';
import { json } from '@tanstack/react-start';

export const Route = createFileRoute('/api/fork/status')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const config = getForkConfig();
        const secure = getServerAppUrl(request).startsWith('https:');
        const state = await unsealForkState(readForkCookie(request, secure));

        if (!state?.forkOwner || !state.forkRepo || !state.githubToken) {
          return json({ step: 'idle' as const });
        }

        const run = await getLatestWorkflowRun({
          token: state.githubToken,
          owner: state.forkOwner,
          repo: state.forkRepo,
          workflowFile: config.workflowFile,
        });

        return json({
          step: 'deploying' as const,
          forkUrl: state.forkUrl,
          workerUrl: state.workerUrl,
          run: run
            ? {
                status: run.status,
                conclusion: run.conclusion,
                htmlUrl: run.htmlUrl,
              }
            : null,
        });
      },
    },
  },
});
