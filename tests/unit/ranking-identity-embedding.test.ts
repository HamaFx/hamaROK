import { afterEach, describe, expect, it, vi } from 'vitest';

const { resolveGovernorByEmbeddingFallbackMock } = vi.hoisted(() => ({
  resolveGovernorByEmbeddingFallbackMock: vi.fn(),
}));

vi.mock('@/lib/embeddings/service', () => ({
  resolveGovernorByEmbeddingFallback: resolveGovernorByEmbeddingFallbackMock,
}));

import { resolveRankingIdentity } from '@/lib/rankings/identity';

type GovernorRow = {
  id: string;
  workspaceId: string;
  governorId: string;
  name: string;
};

type AliasRow = {
  workspaceId: string;
  aliasNormalized: string;
  governorId: string;
};

function buildTx(args: { governors: GovernorRow[]; aliases?: AliasRow[] }) {
  const aliases = args.aliases || [];
  return {
    governorAlias: {
      async findMany(input: {
        where: { workspaceId: string; aliasNormalized: string };
        include: { governor: { select: { id: true; governorId: true; name: true } } };
      }) {
        const rows = aliases.filter(
          (row) =>
            row.workspaceId === input.where.workspaceId &&
            row.aliasNormalized === input.where.aliasNormalized
        );
        return rows
          .map((row) => {
            const governor = args.governors.find((item) => item.id === row.governorId);
            if (!governor) return null;
            return {
              governor: {
                id: governor.id,
                governorId: governor.governorId,
                name: governor.name,
              },
            };
          })
          .filter(Boolean);
      },
    },
    governor: {
      async findMany(input: {
        where: {
          workspaceId: string;
          name?: {
            equals: string;
            mode: 'insensitive';
          };
        };
        select: {
          id: true;
          governorId: true;
          name: true;
        };
        take?: number;
      }) {
        const rows = args.governors.filter((row) => row.workspaceId === input.where.workspaceId);
        let filtered = rows;
        if (input.where.name?.equals) {
          const needle = input.where.name.equals.toLowerCase();
          filtered = filtered.filter((row) => row.name.toLowerCase() === needle);
        }
        return filtered.slice(0, input.take || filtered.length).map((row) => ({
          id: row.id,
          governorId: row.governorId,
          name: row.name,
        }));
      },
    },
  };
}

afterEach(() => {
  resolveGovernorByEmbeddingFallbackMock.mockReset();
});

describe('ranking identity embedding fallback', () => {
  it('keeps deterministic fuzzy auto-link when already resolved', async () => {
    const tx = buildTx({
      governors: [
        { id: 'g1', workspaceId: 'w1', governorId: '100', name: 'SmokeAlpha' },
      ],
    });

    const result = await resolveRankingIdentity(tx as never, {
      workspaceId: 'w1',
      governorNameRaw: 'SmokeAlph',
    });

    expect(result.status).toBe('AUTO_LINKED');
    expect(result.governorId).toBe('g1');
    expect(result.reason).toBe('name-fuzzy-high-confidence');
    expect(resolveGovernorByEmbeddingFallbackMock).not.toHaveBeenCalled();
  });

  it('uses embedding fallback when deterministic matching is unresolved', async () => {
    resolveGovernorByEmbeddingFallbackMock.mockResolvedValue({
      status: 'resolved',
      autoLinkThreshold: 0.93,
      marginThreshold: 0.04,
      reason: 'embedding hit',
      governor: {
        governorDbId: 'g2',
        governorGameId: '200',
        governorName: 'Knight Beta',
        score: 0.97,
        documentId: 'doc-1',
      },
      candidates: [
        {
          governorDbId: 'g2',
          governorGameId: '200',
          governorName: 'Knight Beta',
          score: 0.97,
          documentId: 'doc-1',
        },
      ],
    });

    const tx = buildTx({
      governors: [
        { id: 'g1', workspaceId: 'w1', governorId: '100', name: 'Knight One' },
        { id: 'g2', workspaceId: 'w1', governorId: '200', name: 'Knight Beta' },
      ],
    });

    const result = await resolveRankingIdentity(tx as never, {
      workspaceId: 'w1',
      governorNameRaw: 'Unmatched Raven 9090',
    });

    expect(result.status).toBe('AUTO_LINKED');
    expect(result.governorId).toBe('g2');
    expect(result.governorGameId).toBe('200');
    expect(result.reason).toBe('embedding-fallback-high-confidence');
    expect(resolveGovernorByEmbeddingFallbackMock).toHaveBeenCalledTimes(1);
  });

  it('returns unresolved ambiguous when fallback has close high candidates', async () => {
    resolveGovernorByEmbeddingFallbackMock.mockResolvedValue({
      status: 'ambiguous',
      autoLinkThreshold: 0.93,
      marginThreshold: 0.04,
      reason: 'multiple high confidence embedding candidates',
      candidates: [
        {
          governorDbId: 'g1',
          governorGameId: '100',
          governorName: 'Tiger One',
          score: 0.95,
          documentId: 'doc-a',
        },
        {
          governorDbId: 'g2',
          governorGameId: '200',
          governorName: 'Tiger Two',
          score: 0.94,
          documentId: 'doc-b',
        },
      ],
    });

    const tx = buildTx({
      governors: [
        { id: 'g1', workspaceId: 'w1', governorId: '100', name: 'Tiger One' },
        { id: 'g2', workspaceId: 'w1', governorId: '200', name: 'Tiger Two' },
      ],
    });

    const result = await resolveRankingIdentity(tx as never, {
      workspaceId: 'w1',
      governorNameRaw: 'Tigr',
    });

    expect(result.status).toBe('UNRESOLVED');
    expect(result.reason).toBe('ambiguous');
    expect(result.suggestions.length).toBeGreaterThan(0);
    expect(result.suggestions[0].governorId).toBe('g1');
  });
});
