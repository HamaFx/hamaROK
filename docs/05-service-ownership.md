# Service Ownership Map

This file maps critical modules to responsibilities and exported entrypoints.

## 1) Assistant Orchestration (`src/lib/assistant/service.ts`)

Responsibilities:

- conversation lifecycle
- message ingestion (text + image evidence)
- read-tool loop and planning
- plan persistence and execution
- pending-identity creation/resolution
- batch run creation/status/step execution
- assistant log cleanup

Key exports:

- `createAssistantConversation`
- `listAssistantConversations`
- `listAssistantConversationMessages`
- `postAssistantMessage`
- `confirmAssistantPlan`
- `denyAssistantPlan`
- `resolveAssistantPendingIdentity`
- `createAssistantBatchRun`
- `getAssistantBatchRun`
- `runAssistantBatchStep`
- `cleanupAssistantLogs`

## 2) Domain Write Rules (`src/lib/domain/workspace-actions.ts`)

Responsibilities:

- canonical mutation rules and validation
- role checks on action classes
- governor/event/stat write behaviors shared by APIs + assistant

Key exports:

- `registerGovernorTx`
- `updateGovernorTx`
- `deleteGovernorTx`
- `createEventTx`
- `deleteEventTx`
- `resolveGovernorForStatsTx`
- `writeProfileStatsTx`
- `requireRoleForAction`

## 3) Similarity Resolver (`src/lib/governor-similarity.ts`)

Responsibilities:

- exact + fuzzy governor resolution
- confidence ranking output
- ambiguity/unresolved handling contract

Key exports:

- `GOVERNOR_SIMILARITY_AUTO_THRESHOLD`
- `resolveGovernorBySimilarityTx`

## 4) Ranking Engine (`src/lib/rankings/service.ts`)

Responsibilities:

- ranking run creation and reconciliation
- review queue operations
- manual/bulk review actions
- canonical ranking snapshots and summary reads

Key exports (selected):

- `createRankingRunWithRows`
- `reconcileRankingRun`
- `listRankingRuns`
- `getRankingRunById`
- `listRankingReviewRows`
- `applyRankingReviewAction`
- `bulkApplyRankingReviewAction`
- `getRankingReviewQueueSummary`
- `listCanonicalRankings`
- `getRankingSummary`

## 5) Ingestion Orchestration (`src/lib/ingestion-service.ts`)

Responsibilities:

- scan-job progress syncing
- ingestion task relation loading
- task response normalization
- metadata merge helpers

Key exports:

- `syncScanJobProgress`
- `syncScanJobProgressWithOptions`
- `getTaskWithRelations`
- `toIngestionTaskResponse`
- `mergeJson`

## 6) OCR Extraction Pipeline (`src/lib/ocr/mistral-extraction.ts`)

Responsibilities:

- screenshot evidence extraction for ingestion
- diagnostics extraction for calibration workflows
- normalized extraction output contracts

Key exports:

- `runMistralIngestionExtraction`
- `runMistralDiagnostics`

## 7) Mistral API Layer (`src/lib/mistral/client.ts`)

Responsibilities:

- OCR API calls
- conversation create/append/fetch
- structured output execution
- tool call extraction helpers
- retry/timeout/error normalization

Key exports:

- `runMistralOcr`
- `startMistralConversation`
- `appendMistralConversation`
- `getMistralConversationMessages`
- `runMistralStructuredOutput`
- `extractFunctionCalls`
- `extractPendingToolCalls`

## 8) Runtime + Auth + API Infrastructure

- Env schema/defaults: `src/lib/env.ts`
- Health/readiness route: `src/app/api/healthz/route.ts`
- Workspace auth: `src/lib/workspace-auth.ts`
- Service auth: `src/lib/service-auth.ts`
- API response envelope: `src/lib/api-response.ts`
- Prisma singleton: `src/lib/prisma.ts`

## 9) UI Controller Ownership

- Assistant state/controller: `src/features/assistant/use-assistant-controller.ts`
- Assistant UI surface: `src/features/assistant/assistant-screen.tsx`
- Upload queue + folder UX: `src/features/upload/upload-screen.tsx`, `src/features/upload/upload-sections.tsx`
- Global nav and tool links: `src/features/shared/navigation.ts`
