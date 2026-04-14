import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearServerCache,
  getServerCacheStats,
  invalidateServerCacheTags,
  makeServerCacheKey,
  withServerCache,
} from '@/lib/server-cache';

describe('server cache', () => {
  beforeEach(() => {
    clearServerCache();
  });

  it('builds stable keys for equivalent objects', () => {
    const a = makeServerCacheKey('rankings', {
      workspaceId: 'ws_1',
      filter: {
        status: ['ACTIVE', 'UNRESOLVED'],
        q: 'hana',
      },
    });

    const b = makeServerCacheKey('rankings', {
      filter: {
        q: 'hana',
        status: ['ACTIVE', 'UNRESOLVED'],
      },
      workspaceId: 'ws_1',
    });

    expect(a).toBe(b);
  });

  it('returns cached value while ttl is active', async () => {
    let calls = 0;

    const first = await withServerCache(
      'cache:key',
      { ttlMs: 2_000, tags: ['workspace:demo:all'] },
      async () => {
        calls += 1;
        return { value: calls };
      }
    );
    const second = await withServerCache(
      'cache:key',
      { ttlMs: 2_000, tags: ['workspace:demo:all'] },
      async () => {
        calls += 1;
        return { value: calls };
      }
    );

    expect(first.value).toBe(1);
    expect(second.value).toBe(1);
    expect(calls).toBe(1);
  });

  it('invalidates entries by tag', async () => {
    let calls = 0;

    await withServerCache(
      'cache:key',
      { ttlMs: 2_000, tags: ['workspace:demo:rankings'] },
      async () => {
        calls += 1;
        return calls;
      }
    );

    const invalidated = invalidateServerCacheTags(['workspace:demo:rankings']);
    expect(invalidated).toBeGreaterThan(0);

    const next = await withServerCache(
      'cache:key',
      { ttlMs: 2_000, tags: ['workspace:demo:rankings'] },
      async () => {
        calls += 1;
        return calls;
      }
    );

    expect(next).toBe(2);
    expect(calls).toBe(2);
  });

  it('deduplicates concurrent inflight requests', async () => {
    let calls = 0;
    const loader = async () => {
      calls += 1;
      await new Promise((resolve) => setTimeout(resolve, 25));
      return { calls };
    };

    const [a, b, c] = await Promise.all([
      withServerCache('inflight:key', { ttlMs: 2_000, tags: ['x'] }, loader),
      withServerCache('inflight:key', { ttlMs: 2_000, tags: ['x'] }, loader),
      withServerCache('inflight:key', { ttlMs: 2_000, tags: ['x'] }, loader),
    ]);

    expect(calls).toBe(1);
    expect(a.calls).toBe(1);
    expect(b.calls).toBe(1);
    expect(c.calls).toBe(1);
    expect(getServerCacheStats().entries).toBe(1);
  });
});
