import { OcrExtractionStatus, Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { splitGovernorNameAndAlliance } from '@/lib/alliances';
import { normalizeGovernorAlias, normalizeGovernorDisplayName } from '@/lib/rankings/normalize';

interface Stats {
  seeded: number;
  conflict: number;
  skipped: number;
}

function parseArg(name: string): string | null {
  const token = process.argv.find((entry) => entry.startsWith(`--${name}=`));
  if (!token) return null;
  return token.slice(name.length + 3).trim() || null;
}

function extractNormalizedAlliance(normalized: Prisma.JsonValue | null): string | null {
  if (!normalized || typeof normalized !== 'object' || Array.isArray(normalized)) return null;
  const value = (normalized as Record<string, unknown>).alliance;
  return typeof value === 'string' ? value : null;
}

function extractNormalizedGovernorName(normalized: Prisma.JsonValue | null): string | null {
  if (!normalized || typeof normalized !== 'object' || Array.isArray(normalized)) return null;
  const value = (normalized as Record<string, unknown>).governorName;
  return typeof value === 'string' ? value : null;
}

async function seedAliasConflictSafeTx(
  tx: Prisma.TransactionClient,
  args: {
    workspaceId: string;
    governorDbId: string;
    aliasRaw: string;
    source: string;
  }
): Promise<'seeded' | 'conflict' | 'skipped'> {
  const aliasRaw = normalizeGovernorDisplayName(args.aliasRaw);
  const aliasNormalized = normalizeGovernorAlias(aliasRaw);
  if (!aliasRaw || !aliasNormalized || aliasNormalized === 'unknown') {
    return 'skipped';
  }

  const existing = await tx.governorAlias.findUnique({
    where: {
      workspaceId_aliasNormalized: {
        workspaceId: args.workspaceId,
        aliasNormalized,
      },
    },
    select: {
      id: true,
      governorId: true,
    },
  });

  if (existing && existing.governorId !== args.governorDbId) {
    return 'conflict';
  }

  await tx.governorAlias.upsert({
    where: {
      workspaceId_aliasNormalized: {
        workspaceId: args.workspaceId,
        aliasNormalized,
      },
    },
    create: {
      workspaceId: args.workspaceId,
      governorId: args.governorDbId,
      aliasRaw,
      aliasNormalized,
      confidence: 1,
      source: args.source,
    },
    update: {
      governorId: args.governorDbId,
      aliasRaw,
      confidence: 1,
      source: args.source,
    },
  });

  return 'seeded';
}

async function seedAliasCandidatesTx(
  tx: Prisma.TransactionClient,
  args: {
    workspaceId: string;
    governorDbId: string;
    governorNameRaw: string;
    allianceRaw?: string | null;
    source: string;
  },
  stats: Stats
) {
  const split = splitGovernorNameAndAlliance({
    governorNameRaw: args.governorNameRaw,
    allianceRaw: args.allianceRaw || null,
  });

  const canonicalName = normalizeGovernorDisplayName(split.governorNameRaw || args.governorNameRaw);
  if (!canonicalName) {
    stats.skipped += 1;
    return;
  }

  const aliasCandidates = [canonicalName];
  if (split.trackedAlliance && split.allianceTag) {
    aliasCandidates.push(`[${split.allianceTag}] ${canonicalName}`);
  }

  const seen = new Set<string>();
  for (const aliasCandidate of aliasCandidates) {
    const normalized = normalizeGovernorAlias(aliasCandidate);
    if (!normalized || normalized === 'unknown' || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);

    const result = await seedAliasConflictSafeTx(tx, {
      workspaceId: args.workspaceId,
      governorDbId: args.governorDbId,
      aliasRaw: aliasCandidate,
      source: args.source,
    });
    stats[result] += 1;
  }
}

async function runWorkspace(workspaceId: string) {
  const stats: Stats = {
    seeded: 0,
    conflict: 0,
    skipped: 0,
  };

  await prisma.$transaction(async (tx) => {
    const [governors, approvedExtractions] = await Promise.all([
      tx.governor.findMany({
        where: {
          workspaceId,
        },
        select: {
          id: true,
          governorId: true,
          name: true,
          alliance: true,
        },
      }),
      tx.ocrExtraction.findMany({
        where: {
          status: OcrExtractionStatus.APPROVED,
          scanJob: {
            workspaceId,
          },
        },
        select: {
          governorIdRaw: true,
          governorNameRaw: true,
          normalized: true,
        },
      }),
    ]);

    const governorByGameId = new Map(governors.map((governor) => [governor.governorId, governor]));

    for (const governor of governors) {
      await seedAliasCandidatesTx(
        tx,
        {
          workspaceId,
          governorDbId: governor.id,
          governorNameRaw: governor.name,
          allianceRaw: governor.alliance || null,
          source: 'alias-backfill-governor',
        },
        stats
      );
    }

    for (const extraction of approvedExtractions) {
      const normalizedGameId = String(extraction.governorIdRaw || '').replace(/[^0-9]/g, '');
      const governor = normalizedGameId ? governorByGameId.get(normalizedGameId) : null;
      if (!governor) {
        stats.skipped += 1;
        continue;
      }

      const governorNameRaw =
        normalizeGovernorDisplayName(extraction.governorNameRaw || '') ||
        normalizeGovernorDisplayName(extractNormalizedGovernorName(extraction.normalized) || '') ||
        governor.name;
      const allianceRaw = extractNormalizedAlliance(extraction.normalized);

      await seedAliasCandidatesTx(
        tx,
        {
          workspaceId,
          governorDbId: governor.id,
          governorNameRaw,
          allianceRaw,
          source: 'alias-backfill-approved-extraction',
        },
        stats
      );
    }
  });

  return stats;
}

async function main() {
  const workspaceIdArg = parseArg('workspaceId');

  const workspaceIds: string[] = [];
  if (workspaceIdArg) {
    workspaceIds.push(workspaceIdArg);
  } else {
    const discovered = await prisma.governor.findMany({
      select: {
        workspaceId: true,
      },
      distinct: ['workspaceId'],
    });
    workspaceIds.push(
      ...discovered
        .map((entry) => entry.workspaceId)
        .filter((value): value is string => typeof value === 'string' && value.length > 0)
    );
  }

  if (workspaceIds.length === 0) {
    console.log('No workspaces found.');
    return;
  }

  for (const workspaceId of workspaceIds) {
    const stats = await runWorkspace(workspaceId);
    console.log(
      JSON.stringify(
        {
          workspaceId,
          ...stats,
        },
        null,
        2
      )
    );
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
