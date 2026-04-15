-- Metric observation canonical sync + deferred backlog for week-link failures.

CREATE TYPE "MetricObservationSourceType" AS ENUM ('PROFILE', 'RANKBOARD');
CREATE TYPE "MetricSyncBacklogStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');

CREATE TABLE "MetricObservation" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "governorId" TEXT NOT NULL,
  "metricKey" TEXT NOT NULL,
  "metricValue" BIGINT NOT NULL,
  "sourceType" "MetricObservationSourceType" NOT NULL,
  "sourceRank" INTEGER,
  "sourceRefId" TEXT,
  "observedAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MetricObservation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MetricSyncBacklog" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "scanJobId" TEXT,
  "extractionId" TEXT,
  "governorId" TEXT,
  "linkedEventId" TEXT,
  "governorGameId" TEXT NOT NULL,
  "governorNameRaw" TEXT NOT NULL,
  "power" BIGINT NOT NULL,
  "killPoints" BIGINT NOT NULL,
  "t4Kills" BIGINT NOT NULL DEFAULT 0,
  "t5Kills" BIGINT NOT NULL DEFAULT 0,
  "deads" BIGINT NOT NULL DEFAULT 0,
  "status" "MetricSyncBacklogStatus" NOT NULL DEFAULT 'PENDING',
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "sourceRefId" TEXT,
  "observedAt" TIMESTAMP(3) NOT NULL,
  "processedAt" TIMESTAMP(3),
  "lastError" TEXT,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MetricSyncBacklog_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MetricObservation_workspaceId_eventId_governorId_metricKey_key"
ON "MetricObservation"("workspaceId", "eventId", "governorId", "metricKey");

CREATE INDEX "MetricObservation_workspaceId_eventId_metricKey_sourceType_idx"
ON "MetricObservation"("workspaceId", "eventId", "metricKey", "sourceType");

CREATE INDEX "MetricObservation_workspaceId_governorId_metricKey_observedAt_idx"
ON "MetricObservation"("workspaceId", "governorId", "metricKey", "observedAt");

CREATE UNIQUE INDEX "MetricSyncBacklog_workspaceId_extractionId_key"
ON "MetricSyncBacklog"("workspaceId", "extractionId");

CREATE INDEX "MetricSyncBacklog_workspaceId_status_createdAt_idx"
ON "MetricSyncBacklog"("workspaceId", "status", "createdAt");

CREATE INDEX "MetricSyncBacklog_workspaceId_linkedEventId_status_idx"
ON "MetricSyncBacklog"("workspaceId", "linkedEventId", "status");

CREATE INDEX "MetricSyncBacklog_scanJobId_createdAt_idx"
ON "MetricSyncBacklog"("scanJobId", "createdAt");

ALTER TABLE "MetricObservation"
ADD CONSTRAINT "MetricObservation_workspaceId_fkey"
FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "MetricObservation"
ADD CONSTRAINT "MetricObservation_eventId_fkey"
FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "MetricObservation"
ADD CONSTRAINT "MetricObservation_governorId_fkey"
FOREIGN KEY ("governorId") REFERENCES "Governor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "MetricSyncBacklog"
ADD CONSTRAINT "MetricSyncBacklog_workspaceId_fkey"
FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "MetricSyncBacklog"
ADD CONSTRAINT "MetricSyncBacklog_scanJobId_fkey"
FOREIGN KEY ("scanJobId") REFERENCES "ScanJob"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "MetricSyncBacklog"
ADD CONSTRAINT "MetricSyncBacklog_extractionId_fkey"
FOREIGN KEY ("extractionId") REFERENCES "OcrExtraction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "MetricSyncBacklog"
ADD CONSTRAINT "MetricSyncBacklog_governorId_fkey"
FOREIGN KEY ("governorId") REFERENCES "Governor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "MetricSyncBacklog"
ADD CONSTRAINT "MetricSyncBacklog_linkedEventId_fkey"
FOREIGN KEY ("linkedEventId") REFERENCES "Event"("id") ON DELETE SET NULL ON UPDATE CASCADE;
