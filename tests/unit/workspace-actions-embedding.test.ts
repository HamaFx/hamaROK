import { afterEach, describe, expect, it, vi } from 'vitest';

const { resolveGovernorByEmbeddingFallbackMock } = vi.hoisted(() => ({
  resolveGovernorByEmbeddingFallbackMock: vi.fn(),
}));

vi.mock('@/lib/embeddings/service', () => ({
  enqueueEmbeddingTaskSafe: vi.fn(),
  resolveGovernorByEmbeddingFallback: resolveGovernorByEmbeddingFallbackMock,
}));

import { resolveGovernorForStatsTx } from '@/lib/domain/workspace-actions';

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
      async findFirst(input: {
        where: {
          workspaceId: string;
          governorId?: string;
        };
        select: {
          id: true;
          governorId: true;
          name: true;
        };
      }) {
        return (
          args.governors.find(
            (row) =>
              row.workspaceId === input.where.workspaceId &&
              row.governorId === input.where.governorId
          ) || null
        );
      },
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

describe('resolveGovernorForStatsTx embedding fallback', () => {
  it('resolves directly by governorId before similarity fallback', async () => {
    const tx = buildTx({
      governors: [{ id: 'g1', workspaceId: 'w1', governorId: '100', name: 'Alpha' }],
    });

    const result = await resolveGovernorForStatsTx(tx as never, {
      workspaceId: 'w1',
      governorGameId: '100',
    });

    expect(result.status).toBe('resolved');
    if (result.status !== 'resolved') return;
    expect(result.governor.governorDbId).toBe('g1');
    expect(resolveGovernorByEmbeddingFallbackMock).not.toHaveBeenCalled();
  });

  it('uses embedding fallback when similarity does not resolve', async () => {
    resolveGovernorByEmbeddingFallbackMock.mockResolvedValue({
      status: 'resolved',
      autoLinkThreshold: 0.93,
      marginThreshold: 0.04,
      reason: 'embedding hit',
      governor: {
        governorDbId: 'g2',
        governorGameId: '200',
        governorName: 'Knight Beta',
        score: 0.98,
        documentId: 'doc-1',
      },
      candidates: [
        {
          governorDbId: 'g2',
          governorGameId: '200',
          governorName: 'Knight Beta',
          score: 0.98,
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

    const result = await resolveGovernorForStatsTx(tx as never, {
      workspaceId: 'w1',
      governorName: 'Unmatched Raven 9090',
    });

    expect(result.status).toBe('resolved');
    if (result.status !== 'resolved') return;
    expect(result.governor.governorDbId).toBe('g2');
    expect(result.governor.governorGameId).toBe('200');
    expect(resolveGovernorByEmbeddingFallbackMock).toHaveBeenCalledTimes(1);
  });
});
