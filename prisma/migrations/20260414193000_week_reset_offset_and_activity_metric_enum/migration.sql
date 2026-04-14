-- Add missing weekly activity enum values + workspace week reset offset.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ActivityMetricKey') THEN
    BEGIN
      ALTER TYPE "ActivityMetricKey" ADD VALUE IF NOT EXISTS 'FORT_DESTROYING';
    EXCEPTION
      WHEN duplicate_object THEN NULL;
    END;

    BEGIN
      ALTER TYPE "ActivityMetricKey" ADD VALUE IF NOT EXISTS 'KILL_POINTS_GROWTH';
    EXCEPTION
      WHEN duplicate_object THEN NULL;
    END;
  END IF;
END $$;

ALTER TABLE "WorkspaceSettings"
ADD COLUMN IF NOT EXISTS "weekResetUtcOffset" TEXT NOT NULL DEFAULT '+00:00';
