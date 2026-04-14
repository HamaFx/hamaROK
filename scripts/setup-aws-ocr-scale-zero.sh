#!/usr/bin/env bash
set -euo pipefail

PREFIX="${1:-hama-rok}"
REGION="${AWS_REGION:-$(aws configure get region || true)}"
REGION="${REGION:-us-east-1}"
APP_URL="${APP_URL:-${NEXT_PUBLIC_APP_URL:-}}"
SERVICE_SECRET="${SERVICE_SECRET:-${APP_SIGNING_SECRET:-}}"

if [[ -z "${APP_URL}" ]]; then
  echo "APP_URL (or NEXT_PUBLIC_APP_URL) is required to configure worker callbacks." >&2
  exit 1
fi

if [[ -z "${SERVICE_SECRET}" ]]; then
  echo "SERVICE_SECRET (or APP_SIGNING_SECRET) is required to sign internal worker callbacks." >&2
  exit 1
fi

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
STOP_RULE_DISABLED=0

restore_stop_rule() {
  if [[ "${STOP_RULE_DISABLED:-0}" -eq 1 ]]; then
    ${AWS[@]} events enable-rule --name "$STOP_RULE_NAME" >/dev/null 2>&1 || true
  fi
}
trap restore_stop_rule EXIT

echo "[1/10] Ensuring SQS queues..."
DLQ_URL="$(${AWS[@]} sqs create-queue --queue-name "$DLQ_NAME" --query 'QueueUrl' --output text)"
DLQ_ARN="$(${AWS[@]} sqs get-queue-attributes --queue-url "$DLQ_URL" --attribute-names QueueArn --query 'Attributes.QueueArn' --output text)"
REDRIVE_POLICY=$(jq -cn --arg arn "$DLQ_ARN" '{deadLetterTargetArn:$arn,maxReceiveCount:"5"}')
QUEUE_URL="$(${AWS[@]} sqs create-queue --queue-name "$QUEUE_NAME" --query 'QueueUrl' --output text)"
QUEUE_ATTR_FILE=$(mktemp)
jq -cn --arg rp "$REDRIVE_POLICY" '{
  RedrivePolicy:$rp,
  VisibilityTimeout:"300",
  ReceiveMessageWaitTimeSeconds:"20"
}' > "$QUEUE_ATTR_FILE"
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
# Prevent the scheduled idle-stop lambda from terminating the instance mid-bootstrap.
${AWS[@]} events disable-rule --name "$STOP_RULE_NAME" >/dev/null 2>&1 || true
STOP_RULE_DISABLED=1

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
dnf install -y python3-pip python3-virtualenv tesseract mesa-libGL libXext libSM >/dev/null 2>&1 || true
mkdir -p /opt/hama-ocr
python3 -m venv /opt/hama-ocr/.venv
/opt/hama-ocr/.venv/bin/pip install --upgrade pip setuptools wheel >/dev/null 2>&1 || true
/opt/hama-ocr/.venv/bin/pip install \
  "boto3>=1.34,<2" \
  "requests>=2.31,<3" \
  "numpy<2" \
  "opencv-python-headless==4.10.0.84" \
  "pytesseract>=0.3.10,<0.4" \
  "paddlepaddle==2.6.2" \
  "paddleocr==2.7.3" >/dev/null 2>&1
/opt/hama-ocr/.venv/bin/pip uninstall -y opencv-python >/dev/null 2>&1 || true
/opt/hama-ocr/.venv/bin/pip install --upgrade --force-reinstall "opencv-python-headless==4.10.0.84" >/dev/null 2>&1
/opt/hama-ocr/.venv/bin/pip install --upgrade --force-reinstall "numpy<2" >/dev/null 2>&1

cat > /opt/hama-ocr/paddle_runner.py <<'PY'
import json
import sys
import io
import contextlib
from typing import Any, Dict, List

import cv2
from paddleocr import PaddleOCR


def _to_lines(result: Any) -> List[Dict[str, Any]]:
    lines: List[Dict[str, Any]] = []
    for block in result or []:
        if not block:
            continue
        for line in block:
            if not line or len(line) < 2:
                continue
            box = line[0]
            text_conf = line[1]
            text = str(text_conf[0] if isinstance(text_conf, (list, tuple)) and len(text_conf) > 0 else '').strip()
            if not text:
                continue
            confidence = float(text_conf[1] if isinstance(text_conf, (list, tuple)) and len(text_conf) > 1 else 0.0)
            xs = [float(point[0]) for point in box]
            ys = [float(point[1]) for point in box]
            lines.append({
                'text': text,
                'confidence': max(0.0, min(1.0, confidence)),
                'x': float(min(xs)),
                'y': float(min(ys)),
                'w': float(max(xs) - min(xs)),
                'h': float(max(ys) - min(ys)),
                'cx': float((min(xs) + max(xs)) / 2.0),
                'cy': float((min(ys) + max(ys)) / 2.0),
            })
    lines.sort(key=lambda item: (item['cy'], item['cx']))
    return lines


def main() -> int:
    if len(sys.argv) < 2:
        print('[]')
        return 2
    image_path = sys.argv[1]
    image = cv2.imread(image_path)
    if image is None:
        print('[]')
        return 3
    captured = io.StringIO()
    with contextlib.redirect_stdout(captured):
        ocr = PaddleOCR(use_angle_cls=True, lang='en', show_log=False)
        result = ocr.ocr(image, cls=True)
    noisy = captured.getvalue().strip()
    if noisy:
        sys.stderr.write(noisy[-4000:])
    print(json.dumps(_to_lines(result), ensure_ascii=True))
    return 0


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except Exception as exc:
        sys.stderr.write(f'{type(exc).__name__}: {exc}')
        raise SystemExit(1)
PY

