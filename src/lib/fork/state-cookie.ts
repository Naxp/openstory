/**
 * Fork-flow state cookie.
 *
 * The fork-and-deploy flow spans several redirect hops (GitHub OAuth →
 * Cloudflare OAuth → deploy dispatch → status polling). The in-progress state
 * — OAuth CSRF nonces, PKCE verifier, access tokens, the created fork, the
 * dispatched workflow run — rides along in a single encrypted, HttpOnly
 * cookie rather than a server-side store, mirroring the OpenRouter OAuth
 * cookie (#807). The payload is AES-256-GCM encrypted with
 * API_KEY_ENCRYPTION_KEY, so the browser can neither read the access tokens
 * nor forge the CSRF state.
 */

import { z } from 'zod';
import { decryptApiKey, encryptApiKey } from '@/lib/crypto/api-key-encryption';

/** How long an in-progress fork flow stays valid (covers the CI deploy wait). */
const FORK_STATE_TTL = 3600; // seconds

const COOKIE_BASE_NAME = 'os-fork';

/**
 * `__Host-` pins the cookie to this origin (requires Secure + Path=/ and no
 * Domain). Plain-HTTP local dev falls back to the bare name since some
 * browsers reject Secure cookies over http.
 */
export function getForkCookieName(secure: boolean): string {
  return secure ? `__Host-${COOKIE_BASE_NAME}` : COOKIE_BASE_NAME;
}

const forkStateSchema = z.object({
  // ── GitHub OAuth + fork ──
  githubCsrf: z.string().optional(),
  githubToken: z.string().optional(),
  githubLogin: z.string().optional(),
  forkOwner: z.string().optional(),
  forkRepo: z.string().optional(),
  forkUrl: z.string().optional(),
  // ── Cloudflare OAuth ──
  cloudflareCsrf: z.string().optional(),
  cloudflarePkceVerifier: z.string().optional(),
  cloudflareAccountId: z.string().optional(),
  // ── Deploy ──
  workflowRunId: z.number().optional(),
  workerUrl: z.string().optional(),
});

export type ForkState = z.infer<typeof forkStateSchema>;

const sealedPayloadSchema = forkStateSchema.extend({
  expiresAt: z.number(),
});

/** Encrypt fork state for transport in the cookie. */
export async function sealForkState(state: ForkState): Promise<string> {
  const payload = JSON.stringify({
    ...state,
    expiresAt: Date.now() + FORK_STATE_TTL * 1000,
  });
  const { encryptedKey, keyIv, keyTag } = await encryptApiKey(payload);
  return [keyIv, encryptedKey, keyTag].join('.');
}

/**
 * Decrypt and validate a sealed fork-state cookie value.
 * Returns null for anything tampered, malformed, or expired.
 */
export async function unsealForkState(
  sealed: string | undefined
): Promise<ForkState | null> {
  if (!sealed) return null;
  const [keyIv, encryptedKey, keyTag] = sealed.split('.');
  if (!keyIv || !encryptedKey || !keyTag) return null;

  try {
    const plaintext = await decryptApiKey({ encryptedKey, keyIv, keyTag });
    const payload = sealedPayloadSchema.parse(JSON.parse(plaintext));
    if (payload.expiresAt < Date.now()) return null;

    const { expiresAt: _expiresAt, ...state } = payload;
    return state;
  } catch {
    // Wrong key, tampered ciphertext, or malformed payload — treat as absent.
    return null;
  }
}

/**
 * Serialized `Set-Cookie` header carrying the sealed state. Used by the
 * redirecting handlers, where framework `setCookie()` headers are dropped on
 * the 302 (same caveat as {@link getForkCookieClearHeader}).
 */
export function serializeForkCookieHeader(
  sealed: string,
  secure: boolean
): string {
  const name = getForkCookieName(secure);
  return `${name}=${sealed}; Max-Age=${FORK_STATE_TTL}; Path=/; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`;
}

/** Read the raw fork cookie value off a request's Cookie header. */
export function readForkCookie(
  request: Request,
  secure: boolean
): string | undefined {
  const header = request.headers.get('cookie');
  if (!header) return undefined;
  const name = getForkCookieName(secure);
  for (const part of header.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === name) return rest.join('=');
  }
  return undefined;
}
