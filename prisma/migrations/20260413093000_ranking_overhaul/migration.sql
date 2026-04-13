-- CreateEnum
CREATE TYPE "IngestionDomain" AS ENUM ('PROFILE_SNAPSHOT', 'RANKING_CAPTURE');

-- CreateEnum
CREATE TYPE "RankingRunStatus" AS ENUM ('RAW', 'REVIEW', 'MERGED', 'FAILED');

-- CreateEnum
CREATE TYPE "RankingIdentityStatus" AS ENUM ('UNRESOLVED', 'AUTO_LINKED', 'MANUAL_LINKED', 'REJECTED');

-- CreateEnum
CREATE TYPE "RankingSnapshotStatus" AS ENUM ('ACTIVE', 'UNRESOLVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "RankingRowReviewAction" AS ENUM ('LINK_TO_GOVERNOR', 'CREATE_ALIAS', 'CORRECT_ROW', 'REJECT_ROW', 'SYSTEM_MERGE');

-- CreateTable
CREATE TABLE "GovernorAlias" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "governorId" TEXT NOT NULL,
    "aliasRaw" TEXT NOT NULL,
    "aliasNormalized" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GovernorAlias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RankingRun" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "eventId" TEXT,
    "artifactId" TEXT,
    "createdByLinkId" TEXT,
    "domain" "IngestionDomain" NOT NULL DEFAULT 'RANKING_CAPTURE',
    "rankingType" TEXT NOT NULL,
    "metricKey" TEXT NOT NULL,
    "headerText" TEXT,
    "source" "ScanJobSource" NOT NULL DEFAULT 'MANUAL_UPLOAD',
    "status" "RankingRunStatus" NOT NULL DEFAULT 'RAW',
    "idempotencyKey" TEXT,
    "captureFingerprint" TEXT,
    "dedupeHash" TEXT,
    "metadata" JSONB,
    "notes" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "RankingRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RankingRow" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "governorId" TEXT,
    "reviewedByLinkId" TEXT,
    "sourceRank" INTEGER,
    "governorNameRaw" TEXT NOT NULL,
    "governorNameNormalized" TEXT NOT NULL,
    "allianceRaw" TEXT,
    "titleRaw" TEXT,
    "metricRaw" TEXT NOT NULL,
    "metricValue" BIGINT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "identityStatus" "RankingIdentityStatus" NOT NULL DEFAULT 'UNRESOLVED',
    "rowHash" TEXT NOT NULL,
    "ocrTrace" JSONB,
    "candidates" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RankingRow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RankingSnapshot" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "rankingType" TEXT NOT NULL,
    "metricKey" TEXT NOT NULL,
    "identityKey" TEXT NOT NULL,
    "governorId" TEXT,
    "governorNameRaw" TEXT NOT NULL,
    "governorNameNormalized" TEXT NOT NULL,
    "sourceRank" INTEGER,
    "metricValue" BIGINT NOT NULL,
    "status" "RankingSnapshotStatus" NOT NULL DEFAULT 'ACTIVE',
    "lastRunId" TEXT,
    "lastRowId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RankingSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RankingRevision" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "runId" TEXT,
    "rowId" TEXT,
    "changedByLinkId" TEXT,
    "action" "RankingRowReviewAction" NOT NULL DEFAULT 'SYSTEM_MERGE',
    "reason" TEXT,
    "previousData" JSONB,
    "nextData" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RankingRevision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GovernorAlias_workspaceId_aliasNormalized_key" ON "GovernorAlias"("workspaceId", "aliasNormalized");

-- CreateIndex
CREATE INDEX "GovernorAlias_governorId_idx" ON "GovernorAlias"("governorId");

-- CreateIndex
CREATE INDEX "GovernorAlias_workspaceId_createdAt_idx" ON "GovernorAlias"("workspaceId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "RankingRun_workspaceId_idempotencyKey_key" ON "RankingRun"("workspaceId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "RankingRun_workspaceId_eventId_createdAt_idx" ON "RankingRun"("workspaceId", "eventId", "createdAt");

-- CreateIndex
CREATE INDEX "RankingRun_workspaceId_rankingType_status_idx" ON "RankingRun"("workspaceId", "rankingType", "status");

-- CreateIndex
CREATE INDEX "RankingRun_captureFingerprint_idx" ON "RankingRun"("captureFingerprint");

-- CreateIndex
CREATE UNIQUE INDEX "RankingRow_runId_rowHash_key" ON "RankingRow"("runId", "rowHash");

-- CreateIndex
CREATE INDEX "RankingRow_workspaceId_identityStatus_createdAt_idx" ON "RankingRow"("workspaceId", "identityStatus", "createdAt");

-- CreateIndex
CREATE INDEX "RankingRow_workspaceId_governorNameNormalized_idx" ON "RankingRow"("workspaceId", "governorNameNormalized");

-- CreateIndex
CREATE INDEX "RankingRow_runId_sourceRank_idx" ON "RankingRow"("runId", "sourceRank");

-- CreateIndex
CREATE UNIQUE INDEX "RankingSnapshot_workspaceId_eventId_rankingType_identityKey_key" ON "RankingSnapshot"("workspaceId", "eventId", "rankingType", "identityKey");

-- CreateIndex
CREATE INDEX "RankingSnapshot_workspaceId_eventId_rankingType_status_idx" ON "RankingSnapshot"("workspaceId", "eventId", "rankingType", "status");

-- CreateIndex
CREATE INDEX "RankingSnapshot_workspaceId_metricValue_sourceRank_governorNameNormalized_idx" ON "RankingSnapshot"("workspaceId", "metricValue", "sourceRank", "governorNameNormalized");

-- CreateIndex
CREATE INDEX "RankingRevision_workspaceId_createdAt_idx" ON "RankingRevision"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "RankingRevision_snapshotId_createdAt_idx" ON "RankingRevision"("snapshotId", "createdAt");

-- AddForeignKey
ALTER TABLE "GovernorAlias" ADD CONSTRAINT "GovernorAlias_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GovernorAlias" ADD CONSTRAINT "GovernorAlias_governorId_fkey" FOREIGN KEY ("governorId") REFERENCES "Governor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RankingRun" ADD CONSTRAINT "RankingRun_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RankingRun" ADD CONSTRAINT "RankingRun_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RankingRun" ADD CONSTRAINT "RankingRun_artifactId_fkey" FOREIGN KEY ("artifactId") REFERENCES "Artifact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RankingRun" ADD CONSTRAINT "RankingRun_createdByLinkId_fkey" FOREIGN KEY ("createdByLinkId") REFERENCES "AccessLink"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RankingRow" ADD CONSTRAINT "RankingRow_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RankingRow" ADD CONSTRAINT "RankingRow_runId_fkey" FOREIGN KEY ("runId") REFERENCES "RankingRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RankingRow" ADD CONSTRAINT "RankingRow_governorId_fkey" FOREIGN KEY ("governorId") REFERENCES "Governor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RankingRow" ADD CONSTRAINT "RankingRow_reviewedByLinkId_fkey" FOREIGN KEY ("reviewedByLinkId") REFERENCES "AccessLink"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RankingSnapshot" ADD CONSTRAINT "RankingSnapshot_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RankingSnapshot" ADD CONSTRAINT "RankingSnapshot_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RankingSnapshot" ADD CONSTRAINT "RankingSnapshot_governorId_fkey" FOREIGN KEY ("governorId") REFERENCES "Governor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RankingSnapshot" ADD CONSTRAINT "RankingSnapshot_lastRunId_fkey" FOREIGN KEY ("lastRunId") REFERENCES "RankingRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RankingSnapshot" ADD CONSTRAINT "RankingSnapshot_lastRowId_fkey" FOREIGN KEY ("lastRowId") REFERENCES "RankingRow"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RankingRevision" ADD CONSTRAINT "RankingRevision_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RankingRevision" ADD CONSTRAINT "RankingRevision_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "RankingSnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RankingRevision" ADD CONSTRAINT "RankingRevision_runId_fkey" FOREIGN KEY ("runId") REFERENCES "RankingRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RankingRevision" ADD CONSTRAINT "RankingRevision_rowId_fkey" FOREIGN KEY ("rowId") REFERENCES "RankingRow"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RankingRevision" ADD CONSTRAINT "RankingRevision_changedByLinkId_fkey" FOREIGN KEY ("changedByLinkId") REFERENCES "AccessLink"("id") ON DELETE SET NULL ON UPDATE CASCADE;
