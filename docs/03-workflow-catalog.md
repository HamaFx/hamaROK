# Workflow Catalog

This file documents behavior-oriented workflows with owner files.

## 1) Workspace Bootstrap and Access Links

Goal: create workspace context and role-scoped access links.

- Entry APIs:
  - `POST /api/v2/workspaces/bootstrap`
  - `GET|POST /api/v2/workspaces`
  - `GET|POST /api/v2/workspaces/:id/links`
  - `DELETE /api/v2/workspaces/:id/links/:linkId`
- Owner files:
  - `src/app/api/v2/workspaces/**`
  - `src/lib/workspace-auth.ts`
  - `src/lib/workspace-session.ts`

## 2) Screenshot Upload (Single or Folder)

Goal: ingest many screenshots safely, including large folder batches.

- UI:
  - `src/features/upload/upload-screen.tsx`
  - `src/features/upload/upload-sections.tsx`
- Behavior:
  - folder picker supported
  - high-count/folder mode runs sequentially with pacing
  - retryable classification for `429`, `5xx`, and network errors
- API path:
  - `POST /api/screenshots/upload`
  - `GET|POST /api/v2/scan-jobs`
  - `POST /api/v2/scan-jobs/:id/artifacts`
  - `POST /api/v2/scan-jobs/:id/finalize-upload`

## 3) Ingestion Task Lifecycle

Goal: process artifacts through ingestion status machine.

- Internal APIs:
  - `POST /api/v2/internal/ingestion-tasks/:taskId/start`
  - `POST /api/v2/internal/ingestion-tasks/:taskId/extract`
  - `POST /api/v2/internal/ingestion-tasks/:taskId/complete`
  - `POST /api/v2/internal/ingestion-tasks/:taskId/fail`
- Owners:
  - `src/lib/ingestion-service.ts`
  - `src/lib/ocr/mistral-extraction.ts`
  - `src/app/api/v2/internal/ingestion-tasks/**`

## 4) OCR Review Queue

Goal: human validation of extracted profile data before final acceptance.

- APIs:
  - `GET /api/v2/review-queue`
  - `PATCH /api/v2/review-queue/:id`
- Owners:
  - `src/features/review/*`
  - `src/app/api/v2/review-queue/**`

## 5) Ranking Capture and Ranking Review Queue

Goal: ingest rankboard screenshots, resolve identities, and maintain canonical ranking snapshots.

- APIs:
  - `GET /api/v2/rankings`
  - `GET|POST /api/v2/rankings/runs`
  - `GET /api/v2/rankings/runs/:id`
  - `GET /api/v2/rankings/review`
  - `PATCH /api/v2/rankings/review/:rowId`
  - `POST /api/v2/rankings/review/bulk`
- Owners:
  - `src/lib/rankings/service.ts`
  - `src/lib/rankings/identity.ts`
  - `src/features/rankings-review/*`

## 6) Similarity-Aware Identity Resolution

Goal: improve linking quality when OCR names are imperfect.

- Shared resolver: `src/lib/governor-similarity.ts`
- Current policy:
  - exact ID/alias/name first
  - fuzzy fallback
  - auto-link only when exactly one candidate >= `0.93`
  - multi-high => ambiguous
  - no-high => unresolved with suggestions
- Used by:
  - assistant mutation resolution
  - stats resolution
  - ranking identity linking

## 7) Assistant Manual Chat Flow

Goal: user sends text/images, assistant proposes executable typed actions.

- APIs:
  - `GET|POST /api/v2/assistant/conversations`
  - `GET|POST /api/v2/assistant/conversations/:id/messages`
  - `POST /api/v2/assistant/plans/:id/confirm`
  - `POST /api/v2/assistant/plans/:id/deny`
  - `POST /api/v2/assistant/pending-identities/:id/resolve`
- Core service:
  - `src/lib/assistant/service.ts`

## 8) Assistant Batch Flow (Manual Start)

Goal: process large scan jobs one screenshot at a time.

- APIs:
  - `POST /api/v2/assistant/batches`
  - `GET /api/v2/assistant/batches/:id`
  - `POST /api/v2/assistant/batches/:id/step`
- Rules:
  - one artifact per step
  - safe-only auto-confirm (`register_player`, `update_player`, `record_profile_stats`)
  - non-safe or ambiguous results are flagged/pending
  - batch continues after flagged items

## 9) Analytics/Compare/Activity Reporting

Goal: expose decision surfaces from snapshot and ranking data.

- APIs:
  - `GET /api/v2/analytics`
  - `GET /api/v2/compare`
  - `GET /api/v2/stats/overview`
  - `GET /api/v2/activity/weekly`
  - `GET|PATCH /api/v2/activity/standards`
- Owners:
  - `src/lib/analytics.ts`
  - `src/lib/compare-service.ts`
  - `src/lib/activity/service.ts`

## 10) Background/Maintenance

- Assistant log cleanup endpoint: `POST /api/v2/assistant/conversations/cleanup`
- Metrics sync drain endpoint: `POST /api/v2/sync/metrics/drain`
- Cron/ops trigger endpoint: `POST /api/v2/jobs/run`
