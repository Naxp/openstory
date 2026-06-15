import { describe, expect, it } from 'vitest';
import { buildGithubAuthorizeUrl } from './github';

describe('buildGithubAuthorizeUrl', () => {
  it('builds a GitHub OAuth authorize URL with the requested scopes', () => {
    const url = new URL(
      buildGithubAuthorizeUrl({
        clientId: 'gh-client',
        redirectUri: 'https://app.test/api/fork/github/callback',
        scopes: 'repo workflow',
        csrfState: 'nonce',
      })
    );
    expect(url.origin + url.pathname).toBe(
      'https://github.com/login/oauth/authorize'
    );
    expect(url.searchParams.get('client_id')).toBe('gh-client');
    expect(url.searchParams.get('redirect_uri')).toBe(
      'https://app.test/api/fork/github/callback'
    );
    expect(url.searchParams.get('scope')).toBe('repo workflow');
    expect(url.searchParams.get('state')).toBe('nonce');
  });
});
