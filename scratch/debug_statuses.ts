import { PrismaClient, RankingIdentityStatus } from '@prisma/client';

const prisma = new PrismaClient();

async function run() {
  const workspaceId = process.argv[2];
  if (!workspaceId) {
    console.error('Usage: ts-node debug.ts <workspaceId>');
    return;
  }

  const counts = await prisma.rankingRow.groupBy({
    by: ['identityStatus'],
    where: { workspaceId },
    _count: true,
  });

  console.log('Status Counts:', counts);

  const unresolvedWithSuggestions = await prisma.rankingRow.count({
    where: {
      workspaceId,
      identityStatus: RankingIdentityStatus.UNRESOLVED,
      candidates: { not: {} },
    },
  });

  console.log('Unresolved with suggestions:', unresolvedWithSuggestions);
}

run().catch(console.error).finally(() => prisma.$disconnect());
