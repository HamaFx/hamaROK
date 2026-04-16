'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useWorkspaceSession } from '@/lib/workspace-session';
import { InlineError, SessionGate } from '@/components/app/session-gate';
import { PageHero } from '@/components/ui/primitives';
import {
  type AwsOcrControlStatus,
  type ScanJobResponse,
  type TaskRow,
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

  const fileInputRef = useRef<HTMLInputElement>(null);
  const completionNotifiedRef = useRef<string | null>(null);

  const getPersistedJobKey = useCallback((id: string) => `upload:activeScanJob:${id}`, []);

  useEffect(() => {
    if (typeof window === 'undefined' || !workspaceId || !accessToken) return;
    const persistedJobId = localStorage.getItem(getPersistedJobKey(workspaceId)) || '';
    if (persistedJobId) {
      setScanJobId((prev) => prev || persistedJobId);
    }
  }, [workspaceId, accessToken, getPersistedJobKey]);

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

    const loadTasks = async () => {
      try {
        const res = await fetch(`/api/v2/scan-jobs/${scanJobId}/tasks?limit=200`, {
          headers: { 'x-access-token': accessToken },
        });
        const payload = await res.json();
        if (!res.ok || cancelled) {
          if (res.status === 404 || res.status === 403) {
            setScanJobId(null);
            setScanJobState(null);
            setEntries([]);
            if (typeof window !== 'undefined') {
              localStorage.removeItem(getPersistedJobKey(workspaceId));
            }
          }
          return;
        }

        const rows = (Array.isArray(payload?.data) ? payload.data : []) as TaskRow[];
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

        const completed = rows.filter((row) => row.status === 'COMPLETED').length;
        const failed = rows.filter((row) => row.status === 'FAILED').length;
        const nextStatus =
          completed + failed >= rows.length && rows.length > 0
            ? failed > 0
              ? 'FAILED'
              : 'REVIEW'
            : 'PROCESSING';

        setScanJobState(() => ({
          id: scanJobId,
          status: nextStatus,
          totalFiles: rows.length,
          processedFiles: completed + failed,
        }));

        if (typeof window !== 'undefined') {
          localStorage.setItem(getPersistedJobKey(workspaceId), scanJobId);
        }

        const isTerminal = nextStatus === 'REVIEW' || nextStatus === 'FAILED';
        if (isTerminal && completionNotifiedRef.current !== scanJobId) {
          completionNotifiedRef.current = scanJobId;
          if (nextStatus === 'REVIEW') {
            setSubmitMessage({
              type: 'success',
              text: `Processing finished. ${completed} screenshot(s) are ready for review.`,
            });
          } else {
            setSubmitMessage({
              type: 'error',
              text: `Processing finished with failures (${failed}/${rows.length}). Review or retry failed rows.`,
            });
          }
        }
      } catch {
        // Keep last known state; UI still shows local row progress.
      }
    };

    void loadTasks();
    const interval = window.setInterval(() => {
      void loadTasks();
      void loadAwsOcrControl();
    }, 3000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [scanJobId, workspaceId, accessToken, loadAwsOcrControl, getPersistedJobKey]);

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
      throw new Error(payload?.error?.message || `Failed to upload ${file.name}.`);
    }

    return payload.url as string;
  }, []);

  const enqueueArtifactTask = useCallback(
    async (args: {
      scanJobId: string;
      eventId: string | null;
      file: File;
      rowId: string;
      artifactUrl: string;
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
          fileName: args.file.name,
          bytes: args.file.size,
          idempotencyKey: `task-${args.scanJobId}-${args.rowId}`,
        }),
      });

      const payload = await res.json();
      if (!res.ok) {
        throw new Error(payload?.error?.message || `Failed to enqueue ${args.file.name}.`);
      }

      return payload?.data as {
        artifact: { id: string };
        task: {
          id: string;
          status: 'QUEUED' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
          archetypeHint?: string | null;
        };
      };
    },
    [accessToken, workspaceId]
  );

  const handleFiles = useCallback(
    async (files: File[]) => {
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

        const newRows: UploadQueueEntry[] = imageFiles.map((file, index) => ({
          id: `${Date.now()}-${index}`,
          fileName: file.name,
          status: 'uploading',
          sizeBytes: file.size,
          updatedAt: new Date().toISOString(),
        }));

        setEntries((prev) => [...newRows, ...prev]);

        for (let i = 0; i < imageFiles.length; i += 1) {
          const file = imageFiles[i];
          const rowId = newRows[i].id;

          try {
            const artifactUrl = await uploadScreenshotArtifact(file);
            const queued = await enqueueArtifactTask({
              scanJobId: job.id,
              eventId: job.eventId || activeWeekly?.id || null,
              file,
              rowId,
              artifactUrl,
            });

            setEntries((prev) =>
              prev.map((entry) =>
                entry.id === rowId
                  ? {
                      ...entry,
                      status: mapTaskStatus(queued.task.status, null),
                      taskId: queued.task.id,
                      artifactId: queued.artifact.id,
                      archetypeHint: queued.task.archetypeHint || undefined,
                      updatedAt: new Date().toISOString(),
                    }
                  : entry
              )
            );
          } catch (error) {
            setEntries((prev) =>
              prev.map((entry) =>
                entry.id === rowId
                  ? {
                      ...entry,
                      status: 'failed',
                      error: error instanceof Error ? error.message : 'Failed to enqueue file.',
                      updatedAt: new Date().toISOString(),
                    }
                  : entry
              )
            );
          }
        }

        if (awsOcrControl?.enabled && awsOcrControl.startLambdaConfigured) {
          await triggerAwsOcrControl('START', 'auto', false);
        }

        setSubmitMessage({
          type: 'success',
          text: `Queued ${imageFiles.length} screenshot(s). OCR processing now runs in the EC2 worker queue.`,
        });
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
      uploadScreenshotArtifact,
      enqueueArtifactTask,
      awsOcrControl?.enabled,
      awsOcrControl?.startLambdaConfigured,
      triggerAwsOcrControl,
      getPersistedJobKey,
    ]
  );

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
    if (typeof window !== 'undefined' && workspaceId) {
      localStorage.removeItem(getPersistedJobKey(workspaceId));
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

  const completedProfileRows = entries.filter(
    (entry) =>
      (entry.status === 'completed' || entry.status === 'duplicate') &&
      entry.metadata &&
      String((entry.metadata as Record<string, unknown>).ingestionDomain || '') === 'PROFILE_SNAPSHOT'
  ).length;
  const completedRankingRows = entries.filter(
    (entry) =>
      (entry.status === 'completed' || entry.status === 'duplicate') &&
      entry.metadata &&
      String((entry.metadata as Record<string, unknown>).ingestionDomain || '') === 'RANKING_CAPTURE'
  ).length;

  return (
    <div className="space-y-4 sm:space-y-5 lg:space-y-6">
      <PageHero
        title="Upload"
        subtitle="Upload weekly screenshots. OCR runs in the background and fills the review queues."
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
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
          onFileChange={(event) => {
            const files = Array.from(event.target.files || []);
            void handleFiles(files);
            event.target.value = '';
          }}
        />

        <UploadProcessingPanel
          scanJobState={scanJobState}
          entries={entries}
          completedProfileRows={completedProfileRows}
          completedRankingRows={completedRankingRows}
          onOpenReview={() => router.push('/review')}
          onOpenRankingReview={() => router.push('/rankings/review')}
        />

        <UploadQueueTable entries={entries} onClear={clearRows} />

        <UploadSubmitNotice submitMessage={submitMessage?.type === 'success' ? submitMessage : null} />
      </SessionGate>
    </div>
  );
}
