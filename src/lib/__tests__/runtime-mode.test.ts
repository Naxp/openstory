import { describe, expect, it } from 'vitest';

import { isLocalRuntimeMode } from '@/lib/runtime-mode';

describe('isLocalRuntimeMode', () => {
  it('returns true when OPENSTORY_LOCAL_WORKFLOWS is enabled', () => {
    expect(
      isLocalRuntimeMode({
        OPENSTORY_LOCAL_WORKFLOWS: 'true',
        NODE_ENV: 'production',
        CLOUDFLARE_ENV: 'production',
      })
    ).toBe(true);
  });

  it('returns false for production cloudflare and test runtimes', () => {
    expect(
      isLocalRuntimeMode({
        NODE_ENV: 'production',
      })
    ).toBe(false);
    expect(
      isLocalRuntimeMode({
        CLOUDFLARE_ENV: 'production',
      })
    ).toBe(false);
    expect(
      isLocalRuntimeMode({
        NODE_ENV: 'development',
        CLOUDFLARE_ENV: 'test',
      })
    ).toBe(false);
  });

  it('honors OPENSTORY_RUNTIME_MODE desktop', () => {
    expect(
      isLocalRuntimeMode({
        OPENSTORY_RUNTIME_MODE: 'desktop',
        NODE_ENV: 'production',
      })
    ).toBe(true);
  });

  it('requires missing DB when option is set', () => {
    expect(
      isLocalRuntimeMode(
        {
          NODE_ENV: 'development',
          DB: undefined,
        },
        { requireMissingDbInDev: true }
      )
    ).toBe(true);

    expect(
      isLocalRuntimeMode(
        {
          NODE_ENV: 'development',
          DB: {},
        },
        { requireMissingDbInDev: true }
      )
    ).toBe(false);
  });
});
