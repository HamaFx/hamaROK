'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Camera,
  CheckCircle2,
  CircleAlert,
  Clock3,
  ImageUp,
  Play,
  RefreshCw,
  ShieldCheck,
  Square,
  Trash2,
} from 'lucide-react';
import { useWorkspaceSession } from '@/lib/workspace-session';
import { EVENT_TYPE_LABELS } from '@/lib/utils';
import { FilterBar, KpiCard, PageHero, Panel, StatusPill } from '@/components/ui/primitives';

interface EventOption {
  id: string;
  name: string;
  eventType: string;
}

type QueueRowStatus = 'uploading' | 'queued' | 'processing' | 'completed' | 'failed';

interface UploadQueueEntry {
  id: string;
  fileName: string;
  status: QueueRowStatus;
  sizeBytes: number;
  taskId?: string;
  artifactId?: string;
  updatedAt: string;
  error?: string;
  archetypeHint?: string;
  metadata?: Record<string, unknown>;
}

interface TaskRow {
  id: string;
  status: 'QUEUED' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
  artifactId: string;
  archetypeHint: string | null;
  attemptCount: number;
  lastError: string | null;
  updatedAt: string;
  metadata?: Record<string, unknown>;
  artifact?: {
    id: string;
    type: string;
    url: string;
    metadata?: Record<string, unknown> | null;
  } | null;
}

interface AwsOcrControlStatus {
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
}

interface ScanJobResponse {
  id: string;
  status: string;
  totalFiles: number;
  processedFiles: number;
}

