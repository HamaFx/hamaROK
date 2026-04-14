-- Hot-path index upgrades for polling, review queue, and ranking sort/filter queries.
CREATE INDEX IF NOT EXISTS "ScanJob_workspaceId_createdAt_idx"
ON "ScanJob"("workspaceId", "createdAt");

CREATE INDEX IF NOT EXISTS "IngestionTask_scanJobId_status_createdAt_idx"
ON "IngestionTask"("scanJobId", "status", "createdAt");

CREATE INDEX IF NOT EXISTS "OcrExtraction_scanJobId_status_createdAt_idx"
ON "OcrExtraction"("scanJobId", "status", "createdAt");

CREATE INDEX IF NOT EXISTS "RankingRow_workspaceId_runId_identityStatus_createdAt_idx"
ON "RankingRow"("workspaceId", "runId", "identityStatus", "createdAt");

CREATE INDEX IF NOT EXISTS "RankingSnapshot_ws_evt_type_metric_status_sort_idx"
ON "RankingSnapshot"(
  "workspaceId",
  "eventId",
  "rankingType",
  "metricKey",
  "status",
  "metricValue",
  "sourceRank",
  "governorNameNormalized"
);
