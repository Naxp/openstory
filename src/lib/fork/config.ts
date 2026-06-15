/**
 * Fork-and-deploy configuration.
 *
 * The public `/fork` flow forks this repo into a visitor's GitHub account and
 * deploys it to their Cloudflare account. Both halves use OAuth, so the flow
 * is only live once the operator registers two OAuth apps and supplies their
 * credentials as Worker secrets:
 *
 *   - A GitHub OAuth App (to fork + set Actions secrets + dispatch the deploy
 *     workflow on the visitor's fork).
 *   - A Cloudflare self-managed OAuth client (to obtain a token the fork's CI
 *     uses to provision D1/R2 and deploy). See
 *     https://developers.cloudflare.com/changelog/post/2026-06-03-public-oauth-clients/
 *
 * Cloudflare's OAuth endpoint URLs are determined when the client is
 * registered (RFC 8414 discovery), so they're read from env rather than
 * hard-coded. When any required credential is missing, `getForkConfig()`
 * reports `enabled: false` and the UI shows the manual deploy path instead.
 */

import { getEnv } from '#env';

/** Read an arbitrary env var without fighting the generated Worker env type. */
function readEnv(key: string): string | undefined {
  const value: unknown = Reflect.get(getEnv(), key);
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

export type ForkConfig = {
  enabled: boolean;
  upstream: { owner: string; repo: string };
  /** Workflow file (on the fork) that provisions + deploys. */
  workflowFile: string;
  /** Worker name the fork deploys to (matches wrangler.jsonc `name`). */
  workerName: string;
  github: { clientId?: string; clientSecret?: string };
  cloudflare: {
    clientId?: string;
    clientSecret?: string;
    authorizeUrl?: string;
    tokenUrl?: string;
    scopes: string;
  };
};

/** GitHub scopes needed to fork, write Actions secrets, and dispatch a run. */
export const GITHUB_OAUTH_SCOPES = 'repo workflow';

/** Default Cloudflare scopes — overridable via env to match the registered client. */
const DEFAULT_CLOUDFLARE_SCOPES =
  'account:read d1:write workers_scripts:write workers_kv:write';

export function getForkConfig(): ForkConfig {
  const githubClientId = readEnv('GITHUB_OAUTH_CLIENT_ID');
  const githubClientSecret = readEnv('GITHUB_OAUTH_CLIENT_SECRET');
  const cloudflareClientId = readEnv('CLOUDFLARE_OAUTH_CLIENT_ID');
  const cloudflareClientSecret = readEnv('CLOUDFLARE_OAUTH_CLIENT_SECRET');
  const cloudflareAuthorizeUrl = readEnv('CLOUDFLARE_OAUTH_AUTHORIZE_URL');
  const cloudflareTokenUrl = readEnv('CLOUDFLARE_OAUTH_TOKEN_URL');
  const cloudflareScopes =
    readEnv('CLOUDFLARE_OAUTH_SCOPES') ?? DEFAULT_CLOUDFLARE_SCOPES;

  const enabled = Boolean(
    githubClientId &&
    githubClientSecret &&
    cloudflareClientId &&
    cloudflareAuthorizeUrl &&
    cloudflareTokenUrl
  );

  return {
    enabled,
    upstream: {
      owner: readEnv('FORK_UPSTREAM_OWNER') ?? 'openstory-so',
      repo: readEnv('FORK_UPSTREAM_REPO') ?? 'openstory',
    },
    workflowFile: readEnv('FORK_DEPLOY_WORKFLOW_FILE') ?? 'fork-deploy.yml',
    workerName: readEnv('FORK_WORKER_NAME') ?? 'openstory',
    github: { clientId: githubClientId, clientSecret: githubClientSecret },
    cloudflare: {
      clientId: cloudflareClientId,
      clientSecret: cloudflareClientSecret,
      authorizeUrl: cloudflareAuthorizeUrl,
      tokenUrl: cloudflareTokenUrl,
      scopes: cloudflareScopes,
    },
  };
}
