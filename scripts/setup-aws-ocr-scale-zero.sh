#!/usr/bin/env bash
set -euo pipefail

PREFIX="${1:-hama-rok}"
REGION="${AWS_REGION:-$(aws configure get region || true)}"
REGION="${REGION:-us-east-1}"

QUEUE_NAME="${PREFIX}-ocr-jobs"
DLQ_NAME="${PREFIX}-ocr-jobs-dlq"
INSTANCE_NAME="${PREFIX}-ocr-worker"
LAMBDA_ROLE_NAME="${PREFIX}-ocr-control-lambda-role"
LAMBDA_START_NAME="${PREFIX}-ocr-start-worker"
LAMBDA_STOP_NAME="${PREFIX}-ocr-stop-worker"
START_RULE_NAME="${PREFIX}-ocr-start-schedule"
STOP_RULE_NAME="${PREFIX}-ocr-stop-schedule"
WORKER_ROLE_NAME="${PREFIX}-ocr-worker-ec2-role"
WORKER_PROFILE_NAME="${PREFIX}-ocr-worker-profile"

AWS=(aws --region "$REGION")

echo "[1/10] Ensuring SQS queues..."
DLQ_URL="$(${AWS[@]} sqs create-queue --queue-name "$DLQ_NAME" --query 'QueueUrl' --output text)"
DLQ_ARN="$(${AWS[@]} sqs get-queue-attributes --queue-url "$DLQ_URL" --attribute-names QueueArn --query 'Attributes.QueueArn' --output text)"
REDRIVE_POLICY=$(jq -cn --arg arn "$DLQ_ARN" '{deadLetterTargetArn:$arn,maxReceiveCount:"5"}')
QUEUE_URL="$(${AWS[@]} sqs create-queue --queue-name "$QUEUE_NAME" --attributes VisibilityTimeout=120,ReceiveMessageWaitTimeSeconds=20 --query 'QueueUrl' --output text)"
QUEUE_ATTR_FILE=$(mktemp)
jq -cn --arg rp "$REDRIVE_POLICY" '{RedrivePolicy:$rp}' > "$QUEUE_ATTR_FILE"
${AWS[@]} sqs set-queue-attributes --queue-url "$QUEUE_URL" --attributes "file://$QUEUE_ATTR_FILE" >/dev/null
rm -f "$QUEUE_ATTR_FILE"
QUEUE_ARN="$(${AWS[@]} sqs get-queue-attributes --queue-url "$QUEUE_URL" --attribute-names QueueArn --query 'Attributes.QueueArn' --output text)"

echo "[2/10] Ensuring OCR worker EC2 instance..."
INSTANCE_ID="$(${AWS[@]} ec2 describe-instances \
  --filters "Name=tag:Name,Values=$INSTANCE_NAME" "Name=instance-state-name,Values=pending,running,stopping,stopped" \
  --query 'Reservations[].Instances[].InstanceId' --output text | awk 'NR==1{print $1}')"

if [[ -z "${INSTANCE_ID:-}" || "$INSTANCE_ID" == "None" ]]; then
  mapfile -t SUBNET_IDS < <(${AWS[@]} ec2 describe-subnets --filters Name=default-for-az,Values=true --query 'Subnets[].SubnetId' --output text | tr '\t' '\n')
  if [[ "${#SUBNET_IDS[@]}" -eq 0 ]]; then
    echo "No default subnets found. Create a subnet or pass an existing instance manually." >&2
    exit 1
  fi
  VPC_ID="$(${AWS[@]} ec2 describe-subnets --subnet-ids "${SUBNET_IDS[0]}" --query 'Subnets[0].VpcId' --output text)"
  SG_ID="$(${AWS[@]} ec2 describe-security-groups --filters Name=vpc-id,Values="$VPC_ID" Name=group-name,Values=default --query 'SecurityGroups[0].GroupId' --output text)"
  AMI_ID="$(${AWS[@]} ssm get-parameter --name /aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64 --query 'Parameter.Value' --output text)"
  for SUBNET_ID in "${SUBNET_IDS[@]}"; do
    set +e
    INSTANCE_ID="$(${AWS[@]} ec2 run-instances \
      --image-id "$AMI_ID" \
      --instance-type t3.large \
      --subnet-id "$SUBNET_ID" \
      --security-group-ids "$SG_ID" \
      --instance-initiated-shutdown-behavior stop \
      --block-device-mappings '[{"DeviceName":"/dev/xvda","Ebs":{"VolumeSize":30,"VolumeType":"gp3","DeleteOnTermination":true}}]' \
      --tag-specifications "ResourceType=instance,Tags=[{Key=Name,Value=$INSTANCE_NAME},{Key=Project,Value=$PREFIX}]" \
      --query 'Instances[0].InstanceId' --output text 2>/tmp/${PREFIX}-ec2-create.err)"
    status=$?
    set -e
    if [[ $status -eq 0 && -n "${INSTANCE_ID:-}" && "$INSTANCE_ID" != "None" ]]; then
      break
    fi
    INSTANCE_ID=""
  done
  if [[ -z "${INSTANCE_ID:-}" ]]; then
    echo "Failed to create EC2 instance in available default subnets." >&2
    cat /tmp/${PREFIX}-ec2-create.err >&2 || true
    exit 1
  fi

  ${AWS[@]} ec2 wait instance-running --instance-ids "$INSTANCE_ID"
  ${AWS[@]} ec2 stop-instances --instance-ids "$INSTANCE_ID" >/dev/null
  ${AWS[@]} ec2 wait instance-stopped --instance-ids "$INSTANCE_ID"
