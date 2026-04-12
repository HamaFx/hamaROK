-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "EventType" AS ENUM ('KVK_START', 'KVK_END', 'MGE', 'OSIRIS', 'WEEKLY', 'CUSTOM');

-- CreateEnum
CREATE TYPE "WorkspaceRole" AS ENUM ('OWNER', 'EDITOR', 'VIEWER');

-- CreateEnum
CREATE TYPE "ScanJobStatus" AS ENUM ('QUEUED', 'PROCESSING', 'REVIEW', 'READY', 'COMPLETED', 'FAILED', 'CANCELED');

-- CreateEnum
CREATE TYPE "ScanJobSource" AS ENUM ('MANUAL_UPLOAD', 'ADB_RND');

-- CreateEnum
CREATE TYPE "ArtifactType" AS ENUM ('SCREENSHOT', 'OCR_CROP', 'REPORT_CSV', 'REPORT_XLSX', 'REPORT_JSON');

-- CreateEnum
CREATE TYPE "OcrProvider" AS ENUM ('TESSERACT', 'FALLBACK', 'MANUAL');

-- CreateEnum
CREATE TYPE "OcrExtractionStatus" AS ENUM ('RAW', 'REVIEWED', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "AnomalySeverity" AS ENUM ('INFO', 'WARNING', 'ERROR');

-- CreateEnum
CREATE TYPE "ExportJobStatus" AS ENUM ('QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "DeliveryStatus" AS ENUM ('PENDING', 'RETRYING', 'SENT', 'FAILED');

-- CreateTable
CREATE TABLE "Governor" (
    "id" TEXT NOT NULL,
    "governorId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "alliance" TEXT NOT NULL DEFAULT '',
    "workspaceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Governor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Event" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "eventType" "EventType" NOT NULL DEFAULT 'CUSTOM',
    "workspaceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Snapshot" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "governorId" TEXT NOT NULL,
    "workspaceId" TEXT,
    "power" BIGINT NOT NULL,
    "killPoints" BIGINT NOT NULL,
    "t4Kills" BIGINT NOT NULL DEFAULT 0,
    "t5Kills" BIGINT NOT NULL DEFAULT 0,
    "deads" BIGINT NOT NULL,
    "screenshotUrl" TEXT,
    "ocrConfidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Snapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KingdomSettings" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "t4Weight" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "t5Weight" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "deadWeight" DOUBLE PRECISION NOT NULL DEFAULT 5.0,
    "kpPerPowerRatio" DOUBLE PRECISION NOT NULL DEFAULT 0.3,
    "deadPerPowerRatio" DOUBLE PRECISION NOT NULL DEFAULT 0.02,
    "discordWebhook" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KingdomSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Workspace" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kingdomTag" TEXT,
    "description" TEXT,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Workspace_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkspaceSettings" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "t4Weight" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "t5Weight" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "deadWeight" DOUBLE PRECISION NOT NULL DEFAULT 5.0,
    "kpPerPowerRatio" DOUBLE PRECISION NOT NULL DEFAULT 0.3,
    "deadPerPowerRatio" DOUBLE PRECISION NOT NULL DEFAULT 0.02,
    "discordWebhook" TEXT,
    "fallbackOcrEnabled" BOOLEAN NOT NULL DEFAULT false,
    "fallbackOcrDailyLimit" INTEGER NOT NULL DEFAULT 50,
    "featureAdbCaptureRnd" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkspaceSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccessLink" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "role" "WorkspaceRole" NOT NULL DEFAULT 'VIEWER',
    "label" TEXT,
    "tokenHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),

    CONSTRAINT "AccessLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScanJob" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "eventId" TEXT,
    "status" "ScanJobStatus" NOT NULL DEFAULT 'QUEUED',
    "source" "ScanJobSource" NOT NULL DEFAULT 'MANUAL_UPLOAD',
    "idempotencyKey" TEXT,
    "totalFiles" INTEGER NOT NULL DEFAULT 0,
    "processedFiles" INTEGER NOT NULL DEFAULT 0,
    "lowConfidenceFiles" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "ScanJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Artifact" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "scanJobId" TEXT,
    "snapshotId" TEXT,
    "type" "ArtifactType" NOT NULL,
    "url" TEXT NOT NULL,
    "checksum" TEXT,
    "bytes" INTEGER,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Artifact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OcrExtraction" (
    "id" TEXT NOT NULL,
    "scanJobId" TEXT NOT NULL,
    "artifactId" TEXT,
    "provider" "OcrProvider" NOT NULL DEFAULT 'TESSERACT',
    "status" "OcrExtractionStatus" NOT NULL DEFAULT 'RAW',
    "governorIdRaw" TEXT,
    "governorNameRaw" TEXT,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "fields" JSONB NOT NULL,
    "normalized" JSONB,
    "validation" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OcrExtraction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SnapshotRevision" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "changedByLinkId" TEXT,
    "reason" TEXT,
    "previousData" JSONB NOT NULL,
    "nextData" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SnapshotRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Anomaly" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "snapshotId" TEXT,
    "governorId" TEXT,
    "eventAId" TEXT,
    "eventBId" TEXT,
    "code" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "severity" "AnomalySeverity" NOT NULL DEFAULT 'WARNING',
    "context" JSONB,
    "resolved" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "Anomaly_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExportJob" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "eventAId" TEXT,
    "eventBId" TEXT,
    "status" "ExportJobStatus" NOT NULL DEFAULT 'QUEUED',
    "format" TEXT NOT NULL DEFAULT 'xlsx',
    "idempotencyKey" TEXT,
    "request" JSONB,
    "resultArtifactId" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "ExportJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReportSnapshot" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "shareSlug" TEXT NOT NULL,
    "eventAId" TEXT NOT NULL,
    "eventBId" TEXT NOT NULL,
    "createdByLinkId" TEXT,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "ReportSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeliveryLog" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "integration" TEXT NOT NULL,
    "destinationHash" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "DeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeliveryLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IdempotencyKey" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "response" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IdempotencyKey_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Governor_governorId_key" ON "Governor"("governorId");

-- CreateIndex
CREATE INDEX "Governor_governorId_idx" ON "Governor"("governorId");

-- CreateIndex
CREATE INDEX "Governor_name_idx" ON "Governor"("name");

-- CreateIndex
CREATE INDEX "Governor_workspaceId_idx" ON "Governor"("workspaceId");

-- CreateIndex
CREATE INDEX "Event_createdAt_idx" ON "Event"("createdAt");

-- CreateIndex
CREATE INDEX "Event_workspaceId_idx" ON "Event"("workspaceId");

-- CreateIndex
CREATE INDEX "Snapshot_eventId_idx" ON "Snapshot"("eventId");

-- CreateIndex
CREATE INDEX "Snapshot_governorId_idx" ON "Snapshot"("governorId");

-- CreateIndex
CREATE INDEX "Snapshot_workspaceId_idx" ON "Snapshot"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "Snapshot_eventId_governorId_key" ON "Snapshot"("eventId", "governorId");

-- CreateIndex
CREATE UNIQUE INDEX "Workspace_slug_key" ON "Workspace"("slug");

-- CreateIndex
CREATE INDEX "Workspace_createdAt_idx" ON "Workspace"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "WorkspaceSettings_workspaceId_key" ON "WorkspaceSettings"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "AccessLink_tokenHash_key" ON "AccessLink"("tokenHash");

-- CreateIndex
CREATE INDEX "AccessLink_workspaceId_idx" ON "AccessLink"("workspaceId");

-- CreateIndex
CREATE INDEX "AccessLink_expiresAt_idx" ON "AccessLink"("expiresAt");

-- CreateIndex
CREATE INDEX "ScanJob_workspaceId_status_idx" ON "ScanJob"("workspaceId", "status");

-- CreateIndex
CREATE INDEX "ScanJob_createdAt_idx" ON "ScanJob"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ScanJob_workspaceId_idempotencyKey_key" ON "ScanJob"("workspaceId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "Artifact_workspaceId_type_idx" ON "Artifact"("workspaceId", "type");

-- CreateIndex
CREATE INDEX "Artifact_scanJobId_idx" ON "Artifact"("scanJobId");

-- CreateIndex
CREATE INDEX "Artifact_snapshotId_idx" ON "Artifact"("snapshotId");

-- CreateIndex
CREATE INDEX "OcrExtraction_scanJobId_status_idx" ON "OcrExtraction"("scanJobId", "status");

-- CreateIndex
CREATE INDEX "SnapshotRevision_workspaceId_createdAt_idx" ON "SnapshotRevision"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "SnapshotRevision_snapshotId_idx" ON "SnapshotRevision"("snapshotId");

-- CreateIndex
CREATE INDEX "Anomaly_workspaceId_createdAt_idx" ON "Anomaly"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "Anomaly_severity_resolved_idx" ON "Anomaly"("severity", "resolved");

-- CreateIndex
CREATE INDEX "ExportJob_workspaceId_status_idx" ON "ExportJob"("workspaceId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ExportJob_workspaceId_idempotencyKey_key" ON "ExportJob"("workspaceId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "ReportSnapshot_shareSlug_key" ON "ReportSnapshot"("shareSlug");

-- CreateIndex
CREATE INDEX "ReportSnapshot_workspaceId_createdAt_idx" ON "ReportSnapshot"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "DeliveryLog_workspaceId_status_nextAttemptAt_idx" ON "DeliveryLog"("workspaceId", "status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "IdempotencyKey_expiresAt_idx" ON "IdempotencyKey"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "IdempotencyKey_workspaceId_scope_keyHash_key" ON "IdempotencyKey"("workspaceId", "scope", "keyHash");

-- AddForeignKey
ALTER TABLE "Governor" ADD CONSTRAINT "Governor_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Snapshot" ADD CONSTRAINT "Snapshot_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Snapshot" ADD CONSTRAINT "Snapshot_governorId_fkey" FOREIGN KEY ("governorId") REFERENCES "Governor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Snapshot" ADD CONSTRAINT "Snapshot_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceSettings" ADD CONSTRAINT "WorkspaceSettings_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccessLink" ADD CONSTRAINT "AccessLink_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScanJob" ADD CONSTRAINT "ScanJob_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScanJob" ADD CONSTRAINT "ScanJob_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Artifact" ADD CONSTRAINT "Artifact_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Artifact" ADD CONSTRAINT "Artifact_scanJobId_fkey" FOREIGN KEY ("scanJobId") REFERENCES "ScanJob"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Artifact" ADD CONSTRAINT "Artifact_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "Snapshot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OcrExtraction" ADD CONSTRAINT "OcrExtraction_scanJobId_fkey" FOREIGN KEY ("scanJobId") REFERENCES "ScanJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OcrExtraction" ADD CONSTRAINT "OcrExtraction_artifactId_fkey" FOREIGN KEY ("artifactId") REFERENCES "Artifact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SnapshotRevision" ADD CONSTRAINT "SnapshotRevision_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SnapshotRevision" ADD CONSTRAINT "SnapshotRevision_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "Snapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SnapshotRevision" ADD CONSTRAINT "SnapshotRevision_changedByLinkId_fkey" FOREIGN KEY ("changedByLinkId") REFERENCES "AccessLink"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Anomaly" ADD CONSTRAINT "Anomaly_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Anomaly" ADD CONSTRAINT "Anomaly_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "Snapshot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Anomaly" ADD CONSTRAINT "Anomaly_governorId_fkey" FOREIGN KEY ("governorId") REFERENCES "Governor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExportJob" ADD CONSTRAINT "ExportJob_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExportJob" ADD CONSTRAINT "ExportJob_eventAId_fkey" FOREIGN KEY ("eventAId") REFERENCES "Event"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExportJob" ADD CONSTRAINT "ExportJob_eventBId_fkey" FOREIGN KEY ("eventBId") REFERENCES "Event"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExportJob" ADD CONSTRAINT "ExportJob_resultArtifactId_fkey" FOREIGN KEY ("resultArtifactId") REFERENCES "Artifact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportSnapshot" ADD CONSTRAINT "ReportSnapshot_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportSnapshot" ADD CONSTRAINT "ReportSnapshot_eventAId_fkey" FOREIGN KEY ("eventAId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportSnapshot" ADD CONSTRAINT "ReportSnapshot_eventBId_fkey" FOREIGN KEY ("eventBId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportSnapshot" ADD CONSTRAINT "ReportSnapshot_createdByLinkId_fkey" FOREIGN KEY ("createdByLinkId") REFERENCES "AccessLink"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryLog" ADD CONSTRAINT "DeliveryLog_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IdempotencyKey" ADD CONSTRAINT "IdempotencyKey_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

