import { DescribeInstancesCommand, EC2Client } from '@aws-sdk/client-ec2';
import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda';
import { GetQueueAttributesCommand, SQSClient } from '@aws-sdk/client-sqs';
import { getEnv, isAwsOcrControlEnabled } from '@/lib/env';

export type AwsOcrControlAction = 'START' | 'STOP';

export interface AwsOcrControlStatus {
  enabled: boolean;
  queueConfigured: boolean;
  startLambdaConfigured: boolean;
  stopLambdaConfigured: boolean;
  instanceId: string | null;
  instanceState: string | null;
  queueStats: {
    pending: number;
    inFlight: number;
    delayed: number;
  } | null;
}

export function buildAwsOcrControlPayload(args: {
  action: AwsOcrControlAction;
  source?: string;
  force?: boolean;
}) {
  return {
    trigger: 'manual',
    source: args.source || 'ui',
    action: args.action,
    force: Boolean(args.force),
    requestedAt: new Date().toISOString(),
  };
}

let sqsClient: SQSClient | null = null;
let lambdaClient: LambdaClient | null = null;
let ec2Client: EC2Client | null = null;

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

function getEc2Client() {
  if (ec2Client) return ec2Client;
  ec2Client = new EC2Client({ region: getAwsRegion() });
  return ec2Client;
}

function decodePayload(payload?: Uint8Array): unknown {
  if (!payload) return null;
  const decoded = new TextDecoder().decode(payload).trim();
  if (!decoded) return null;
  try {
    return JSON.parse(decoded);
  } catch {
    return decoded;
  }
}

export async function getAwsOcrControlStatus(): Promise<AwsOcrControlStatus> {
  const env = getEnv();
  const enabled = isAwsOcrControlEnabled();
  const queueUrl = env.AWS_OCR_QUEUE_URL;
  const status: AwsOcrControlStatus = {
    enabled,
    queueConfigured: Boolean(queueUrl),
    startLambdaConfigured: Boolean(env.AWS_OCR_START_LAMBDA),
    stopLambdaConfigured: Boolean(env.AWS_OCR_STOP_LAMBDA),
    instanceId: env.AWS_OCR_INSTANCE_ID || null,
    instanceState: null,
    queueStats: null,
  };

  if (!enabled || !queueUrl) {
    return status;
  }

  try {
    const response = await getSqsClient().send(
      new GetQueueAttributesCommand({
        QueueUrl: queueUrl,
        AttributeNames: [
          'ApproximateNumberOfMessages',
          'ApproximateNumberOfMessagesNotVisible',
          'ApproximateNumberOfMessagesDelayed',
        ],
      })
    );

    const attrs = response.Attributes || {};
    status.queueStats = {
      pending: Number(attrs.ApproximateNumberOfMessages || 0),
      inFlight: Number(attrs.ApproximateNumberOfMessagesNotVisible || 0),
      delayed: Number(attrs.ApproximateNumberOfMessagesDelayed || 0),
    };
  } catch {
    status.queueStats = null;
  }

  if (env.AWS_OCR_INSTANCE_ID) {
    try {
      const response = await getEc2Client().send(
        new DescribeInstancesCommand({
          InstanceIds: [env.AWS_OCR_INSTANCE_ID],
        })
      );
      const instanceState =
        response.Reservations?.[0]?.Instances?.[0]?.State?.Name || null;
      status.instanceState = instanceState;
    } catch {
      status.instanceState = null;
    }
  }

  return status;
}

export async function invokeAwsOcrControlAction(
  action: AwsOcrControlAction,
  options?: { force?: boolean; source?: 'manual' | 'auto' }
) {
  const env = getEnv();

  if (!isAwsOcrControlEnabled()) {
    throw new Error('AWS OCR control is disabled. Set AWS_OCR_CONTROL_ENABLED=true.');
  }

  const functionName = action === 'START' ? env.AWS_OCR_START_LAMBDA : env.AWS_OCR_STOP_LAMBDA;
  if (!functionName) {
    throw new Error(
      action === 'START'
        ? 'AWS_OCR_START_LAMBDA is not configured.'
        : 'AWS_OCR_STOP_LAMBDA is not configured.'
    );
  }

  const response = await getLambdaClient().send(
    new InvokeCommand({
      FunctionName: functionName,
      InvocationType: 'RequestResponse',
      Payload: new TextEncoder().encode(
        JSON.stringify(
          buildAwsOcrControlPayload({
            action,
            source: options?.source || 'ui',
            force: options?.force,
          })
        )
      ),
    })
  );

  const payload = decodePayload(response.Payload);

  if (response.FunctionError) {
    throw new Error(
      typeof payload === 'string'
        ? payload
        : `Lambda ${functionName} returned FunctionError=${response.FunctionError}.`
    );
  }

  return {
    action,
    functionName,
    statusCode: response.StatusCode ?? null,
    payload,
  };
}
