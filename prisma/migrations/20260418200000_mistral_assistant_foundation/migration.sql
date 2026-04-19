-- Mistral OCR as first-class provider + assistant persistence.

DO $$
BEGIN
  ALTER TYPE "OcrProvider" ADD VALUE 'MISTRAL';
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TYPE "AssistantConversationStatus" AS ENUM ('ACTIVE', 'ARCHIVED');
CREATE TYPE "AssistantMessageRole" AS ENUM ('SYSTEM', 'USER', 'ASSISTANT', 'TOOL');
CREATE TYPE "AssistantPlanStatus" AS ENUM ('PENDING', 'CONFIRMED', 'EXECUTED', 'DENIED', 'FAILED');
CREATE TYPE "AssistantActionStatus" AS ENUM ('PENDING', 'EXECUTED', 'FAILED', 'SKIPPED');
CREATE TYPE "AssistantActionType" AS ENUM (
  'REGISTER_PLAYER',
  'UPDATE_PLAYER',
  'DELETE_PLAYER',
  'CREATE_EVENT',
  'DELETE_EVENT',
  'RECORD_PROFILE_STATS'
);
CREATE TYPE "AssistantPendingIdentityStatus" AS ENUM ('PENDING', 'RESOLVED', 'DENIED');

ALTER TABLE "WorkspaceSettings"
  ADD COLUMN "ocrEngine" TEXT NOT NULL DEFAULT 'mistral',
  ADD COLUMN "ocrModel" TEXT NOT NULL DEFAULT 'mistral-ocr-latest',
  ADD COLUMN "assistantEnabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "assistantModel" TEXT NOT NULL DEFAULT 'mistral-large-latest',
  ADD COLUMN "assistantLogRetentionDays" INTEGER NOT NULL DEFAULT 180;