fi

echo "[3/10] Ensuring EC2 worker IAM role/profile..."
WORKER_TRUST_DOC=$(cat <<'JSON'
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": {"Service": "ec2.amazonaws.com"},
    "Action": "sts:AssumeRole"
  }]
}
JSON
)

if ! ${AWS[@]} iam get-role --role-name "$WORKER_ROLE_NAME" >/dev/null 2>&1; then
  ${AWS[@]} iam create-role --role-name "$WORKER_ROLE_NAME" --assume-role-policy-document "$WORKER_TRUST_DOC" >/dev/null
fi

${AWS[@]} iam attach-role-policy --role-name "$WORKER_ROLE_NAME" --policy-arn arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore >/dev/null
WORKER_POLICY_DOC=$(jq -cn --arg qarn "$QUEUE_ARN" '{
  Version:"2012-10-17",
  Statement:[
    {Effect:"Allow",Action:["sqs:ReceiveMessage","sqs:DeleteMessage","sqs:ChangeMessageVisibility","sqs:GetQueueAttributes","sqs:GetQueueUrl"],Resource:$qarn},
    {Effect:"Allow",Action:["logs:CreateLogGroup","logs:CreateLogStream","logs:PutLogEvents"],Resource:"*"}
  ]
}')
${AWS[@]} iam put-role-policy --role-name "$WORKER_ROLE_NAME" --policy-name "${PREFIX}-ocr-worker-inline" --policy-document "$WORKER_POLICY_DOC"

if ! ${AWS[@]} iam get-instance-profile --instance-profile-name "$WORKER_PROFILE_NAME" >/dev/null 2>&1; then
  ${AWS[@]} iam create-instance-profile --instance-profile-name "$WORKER_PROFILE_NAME" >/dev/null
fi
if ! ${AWS[@]} iam get-instance-profile --instance-profile-name "$WORKER_PROFILE_NAME" --query "InstanceProfile.Roles[?RoleName=='$WORKER_ROLE_NAME'] | length(@)" --output text | grep -q '^1$'; then
  ${AWS[@]} iam add-role-to-instance-profile --instance-profile-name "$WORKER_PROFILE_NAME" --role-name "$WORKER_ROLE_NAME" >/dev/null 2>&1 || true
fi

sleep 10
ASSOC_ID="$(${AWS[@]} ec2 describe-iam-instance-profile-associations --filters "Name=instance-id,Values=$INSTANCE_ID" --query 'IamInstanceProfileAssociations[0].AssociationId' --output text 2>/dev/null || true)"
if [[ -z "$ASSOC_ID" || "$ASSOC_ID" == "None" ]]; then
  ${AWS[@]} ec2 associate-iam-instance-profile --instance-id "$INSTANCE_ID" --iam-instance-profile Name="$WORKER_PROFILE_NAME" >/dev/null
else
  CURRENT_PROFILE_ARN="$(${AWS[@]} ec2 describe-iam-instance-profile-associations --association-ids "$ASSOC_ID" --query 'IamInstanceProfileAssociations[0].IamInstanceProfile.Arn' --output text 2>/dev/null || true)"
  if [[ "$CURRENT_PROFILE_ARN" != *"${WORKER_PROFILE_NAME}"* ]]; then
    ${AWS[@]} ec2 replace-iam-instance-profile-association --association-id "$ASSOC_ID" --iam-instance-profile Name="$WORKER_PROFILE_NAME" >/dev/null
  fi
fi

