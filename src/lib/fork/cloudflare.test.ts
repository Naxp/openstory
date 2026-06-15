import { describe, expect, it } from 'vitest';
import {
  buildCloudflareAuthorizeUrl,
  computeWorkerUrl,
  generateCodeChallenge,
  generateUrlSafeToken,
} from './cloudflare';

describe('buildCloudflareAuthorizeUrl', () => {
  it('builds an authorization-code + PKCE URL', () => {
    const url = new URL(
      buildCloudflareAuthorizeUrl({
        authorizeUrl: 'https://cf.example/oauth/authorize',
        clientId: 'client-123',
        redirectUri: 'https://app.test/api/fork/cloudflare/callback',
        scopes: 'account:read d1:write',
        csrfState: 'nonce',
        codeChallenge: 'challenge',
      })
    );
    expect(url.origin + url.pathname).toBe(
      'https://cf.example/oauth/authorize'
    );
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('client_id')).toBe('client-123');
    expect(url.searchParams.get('code_challenge')).toBe('challenge');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('state')).toBe('nonce');
    expect(url.searchParams.get('scope')).toBe('account:read d1:write');
  });
});

describe('generateCodeChallenge', () => {
  it('matches the known S256 vector from RFC 7636', async () => {
    const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
    expect(await generateCodeChallenge(verifier)).toBe(
      'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM'
    );
  });

  it('produces URL-safe tokens with no padding', () => {
    expect(generateUrlSafeToken()).not.toMatch(/[+/=]/);
  });
});

describe('computeWorkerUrl', () => {
  it('builds the workers.dev URL when the subdomain is known', () => {
    expect(computeWorkerUrl('openstory', 'octocat')).toBe(
      'https://openstory.octocat.workers.dev'
    );
  });

  it('returns undefined without a subdomain', () => {
    expect(computeWorkerUrl('openstory', null)).toBeUndefined();
  });
});
