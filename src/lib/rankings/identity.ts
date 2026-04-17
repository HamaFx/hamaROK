import { Prisma, RankingIdentityStatus } from '@prisma/client';
import { normalizeGovernorAlias, normalizeGovernorDisplayName } from './normalize';
import { splitGovernorNameAndAlliance } from '@/lib/alliances';

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

function uniqueSuggestions(
  rows: Array<{
    governorId: string;
    governorGameId: string;
    name: string;
    source: 'alias' | 'name';
  }>
) {
  const map = new Map<string, (typeof rows)[number]>();
  for (const row of rows) {
    if (!map.has(row.governorId)) {
      map.set(row.governorId, row);
    }
  }
  return [...map.values()];
}

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
  const normalizedNameRaw = normalizeGovernorAlias(args.governorNameRaw);
  const candidateAliases = [...new Set([normalizedName, normalizedNameRaw].filter(Boolean))];
  const displayName = normalizeGovernorDisplayName(canonicalName);

  if (candidateAliases.length === 0) {
    return {
      status: RankingIdentityStatus.UNRESOLVED,
      governorId: null,
      governorGameId: null,
      reason: 'empty-name',
      normalizedName,
      suggestions: [],
    };
  }

  const aliasMatches = await tx.governorAlias.findMany({
    where: {
      workspaceId: args.workspaceId,
      aliasNormalized: {
        in: candidateAliases,
      },
    },
    select: {
      governor: {
        select: {
          id: true,
          governorId: true,
          name: true,
        },
      },
    },
  });

  const aliasCandidates = uniqueSuggestions(
    aliasMatches.map((match) => ({
      governorId: match.governor.id,
      governorGameId: match.governor.governorId,
      name: match.governor.name,
      source: 'alias' as const,
    }))
  );

  if (aliasCandidates.length === 1) {
    return {
      status: RankingIdentityStatus.AUTO_LINKED,
      governorId: aliasCandidates[0].governorId,
      governorGameId: aliasCandidates[0].governorGameId,
      reason: 'alias-exact',
      normalizedName,
      suggestions: aliasCandidates,
    };
  }

  const nameMatches = await tx.governor.findMany({
    where: {
      workspaceId: args.workspaceId,
      OR: [
        {
          name: {
            equals: displayName,
            mode: 'insensitive',
          },
        },
        {
          name: {
            contains: displayName.slice(0, Math.min(12, displayName.length)),
            mode: 'insensitive',
          },
        },
      ],
    },
    take: 15,
    select: {
      id: true,
      governorId: true,
      name: true,
    },
  });

  const exactNormalized = nameMatches.filter(
    (candidate) => candidateAliases.includes(normalizeGovernorAlias(candidate.name))
  );

  if (exactNormalized.length === 1) {
    return {
      status: RankingIdentityStatus.AUTO_LINKED,
      governorId: exactNormalized[0].id,
      governorGameId: exactNormalized[0].governorId,
      reason: 'name-exact-normalized',
      normalizedName,
      suggestions: exactNormalized.map((item) => ({
        governorId: item.id,
        governorGameId: item.governorId,
        name: item.name,
        source: 'name',
      })),
    };
  }

  const suggestions = uniqueSuggestions([
    ...aliasCandidates,
    ...exactNormalized.map((item) => ({
      governorId: item.id,
      governorGameId: item.governorId,
      name: item.name,
      source: 'name' as const,
    })),
    ...nameMatches.slice(0, 5).map((item) => ({
      governorId: item.id,
      governorGameId: item.governorId,
      name: item.name,
      source: 'name' as const,
    })),
  ]);

  return {
    status: RankingIdentityStatus.UNRESOLVED,
    governorId: null,
    governorGameId: null,
    reason:
      aliasCandidates.length > 1 || exactNormalized.length > 1
        ? 'ambiguous'
        : 'no-unique-match',
    normalizedName,
    suggestions,
  };
}
