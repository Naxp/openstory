import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  env: {} as Record<string, string | undefined>,
}));
vi.mock('#env', () => ({ getEnv: () => h.env }));

import { getForkConfig } from './config';

const FULL_ENV = {
  GITHUB_OAUTH_CLIENT_ID: 'gh-client',
  GITHUB_OAUTH_CLIENT_SECRET: 'gh-secret',
  CLOUDFLARE_OAUTH_CLIENT_ID: 'cf-client',
  CLOUDFLARE_OAUTH_AUTHORIZE_URL: 'https://cf.example/authorize',
  CLOUDFLARE_OAUTH_TOKEN_URL: 'https://cf.example/token',
};

describe('getForkConfig', () => {
  beforeEach(() => {
    h.env = {};
  });

  it('is disabled with no OAuth credentials', () => {
    expect(getForkConfig().enabled).toBe(false);
  });

  it('is disabled when only GitHub is configured', () => {
    h.env = {
      GITHUB_OAUTH_CLIENT_ID: 'gh-client',
      GITHUB_OAUTH_CLIENT_SECRET: 'gh-secret',
    };
    expect(getForkConfig().enabled).toBe(false);
  });

  it('is enabled once both GitHub and Cloudflare are configured', () => {
    h.env = { ...FULL_ENV };
    expect(getForkConfig().enabled).toBe(true);
  });

  it('treats empty-string env vars as missing', () => {
    h.env = { ...FULL_ENV, GITHUB_OAUTH_CLIENT_ID: '' };
    expect(getForkConfig().enabled).toBe(false);
  });

  it('defaults the upstream + worker name, overridable via env', () => {
    h.env = { ...FULL_ENV };
    const config = getForkConfig();
    expect(config.upstream).toEqual({
      owner: 'openstory-so',
      repo: 'openstory',
    });
    expect(config.workerName).toBe('openstory');

    h.env = {
      ...FULL_ENV,
      FORK_UPSTREAM_OWNER: 'acme',
      FORK_WORKER_NAME: 'app',
    };
    const overridden = getForkConfig();
    expect(overridden.upstream.owner).toBe('acme');
    expect(overridden.workerName).toBe('app');
  });
});
