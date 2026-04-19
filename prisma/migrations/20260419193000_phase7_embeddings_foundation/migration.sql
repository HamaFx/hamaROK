-- Phase 7: embeddings foundation
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TYPE "EmbeddingCorpus" AS ENUM (
  'GOVERNOR_IDENTITY',
  'EVENTS',
  'OCR_EXTRACTIONS',
  'RANKING',
  'ASSISTANT_AUDIT'
);

CREATE TYPE "EmbeddingTaskOperation" AS ENUM (
  'UPSERT',
  'DELETE',
  'BACKFILL'
);

CREATE TYPE "EmbeddingTaskStatus" AS ENUM (
  'PENDING',
  'PROCESSING',
  'COMPLETED',
  'FAILED'
);

CREATE TABLE "EmbeddingDocument" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "corpus" "EmbeddingCorpus" NOT NULL,
  "entityType" TEXT NOT NULL,
  "entityId" TEXT NOT NULL,
  "chunkIndex" INTEGER NOT NULL,
  "content" TEXT NOT NULL,
  "contentHash" TEXT NOT NULL,
  "model" TEXT NOT NULL,
  "dimensions" INTEGER NOT NULL,
  "embedding" vector(1024) NOT NULL,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "EmbeddingDocument_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EmbeddingTask" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "corpus" "EmbeddingCorpus" NOT NULL,
  "operation" "EmbeddingTaskOperation" NOT NULL,
  "entityType" TEXT NOT NULL,
  "entityId" TEXT,
  "payload" JSONB,
  "status" "EmbeddingTaskStatus" NOT NULL DEFAULT 'PENDING',
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "EmbeddingTask_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EmbeddingDocument_workspaceId_corpus_entityType_entityId_chunkIn_key"
ON "EmbeddingDocument"("workspaceId", "corpus", "entityType", "entityId", "chunkIndex", "model");

CREATE INDEX "EmbeddingDocument_workspaceId_corpus_entityType_entityId_idx"
ON "EmbeddingDocument"("workspaceId", "corpus", "entityType", "entityId");

CREATE INDEX "EmbeddingDocument_workspaceId_corpus_createdAt_idx"
ON "EmbeddingDocument"("workspaceId", "corpus", "createdAt");

CREATE INDEX "EmbeddingTask_workspaceId_status_availableAt_createdAt_idx"
ON "EmbeddingTask"("workspaceId", "status", "availableAt", "createdAt");

CREATE INDEX "EmbeddingTask_workspaceId_corpus_entityType_entityId_idx"
ON "EmbeddingTask"("workspaceId", "corpus", "entityType", "entityId");

CREATE INDEX "EmbeddingTask_status_availableAt_idx"
ON "EmbeddingTask"("status", "availableAt");

CREATE INDEX "EmbeddingDocument_embedding_hnsw_cosine_idx"
ON "EmbeddingDocument"
USING hnsw ("embedding" vector_cosine_ops);

ALTER TABLE "EmbeddingDocument"
ADD CONSTRAINT "EmbeddingDocument_workspaceId_fkey"
FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "EmbeddingTask"
ADD CONSTRAINT "EmbeddingTask_workspaceId_fkey"
FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
