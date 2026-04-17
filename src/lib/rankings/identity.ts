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

function loosenDisplayName(value: string): string {
  return String(value || '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([A-Za-z])([0-9])/g, '$1 $2')
    .replace(/([0-9])([A-Za-z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildGovernorNameSearchNeedles(displayName: string): string[] {
  const variants = new Set<string>();
  const direct = normalizeGovernorDisplayName(displayName);
  if (direct.length >= 2) variants.add(direct);

  const loose = normalizeGovernorDisplayName(loosenDisplayName(displayName));
  if (loose.length >= 2) variants.add(loose);

  const firstToken = loose.split(/\s+/)[0]?.trim() || '';
  if (firstToken.length >= 3) variants.add(firstToken);

  const compact = direct.replace(/[^A-Za-z0-9]/g, '');
  if (compact.length >= 4) {
    variants.add(compact.slice(0, 4));
  }

  const needles = new Set<string>();
  for (const variant of variants) {
    needles.add(variant);
    const prefix = variant.slice(0, Math.min(12, variant.length)).trim();
    if (prefix.length >= 2) needles.add(prefix);
  }

  return [...needles];
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

  const generatedNeedles = buildGovernorNameSearchNeedles(displayName);
  const fallbackNeedle = (displayName || candidateAliases[0] || '')
    .replace(/[^A-Za-z0-9]/g, '')
    .slice(0, 4);
  const nameSearchNeedles =
    generatedNeedles.length > 0
      ? generatedNeedles
      : fallbackNeedle.length >= 2
        ? [fallbackNeedle]
        : [];

  if (nameSearchNeedles.length === 0) {
    return {
      status: RankingIdentityStatus.UNRESOLVED,
      governorId: null,
      governorGameId: null,
      reason: 'empty-search-needle',
      normalizedName,
      suggestions: aliasCandidates,
    };
  }

  const nameMatches = await tx.governor.findMany({
    where: {
      workspaceId: args.workspaceId,
      OR: nameSearchNeedles.map((needle) => ({
        name: {
          contains: needle,
          mode: 'insensitive',
        },
      })),
    },
    take: 50,
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
