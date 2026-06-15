/**
 * Deploy kickoff: wire the visitor's Cloudflare credentials onto their fork
 * and dispatch the deploy workflow. The fork's own CI does the build +
 * provisioning (D1/R2) + deploy — see .github/workflows/fork-deploy.yml.
 */

import type { ForkConfig } from './config';
import {
  dispatchWorkflow,
  enableActions,
  putActionsSecret,
  waitForRepoReady,
} from './github';

export async function kickoffForkDeploy(input: {
  config: ForkConfig;
  githubToken: string;
  forkOwner: string;
  forkRepo: string;
  ref: string;
  cloudflareToken: string;
  cloudflareAccountId: string;
  workerUrl?: string;
}): Promise<void> {
  const { githubToken: token, forkOwner: owner, forkRepo: repo } = input;

  // Forks are created asynchronously; the workflow file must exist on the
  // default branch before a dispatch will resolve.
  await waitForRepoReady({ token, owner, repo });
  await enableActions({ token, owner, repo });

  await putActionsSecret({
    token,
    owner,
    repo,
    name: 'CLOUDFLARE_API_TOKEN',
    value: input.cloudflareToken,
  });
  await putActionsSecret({
    token,
    owner,
    repo,
    name: 'CLOUDFLARE_ACCOUNT_ID',
    value: input.cloudflareAccountId,
  });
  if (input.workerUrl) {
    await putActionsSecret({
      token,
      owner,
      repo,
      name: 'VITE_APP_URL',
      value: input.workerUrl,
    });
  }

  await dispatchWorkflow({
    token,
    owner,
    repo,
    workflowFile: input.config.workflowFile,
    ref: input.ref,
  });
}
