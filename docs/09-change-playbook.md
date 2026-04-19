# Change Playbook for AI Agents

Use this when implementing feature or reliability changes.

## 1) Add or modify assistant action behavior

1. Update typed action schemas in `src/lib/assistant/types.ts`.
2. Update planning/execution in `src/lib/assistant/service.ts`.
3. Reuse domain writes from `src/lib/domain/workspace-actions.ts`.
4. Ensure role gating and pending identity flow still hold.
5. Add/update unit + integration tests.

## 2) Add new assistant read tool

1. Add tool schema and handler contract in assistant type layer.
2. Register tool in assistant read tool list.
3. Implement resolver with row limits/truncation safeguards.
4. Include compact read summary in message metadata.
5. Add unit tests for limits and permission behavior.

## 3) Tune OCR extraction behavior

1. Modify `src/lib/ocr/mistral-extraction.ts` first.
2. Keep ingestion and assistant extraction consumers aligned.
3. Preserve fallback behavior and clear diagnostics metadata.
4. Validate against OCR regression tests.

## 4) Change similarity policy

1. Update `src/lib/governor-similarity.ts`.
2. Verify assistant + ranking callers still interpret result states correctly.
3. Keep ambiguous/unresolved flows explicit.
4. Expand similarity unit tests before deploy.

## 5) Update upload high-volume handling

1. Update UI behavior in `src/features/upload/*`.
2. Keep scan-job/artifact/task API contract unchanged unless required.
3. Preserve review queue population.
4. Verify sequential mode and retries with large batch sample.

## 6) Add API endpoint

1. Add route file under `src/app/api/**/route.ts`.
2. Use `ok/fail/handleApiError` response envelope.
3. Enforce auth via workspace access link or service auth.
4. Route writes through domain/service layer, not inline SQL logic.
5. Document endpoint in `docs/04-api-catalog.md`.

## 7) DB schema changes

1. Edit `prisma/schema.prisma`.
2. Create migration.
3. Validate migration in local + production deploy flow.
4. Update docs (`06-data-model.md`) and any health precondition checks.

## 8) Deployment changes

1. Update `docs/07-deployment-ops.md`.
2. If AWS worker runtime changes, rerun setup script.
3. Run `scripts/final-system-check.sh` before rollout.

## 9) PR/commit checklist

1. Update docs affected by behavior changes.
2. Run lint/typecheck/test/build.
3. Confirm no secrets added.
4. Confirm no unrelated file reverts.
