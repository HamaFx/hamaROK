import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const REMOVED_PATHS = [
  'src/app/activity/page.tsx',
  'src/app/compare/page.tsx',
  'src/app/insights/page.tsx',
  'src/app/api/v2/analytics/route.ts',
  'src/app/api/v2/compare/route.ts',
  'src/app/api/v2/stats/overview/route.ts',
  'src/app/api/v2/rankboards/route.ts',
  'src/app/api/v2/rankboards/[slug]/route.ts',
  'src/app/api/v2/reports/[slug]/route.ts',
  'src/app/api/v2/exports/route.ts',
  'src/app/api/v2/integrations/discord/publish/route.ts',
] as const;

describe('removed surfaces and APIs', () => {
  it('keeps hard-deleted pages/routes removed from app source', () => {
    const repoRoot = process.cwd();
    const leftovers = REMOVED_PATHS.filter((relativePath) =>
      fs.existsSync(path.join(repoRoot, relativePath))
    );

    expect(leftovers).toEqual([]);
  });
});