# Warm up PaddleOCR models once during bootstrap to avoid first-task cold start timeouts.
/opt/hama-ocr/.venv/bin/python3 - <<'PY'
import cv2
import numpy as np
img = np.full((120, 400, 3), 255, dtype=np.uint8)
cv2.putText(img, 'Warmup OCR', (20, 72), cv2.FONT_HERSHEY_SIMPLEX, 1.2, (0, 0, 0), 2, cv2.LINE_AA)
cv2.imwrite('/tmp/hama-ocr-warmup.png', img)
PY
timeout 420 /opt/hama-ocr/.venv/bin/python3 /opt/hama-ocr/paddle_runner.py /tmp/hama-ocr-warmup.png >/tmp/hama-ocr-warmup.out 2>/tmp/hama-ocr-warmup.err || true

cat > /opt/hama-ocr/queue_worker.py <<'PY'
import json
import logging
import os
import re
import time
import traceback
import hmac
import hashlib
import subprocess
import tempfile
from typing import Any, Dict, List, Optional, Tuple

import boto3
import cv2
import numpy as np
import pytesseract
import requests

logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(message)s')
REGION = os.getenv('AWS_REGION', 'us-east-1')
QUEUE_URL = os.getenv('QUEUE_URL')
INTERNAL_API_BASE_URL = os.getenv('INTERNAL_API_BASE_URL')
APP_SIGNING_SECRET = os.getenv('APP_SIGNING_SECRET')
MAX_RECEIVE_COUNT = int(os.getenv('MAX_RECEIVE_COUNT', '3'))
INTERNAL_REQUEST_TIMEOUT_SEC = float(os.getenv('INTERNAL_REQUEST_TIMEOUT_SEC', '30'))
IMAGE_DOWNLOAD_TIMEOUT_SEC = float(os.getenv('IMAGE_DOWNLOAD_TIMEOUT_SEC', '40'))
PADDLE_TIMEOUT_SEC = float(os.getenv('PADDLE_TIMEOUT_SEC', '45'))
PADDLE_RUNNER_PATH = os.getenv('PADDLE_RUNNER_PATH', '/opt/hama-ocr/paddle_runner.py')
PADDLE_PYTHON = os.getenv('PADDLE_PYTHON', '/opt/hama-ocr/.venv/bin/python3')
ENABLE_PADDLE_OCR = os.getenv('ENABLE_PADDLE_OCR', '1').strip().lower() not in ('0', 'false', 'no')
TESSERACT_TIMEOUT_SEC = float(os.getenv('TESSERACT_TIMEOUT_SEC', '15'))
TESSERACT_CMD = os.getenv('TESSERACT_CMD', '/usr/bin/tesseract')
WORKER_ID = os.getenv('WORKER_ID', os.uname().nodename)

if not QUEUE_URL:
    raise RuntimeError('QUEUE_URL is required')
if not INTERNAL_API_BASE_URL:
    raise RuntimeError('INTERNAL_API_BASE_URL is required')
if not APP_SIGNING_SECRET:
    raise RuntimeError('APP_SIGNING_SECRET is required')

sqs = boto3.client('sqs', region_name=REGION)
http = requests.Session()
pytesseract.pytesseract.tesseract_cmd = TESSERACT_CMD

PRIMARY_KINGDOM_NUMBER = '4057'
TRACKED_ALLIANCES = [
    {
        'tag': 'GODt',
        'name': 'GOD of Thunder',
        'aliases': ['GODT', 'GOD OF THUNDER', 'GODTHUNDER', '[GODT]'],
    },
    {
        'tag': 'V57',
        'name': 'Legacy of Velmora',
        'aliases': ['V57', '[V57]', 'LEGACY OF VELMORA', 'VELMORA'],
    },
    {
        'tag': 'P57R',
        'name': 'PHOENIX RISING 4057',
        'aliases': ['P57R', '[P57R]', 'PHOENIX RISING', 'PHOENIX RISING 4057', 'PHOENIXRISING4057'],
    },
]
TRACKED_TAG_MAP = {
    re.sub(r'[^A-Z0-9]', '', item['tag'].upper()): item
    for item in TRACKED_ALLIANCES
}
TRACKED_ALIAS_MAP = {}
for alliance in TRACKED_ALLIANCES:
    for alias in alliance['aliases']:
        TRACKED_ALIAS_MAP[re.sub(r'[^A-Z0-9]', '', alias.upper())] = alliance

def _normalize_alliance_token(value: str) -> str:
    return re.sub(r'[^A-Z0-9]', '', str(value or '').upper())

def _format_alliance_label(alliance: Dict[str, Any]) -> str:
    return f'[{alliance["tag"]}] {alliance["name"]}'

def _detect_tracked_alliance(text: str) -> Optional[Dict[str, Any]]:
    raw = str(text or '').strip()
    if not raw:
        return None

    match = re.search(r'\[([A-Za-z0-9]{2,6})\]', raw)
    if match:
        bracket = _normalize_alliance_token(match.group(1))
        if bracket in TRACKED_TAG_MAP:
            return TRACKED_TAG_MAP[bracket]

    normalized = _normalize_alliance_token(raw)
    if not normalized:
        return None
    if normalized in TRACKED_ALIAS_MAP:
        return TRACKED_ALIAS_MAP[normalized]

    for alias, alliance in TRACKED_ALIAS_MAP.items():
        if not alias or len(alias) < 3:
            continue
        if alias in normalized or normalized in alias:
            return alliance

    return None

def _sanitize_printable(value: str, max_len: int = 80) -> str:
    cleaned = re.sub(r'[^\x20-\x7E]', ' ', str(value or ''))
    cleaned = re.sub(r'\s+', ' ', cleaned).strip()
    return cleaned[:max_len]

