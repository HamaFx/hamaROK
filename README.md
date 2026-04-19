# hamaROK

AI-assisted Rise of Kingdoms operations platform for screenshot ingestion, player/stat management, ranking reconciliation, and weekly analytics.

## Current System (April 2026)

- OCR/default extraction engine: **Mistral** (`OCR_ENGINE=mistral`)
- Assistant model: **Mistral Large**
- Ingestion topology: **Upload -> Scan Job -> Ingestion Tasks -> Review Queues**
- Assistant execution model: **plan first, write actions require confirmation** (batch mode can auto-confirm safe write types)
- Production URL: `https://hamarok.vercel.app`

## Architecture

- Web + API: Next.js App Router (`src/app`) on Vercel
- Database: Postgres via Prisma (`prisma/schema.prisma`)
- File artifacts: Vercel Blob
- OCR worker orchestration: AWS SQS + Lambda + EC2 worker scripts (`scripts/`)

## Core Workflows

1. Upload screenshots
- UI: `src/features/upload/upload-screen.tsx`
- APIs: `src/app/api/v2/scan-jobs/**`, `src/app/api/screenshots/upload/route.ts`
- Processing: `src/lib/ingestion-service.ts`, `src/lib/ocr/mistral-extraction.ts`

2. Assistant chat + screenshots
- UI: `src/features/assistant/assistant-screen.tsx`
- APIs: `src/app/api/v2/assistant/**`
- Orchestration: `src/lib/assistant/service.ts`
- Shared write domain: `src/lib/domain/workspace-actions.ts`

3. Assistant batch runner (one screenshot per step)
- APIs: `POST/GET /api/v2/assistant/batches`, `POST /api/v2/assistant/batches/:id/step`
- Logic: `createAssistantBatchRun`, `runAssistantBatchStep` in `src/lib/assistant/service.ts`

4. Ranking ingest + identity resolution
- APIs: `src/app/api/v2/rankings/**`
- Services: `src/lib/rankings/service.ts`, `src/lib/rankings/identity.ts`
- Similarity resolver: `src/lib/governor-similarity.ts`

## Local Setup

1. Install dependencies
```bash
npm install
```

2. Configure environment
- Copy `.env.example` to `.env.local`
- Set at minimum:
  - `POSTGRES_PRISMA_URL` (or `DATABASE_URL`)
  - `APP_SIGNING_SECRET`
  - `MISTRAL_API_KEY`
  - `OCR_ENGINE=mistral`

3. Apply migrations and generate client
```bash
npx prisma migrate deploy
npm run postinstall
```

4. Start app
```bash
npm run dev
```

## Quality Gates

```bash
npm run lint
npm run typecheck
npm run test
npm run build
```

## Deployment

- App/API deploy: Vercel (`npx vercel deploy --prod`)
- AWS OCR infra scripts:
  - `scripts/setup-aws-ocr-scale-zero.sh`
  - `scripts/configure-vercel-aws-ocr.sh`
- System verification:
  - `scripts/final-system-check.sh`

## Documentation Map

- Agent onboarding rules: `AGENTS.md`
- Full AI-agent docs index: `docs/README.md`
- Architecture and workflows: `docs/02-system-architecture.md`, `docs/03-workflow-catalog.md`
- API inventory: `docs/04-api-catalog.md`
- Data model and ownership: `docs/05-service-ownership.md`, `docs/06-data-model.md`
- Deployment and testing runbooks: `docs/07-deployment-ops.md`, `docs/08-testing-runbook.md`
