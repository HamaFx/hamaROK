import { Prisma } from '@prisma/client';
import {
  normalizeGovernorAlias,
  normalizeGovernorDisplayName,
} from '@/lib/rankings/normalize';

export const GOVERNOR_SIMILARITY_AUTO_THRESHOLD = 0.93;
const GOVERNOR_SIMILARITY_SUGGEST_THRESHOLD = 0.72;

export type GovernorSimilarityMatchMode = 'exact_alias' | 'exact_name' | 'fuzzy';

export interface GovernorSimilarityCandidate {
  governorDbId: string;
  governorGameId: string;
  governorName: string;
  score: number;
  mode: GovernorSimilarityMatchMode;
}

export type GovernorSimilarityResolution =
  | {
      status: 'resolved';
      reason: string;
      autoThreshold: number;
      governor: GovernorSimilarityCandidate;
      candidates: GovernorSimilarityCandidate[];
    }
  | {
      status: 'ambiguous';
      reason: string;
      autoThreshold: number;
      candidates: GovernorSimilarityCandidate[];
    }
  | {
      status: 'unresolved';
      reason: string;
      autoThreshold: number;
      candidates: GovernorSimilarityCandidate[];
    };

type SimilarityDbClient = Pick<Prisma.TransactionClient, 'governor' | 'governorAlias'>;

function roundScore(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, Math.round(value * 10_000) / 10_000));
}

function jaro(a: string, b: string): number {
  if (a === b) return 1;
  if (!a || !b) return 0;

  const matchDistance = Math.floor(Math.max(a.length, b.length) / 2) - 1;
  const aMatches = new Array<boolean>(a.length).fill(false);
  const bMatches = new Array<boolean>(b.length).fill(false);
  let matches = 0;

  for (let i = 0; i < a.length; i += 1) {
    const start = Math.max(0, i - matchDistance);
    const end = Math.min(i + matchDistance + 1, b.length);
    for (let j = start; j < end; j += 1) {
      if (bMatches[j]) continue;
      if (a[i] !== b[j]) continue;
      aMatches[i] = true;
      bMatches[j] = true;
      matches += 1;
      break;
    }
  }

  if (matches === 0) return 0;

  let transpositions = 0;
  let k = 0;
  for (let i = 0; i < a.length; i += 1) {
    if (!aMatches[i]) continue;
    while (!bMatches[k]) k += 1;
    if (a[i] !== b[k]) transpositions += 1;
    k += 1;
  }

  const t = transpositions / 2;
  return (
    (matches / a.length + matches / b.length + (matches - t) / matches) / 3
  );
}

function jaroWinkler(a: string, b: string): number {
  const j = jaro(a, b);
  let prefix = 0;
  const maxPrefix = Math.min(4, a.length, b.length);
  while (prefix < maxPrefix && a[prefix] === b[prefix]) {
    prefix += 1;
  }
  return j + prefix * 0.1 * (1 - j);
}

function computeNameSimilarity(query: string, candidate: string): number {
  if (!query || !candidate) return 0;
  if (query === candidate) return 1;

  let score = jaroWinkler(query, candidate);
  if (query.length >= 3 && candidate.startsWith(query)) {
    score = Math.max(score, 0.95);
  } else if (candidate.length >= 3 && query.startsWith(candidate)) {
    score = Math.max(score, 0.94);
  } else if (query.length >= 4 && candidate.includes(query)) {
    score = Math.max(score, 0.9);
  } else if (candidate.length >= 4 && query.includes(candidate)) {
    score = Math.max(score, 0.9);
  }

  return roundScore(score);
}

function mergeUniqueCandidates(
  rows: GovernorSimilarityCandidate[]
): GovernorSimilarityCandidate[] {
  const map = new Map<string, GovernorSimilarityCandidate>();
  for (const row of rows) {
    const prev = map.get(row.governorDbId);
    if (!prev || row.score > prev.score) {
      map.set(row.governorDbId, row);
    }
  }
  return [...map.values()];
}

