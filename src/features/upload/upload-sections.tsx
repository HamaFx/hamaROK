import type { ChangeEventHandler, DragEventHandler, RefObject } from 'react';
import {
  CheckCircle2,
  CircleAlert,
  Clock3,
  ImageUp,
  Play,
  ShieldCheck,
  Square,
  Trash2,
} from 'lucide-react';
import { FilterBar, Panel, StatusPill } from '@/components/ui/primitives';
import {
  type AwsOcrControlStatus,
  type ScanJobResponse,
  type UploadQueueEntry,
  type WeeklyEventInfo,
  formatBytes,
  statusToneForRow,
} from './upload-model';

export function UploadStatusStrip({
  queuedCount,
  processingCount,
  completedCount,
  duplicateCount,
  failedCount,
}: {
  queuedCount: number;
  processingCount: number;
  completedCount: number;
  duplicateCount: number;
  failedCount: number;
}) {
  return (
    <FilterBar className="mb-24">
      <StatusPill label={`Queued ${queuedCount}`} tone="warn" />
      <StatusPill label={`Processing ${processingCount}`} tone="info" />
      <StatusPill label={`Completed ${completedCount}`} tone="good" />
      {duplicateCount > 0 ? <StatusPill label={`Duplicate ${duplicateCount}`} tone="warn" /> : null}
      {failedCount > 0 ? <StatusPill label={`Failed ${failedCount}`} tone="bad" /> : null}
    </FilterBar>
  );
}

export function UploadWorkerPanel({
  workspaceReady,
  workspaceName,
  sessionLoading,
  sessionError,
  weeklyEvent,
  workerLabel,
  workerTone,
  awsOcrControl,
  awsControlBusy,
  awsControlMessage,
  onStartWorker,
  onStopWorker,
}: {
  workspaceReady: boolean;
  workspaceName: string | null | undefined;
  sessionLoading: boolean;
  sessionError: string | null | undefined;
  weeklyEvent: WeeklyEventInfo | null;
  workerLabel: string;
  workerTone: 'good' | 'warn' | 'neutral';
  awsOcrControl: AwsOcrControlStatus | null;
  awsControlBusy: 'START' | 'STOP' | null;
  awsControlMessage: string | null;
  onStartWorker: () => void;
  onStopWorker: () => void;
}) {
  const workspaceLabel =
    workspaceName?.replace(/command center/gi, 'workspace') || 'your kingdom workspace';

  return (
    <Panel title="Weekly Window + Worker" className="mb-24">
      <div className="mb-12 text-sm text-muted">
        {workspaceReady
          ? `Connected to ${workspaceLabel}.`
          : sessionLoading
            ? 'Connecting workspace...'
            : sessionError || 'Workspace session is not ready yet.'}
      </div>
      <div className="grid-2" style={{ gap: 12 }}>
        <div className="card" style={{ padding: 12 }}>
          <strong>{weeklyEvent?.name || 'Preparing current weekly event...'}</strong>
          <div className="mt-8 text-sm text-muted">
            {weeklyEvent?.weekKey || 'week key pending'}
            {weeklyEvent?.startsAt
              ? ` • ${new Date(weeklyEvent.startsAt).toLocaleDateString(undefined, {
                  weekday: 'short',
                  month: 'short',
                  day: 'numeric',
                })}`
              : ''}
          </div>
          {weeklyEvent?.isClosed ? (
            <div className="mt-8 text-sm delta-negative">
              This week is marked closed. Re-open or switch week before official activity review.
            </div>
          ) : null}
        </div>

        <div className="card" style={{ padding: 12 }}>
          <div className="flex items-center gap-8" style={{ marginBottom: 8 }}>
            <ShieldCheck size={14} />
            <strong>AWS OCR Worker</strong>
            <StatusPill label={workerLabel} tone={workerTone} />
          </div>
          <div className="text-sm text-muted">Queue-driven auto-start. Use Start Worker to warm up before uploads.</div>
          <FilterBar className="mt-12" style={{ gap: 8 }}>
            <button
              className="btn btn-primary btn-sm"
              onClick={onStartWorker}
              disabled={!awsOcrControl?.enabled || awsControlBusy === 'START'}
            >
              <Play size={14} /> {awsControlBusy === 'START' ? 'Starting...' : 'Start Worker'}
            </button>
            <button
              className="btn btn-secondary btn-sm"
              onClick={onStopWorker}
              disabled={!awsOcrControl?.enabled || awsControlBusy === 'STOP'}
            >
              <Square size={14} /> {awsControlBusy === 'STOP' ? 'Stopping...' : 'Stop'}
            </button>
          </FilterBar>
          {awsControlMessage ? <div className="mt-8 text-sm text-muted">{awsControlMessage}</div> : null}
        </div>
      </div>
    </Panel>
  );
}