function mapTaskStatus(status: TaskRow['status']): QueueRowStatus {
  if (status === 'PROCESSING') return 'processing';
  if (status === 'COMPLETED') return 'completed';
  if (status === 'FAILED') return 'failed';
  return 'queued';
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function statusToneForRow(status: QueueRowStatus): 'good' | 'warn' | 'bad' | 'neutral' {
  if (status === 'completed') return 'good';
  if (status === 'processing' || status === 'queued' || status === 'uploading') return 'warn';
  if (status === 'failed') return 'bad';
  return 'neutral';
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

  const [events, setEvents] = useState<EventOption[]>([]);
  const [selectedEventId, setSelectedEventId] = useState('');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newEventName, setNewEventName] = useState('');
  const [newEventType, setNewEventType] = useState('CUSTOM');

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

  const getPersistedJobKey = useCallback(
    (id: string) => `upload:activeScanJob:${id}`,
    []
  );
  const getPersistedEventKey = useCallback(
    (id: string) => `upload:selectedEvent:${id}`,
    []
  );

  useEffect(() => {
    if (typeof window === 'undefined' || !workspaceId) return;
    const persistedEvent = localStorage.getItem(getPersistedEventKey(workspaceId)) || '';
    if (persistedEvent) {
      setSelectedEventId(persistedEvent);
    }
  }, [workspaceId, getPersistedEventKey]);

  useEffect(() => {
    if (typeof window === 'undefined' || !workspaceId) return;
    if (selectedEventId) {
      localStorage.setItem(getPersistedEventKey(workspaceId), selectedEventId);
    }
  }, [workspaceId, selectedEventId, getPersistedEventKey]);

  useEffect(() => {
    if (typeof window === 'undefined' || !workspaceId || !accessToken) return;
    const persistedJobId = localStorage.getItem(getPersistedJobKey(workspaceId)) || '';
    if (persistedJobId) {
      setScanJobId((prev) => prev || persistedJobId);
    }
  }, [workspaceId, accessToken, getPersistedJobKey]);

  const loadEvents = useCallback(async () => {
    if (!workspaceReady) {
      setEvents([]);
      return;
    }

    try {
      const params = new URLSearchParams({ workspaceId, limit: '200' });
      const res = await fetch(`/api/v2/events?${params.toString()}`, {
        headers: { 'x-access-token': accessToken },
      });
      const payload = await res.json();
      if (!res.ok) {
        setEvents([]);
        return;
      }

      const rows = Array.isArray(payload?.data) ? payload.data : [];
      const mapped = rows.map((row: { id: string; name: string; eventType: string }) => ({
        id: row.id,
        name: row.name,
        eventType: row.eventType,
      }));
      setEvents(mapped);

      if (!selectedEventId && mapped[0]?.id) {
        setSelectedEventId(mapped[0].id);
      }
    } catch {
      setEvents([]);
    }
  }, [workspaceId, accessToken, selectedEventId, workspaceReady]);

  useEffect(() => {
    void loadEvents();
  }, [loadEvents]);

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
    loadAwsOcrControl();
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
          const fileName =
            (task.artifact?.metadata &&
            typeof task.artifact.metadata === 'object' &&
            !Array.isArray(task.artifact.metadata) &&
            typeof (task.artifact.metadata as Record<string, unknown>).fileName === 'string'
              ? String((task.artifact.metadata as Record<string, unknown>).fileName)
              : null) || `artifact-${task.artifactId.slice(0, 8)}`;

          return {
            id: task.id,
            fileName,
            status: mapTaskStatus(task.status),
            sizeBytes: 0,
            taskId: task.id,
            artifactId: task.artifactId,
            updatedAt: task.updatedAt,
            error: task.lastError || undefined,
            archetypeHint: task.archetypeHint || undefined,
            metadata: task.metadata || undefined,
          };
        });

        setEntries((prev) => {
          const uploading = prev.filter((entry) => entry.status === 'uploading' && !entry.taskId);
          return [...uploading, ...fromTasks];
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

  const createScanJob = useCallback(async (totalFiles: number) => {
    const res = await fetch('/api/v2/scan-jobs', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-access-token': accessToken,
      },
      body: JSON.stringify({
        workspaceId,
        eventId: selectedEventId,
        source: 'MANUAL_UPLOAD',
        totalFiles,
        notes: `Queue-first upload batch at ${new Date().toISOString()}`,
        idempotencyKey: `queue-first-${selectedEventId}-${Date.now()}`,
      }),
    });

    const payload = await res.json();
    if (!res.ok) {
      throw new Error(payload?.error?.message || 'Failed to create scan job.');
    }

    return payload?.data as ScanJobResponse;
  }, [workspaceId, accessToken, selectedEventId]);

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

  const enqueueArtifactTask = useCallback(async (args: {
    scanJobId: string;
    file: File;
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
        eventId: selectedEventId,
        artifactUrl: args.artifactUrl,
        artifactType: 'SCREENSHOT',
        fileName: args.file.name,
        bytes: args.file.size,
        idempotencyKey: `task-${args.scanJobId}-${args.file.name}-${args.file.size}-${Date.now()}`,
      }),
    });

    const payload = await res.json();
    if (!res.ok) {
      throw new Error(payload?.error?.message || `Failed to enqueue ${args.file.name}.`);
    }

    return payload?.data as {
      artifact: { id: string };
      task: { id: string; status: 'QUEUED' | 'PROCESSING' | 'COMPLETED' | 'FAILED'; archetypeHint?: string | null };
    };
  }, [accessToken, workspaceId, selectedEventId]);

  const handleFiles = useCallback(async (files: File[]) => {
    const imageFiles = files.filter((f) => f.type.startsWith('image/'));
    if (imageFiles.length === 0) return;

    if (!workspaceReady) {
      if (!sessionLoading) {
        void refreshSession();
      }
      setSubmitMessage({ type: 'error', text: 'Connecting workspace. Try upload again in a moment.' });
      return;
    }

    if (!selectedEventId) {
      setSubmitMessage({ type: 'error', text: 'Select an event before uploading screenshots.' });
      return;
    }

    setIsUploading(true);
    setSubmitMessage(null);

    try {
      const job = await createScanJob(imageFiles.length);
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
            file,
            artifactUrl,
          });

          setEntries((prev) =>
            prev.map((entry) =>
              entry.id === rowId
                ? {
                    ...entry,
                    status: mapTaskStatus(queued.task.status),
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
  }, [
    workspaceId,
    workspaceReady,
    sessionLoading,
    refreshSession,
    selectedEventId,
    createScanJob,
    uploadScreenshotArtifact,
    enqueueArtifactTask,
    awsOcrControl?.enabled,
    awsOcrControl?.startLambdaConfigured,
    triggerAwsOcrControl,
    getPersistedJobKey,
  ]);

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

  const createEvent = async () => {
    if (!newEventName.trim()) return;
    if (!workspaceReady) {
      setSubmitMessage({ type: 'error', text: 'Workspace is still connecting.' });
      return;
    }

    try {
      const res = await fetch('/api/v2/events', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-access-token': accessToken,
        },
        body: JSON.stringify({
          workspaceId,
          name: newEventName.trim(),
          eventType: newEventType,
        }),
      });
      const payload = await res.json();
      if (!res.ok || !payload?.data?.id) {
        throw new Error(payload?.error?.message || 'Failed to create event.');
      }
      const event = payload.data as EventOption;
      setEvents((prev) => [event, ...prev]);
      setSelectedEventId(event.id);
      setNewEventName('');
      setShowCreateModal(false);
    } catch {
      setSubmitMessage({ type: 'error', text: 'Failed to create event.' });
    }
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
  const failedCount = entries.filter((entry) => entry.status === 'failed').length;

  const workerState = (awsOcrControl?.instanceState || '').toLowerCase();
  const workerRunning = workerState === 'running' || workerState === 'pending';
  const workerLabel = !awsOcrControl?.enabled ? 'Disabled' : workerRunning ? 'Online' : 'Standby';
  const workerTone = !awsOcrControl?.enabled ? 'neutral' : workerRunning ? 'good' : 'warn';

  const completedProfileRows = entries.filter(
    (entry) =>
      entry.status === 'completed' &&
      entry.metadata &&
      String((entry.metadata as Record<string, unknown>).ingestionDomain || '') ===
        'PROFILE_SNAPSHOT'
  ).length;
  const completedRankingRows = entries.filter(
    (entry) =>
      entry.status === 'completed' &&
      entry.metadata &&
      String((entry.metadata as Record<string, unknown>).ingestionDomain || '') ===
        'RANKING_CAPTURE'
  ).length;

  return (
    <div className="page-container">
      <PageHero
        title="Upload Queue"
        subtitle="Queue-first OCR ingestion. Files upload instantly and process in the background without freezing your browser."
        actions={
          <FilterBar>
            <button className="btn btn-secondary btn-sm" onClick={() => void refreshSession()} disabled={sessionLoading}>
              <RefreshCw size={14} /> {sessionLoading ? 'Connecting...' : 'Reconnect'}
            </button>
          </FilterBar>
        }
      />

      <div className="grid-4 mb-24">
        <KpiCard label="Queued" value={queuedCount} hint="Waiting in queue" tone="warn" />
        <KpiCard label="Processing" value={processingCount} hint="Upload + OCR worker" tone="info" />
        <KpiCard label="Completed" value={completedCount} hint="Ready for review queue" tone="good" />
        <KpiCard label="Failed" value={failedCount} hint="Needs retry" tone={failedCount > 0 ? 'bad' : 'neutral'} />
      </div>

      <Panel title="Event + Worker" className="mb-24">
        <div className="text-sm text-muted mb-12">
          {workspaceReady
            ? `Connected to ${workspaceName || 'your kingdom workspace'}.`
            : sessionLoading
              ? 'Connecting workspace...'
              : sessionError || 'Workspace session is not ready yet.'}
        </div>
        <div className="grid-2" style={{ gap: 12 }}>
          <div>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">Event</label>
              <select
                className="form-select"
                value={selectedEventId}
                onChange={(e) => setSelectedEventId(e.target.value)}
              >
                <option value="">Choose an event...</option>
                {events.map((ev) => (
                  <option key={ev.id} value={ev.id}>
                    {ev.name}
                  </option>
                ))}
              </select>
            </div>
            <button className="btn btn-secondary btn-sm mt-12" onClick={() => setShowCreateModal(true)}>
              + New Event
            </button>
          </div>

          <div className="card" style={{ padding: 12 }}>
            <div className="flex items-center gap-8" style={{ marginBottom: 8 }}>
              <ShieldCheck size={14} />
              <strong>AWS OCR Worker</strong>
              <StatusPill label={workerLabel} tone={workerTone} />
            </div>
            <div className="text-sm text-muted">Use manual start only when you want OCR warm before uploading.</div>
            <FilterBar className="mt-12" style={{ gap: 8 }}>
              <button
                className="btn btn-primary btn-sm"
                onClick={() => triggerAwsOcrControl('START', 'manual', true)}
                disabled={!awsOcrControl?.enabled || awsControlBusy === 'START'}
              >
                <Play size={14} /> {awsControlBusy === 'START' ? 'Starting...' : 'Start Worker'}
              </button>
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => triggerAwsOcrControl('STOP', 'manual', false)}
                disabled={!awsOcrControl?.enabled || awsControlBusy === 'STOP'}
              >
                <Square size={14} /> {awsControlBusy === 'STOP' ? 'Stopping...' : 'Stop'}
              </button>
            </FilterBar>
            {awsControlMessage ? <div className="text-sm text-muted mt-8">{awsControlMessage}</div> : null}
          </div>
        </div>
      </Panel>

      <Panel title="Drop Screenshots" className="mb-24">
        <div
          className={`drop-zone ${isDragging ? 'dragging' : ''}`}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
          onClick={() => fileInputRef.current?.click()}
        >
          <div className="drop-icon">
            <ImageUp size={28} />
          </div>
          <div className="drop-text">{isDragging ? 'Release to queue uploads' : 'Drop screenshots here'}</div>
          <div className="drop-hint">PNG, JPG, WEBP • Queue-first processing (no browser OCR freeze)</div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            multiple
            style={{ display: 'none' }}
            onChange={(e) => {
              const files = Array.from(e.target.files || []);
              void handleFiles(files);
              e.target.value = '';
            }}
          />
        </div>

        {isUploading ? (
          <div className="mt-12 text-sm text-muted flex items-center gap-8">
            <Clock3 size={14} /> Uploading and queueing screenshots...
          </div>
        ) : null}
      </Panel>

      {scanJobId ? (
        <Panel
          title="Current Scan Job"
          subtitle={`Job ${scanJobId} • ${scanJobState?.processedFiles || 0}/${scanJobState?.totalFiles || entries.length} processed`}
          className="mb-24"
        >
          <div className="text-sm text-muted">
            Status: <strong>{scanJobState?.status || 'PROCESSING'}</strong>
          </div>
        </Panel>
      ) : null}

      {scanJobState && (scanJobState.status === 'REVIEW' || scanJobState.status === 'FAILED') ? (
        <Panel
          title="Processing Finished"
          subtitle={
            scanJobState.status === 'REVIEW'
              ? 'OCR processing is complete. Continue to review queues.'
              : 'Some rows failed. Review completed rows and retry failed screenshots if needed.'
          }
          className="mb-24"
          actions={
            <FilterBar>
              <button className="btn btn-secondary btn-sm" onClick={() => router.push('/review')}>
                OCR Review ({completedProfileRows})
              </button>
              <button className="btn btn-secondary btn-sm" onClick={() => router.push('/rankings/review')}>
                Ranking Review ({completedRankingRows})
              </button>
            </FilterBar>
          }
        >
          <div className="text-sm text-muted">
            Completed: {entries.filter((entry) => entry.status === 'completed').length} • Failed:{' '}
            {entries.filter((entry) => entry.status === 'failed').length}
          </div>
        </Panel>
      ) : null}

      {entries.length > 0 ? (
        <Panel
          title={`Upload Queue Rows (${entries.length})`}
          actions={
            <FilterBar>
              <button className="btn btn-secondary btn-sm" onClick={loadAwsOcrControl}>
                <RefreshCw size={14} /> Refresh
              </button>
              <button className="btn btn-danger btn-sm" onClick={clearRows}>
                <Trash2 size={14} /> Clear List
              </button>
            </FilterBar>
          }
        >
          <div className="data-table-wrap">
            <table className="data-table data-table-dense">
              <thead>
                <tr>
                  <th>File</th>
                  <th>Status</th>
                  <th>Size</th>
                  <th>Updated</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => (
                  <tr key={entry.id}>
                    <td>
                      <strong>{entry.fileName}</strong>
                      {entry.error ? <div className="text-sm delta-negative">{entry.error}</div> : null}
                    </td>
                    <td>
                      <StatusPill label={entry.status.toUpperCase()} tone={statusToneForRow(entry.status)} />
                    </td>
                    <td>{formatBytes(entry.sizeBytes)}</td>
                    <td>{new Date(entry.updatedAt).toLocaleTimeString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      ) : null}

      {submitMessage ? (
        <div className={`card mt-16 ${submitMessage.type === 'error' ? 'delta-negative' : ''}`}>
          <div className="flex items-center gap-8">
            {submitMessage.type === 'success' ? (
              <CheckCircle2 size={15} color="#72f5c7" />
            ) : (
              <CircleAlert size={15} color="#ff9cad" />
            )}
            <span className="text-sm">{submitMessage.text}</span>
          </div>
        </div>
      ) : null}

      {showCreateModal ? (
        <div className="modal-overlay" onClick={() => setShowCreateModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Create New Event</h2>
            <div className="form-group">
              <label className="form-label">Event Name</label>
              <input
                className="form-input"
                value={newEventName}
                onChange={(e) => setNewEventName(e.target.value)}
                placeholder="e.g., KvK S3 - Start"
                autoFocus
              />
            </div>
            <div className="form-group">
              <label className="form-label">Event Type</label>
              <select className="form-select" value={newEventType} onChange={(e) => setNewEventType(e.target.value)}>
                {Object.entries(EVENT_TYPE_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setShowCreateModal(false)}>
                Cancel
              </button>
              <button className="btn btn-primary" onClick={createEvent}>
                <Camera size={14} /> Create Event
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
