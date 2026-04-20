#!/usr/bin/env bash
set -euo pipefail

PREFIX="${1:-hama-rok}"
REGION="${AWS_REGION:-$(aws configure get region || true)}"
REGION="${REGION:-us-east-1}"
APP_URL="${2:-https://hamarok.vercel.app}"

QUEUE_NAME="${PREFIX}-ocr-jobs"
INSTANCE_NAME="${PREFIX}-ocr-worker"
START_LAMBDA_NAME="${PREFIX}-ocr-start-worker"
STOP_LAMBDA_NAME="${PREFIX}-ocr-stop-worker"
START_RULE_NAME="${PREFIX}-ocr-start-schedule"
STOP_RULE_NAME="${PREFIX}-ocr-stop-schedule"

echo "== Local quality checks =="
npm run lint >/dev/null
npm run typecheck >/dev/null
npm run test >/dev/null
BUILD_DB_URL="${POSTGRES_PRISMA_URL:-${DATABASE_URL:-postgresql://user:pass@localhost:5432/hama_rok}}"
POSTGRES_PRISMA_URL="$BUILD_DB_URL" DATABASE_URL="$BUILD_DB_URL" npm run build >/dev/null
echo "OK: lint, typecheck, test, build"

echo ""
echo "== AWS checks (${REGION}) =="
QUEUE_URL="$(aws --region "$REGION" sqs get-queue-url --queue-name "$QUEUE_NAME" --query 'QueueUrl' --output text)"
INSTANCE_ID="$(aws --region "$REGION" ec2 describe-instances --filters "Name=tag:Name,Values=${INSTANCE_NAME}" "Name=instance-state-name,Values=pending,running,stopping,stopped" --query 'Reservations[].Instances[0].InstanceId' --output text | awk 'NR==1{print $1}')"
START_RULE_STATE="$(aws --region "$REGION" events describe-rule --name "$START_RULE_NAME" --query 'State' --output text)"
STOP_RULE_STATE="$(aws --region "$REGION" events describe-rule --name "$STOP_RULE_NAME" --query 'State' --output text)"
aws --region "$REGION" lambda get-function --function-name "$START_LAMBDA_NAME" >/dev/null
aws --region "$REGION" lambda get-function --function-name "$STOP_LAMBDA_NAME" >/dev/null
if [[ -z "$INSTANCE_ID" || "$INSTANCE_ID" == "None" ]]; then
  echo "Failed to resolve OCR worker instance '$INSTANCE_NAME' in region '$REGION'." >&2
  exit 1
fi
echo "OK: queue, instance, lambdas, event rules"
echo "Queue URL: $QUEUE_URL"
echo "Instance:  $INSTANCE_ID"
echo "Rules:     $START_RULE_NAME=$START_RULE_STATE, $STOP_RULE_NAME=$STOP_RULE_STATE"

echo ""
echo "== Vercel env checks =="
ENV_DUMP="$(npx vercel env ls)"
for key in POSTGRES_PRISMA_URL BLOB_READ_WRITE_TOKEN NEXT_PUBLIC_APP_URL APP_SIGNING_SECRET OCR_ENGINE MISTRAL_API_KEY MISTRAL_BASE_URL AWS_OCR_CONTROL_ENABLED AWS_REGION AWS_OCR_QUEUE_URL AWS_OCR_START_LAMBDA AWS_OCR_STOP_LAMBDA AWS_OCR_INSTANCE_ID UPLOAD_MODE AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY; do
  echo "$ENV_DUMP" | rg -q "$key" || { echo "Missing Vercel env: $key" >&2; exit 1; }
done
echo "OK: required Vercel environment variables present"

echo ""
echo "== Production deploy check =="
HTTP_CODE="$(curl -s -o /tmp/rok-home.html -w '%{http_code}' "$APP_URL")"
if [[ "$HTTP_CODE" != "200" ]]; then
  echo "Production URL check failed ($APP_URL -> $HTTP_CODE)." >&2
  exit 1
fi
echo "OK: $APP_URL returns 200"

HEALTH_CODE="$(curl -s -o /tmp/rok-health.json -w '%{http_code}' "$APP_URL/api/healthz")"
if [[ "$HEALTH_CODE" != "200" ]]; then
  echo "Health endpoint failed ($APP_URL/api/healthz -> $HEALTH_CODE)." >&2
  head -c 2000 /tmp/rok-health.json >&2 || true
  echo "" >&2
  exit 1