export async function resolveGovernorBySimilarityTx(
  tx: SimilarityDbClient,
  args: {
    workspaceId: string;
    governorNameRaw: string;
    autoThreshold?: number;
    suggestionLimit?: number;
  }
): Promise<GovernorSimilarityResolution> {
  const workspaceId = String(args.workspaceId || '').trim();
  const rawName = String(args.governorNameRaw || '').trim();
  const autoThreshold = Number.isFinite(args.autoThreshold)
    ? Number(args.autoThreshold)
    : GOVERNOR_SIMILARITY_AUTO_THRESHOLD;
  const suggestionLimit = Math.max(
    1,
    Math.min(20, Number(args.suggestionLimit || 5))
  );

  const normalizedAlias = normalizeGovernorAlias(rawName);
  const normalizedDisplay = normalizeGovernorDisplayName(rawName);
  if (!workspaceId || !normalizedAlias) {
    return {
      status: 'unresolved',
      reason: 'Governor name could not be normalized for lookup.',
      autoThreshold,
      candidates: [],
    };
  }

  const [aliasHits, nameHits] = await Promise.all([
    tx.governorAlias.findMany({
      where: {
        workspaceId,
        aliasNormalized: normalizedAlias,
      },
      include: {
        governor: {
          select: {
            id: true,
            governorId: true,
            name: true,
          },
        },
      },
      take: 20,
    }),
    tx.governor.findMany({
      where: {
        workspaceId,
        name: {
          equals: rawName,
          mode: 'insensitive',
        },
      },
      select: {
        id: true,
        governorId: true,
        name: true,
      },
      take: 20,
    }),
  ]);

  const exactCandidates = mergeUniqueCandidates([
    ...aliasHits.map((hit) => ({
      governorDbId: hit.governor.id,
      governorGameId: hit.governor.governorId,
      governorName: hit.governor.name,
      score: 1,
      mode: 'exact_alias' as const,
    })),
    ...nameHits.map((hit) => ({
      governorDbId: hit.id,
      governorGameId: hit.governorId,
      governorName: hit.name,
      score: 1,
      mode: 'exact_name' as const,
    })),
  ]);

  if (exactCandidates.length === 1) {
    return {
      status: 'resolved',
      reason: 'Exact governor match.',
      autoThreshold,
      governor: exactCandidates[0],
      candidates: exactCandidates,
    };
  }

  if (exactCandidates.length > 1) {
    return {
      status: 'ambiguous',
      reason: 'Multiple exact governor matches.',
      autoThreshold,
      candidates: exactCandidates
        .sort((a, b) => a.governorName.localeCompare(b.governorName))
        .slice(0, suggestionLimit),
    };
  }

  const governorRows = await tx.governor.findMany({
    where: {
      workspaceId,
    },
    select: {
      id: true,
      governorId: true,
      name: true,
    },
    take: 5000,
  });

  const fuzzyRows = governorRows
    .map((row) => {
      const candidateAlias = normalizeGovernorAlias(row.name);
      const candidateDisplay = normalizeGovernorDisplayName(row.name);
      const aliasScore = computeNameSimilarity(normalizedAlias, candidateAlias);
      const displayScore = computeNameSimilarity(normalizedDisplay, candidateDisplay);
      const score = roundScore(Math.max(aliasScore, displayScore));
      return {
        governorDbId: row.id,
        governorGameId: row.governorId,
        governorName: row.name,
        score,
        mode: 'fuzzy' as const,
      };
    })
    .filter((row) => row.score >= GOVERNOR_SIMILARITY_SUGGEST_THRESHOLD)
    .sort(
      (a, b) =>
        b.score - a.score ||
        a.governorName.localeCompare(b.governorName) ||
        a.governorDbId.localeCompare(b.governorDbId)
    );

  const highConfidence = fuzzyRows.filter((row) => row.score >= autoThreshold);

  if (highConfidence.length === 1) {
    return {
      status: 'resolved',
      reason: `Single high-confidence fuzzy match (>= ${Math.round(autoThreshold * 100)}%).`,
      autoThreshold,
      governor: highConfidence[0],
      candidates: fuzzyRows.slice(0, suggestionLimit),
    };
  }

  if (highConfidence.length > 1) {
    return {
      status: 'ambiguous',
      reason: `Multiple high-confidence fuzzy matches (>= ${Math.round(autoThreshold * 100)}%).`,
      autoThreshold,
      candidates: highConfidence.slice(0, suggestionLimit),
    };
  }

  return {
    status: 'unresolved',
    reason: `No high-confidence fuzzy match found (>= ${Math.round(autoThreshold * 100)}%).`,
    autoThreshold,
    candidates: fuzzyRows.slice(0, suggestionLimit),
  };
}
