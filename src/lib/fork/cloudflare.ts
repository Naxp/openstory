/**
 * Cloudflare OAuth + API client for the fork-and-deploy flow.
 *
 * Uses Cloudflare's self-managed OAuth clients (authorization-code flow with
 * PKCE) to obtain a token scoped to the visitor's account. The token is
 * handed to the fork's CI (as the `CLOUDFLARE_API_TOKEN` Actions secret) to
 * provision D1/R2 and deploy. We also read the account id and workers.dev
 * subdomain so the UI can link the visitor straight to their deployed worker.
 *
 * Endpoint URLs and scopes are supplied via config (set when the OAuth client
 * is registered) rather than hard-coded — see src/lib/fork/config.ts.
 */

import { z } from 'zod';

const CLOUDFLARE_API = 'https://api.cloudflare.com/client/v4';

/** Random URL-safe token (256 bits) — used as PKCE verifier and CSRF nonce. */
export function generateUrlSafeToken(): string {
  return uint8ToUrlSafeBase64(crypto.getRandomValues(new Uint8Array(32)));
}

/** PKCE S256 challenge derived from the verifier. */
export async function generateCodeChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(verifier)
  );
  return uint8ToUrlSafeBase64(new Uint8Array(digest));
}

/** Build the Cloudflare OAuth authorize URL (authorization-code + PKCE). */
export function buildCloudflareAuthorizeUrl(input: {
  authorizeUrl: string;
  clientId: string;
  redirectUri: string;
  scopes: string;
  csrfState: string;
  codeChallenge: string;
}): string {
  const url = new URL(input.authorizeUrl);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', input.clientId);
  url.searchParams.set('redirect_uri', input.redirectUri);
  url.searchParams.set('scope', input.scopes);
  url.searchParams.set('state', input.csrfState);
  url.searchParams.set('code_challenge', input.codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');
  return url.toString();
}

const tokenResponseSchema = z.object({
  access_token: z.string().optional(),
  error: z.string().optional(),
  error_description: z.string().optional(),
});

/** Exchange an authorization code for an access token (PKCE). */
export async function exchangeCloudflareCode(input: {
  tokenUrl: string;
  clientId: string;
  clientSecret?: string;
  code: string;
  redirectUri: string;
  codeVerifier: string;
}): Promise<string> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: input.code,
    redirect_uri: input.redirectUri,
    client_id: input.clientId,
    code_verifier: input.codeVerifier,
  });
  if (input.clientSecret) body.set('client_secret', input.clientSecret);

  const response = await fetch(input.tokenUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: body.toString(),
  });
  const data = tokenResponseSchema.parse(await response.json());
  if (!data.access_token) {
    throw new Error(
      `Cloudflare token exchange failed: ${data.error_description ?? data.error ?? 'unknown error'}`
    );
  }
  return data.access_token;
}

const accountsSchema = z.object({
  result: z.array(z.object({ id: z.string(), name: z.string() })).nullable(),
});

/** Return the first account the token can access. */
export async function getCloudflareAccountId(token: string): Promise<string> {
  const response = await fetch(`${CLOUDFLARE_API}/accounts`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    throw new Error(`Cloudflare /accounts failed (${response.status})`);
  }
  const data = accountsSchema.parse(await response.json());
  const accountId = data.result?.[0]?.id;
  if (!accountId) {
    throw new Error('No Cloudflare account accessible with this token');
  }
  return accountId;
}

const subdomainSchema = z.object({
  result: z.object({ subdomain: z.string().nullable() }).nullable(),
});

/** Read the account's workers.dev subdomain (null if not yet registered). */
export async function getWorkersSubdomain(
  token: string,
  accountId: string
): Promise<string | null> {
  const response = await fetch(
    `${CLOUDFLARE_API}/accounts/${accountId}/workers/subdomain`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!response.ok) return null;
  const data = subdomainSchema.parse(await response.json());
  return data.result?.subdomain ?? null;
}

/** The eventual workers.dev URL of the deployed worker, if the subdomain is known. */
export function computeWorkerUrl(
  workerName: string,
  subdomain: string | null
): string | undefined {
  if (!subdomain) return undefined;
  return `https://${workerName}.${subdomain}.workers.dev`;
}

// -- helpers --

function uint8ToUrlSafeBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}
