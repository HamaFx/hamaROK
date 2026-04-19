import { describe, expect, it } from 'vitest';
import {
  evaluateAssistantBatchAutoConfirm,
} from '@/lib/assistant/service';
import {
  resolveGovernorBySimilarityTx,
} from '@/lib/governor-similarity';
import { normalizeGovernorAlias } from '@/lib/rankings/normalize';

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

describe('governor similarity resolver', () => {
  it('resolves exact alias match', async () => {
    const tx = buildTx({
      governors: [
        { id: 'g1', workspaceId: 'w1', governorId: '100', name: 'Smoke Alpha' },
      ],
      aliases: [
        {
          workspaceId: 'w1',
          aliasNormalized: normalizeGovernorAlias('Smoke Alpha'),
          governorId: 'g1',
        },
      ],
    });

    const result = await resolveGovernorBySimilarityTx(tx as never, {
      workspaceId: 'w1',
      governorNameRaw: 'Smoke Alpha',
    });

    expect(result.status).toBe('resolved');
    if (result.status !== 'resolved') return;
    expect(result.governor.governorDbId).toBe('g1');
    expect(result.governor.score).toBe(1);
  });

  it('resolves single high-confidence fuzzy match', async () => {
    const tx = buildTx({
      governors: [
        { id: 'g1', workspaceId: 'w1', governorId: '100', name: 'SmokeAlpha' },
        { id: 'g2', workspaceId: 'w1', governorId: '200', name: 'ThunderKing' },
      ],
    });

    const result = await resolveGovernorBySimilarityTx(tx as never, {
      workspaceId: 'w1',
      governorNameRaw: 'SmokeAlph',
      autoThreshold: 0.93,
    });

    expect(result.status).toBe('resolved');
    if (result.status !== 'resolved') return;
    expect(result.governor.governorDbId).toBe('g1');
    expect(result.governor.score).toBeGreaterThanOrEqual(0.93);
  });

  it('returns ambiguous when multiple high-confidence fuzzy matches exist', async () => {
    const tx = buildTx({
      governors: [
        { id: 'g1', workspaceId: 'w1', governorId: '100', name: 'SmokeAlpha' },
        { id: 'g2', workspaceId: 'w1', governorId: '101', name: 'SmokeAlphx' },
      ],
    });

    const result = await resolveGovernorBySimilarityTx(tx as never, {
      workspaceId: 'w1',
      governorNameRaw: 'SmokeAlph',
      autoThreshold: 0.8,
    });

    expect(result.status).toBe('ambiguous');
    if (result.status !== 'ambiguous') return;
    expect(result.candidates.length).toBeGreaterThanOrEqual(2);
  });

  it('returns unresolved when no high-confidence match exists', async () => {
    const tx = buildTx({
      governors: [
        { id: 'g1', workspaceId: 'w1', governorId: '100', name: 'KnightOne' },
        { id: 'g2', workspaceId: 'w1', governorId: '101', name: 'KnightTwo' },
      ],
    });

    const result = await resolveGovernorBySimilarityTx(tx as never, {
      workspaceId: 'w1',
      governorNameRaw: 'OmegaLegend',
      autoThreshold: 0.93,
    });

    expect(result.status).toBe('unresolved');
  });
});

describe('assistant batch safety policy', () => {
  it('treats player/stats actions as safe for auto-confirm', () => {
    const result = evaluateAssistantBatchAutoConfirm([
      { type: 'register_player' },
      { type: 'update_player' },
      { type: 'record_profile_stats' },
    ]);
    expect(result.safe).toBe(true);
    expect(result.unsafeActionTypes).toHaveLength(0);
  });

  it('flags non-safe actions', () => {
    const result = evaluateAssistantBatchAutoConfirm([
      { type: 'register_player' },
      { type: 'create_event' },
      { type: 'delete_event' },
    ]);
    expect(result.safe).toBe(false);
    expect(result.unsafeActionTypes).toEqual(['create_event', 'delete_event']);
  });
});
