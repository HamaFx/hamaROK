ALTER TABLE "WorkspaceSettings"
ALTER COLUMN "fallbackOcrEnabled" SET DEFAULT true,
ALTER COLUMN "fallbackOcrMonthlyBudgetUsd" SET DEFAULT 5,
ALTER COLUMN "fallbackOcrProvider" SET DEFAULT 'google_vision',
ALTER COLUMN "fallbackOcrModel" SET DEFAULT 'DOCUMENT_TEXT_DETECTION';

UPDATE "WorkspaceSettings"
SET "fallbackOcrProvider" = 'google_vision'
WHERE LOWER(COALESCE("fallbackOcrProvider", '')) IN ('openai', 'google-vision', 'googlevision');

UPDATE "WorkspaceSettings"
SET "fallbackOcrModel" = 'DOCUMENT_TEXT_DETECTION'
WHERE COALESCE("fallbackOcrModel", '') IN ('', 'gpt-5-mini');

UPDATE "WorkspaceSettings"
SET "fallbackOcrEnabled" = true
WHERE "fallbackOcrEnabled" = false;

UPDATE "WorkspaceSettings"
SET "fallbackOcrMonthlyBudgetUsd" = 5
WHERE "fallbackOcrMonthlyBudgetUsd" <= 0;
