'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useWorkspaceSession } from '@/lib/workspace-session';
import { InlineError, SessionGate } from '@/components/app/session-gate';
import { PageHero } from '@/components/ui/primitives';
import {
  type AwsOcrControlStatus,
  type ScanJobResponse,
  type TaskRow,
  type UploadFinalizeManifestEntry,
  type UploadQueueEntry,
  type WeeklyEventInfo,
  mapTaskStatus,
} from './upload-model';
import {
  UploadDropZonePanel,
  UploadProcessingPanel,
  UploadQueueTable,
  UploadStatusStrip,
  UploadSubmitNotice,
  UploadWorkerPanel,
} from './upload-sections';
import { createAssistantHandoff } from '@/features/assistant/handoff';

const UPLOAD_CONCURRENCY = 4;
const MAX_RETRIES = 3;
const LARGE_BATCH_THRESHOLD = 60;
const LARGE_BATCH_INTERFILE_DELAY_MS = 140;
const REQUEST_TIMEOUT_MS = 45_000;
const FINALIZE_TIMEOUT_MS = 90_000;
const SCAN_JOB_POLL_TIMEOUT_MS = 20_000;
const RETRY_BASE_DELAY_MS = 350;
const RETRY_JITTER_MAX_MS = 300;
const STALL_CHECK_INTERVAL_MS = 10_000;
const STALL_TIMEOUT_MS = 120_000;
const IN_PROGRESS_STATUSES = new Set(['uploading', 'queued', 'processing']);

class UploadRequestError extends Error {
  retryable: boolean;
  status: number | null;

  constructor(message: string, options?: { retryable?: boolean; status?: number | null }) {
    super(message);
    this.name = 'UploadRequestError';
    this.retryable = Boolean(options?.retryable);
    this.status = options?.status ?? null;
  }
}

function delay(ms: number) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function parseJsonSafe(value: string): Record<string, unknown> | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function normalizeUploadErrorMessage(message: string, status: number | null): string {
  const normalized = String(message || '').trim();
  const normalizedLower = normalized.toLowerCase();
  if (!normalized) {
    if (status === 507) return 'Storage quota exceeded. Delete older screenshots and retry.';
    if (status === 429) return 'Upload rate-limited by server. Retrying automatically.';
    if (status === 408 || status === 504) return 'Upload request timed out. Row marked retryable.';
    if (status && status >= 500) return `Server upload error (${status}).`;
    return 'Upload request failed.';
  }
  if (status === 507 || normalizedLower.includes('quota') || normalizedLower.includes('storage exceeds')) {
    return 'Storage quota exceeded. Delete older screenshots and retry.';
  }
  if (
    status === 429 ||
    normalizedLower.includes('rate limit') ||
    normalizedLower.includes('too many request')
  ) {
    return 'Upload rate-limited by server. Row will retry automatically.';
  }
  if (
    status === 408 ||
    status === 504 ||
    normalizedLower.includes('timed out') ||
    normalizedLower.includes('timeout') ||
    normalizedLower.includes('abort')
  ) {
    return 'Upload request timed out. Row marked retryable.';
  }
  if (
    normalizedLower.includes('network') ||
    normalizedLower.includes('fetch failed') ||
    normalizedLower.includes('connection')
  ) {
    return 'Network upload error. Row marked retryable.';
  }
  if (status === 400 || normalizedLower.includes('validation')) {
    return normalized || 'Upload validation failed for this file.';
  }
  return normalized;
}

function toManifestEntry(entry: UploadQueueEntry): UploadFinalizeManifestEntry {
  return {
    rowId: entry.id,
    fileName: entry.fileName,
    status: entry.status,
    taskId: entry.taskId,
    artifactId: entry.artifactId,
    idempotencyKey: entry.idempotencyKey,
    error: entry.error,
  };
}

function isSupportedImageFile(file: File): boolean {
  const mime = String(file.type || '').toLowerCase().trim();
  if (
    mime === 'image/png' ||
    mime === 'image/jpeg' ||
    mime === 'image/jpg' ||
    mime === 'image/webp' ||
    mime === 'image/heic' ||
    mime === 'image/heif' ||
    mime === 'image/avif'
  ) {
    return true;
  }

  const name = String(file.name || '').toLowerCase();
  return (
    name.endsWith('.png') ||
    name.endsWith('.jpg') ||
    name.endsWith('.jpeg') ||
    name.endsWith('.webp') ||
    name.endsWith('.heic') ||
    name.endsWith('.heif') ||
    name.endsWith('.avif')
  );
}

function getFileRelativePath(file: File): string {
  const withRelativePath = file as File & { webkitRelativePath?: string };
  return String(withRelativePath.webkitRelativePath || '').trim();
}

function buildFileFingerprint(file: File): string {
  const name = String(file.name || '').trim().toLocaleLowerCase();
  const size = Number(file.size || 0);
  const lastModified = Number(file.lastModified || 0);
  const relativePath = getFileRelativePath(file).toLocaleLowerCase();
  return `${name}|${size}|${lastModified}|${relativePath}`;
}

function getEntryFingerprint(entry: UploadQueueEntry): string {
  if (entry.metadata && typeof entry.metadata === 'object' && !Array.isArray(entry.metadata)) {
    const raw = (entry.metadata as Record<string, unknown>).fingerprint;
    if (typeof raw === 'string') {
      return raw.trim().toLocaleLowerCase();
    }
  }
  return '';
}

