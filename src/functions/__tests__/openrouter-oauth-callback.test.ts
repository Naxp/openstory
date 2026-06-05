import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OAuthState } from '@/lib/byok/openrouter-oauth';
import type { ScopedDb } from '@/lib/db/scoped';

vi.doMock('#env', () => ({
  getEnv: () => ({
    API_KEY_ENCRYPTION_KEY: 'test-secret-for-oauth-callback-testing',
  }),
}));

const getCookieMock = vi.fn<(name: string) => string | undefined>();
vi.doMock('@tanstack/react-start/server', () => ({
  getCookie: getCookieMock,
}));

const exchangeCodeForKeyMock =
  vi.fn<(code: string, verifier: string) => Promise<{ apiKey: string }>>();
vi.doMock('@/lib/byok/openrouter-oauth', () => ({
  exchangeCodeForKey: exchangeCodeForKeyMock,
}));

const { sealOAuthState, getOAuthCookieName } =
  await import('@/lib/byok/openrouter-oauth-cookie');
const { completeOpenRouterOAuth } =
  await import('../openrouter-oauth-callback');

const TEAM_ID = '01JTEAM00000000000000000000';
const USER_ID = '01JUSER00000000000000000000';

const validState: OAuthState = {
  teamId: TEAM_ID,
  userId: USER_ID,
  codeVerifier: 'verifier-abc123',
  csrfState: 'csrf-nonce-xyz789',
};

function makeScopedDb() {
  const saveKey = vi.fn<ScopedDb['apiKeys']['saveKey']>((params) =>
    Promise.resolve({
      id: '01JKEY000000000000000000000',
      provider: params.provider,
      keyHint: '****wkey',
      source: params.source ?? 'oauth',
      isActive: true,
      isInvalid: false,
      invalidReason: null,
      lastValidatedAt: null,
      addedBy: USER_ID,
      createdAt: new Date(),
    })
  );
  return { scopedDb: { apiKeys: { saveKey } }, saveKey };
}

async function setStateCookie(state: OAuthState, secure = true) {
  const sealed = await sealOAuthState(state);
  const name = getOAuthCookieName(secure);
  getCookieMock.mockImplementation((n) => (n === name ? sealed : undefined));
}

describe('completeOpenRouterOAuth', () => {
  beforeEach(() => {
    getCookieMock.mockReset();
    exchangeCodeForKeyMock.mockReset();
    exchangeCodeForKeyMock.mockResolvedValue({ apiKey: 'sk-or-v1-newkey' });
  });

  it('exchanges the code and saves the key on the happy path', async () => {
    await setStateCookie(validState);
    const { scopedDb, saveKey } = makeScopedDb();

    await completeOpenRouterOAuth(
      {
        teamId: TEAM_ID,
        code: 'auth-code',
        csrfState: validState.csrfState,
        secureCookies: true,
      },
      scopedDb
    );

    expect(exchangeCodeForKeyMock).toHaveBeenCalledWith(
      'auth-code',
      validState.codeVerifier
    );
    expect(saveKey).toHaveBeenCalledWith({
      provider: 'openrouter',
      apiKey: 'sk-or-v1-newkey',
      source: 'oauth',
    });
  });

  it('throws when the state cookie is missing', async () => {
    getCookieMock.mockReturnValue(undefined);
    const { scopedDb } = makeScopedDb();

    await expect(
      completeOpenRouterOAuth(
        {
          teamId: TEAM_ID,
          code: 'auth-code',
          csrfState: validState.csrfState,
          secureCookies: true,
        },
        scopedDb
      )
    ).rejects.toThrow('OAuth session expired or not found');
    expect(exchangeCodeForKeyMock).not.toHaveBeenCalled();
  });

  it('throws when the cookie is tampered', async () => {
    getCookieMock.mockReturnValue('AAAA.BBBB.CCCC');
    const { scopedDb } = makeScopedDb();

    await expect(
      completeOpenRouterOAuth(
        {
          teamId: TEAM_ID,
          code: 'auth-code',
          csrfState: validState.csrfState,
          secureCookies: true,
        },
        scopedDb
      )
    ).rejects.toThrow('OAuth session expired or not found');
  });

  it('throws when the state belongs to a different team', async () => {
    await setStateCookie({
      ...validState,
      teamId: '01JOTHERTEAM000000000000000',
    });
    const { scopedDb } = makeScopedDb();

    await expect(
      completeOpenRouterOAuth(
        {
          teamId: TEAM_ID,
          code: 'auth-code',
          csrfState: validState.csrfState,
          secureCookies: true,
        },
        scopedDb
      )
    ).rejects.toThrow('OAuth state does not match the active team');
    expect(exchangeCodeForKeyMock).not.toHaveBeenCalled();
  });

  it('throws when the echoed CSRF state is missing or wrong', async () => {
    await setStateCookie(validState);
    const { scopedDb } = makeScopedDb();

    await expect(
      completeOpenRouterOAuth(
        {
          teamId: TEAM_ID,
          code: 'auth-code',
          csrfState: null,
          secureCookies: true,
        },
        scopedDb
      )
    ).rejects.toThrow('OAuth state mismatch');

    await expect(
      completeOpenRouterOAuth(
        {
          teamId: TEAM_ID,
          code: 'auth-code',
          csrfState: 'wrong-nonce',
          secureCookies: true,
        },
        scopedDb
      )
    ).rejects.toThrow('OAuth state mismatch');
    expect(exchangeCodeForKeyMock).not.toHaveBeenCalled();
  });

  it('reads the non-prefixed cookie on insecure origins', async () => {
    await setStateCookie(validState, false);
    const { scopedDb, saveKey } = makeScopedDb();

    await completeOpenRouterOAuth(
      {
        teamId: TEAM_ID,
        code: 'auth-code',
        csrfState: validState.csrfState,
        secureCookies: false,
      },
      scopedDb
    );

    expect(saveKey).toHaveBeenCalled();
  });
});
