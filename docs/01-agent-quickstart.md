# Agent Quickstart

## Project Identity

- Name: `hamaROK`
- Product: AI-assisted operations platform for Rise of Kingdoms screenshot ingestion, ranking reconciliation, and assistant-driven workspace actions
- Production URL: `https://hamarok.vercel.app`

## Runtime Defaults

- OCR engine default: `mistral`
- OCR model default: `mistral-ocr-latest`
- Assistant model default: `mistral-large-latest`
- Similarity auto-link threshold: `0.93`
- Legacy OCR path: available only for emergency rollback (`OCR_ENGINE=legacy`)

## First Files to Open

1. `AGENTS.md`
2. `src/lib/env.ts`
3. `src/app/api/healthz/route.ts`
4. `src/lib/assistant/service.ts`
5. `src/lib/domain/workspace-actions.ts`
6. `prisma/schema.prisma`

## Required Local Commands

```bash
npm install
npx prisma migrate deploy
npm run dev
```

Before shipping changes:

```bash
npm run lint
npm run typecheck
npm run test
npm run build
```

## High-Risk Invariants

1. All write behavior must stay in shared domain services (`src/lib/domain/workspace-actions.ts`).
2. Role gates (`VIEWER`/`EDITOR`/`OWNER`) must not be bypassed.
3. Assistant writes require plan confirmation except explicit batch safe auto-confirm policy.
4. Pending identity flow must be preserved for ambiguous/unresolved governor matches.
5. Upload ingestion must continue populating OCR Review and Rank Review queues.
6. Never hardcode secrets.

## Where to Edit by Intent

- Assistant orchestration: `src/lib/assistant/service.ts`
- Assistant UI: `src/features/assistant/*`
- Upload/folder flow: `src/features/upload/*`
- Ingestion task sync: `src/lib/ingestion-service.ts`
- OCR extraction: `src/lib/ocr/mistral-extraction.ts`
- Similarity matching: `src/lib/governor-similarity.ts`
- Ranking merge/review logic: `src/lib/rankings/service.ts`
