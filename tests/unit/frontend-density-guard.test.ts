import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();
const SCAN_DIRS = ['src/features', 'src/components', 'src/app'];

function collectFiles(target: string): string[] {
  const absolute = path.join(ROOT, target);
  if (!statSync(absolute).isDirectory()) return [absolute];

  const stack = [absolute];
  const out: string[] = [];

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;
    for (const entry of readdirSync(current)) {
      const next = path.join(current, entry);
      const stat = statSync(next);
      if (stat.isDirectory()) {
        stack.push(next);
        continue;
      }
      if (next.endsWith('.ts') || next.endsWith('.tsx') || next.endsWith('.css')) {
        out.push(next);
      }
    }
  }

  return out;
}

const BANNED_PATTERNS: Array<{ regex: RegExp; message: string }> = [
  {
    regex: /max-\[390px\]:h-(?:8|9|10)\b/g,
    message: 'Found undersized mobile control override (<44px) via max-[390px]:h-*.',
  },
  {
    regex: /\bmin-h-\[220px\]\b/g,
    message: 'Found fixed oversized content-card min-height (min-h-[220px]).',
  },
  {
    regex: /text-white\/\d+/g,
    message: 'Found hard-coded white alpha text class; use semantic text-tier tokens.',
  },
  {
    regex: /text-\[10px\]/g,
    message: 'Found tiny 10px label text; use minimum 12px for content labels.',
  },
  {
    regex: /tracking-\[0\.(?:0[9]|1\d|[2-9]\d)em\]/g,
    message: 'Found excessive letter-spacing; keep tracking at or below 0.08em.',
  },
  {
    regex: /uppercase tracking-\[0\.08em\]/g,
    message: 'Found ad-hoc all-caps micro-label styling; use sentence/title case, reserve uppercase for chip-label/status-only utilities.',
  },
];

describe('frontend density guard', () => {
  it('rejects banned mobile sizing patterns', () => {
    const files = SCAN_DIRS.flatMap((entry) => collectFiles(entry));
    const violations: string[] = [];

    for (const file of files) {
      const content = readFileSync(file, 'utf8');
      const rel = path.relative(ROOT, file);
      for (const rule of BANNED_PATTERNS) {
        rule.regex.lastIndex = 0;
        const matches = [...content.matchAll(rule.regex)];
        if (matches.length === 0) continue;
        violations.push(`${rel}: ${rule.message}`);
      }
    }

    expect(violations).toEqual([]);
  });
});
