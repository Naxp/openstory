/**
 * GET /api/fork/github/callback — GitHub OAuth redirect target.
 *
 * Verifies the CSRF nonce, exchanges the code for a user token, forks the
 * upstream repo into the visitor's account, stashes the token + fork details
 * in the encrypted cookie, then continues to the Cloudflare OAuth step.
 */

import { getForkConfig } from '@/lib/fork/config';
import {
  exchangeGithubCode,
  forkRepo,
  getGithubLogin,
} from '@/lib/fork/github';
import {
  readForkCookie,
  sealForkState,
  serializeForkCookieHeader,
  unsealForkState,
} from '@/lib/fork/state-cookie';
import { getServerAppUrl } from '@/lib/utils/environment';
import { getLogger } from '@/lib/observability/logger';
import { createFileRoute } from '@tanstack/react-router';

const logger = getLogger(['openstory', 'api', 'fork', 'github', 'callback']);

export const Route = createFileRoute('/api/fork/github/callback')({
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
          !config.github.clientId ||
          !config.github.clientSecret
        ) {
          return fail('disabled');
        }

        const existing = await unsealForkState(readForkCookie(request, secure));
        if (
          !code ||
          !state ||
          !existing?.githubCsrf ||
          existing.githubCsrf !== state
        ) {
          return fail('github_state');
        }

        try {
          const token = await exchangeGithubCode({
            clientId: config.github.clientId,
            clientSecret: config.github.clientSecret,
            code,
            redirectUri: `${appUrl}/api/fork/github/callback`,
          });
          const login = await getGithubLogin(token);
          const fork = await forkRepo({
            token,
            owner: config.upstream.owner,
            repo: config.upstream.repo,
          });

          const sealed = await sealForkState({
            githubToken: token,
            githubLogin: login,
            forkOwner: fork.owner,
            forkRepo: fork.repo,
            forkUrl: fork.htmlUrl,
          });

          // Continue straight into the Cloudflare connect step.
          return new Response(null, {
            status: 302,
            headers: {
              Location: `${appUrl}/api/fork/cloudflare/start`,
              'Set-Cookie': serializeForkCookieHeader(sealed, secure),
            },
          });
        } catch (error) {
          logger.error('GitHub fork failed', { err: error });
          return fail('github_fork');
        }
      },
    },
  },
});
