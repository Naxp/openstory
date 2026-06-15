/**
 * GitHub API client for the fork-and-deploy flow.
 *
 * Covers the OAuth web flow (authorize URL + code exchange) and the repo
 * operations performed on the visitor's behalf: forking upstream, enabling
 * Actions on the fresh fork, writing the Cloudflare credentials as Actions
 * secrets (sealed box), and dispatching the deploy workflow.
 */

import { z } from 'zod';
import { sealGithubSecret } from './github-secret-seal';

const GITHUB_AUTHORIZE_URL = 'https://github.com/login/oauth/authorize';
const GITHUB_TOKEN_URL = 'https://github.com/login/oauth/access_token';
const GITHUB_API = 'https://api.github.com';

// GitHub rejects API requests without a User-Agent.
const USER_AGENT = 'openstory-fork-deploy';

function apiHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': USER_AGENT,
  };
}

/** Build the GitHub OAuth authorize URL. `csrfState` is echoed back via `state`. */
export function buildGithubAuthorizeUrl(input: {
  clientId: string;
  redirectUri: string;
  scopes: string;
  csrfState: string;
}): string {
  const params = new URLSearchParams({
    client_id: input.clientId,
    redirect_uri: input.redirectUri,
    scope: input.scopes,
    state: input.csrfState,
    allow_signup: 'true',
  });
  return `${GITHUB_AUTHORIZE_URL}?${params.toString()}`;
}

const tokenResponseSchema = z.object({
  access_token: z.string().optional(),
  error: z.string().optional(),
  error_description: z.string().optional(),
});

/** Exchange an authorization code for a user access token. */
export async function exchangeGithubCode(input: {
  clientId: string;
  clientSecret: string;
  code: string;
  redirectUri: string;
}): Promise<string> {
  const response = await fetch(GITHUB_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      client_id: input.clientId,
      client_secret: input.clientSecret,
      code: input.code,
      redirect_uri: input.redirectUri,
    }),
  });
  const data = tokenResponseSchema.parse(await response.json());
  if (!data.access_token) {
    throw new Error(
      `GitHub token exchange failed: ${data.error_description ?? data.error ?? 'unknown error'}`
    );
  }
  return data.access_token;
}

/** Resolve the authenticated user's login. */
export async function getGithubLogin(token: string): Promise<string> {
  const response = await fetch(`${GITHUB_API}/user`, {
    headers: apiHeaders(token),
  });
  if (!response.ok) {
    throw new Error(`GitHub /user failed (${response.status})`);
  }
  const data = z.object({ login: z.string() }).parse(await response.json());
  return data.login;
}

const repoSchema = z.object({
  name: z.string(),
  full_name: z.string(),
  html_url: z.string(),
  owner: z.object({ login: z.string() }),
  default_branch: z.string().optional(),
});

export type ForkedRepo = {
  owner: string;
  repo: string;
  htmlUrl: string;
  defaultBranch: string;
};

/**
 * Fork the upstream repo into the authenticated user's account. GitHub returns
 * 202 with the (eventually-consistent) fork record; callers should poll
 * {@link waitForRepoReady} before dispatching a workflow against it.
 */
export async function forkRepo(input: {
  token: string;
  owner: string;
  repo: string;
}): Promise<ForkedRepo> {
  const response = await fetch(
    `${GITHUB_API}/repos/${input.owner}/${input.repo}/forks`,
    { method: 'POST', headers: apiHeaders(input.token) }
  );
  if (!response.ok) {
    throw new Error(`GitHub fork failed (${response.status})`);
  }
  const data = repoSchema.parse(await response.json());
  return {
    owner: data.owner.login,
    repo: data.name,
    htmlUrl: data.html_url,
    defaultBranch: data.default_branch ?? 'main',
  };
}

