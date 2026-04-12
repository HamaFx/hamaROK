# RoK Command Center v2 Migration & Rollback Playbook

## Goals
- Upgrade platform safely to Next.js 16 + React 19 + Prisma 7.
- Introduce v2 workspace-aware schema without breaking legacy `/api/*`.
- Keep rollback path available at every deployment stage.

## Pre-Deploy Checklist
- Run:
  - `npm run check:secrets`
  - `npm run lint`
  - `npm run typecheck`
  - `npm run test`
  - `npm run build`
- Confirm production env vars:
  - `POSTGRES_PRISMA_URL`
  - `APP_SIGNING_SECRET`
  - `BLOB_READ_WRITE_TOKEN` (if export/blob uploads should be externalized)
- Confirm one bootstrap workspace can be created via `POST /api/v2/workspaces`.

## Deployment Stages
1. Deploy code with v2 routes and schema changes.
2. Run migration in production:
   - `npx prisma migrate deploy`
3. Smoke test:
   - Legacy flow: upload -> events -> compare.
   - v2 flow: create workspace -> create event -> compare -> export.
4. Enable traffic to v2 gradually from clients.

## Rollback Plan
1. If API regressions happen:
   - Route clients back to legacy `/api/*`.
2. If deploy-level issues happen:
   - Roll back to previous Vercel deployment.
3. If migration-specific issues happen:
   - Restore DB backup.
   - Redeploy previous app version pinned to pre-v2 schema.

## Data Safety Practices
- Always take a DB snapshot before `prisma migrate deploy`.
- Keep report/export artifacts append-only.
- Never delete v1 tables/columns until v2 has passed at least one full KvK cycle.

## Post-Deploy Monitoring
- Track:
  - `/api/v2/*` error rates.
  - Export failure counts.
  - Discord delivery retry backlog.
  - OCR low-confidence rate per scan job.