CREATE TABLE "AssistantConversation" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "accessLinkId" TEXT,
  "title" TEXT,
  "mistralConversationId" TEXT,
  "status" "AssistantConversationStatus" NOT NULL DEFAULT 'ACTIVE',
  "model" TEXT,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "archivedAt" TIMESTAMP(3),
  CONSTRAINT "AssistantConversation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AssistantMessage" (
  "id" TEXT NOT NULL,
  "conversationId" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "role" "AssistantMessageRole" NOT NULL,
  "content" TEXT NOT NULL,
  "attachments" JSONB,
  "model" TEXT,
  "mistralEntryId" TEXT,
  "mistralPayload" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AssistantMessage_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AssistantPlan" (
  "id" TEXT NOT NULL,
  "conversationId" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "createdByLinkId" TEXT,
  "summary" TEXT NOT NULL,
  "status" "AssistantPlanStatus" NOT NULL DEFAULT 'PENDING',
  "actionsJson" JSONB NOT NULL,
  "confirmationToken" TEXT,
  "confirmedAt" TIMESTAMP(3),
  "executedAt" TIMESTAMP(3),
  "deniedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AssistantPlan_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AssistantAction" (
  "id" TEXT NOT NULL,
  "planId" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "actionType" "AssistantActionType" NOT NULL,
  "actionIndex" INTEGER NOT NULL,
  "status" "AssistantActionStatus" NOT NULL DEFAULT 'PENDING',
  "request" JSONB NOT NULL,
  "result" JSONB,
  "error" TEXT,
  "executedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AssistantAction_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AssistantPendingIdentity" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "conversationId" TEXT,
  "planId" TEXT,
  "requestedByLinkId" TEXT,
  "status" "AssistantPendingIdentityStatus" NOT NULL DEFAULT 'PENDING',
  "reason" TEXT,
  "governorIdRaw" TEXT,
  "governorNameRaw" TEXT NOT NULL,
  "eventId" TEXT,
  "payload" JSONB NOT NULL,
  "candidateGovernorIds" JSONB,
  "resolvedGovernorId" TEXT,
  "resolvedByLinkId" TEXT,
  "resolutionNote" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "resolvedAt" TIMESTAMP(3),
  CONSTRAINT "AssistantPendingIdentity_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AssistantPlan_workspaceId_confirmationToken_key"
ON "AssistantPlan"("workspaceId", "confirmationToken");

CREATE UNIQUE INDEX "AssistantAction_planId_actionIndex_key"
ON "AssistantAction"("planId", "actionIndex");

CREATE INDEX "AssistantConversation_workspaceId_createdAt_idx"
ON "AssistantConversation"("workspaceId", "createdAt");

CREATE INDEX "AssistantConversation_workspaceId_status_updatedAt_idx"
ON "AssistantConversation"("workspaceId", "status", "updatedAt");

CREATE INDEX "AssistantConversation_mistralConversationId_idx"
ON "AssistantConversation"("mistralConversationId");

CREATE INDEX "AssistantMessage_conversationId_createdAt_idx"
ON "AssistantMessage"("conversationId", "createdAt");

CREATE INDEX "AssistantMessage_workspaceId_createdAt_idx"
ON "AssistantMessage"("workspaceId", "createdAt");

CREATE INDEX "AssistantPlan_conversationId_createdAt_idx"
ON "AssistantPlan"("conversationId", "createdAt");

CREATE INDEX "AssistantPlan_workspaceId_status_createdAt_idx"
ON "AssistantPlan"("workspaceId", "status", "createdAt");

CREATE INDEX "AssistantAction_workspaceId_actionType_createdAt_idx"
ON "AssistantAction"("workspaceId", "actionType", "createdAt");

CREATE INDEX "AssistantPendingIdentity_workspaceId_status_createdAt_idx"
ON "AssistantPendingIdentity"("workspaceId", "status", "createdAt");

CREATE INDEX "AssistantPendingIdentity_workspaceId_governorIdRaw_idx"
ON "AssistantPendingIdentity"("workspaceId", "governorIdRaw");

CREATE INDEX "AssistantPendingIdentity_conversationId_createdAt_idx"
ON "AssistantPendingIdentity"("conversationId", "createdAt");

ALTER TABLE "AssistantConversation"
ADD CONSTRAINT "AssistantConversation_workspaceId_fkey"
FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AssistantConversation"
ADD CONSTRAINT "AssistantConversation_accessLinkId_fkey"
FOREIGN KEY ("accessLinkId") REFERENCES "AccessLink"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "AssistantMessage"
ADD CONSTRAINT "AssistantMessage_conversationId_fkey"
FOREIGN KEY ("conversationId") REFERENCES "AssistantConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AssistantMessage"
ADD CONSTRAINT "AssistantMessage_workspaceId_fkey"
FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AssistantPlan"
ADD CONSTRAINT "AssistantPlan_conversationId_fkey"
FOREIGN KEY ("conversationId") REFERENCES "AssistantConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AssistantPlan"
ADD CONSTRAINT "AssistantPlan_workspaceId_fkey"
FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AssistantPlan"
ADD CONSTRAINT "AssistantPlan_createdByLinkId_fkey"
FOREIGN KEY ("createdByLinkId") REFERENCES "AccessLink"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "AssistantAction"
ADD CONSTRAINT "AssistantAction_planId_fkey"
FOREIGN KEY ("planId") REFERENCES "AssistantPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AssistantAction"
ADD CONSTRAINT "AssistantAction_workspaceId_fkey"
FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AssistantPendingIdentity"
ADD CONSTRAINT "AssistantPendingIdentity_workspaceId_fkey"
FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AssistantPendingIdentity"
ADD CONSTRAINT "AssistantPendingIdentity_conversationId_fkey"
FOREIGN KEY ("conversationId") REFERENCES "AssistantConversation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "AssistantPendingIdentity"
ADD CONSTRAINT "AssistantPendingIdentity_planId_fkey"
FOREIGN KEY ("planId") REFERENCES "AssistantPlan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "AssistantPendingIdentity"
ADD CONSTRAINT "AssistantPendingIdentity_requestedByLinkId_fkey"
FOREIGN KEY ("requestedByLinkId") REFERENCES "AccessLink"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "AssistantPendingIdentity"
ADD CONSTRAINT "AssistantPendingIdentity_eventId_fkey"
FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "AssistantPendingIdentity"
ADD CONSTRAINT "AssistantPendingIdentity_resolvedGovernorId_fkey"
FOREIGN KEY ("resolvedGovernorId") REFERENCES "Governor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "AssistantPendingIdentity"
ADD CONSTRAINT "AssistantPendingIdentity_resolvedByLinkId_fkey"
FOREIGN KEY ("resolvedByLinkId") REFERENCES "AccessLink"("id") ON DELETE SET NULL ON UPDATE CASCADE;
