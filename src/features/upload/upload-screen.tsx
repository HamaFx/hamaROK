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
        const [tasksRes, jobRes] = await Promise.all([
          fetch(`/api/v2/scan-jobs/${scanJobId}/tasks?limit=400`, {
            headers: { 'x-access-token': accessToken },
          }),
          fetch(`/api/v2/scan-jobs/${scanJobId}`, {
            headers: { 'x-access-token': accessToken },
          }),
        ]);

        const [tasksPayload, jobPayload] = await Promise.all([tasksRes.json(), jobRes.json()]);

        if (cancelled) return;

        if (!tasksRes.ok || !jobRes.ok) {
          if (tasksRes.status === 404 || tasksRes.status === 403 || jobRes.status === 404 || jobRes.status === 403) {
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
            artifactId: task.artifactId,
            artifactUrl: task.artifact?.url,
            updatedAt: task.updatedAt,
            error: task.lastError || undefined,
            archetypeHint: task.archetypeHint || undefined,
            metadata: mergedMetadata,
          };
        });

        setEntries((prev) => {
          const localOnlyRows = prev.filter((entry) => !entry.taskId);
          const fetchedTaskIds = new Set(
            fromTasks
              .map((entry) => entry.taskId)
              .filter((taskId): taskId is string => typeof taskId === 'string' && taskId.length > 0)
          );
          const inFlightMissingFromPoll = prev.filter(
            (entry) =>
              Boolean(entry.taskId) &&
              !fetchedTaskIds.has(entry.taskId as string) &&
              (entry.status === 'uploading' || entry.status === 'queued' || entry.status === 'processing')
          );
          return [...localOnlyRows, ...inFlightMissingFromPoll, ...fromTasks];
        });

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
  ]);

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
      const res = await fetch('/api/v2/scan-jobs', {
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
      });

      const payload = await res.json();
      if (!res.ok) {
        throw new Error(payload?.error?.message || 'Failed to create scan job.');
      }

      return payload?.data as ScanJobResponse;
    },
    [workspaceId, accessToken, weeklyEvent?.weekKey]
  );

  const uploadScreenshotArtifact = useCallback(async (file: File): Promise<string> => {
    const formData = new FormData();
    formData.append('file', file);

    const res = await fetch('/api/screenshots/upload', {
      method: 'POST',
      body: formData,
    });

    const payload = await res.json();
    if (!res.ok || !payload?.url) {
      throw new UploadRequestError(
        payload?.error?.message || `Failed to upload ${file.name}.`,
        {
          retryable: res.status === 429 || res.status >= 500,
          status: res.status,
        }
      );
    }

    return payload.url as string;
  }, []);

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
      const res = await fetch(`/api/v2/scan-jobs/${args.scanJobId}/artifacts`, {
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
      });

      const payload = await res.json();
      if (!res.ok) {
        throw new UploadRequestError(
          payload?.error?.message || `Failed to enqueue ${args.fileName}.`,
          {
            retryable: res.status === 429 || res.status >= 500,
            status: res.status,
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
    [accessToken, workspaceId]
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
        await delay(250 * 2 ** (attempt - 1));
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
      ).map((entry) => toManifestEntry(entry));

      const res = await fetch(`/api/v2/scan-jobs/${args.scanJobId}/finalize-upload`, {
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
      });

      const payload = await res.json();
      if (!res.ok) {
        throw new Error(payload?.error?.message || 'Failed to finalize upload batch.');
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
    [workspaceReady, accessToken, workspaceId]
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
      const imageFiles = files.filter((f) => f.type.startsWith('image/'));
      if (imageFiles.length === 0) return;

      if (!workspaceReady) {
        if (!sessionLoading) {
          void refreshSession();
        }
        setSubmitMessage({ type: 'error', text: 'Connecting workspace. Try upload again in a moment.' });
        return;
      }

      setIsUploading(true);
      setSubmitMessage(null);

      try {
        let activeWeekly = weeklyEvent;
        if (!activeWeekly?.id) {
          activeWeekly = await loadWeeklyEvent();
        }

        const job = await createScanJob(imageFiles.length, activeWeekly?.id || null);
        setScanJobId(job.id);
        setScanJobState(job);
        if (typeof window !== 'undefined') {
          localStorage.setItem(getPersistedJobKey(workspaceId), job.id);
        }

        const baseTime = Date.now();
        const newRows: UploadQueueEntry[] = imageFiles.map((file, index) => {
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
          };
        });

        setEntries(newRows);

        const largeBatchMode = Boolean(options?.fromFolder) || imageFiles.length >= LARGE_BATCH_THRESHOLD;
        const uploadConcurrency = largeBatchMode ? 1 : UPLOAD_CONCURRENCY;
        const interFileDelayMs = largeBatchMode ? LARGE_BATCH_INTERFILE_DELAY_MS : 0;

        const jobs = newRows.map((row, index) => async () => {
          const file = imageFiles[index];
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
          expectedTotal: imageFiles.length,
          rowIds: newRows.map((row) => row.id),
        });

        if (awsOcrControl?.enabled && awsOcrControl.startLambdaConfigured) {
          await triggerAwsOcrControl('START', 'auto', false);
        }

        if (finalizeResult?.finalized === false) {
          setSubmitMessage({
            type: 'error',
            text: `Upload finalized with mismatch: expected ${imageFiles.length}, enqueued ${finalizeResult.enqueuedCount}. Missing ${finalizeResult.missingCount}.`,
          });
        } else {
          setSubmitMessage({
            type: 'success',
            text: `Queued ${imageFiles.length} screenshot(s). Mistral extraction now runs in the EC2 worker queue.`,
          });
        }
      } catch (error) {
        setSubmitMessage({
          type: 'error',
          text: error instanceof Error ? error.message : 'Failed to start upload queue.',
        });
      } finally {
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
