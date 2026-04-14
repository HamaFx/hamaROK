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
for key in AWS_OCR_CONTROL_ENABLED AWS_REGION AWS_OCR_QUEUE_URL AWS_OCR_START_LAMBDA AWS_OCR_STOP_LAMBDA AWS_OCR_INSTANCE_ID UPLOAD_MODE AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY APP_SIGNING_SECRET POSTGRES_PRISMA_URL BLOB_READ_WRITE_TOKEN; do
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

echo ""
echo "All checks passed."
