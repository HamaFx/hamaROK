#!/usr/bin/env node
import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

try {
  execSync('git ls-files --error-unmatch .env', { stdio: 'ignore' });
  console.error(
    '[secret-scan] Failed: `.env` is tracked by git. Remove it from version control and keep only `.env.example`.'
  );
  process.exit(1);
} catch {
  // `.env` is not tracked, good.
}

const trackedFiles = execSync('git ls-files', { encoding: 'utf8' })
  .split('\n')
  .filter(Boolean)
  .filter(
    (file) =>
      !file.endsWith('.png') &&
      !file.endsWith('.jpg') &&
      !file.endsWith('.ico') &&
      !file.endsWith('.md') &&
      !file.startsWith('docs/')
  );

const patterns = [
  { name: 'Vercel Blob RW token', regex: /vercel_blob_rw_[A-Za-z0-9_]+/g },
  { name: 'Vercel OIDC token', regex: /\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b/g },
  { name: 'Hardcoded Postgres URL', regex: /postgres(?:ql)?:\/\/(?!dummy:dummy|user:password@host)[^\s"']+/g },
  { name: 'Discord webhook', regex: /https:\/\/discord\.com\/api\/webhooks\/[A-Za-z0-9/_-]+/g },
  { name: 'Hardcoded signing secret', regex: /APP_SIGNING_SECRET\s*=\s*["']?[A-Za-z0-9=_-]{16,}/g },
];

const ignoreFiles = new Set(['.env.example']);
let hasFinding = false;

for (const file of trackedFiles) {
  if (ignoreFiles.has(file)) continue;
  if (!existsSync(file)) continue;
  const content = readFileSync(file, 'utf8');
  for (const pattern of patterns) {
    const matches = [...content.matchAll(pattern.regex)];
    if (matches.length > 0) {
      hasFinding = true;
      console.error(`\n[secret-scan] ${pattern.name} detected in ${file}`);
      for (const match of matches.slice(0, 3)) {
        console.error(`  -> ${match[0].slice(0, 80)}`);
      }
    }
  }
}

if (hasFinding) {
  console.error('\n[secret-scan] Failed: potential secrets found in tracked files.');
  process.exit(1);
}

console.log('[secret-scan] Passed: no obvious secrets found in tracked files.');