echo "[4/10] Ensuring EC2 queue worker service via SSM..."
INSTANCE_STATE="$(${AWS[@]} ec2 describe-instances --instance-ids "$INSTANCE_ID" --query 'Reservations[0].Instances[0].State.Name' --output text)"
if [[ "$INSTANCE_STATE" == "stopped" || "$INSTANCE_STATE" == "stopping" ]]; then
  ${AWS[@]} ec2 start-instances --instance-ids "$INSTANCE_ID" >/dev/null
  ${AWS[@]} ec2 wait instance-running --instance-ids "$INSTANCE_ID"
fi

SSM_ONLINE=0
for _ in {1..24}; do
  PING="$(${AWS[@]} ssm describe-instance-information --filters "Key=InstanceIds,Values=$INSTANCE_ID" --query 'InstanceInformationList[0].PingStatus' --output text 2>/dev/null || true)"
  if [[ "$PING" == "Online" ]]; then
    SSM_ONLINE=1
    break
  fi
  sleep 10
done
if [[ "$SSM_ONLINE" -ne 1 ]]; then
  echo "SSM agent is not online for instance $INSTANCE_ID. Cannot bootstrap worker service." >&2
  exit 1
fi

BOOTSTRAP_COMMANDS=$(cat <<EOF
set -euo pipefail
dnf install -y python3-pip >/dev/null 2>&1 || true
python3 -m pip install --upgrade pip >/dev/null 2>&1 || true
python3 -m pip install boto3 >/dev/null 2>&1
mkdir -p /opt/hama-ocr
cat > /opt/hama-ocr/queue_worker.py <<'PY'
import json
import logging
import os
import time
import boto3

logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(message)s')
REGION = os.getenv('AWS_REGION', 'us-east-1')
QUEUE_URL = os.getenv('QUEUE_URL')
if not QUEUE_URL:
    raise RuntimeError('QUEUE_URL is required')

sqs = boto3.client('sqs', region_name=REGION)

while True:
    try:
        resp = sqs.receive_message(
            QueueUrl=QUEUE_URL,
            MaxNumberOfMessages=5,
            WaitTimeSeconds=20,
            VisibilityTimeout=60,
        )
        for msg in resp.get('Messages', []):
            body = msg.get('Body', '')
            try:
                payload = json.loads(body)
            except Exception:
                payload = {'raw': body}
            logging.info(
                'drained message type=%s workspaceId=%s',
                payload.get('type'),
                payload.get('workspaceId'),
            )
            sqs.delete_message(QueueUrl=QUEUE_URL, ReceiptHandle=msg['ReceiptHandle'])
    except Exception as exc:
        logging.exception('worker loop error: %s', exc)
        time.sleep(5)
PY

cat > /etc/default/hama-ocr-worker <<ENV
AWS_REGION=${REGION}
QUEUE_URL=${QUEUE_URL}
ENV

cat > /etc/systemd/system/hama-ocr-worker.service <<'SERVICE'
[Unit]
Description=Hama RoK OCR queue worker
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
EnvironmentFile=/etc/default/hama-ocr-worker
ExecStart=/usr/bin/python3 /opt/hama-ocr/queue_worker.py
Restart=always
RestartSec=3
User=root

[Install]
WantedBy=multi-user.target
SERVICE

systemctl daemon-reload
systemctl enable --now hama-ocr-worker
systemctl restart hama-ocr-worker
systemctl is-active hama-ocr-worker
EOF
)

SSM_PARAMS_FILE=$(mktemp)
jq -n --arg cmd "$BOOTSTRAP_COMMANDS" '{commands: [$cmd]}' > "$SSM_PARAMS_FILE"

SSM_CMD_ID="$(${AWS[@]} ssm send-command \
  --instance-ids "$INSTANCE_ID" \
  --document-name 'AWS-RunShellScript' \
  --comment 'Bootstrap OCR queue worker service' \
  --parameters "file://$SSM_PARAMS_FILE" \
  --query 'Command.CommandId' \
  --output text)"
rm -f "$SSM_PARAMS_FILE"

${AWS[@]} ssm wait command-executed --command-id "$SSM_CMD_ID" --instance-id "$INSTANCE_ID"
SSM_STATUS="$(${AWS[@]} ssm get-command-invocation --command-id "$SSM_CMD_ID" --instance-id "$INSTANCE_ID" --query 'Status' --output text)"
if [[ "$SSM_STATUS" != "Success" ]]; then
  echo "SSM bootstrap failed with status: $SSM_STATUS" >&2
  ${AWS[@]} ssm get-command-invocation --command-id "$SSM_CMD_ID" --instance-id "$INSTANCE_ID" --query 'StandardErrorContent' --output text >&2 || true
  exit 1
fi

