/**
 * GET /api/fork/cloudflare/callback — Cloudflare OAuth redirect target.
 *
 * Verifies the CSRF nonce, exchanges the code (PKCE) for a Cloudflare token,
 * resolves the account + workers.dev URL, writes the credentials onto the
 * fork as Actions secrets, and dispatches the deploy workflow. Then sends the
 * visitor to /fork to watch the deploy.
 */

import { getForkConfig } from '@/lib/fork/config';
import {
  computeWorkerUrl,
  exchangeCloudflareCode,
  getCloudflareAccountId,
  getWorkersSubdomain,
} from '@/lib/fork/cloudflare';
import { kickoffForkDeploy } from '@/lib/fork/deploy';
import {
  readForkCookie,
  sealForkState,
  serializeForkCookieHeader,
  unsealForkState,
} from '@/lib/fork/state-cookie';
import { getServerAppUrl } from '@/lib/utils/environment';
import { getLogger } from '@/lib/observability/logger';
import { createFileRoute } from '@tanstack/react-router';

const logger = getLogger([
  'openstory',
  'api',
  'fork',
  'cloudflare',
  'callback',
]);

export const Route = createFileRoute('/api/fork/cloudflare/callback')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const config = getForkConfig();
        const appUrl = getServerAppUrl(request);
        const secure = appUrl.startsWith('https:');
        const url = new URL(request.url);
        const code = url.searchParams.get('code');
        const state = url.searchParams.get('state');

        const fail = (reason: string) =>
          Response.redirect(`${appUrl}/fork?error=${reason}`, 302);

        if (
          !config.enabled ||
          !config.cloudflare.clientId ||
          !config.cloudflare.tokenUrl
        ) {
          return fail('disabled');
        }

        const existing = await unsealForkState(readForkCookie(request, secure));
        if (
          !code ||
          !state ||
          !existing?.cloudflareCsrf ||
          existing.cloudflareCsrf !== state ||
          !existing.cloudflarePkceVerifier ||
          !existing.githubToken ||
          !existing.forkOwner ||
          !existing.forkRepo
        ) {
          return fail('cloudflare_state');
        }

        try {
          const cloudflareToken = await exchangeCloudflareCode({
            tokenUrl: config.cloudflare.tokenUrl,
            clientId: config.cloudflare.clientId,
            clientSecret: config.cloudflare.clientSecret,
            code,
            redirectUri: `${appUrl}/api/fork/cloudflare/callback`,
            codeVerifier: existing.cloudflarePkceVerifier,
          });

          const accountId = await getCloudflareAccountId(cloudflareToken);
          const subdomain = await getWorkersSubdomain(
            cloudflareToken,
            accountId
          );
          const workerUrl = computeWorkerUrl(config.workerName, subdomain);

          await kickoffForkDeploy({
            config,
            githubToken: existing.githubToken,
            forkOwner: existing.forkOwner,
            forkRepo: existing.forkRepo,
            ref: 'main',
            cloudflareToken,
            cloudflareAccountId: accountId,
            workerUrl,
          });

          // Keep the GitHub token (status polling reads run state); drop the
          // Cloudflare token + PKCE/CSRF nonces now that the deploy is wired.
          const sealed = await sealForkState({
            githubToken: existing.githubToken,
            githubLogin: existing.githubLogin,
            forkOwner: existing.forkOwner,
            forkRepo: existing.forkRepo,
            forkUrl: existing.forkUrl,
            cloudflareAccountId: accountId,
            workerUrl,
          });

          return new Response(null, {
            status: 302,
            headers: {
              Location: `${appUrl}/fork?step=deploying`,
              'Set-Cookie': serializeForkCookieHeader(sealed, secure),
            },
          });
        } catch (error) {
          logger.error('Cloudflare deploy kickoff failed', { err: error });
          return fail('cloudflare_deploy');
        }
      },
    },
  },
});
