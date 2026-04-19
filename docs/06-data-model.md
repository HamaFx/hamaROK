# Data Model (Prisma)

Source of truth: `prisma/schema.prisma`.

## Core Entity Groups

## A) Workspace and Access Control

- `Workspace`
- `WorkspaceSettings`
- `AccessLink` (role-scoped token access)

Primary enum:

- `WorkspaceRole`: `OWNER`, `EDITOR`, `VIEWER`

## B) Profile Stats and Events

- `Governor`
- `Event`
- `Snapshot` (event/governor stat point)
- `SnapshotRevision`
- `MetricObservation`
- `MetricSyncBacklog`
- `Anomaly`

Selected enums:

- `EventType`
- `ActivityMetricKey`
- `MetricObservationSourceType`
- `MetricSyncBacklogStatus`
- `AnomalySeverity`

## C) Ingestion and OCR Artifacts

- `ScanJob`
- `Artifact`
- `IngestionTask`
- `OcrExtraction`
- `OcrProfile`
- `OcrCorrectionLog`
- `OcrFallbackUsage`
- `OcrGoldenFixture`

Selected enums:

- `ScanJobStatus`
- `ScanJobSource`
- `ArtifactType`
- `IngestionTaskStatus`
- `OcrProvider`
- `OcrExtractionStatus`

## D) Ranking Domain

- `RankingRun`
- `RankingRow`
- `RankingSnapshot`
- `RankingRevision`
- `GovernorAlias`

Selected enums:

- `IngestionDomain`
- `RankingRunStatus`
- `RankingIdentityStatus`
- `RankingSnapshotStatus`
- `RankingRowReviewAction`

## E) Assistant Domain

- `AssistantConversation`
- `AssistantMessage`
- `AssistantPlan`
- `AssistantAction`
- `AssistantPendingIdentity`

Selected enums:

- `AssistantConversationStatus`
- `AssistantMessageRole`
- `AssistantPlanStatus`
- `AssistantActionStatus`
- `AssistantActionType`
- `AssistantPendingIdentityStatus`

## F) Reporting/Exports/Delivery

- `ExportJob`
- `ReportSnapshot`
- `DeliveryLog`
- `IdempotencyKey`

Selected enums:

- `ExportJobStatus`
- `DeliveryStatus`

## Key Relationship Anchors

1. `Workspace` is root scope for almost all entities.
2. `AccessLink` drives role-based auth and action attribution.
3. `ScanJob` owns ingestion artifacts/tasks and extraction outputs.
4. `RankingRun` -> `RankingRow` -> `RankingSnapshot` forms ranking reconciliation chain.
5. `AssistantPlan` -> `AssistantAction` provides auditable execution records.
6. `AssistantPendingIdentity` bridges unresolved stats writes and later resolution.

## Mutation Consistency Rule

Even with many models, mutation semantics must remain centralized in:

- `src/lib/domain/workspace-actions.ts`

This prevents drift between assistant and direct API behavior.

## Migration Rule

- Apply schema via `npx prisma migrate deploy` in deployed environments.
- Treat `PRECONDITION_FAILED` API errors as migration mismatch indicators.