${AWS[@]} ec2 stop-instances --instance-ids "$INSTANCE_ID" >/dev/null
${AWS[@]} ec2 wait instance-stopped --instance-ids "$INSTANCE_ID"

echo "[5/10] Ensuring Lambda IAM role..."
TRUST_DOC=$(cat <<'JSON'
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": {"Service": "lambda.amazonaws.com"},
    "Action": "sts:AssumeRole"
  }]
}
JSON
)

if ! ${AWS[@]} iam get-role --role-name "$LAMBDA_ROLE_NAME" >/dev/null 2>&1; then
  ${AWS[@]} iam create-role --role-name "$LAMBDA_ROLE_NAME" --assume-role-policy-document "$TRUST_DOC" >/dev/null
fi

POLICY_DOC=$(jq -cn --arg qarn "$QUEUE_ARN" '{
  Version:"2012-10-17",
  Statement:[
    {Effect:"Allow",Action:["logs:CreateLogGroup","logs:CreateLogStream","logs:PutLogEvents"],Resource:"*"},
    {Effect:"Allow",Action:["ec2:DescribeInstances","ec2:StartInstances","ec2:StopInstances"],Resource:"*"},
    {Effect:"Allow",Action:["sqs:GetQueueAttributes"],Resource:$qarn}
  ]
}')
${AWS[@]} iam put-role-policy --role-name "$LAMBDA_ROLE_NAME" --policy-name "${PREFIX}-ocr-control-inline" --policy-document "$POLICY_DOC"
ROLE_ARN="$(${AWS[@]} iam get-role --role-name "$LAMBDA_ROLE_NAME" --query 'Role.Arn' --output text)"
# IAM role propagation delay can cause transient assume-role failures.
sleep 10

echo "[6/10] Building Lambda packages..."
TMPDIR=$(mktemp -d)
cat > "$TMPDIR/start_handler.py" <<'PY'
import os
import boto3

sqs = boto3.client('sqs')
ec2 = boto3.client('ec2')


def _pending(queue_url: str) -> int:
    attrs = sqs.get_queue_attributes(
        QueueUrl=queue_url,
        AttributeNames=["ApproximateNumberOfMessages", "ApproximateNumberOfMessagesNotVisible"],
    )["Attributes"]
    return int(attrs.get("ApproximateNumberOfMessages", "0")) + int(
        attrs.get("ApproximateNumberOfMessagesNotVisible", "0")
    )


def lambda_handler(event, context):
    queue_url = os.environ["QUEUE_URL"]
    instance_id = os.environ["INSTANCE_ID"]
    threshold = int(os.environ.get("START_THRESHOLD", "1"))

    pending = _pending(queue_url)
    state = ec2.describe_instances(InstanceIds=[instance_id])["Reservations"][0]["Instances"][0]["State"]["Name"]

    started = False
    if pending >= threshold and state in ("stopped", "stopping"):
        ec2.start_instances(InstanceIds=[instance_id])
        started = True

    return {"pending": pending, "instanceState": state, "started": started}
PY

cat > "$TMPDIR/stop_handler.py" <<'PY'
import os
import boto3

sqs = boto3.client('sqs')
ec2 = boto3.client('ec2')


def _pending(queue_url: str) -> int:
    attrs = sqs.get_queue_attributes(
        QueueUrl=queue_url,
        AttributeNames=["ApproximateNumberOfMessages", "ApproximateNumberOfMessagesNotVisible"],
    )["Attributes"]
    return int(attrs.get("ApproximateNumberOfMessages", "0")) + int(
        attrs.get("ApproximateNumberOfMessagesNotVisible", "0")
    )


def lambda_handler(event, context):
    queue_url = os.environ["QUEUE_URL"]
    instance_id = os.environ["INSTANCE_ID"]

    pending = _pending(queue_url)
    state = ec2.describe_instances(InstanceIds=[instance_id])["Reservations"][0]["Instances"][0]["State"]["Name"]

    stopped = False
    if pending == 0 and state == "running":
        ec2.stop_instances(InstanceIds=[instance_id])
        stopped = True

    return {"pending": pending, "instanceState": state, "stopped": stopped}
PY

( cd "$TMPDIR" && zip -q start.zip start_handler.py && zip -q stop.zip stop_handler.py )