/** Poll until the fork's default branch is populated (forks are async). */
export async function waitForRepoReady(input: {
  token: string;
  owner: string;
  repo: string;
  attempts?: number;
}): Promise<boolean> {
  const attempts = input.attempts ?? 10;
  for (let i = 0; i < attempts; i++) {
    const response = await fetch(
      `${GITHUB_API}/repos/${input.owner}/${input.repo}/branches`,
      { headers: apiHeaders(input.token) }
    );
    if (response.ok) {
      const branches = z
        .array(z.object({ name: z.string() }))
        .catch([])
        .parse(await response.json());
      if (branches.length > 0) return true;
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  return false;
}

/**
 * Enable GitHub Actions on the fork. Forks have Actions disabled by default,
 * so the deploy workflow would never run without this.
 */
export async function enableActions(input: {
  token: string;
  owner: string;
  repo: string;
}): Promise<void> {
  const response = await fetch(
    `${GITHUB_API}/repos/${input.owner}/${input.repo}/actions/permissions`,
    {
      method: 'PUT',
      headers: {
        ...apiHeaders(input.token),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ enabled: true, allowed_actions: 'all' }),
    }
  );
  if (!response.ok && response.status !== 204) {
    throw new Error(`GitHub enable-actions failed (${response.status})`);
  }
}

const publicKeySchema = z.object({ key_id: z.string(), key: z.string() });

/** Set (or update) a repository Actions secret, sealing the value client-side. */
export async function putActionsSecret(input: {
  token: string;
  owner: string;
  repo: string;
  name: string;
  value: string;
}): Promise<void> {
  const keyResponse = await fetch(
    `${GITHUB_API}/repos/${input.owner}/${input.repo}/actions/secrets/public-key`,
    { headers: apiHeaders(input.token) }
  );
  if (!keyResponse.ok) {
    throw new Error(`GitHub get-public-key failed (${keyResponse.status})`);
  }
  const { key_id, key } = publicKeySchema.parse(await keyResponse.json());

  const response = await fetch(
    `${GITHUB_API}/repos/${input.owner}/${input.repo}/actions/secrets/${input.name}`,
    {
      method: 'PUT',
      headers: {
        ...apiHeaders(input.token),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        encrypted_value: sealGithubSecret(key, input.value),
        key_id,
      }),
    }
  );
  if (!response.ok && response.status !== 201 && response.status !== 204) {
    throw new Error(
      `GitHub put-secret ${input.name} failed (${response.status})`
    );
  }
}

/** Dispatch a `workflow_dispatch` run of `workflowFile` on `ref`. */
export async function dispatchWorkflow(input: {
  token: string;
  owner: string;
  repo: string;
  workflowFile: string;
  ref: string;
}): Promise<void> {
  const response = await fetch(
    `${GITHUB_API}/repos/${input.owner}/${input.repo}/actions/workflows/${input.workflowFile}/dispatches`,
    {
      method: 'POST',
      headers: {
        ...apiHeaders(input.token),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ref: input.ref }),
    }
  );
  if (!response.ok && response.status !== 204) {
    throw new Error(`GitHub workflow dispatch failed (${response.status})`);
  }
}

const runsSchema = z.object({
  workflow_runs: z.array(
    z.object({
      id: z.number(),
      status: z.string().nullable(),
      conclusion: z.string().nullable(),
      html_url: z.string(),
      created_at: z.string(),
    })
  ),
});

export type WorkflowRun = {
  id: number;
  status: string | null;
  conclusion: string | null;
  htmlUrl: string;
};

/** Return the most recent run of `workflowFile`, or null if none yet. */
export async function getLatestWorkflowRun(input: {
  token: string;
  owner: string;
  repo: string;
  workflowFile: string;
}): Promise<WorkflowRun | null> {
  const response = await fetch(
    `${GITHUB_API}/repos/${input.owner}/${input.repo}/actions/workflows/${input.workflowFile}/runs?per_page=1`,
    { headers: apiHeaders(input.token) }
  );
  if (!response.ok) return null;
  const data = runsSchema.parse(await response.json());
  const run = data.workflow_runs[0];
  if (!run) return null;
  return {
    id: run.id,
    status: run.status,
    conclusion: run.conclusion,
    htmlUrl: run.html_url,
  };
}
