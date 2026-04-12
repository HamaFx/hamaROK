# Phase 2 Upgrades Implemented (April 12, 2026)

## Advanced APIs
- Added review queue APIs:
  - `GET /api/v2/review-queue`
  - `PATCH /api/v2/review-queue/:id`
- Added analytics API:
  - `GET /api/v2/analytics`
- Added shareable rankboard APIs:
  - `GET /api/v2/rankboards`
  - `POST /api/v2/rankboards`
  - `GET /api/v2/rankboards/:slug`
- Added Discord delivery log API:
  - `GET /api/v2/integrations/discord/deliveries`

## OCR Review Workflow
- Review queue returns:
  - field-level confidence
  - previous snapshot value diff
  - severity triage (`HIGH`, `MEDIUM`, `LOW`)
  - validation warnings/errors
- Review approval flow:
  - upserts snapshot data
  - writes `SnapshotRevision` for audit history
  - persists snapshot-level anomaly records
  - updates scan job readiness state

## Analytics + Reports
- Added trend-line analytics across sequential event pairs.
- Added comparative kingdom/KvK slices across workspaces.
- Added richer top-N contributor breakdowns.
- Added shareable rankboard shortlinks backed by reproducible report snapshots.
- Added export `pack` format (ZIP) with:
  - `comparison.csv`
  - `comparison.xlsx`
  - `report.json`
  - optional trend CSV

## Integrations + Ops
- Discord publishing now supports:
  - retry-on-rate-limit (`429`) using `retry_after`
  - exponential backoff handling
  - idempotent publish requests
  - delivery state tracking and replay via job runner
- Job runner now executes both:
  - queued exports
  - pending/failed discord deliveries
- Added idempotency key cleanup in job runner.

## Security + Reliability
- Added stronger API error handling with safer error redaction.
- Added BigInt-safe JSON envelopes for v2 responses.
- Added deterministic idempotency hashing with stable payload hashing.
- Added secret-scan enforcement to prevent tracking `.env`.
- Removed `.env` from tracked files and added ignore rule.

## New UI Surfaces
- `Review` page (`/review`) for manual OCR triage + approvals.
- `Insights` page (`/insights`) for analytics trends + kingdom slices + rankboard creation.

## Test Expansion
- Added OCR regression harness and golden fixtures.
- Added review queue helper unit tests.
- Added security hashing determinism test.
- Added exporter pack integration test.
- Added workflow smoke test under `tests/e2e`.
