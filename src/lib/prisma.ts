import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { ensureRuntimeReady, getDatabaseUrl } from '@/lib/env';

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

ensureRuntimeReady();
const connectionString = getDatabaseUrl();

const adapter = new PrismaPg({
  connectionString,
  max: process.env.NODE_ENV === 'production' ? 10 : 5,
});

export const prisma = globalForPrisma.prisma ?? new PrismaClient({ adapter });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}
