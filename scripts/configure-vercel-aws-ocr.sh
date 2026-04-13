#!/usr/bin/env bash
set -euo pipefail

PREFIX="${1:-hama-rok}"
REGION="${AWS_REGION:-$(aws configure get region || true)}"
REGION="${REGION:-us-east-1}"

QUEUE_NAME="${PREFIX}-ocr-jobs"
START_LAMBDA_NAME="${PREFIX}-ocr-start-worker"

QUEUE_URL="$(aws --region "$REGION" sqs get-queue-url --queue-name "$QUEUE_NAME" --query 'QueueUrl' --output text)"
AWS_ACCESS_KEY_ID_VALUE="${AWS_ACCESS_KEY_ID:-$(aws configure get aws_access_key_id || true)}"
AWS_SECRET_ACCESS_KEY_VALUE="${AWS_SECRET_ACCESS_KEY:-$(aws configure get aws_secret_access_key || true)}"

if [[ -z "$QUEUE_URL" || "$QUEUE_URL" == "None" ]]; then
  echo "Failed to resolve queue URL for '$QUEUE_NAME' in region '$REGION'." >&2
  exit 1
fi

if [[ -z "$AWS_ACCESS_KEY_ID_VALUE" || -z "$AWS_SECRET_ACCESS_KEY_VALUE" ]]; then
  echo "Missing AWS credentials in current shell/aws configure." >&2
  exit 1
fi

upsert_env() {
  local key="$1"
  local value="$2"
  local environment="$3"
  local git_branch="${4:-}"
  if [[ -n "$git_branch" || "$environment" == "preview" ]]; then
    npx vercel env add "$key" "$environment" "$git_branch" --value "$value" --force --yes >/dev/null
  else
    npx vercel env add "$key" "$environment" --value "$value" --force --yes >/dev/null
  fi
}

for env in production preview development; do
  preview_branch=""
  if [[ "$env" == "preview" ]]; then
    upsert_env "AWS_OCR_CONTROL_ENABLED" "true" "$env" "$preview_branch"
    upsert_env "AWS_REGION" "$REGION" "$env" "$preview_branch"
    upsert_env "AWS_OCR_QUEUE_URL" "$QUEUE_URL" "$env" "$preview_branch"
    upsert_env "AWS_OCR_START_LAMBDA" "$START_LAMBDA_NAME" "$env" "$preview_branch"
    upsert_env "AWS_ACCESS_KEY_ID" "$AWS_ACCESS_KEY_ID_VALUE" "$env" "$preview_branch"
    upsert_env "AWS_SECRET_ACCESS_KEY" "$AWS_SECRET_ACCESS_KEY_VALUE" "$env" "$preview_branch"
  else
    upsert_env "AWS_OCR_CONTROL_ENABLED" "true" "$env"
    upsert_env "AWS_REGION" "$REGION" "$env"
    upsert_env "AWS_OCR_QUEUE_URL" "$QUEUE_URL" "$env"
    upsert_env "AWS_OCR_START_LAMBDA" "$START_LAMBDA_NAME" "$env"
    upsert_env "AWS_ACCESS_KEY_ID" "$AWS_ACCESS_KEY_ID_VALUE" "$env"
    upsert_env "AWS_SECRET_ACCESS_KEY" "$AWS_SECRET_ACCESS_KEY_VALUE" "$env"
  fi
done

echo "Vercel AWS OCR environment synced successfully."
echo "Region: $REGION"
echo "Queue:  $QUEUE_URL"
echo "Lambda: $START_LAMBDA_NAME"
