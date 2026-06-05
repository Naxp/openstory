/**
 * OpenRouter OAuth Callback Handler
 * Server-only — completes the OAuth PKCE flow after redirect.
 */

import { getCookie } from '@tanstack/react-start/server';
import { exchangeCodeForKey } from '@/lib/byok/openrouter-oauth';
import {
  getOAuthCookieName,
  unsealOAuthState,
} from '@/lib/byok/openrouter-oauth-cookie';
import type { ScopedDb } from '@/lib/db/scoped';

/** The slice of ScopedDb this flow needs — keeps tests cast-free. */
type OAuthScopedDb = { apiKeys: Pick<ScopedDb['apiKeys'], 'saveKey'> };

type CompleteOAuthParams = {
  /** Team resolved from the authenticated session on the callback request. */
  teamId: string;
  /** Authorization code from OpenRouter's redirect. */
  code: string;
  /** CSRF `state` query param echoed back via the callback URL. */
  csrfState: string | null;
  /** Whether the request arrived over HTTPS (selects the cookie name). */
  secureCookies: boolean;
};

/**
 * Complete the OpenRouter OAuth PKCE flow.
 * Called by the callback route after OpenRouter redirects back.
 * Reads the encrypted PKCE state cookie set during initiation and verifies
 * it against the session team and the echoed CSRF state. Throws on failure;
 * the route clears the cookie on every outcome.
 */
export async function completeOpenRouterOAuth(
  { teamId, code, csrfState, secureCookies }: CompleteOAuthParams,
  scopedDb: OAuthScopedDb
): Promise<void> {
  const sealed = getCookie(getOAuthCookieName(secureCookies));
  const state = sealed ? await unsealOAuthState(sealed) : null;
  if (!state) {
    throw new Error('OAuth session expired or not found');
  }

  if (state.teamId !== teamId) {
    throw new Error('OAuth state does not match the active team');
  }

  if (!csrfState || state.csrfState !== csrfState) {
    throw new Error('OAuth state mismatch');
  }

  // Exchange code for API key
  const { apiKey } = await exchangeCodeForKey(code, state.codeVerifier);

  // Save the key (encrypted)
  await scopedDb.apiKeys.saveKey({
    provider: 'openrouter',
    apiKey,
    source: 'oauth',
  });
}
