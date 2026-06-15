/**
 * GET /api/fork/github/start — begin the fork-and-deploy flow.
 *
 * Public route. Mints a CSRF nonce, stashes it in the encrypted fork cookie,
 * and redirects the visitor to GitHub's OAuth consent screen. The callback
 * forks the repo and continues to the Cloudflare step.
 */

import { getForkConfig, GITHUB_OAUTH_SCOPES } from '@/lib/fork/config';
import { generateUrlSafeToken } from '@/lib/fork/cloudflare';
import { buildGithubAuthorizeUrl } from '@/lib/fork/github';
import {
  sealForkState,
  serializeForkCookieHeader,
} from '@/lib/fork/state-cookie';
import { getServerAppUrl } from '@/lib/utils/environment';
import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/api/fork/github/start')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const config = getForkConfig();
        const appUrl = getServerAppUrl(request);
        const secure = appUrl.startsWith('https:');

        if (!config.enabled || !config.github.clientId) {
          return Response.redirect(`${appUrl}/fork?error=disabled`, 302);
        }

        const csrfState = generateUrlSafeToken();
        const sealed = await sealForkState({ githubCsrf: csrfState });

        const authUrl = buildGithubAuthorizeUrl({
          clientId: config.github.clientId,
          redirectUri: `${appUrl}/api/fork/github/callback`,
          scopes: GITHUB_OAUTH_SCOPES,
          csrfState,
        });

        return new Response(null, {
          status: 302,
          headers: {
            Location: authUrl,
            'Set-Cookie': serializeForkCookieHeader(sealed, secure),
          },
        });
      },
    },
  },
});