echo "[7/10] Ensuring Lambda functions..."
upsert_lambda () {
  local name="$1"
  local zip_path="$2"
  local handler="$3"

  if ${AWS[@]} lambda get-function --function-name "$name" >/dev/null 2>&1; then
    ${AWS[@]} lambda update-function-code --function-name "$name" --zip-file "fileb://$zip_path" >/dev/null
    ${AWS[@]} lambda update-function-configuration \
      --function-name "$name" \
      --runtime python3.12 \
      --handler "$handler" \
      --timeout 30 \
      --memory-size 128 \
      --environment "Variables={QUEUE_URL=$QUEUE_URL,INSTANCE_ID=$INSTANCE_ID,START_THRESHOLD=1}" >/dev/null
  else
    local retries=6
    local wait_seconds=5
    local ok=0
    for ((i=1; i<=retries; i++)); do
      if ${AWS[@]} lambda create-function \
        --function-name "$name" \
        --runtime python3.12 \
        --handler "$handler" \
        --role "$ROLE_ARN" \
        --timeout 30 \
        --memory-size 128 \
        --zip-file "fileb://$zip_path" \
        --environment "Variables={QUEUE_URL=$QUEUE_URL,INSTANCE_ID=$INSTANCE_ID,START_THRESHOLD=1}" >/dev/null 2>&1; then
        ok=1
        break
      fi
      sleep "$wait_seconds"
    done
    if [[ "$ok" -ne 1 ]]; then
      echo "Failed to create Lambda function '$name' after retries." >&2
      exit 1
    fi
  fi
}

upsert_lambda "$LAMBDA_START_NAME" "$TMPDIR/start.zip" "start_handler.lambda_handler"
upsert_lambda "$LAMBDA_STOP_NAME" "$TMPDIR/stop.zip" "stop_handler.lambda_handler"

START_LAMBDA_ARN="$(${AWS[@]} lambda get-function --function-name "$LAMBDA_START_NAME" --query 'Configuration.FunctionArn' --output text)"
STOP_LAMBDA_ARN="$(${AWS[@]} lambda get-function --function-name "$LAMBDA_STOP_NAME" --query 'Configuration.FunctionArn' --output text)"

echo "[8/10] Ensuring EventBridge schedules..."
${AWS[@]} events put-rule --name "$START_RULE_NAME" --schedule-expression 'rate(2 minutes)' --state ENABLED >/dev/null
${AWS[@]} events put-rule --name "$STOP_RULE_NAME" --schedule-expression 'rate(5 minutes)' --state ENABLED >/dev/null

${AWS[@]} events put-targets --rule "$START_RULE_NAME" --targets "Id"="1","Arn"="$START_LAMBDA_ARN" >/dev/null
${AWS[@]} events put-targets --rule "$STOP_RULE_NAME" --targets "Id"="1","Arn"="$STOP_LAMBDA_ARN" >/dev/null

echo "[9/10] Ensuring Lambda invoke permissions for EventBridge..."
ACCOUNT_ID="$(${AWS[@]} sts get-caller-identity --query Account --output text)"
START_RULE_ARN="arn:aws:events:${REGION}:${ACCOUNT_ID}:rule/${START_RULE_NAME}"
STOP_RULE_ARN="arn:aws:events:${REGION}:${ACCOUNT_ID}:rule/${STOP_RULE_NAME}"

${AWS[@]} lambda add-permission --function-name "$LAMBDA_START_NAME" --statement-id "${START_RULE_NAME}-invoke" --action lambda:InvokeFunction --principal events.amazonaws.com --source-arn "$START_RULE_ARN" >/dev/null 2>&1 || true
${AWS[@]} lambda add-permission --function-name "$LAMBDA_STOP_NAME" --statement-id "${STOP_RULE_NAME}-invoke" --action lambda:InvokeFunction --principal events.amazonaws.com --source-arn "$STOP_RULE_ARN" >/dev/null 2>&1 || true

echo "[10/10] Testing start/stop lambdas..."
${AWS[@]} lambda invoke --function-name "$LAMBDA_START_NAME" --payload '{}' /tmp/${LAMBDA_START_NAME}.json >/dev/null
${AWS[@]} lambda invoke --function-name "$LAMBDA_STOP_NAME" --payload '{}' /tmp/${LAMBDA_STOP_NAME}.json >/dev/null

echo ""
echo "Done."
echo "Region:            $REGION"
echo "Queue URL:         $QUEUE_URL"
echo "Queue ARN:         $QUEUE_ARN"
echo "Worker Instance:   $INSTANCE_ID"
echo "Start Lambda:      $LAMBDA_START_NAME"
echo "Stop Lambda:       $LAMBDA_STOP_NAME"
echo "Start Rule:        $START_RULE_NAME (every 2 min)"
echo "Stop Rule:         $STOP_RULE_NAME (every 5 min)"
echo ""
echo "Local test outputs:"
cat /tmp/${LAMBDA_START_NAME}.json || true
echo ""
cat /tmp/${LAMBDA_STOP_NAME}.json || true
echo ""

rm -rf "$TMPDIR"
