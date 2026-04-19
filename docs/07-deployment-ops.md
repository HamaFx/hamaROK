# Deployment and Operations

## Production Targets

- Vercel project: `hamarok`
- Production URL: `https://hamarok.vercel.app`
- AWS region/prefix defaults: `us-east-1`, `hama-rok`

## Required Environment Variables

Core:

- `POSTGRES_PRISMA_URL` (or `DATABASE_URL`)
- `POSTGRES_URL_NON_POOLING`
- `BLOB_READ_WRITE_TOKEN`
- `NEXT_PUBLIC_APP_URL`
- `APP_SIGNING_SECRET`

Mistral:

- `OCR_ENGINE` (`mistral` recommended)
- `MISTRAL_API_KEY`
- `MISTRAL_BASE_URL` (optional, defaults to `https://api.mistral.ai`)

AWS OCR control:

- `UPLOAD_MODE=queue_first`
- `AWS_OCR_CONTROL_ENABLED=true`
- `AWS_REGION`
- `AWS_OCR_QUEUE_URL`
- `AWS_OCR_START_LAMBDA`
- `AWS_OCR_STOP_LAMBDA`
- `AWS_OCR_INSTANCE_ID`
- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`

## Health and Readiness

Endpoint: `GET /api/healthz`

Checks expected when healthy:

- `env.ok = true`
- `mistral.ok = true` (when `OCR_ENGINE=mistral`)
- `database.ok = true`
- `weekly_schema.ok = true`

## Standard Deployment Steps

1. Local gates:

```bash
npm run lint
npm run typecheck
npm run test
npm run build
```

2. Push mainline code:

```bash
git push origin main
```

3. Deploy production:

```bash
npx vercel deploy --prod --yes
```

4. Verify:

```bash
curl -i https://hamarok.vercel.app/api/healthz
curl -I https://hamarok.vercel.app/assistant
```

## AWS Infra Scripts

- Setup/update worker stack:

```bash
./scripts/setup-aws-ocr-scale-zero.sh
```

- Sync AWS OCR env to Vercel:

```bash
./scripts/configure-vercel-aws-ocr.sh
```

- End-to-end readiness check:

```bash
./scripts/final-system-check.sh hama-rok https://hamarok.vercel.app
```

## Rotation and Security

1. Rotate shared secrets periodically (`MISTRAL_API_KEY`, AWS keys, `APP_SIGNING_SECRET`).
2. Never commit `.env.local`.
3. Ensure worker callback signing secret matches app secret.
4. Use least-privilege AWS credentials for Vercel runtime.

## Rollback Notes

- Emergency OCR rollback: set `OCR_ENGINE=legacy`.
- Assistant endpoints and ingestion contracts remain active under rollback.
