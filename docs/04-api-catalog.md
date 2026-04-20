# API Catalog

All routes currently present in `src/app/api/**` with methods.

## Response/Errors

- Success envelope: `{ data, meta, error: null }`
- Failure envelope: `{ data: null, meta: null, error }`
- Shared error mapper: `src/lib/api-response.ts`
- Error payload reliability fields (additive):  
  `error.category`, `error.retryable`, `error.retryAfterMs`, `error.source`, `error.requestId`, `error.hints`, `error.details`
- Response headers:
  - `X-Request-Id` on all API responses
  - `Retry-After` on retryable throttling/temporary upstream failures

## Auth Model (high level)

- Most `/api/v2/*` routes require workspace access token via existing access-link auth.
- Internal ingestion routes use service auth/signing checks.
- Public health endpoint is unauthenticated.

## Core System

| Route | Methods |
|---|---|
| `/api/healthz` | `GET` |
| `/api/screenshots/upload` | `POST` |

## Workspaces

| Route | Methods |
|---|---|
| `/api/v2/workspaces` | `GET`, `POST` |
| `/api/v2/workspaces/bootstrap` | `POST` |
| `/api/v2/workspaces/[id]/settings` | `GET`, `POST` |
| `/api/v2/workspaces/[id]/links` | `GET`, `POST` |
| `/api/v2/workspaces/[id]/links/[linkId]` | `DELETE` |
| `/api/v2/workspaces/[id]/embeddings/backfill` | `POST` |
| `/api/v2/workspaces/[id]/embeddings/status` | `GET` |
| `/api/v2/workspaces/[id]/embeddings/reindex` | `POST` |

## Assistant

| Route | Methods |
|---|---|
| `/api/v2/assistant/conversations` | `GET`, `POST` |
| `/api/v2/assistant/conversations/[id]` | `PATCH` |
| `/api/v2/assistant/conversations/[id]/messages` | `GET`, `POST` |
| `/api/v2/assistant/conversations/cleanup` | `POST` |
| `/api/v2/assistant/plans/[id]/confirm` | `POST` |
| `/api/v2/assistant/plans/[id]/deny` | `POST` |
| `/api/v2/assistant/pending-identities/[id]/resolve` | `POST` |
| `/api/v2/assistant/batches` | `POST` |
| `/api/v2/assistant/batches/[id]` | `GET` |
| `/api/v2/assistant/batches/[id]/step` | `POST` |

## Scan Jobs / Ingestion

| Route | Methods |
|---|---|
| `/api/v2/scan-jobs` | `GET`, `POST` |
| `/api/v2/scan-jobs/[id]` | `GET` |
| `/api/v2/scan-jobs/[id]/artifacts` | `POST` |
| `/api/v2/scan-jobs/[id]/tasks` | `GET` |
| `/api/v2/scan-jobs/[id]/extractions` | `GET`, `POST` |
| `/api/v2/scan-jobs/[id]/finalize-upload` | `POST` |
| `/api/v2/internal/ingestion-tasks/[taskId]/start` | `POST` |
| `/api/v2/internal/ingestion-tasks/[taskId]/extract` | `POST` |
| `/api/v2/internal/ingestion-tasks/[taskId]/complete` | `POST` |
| `/api/v2/internal/ingestion-tasks/[taskId]/fail` | `POST` |

## OCR / Calibration

| Route | Methods |
|---|---|
| `/api/v2/ocr/run` | `POST` |
| `/api/v2/ocr/fallback` | `POST` |
| `/api/v2/ocr/metrics` | `GET` |
| `/api/v2/ocr/profiles` | `GET`, `POST` |
| `/api/v2/ocr/golden-fixtures` | `GET`, `POST` |

## Governors / Events / Stats

| Route | Methods |
|---|---|
| `/api/v2/governors` | `GET` |
| `/api/v2/governors/register` | `POST` |
| `/api/v2/governors/[id]` | `GET`, `PATCH`, `DELETE` |
| `/api/v2/governors/[id]/timeline` | `GET` |
| `/api/v2/governors/[id]/weekly-activity` | `GET` |
| `/api/v2/events` | `GET`, `POST` |
| `/api/v2/events/[id]` | `GET`, `DELETE` |
| `/api/v2/events/weekly` | `GET`, `PATCH` |
| `/api/v2/stats/overview` | `GET` |

## Review Queues

| Route | Methods |
|---|---|
| `/api/v2/review-queue` | `GET` |
| `/api/v2/review-queue/[id]` | `PATCH` |
| `/api/v2/rankings/review` | `GET` |
| `/api/v2/rankings/review/[rowId]` | `PATCH` |
| `/api/v2/rankings/review/bulk` | `POST` |
| `/api/v2/rankings/review/summary` | `GET` |

## Rankings / Boards / Reports

| Route | Methods |
|---|---|
| `/api/v2/rankings` | `GET` |
| `/api/v2/rankings/runs` | `GET`, `POST` |
| `/api/v2/rankings/runs/[id]` | `GET` |
| `/api/v2/rankings/summary` | `GET` |
| `/api/v2/rankboards` | `GET`, `POST` |
| `/api/v2/rankboards/[slug]` | `GET` |
| `/api/v2/reports/[slug]` | `GET` |

## Analytics / Compare / Activity

| Route | Methods |
|---|---|
| `/api/v2/analytics` | `GET` |
| `/api/v2/compare` | `GET` |
| `/api/v2/activity/weekly` | `GET` |
| `/api/v2/activity/weeks` | `GET` |
| `/api/v2/activity/standards` | `GET`, `PATCH` |
| `/api/v2/activity/broadcast` | `POST` |

## Exports / Integrations / Infra / Jobs

| Route | Methods |
|---|---|
| `/api/v2/exports` | `GET`, `POST` |
| `/api/v2/integrations/discord/deliveries` | `GET` |
| `/api/v2/integrations/discord/publish` | `POST` |
| `/api/v2/infra/aws-ocr` | `GET`, `POST` |
| `/api/v2/jobs/run` | `POST` |
| `/api/v2/sync/metrics/drain` | `POST` |

## API Ownership Anchors

- Assistant orchestration: `src/lib/assistant/service.ts`
- Ranking orchestration: `src/lib/rankings/service.ts`
- Domain write rules: `src/lib/domain/workspace-actions.ts`
- Ingestion helpers: `src/lib/ingestion-service.ts`
- External model client: `src/lib/mistral/client.ts`
- Embedding indexing/retrieval: `src/lib/embeddings/service.ts`
