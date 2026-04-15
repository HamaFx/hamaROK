const env = process.env as Record<string, string | undefined>;

if (!env.POSTGRES_PRISMA_URL && !env.DATABASE_URL) {
  // Prevent import-time failures in modules that initialize Prisma in tests.
  env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test_db?sslmode=disable';
}
