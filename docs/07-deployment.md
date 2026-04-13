# Deployment Guide — Vercel

## Prerequisites

1. **GitHub Account** — Code hosted on GitHub
2. **Vercel Account** — Free tier (sign up at vercel.com)
3. **Node.js 18+** — For local development

---

## Step-by-Step Deployment

### 1. Push to GitHub

```bash
cd hamaROK
git init
git add .
git commit -m "Initial commit: RoK Command Center"
git remote add origin https://github.com/YOUR_USERNAME/hamaROK.git
git push -u origin main
```

### 2. Import to Vercel

1. Go to [vercel.com/new](https://vercel.com/new)
2. Click "Import Git Repository"
3. Select your `hamaROK` repository
4. Framework Preset: **Next.js** (auto-detected)
5. Click "Deploy"

### 3. Add Vercel Postgres

1. Go to your project in the Vercel Dashboard
2. Click **Storage** tab
3. Click **Create Database**
4. Select **Postgres** (powered by Neon)
5. Name it: `rok-command-center-db`
6. Select region: **US East** (or closest to you)
7. Click **Create**

Vercel automatically adds these environment variables:
```
POSTGRES_URL
POSTGRES_PRISMA_URL
POSTGRES_URL_NON_POOLING
POSTGRES_USER
POSTGRES_PASSWORD
POSTGRES_DATABASE
POSTGRES_HOST
```

### 4. Add Vercel Blob

1. In the **Storage** tab, click **Create** again
2. Select **Blob**
3. Name it: `rok-screenshots`
4. Click **Create**

This adds:
```
BLOB_READ_WRITE_TOKEN
```

### 5. Run Database Migration

The build command handles this automatically:

```json
// package.json
{
  "scripts": {
    "build": "prisma generate && prisma migrate deploy && next build"
  }
}
```

Or run manually via Vercel CLI:
```bash
npx vercel env pull .env.local
npx prisma migrate deploy
```

### 6. Redeploy

After adding Storage, trigger a redeployment:
1. Go to **Deployments** tab
2. Click the three dots on latest deployment
3. Click **Redeploy**

---

## Local Development Setup

```bash
# 1. Clone the repo
git clone https://github.com/YOUR_USERNAME/hamaROK.git
cd hamaROK

# 2. Install dependencies
npm install

# 3. Install Vercel CLI
npm i -g vercel

# 4. Link to Vercel project
vercel link

# 5. Pull environment variables
vercel env pull .env.local

# 6. Run database migrations
npx prisma migrate dev

# 7. Start development server
npm run dev
```

Open http://localhost:3000

---

## Environment Variables

### Required for Production (auto-set by Vercel)

| Variable                  | Source          | Description                    |
|---------------------------|-----------------|--------------------------------|
| `POSTGRES_PRISMA_URL`     | Vercel Postgres | Connection string (pooled)     |
| `POSTGRES_URL_NON_POOLING`| Vercel Postgres | Direct connection (migrations) |
| `BLOB_READ_WRITE_TOKEN`   | Vercel Blob     | Blob storage auth token        |

### Optional

| Variable               | Default | Description                                              |
|------------------------|---------|----------------------------------------------------------|
| `NEXT_PUBLIC_APP_URL`  | —       | Public URL for sharing links                             |
| `OPENAI_API_KEY`       | —       | Optional OCR fallback provider credential (OpenAI)       |
| `GOOGLE_VISION_API_KEY`| —       | Optional OCR fallback provider credential (Google Vision)|
| `GOOGLE_APPLICATION_CREDENTIALS` | — | Optional service-account JSON file path (self-hosted/local) |
| `GOOGLE_VISION_SERVICE_ACCOUNT_JSON` | — | Optional raw service-account JSON (recommended for Vercel env var) |
| `AWS_OCR_CONTROL_ENABLED` | `false` | Enable AWS OCR dispatch (SQS + start-lambda trigger) |
| `AWS_REGION` | `us-east-1` | AWS region for OCR dispatch services |
| `AWS_OCR_QUEUE_URL` | — | SQS queue URL for OCR work items |
| `AWS_OCR_START_LAMBDA` | — | Lambda name to wake OCR worker immediately after enqueue |
| `AWS_OCR_STOP_LAMBDA` | — | Lambda name used by manual stop controls in UI/API |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | — | AWS credentials for Vercel runtime when IAM role auth is unavailable |

### Local Development (.env.local)

```env
# Auto-populated by `vercel env pull`
POSTGRES_PRISMA_URL="postgres://..."
POSTGRES_URL_NON_POOLING="postgres://..."
BLOB_READ_WRITE_TOKEN="vercel_blob_..."

# Optional
NEXT_PUBLIC_APP_URL="http://localhost:3000"
OPENAI_API_KEY=""
GOOGLE_VISION_API_KEY=""
GOOGLE_APPLICATION_CREDENTIALS=""
GOOGLE_VISION_SERVICE_ACCOUNT_JSON=""
AWS_OCR_CONTROL_ENABLED="false"
AWS_REGION="us-east-1"
AWS_OCR_QUEUE_URL=""
AWS_OCR_START_LAMBDA=""
AWS_OCR_STOP_LAMBDA=""
AWS_ACCESS_KEY_ID=""
AWS_SECRET_ACCESS_KEY=""
```

> Google Vision OCR requires billing enabled on the Google Cloud project.

> **Never commit `.env.local` to Git!** It's in `.gitignore` by default.

---

## Build Configuration

### next.config.ts

```typescript
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '*.public.blob.vercel-storage.com',
      },
    ],
  },
  webpack: (config, { isServer }) => {
    if (isServer) {
      config.resolve.alias.canvas = false;
    }
    return config;
  },
};

export default nextConfig;
```

### Vercel Project Settings

| Setting          | Value                                               |
|------------------|-----------------------------------------------------|
| Framework        | Next.js                                             |
| Build Command    | `prisma generate && prisma migrate deploy && next build` |
| Output Directory | `.next`                                             |
| Install Command  | `npm install`                                       |
| Node.js Version  | 18.x or 20.x                                       |

---

## Vercel Free Tier Limits

| Resource               | Limit            | Our Estimated Usage     |
|------------------------|------------------|-------------------------|
| Bandwidth              | 100 GB/month     | ~1 GB/month             |
| Serverless Invocations | 100K/month       | ~5K/month               |
| Function Duration      | 10 seconds       | ~2 sec average          |
| Postgres Storage       | 256 MB           | ~5 MB/year              |
| Postgres Compute       | 60 hrs/month     | ~2 hrs/month            |
| Blob Storage           | 1 GB             | ~60 MB/month            |
| Blob Writes            | 1000/day         | ~50/day max             |

**Conclusion**: Free tier is more than sufficient for a single alliance.

---

## CI/CD Pipeline

Vercel handles CI/CD automatically:

```
Push to GitHub
    │
    ├── Vercel detects new commit
    │
    ├── Runs build command:
    │     prisma generate
    │     prisma migrate deploy
    │     next build
    │
    ├── If build succeeds:
    │     Deploy to production (main branch)
    │     Deploy to preview (other branches)
    │
    └── If build fails:
          Keep previous deployment active
          Show error in dashboard
```

### Preview Deployments

Every pull request gets a unique preview URL:
```
https://hamarok-pr-5-username.vercel.app
```

This is great for testing changes before merging.

---

## AWS OCR Scale-to-Zero Automation

The repo includes turnkey scripts for AWS OCR worker automation:

```bash
# Provision or update AWS queue + worker + start/stop automation
./scripts/setup-aws-ocr-scale-zero.sh

# Sync AWS OCR env vars into Vercel (prod/preview/dev)
./scripts/configure-vercel-aws-ocr.sh

# Run full validation (local, AWS, Vercel, production health checks)
./scripts/final-system-check.sh
```

---

## Custom Domain (Optional)

1. Go to **Settings** → **Domains**
2. Add your domain (e.g., `rok.yourdomain.com`)
3. Configure DNS:
   - **CNAME**: `rok` → `cname.vercel-dns.com`
4. Vercel auto-provisions SSL certificate

---

## Monitoring

### Built-in Vercel Analytics

- **Web Vitals**: LCP, FID, CLS scores
- **Function Logs**: API route execution logs
- **Error Tracking**: Runtime error reports

### Database Monitoring

1. Go to **Storage** → **Postgres**
2. View: query count, compute hours, storage usage
3. Set up alerts for approaching limits

---

## Troubleshooting

### Common Issues

| Issue | Solution |
|-------|----------|
| `prisma migrate deploy` fails | Check `POSTGRES_URL_NON_POOLING` is set |
| Blob upload 403 error | Verify `BLOB_READ_WRITE_TOKEN` is set |
| OCR not loading | Check webpack canvas alias in next.config |
| BigInt serialization error | Ensure JSON serializer handles BigInt→string |
| Build timeout | Increase function maxDuration in vercel.json |

### Useful Commands

```bash
# Check Vercel project status
vercel ls

# View deployment logs
vercel logs

# Pull latest env vars
vercel env pull .env.local

# Run production build locally
npm run build && npm run start
```
