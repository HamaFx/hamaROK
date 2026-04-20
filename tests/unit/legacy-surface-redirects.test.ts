import { describe, expect, it } from 'vitest';

describe('legacy surface redirects', () => {
  it('maps removed product pages to supported surfaces', async () => {
    const { default: nextConfig } = await import('../../next.config.mjs');
    const redirects = (await nextConfig.redirects?.()) ?? [];

    expect(redirects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: '/activity',
          destination: '/rankings?scope=weekly',
          permanent: false,
        }),
        expect.objectContaining({
          source: '/compare',
          destination: '/assistant',
          permanent: false,
        }),
        expect.objectContaining({
          source: '/insights',
          destination: '/assistant',
          permanent: false,
        }),
      ])
    );
  });
});
