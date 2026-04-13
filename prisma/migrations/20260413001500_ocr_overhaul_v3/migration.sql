-- AlterTable
ALTER TABLE "WorkspaceSettings"
ADD COLUMN "fallbackOcrMonthlyBudgetUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN "fallbackOcrProvider" TEXT NOT NULL DEFAULT 'openai',
ADD COLUMN "fallbackOcrModel" TEXT NOT NULL DEFAULT 'gpt-5-mini';

-- AlterTable
ALTER TABLE "OcrExtraction"
ADD COLUMN "profileId" TEXT,
ADD COLUMN "engineVersion" TEXT DEFAULT 'v2',
ADD COLUMN "lowConfidence" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "failureReasons" JSONB,
ADD COLUMN "preprocessingTrace" JSONB,
ADD COLUMN "candidates" JSONB,
ADD COLUMN "fusionDecision" JSONB;

-- CreateTable
CREATE TABLE "OcrProfile" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "profileKey" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sourceTemplateId" TEXT,
    "minWidth" INTEGER,
    "maxWidth" INTEGER,
    "minAspectRatio" DOUBLE PRECISION,
    "maxAspectRatio" DOUBLE PRECISION,
    "calibration" JSONB NOT NULL,
    "regions" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OcrProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OcrCorrectionLog" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "extractionId" TEXT NOT NULL,
    "reviewedByLinkId" TEXT,
    "fieldName" TEXT NOT NULL,
    "previousValue" TEXT,
    "correctedValue" TEXT NOT NULL,
    "reasonCode" TEXT,
    "confidence" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OcrCorrectionLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OcrFallbackUsage" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "periodMonth" TEXT NOT NULL,
    "requestCount" INTEGER NOT NULL DEFAULT 0,
    "projectedUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "blocked" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OcrFallbackUsage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OcrGoldenFixture" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "artifactId" TEXT NOT NULL,
    "profileId" TEXT,
    "label" TEXT,
    "expected" JSONB NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OcrGoldenFixture_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OcrExtraction_profileId_idx" ON "OcrExtraction"("profileId");

-- CreateIndex
CREATE INDEX "OcrExtraction_lowConfidence_idx" ON "OcrExtraction"("lowConfidence");

-- CreateIndex
CREATE INDEX "OcrProfile_workspaceId_isActive_idx" ON "OcrProfile"("workspaceId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "OcrProfile_workspaceId_profileKey_version_key" ON "OcrProfile"("workspaceId", "profileKey", "version");

-- CreateIndex
CREATE INDEX "OcrCorrectionLog_workspaceId_createdAt_idx" ON "OcrCorrectionLog"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "OcrCorrectionLog_fieldName_createdAt_idx" ON "OcrCorrectionLog"("fieldName", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "OcrFallbackUsage_workspaceId_periodMonth_key" ON "OcrFallbackUsage"("workspaceId", "periodMonth");

-- CreateIndex
CREATE INDEX "OcrFallbackUsage_workspaceId_updatedAt_idx" ON "OcrFallbackUsage"("workspaceId", "updatedAt");

-- CreateIndex
CREATE INDEX "OcrGoldenFixture_workspaceId_createdAt_idx" ON "OcrGoldenFixture"("workspaceId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "OcrGoldenFixture_workspaceId_artifactId_key" ON "OcrGoldenFixture"("workspaceId", "artifactId");

-- AddForeignKey
ALTER TABLE "OcrExtraction" ADD CONSTRAINT "OcrExtraction_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "OcrProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OcrProfile" ADD CONSTRAINT "OcrProfile_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OcrCorrectionLog" ADD CONSTRAINT "OcrCorrectionLog_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OcrCorrectionLog" ADD CONSTRAINT "OcrCorrectionLog_extractionId_fkey" FOREIGN KEY ("extractionId") REFERENCES "OcrExtraction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OcrCorrectionLog" ADD CONSTRAINT "OcrCorrectionLog_reviewedByLinkId_fkey" FOREIGN KEY ("reviewedByLinkId") REFERENCES "AccessLink"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OcrFallbackUsage" ADD CONSTRAINT "OcrFallbackUsage_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OcrGoldenFixture" ADD CONSTRAINT "OcrGoldenFixture_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OcrGoldenFixture" ADD CONSTRAINT "OcrGoldenFixture_artifactId_fkey" FOREIGN KEY ("artifactId") REFERENCES "Artifact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OcrGoldenFixture" ADD CONSTRAINT "OcrGoldenFixture_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "OcrProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;