function mergeQueueEntries(
  existing: UploadQueueEntry[],
  fetched: UploadQueueEntry[]
): UploadQueueEntry[] {
  const fetchedTaskIds = new Set(
    fetched
      .map((entry) => entry.taskId)
      .filter((taskId): taskId is string => typeof taskId === 'string' && taskId.length > 0)
  );
  const fetchedByIdempotency = new Set(
    fetched
      .map((entry) => entry.idempotencyKey)
      .filter((key): key is string => typeof key === 'string' && key.length > 0)
  );
  const fetchedByArtifactId = new Set(
    fetched
      .map((entry) => entry.artifactId)
      .filter((artifactId): artifactId is string => typeof artifactId === 'string' && artifactId.length > 0)
  );

  const localOnlyRows = existing.filter((entry) => {
    if (entry.taskId && fetchedTaskIds.has(entry.taskId)) {
      return false;
    }
    if (entry.idempotencyKey && fetchedByIdempotency.has(entry.idempotencyKey)) {
      return false;
    }
    if (entry.artifactId && fetchedByArtifactId.has(entry.artifactId)) {
      return false;
    }
    return !entry.taskId;
  });

  const inFlightMissingFromPoll = existing.filter((entry) => {
    if (!entry.taskId || fetchedTaskIds.has(entry.taskId)) return false;
    return IN_PROGRESS_STATUSES.has(entry.status);
  });

  const merged = [...localOnlyRows, ...inFlightMissingFromPoll, ...fetched];
  const deduped = new Map<string, UploadQueueEntry>();

  for (const entry of merged) {
    const identity =
      (entry.taskId && `task:${entry.taskId}`) ||
      (entry.idempotencyKey && `idem:${entry.idempotencyKey}`) ||
      (entry.artifactId && `artifact:${entry.artifactId}`) ||
      `row:${entry.id}`;
    const existingEntry = deduped.get(identity);
    if (!existingEntry) {
      deduped.set(identity, entry);
      continue;
    }
    const existingTime = Date.parse(existingEntry.updatedAt || '');
    const nextTime = Date.parse(entry.updatedAt || '');
    if (Number.isFinite(nextTime) && (!Number.isFinite(existingTime) || nextTime >= existingTime)) {
      deduped.set(identity, entry);
    }
  }

  return Array.from(deduped.values());
}

