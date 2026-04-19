import { Prisma, RankingIdentityStatus } from '@prisma/client';
import { splitGovernorNameAndAlliance } from '@/lib/alliances';
import { resolveGovernorBySimilarityTx } from '@/lib/governor-similarity';
import { normalizeGovernorAlias } from './normalize';

export interface IdentityResolutionResult {
  status: RankingIdentityStatus;
  governorId: string | null;
  governorGameId: string | null;
  reason: string;
  normalizedName: string;
  suggestions: Array<{
    governorId: string;
    governorGameId: string;
    name: string;
    source: 'alias' | 'name';
  }>;
}

type DbClient = Pick<Prisma.TransactionClient, 'governorAlias' | 'governor'>;

export async function resolveRankingIdentity(
  tx: DbClient,
  args: {
    workspaceId: string;
    governorNameRaw: string;
  }
): Promise<IdentityResolutionResult> {
  const split = splitGovernorNameAndAlliance({
    governorNameRaw: args.governorNameRaw,
  });
  const canonicalName = split.governorNameRaw || args.governorNameRaw;
  const normalizedName = normalizeGovernorAlias(canonicalName);

  if (!normalizedName) {
    return {
      status: RankingIdentityStatus.UNRESOLVED,
      governorId: null,
      governorGameId: null,
      reason: 'empty-name',
      normalizedName,
      suggestions: [],
    };
  }

  const similarity = await resolveGovernorBySimilarityTx(tx, {
    workspaceId: args.workspaceId,
    governorNameRaw: canonicalName,
    suggestionLimit: 5,
  });

  const suggestions = similarity.candidates.map((candidate) => ({
    governorId: candidate.governorDbId,
    governorGameId: candidate.governorGameId,
    name: candidate.governorName,
    source: candidate.mode === 'exact_alias' ? ('alias' as const) : ('name' as const),
  }));

  if (similarity.status === 'resolved') {
    const reason =
      similarity.governor.mode === 'exact_alias'
        ? 'alias-exact'
        : similarity.governor.mode === 'exact_name'
          ? 'name-exact'
          : 'name-fuzzy-high-confidence';
    return {
      status: RankingIdentityStatus.AUTO_LINKED,
      governorId: similarity.governor.governorDbId,
      governorGameId: similarity.governor.governorGameId,
      reason,
      normalizedName,
      suggestions,
    };
  }

  return {
    status: RankingIdentityStatus.UNRESOLVED,
    governorId: null,
    governorGameId: null,
    reason: similarity.status === 'ambiguous' ? 'ambiguous' : 'no-unique-match',
    normalizedName,
    suggestions,
  };
}
