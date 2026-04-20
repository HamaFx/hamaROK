# AI Agent Operating Guide

This file is the **primary onboarding map for AI agents** working on this repository.

## 1) What This Project Is

`hamaROK` is a screenshot-driven operations system for Rise of Kingdoms with:

- Mistral OCR + extraction
- Assistant chat that can read screenshots and execute typed workspace actions
- Review queues for OCR/ranking correctness
- Ranking snapshot and identity resolution pipeline

## 2) Runtime Topology

- Frontend + API: Next.js (`src/app`, `src/features`) on Vercel
- Data: Postgres via Prisma (`prisma/schema.prisma`)
- Files: Vercel Blob artifacts
- Async OCR worker control: AWS SQS + Lambda + EC2 (`src/lib/aws`, `scripts/`)

## 3) Non-Negotiable Rules

1. Keep write behavior routed through shared domain services in `src/lib/domain/workspace-actions.ts`.
2. Preserve role gates (`VIEWER`, `EDITOR`, `OWNER`) for every mutation path.
3. Keep assistant write actions confirmation-gated, except explicit batch safe auto-confirm policy.
4. Keep pending-identity flow for ambiguous or unresolved governor resolution.
5. Do not bypass review queues in upload ingestion.
6. Do not hardcode secrets; env-driven only.

## 4) Fast Entry Points by Task

1. Assistant behavior changes
- Start: `src/lib/assistant/service.ts`
- API wrappers: `src/app/api/v2/assistant/**`
- UI state: `src/features/assistant/use-assistant-controller.ts`
- UI layout: `src/features/assistant/assistant-screen.tsx`

2. Upload/ingestion changes
- Start: `src/features/upload/upload-screen.tsx`
- APIs: `src/app/api/v2/scan-jobs/**`
- Task state/progress: `src/lib/ingestion-service.ts`
- OCR extraction: `src/lib/ocr/mistral-extraction.ts`

3. Ranking and identity changes
- Start: `src/lib/rankings/service.ts`
- Identity linking: `src/lib/rankings/identity.ts`
- Shared fuzzy resolver: `src/lib/governor-similarity.ts`

4. Env/deploy/runtime readiness
- Env contract: `src/lib/env.ts`
- Health checks: `src/app/api/healthz/route.ts`
- Deploy docs: `docs/07-deployment-ops.md`
- Full system check: `scripts/final-system-check.sh`

## 5) Assistant Action Contract (Write)

Current typed write actions:

- `register_player`
- `update_player`
- `delete_player`
- `create_event`
- `delete_event`
- `record_profile_stats`

Batch safe auto-confirm whitelist:

- `register_player`
- `update_player`
- `record_profile_stats`

Never auto-confirm in batch:

- `delete_player`
- `create_event`
- `delete_event`

## 6) Similarity and Identity Policy

Shared resolver: `src/lib/governor-similarity.ts`

- Exact governorId/alias/name has highest priority.
- Fuzzy auto-link only when exactly one candidate is above threshold.
- Default threshold: `0.93`.
- Multi-high candidates => ambiguous.
- No-high candidate => unresolved with suggestions.

## 7) API Surface (Primary)

Assistant:

- `POST /api/v2/assistant/conversations`
- `GET /api/v2/assistant/conversations?workspaceId=...`
- `GET /api/v2/assistant/conversations/:id/messages`
- `POST /api/v2/assistant/conversations/:id/messages`
- `POST /api/v2/assistant/plans/:id/confirm`
- `POST /api/v2/assistant/plans/:id/deny`
- `POST /api/v2/assistant/pending-identities/:id/resolve`
- `POST /api/v2/assistant/batches`
- `GET /api/v2/assistant/batches/:id`
- `POST /api/v2/assistant/batches/:id/step`

Ingestion internal:

- `POST /api/v2/internal/ingestion-tasks/:taskId/start`
- `POST /api/v2/internal/ingestion-tasks/:taskId/extract`
- `POST /api/v2/internal/ingestion-tasks/:taskId/complete`
- `POST /api/v2/internal/ingestion-tasks/:taskId/fail`

## 8) Quality Checklist Before Merge

1. `npm run lint`
2. `npm run typecheck`
3. `npm run test`
4. `npm run build`
5. If deployment-related: run `scripts/final-system-check.sh`

## 9) Production Targets

- Vercel app: `https://hamarok.vercel.app`
- AWS prefix: `hama-rok`
- Default OCR engine: `mistral`
- Legacy OCR: emergency rollback path only (`OCR_ENGINE=legacy`)

## 10) Where to Read More

- Docs index: `docs/README.md`
- Agent quickstart: `docs/01-agent-quickstart.md`
- Architecture: `docs/02-system-architecture.md`
- Workflows: `docs/03-workflow-catalog.md`
- API catalog: `docs/04-api-catalog.md`
- Service ownership: `docs/05-service-ownership.md`
- Data model: `docs/06-data-model.md`
- Testing runbook: `docs/08-testing-runbook.md`
- Error reliability: `docs/10-error-reliability.md`