def _split_name_and_alliance(governor_name_raw: str, alliance_hint: str = '') -> Dict[str, Any]:
    name = _sanitize_printable(governor_name_raw, 64)
    hint = _sanitize_printable(alliance_hint, 80)

    detected = _detect_tracked_alliance(name) or _detect_tracked_alliance(hint)
    stripped = name
    tag_match = re.match(r'^\[([A-Za-z0-9]{2,6})\]\s*(.+)$', name)
    if tag_match and _normalize_alliance_token(tag_match.group(1)) in TRACKED_TAG_MAP:
        stripped = _sanitize_printable(tag_match.group(2), 64)

    if detected:
        return {
            'governorNameRaw': stripped or name,
            'allianceRaw': _format_alliance_label(detected),
            'allianceTag': detected['tag'],
            'trackedAlliance': True,
        }

    return {
        'governorNameRaw': stripped or name,
        'allianceRaw': hint or None,
        'allianceTag': None,
        'trackedAlliance': False,
    }

def _sign_headers(payload: str) -> Dict[str, str]:
    timestamp = str(int(time.time() * 1000))
    digest = hmac.new(
        APP_SIGNING_SECRET.encode('utf-8'),
        f'{timestamp}.{payload}'.encode('utf-8'),
        hashlib.sha256,
    ).hexdigest()
    return {
        'Content-Type': 'application/json',
        'x-service-timestamp': timestamp,
        'x-service-signature': f'sha256={digest}',
    }

