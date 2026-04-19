import { Prisma, RankingIdentityStatus } from '@prisma/client';
import { splitGovernorNameAndAlliance } from '@/lib/alliances';
import { resolveGovernorByEmbeddingFallback } from '@/lib/embeddings/service';
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

  let embeddingFallback:
    | Awaited<ReturnType<typeof resolveGovernorByEmbeddingFallback>>
    | null = null;
  if (similarity.status !== 'resolved') {
    try {
      embeddingFallback = await resolveGovernorByEmbeddingFallback({
        workspaceId: args.workspaceId,
        query: canonicalName,
        suggestionLimit: 5,
        autoLinkThreshold: similarity.autoThreshold,
      });
    } catch {
      embeddingFallback = null;
    }
  }

  const suggestionMap = new Map<
    string,
    {
      governorId: string;
      governorGameId: string;
      name: string;
      source: 'alias' | 'name';
      score: number;
    }
  >();
  for (const candidate of similarity.candidates) {
    suggestionMap.set(candidate.governorDbId, {
      governorId: candidate.governorDbId,
      governorGameId: candidate.governorGameId,
      name: candidate.governorName,
      source: candidate.mode === 'exact_alias' ? ('alias' as const) : ('name' as const),
      score: candidate.score,
    });
  }
  for (const candidate of embeddingFallback?.candidates || []) {
    const existing = suggestionMap.get(candidate.governorDbId);
    if (!existing || candidate.score > existing.score) {
      suggestionMap.set(candidate.governorDbId, {
        governorId: candidate.governorDbId,
        governorGameId: candidate.governorGameId,
        name: candidate.governorName,
        source: 'name',
        score: candidate.score,
      });
    }
  }

  const suggestions = [...suggestionMap.values()]
    .sort(
      (a, b) =>
        b.score - a.score ||
        a.name.localeCompare(b.name) ||
        a.governorId.localeCompare(b.governorId)
    )
    .slice(0, 5)
    .map((candidate) => ({
      governorId: candidate.governorId,
      governorGameId: candidate.governorGameId,
      name: candidate.name,
      source: candidate.source,
    }));

  if (embeddingFallback?.status === 'resolved') {
    return {
      status: RankingIdentityStatus.AUTO_LINKED,
      governorId: embeddingFallback.governor.governorDbId,
      governorGameId: embeddingFallback.governor.governorGameId,
      reason: 'embedding-fallback-high-confidence',
      normalizedName,
      suggestions,
    };
  }

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
    reason:
      similarity.status === 'ambiguous' || embeddingFallback?.status === 'ambiguous'
        ? 'ambiguous'
        : 'no-unique-match',
    normalizedName,
    suggestions,
  };
}
