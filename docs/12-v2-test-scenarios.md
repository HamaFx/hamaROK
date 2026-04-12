# RoK Command Center v2 Acceptance Scenarios

## Legacy Compatibility
1. Create event with legacy `/api/events`.
2. Upload OCR batch with `/upload`.
3. Compare events with `/compare`.
4. Confirm no runtime errors and expected leaderboard output.

## Workspace Isolation
1. Create workspace A and B.
2. Create separate events in each workspace.
3. Use workspace A token to fetch workspace B events.
4. Expect `403 FORBIDDEN`.

## Scan Job + OCR Extraction
1. Create scan job with idempotency key.
2. Re-submit same key and expect idempotent replay.
3. Submit extraction entries with field confidence + validation payload.
4. Confirm scan job counters update.

## Compare + Anomaly Detection
1. Compare two workspace events with known negative deltas.
2. Validate anomalies include regression/error codes.
3. Validate summary contains score buckets and top contributors.

## Export + Artifact
1. Run v2 export in `csv`, `xlsx`, and `json`.
2. Confirm artifact is persisted and job status is `COMPLETED`.
3. Confirm idempotency key replay returns original job.

## Discord Delivery + Retry
1. Publish leaderboard with workspace webhook configured.
2. Force one webhook failure and confirm `DeliveryLog` becomes `FAILED/RETRYING`.
3. Run `POST /api/v2/jobs/run?workspaceId=...` and verify retry behavior.

## Security Checks
1. Run `npm run check:secrets` and ensure pass.
2. Verify requests without access token fail for workspace-scoped v2 endpoints.
3. Verify expired or revoked links fail authorization.
