# System Architecture

## Topology

- Web + API: Next.js App Router on Vercel (`src/app`)
- Feature UI: React feature modules (`src/features`)
- Domain/services: `src/lib`
- Database: Postgres via Prisma (`prisma/schema.prisma`)
- Vector index: Postgres `pgvector` (embedding vectors in Prisma `Unsupported("vector")` columns)
- Blob storage: Vercel Blob
- OCR worker control: AWS SQS + Lambda + EC2 (`src/lib/aws`, `scripts/`)

## Logical Layers

1. Presentation Layer
- Next.js pages in `src/app/**/page.tsx`
- Feature controllers/screens in `src/features/**`

2. API Layer
- Route handlers in `src/app/api/**/route.ts`
- Uniform API response envelope from `src/lib/api-response.ts`

3. Orchestration Layer
- Assistant orchestration in `src/lib/assistant/service.ts`
- Ingestion progress orchestration in `src/lib/ingestion-service.ts`
- Ranking orchestration in `src/lib/rankings/service.ts`

4. Domain Mutation Layer
- Canonical business writes in `src/lib/domain/workspace-actions.ts`

5. Retrieval/Embedding Layer
- Embedding indexing queue and retrieval in `src/lib/embeddings/service.ts`
- Hybrid retrieval (semantic vector search + lexical candidate search + rank fusion)
- Background task execution via `POST /api/v2/jobs/run`

6. External Integration Layer
- Mistral client in `src/lib/mistral/client.ts`
- OCR extraction pipeline in `src/lib/ocr/mistral-extraction.ts`
- AWS OCR control in `src/lib/aws/*`

7. Data Layer
- Prisma client singleton in `src/lib/prisma.ts`
- Schema in `prisma/schema.prisma`

## Request/Execution Patterns

### Standard API path

```text
HTTP request
  -> route handler (validation + auth)
  -> service/domain function
  -> prisma transaction(s)
  -> normalized API envelope
```

### Upload ingestion path

```text
Upload UI
  -> Blob upload route
  -> scan job/artifact/task APIs
  -> internal ingestion task callbacks
  -> extraction + normalization
  -> review queues + snapshots/ranking rows
```

### Assistant path

```text
Assistant message + optional images
  -> evidence extraction
  -> semantic/lexical retrieval (when enabled)
  -> read-tool loop
  -> write-plan persistence
  -> confirm/deny
  -> domain write execution
```

### Assistant batch path

```text
Create batch from scan job
  -> step endpoint processes one artifact
  -> safe writes auto-confirmed
  -> flagged items remain pending
  -> continue to next artifact
```

### Embedding indexing path

```text
entity mutation or explicit backfill/reindex
  -> enqueue EmbeddingTask (UPSERT|DELETE|BACKFILL)
  -> /api/v2/jobs/run processes pending tasks
  -> call Mistral embeddings endpoint
  -> upsert/delete EmbeddingDocument vectors
```

## Runtime Contracts

- Env schema and defaults: `src/lib/env.ts`
- Health/readiness check: `GET /api/healthz`
- Workspace access tokens and roles: `src/lib/workspace-auth.ts`
- Idempotency primitives: `src/lib/idempotency.ts`
- Embedding readiness checks include vector extension + Mistral key + embedding config validity

## Production Deployment Split

- Vercel: UI/API runtime and server logic
- AWS: queue orchestration and worker lifecycle (scale-to-zero pattern)
- Postgres/Blob: persistent records + vectors + screenshot/artifact blobs
