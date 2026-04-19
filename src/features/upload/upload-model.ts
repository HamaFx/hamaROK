export type QueueRowStatus =
  | 'uploading'
  | 'queued'
  | 'processing'
  | 'completed'
  | 'duplicate'
  | 'failed';

export interface UploadQueueEntry {
  id: string;
  fileName: string;
  status: QueueRowStatus;
  sizeBytes: number;
  idempotencyKey?: string;
  taskId?: string;
  artifactId?: string;
  artifactUrl?: string;
  retryCount?: number;
  persisted?: boolean;
  updatedAt: string;
  error?: string;
  archetypeHint?: string;
  metadata?: Record<string, unknown>;
}

export interface TaskRow {
  id: string;
  status: 'QUEUED' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
  artifactId: string;
  archetypeHint: string | null;
  attemptCount: number;
  lastError: string | null;
  updatedAt: string;
  metadata?: Record<string, unknown>;
  duplicate?: {
    warning?: boolean;
    level?: string | null;
    referenceRunId?: string | null;
    similarity?: number | null;
    overrideToken?: string | null;
  } | null;
  artifact?: {
    id: string;
    type: string;
    url: string;
    metadata?: Record<string, unknown> | null;
  } | null;
}

export interface UploadFinalizeManifestEntry {
  rowId: string;
  fileName: string;
  status: QueueRowStatus;
  taskId?: string;
  artifactId?: string;
  idempotencyKey?: string;
  error?: string;
}

export interface AwsOcrControlStatus {
  enabled: boolean;
  queueConfigured: boolean;
  startLambdaConfigured: boolean;
  stopLambdaConfigured: boolean;
  queueStats: {
    pending: number;
    inFlight: number;
    delayed: number;
  } | null;
  instanceId: string | null;
  instanceState: string | null;
  uploadMode?: 'queue_first' | 'client_legacy';
  ocrPolicy?: {
    requested: 'mistral' | 'legacy';
    effective: 'mistral' | 'legacy';
    reason: 'workspace_override' | 'env_default' | 'legacy_blocked';
    legacyAllowed: boolean;
    locked: boolean;
  };
}

export interface ScanJobResponse {
  id: string;
  status: string;
  totalFiles: number;
  processedFiles: number;
  eventId?: string | null;
}

export interface WeeklyEventInfo {
  id: string;
  name: string;
  weekKey: string | null;
  startsAt: string | null;
  endsAt: string | null;
  isClosed: boolean;
}

export function mapTaskStatus(status: TaskRow['status'], duplicate: TaskRow['duplicate']): QueueRowStatus {
  if (status === 'PROCESSING') return 'processing';
  if (status === 'COMPLETED' && duplicate?.warning) return 'duplicate';
  if (status === 'COMPLETED') return 'completed';
  if (status === 'FAILED') return 'failed';
  return 'queued';
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function statusToneForRow(status: QueueRowStatus): 'good' | 'warn' | 'bad' | 'neutral' {
  if (status === 'completed') return 'good';
  if (status === 'duplicate') return 'warn';
  if (status === 'processing' || status === 'queued' || status === 'uploading') return 'warn';
  if (status === 'failed') return 'bad';
  return 'neutral';
}
