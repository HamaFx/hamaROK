import { config as loadEnv } from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

loadEnv({ path: '.env.local' });
loadEnv({ path: '.env.production.local', override: true });

const connectionString = process.env.POSTGRES_PRISMA_URL || process.env.DATABASE_URL;
if (!connectionString) throw new Error('No database URL');

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

try {
  const workspaces = await prisma.workspace.findMany({
    select: { id: true, slug: true, name: true, kingdomTag: true, isArchived: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  });
  console.log(JSON.stringify(workspaces, null, 2));
} finally {
  await prisma.$disconnect();
}
