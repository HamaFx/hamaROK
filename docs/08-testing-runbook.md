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
- unit tests for embedding fallback resolution and threshold/margin behavior
- integration tests for review queue and merge behavior

Files to inspect:

- `tests/unit/governor-similarity.test.ts`
- `tests/unit/ranking-identity-embedding.test.ts`
- `tests/unit/workspace-actions-embedding.test.ts`
- `tests/integration/*ranking*`

## Embedding/indexing changes

Minimum:

- unit tests for embedding client wrappers and retry handling
- unit tests for retrieval ranking/fusion and fallback policy
- integration checks for enqueue -> process -> status flow

Files to inspect:

- `src/lib/embeddings/service.ts`
- `tests/unit/mistral-client.test.ts`
- `tests/unit/ranking-identity-embedding.test.ts`
- `tests/unit/workspace-actions-embedding.test.ts`

## Deployment smoke (production)

1. `GET /api/healthz` returns `200` and `status: ok`
2. health payload includes embedding readiness (`checks[].name=embedding` and `ok=true`)
3. `/assistant` returns non-404
4. assistant endpoints return auth/validation responses (not framework 404)
5. upload one screenshot and verify:
- scan job creation
- ingestion task completion
- review queue population
6. embedding status route responds:
- `GET /api/v2/workspaces/:id/embeddings/status`

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
- Embedding fallback auto-link must also satisfy configured margin threshold over next candidate.