def _post_internal(path: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    body = json.dumps(payload)
    res = http.post(
        f'{INTERNAL_API_BASE_URL.rstrip("/")}{path}',
        data=body,
        headers=_sign_headers(body),
        timeout=INTERNAL_REQUEST_TIMEOUT_SEC,
    )
    data = res.json() if res.content else {}
    if res.status_code >= 400:
        raise RuntimeError(
            f'internal endpoint failed: {path} status={res.status_code} '
            f'message={data.get("error", {}).get("message", "unknown")}'
        )
    return data

def _download_image(url: str) -> np.ndarray:
    res = http.get(url, timeout=IMAGE_DOWNLOAD_TIMEOUT_SEC)
    if res.status_code >= 400:
        raise RuntimeError(f'failed to download screenshot: status={res.status_code}')
    content = np.frombuffer(res.content, dtype=np.uint8)
    image = cv2.imdecode(content, cv2.IMREAD_COLOR)
    if image is None:
        raise RuntimeError('failed to decode screenshot bytes')
    return image

def _normalize_ocr_line(raw: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    try:
        text = str(raw.get('text') or '').strip()
        if not text:
            return None
        confidence = float(raw.get('confidence') or 0.0)
        x = float(raw.get('x') or 0.0)
        y = float(raw.get('y') or 0.0)
        w = float(raw.get('w') or 0.0)
        h = float(raw.get('h') or 0.0)
        cx = float(raw.get('cx') or (x + (w / 2.0)))
        cy = float(raw.get('cy') or (y + (h / 2.0)))
        return {
            'text': text,
            'confidence': max(0.0, min(1.0, confidence)),
            'x': x,
            'y': y,
            'w': w,
            'h': h,
            'cx': cx,
            'cy': cy,
        }
    except Exception:
        return None

def _ocr_lines_tesseract(img: np.ndarray, psm: int = 6, whitelist: Optional[str] = None) -> List[Dict[str, Any]]:
    rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
    config = f'--oem 1 --psm {psm}'
    if whitelist:
        config += f' -c tessedit_char_whitelist={whitelist}'
    try:
        data = pytesseract.image_to_data(
            rgb,
            output_type=pytesseract.Output.DICT,
            config=config,
            timeout=TESSERACT_TIMEOUT_SEC,
        )
    except pytesseract.TesseractNotFoundError as exc:
        logging.warning('tesseract missing, skipping tesseract pass: %s', exc)
        return []
    except RuntimeError as exc:
        logging.warning('tesseract timed out/failed, skipping pass: %s', exc)
        return []
    except Exception as exc:
        logging.warning('tesseract unexpected failure, skipping pass: %s', exc)
        return []
    output: List[Dict[str, Any]] = []
    for index, text in enumerate(data.get('text', [])):
        text_value = str(text or '').strip()
        if not text_value:
            continue
        conf_raw = data.get('conf', [])[index] if index < len(data.get('conf', [])) else '-1'
        try:
            confidence = max(0.0, min(1.0, float(conf_raw) / 100.0))
        except Exception:
            confidence = 0.0
        x = float(data.get('left', [0])[index])
        y = float(data.get('top', [0])[index])
        w = float(data.get('width', [0])[index])
        h = float(data.get('height', [0])[index])
        output.append({
            'text': text_value,
            'confidence': confidence,
            'x': x,
            'y': y,
            'w': w,
            'h': h,
            'cx': x + (w / 2.0),
            'cy': y + (h / 2.0),
        })
    output.sort(key=lambda item: (item['cy'], item['cx'], item['x']))
    return output

def _ocr_lines_paddle(img: np.ndarray) -> List[Dict[str, Any]]:
    if not ENABLE_PADDLE_OCR:
        return []
    lines: List[Dict[str, Any]] = []
    if not os.path.exists(PADDLE_RUNNER_PATH):
        return []

    with tempfile.NamedTemporaryFile(prefix='ocr-', suffix='.png', delete=False) as temp:
        temp_path = temp.name

    try:
        ok, encoded = cv2.imencode('.png', img)
        if not ok:
            return []
        with open(temp_path, 'wb') as handle:
            handle.write(encoded.tobytes())

        proc = subprocess.run(
            [PADDLE_PYTHON, PADDLE_RUNNER_PATH, temp_path],
            capture_output=True,
            text=True,
            timeout=PADDLE_TIMEOUT_SEC,
            check=False,
        )
        if proc.returncode != 0:
            logging.warning('paddle runner failed rc=%s stderr=%s', proc.returncode, proc.stderr.strip()[:200])
            return []
        raw_output = (proc.stdout or '').strip()
        if not raw_output:
            return []
        try:
            payload = json.loads(raw_output)
        except json.JSONDecodeError:
            # Some Paddle builds may emit non-JSON progress/log lines to stdout.
            match = re.search(r'(\[[\s\S]*\])\s*$', raw_output)
            if not match:
                logging.warning('paddle runner returned non-json stdout')
                return []
            payload = json.loads(match.group(1))
        if not isinstance(payload, list):
            return []
        for item in payload:
            if not isinstance(item, dict):
                continue
            normalized = _normalize_ocr_line(item)
            if normalized:
                lines.append(normalized)
        lines.sort(key=lambda item: (item['cy'], item['cx'], item['x']))
        return lines
    except Exception as exc:
        logging.warning('paddle runner exception: %s', exc)
        return []
    finally:
        try:
            os.unlink(temp_path)
        except Exception:
            pass

def _dedupe_lines(lines: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    deduped: List[Dict[str, Any]] = []
    lines_sorted = sorted(lines, key=lambda item: (-item['confidence'], item['cy'], item['cx']))
    for line in lines_sorted:
        text_norm = re.sub(r'[^A-Za-z0-9]+', '', line['text']).upper()
        duplicate = False
        for existing in deduped:
            existing_norm = re.sub(r'[^A-Za-z0-9]+', '', existing['text']).upper()
            if text_norm and text_norm == existing_norm and abs(existing['cx'] - line['cx']) < 10 and abs(existing['cy'] - line['cy']) < 8:
                duplicate = True
                break
        if not duplicate:
            deduped.append(line)
    deduped.sort(key=lambda item: (item['cy'], item['cx'], item['x']))
    return deduped

def _preprocess_variants(image: np.ndarray) -> List[np.ndarray]:
    scaled = cv2.resize(image, None, fx=1.5, fy=1.5, interpolation=cv2.INTER_CUBIC)
    gray = cv2.cvtColor(scaled, cv2.COLOR_BGR2GRAY)
    # Deskew by dominant text angle when possible.
    inverted = cv2.bitwise_not(gray)
    coords = np.column_stack(np.where(inverted > 0))
    if coords.size > 0:
        angle = cv2.minAreaRect(coords)[-1]
        if angle < -45:
            angle = -(90 + angle)
        else:
            angle = -angle
        if abs(angle) > 0.2 and abs(angle) < 8:
            h, w = gray.shape[:2]
            matrix = cv2.getRotationMatrix2D((w / 2, h / 2), angle, 1.0)
            scaled = cv2.warpAffine(
                scaled,
                matrix,
                (w, h),
                flags=cv2.INTER_CUBIC,
                borderMode=cv2.BORDER_REPLICATE,
            )
            gray = cv2.cvtColor(scaled, cv2.COLOR_BGR2GRAY)

    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8)).apply(gray)
    denoise = cv2.bilateralFilter(clahe, 7, 75, 75)
    adaptive = cv2.adaptiveThreshold(
        denoise,
        255,
        cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
        cv2.THRESH_BINARY,
        35,
        11,
    )
    _, otsu = cv2.threshold(denoise, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    morph = cv2.morphologyEx(adaptive, cv2.MORPH_OPEN, np.ones((2, 2), np.uint8))
    return [
        scaled,
        cv2.cvtColor(clahe, cv2.COLOR_GRAY2BGR),
        cv2.cvtColor(adaptive, cv2.COLOR_GRAY2BGR),
        cv2.cvtColor(otsu, cv2.COLOR_GRAY2BGR),
        cv2.cvtColor(morph, cv2.COLOR_GRAY2BGR),
    ]

def _merge_lines(variants: List[np.ndarray]) -> Tuple[List[Dict[str, Any]], Dict[str, Any]]:
    merged: List[Dict[str, Any]] = []
    tesseract_count = 0
    paddle_count = 0

    for variant in variants:
        lines = _ocr_lines_tesseract(variant, psm=6)
        tesseract_count += len(lines)
        merged.extend(lines)

    # Run Paddle OCR in process isolation so paddle runtime failures do not kill the worker.
    for variant in variants[:2]:
        lines = _ocr_lines_paddle(variant)
        if lines:
            paddle_count += len(lines)
            merged.extend(lines)

    deduped = _dedupe_lines(merged)
    return deduped, {
        'tesseractLines': tesseract_count,
        'paddleLines': paddle_count,
        'mergedLines': len(deduped),
        'enablePaddle': ENABLE_PADDLE_OCR,
    }

def _detect_archetype(lines: List[Dict[str, Any]], hint) -> str:
    text = ' '.join(line['text'] for line in lines[:30]).upper()
    hint_text = (hint or '').upper()
    if 'PROFILE' in hint_text:
        return 'governor_profile'
    if 'RANKING' in hint_text:
        return 'ranking_board'
    if 'GOVERNOR PROFILE' in text or 'GOVERNOR(ID' in text or 'GOVERNOR (ID' in text:
        return 'governor_profile'
    if 'RANKINGS' in text:
        return 'ranking_board'
    return 'governor_profile'

def _clean_digits(value: str, max_len: int = 18) -> str:
    normalized = str(value or '').upper()
    normalized = (
        normalized
        .replace('O', '0')
        .replace('Q', '0')
        .replace('D', '0')
        .replace('I', '1')
        .replace('L', '1')
        .replace('|', '1')
        .replace('S', '5')
        .replace('B', '8')
        .replace('G', '6')
        .replace('Z', '2')
    )
    return re.sub(r'[^0-9]', '', normalized)[:max_len]

def _extract_profile_alliance(lines: List[Dict[str, Any]], width: int) -> Tuple[str, float]:
    for line in lines:
        text_upper = line['text'].upper()
        if 'ALLIANCE' not in text_upper:
            continue

        inline = re.sub(r'ALLIANCE[: ]*', '', line['text'], flags=re.IGNORECASE).strip()
        detected_inline = _detect_tracked_alliance(inline)
        if detected_inline:
            return _format_alliance_label(detected_inline), float(line['confidence'])

        nearest = None
        best_dx = None
        for candidate in lines:
            if candidate['cx'] <= line['cx']:
                continue
            if abs(candidate['cy'] - line['cy']) > max(22, line['h'] * 1.8):
                continue
            if candidate['cx'] < width * 0.45:
                continue
            if not re.search(r'[A-Za-z]', candidate['text']):
                continue
            dx = candidate['cx'] - line['cx']
            if best_dx is None or dx < best_dx:
                best_dx = dx
                nearest = candidate

        if nearest is not None:
            detected = _detect_tracked_alliance(nearest['text'])
            value = _format_alliance_label(detected) if detected else _sanitize_printable(nearest['text'], 80)
            return value, float(nearest['confidence'])

    for line in lines:
        detected = _detect_tracked_alliance(line['text'])
        if detected:
            return _format_alliance_label(detected), float(line['confidence'])

    return '', 0.0

def _extract_label_value(lines: List[Dict[str, Any]], keyword: str, width: int) -> tuple[str, float]:
    keyword_upper = keyword.upper()
    for line in lines:
        text_upper = line['text'].upper()
        if keyword_upper in text_upper:
            digits = _clean_digits(line['text'])
            if digits:
                return digits, float(line['confidence'])
            nearest = None
            best_dx = None
            for candidate in lines:
                if candidate['cx'] <= line['cx']:
                    continue
                if abs(candidate['cy'] - line['cy']) > max(18, line['h'] * 1.5):
                    continue
                if candidate['cx'] < width * 0.55:
                    continue
                cand_digits = _clean_digits(candidate['text'])
                if not cand_digits:
                    continue
                dx = candidate['cx'] - line['cx']
                if best_dx is None or dx < best_dx:
                    best_dx = dx
                    nearest = candidate
            if nearest is not None:
                return _clean_digits(nearest['text']), float(nearest['confidence'])
    return '', 0.0

def _extract_governor_name(lines: List[Dict[str, Any]], width: int, height: int) -> tuple[str, float]:
    candidates: List[Dict[str, Any]] = []
    for line in lines:
        text = line['text'].strip()
        text_upper = text.upper()
        if len(text) < 3:
            continue
        if re.fullmatch(r'[0-9,]+', text):
            continue
        if any(token in text_upper for token in ['GOVERNOR', 'KILL', 'POWER', 'PROFILE', 'ALLIANCE', 'CHINA']):
            continue
        if line['cx'] < width * 0.28 or line['cx'] > width * 0.72:
            continue
        if line['cy'] < height * 0.12 or line['cy'] > height * 0.5:
            continue
        candidates.append(line)

    if not candidates:
        return '', 0.0

    candidates.sort(key=lambda item: (item['cy'], -item['confidence']))
    best = max(candidates[:5], key=lambda item: item['confidence'])
    cleaned = re.sub(r'[^A-Za-z0-9 _\-\[\]()#.:+]', '', best['text']).strip()
    return cleaned[:64], float(best['confidence'])

def _extract_profile(lines: List[Dict[str, Any]], width: int, height: int, trace: Dict[str, Any]) -> Dict[str, Any]:
    full_text = ' '.join(line['text'] for line in lines)
    governor_id_match = re.search(r'GOVERNOR\s*\(\s*ID\s*[: ]*([0-9]{6,12})', full_text, re.IGNORECASE) or re.search(r'([0-9]{6,12})', full_text)
    governor_id = governor_id_match.group(1) if governor_id_match else ''
    governor_id_conf = 0.92 if governor_id else 0.0

    kill_points, kp_conf = _extract_label_value(lines, 'KILL POINT', width)
    power, power_conf = _extract_label_value(lines, 'POWER', width)
    t4, t4_conf = _extract_label_value(lines, 'T4', width)
    t5, t5_conf = _extract_label_value(lines, 'T5', width)
    deads, deads_conf = _extract_label_value(lines, 'DEAD', width)
    governor_name, name_conf = _extract_governor_name(lines, width, height)
    alliance_raw, alliance_conf = _extract_profile_alliance(lines, width)
    split = _split_name_and_alliance(governor_name, alliance_raw)
    governor_name = split['governorNameRaw']
    alliance_raw = split['allianceRaw'] or alliance_raw

    confidence_values = [governor_id_conf, name_conf, kp_conf, power_conf, t4_conf, t5_conf, deads_conf, alliance_conf]
    non_zero = [value for value in confidence_values if value > 0]
    overall = sum(non_zero) / len(non_zero) if non_zero else 0.0

    failure_reasons: List[str] = []
    if not governor_id:
        failure_reasons.append('missing-governor-id')
    if not governor_name:
        failure_reasons.append('missing-governor-name')
    if not power:
        failure_reasons.append('missing-power')
    if not alliance_raw:
        failure_reasons.append('missing-alliance')
    if overall < 0.72:
        failure_reasons.append('low-overall-confidence')

    return {
        'provider': 'TESSERACT',
        'status': 'RAW',
        'governorIdRaw': governor_id,
        'governorNameRaw': governor_name,
        'confidence': max(0.0, min(100.0, overall * 100)),
        'engineVersion': 'local-hybrid-opencv-v2',
        'lowConfidence': overall < 0.82,
        'failureReasons': failure_reasons,
        'fields': {
            'governorId': {'value': governor_id, 'confidence': governor_id_conf * 100},
            'governorName': {'value': governor_name, 'confidence': name_conf * 100},
            'power': {'value': power, 'confidence': power_conf * 100},
            'killPoints': {'value': kill_points, 'confidence': kp_conf * 100},
            't4Kills': {'value': t4, 'confidence': t4_conf * 100},
            't5Kills': {'value': t5, 'confidence': t5_conf * 100},
            'deads': {'value': deads, 'confidence': deads_conf * 100},
            'alliance': {'value': alliance_raw, 'confidence': alliance_conf * 100},
        },
        'normalized': {
            'governorId': governor_id,
            'governorName': governor_name,
            'power': power,
            'killPoints': kill_points,
            't4Kills': t4,
            't5Kills': t5,
            'deads': deads,
            'alliance': alliance_raw,
            'kingdomNumber': PRIMARY_KINGDOM_NUMBER,
        },
        'validation': [],
        'preprocessingTrace': {
            'variants': ['scaled', 'clahe', 'adaptive', 'otsu', 'morph-open'],
            'lineCount': len(lines),
            **trace,
        },
        'candidates': {},
        'fusionDecision': {
            'strategy': 'local-hybrid-label-aware-v2',
            'lineCount': len(lines),
        },
    }

def _normalize_ranking_type(header_text: str) -> str:
    cleaned = re.sub(r'RANKINGS?', '', header_text.upper())
    cleaned = re.sub(r'[^A-Z0-9 ]', ' ', cleaned)
    cleaned = re.sub(r'\s+', ' ', cleaned).strip()
    return re.sub(r'[^a-z0-9]+', '_', cleaned.lower()).strip('_') or 'unknown'

def _detect_metric_key(header_text: str) -> str:
    text = header_text.upper()
    if 'POWER' in text:
        return 'power'
    if 'CONTRIBUTION' in text:
        return 'contribution_points'
    if 'FORTS DESTROYED' in text:
        return 'forts_destroyed'
    if 'KILL' in text:
        return 'kill_points'
    return 'metric'

def _extract_ranking(lines: List[Dict[str, Any]], width: int, height: int) -> Dict[str, Any]:
    header_lines = [line for line in lines if line['cy'] < height * 0.2]
    header_text = ' '.join(line['text'] for line in header_lines)
    ranking_type = _normalize_ranking_type(header_text)
    metric_key = _detect_metric_key(header_text)

    metric_anchors = [
        line for line in lines
        if line['cy'] > height * 0.2
        and line['cy'] < height * 0.95
        and line['cx'] > width * 0.6
        and len(_clean_digits(line['text'])) >= 2
    ]
    metric_anchors.sort(key=lambda item: item['cy'])

    rows: List[Dict[str, Any]] = []
    seen = set()

    for metric_line in metric_anchors:
        y = metric_line['cy']
        row_height = max(20, metric_line['h'] * 2.0)
        name_candidates = [
            line for line in lines
            if abs(line['cy'] - y) < row_height
            and line['cx'] > width * 0.24
            and line['cx'] < width * 0.68
            and re.search(r'[A-Za-z]', line['text'])
        ]
        subtitle_candidates = [
            line for line in lines
            if abs(line['cy'] - y) < row_height * 1.35
            and line['cy'] > y
            and line['cx'] > width * 0.24
            and line['cx'] < width * 0.68
            and re.search(r'[A-Za-z]', line['text'])
        ]
        rank_candidates = [
            line for line in lines
            if abs(line['cy'] - y) < row_height
            and line['cx'] < width * 0.28
            and re.fullmatch(r'[0-9]{1,4}', _clean_digits(line['text'], 4) or '')
        ]

        if not name_candidates:
            continue

        name_line = max(
            name_candidates,
            key=lambda item: (item['confidence'] - (abs(item['cy'] - y) / max(1.0, height)))
        )
        metric_raw = metric_line['text']
        metric_value = _clean_digits(metric_raw)

        if not metric_value:
            continue

        subtitle_line = None
        subtitle_raw = ''
        title_raw = None
        if subtitle_candidates:
            subtitle_line = min(subtitle_candidates, key=lambda item: abs(item['cy'] - y))
            subtitle_raw = _sanitize_printable(subtitle_line['text'], 80)
            if subtitle_raw and not _detect_tracked_alliance(subtitle_raw):
                lowered = subtitle_raw.lower()
                if lowered in {'leader', 'warlord', 'envoy', 'officer', 'council', 'r4', 'r5', 'king', 'queen'}:
                    title_raw = subtitle_raw

        split = _split_name_and_alliance(name_line['text'], subtitle_raw)
        governor_name_raw = _sanitize_printable(split['governorNameRaw'], 80)

        source_rank = None
        rank_line = None
        if rank_candidates:
            rank_line = min(rank_candidates, key=lambda item: abs(item['cy'] - y))
            rank_raw = _clean_digits(rank_line['text'], 4)
            if rank_raw:
                source_rank = int(rank_raw)

        name_normalized = re.sub(r'[^A-Za-z0-9]+', '', governor_name_raw).lower()
        dedupe_key = f'{round(y / 6)}::{name_normalized}::{metric_value}'
        if dedupe_key in seen:
            continue
        seen.add(dedupe_key)

        confidence = (
            float(name_line['confidence']) +
            float(metric_line['confidence']) +
            (float(subtitle_line['confidence']) * 0.2 if subtitle_line else 0.0)
        ) / (2.2 if subtitle_line else 2.0)

        rows.append({
            'sourceRank': source_rank,
            'governorNameRaw': governor_name_raw,
            'allianceRaw': split['allianceRaw'],
            'titleRaw': title_raw,
            'metricRaw': metric_raw,
            'metricValue': metric_value,
            'confidence': max(0.0, min(100.0, confidence * 100)),
            'ocrTrace': {
                'rankText': rank_line['text'] if rank_candidates else None,
                'nameText': name_line['text'],
                'subtitleText': subtitle_line['text'] if subtitle_line else None,
                'metricText': metric_raw,
                'allianceTag': split['allianceTag'],
                'trackedAlliance': split['trackedAlliance'],
                'kingdomNumber': PRIMARY_KINGDOM_NUMBER,
            },
            'candidates': None,
        })

    rows.sort(
        key=lambda row: (
            row.get('sourceRank') if row.get('sourceRank') is not None else 999999,
            -(int(str(row.get('metricValue') or '0'))),
            str(row.get('governorNameRaw') or '').lower(),
        )
    )

    avg_conf = sum(row['confidence'] for row in rows) / len(rows) if rows else 0.0

    return {
        'rankingType': ranking_type,
        'metricKey': metric_key,
        'headerText': header_text[:120],
        'rows': rows,
        'metadata': {
            'lineCount': len(lines),
            'detectedRows': len(rows),
            'averageConfidence': avg_conf,
            'kingdomNumber': PRIMARY_KINGDOM_NUMBER,
            'trackedAlliances': [item['tag'] for item in TRACKED_ALLIANCES],
        },
    }

def _handle_ingestion_message(msg: Dict[str, Any]) -> bool:
    payload = json.loads(msg.get('Body', '{}'))
    if payload.get('type') != 'ingestion_task' or not payload.get('taskId'):
        logging.info('ignoring non-ingestion message type=%s', payload.get('type'))
        return True

    task_id = str(payload.get('taskId'))
    message_id = str(msg.get('MessageId') or '')
    receive_count = int(msg.get('Attributes', {}).get('ApproximateReceiveCount', '1'))
    attempt = max(1, receive_count)

    try:
        start_payload = {
            'attempt': attempt,
            'workerId': WORKER_ID,
            'queueMessageId': message_id,
            'metadata': {'queueType': payload.get('type')},
        }
        start_response = _post_internal(f'/api/v2/internal/ingestion-tasks/{task_id}/start', start_payload)
        task = (start_response.get('data') or {}).get('task') or {}
        artifact = task.get('artifact') or {}
        artifact_url = artifact.get('url')
        hint = task.get('archetypeHint')

        if not artifact_url:
            raise RuntimeError('task artifact URL is missing')

        started = time.time()
        image = _download_image(artifact_url)
        variants = _preprocess_variants(image)
        lines, ocr_trace = _merge_lines(variants)
        archetype = _detect_archetype(lines, hint)
        height, width = image.shape[:2]
        ocr_duration_ms = int((time.time() - started) * 1000)

        if archetype == 'ranking_board':
            ranking = _extract_ranking(lines, width, height)
            if len(ranking.get('rows', [])) == 0:
                raise RuntimeError('ranking extraction produced no rows')
            complete_payload = {
                'attempt': attempt,
                'workerId': WORKER_ID,
                'ingestionDomain': 'RANKING_CAPTURE',
                'screenArchetype': archetype,
                'ranking': ranking,
                'metadata': {
                    'worker': 'local-hybrid-opencv',
                    'ocrDurationMs': ocr_duration_ms,
                    **ocr_trace,
                },
            }
        else:
            profile = _extract_profile(lines, width, height, ocr_trace)
            complete_payload = {
                'attempt': attempt,
                'workerId': WORKER_ID,
                'ingestionDomain': 'PROFILE_SNAPSHOT',
                'screenArchetype': archetype,
                'profile': profile,
                'metadata': {
                    'worker': 'local-hybrid-opencv',
                    'ocrDurationMs': ocr_duration_ms,
                    **ocr_trace,
                },
            }

        _post_internal(f'/api/v2/internal/ingestion-tasks/{task_id}/complete', complete_payload)
        logging.info('completed ingestion task id=%s archetype=%s attempt=%s', task_id, archetype, attempt)
        return True
    except Exception as exc:
        terminal = receive_count >= MAX_RECEIVE_COUNT
        error_text = f'{type(exc).__name__}: {str(exc)}'
        logging.error('failed ingestion task id=%s attempt=%s terminal=%s error=%s', task_id, attempt, terminal, error_text)
        logging.debug('traceback=%s', traceback.format_exc())
        try:
            _post_internal(
                f'/api/v2/internal/ingestion-tasks/{task_id}/fail',
                {
                    'attempt': attempt,
                    'terminal': terminal,
                    'workerId': WORKER_ID,
                    'error': error_text[:400],
                    'metadata': {'queueMessageId': message_id},
                },
            )
        except Exception as fail_exc:
            logging.error('failed to report task failure id=%s error=%s', task_id, fail_exc)

        return terminal

while True:
    try:
        resp = sqs.receive_message(
            QueueUrl=QUEUE_URL,
            MaxNumberOfMessages=5,
            WaitTimeSeconds=20,
            VisibilityTimeout=300,
            AttributeNames=['ApproximateReceiveCount'],
        )
        for msg in resp.get('Messages', []):
            should_delete = _handle_ingestion_message(msg)
            if should_delete:
                sqs.delete_message(QueueUrl=QUEUE_URL, ReceiptHandle=msg['ReceiptHandle'])
    except Exception as exc:
        logging.exception('worker loop error: %s', exc)
        time.sleep(5)
PY

cat > /etc/default/hama-ocr-worker <<ENV
AWS_REGION=${REGION}
QUEUE_URL=${QUEUE_URL}
INTERNAL_API_BASE_URL=${APP_URL}
APP_SIGNING_SECRET=${SERVICE_SECRET}
MAX_RECEIVE_COUNT=3
INTERNAL_REQUEST_TIMEOUT_SEC=30
IMAGE_DOWNLOAD_TIMEOUT_SEC=40
WORKER_ID=${INSTANCE_NAME}
OMP_NUM_THREADS=1
ENABLE_PADDLE_OCR=1
PADDLE_TIMEOUT_SEC=240
PADDLE_RUNNER_PATH=/opt/hama-ocr/paddle_runner.py
PADDLE_PYTHON=/opt/hama-ocr/.venv/bin/python3
TESSERACT_CMD=/usr/bin/tesseract
TESSERACT_TIMEOUT_SEC=15
ENV

cat > /etc/systemd/system/hama-ocr-worker.service <<'SERVICE'
[Unit]
Description=Hama RoK OCR queue worker
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
EnvironmentFile=/etc/default/hama-ocr-worker
ExecStart=/opt/hama-ocr/.venv/bin/python3 /opt/hama-ocr/queue_worker.py
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

SSM_STATUS="InProgress"
for _ in {1..120}; do
  SSM_STATUS="$(${AWS[@]} ssm get-command-invocation \
    --command-id "$SSM_CMD_ID" \
    --instance-id "$INSTANCE_ID" \
    --query 'Status' \
    --output text 2>/dev/null || true)"
  case "$SSM_STATUS" in
    Success|Failed|Cancelled|TimedOut|DeliveryTimedOut|Undeliverable|Terminated)
      break
      ;;
  esac
  sleep 10
done

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

    force = bool((event or {}).get("force", False))
    pending = _pending(queue_url)
    state = ec2.describe_instances(InstanceIds=[instance_id])["Reservations"][0]["Instances"][0]["State"]["Name"]

    should_start = force or pending >= threshold
    started = False
    if should_start and state in ("stopped", "stopping"):
        ec2.start_instances(InstanceIds=[instance_id])
        started = True

    return {
        "pending": pending,
        "instanceState": state,
        "started": started,
        "force": force,
        "threshold": threshold,
    }
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
    ${AWS[@]} lambda wait function-updated-v2 --function-name "$name"
    ${AWS[@]} lambda update-function-configuration \
      --function-name "$name" \
      --runtime python3.12 \
      --handler "$handler" \
      --timeout 30 \
      --memory-size 128 \
      --environment "Variables={QUEUE_URL=$QUEUE_URL,INSTANCE_ID=$INSTANCE_ID,START_THRESHOLD=1}" >/dev/null
    ${AWS[@]} lambda wait function-updated-v2 --function-name "$name"
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
    ${AWS[@]} lambda wait function-active-v2 --function-name "$name"
  fi
}