fi
echo "OK: $APP_URL/api/healthz returns 200"

if ! rg -q '"status":"ok"' /tmp/rok-health.json; then
  echo "Health payload did not return status=ok." >&2
  cat /tmp/rok-health.json >&2
  exit 1
fi
if ! rg -q '"name":"mistral"' /tmp/rok-health.json; then
  echo "Health payload missing mistral readiness check." >&2
  cat /tmp/rok-health.json >&2
  exit 1
fi
if ! rg -q '"name":"mistral","ok":true' /tmp/rok-health.json; then
  echo "Health payload reports mistral readiness failure." >&2
  cat /tmp/rok-health.json >&2
  exit 1
fi
echo "OK: mistral readiness is present and healthy"

if ! rg -q '"requestedEngine":"' /tmp/rok-health.json; then
  echo "Health payload missing OCR requestedEngine diagnostics." >&2
  cat /tmp/rok-health.json >&2
  exit 1
fi
if ! rg -q '"locked":' /tmp/rok-health.json; then
  echo "Health payload missing OCR lock diagnostics." >&2
  cat /tmp/rok-health.json >&2
  exit 1
fi
echo "OK: OCR policy diagnostics are present"

if ! rg -q '"storage":' /tmp/rok-health.json; then
  echo "Health payload missing storage diagnostics." >&2
  cat /tmp/rok-health.json >&2
  exit 1
fi
if ! rg -q '"screenshotRetentionDays":14' /tmp/rok-health.json; then
  echo "Health payload missing 14-day screenshot retention diagnostics." >&2
  cat /tmp/rok-health.json >&2
  exit 1
fi
echo "OK: storage retention diagnostics are present"

if ! rg -q '"name":"embedding"' /tmp/rok-health.json; then
  echo "Health payload missing embedding readiness check." >&2
  cat /tmp/rok-health.json >&2
  exit 1
fi
if ! rg -q '"name":"embedding","ok":true' /tmp/rok-health.json; then
  echo "Health payload reports embedding readiness failure." >&2
  cat /tmp/rok-health.json >&2
  exit 1
fi
echo "OK: embedding readiness is present and healthy"

ASSISTANT_PAGE_CODE="$(curl -s -o /tmp/rok-assistant.html -w '%{http_code}' "$APP_URL/assistant")"
if [[ "$ASSISTANT_PAGE_CODE" != "200" ]]; then
  echo "Assistant page check failed ($APP_URL/assistant -> $ASSISTANT_PAGE_CODE)." >&2
  head -c 1200 /tmp/rok-assistant.html >&2 || true
  echo "" >&2
  exit 1
fi
echo "OK: $APP_URL/assistant returns 200"

ASSISTANT_API_CODE="$(curl -s -o /tmp/rok-assistant-api.json -w '%{http_code}' "$APP_URL/api/v2/assistant/conversations?workspaceId=smoke-test-workspace")"
if [[ "$ASSISTANT_API_CODE" == "404" ]]; then
  echo "Assistant API route missing ($APP_URL/api/v2/assistant/conversations -> 404)." >&2
  head -c 1200 /tmp/rok-assistant-api.json >&2 || true
  echo "" >&2
  exit 1
fi
echo "OK: assistant API route exists (HTTP $ASSISTANT_API_CODE)"

INTERNAL_EXTRACT_CODE="$(curl -s -o /tmp/rok-internal-extract.json -w '%{http_code}' -X POST "$APP_URL/api/v2/internal/ingestion-tasks/smoke-task/extract" -H 'Content-Type: application/json' -d '{}')"
if [[ "$INTERNAL_EXTRACT_CODE" == "404" ]]; then
  echo "Internal extract API route missing ($APP_URL/api/v2/internal/ingestion-tasks/:taskId/extract -> 404)." >&2
  head -c 1200 /tmp/rok-internal-extract.json >&2 || true
  echo "" >&2
  exit 1
fi
echo "OK: internal extract API route exists (HTTP $INTERNAL_EXTRACT_CODE)"

echo ""
echo "All checks passed."
