/**
 * GET /api/fork/cloudflare/start — connect the visitor's Cloudflare account.
 *
 * Reached after the GitHub fork. Mints a CSRF nonce + PKCE verifier, stashes
 * them in the encrypted cookie, and redirects to Cloudflare's OAuth consent
 * screen. The callback wires the credentials onto the fork and dispatches the
 * deploy workflow.
 */

import { getForkConfig } from '@/lib/fork/config';
import {
  buildCloudflareAuthorizeUrl,
  generateCodeChallenge,
  generateUrlSafeToken,
} from '@/lib/fork/cloudflare';
import {
  readForkCookie,
  sealForkState,
  serializeForkCookieHeader,
  unsealForkState,
} from '@/lib/fork/state-cookie';
import { getServerAppUrl } from '@/lib/utils/environment';
import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/api/fork/cloudflare/start')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const config = getForkConfig();
        const appUrl = getServerAppUrl(request);
        const secure = appUrl.startsWith('https:');

        const existing = await unsealForkState(readForkCookie(request, secure));
        if (
          !config.enabled ||
          !config.cloudflare.clientId ||
          !config.cloudflare.authorizeUrl ||
          !existing?.githubToken ||
          !existing.forkOwner
        ) {
          return Response.redirect(
            `${appUrl}/fork?error=cloudflare_state`,
            302
          );
        }

        const csrfState = generateUrlSafeToken();
        const codeVerifier = generateUrlSafeToken();
        const codeChallenge = await generateCodeChallenge(codeVerifier);

        const sealed = await sealForkState({
          ...existing,
          cloudflareCsrf: csrfState,
          cloudflarePkceVerifier: codeVerifier,
        });

        const authUrl = buildCloudflareAuthorizeUrl({
          authorizeUrl: config.cloudflare.authorizeUrl,
          clientId: config.cloudflare.clientId,
          redirectUri: `${appUrl}/api/fork/cloudflare/callback`,
          scopes: config.cloudflare.scopes,
          csrfState,
          codeChallenge,
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
