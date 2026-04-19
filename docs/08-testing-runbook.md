# Testing and Validation Runbook

## Baseline Commands

```bash
npm run lint
npm run typecheck
npm run test
npm run build
```

## Scope-Based Test Guidance

## Assistant changes

Minimum:

- unit tests for validator/gating logic
- integration tests for confirm/deny/pending identity behavior

Files to inspect:

- `tests/unit/*assistant*`
- `tests/integration/*assistant*`

## Upload/ingestion changes

Minimum:

- integration tests for scan-job/task transitions
- retry classification checks for retryable errors

Files to inspect:

- `tests/integration/*scan*`
- `tests/regression/*ocr*`

## Ranking/identity changes

Minimum:

- unit tests for similarity resolution
- integration tests for review queue and merge behavior

Files to inspect:

- `tests/unit/governor-similarity.test.ts`
- `tests/integration/*ranking*`

## Deployment smoke (production)

1. `GET /api/healthz` returns `200` and `status: ok`
2. `/assistant` returns non-404
3. assistant endpoints return auth/validation responses (not framework 404)
4. upload one screenshot and verify:
- scan job creation
- ingestion task completion
- review queue population

## Failure Triage Order

1. Check `/api/healthz` payload first.
2. Check env contract in `src/lib/env.ts`.
3. Check route-level errors using Vercel logs.
4. Check DB migration state:

```bash
npx prisma migrate status
```

5. Check AWS OCR queue/worker state if ingestion stalls.

## Known Safety Expectations

- Invalid JSON request bodies should return `400 VALIDATION_ERROR`.
- Assistant batch step should not auto-confirm non-safe action plans.
- Similarity auto-link must only occur for exactly one high-confidence candidate.