upsert_lambda "$LAMBDA_START_NAME" "$TMPDIR/start.zip" "start_handler.lambda_handler"
upsert_lambda "$LAMBDA_STOP_NAME" "$TMPDIR/stop.zip" "stop_handler.lambda_handler"

START_LAMBDA_ARN="$(${AWS[@]} lambda get-function --function-name "$LAMBDA_START_NAME" --query 'Configuration.FunctionArn' --output text)"
STOP_LAMBDA_ARN="$(${AWS[@]} lambda get-function --function-name "$LAMBDA_STOP_NAME" --query 'Configuration.FunctionArn' --output text)"

echo "[8/10] Ensuring EventBridge schedules..."
${AWS[@]} events put-rule --name "$START_RULE_NAME" --schedule-expression 'rate(2 minutes)' --state ENABLED >/dev/null
${AWS[@]} events put-rule --name "$STOP_RULE_NAME" --schedule-expression 'rate(5 minutes)' --state ENABLED >/dev/null
STOP_RULE_DISABLED=0

${AWS[@]} events put-targets --rule "$START_RULE_NAME" --targets "Id"="1","Arn"="$START_LAMBDA_ARN" >/dev/null
${AWS[@]} events put-targets --rule "$STOP_RULE_NAME" --targets "Id"="1","Arn"="$STOP_LAMBDA_ARN" >/dev/null

