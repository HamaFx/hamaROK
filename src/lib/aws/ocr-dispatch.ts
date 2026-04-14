import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda';
import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
import { getEnv, isAwsOcrControlEnabled } from '@/lib/env';

type OcrDispatchType =
  | 'scan_job_created'
  | 'ocr_extraction_created'
  | 'ranking_run_created'
  | 'ingestion_task';

export interface OcrDispatchMessage {
  type: OcrDispatchType;
  workspaceId: string;
  eventId?: string | null;
  scanJobId?: string;
  taskId?: string;
  extractionId?: string;
  rankingRunId?: string;
  source?: string;
  payload?: Record<string, unknown>;
}

let sqsClient: SQSClient | null = null;
let lambdaClient: LambdaClient | null = null;

function getAwsRegion() {
  const env = getEnv();
  return env.AWS_REGION || 'us-east-1';
}

function getSqsClient() {
  if (sqsClient) return sqsClient;
  sqsClient = new SQSClient({ region: getAwsRegion() });
  return sqsClient;
}

function getLambdaClient() {
  if (lambdaClient) return lambdaClient;
  lambdaClient = new LambdaClient({ region: getAwsRegion() });
  return lambdaClient;
}

function getQueueUrl() {
  const env = getEnv();
  if (!env.AWS_OCR_QUEUE_URL) return null;
  return env.AWS_OCR_QUEUE_URL;
}

function getStartLambdaName() {
  const env = getEnv();
  return env.AWS_OCR_START_LAMBDA || null;
}

export async function dispatchOcrWork(message: OcrDispatchMessage): Promise<void> {
  if (!isAwsOcrControlEnabled()) return;

  const queueUrl = getQueueUrl();
  if (!queueUrl) return;

  const body = JSON.stringify({
    ...message,
    createdAt: new Date().toISOString(),
  });

  try {
    await getSqsClient().send(
      new SendMessageCommand({
        QueueUrl: queueUrl,
        MessageBody: body,
      })
    );
  } catch (error) {
    console.error('[aws-ocr-dispatch] Failed to send SQS message', {
      queueUrl,
      type: message.type,
      error,
    });
    return;
  }

  const startLambda = getStartLambdaName();
  if (!startLambda) return;

  try {
    await getLambdaClient().send(
      new InvokeCommand({
        FunctionName: startLambda,
        InvocationType: 'Event',
        Payload: new TextEncoder().encode(
          JSON.stringify({
            trigger: 'dispatch',
            source: 'queue_dispatch',
            action: 'START',
            force: false,
            type: message.type,
            requestedAt: new Date().toISOString(),
          })
        ),
      })
    );
  } catch (error) {
    // Enqueue success is enough to continue; start is retried by EventBridge schedule.
    console.warn('[aws-ocr-dispatch] Failed to invoke start lambda', {
      startLambda,
      type: message.type,
      error,
    });
  }
}