export default function UploadPage() {
  const router = useRouter();
  const {
    workspaceId,
    workspaceName,
    accessToken,
    ready: workspaceReady,
    loading: sessionLoading,
    error: sessionError,
    refreshSession,
  } = useWorkspaceSession();

  const [weeklyEvent, setWeeklyEvent] = useState<WeeklyEventInfo | null>(null);

  const [entries, setEntries] = useState<UploadQueueEntry[]>([]);
  const [scanJobId, setScanJobId] = useState<string | null>(null);
  const [scanJobState, setScanJobState] = useState<ScanJobResponse | null>(null);

  const [isUploading, setIsUploading] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  const [submitMessage, setSubmitMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const [awsOcrControl, setAwsOcrControl] = useState<AwsOcrControlStatus | null>(null);
  const [awsControlBusy, setAwsControlBusy] = useState<'START' | 'STOP' | null>(null);
  const [awsControlMessage, setAwsControlMessage] = useState<string | null>(null);

  const [retryingRowId, setRetryingRowId] = useState<string | null>(null);
  const [retryingBulk, setRetryingBulk] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const completionNotifiedRef = useRef<string | null>(null);
  const localFilesRef = useRef<Record<string, File>>({});
  const entriesRef = useRef<UploadQueueEntry[]>([]);
  const uploadRunInFlightRef = useRef(false);

  const fetchJsonWithTimeout = useCallback(
    async (
      input: RequestInfo | URL,
      init: RequestInit,
      options?: { timeoutMs?: number; timeoutMessage?: string }
    ): Promise<{ status: number; payload: Record<string, unknown> | null }> => {
      const timeoutMs = Math.max(1_000, Number(options?.timeoutMs || REQUEST_TIMEOUT_MS));
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), timeoutMs);

      let response: Response;
      try {
        response = await fetch(input, {
          ...init,
          signal: controller.signal,
        });
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
          throw new UploadRequestError(
            options?.timeoutMessage || 'Request timed out while processing upload.',
            { retryable: true, status: null }
          );
        }
        throw new UploadRequestError(
          error instanceof Error
            ? error.message
            : 'Network failure while processing upload request.',
          { retryable: true, status: null }
        );
      } finally {
        window.clearTimeout(timeout);
      }

      const bodyText = await response.text();
      return {
        status: response.status,
        payload: parseJsonSafe(bodyText),
      };
    },
    []
  );

  const getPersistedJobKey = useCallback((id: string) => `upload:activeScanJob:${id}`, []);
  const getPersistedManifestKey = useCallback(
    (id: string, jobId: string) => `upload:manifest:${id}:${jobId}`,
    []
  );

  useEffect(() => {
    entriesRef.current = entries;
  }, [entries]);

  const clearPersistedManifest = useCallback(
    (jobId: string | null) => {
      if (typeof window === 'undefined' || !workspaceId || !jobId) return;
      localStorage.removeItem(getPersistedManifestKey(workspaceId, jobId));
    },
    [workspaceId, getPersistedManifestKey]
  );

  useEffect(() => {
    if (typeof window === 'undefined' || !workspaceId || !accessToken) return;

    const persistedJobId = localStorage.getItem(getPersistedJobKey(workspaceId)) || '';
    if (!persistedJobId) {
      setScanJobId(null);
      setEntries([]);
      return;
    }

    setScanJobId((prev) => prev || persistedJobId);

    const manifestRaw = localStorage.getItem(getPersistedManifestKey(workspaceId, persistedJobId));
    if (!manifestRaw) return;

    try {
      const manifest = JSON.parse(manifestRaw) as UploadFinalizeManifestEntry[];
      if (!Array.isArray(manifest)) return;
      const hydrated: UploadQueueEntry[] = manifest.map((entry, index) => ({
        id: entry.rowId || `${persistedJobId}-${index}`,
        fileName: entry.fileName || `screenshot-${index + 1}`,
        status: entry.status,
        sizeBytes: 0,
        taskId: entry.taskId,
        artifactId: entry.artifactId,
        idempotencyKey: entry.idempotencyKey,
        error: entry.error,
        updatedAt: new Date().toISOString(),
        persisted: true,
      }));
      setEntries((prev) => (prev.length > 0 ? prev : hydrated));
    } catch {
      // Ignore malformed cached manifest.
    }
  }, [workspaceId, accessToken, getPersistedJobKey, getPersistedManifestKey]);

  useEffect(() => {
    if (typeof window === 'undefined' || !workspaceId || !scanJobId) return;
    const manifest = entries.map((entry) => toManifestEntry(entry));
    localStorage.setItem(getPersistedManifestKey(workspaceId, scanJobId), JSON.stringify(manifest));
  }, [entries, workspaceId, scanJobId, getPersistedManifestKey]);

  const loadWeeklyEvent = useCallback(async (): Promise<WeeklyEventInfo | null> => {
    if (!workspaceReady) {
      setWeeklyEvent(null);
      return null;
    }

    try {
      const res = await fetch(
        `/api/v2/events/weekly?workspaceId=${encodeURIComponent(workspaceId)}&autoCreate=true`,
        {
          headers: { 'x-access-token': accessToken },
        }
      );
      const payload = await res.json();
      if (!res.ok || !payload?.data?.id) {
        setWeeklyEvent(null);
        return null;
      }

      const nextEvent: WeeklyEventInfo = {
        id: payload.data.id,
        name: payload.data.name,
        weekKey: payload.data.weekKey || null,
        startsAt: payload.data.startsAt || null,
        endsAt: payload.data.endsAt || null,
        isClosed: Boolean(payload.data.isClosed),
      };
      setWeeklyEvent(nextEvent);
      return nextEvent;
    } catch {
      setWeeklyEvent(null);
      return null;
    }
  }, [workspaceId, accessToken, workspaceReady]);

  useEffect(() => {
    void loadWeeklyEvent();
  }, [loadWeeklyEvent]);

  const loadAwsOcrControl = useCallback(async () => {
    if (!workspaceReady) {
      setAwsOcrControl(null);
      return;
    }

    try {
      const params = new URLSearchParams({ workspaceId });
      const res = await fetch(`/api/v2/infra/aws-ocr?${params.toString()}`, {
        headers: { 'x-access-token': accessToken },
      });
      const payload = await res.json();
      if (!res.ok) {
        setAwsOcrControl(null);
        return;
      }

      setAwsOcrControl(payload?.data || null);
    } catch {
      setAwsOcrControl(null);
    }
  }, [workspaceId, accessToken, workspaceReady]);

  useEffect(() => {
    void loadAwsOcrControl();
  }, [loadAwsOcrControl]);

  useEffect(() => {
    if (!scanJobId || !workspaceId || !accessToken) return;

    let cancelled = false;
    completionNotifiedRef.current = null;

    const loadJobState = async () => {
      try {
        const [tasksResponse, jobResponse] = await Promise.all([
          fetchJsonWithTimeout(
            `/api/v2/scan-jobs/${scanJobId}/tasks?limit=400`,
            {
              headers: { 'x-access-token': accessToken },
            },
            {
              timeoutMs: SCAN_JOB_POLL_TIMEOUT_MS,
              timeoutMessage: 'Timed out loading scan tasks.',
            }
          ),
          fetchJsonWithTimeout(
            `/api/v2/scan-jobs/${scanJobId}`,
            {
              headers: { 'x-access-token': accessToken },
            },
            {
              timeoutMs: SCAN_JOB_POLL_TIMEOUT_MS,
              timeoutMessage: 'Timed out loading scan job state.',
            }
          ),
        ]);

        const tasksPayload = tasksResponse.payload;
        const jobPayload = jobResponse.payload;

        if (cancelled) return;

        if (
          tasksResponse.status < 200 ||
          tasksResponse.status >= 300 ||
          jobResponse.status < 200 ||
          jobResponse.status >= 300
        ) {
          if (
            tasksResponse.status === 404 ||
            tasksResponse.status === 403 ||
            jobResponse.status === 404 ||
            jobResponse.status === 403
          ) {
            setScanJobId(null);
            setScanJobState(null);
            setEntries([]);
            if (typeof window !== 'undefined') {
              localStorage.removeItem(getPersistedJobKey(workspaceId));
              clearPersistedManifest(scanJobId);
            }
          }
          return;
        }

        const rows = (Array.isArray(tasksPayload?.data) ? tasksPayload.data : []) as TaskRow[];
        const fromTasks: UploadQueueEntry[] = rows.map((task) => {
          const artifactMetadata =
            task.artifact?.metadata && typeof task.artifact.metadata === 'object' && !Array.isArray(task.artifact.metadata)
              ? (task.artifact.metadata as Record<string, unknown>)
              : {};
          const taskMetadata =
            task.metadata && typeof task.metadata === 'object' && !Array.isArray(task.metadata)
              ? (task.metadata as Record<string, unknown>)
              : {};
          const mergedMetadata = {
            ...artifactMetadata,
            ...taskMetadata,
          };

          const fileName =
            (typeof mergedMetadata.fileName === 'string' ? String(mergedMetadata.fileName) : null) ||
            `artifact-${task.artifactId.slice(0, 8)}`;

          return {
            id: task.id,
            fileName,
            status: mapTaskStatus(task.status, task.duplicate || null),
            sizeBytes:
              typeof mergedMetadata.bytes === 'number' && Number.isFinite(mergedMetadata.bytes)
                ? Number(mergedMetadata.bytes)
                : 0,
            taskId: task.id,
            idempotencyKey: task.idempotencyKey || undefined,
            artifactId: task.artifactId,
            artifactUrl: task.artifact?.url,
            updatedAt: task.updatedAt,
            error: task.lastError || undefined,
            archetypeHint: task.archetypeHint || undefined,
            metadata: mergedMetadata,
          };
        });

        setEntries((prev) => mergeQueueEntries(prev, fromTasks));

        const jobData = jobPayload?.data as
          | {
              id: string;
              status: string;
              totalFiles: number;
              processedFiles: number;
              eventId?: string | null;
            }
          | undefined;

        if (jobData) {
          setScanJobState({
            id: jobData.id,
            status: jobData.status,
            totalFiles: jobData.totalFiles,
            processedFiles: jobData.processedFiles,
            eventId: jobData.eventId || null,
          });
        }

        if (typeof window !== 'undefined') {
          localStorage.setItem(getPersistedJobKey(workspaceId), scanJobId);
        }

        const terminalStatus = jobData?.status === 'REVIEW' || jobData?.status === 'FAILED' || jobData?.status === 'COMPLETED';
        if (terminalStatus && completionNotifiedRef.current !== scanJobId) {
          completionNotifiedRef.current = scanJobId;
          if (jobData?.status === 'REVIEW' || jobData?.status === 'COMPLETED') {
            setSubmitMessage({
              type: 'success',
              text: `Processing finished. ${jobData?.processedFiles || 0} screenshot(s) are ready for review.`,
            });
          } else {
            setSubmitMessage({
              type: 'error',
              text: `Processing finished with failures (${jobData?.processedFiles || 0}/${jobData?.totalFiles || 0}). Review or retry failed rows.`,
            });
          }
        }
      } catch {
        // Keep last known state; UI still shows local row progress.
      }
    };

    void loadJobState();
    const interval = window.setInterval(() => {
      void loadJobState();
      void loadAwsOcrControl();
    }, 3000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [
    scanJobId,
    workspaceId,
    accessToken,
    loadAwsOcrControl,
    getPersistedJobKey,
    clearPersistedManifest,
    fetchJsonWithTimeout,
  ]);

  useEffect(() => {
    if (!scanJobId) return;

    const interval = window.setInterval(() => {
      const now = Date.now();
      let hasChanges = false;
      setEntries((prev) => {
        const next = prev.map((entry) => {
          if (!IN_PROGRESS_STATUSES.has(entry.status)) {
            return entry;
          }
          const hasTaskAssigned = Boolean(entry.taskId);
          if (hasTaskAssigned) {
            return entry;
          }
          const updatedAtTs = Date.parse(entry.updatedAt);
          if (!Number.isFinite(updatedAtTs)) return entry;
          if (now - updatedAtTs < STALL_TIMEOUT_MS) return entry;
          hasChanges = true;
          return {
            ...entry,
            status: 'failed' as const,
            error: 'Queue watchdog marked this row retryable after stall timeout.',
            updatedAt: new Date().toISOString(),
          };
        });
        return hasChanges ? next : prev;
      });
    }, STALL_CHECK_INTERVAL_MS);

    return () => {
      window.clearInterval(interval);
    };
  }, [scanJobId]);

  const triggerAwsOcrControl = useCallback(
    async (action: 'START' | 'STOP', source: 'manual' | 'auto' = 'manual', force = false) => {
      if (!workspaceReady) return;
      setAwsControlBusy(action);
      if (source === 'manual') setAwsControlMessage(null);

      try {
        const res = await fetch('/api/v2/infra/aws-ocr', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-access-token': accessToken,
          },
          body: JSON.stringify({ workspaceId, action, force }),
        });
        const payload = await res.json();
        if (!res.ok) {
          throw new Error(payload?.error?.message || `Failed to ${action.toLowerCase()} AWS OCR worker.`);
        }
        setAwsOcrControl(payload?.data?.status || null);

        if (source === 'manual') {
          setAwsControlMessage(
            action === 'START'
              ? force
                ? 'Force start requested. EC2 should start even if queue depth is zero.'
                : 'Start requested.'
              : 'Stop requested.'
          );
        }
      } catch (error) {
        if (source === 'manual') {
          setAwsControlMessage(error instanceof Error ? error.message : 'Failed to control AWS OCR worker.');
        }
      } finally {
        setAwsControlBusy(null);
      }
    },
    [workspaceId, accessToken, workspaceReady]
  );

  const createScanJob = useCallback(
    async (totalFiles: number, eventId?: string | null) => {
      const response = await fetchJsonWithTimeout(
        '/api/v2/scan-jobs',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-access-token': accessToken,
          },
          body: JSON.stringify({
            workspaceId,
            eventId: eventId || undefined,
            source: 'MANUAL_UPLOAD',
            totalFiles,
            notes: `Queue-first upload batch at ${new Date().toISOString()}`,
            idempotencyKey: `queue-first-${eventId || weeklyEvent?.weekKey || 'weekly'}-${Date.now()}`,
          }),
        },
        {
          timeoutMs: REQUEST_TIMEOUT_MS,
          timeoutMessage: 'Timed out while creating scan job.',
        }
      );

      const payload = response.payload;
      if (response.status < 200 || response.status >= 300) {
        const message = normalizeUploadErrorMessage(
          String(
            (payload?.error && typeof payload.error === 'object'
              ? (payload.error as Record<string, unknown>).message
              : payload?.message) || 'Failed to create scan job.'
          ),
          response.status
        );
        throw new UploadRequestError(message, {
          retryable: response.status === 429 || response.status >= 500,
          status: response.status,
        });
      }

      return payload?.data as ScanJobResponse;
    },
    [workspaceId, accessToken, weeklyEvent?.weekKey, fetchJsonWithTimeout]
  );

  const uploadScreenshotArtifact = useCallback(async (file: File): Promise<string> => {
    const formData = new FormData();
    formData.append('file', file);

    const response = await fetchJsonWithTimeout(
      '/api/screenshots/upload',
      {
        method: 'POST',
        body: formData,
      },
      {
        timeoutMs: REQUEST_TIMEOUT_MS,
        timeoutMessage: `Timed out while uploading ${file.name}.`,
      }
    );

    const payload = response.payload;
    if (response.status < 200 || response.status >= 300 || !payload?.url) {
      const message = normalizeUploadErrorMessage(
        String(
          (payload?.error && typeof payload.error === 'object'
            ? (payload.error as Record<string, unknown>).message
            : payload?.message) || `Failed to upload ${file.name}.`
        ),
        response.status
      );
      throw new UploadRequestError(
        message,
        {
          retryable:
            response.status === 429 ||
            response.status === 408 ||
            response.status === 504 ||
            response.status >= 500,
          status: response.status,
        }
      );
    }

    return String(payload.url);
  }, [fetchJsonWithTimeout]);

  const enqueueArtifactTask = useCallback(
    async (args: {
      scanJobId: string;
      eventId: string | null;
      rowId: string;
      artifactUrl: string;
      fileName: string;
      bytes: number;
      idempotencyKey: string;
    }) => {
      const response = await fetchJsonWithTimeout(
        `/api/v2/scan-jobs/${args.scanJobId}/artifacts`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-access-token': accessToken,
          },
          body: JSON.stringify({
            workspaceId,
            eventId: args.eventId,
            artifactUrl: args.artifactUrl,
            artifactType: 'SCREENSHOT',
            fileName: args.fileName,
            bytes: args.bytes,
            idempotencyKey: args.idempotencyKey,
          }),
        },
        {
          timeoutMs: REQUEST_TIMEOUT_MS,
          timeoutMessage: `Timed out while queueing ${args.fileName}.`,
        }
      );

      const payload = response.payload;
      if (response.status < 200 || response.status >= 300) {
        const message = normalizeUploadErrorMessage(
          String(
            (payload?.error && typeof payload.error === 'object'
              ? (payload.error as Record<string, unknown>).message
              : payload?.message) || `Failed to enqueue ${args.fileName}.`
          ),
          response.status
        );
        throw new UploadRequestError(
          message,
          {
            retryable:
              response.status === 429 ||
              response.status === 408 ||
              response.status === 504 ||
              response.status >= 500,
            status: response.status,
          }
        );
      }

      return payload?.data as {
        artifact: { id: string; url?: string };
        task: {
          id: string;
          status: 'QUEUED' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
          archetypeHint?: string | null;
        };
      };
    },
    [accessToken, workspaceId, fetchJsonWithTimeout]
  );

  const isRetryableUploadError = useCallback((error: unknown): boolean => {
    if (error instanceof UploadRequestError) {
      return error.retryable;
    }
    if (error instanceof TypeError) {
      return true;
    }
    if (error instanceof Error) {
      const message = error.message.toLowerCase();
      return (
        message.includes('network') ||
        message.includes('timeout') ||
        message.includes('fetch') ||
        message.includes('429') ||
        message.includes('503') ||
        message.includes('504') ||
        message.includes('502') ||
        message.includes('500')
      );
    }
    return false;
  }, []);

  const runWithRetries = useCallback(async <T,>(fn: (attempt: number) => Promise<T>) => {
    let lastError: unknown = null;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
      try {
        return await fn(attempt);
      } catch (error) {
        lastError = error;
        const retryable = isRetryableUploadError(error);
        if (!retryable) {
          break;
        }
        if (attempt >= MAX_RETRIES) break;
        const jitter = Math.floor(Math.random() * RETRY_JITTER_MAX_MS);
        await delay(RETRY_BASE_DELAY_MS * 2 ** (attempt - 1) + jitter);
      }
    }
    throw lastError instanceof Error ? lastError : new Error('Operation failed after retries.');
  }, [isRetryableUploadError]);

  const finalizeUploadBatch = useCallback(
    async (args: { scanJobId: string; expectedTotal: number; rowIds?: string[] }) => {
      if (!workspaceReady || !accessToken) return null;

      const manifestRows = (args.rowIds && args.rowIds.length > 0
        ? entriesRef.current.filter((entry) => args.rowIds?.includes(entry.id))
        : entriesRef.current
      )
        .filter((entry) => entry.status === 'failed' || Boolean(entry.taskId))
        .map((entry) => toManifestEntry(entry));

      const response = await fetchJsonWithTimeout(
        `/api/v2/scan-jobs/${args.scanJobId}/finalize-upload`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-access-token': accessToken,
          },
          body: JSON.stringify({
            workspaceId,
            expectedTotal: args.expectedTotal,
            manifest: manifestRows,
          }),
        },
        {
          timeoutMs: FINALIZE_TIMEOUT_MS,
          timeoutMessage: 'Timed out while finalizing upload batch.',
        }
      );

      const payload = response.payload;
      if (response.status < 200 || response.status >= 300) {
        const message = normalizeUploadErrorMessage(
          String(
            (payload?.error && typeof payload.error === 'object'
              ? (payload.error as Record<string, unknown>).message
              : payload?.message) || 'Failed to finalize upload batch.'
          ),
          response.status
        );
        throw new UploadRequestError(message, {
          retryable:
            response.status === 429 ||
            response.status === 408 ||
            response.status === 504 ||
            response.status >= 500,
          status: response.status,
        });
      }

      const data = payload?.data as
        | {
            finalized: boolean;
            missingCount: number;
            enqueuedCount: number;
            status: string;
            error: string | null;
          }
        | undefined;

      if (data) {
        setScanJobState((prev) =>
          prev
            ? {
                ...prev,
                status: data.status || prev.status,
                totalFiles: args.expectedTotal,
              }
            : prev
        );
      }

      return data || null;
    },
    [workspaceReady, accessToken, workspaceId, fetchJsonWithTimeout]
  );

  const processQueueEntry = useCallback(
    async (args: {
      scanJobId: string;
      eventId: string | null;
      rowId: string;
      fileName: string;
      bytes: number;
      idempotencyKey: string;
      file?: File;
      artifactUrl?: string;
      retryCount?: number;
    }) => {
      setEntries((prev) =>
        prev.map((entry) =>
          entry.id === args.rowId
            ? {
                ...entry,
                status: 'uploading',
                error: undefined,
                retryCount: (entry.retryCount || 0) + (args.retryCount || 0),
                updatedAt: new Date().toISOString(),
              }
            : entry
        )
      );

      try {
        const artifactUrl =
          args.artifactUrl ||
          (await runWithRetries(async () => {
            if (!args.file) {
              throw new Error(`File payload is no longer available for ${args.fileName}. Re-upload this screenshot.`);
            }
            return uploadScreenshotArtifact(args.file);
          }));

        const queued = await runWithRetries(async () =>
          enqueueArtifactTask({
            scanJobId: args.scanJobId,
            eventId: args.eventId,
            rowId: args.rowId,
            artifactUrl,
            fileName: args.fileName,
            bytes: args.bytes,
            idempotencyKey: args.idempotencyKey,
          })
        );

        setEntries((prev) =>
          prev.map((entry) =>
            entry.id === args.rowId
              ? {
                  ...entry,
                  status: mapTaskStatus(queued.task.status, null),
                  taskId: queued.task.id,
                  artifactId: queued.artifact.id,
                  artifactUrl,
                  archetypeHint: queued.task.archetypeHint || undefined,
                  updatedAt: new Date().toISOString(),
                  error: undefined,
                }
              : entry
          )
        );
      } catch (error) {
        setEntries((prev) =>
          prev.map((entry) =>
            entry.id === args.rowId
              ? {
                  ...entry,
                  status: 'failed',
                  artifactUrl: args.artifactUrl || entry.artifactUrl,
                  error: error instanceof Error ? error.message : 'Failed to enqueue file.',
                  updatedAt: new Date().toISOString(),
                }
              : entry
          )
        );
      }
    },
    [runWithRetries, uploadScreenshotArtifact, enqueueArtifactTask]
  );

  const runConcurrent = useCallback(async (jobs: Array<() => Promise<void>>, concurrency: number) => {
    let cursor = 0;
    const workers = Array.from({ length: Math.min(concurrency, jobs.length) }, async () => {
      while (cursor < jobs.length) {
        const index = cursor;
        cursor += 1;
        await jobs[index]();
      }
    });
    await Promise.all(workers);
  }, []);

  const handleFiles = useCallback(
    async (files: File[], options?: { fromFolder?: boolean }) => {
      const imageFiles = files.filter((f) => isSupportedImageFile(f));
      if (imageFiles.length === 0) return;

      if (uploadRunInFlightRef.current) {
        setSubmitMessage({
          type: 'error',
          text: 'An upload batch is already running. Wait for it to finish before starting another batch.',
        });
        return;
      }

      if (!workspaceReady) {
        if (!sessionLoading) {
          void refreshSession();
        }
        setSubmitMessage({ type: 'error', text: 'Connecting workspace. Try upload again in a moment.' });
        return;
      }

      const dedupedSelection: Array<{ file: File; fingerprint: string; relativePath: string }> = [];
      const selectionSeen = new Set<string>();
      for (const file of imageFiles) {
        const fingerprint = buildFileFingerprint(file);
        if (!fingerprint) continue;
        if (selectionSeen.has(fingerprint)) continue;
        selectionSeen.add(fingerprint);
        dedupedSelection.push({
          file,
          fingerprint,
          relativePath: getFileRelativePath(file),
        });
      }

      const existingFingerprints = new Set(
        entriesRef.current
          .map((entry) => getEntryFingerprint(entry))
          .filter((fingerprint) => Boolean(fingerprint))
      );
      const uploadItems = dedupedSelection.filter((item) => !existingFingerprints.has(item.fingerprint));
      const skippedInSelection = Math.max(0, imageFiles.length - dedupedSelection.length);
      const skippedAsExisting = Math.max(0, dedupedSelection.length - uploadItems.length);

      if (uploadItems.length === 0) {
        setSubmitMessage({
          type: 'error',
          text:
            skippedInSelection > 0 || skippedAsExisting > 0
              ? 'No new screenshots to upload. Selected files were duplicates of existing queue items.'
              : 'No valid screenshots were selected.',
        });
        return;
      }

      uploadRunInFlightRef.current = true;
      setIsUploading(true);
      setSubmitMessage(null);

      try {
        let activeWeekly = weeklyEvent;
        if (!activeWeekly?.id) {
          activeWeekly = await loadWeeklyEvent();
        }

        const job = await createScanJob(uploadItems.length, activeWeekly?.id || null);
        setScanJobId(job.id);
        setScanJobState(job);
        if (typeof window !== 'undefined') {
          localStorage.setItem(getPersistedJobKey(workspaceId), job.id);
        }

        const baseTime = Date.now();
        const newRows: UploadQueueEntry[] = uploadItems.map((item, index) => {
          const file = item.file;
          const rowId = `${baseTime}-${index}`;
          const idempotencyKey = `task-${job.id}-${rowId}`;
          localFilesRef.current[rowId] = file;
          return {
            id: rowId,
            fileName: file.name,
            status: 'uploading',
            sizeBytes: file.size,
            idempotencyKey,
            updatedAt: new Date().toISOString(),
            metadata: {
              fingerprint: item.fingerprint,
              relativePath: item.relativePath || null,
            },
          };
        });

        setEntries(newRows);

        const largeBatchMode = Boolean(options?.fromFolder) || uploadItems.length >= LARGE_BATCH_THRESHOLD;
        const uploadConcurrency = largeBatchMode ? 1 : UPLOAD_CONCURRENCY;
        const interFileDelayMs = largeBatchMode ? LARGE_BATCH_INTERFILE_DELAY_MS : 0;

        const jobs = newRows.map((row, index) => async () => {
          const file = uploadItems[index]?.file;
          if (!file) return;
          await processQueueEntry({
            scanJobId: job.id,
            eventId: job.eventId || activeWeekly?.id || null,
            rowId: row.id,
            fileName: file.name,
            bytes: file.size,
            idempotencyKey: row.idempotencyKey || `task-${job.id}-${row.id}`,
            file,
          });
          if (interFileDelayMs > 0) {
            await delay(interFileDelayMs);
          }
        });

        await runConcurrent(jobs, uploadConcurrency);
        await delay(50);

        const finalizeResult = await finalizeUploadBatch({
          scanJobId: job.id,
          expectedTotal: uploadItems.length,
          rowIds: newRows.map((row) => row.id),
        });

        if (awsOcrControl?.enabled && awsOcrControl.startLambdaConfigured) {
          await triggerAwsOcrControl('START', 'auto', false);
        }

        if (finalizeResult?.finalized === false) {
          setSubmitMessage({
            type: 'error',
            text: `Upload finalized with mismatch: expected ${uploadItems.length}, enqueued ${finalizeResult.enqueuedCount}. Missing ${finalizeResult.missingCount}.`,
          });
        } else {
          const skippedSuffix =
            skippedInSelection > 0 || skippedAsExisting > 0
              ? ` Skipped duplicates: ${skippedInSelection + skippedAsExisting}.`
              : '';
          setSubmitMessage({
            type: 'success',
            text: `Queued ${uploadItems.length} screenshot(s). Mistral extraction now runs in the EC2 worker queue.${skippedSuffix}`,
          });
        }
      } catch (error) {
        setSubmitMessage({
          type: 'error',
          text: error instanceof Error ? error.message : 'Failed to start upload queue.',
        });
      } finally {
        uploadRunInFlightRef.current = false;
        setIsUploading(false);
      }
    },
    [
      workspaceId,
      workspaceReady,
      sessionLoading,
      refreshSession,
      weeklyEvent,
      loadWeeklyEvent,
      createScanJob,
      processQueueEntry,
      runConcurrent,
      finalizeUploadBatch,
      awsOcrControl?.enabled,
      awsOcrControl?.startLambdaConfigured,
      triggerAwsOcrControl,
      getPersistedJobKey,
    ]
  );

  const retryEntry = useCallback(
    async (rowId: string, fromBulk = false) => {
      if (!scanJobId || !scanJobState) {
        throw new Error('No active scan job to retry against.');
      }

      const entry = entriesRef.current.find((item) => item.id === rowId);
      if (!entry) {
        throw new Error('Upload row not found for retry.');
      }

      const idempotencyKey = entry.idempotencyKey || `retry-${scanJobId}-${rowId}-${Date.now()}`;
      const file = localFilesRef.current[rowId];

      if (!fromBulk) {
        setRetryingRowId(rowId);
      }

      try {
        await processQueueEntry({
          scanJobId,
          eventId: scanJobState.eventId || null,
          rowId,
          fileName: entry.fileName,
          bytes: entry.sizeBytes,
          artifactUrl: entry.artifactUrl,
          idempotencyKey,
          file,
          retryCount: 1,
        });

        await delay(25);
        await finalizeUploadBatch({
          scanJobId,
          expectedTotal: scanJobState.totalFiles,
        });
      } finally {
        if (!fromBulk) {
          setRetryingRowId(null);
        }
      }
    },
    [scanJobId, scanJobState, processQueueEntry, finalizeUploadBatch]
  );

  const retryFailedEntries = useCallback(async () => {
    const failedRows = entriesRef.current.filter((entry) => entry.status === 'failed');
    if (failedRows.length === 0) return;

    setRetryingBulk(true);
    setSubmitMessage(null);

    let failed = 0;
    for (const entry of failedRows) {
      try {
        await retryEntry(entry.id, true);
      } catch {
        failed += 1;
      }
    }

    setRetryingBulk(false);
    if (failed > 0) {
      setSubmitMessage({
        type: 'error',
        text: `Retry finished with ${failed} failed row(s).`,
      });
    }
  }, [retryEntry]);

  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const onDragLeave = () => setIsDragging(false);

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const files = Array.from(e.dataTransfer.files);
    void handleFiles(files);
  };

  const clearRows = () => {
    setEntries([]);
    setSubmitMessage(null);
    setScanJobId(null);
    setScanJobState(null);
    uploadRunInFlightRef.current = false;
    localFilesRef.current = {};
    if (typeof window !== 'undefined' && workspaceId) {
      localStorage.removeItem(getPersistedJobKey(workspaceId));
      clearPersistedManifest(scanJobId);
    }
  };

  const queuedCount = entries.filter((entry) => entry.status === 'queued').length;
  const processingCount = entries.filter((entry) => entry.status === 'processing' || entry.status === 'uploading').length;
  const completedCount = entries.filter((entry) => entry.status === 'completed').length;
  const duplicateCount = entries.filter((entry) => entry.status === 'duplicate').length;
  const failedCount = entries.filter((entry) => entry.status === 'failed').length;

  const workerState = (awsOcrControl?.instanceState || '').toLowerCase();
  const workerRunning = workerState === 'running' || workerState === 'pending';
  const workerLabel = !awsOcrControl?.enabled ? 'Disabled' : workerRunning ? 'Online' : 'Standby';
  const workerTone = !awsOcrControl?.enabled ? 'neutral' : workerRunning ? 'good' : 'warn';

  const completedProfileRows = useMemo(
    () =>
      entries.filter(
        (entry) =>
          (entry.status === 'completed' || entry.status === 'duplicate') &&
          entry.metadata &&
          String((entry.metadata as Record<string, unknown>).ingestionDomain || '') === 'PROFILE_SNAPSHOT'
      ).length,
    [entries]
  );
  const completedRankingRows = useMemo(
    () =>
      entries.filter(
        (entry) =>
          (entry.status === 'completed' || entry.status === 'duplicate') &&
          entry.metadata &&
          String((entry.metadata as Record<string, unknown>).ingestionDomain || '') === 'RANKING_CAPTURE'
      ).length,
    [entries]
  );

  const openAssistantFromUpload = useCallback(() => {
    if (!workspaceId) return;
    if (!scanJobId) {
      setSubmitMessage({
        type: 'error',
        text: 'Scan job is still initializing. Try AI batch again in a few seconds.',
      });
      return;
    }
    const contextArtifacts = entries
      .filter((entry) => {
        if (!(entry.status === 'completed' || entry.status === 'duplicate')) return false;
        if (!entry.artifactId) return false;
        return true;
      })
      .slice(0, 6)
      .map((entry) => ({
        artifactId: entry.artifactId || null,
        url: entry.artifactUrl || undefined,
        fileName: entry.fileName,
        mimeType: 'image/png',
      }));

    const token = createAssistantHandoff({
      source: 'upload',
      workspaceId,
      title: 'Upload Completion Handoff',
      summary: `Scan job ${scanJobId || ''} finished. Profile rows: ${completedProfileRows}, ranking rows: ${completedRankingRows}.`,
      suggestedPrompt:
        'Start batch mode for this scan job and process screenshots one-by-one. Auto-confirm only safe player/stats actions. Keep non-safe or ambiguous items flagged for manual review.',
      artifacts: contextArtifacts,
      meta: {
        scanJobId,
        status: scanJobState?.status || null,
        batchMode: 'manual_one_by_one',
        autoConfirmSafeOnly: true,
      },
    });

    router.push(`/assistant?handoff=${encodeURIComponent(token)}`);
  }, [
    workspaceId,
    entries,
    scanJobId,
    completedProfileRows,
    completedRankingRows,
    scanJobState?.status,
    router,
  ]);

  return (
    <div className="space-y-4 sm:space-y-5 lg:space-y-6">
      <PageHero
        title="Upload"
        subtitle="Upload weekly screenshots. Mistral extraction runs in the background and fills the review queues."
      />

      <SessionGate ready={workspaceReady} loading={sessionLoading} error={sessionError} onRetry={() => void refreshSession()}>
        {submitMessage?.type === 'error' ? <InlineError message={submitMessage.text} /> : null}

        <UploadStatusStrip
          queuedCount={queuedCount}
          processingCount={processingCount}
          completedCount={completedCount}
          duplicateCount={duplicateCount}
          failedCount={failedCount}
        />

        <UploadWorkerPanel
          workspaceReady={workspaceReady}
          workspaceName={workspaceName}
          sessionLoading={sessionLoading}
          sessionError={sessionError}
          weeklyEvent={weeklyEvent}
          workerLabel={workerLabel}
          workerTone={workerTone}
          awsOcrControl={awsOcrControl}
          awsControlBusy={awsControlBusy}
          awsControlMessage={awsControlMessage}
          onStartWorker={() => triggerAwsOcrControl('START', 'manual', true)}
          onStopWorker={() => triggerAwsOcrControl('STOP', 'manual', false)}
        />

        <UploadDropZonePanel
          isDragging={isDragging}
          isUploading={isUploading}
          scanJobId={scanJobId}
          scanJobState={scanJobState}
          entryCount={entries.length}
          fileInputRef={fileInputRef}
          folderInputRef={folderInputRef}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
          onFileChange={(event) => {
            const files = Array.from(event.target.files || []);
            void handleFiles(files, { fromFolder: false });
            event.target.value = '';
          }}
          onFolderChange={(event) => {
            const files = Array.from(event.target.files || []);
            void handleFiles(files, { fromFolder: true });
            event.target.value = '';
          }}
        />

        <UploadProcessingPanel
          scanJobState={scanJobState}
          entries={entries}
          completedProfileRows={completedProfileRows}
          completedRankingRows={completedRankingRows}
          onRunBatch={openAssistantFromUpload}
          onOpenReview={() => router.push('/review')}
          onOpenRankingReview={() => router.push('/rankings/review')}
        />

        <UploadQueueTable
          entries={entries}
          onClear={clearRows}
          onRetryRow={(rowId) => {
            void retryEntry(rowId);
          }}
          onRetryFailed={() => {
            void retryFailedEntries();
          }}
          retryingRowId={retryingRowId}
          retryingBulk={retryingBulk}
        />

        <UploadSubmitNotice submitMessage={submitMessage?.type === 'success' ? submitMessage : null} />
      </SessionGate>
    </div>
  );
}