export function UploadDropZonePanel({
  isDragging,
  isUploading,
  scanJobId,
  scanJobState,
  entryCount,
  fileInputRef,
  onDragOver,
  onDragLeave,
  onDrop,
  onFileChange,
}: {
  isDragging: boolean;
  isUploading: boolean;
  scanJobId: string | null;
  scanJobState: ScanJobResponse | null;
  entryCount: number;
  fileInputRef: RefObject<HTMLInputElement | null>;
  onDragOver: DragEventHandler<HTMLDivElement>;
  onDragLeave: DragEventHandler<HTMLDivElement>;
  onDrop: DragEventHandler<HTMLDivElement>;
  onFileChange: ChangeEventHandler<HTMLInputElement>;
}) {
  return (
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
          onChange={onFileChange}
        />
      </div>

      {isUploading ? (
        <div className="mt-12 flex items-center gap-8 text-sm text-muted">
          <Clock3 size={14} /> Uploading and queueing screenshots...
        </div>
      ) : null}
      {scanJobId ? (
        <div className="mt-12 text-sm text-muted">
          Current job: {scanJobState?.processedFiles || 0}/{scanJobState?.totalFiles || entryCount} processed •{' '}
          <strong>{scanJobState?.status || 'PROCESSING'}</strong>
        </div>
      ) : null}
    </Panel>
  );
}

export function UploadProcessingPanel({
  scanJobState,
  entries,
  completedProfileRows,
  completedRankingRows,
  onOpenReview,
  onOpenRankingReview,
}: {
  scanJobState: ScanJobResponse | null;
  entries: UploadQueueEntry[];
  completedProfileRows: number;
  completedRankingRows: number;
  onOpenReview: () => void;
  onOpenRankingReview: () => void;
}) {
  if (!scanJobState || (scanJobState.status !== 'REVIEW' && scanJobState.status !== 'FAILED')) {
    return null;
  }

  return (
    <Panel
      title="Processing Finished"
      subtitle={
        scanJobState.status === 'REVIEW'
          ? 'OCR processing is complete. Continue in the review queues.'
          : 'Some rows failed. Review completed rows and retry failed screenshots.'
      }
      className="mb-24"
      actions={
        <FilterBar>
          <button className="btn btn-secondary btn-sm" onClick={onOpenReview}>
            OCR Review ({completedProfileRows})
          </button>
          <button className="btn btn-secondary btn-sm" onClick={onOpenRankingReview}>
            Ranking Review ({completedRankingRows})
          </button>
        </FilterBar>
      }
    >
      <div className="text-sm text-muted">
        Completed: {entries.filter((entry) => entry.status === 'completed').length} • Duplicate warnings:{' '}
        {entries.filter((entry) => entry.status === 'duplicate').length} • Failed:{' '}
        {entries.filter((entry) => entry.status === 'failed').length}
      </div>
    </Panel>
  );
}

export function UploadQueueTable({
  entries,
  onClear,
}: {
  entries: UploadQueueEntry[];
  onClear: () => void;
}) {
  if (!entries.length) {
    return null;
  }

  return (
    <Panel
      title={`Upload Queue Rows (${entries.length})`}
      actions={
        <FilterBar>
          <button className="btn btn-danger btn-sm" onClick={onClear}>
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
  );
}

export function UploadSubmitNotice({
  submitMessage,
}: {
  submitMessage: { type: 'success' | 'error'; text: string } | null;
}) {
  if (!submitMessage) {
    return null;
  }

  return (
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
  );
}