echo "[9/10] Ensuring Lambda invoke permissions for EventBridge..."
ACCOUNT_ID="$(${AWS[@]} sts get-caller-identity --query Account --output text)"
START_RULE_ARN="arn:aws:events:${REGION}:${ACCOUNT_ID}:rule/${START_RULE_NAME}"
STOP_RULE_ARN="arn:aws:events:${REGION}:${ACCOUNT_ID}:rule/${STOP_RULE_NAME}"

${AWS[@]} lambda add-permission --function-name "$LAMBDA_START_NAME" --statement-id "${START_RULE_NAME}-invoke" --action lambda:InvokeFunction --principal events.amazonaws.com --source-arn "$START_RULE_ARN" >/dev/null 2>&1 || true
${AWS[@]} lambda add-permission --function-name "$LAMBDA_STOP_NAME" --statement-id "${STOP_RULE_NAME}-invoke" --action lambda:InvokeFunction --principal events.amazonaws.com --source-arn "$STOP_RULE_ARN" >/dev/null 2>&1 || true

echo "[10/10] Testing start/stop lambdas..."
${AWS[@]} lambda invoke --function-name "$LAMBDA_START_NAME" --cli-binary-format raw-in-base64-out --payload '{"force": true}' /tmp/${LAMBDA_START_NAME}.json >/dev/null
${AWS[@]} lambda invoke --function-name "$LAMBDA_STOP_NAME" --cli-binary-format raw-in-base64-out --payload '{}' /tmp/${LAMBDA_STOP_NAME}.json >/dev/null

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
echo "Worker Callback:   $APP_URL"
echo ""
echo "Local test outputs:"
cat /tmp/${LAMBDA_START_NAME}.json || true
echo ""
