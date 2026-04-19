#!/usr/bin/env bash
set -euo pipefail

PREFIX="${1:-hama-rok}"
REGION="${AWS_REGION:-$(aws configure get region || true)}"
REGION="${REGION:-us-east-1}"
PRODUCTION_BRANCH="${PRODUCTION_BRANCH:-main}"
PREVIEW_GIT_BRANCHES_RAW="${PREVIEW_GIT_BRANCHES:-}"

QUEUE_NAME="${PREFIX}-ocr-jobs"
INSTANCE_NAME="${PREFIX}-ocr-worker"
START_LAMBDA_NAME="${PREFIX}-ocr-start-worker"
STOP_LAMBDA_NAME="${PREFIX}-ocr-stop-worker"

QUEUE_URL="$(aws --region "$REGION" sqs get-queue-url --queue-name "$QUEUE_NAME" --query 'QueueUrl' --output text)"
INSTANCE_ID="$(aws --region "$REGION" ec2 describe-instances --filters "Name=tag:Name,Values=${INSTANCE_NAME}" "Name=instance-state-name,Values=pending,running,stopping,stopped" --query 'Reservations[].Instances[0].InstanceId' --output text | awk 'NR==1{print $1}')"
AWS_ACCESS_KEY_ID_VALUE="${AWS_ACCESS_KEY_ID:-$(aws configure get aws_access_key_id || true)}"
AWS_SECRET_ACCESS_KEY_VALUE="${AWS_SECRET_ACCESS_KEY:-$(aws configure get aws_secret_access_key || true)}"
MISTRAL_API_KEY_VALUE="${MISTRAL_API_KEY:-}"
MISTRAL_BASE_URL_VALUE="${MISTRAL_BASE_URL:-https://api.mistral.ai}"

if [[ -z "$QUEUE_URL" || "$QUEUE_URL" == "None" ]]; then
  echo "Failed to resolve queue URL for '$QUEUE_NAME' in region '$REGION'." >&2
  exit 1
fi

if [[ -z "$INSTANCE_ID" || "$INSTANCE_ID" == "None" ]]; then
  echo "Failed to resolve OCR worker instance for name '$INSTANCE_NAME' in region '$REGION'." >&2
  exit 1
fi

if [[ -z "$AWS_ACCESS_KEY_ID_VALUE" || -z "$AWS_SECRET_ACCESS_KEY_VALUE" ]]; then
  echo "Missing AWS credentials in current shell/aws configure." >&2
  exit 1
fi

if [[ -z "$MISTRAL_API_KEY_VALUE" ]]; then
  echo "MISTRAL_API_KEY is required because this script configures OCR_ENGINE=mistral." >&2
  echo "Export MISTRAL_API_KEY in your shell and rerun." >&2
  exit 1
fi

resolve_preview_branches() {
  local branch
  if [[ -n "$PREVIEW_GIT_BRANCHES_RAW" ]]; then
    echo "$PREVIEW_GIT_BRANCHES_RAW" | tr ',' '\n' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//' | rg -v '^$'
    return 0
  fi

  if ! command -v git >/dev/null 2>&1; then
    return 0
  fi

  git for-each-ref --format='%(refname:short)' refs/remotes/origin \
    | sed 's#^origin/##' \
    | rg -v '^HEAD$' \
    | rg -v "^${PRODUCTION_BRANCH}\$" \
    | sort -u
}

upsert_env() {
  local key="$1"
  local value="$2"
  local environment="$3"
  local git_branch="${4:-}"
  local output=""
  local -a preview_branches=()
  local branch

  if [[ "$environment" == "preview" ]]; then
    if [[ -n "$git_branch" ]]; then
      npx vercel env add "$key" "$environment" "$git_branch" --value "$value" --force --yes >/dev/null
    else
      if output="$(npx vercel env add "$key" "$environment" --value "$value" --force --yes 2>&1)"; then
        return 0
      fi

      if ! echo "$output" | rg -q '"reason": "git_branch_required"'; then
        echo "$output" >&2
        return 1
      fi

      mapfile -t preview_branches < <(resolve_preview_branches)
      if [[ "${#preview_branches[@]}" -eq 0 ]]; then
        echo "Skipping preview env '$key': no preview git branches found (set PREVIEW_GIT_BRANCHES to override)." >&2
        return 0
      fi

      for branch in "${preview_branches[@]}"; do
        npx vercel env add "$key" "$environment" "$branch" --value "$value" --force --yes >/dev/null
      done
    fi
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
    upsert_env "AWS_OCR_STOP_LAMBDA" "$STOP_LAMBDA_NAME" "$env" "$preview_branch"
    upsert_env "AWS_OCR_INSTANCE_ID" "$INSTANCE_ID" "$env" "$preview_branch"
    upsert_env "UPLOAD_MODE" "queue_first" "$env" "$preview_branch"
    upsert_env "OCR_ENGINE" "mistral" "$env" "$preview_branch"
    upsert_env "MISTRAL_BASE_URL" "$MISTRAL_BASE_URL_VALUE" "$env" "$preview_branch"
    upsert_env "MISTRAL_API_KEY" "$MISTRAL_API_KEY_VALUE" "$env" "$preview_branch"
    upsert_env "AWS_ACCESS_KEY_ID" "$AWS_ACCESS_KEY_ID_VALUE" "$env" "$preview_branch"
    upsert_env "AWS_SECRET_ACCESS_KEY" "$AWS_SECRET_ACCESS_KEY_VALUE" "$env" "$preview_branch"
  else
    upsert_env "AWS_OCR_CONTROL_ENABLED" "true" "$env"
    upsert_env "AWS_REGION" "$REGION" "$env"
    upsert_env "AWS_OCR_QUEUE_URL" "$QUEUE_URL" "$env"
    upsert_env "AWS_OCR_START_LAMBDA" "$START_LAMBDA_NAME" "$env"
    upsert_env "AWS_OCR_STOP_LAMBDA" "$STOP_LAMBDA_NAME" "$env"
    upsert_env "AWS_OCR_INSTANCE_ID" "$INSTANCE_ID" "$env"
    upsert_env "UPLOAD_MODE" "queue_first" "$env"
    upsert_env "OCR_ENGINE" "mistral" "$env"
    upsert_env "MISTRAL_BASE_URL" "$MISTRAL_BASE_URL_VALUE" "$env"
    upsert_env "MISTRAL_API_KEY" "$MISTRAL_API_KEY_VALUE" "$env"
    upsert_env "AWS_ACCESS_KEY_ID" "$AWS_ACCESS_KEY_ID_VALUE" "$env"
    upsert_env "AWS_SECRET_ACCESS_KEY" "$AWS_SECRET_ACCESS_KEY_VALUE" "$env"
  fi
done

echo "Vercel AWS OCR environment synced successfully."
echo "Region: $REGION"
echo "Queue:  $QUEUE_URL"
echo "Worker Instance: $INSTANCE_ID"
echo "Start Lambda: $START_LAMBDA_NAME"
echo "Stop Lambda:  $STOP_LAMBDA_NAME"
