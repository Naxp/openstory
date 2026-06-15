import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('#env', () => ({ getEnv: () => process.env }));

import {
  getForkCookieName,
  readForkCookie,
  sealForkState,
  unsealForkState,
} from './state-cookie';

beforeAll(() => {
  process.env.API_KEY_ENCRYPTION_KEY = 'test-encryption-key-for-fork-state-ok';
});

const SAMPLE = {
  githubToken: 'gho_token',
  githubLogin: 'octocat',
  forkOwner: 'octocat',
  forkRepo: 'openstory',
  forkUrl: 'https://github.com/octocat/openstory',
};

describe('fork state cookie', () => {
  it('round-trips a sealed state', async () => {
    const sealed = await sealForkState(SAMPLE);
    expect(await unsealForkState(sealed)).toMatchObject(SAMPLE);
  });

  it('does not leak tokens in plaintext', async () => {
    const sealed = await sealForkState(SAMPLE);
    expect(sealed).not.toContain('gho_token');
  });

  it('returns null for tampered or malformed values', async () => {
    expect(await unsealForkState(undefined)).toBeNull();
    expect(await unsealForkState('not.a.cookie')).toBeNull();
    const sealed = await sealForkState(SAMPLE);
    expect(await unsealForkState(`${sealed}tampered`)).toBeNull();
  });

  it('names the cookie with the __Host- prefix only when secure', () => {
    expect(getForkCookieName(true)).toBe('__Host-os-fork');
    expect(getForkCookieName(false)).toBe('os-fork');
  });

  it('reads its value back from a Cookie header', async () => {
    const sealed = await sealForkState(SAMPLE);
    const request = new Request('https://app.test/', {
      headers: { cookie: `other=1; __Host-os-fork=${sealed}; another=2` },
    });
    expect(readForkCookie(request, true)).toBe(sealed);
    expect(readForkCookie(request, false)).toBeUndefined();
  });
});
