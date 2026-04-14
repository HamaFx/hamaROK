# Deployment Guide — Vercel Frontend + AWS EC2 OCR Worker

This project is deployed as a split system:

- Web app + API on **Vercel** (Next.js)
- OCR queue + worker control on **AWS** (SQS + Lambda + EC2 worker)
- Database and blob storage on **Vercel Postgres** + **Vercel Blob**

## 1. Required Services

1. Vercel project connected to this repository.
2. Vercel Postgres attached to the project.
3. Vercel Blob attached to the project.
4. AWS account with access to SQS, Lambda, EC2, EventBridge, IAM, SSM.

## 2. Vercel Environment Variables

Set these in Vercel for `production`, `preview`, and `development` as needed.

### Core (required)

- `POSTGRES_PRISMA_URL`
- `POSTGRES_URL_NON_POOLING`
- `BLOB_READ_WRITE_TOKEN`
- `NEXT_PUBLIC_APP_URL` (your public app URL)
- `APP_SIGNING_SECRET` (same secret used by internal worker callbacks)

### OCR Dispatch/Control (required for EC2 OCR mode)

- `UPLOAD_MODE=queue_first`
- `AWS_OCR_CONTROL_ENABLED=true`
- `AWS_REGION=<aws-region>`
- `AWS_OCR_QUEUE_URL=<sqs-queue-url>`
- `AWS_OCR_START_LAMBDA=<start-lambda-name>`
- `AWS_OCR_STOP_LAMBDA=<stop-lambda-name>`
- `AWS_OCR_INSTANCE_ID=<ec2-instance-id>`
- `AWS_ACCESS_KEY_ID=<aws-access-key>`
- `AWS_SECRET_ACCESS_KEY=<aws-secret-key>`

## 3. Provision or Update AWS OCR Infrastructure

Run from repo root:

```bash
APP_URL="https://<your-vercel-domain>" \
SERVICE_SECRET="<same-as-APP_SIGNING_SECRET>" \
./scripts/setup-aws-ocr-scale-zero.sh
```

What this script configures:

- SQS queue + DLQ
- EC2 OCR worker instance + systemd worker service
- Lambda start/stop functions
- EventBridge schedules for auto start/stop
- Signed callback wiring to `/api/v2/internal/ingestion-tasks/*`

Important: rerun this script after OCR worker logic changes so EC2 gets the newest embedded worker code.

## 4. Sync AWS OCR Env to Vercel

```bash
./scripts/configure-vercel-aws-ocr.sh
```

This updates Vercel env vars for OCR dispatch/control keys.

## 5. Database Migration

From local shell or CI:

```bash
npx prisma migrate deploy
```

Current schema requires `ActivityMetricKey` enum values including:

- `POWER_GROWTH`
- `CONTRIBUTION_POINTS`
- `FORT_DESTROYING`
- `KILL_POINTS_GROWTH`

## 6. Production Validation

### Full automated check

```bash
./scripts/final-system-check.sh hama-rok https://<your-vercel-domain>
```

This verifies:

- local lint/typecheck/test/build
- AWS queue/instance/lambdas/rules
- required Vercel env vars
- production URL health
- `/api/healthz` readiness

### Manual quick checks

```bash
curl -sS https://<your-vercel-domain>/api/healthz | jq
```

Expected:

- HTTP `200`
- `status: "ok"`
- `checks.env.ok = true`
- `checks.database.ok = true`

Then upload a ranking screenshot and confirm:

1. A scan job is created.
2. Ingestion task transitions to `COMPLETED`.
3. Ranking run is created with strict header/metric pair.

## 7. Security Notes

- Never commit `.env.local`.
- `APP_SIGNING_SECRET` must match between Vercel and EC2 worker setup input.
- Rotate AWS keys periodically.
- Use least-privilege IAM for Vercel AWS credentials where possible.

## 8. Troubleshooting

- `Health endpoint returns 503`: inspect `/api/healthz` payload for failed check.
- `Ingestion tasks keep failing`: verify `APP_SIGNING_SECRET` match and worker callback URL.
- `Queue grows but no processing`: check start lambda, EventBridge rule states, and EC2 instance state.
- `Build fails in CI`: ensure `POSTGRES_PRISMA_URL` exists during build step.
