-- CreateEnum
CREATE TYPE "IngestionTaskStatus" AS ENUM ('QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "IngestionTask" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "scanJobId" TEXT NOT NULL,
    "artifactId" TEXT NOT NULL,
    "eventId" TEXT,
    "status" "IngestionTaskStatus" NOT NULL DEFAULT 'QUEUED',
    "archetypeHint" TEXT,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "idempotencyKey" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IngestionTask_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "IngestionTask_workspaceId_idempotencyKey_key" ON "IngestionTask"("workspaceId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "IngestionTask_scanJobId_artifactId_key" ON "IngestionTask"("scanJobId", "artifactId");

-- CreateIndex
CREATE INDEX "IngestionTask_workspaceId_status_createdAt_idx" ON "IngestionTask"("workspaceId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "IngestionTask_scanJobId_createdAt_idx" ON "IngestionTask"("scanJobId", "createdAt");

-- CreateIndex
CREATE INDEX "IngestionTask_artifactId_idx" ON "IngestionTask"("artifactId");

-- AddForeignKey
ALTER TABLE "IngestionTask" ADD CONSTRAINT "IngestionTask_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IngestionTask" ADD CONSTRAINT "IngestionTask_scanJobId_fkey" FOREIGN KEY ("scanJobId") REFERENCES "ScanJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IngestionTask" ADD CONSTRAINT "IngestionTask_artifactId_fkey" FOREIGN KEY ("artifactId") REFERENCES "Artifact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IngestionTask" ADD CONSTRAINT "IngestionTask_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE SET NULL ON UPDATE CASCADE;
