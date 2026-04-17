import { config } from 'dotenv';
config({ path: '.env.local' });

async function main() {
  const { prisma } = await import('@/lib/prisma');
  try {
    const rows = await prisma.ingestionTask.findMany({
      where: { status: 'FAILED' },
      orderBy: { updatedAt: 'desc' },
      take: 30,
      select: {
        id: true,
        scanJobId: true,
        lastError: true,
        metadata: true,
        updatedAt: true,
      },
    });
    console.log(JSON.stringify(rows, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
