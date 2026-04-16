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
import { Button } from '@/components/ui/button';
import {
  DataTableLite,
  FilterBar,
  Panel,
  StatusPill,
} from '@/components/ui/primitives';
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
    <FilterBar>
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
    <Panel title="Weekly Window + Worker">
      <p className="mb-3 text-sm text-tier-3">
        {workspaceReady
          ? `Connected to ${workspaceLabel}.`
          : sessionLoading
            ? 'Connecting workspace...'
            : sessionError || 'Workspace session is not ready yet.'}
      </p>
      <div className="grid gap-3 md:grid-cols-2">
        <div className="rounded-[22px] border border-[color:var(--stroke-soft)] bg-[color:var(--surface-3)] p-3.5">
          <p className="font-heading text-base text-tier-1">{weeklyEvent?.name || 'Preparing current weekly event...'}</p>
          <p className="mt-2 text-sm text-tier-3">
            {weeklyEvent?.weekKey || 'week key pending'}
            {weeklyEvent?.startsAt
              ? ` • ${new Date(weeklyEvent.startsAt).toLocaleDateString(undefined, {
                  weekday: 'short',
                  month: 'short',
                  day: 'numeric',
                })}`
              : ''}
          </p>
          {weeklyEvent?.isClosed ? (
            <p className="mt-2 text-sm text-rose-200">
              This week is marked closed. Re-open or switch week before official activity review.
            </p>
          ) : null}
        </div>

        <div className="rounded-[22px] border border-[color:var(--stroke-soft)] bg-[color:var(--surface-3)] p-3.5">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <ShieldCheck className="size-4" />
            <strong className="text-sm text-tier-1">AWS OCR Worker</strong>
            <StatusPill label={workerLabel} tone={workerTone} />
          </div>
          <p className="text-sm text-tier-3">Queue-driven auto-start. Use Start Worker to warm up before uploads.</p>
          <FilterBar className="mt-3">
            <Button
              onClick={onStartWorker}
              disabled={!awsOcrControl?.enabled || awsControlBusy === 'START'}
              className="rounded-full bg-[color:var(--primary)] text-primary-foreground hover:opacity-90 shadow-lg hover:opacity-95"
            >
              <Play data-icon="inline-start" /> {awsControlBusy === 'START' ? 'Starting...' : 'Start Worker'}
            </Button>
            <Button
              variant="outline"
              className="rounded-full border-[color:var(--stroke-soft)] bg-[color:var(--surface-3)] text-tier-1 hover:bg-[color:var(--surface-4)] hover:text-tier-1"
              onClick={onStopWorker}
              disabled={!awsOcrControl?.enabled || awsControlBusy === 'STOP'}
            >
              <Square data-icon="inline-start" /> {awsControlBusy === 'STOP' ? 'Stopping...' : 'Stop'}
            </Button>
          </FilterBar>
          {awsControlMessage ? <p className="mt-2 text-sm text-tier-3">{awsControlMessage}</p> : null}
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
    <Panel title="Drop Screenshots">
      <div
        className={`cursor-pointer rounded-[20px] border border-dashed px-4 py-8 text-center transition-colors min-[390px]:rounded-[22px] min-[390px]:px-5 min-[390px]:py-9 sm:rounded-[24px] sm:py-10 ${
          isDragging
            ? 'border-sky-300/35 bg-sky-300/10'
            : 'border-[color:var(--stroke-strong)] bg-[color:var(--surface-3)] hover:border-[color:var(--stroke-strong)] hover:bg-[color:var(--surface-3)]'
        }`}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        onClick={() => fileInputRef.current?.click()}
      >
        <div className="mx-auto mb-3 grid size-12 place-items-center rounded-2xl border border-[color:var(--stroke-soft)] bg-[color:var(--surface-4)] text-tier-2">
          <ImageUp className="size-6" />
        </div>
        <p className="font-heading text-lg text-tier-1">
          {isDragging ? 'Release to queue uploads' : 'Drop screenshots here'}
        </p>
        <p className="mt-2 text-sm text-tier-3">PNG, JPG, WEBP • Queue-first processing (no browser OCR freeze)</p>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          multiple
          className="hidden"
          onChange={onFileChange}
        />
      </div>

      {isUploading ? (
        <div className="mt-3 flex items-center gap-2 text-sm text-tier-3">
          <Clock3 className="size-4" /> Uploading and queueing screenshots...
        </div>
      ) : null}
      {scanJobId ? (
        <div className="mt-3 text-sm text-tier-3">
          Current job: {scanJobState?.processedFiles || 0}/{scanJobState?.totalFiles || entryCount} processed •{' '}
          <strong className="text-tier-1">{scanJobState?.status || 'PROCESSING'}</strong>
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
      actions={
        <FilterBar>
          <Button
            variant="outline"
            className="rounded-full border-[color:var(--stroke-soft)] bg-[color:var(--surface-3)] text-tier-1 hover:bg-[color:var(--surface-4)] hover:text-tier-1"
            onClick={onOpenReview}
          >
            OCR Review ({completedProfileRows})
          </Button>
          <Button
            variant="outline"
            className="rounded-full border-[color:var(--stroke-soft)] bg-[color:var(--surface-3)] text-tier-1 hover:bg-[color:var(--surface-4)] hover:text-tier-1"
            onClick={onOpenRankingReview}
          >
            Ranking Review ({completedRankingRows})
          </Button>
        </FilterBar>
      }
    >
      <p className="text-sm text-tier-3">
        Completed: {entries.filter((entry) => entry.status === 'completed').length} • Duplicate warnings:{' '}
        {entries.filter((entry) => entry.status === 'duplicate').length} • Failed:{' '}
        {entries.filter((entry) => entry.status === 'failed').length}
      </p>
    </Panel>
  );
}

export function UploadQueueTable({
  entries,
  onClear,
  onRetryRow,
  onRetryFailed,
  retryingRowId,
  retryingBulk,
}: {
  entries: UploadQueueEntry[];
  onClear: () => void;
  onRetryRow: (rowId: string) => void;
  onRetryFailed: () => void;
  retryingRowId: string | null;
  retryingBulk: boolean;
}) {
  if (!entries.length) {
    return null;
  }

  return (
    <Panel
      title={`Upload Queue Rows (${entries.length})`}
      actions={
        <FilterBar>
          <Button
            variant="outline"
            className="rounded-full border-[color:var(--stroke-soft)] bg-[color:var(--surface-3)] text-tier-1 hover:bg-[color:var(--surface-4)] hover:text-tier-1"
            onClick={onRetryFailed}
            disabled={retryingBulk || entries.every((entry) => entry.status !== 'failed')}
          >
            {retryingBulk ? 'Retrying Failed...' : 'Retry Failed'}
          </Button>
          <Button variant="destructive" className="rounded-full" onClick={onClear}>
            <Trash2 data-icon="inline-start" /> Clear List
          </Button>
        </FilterBar>
      }
    >
      <DataTableLite
        rows={entries}
        rowKey={(entry) => entry.id}
        columns={[
          {
            key: 'file',
            label: 'File',
            render: (entry) => (
              <div>
                <strong>{entry.fileName}</strong>
                {entry.error ? <div className="mt-1 text-sm text-rose-200">{entry.error}</div> : null}
              </div>
            ),
          },
          {
            key: 'status',
            label: 'Status',
            render: (entry) => (
              <StatusPill label={entry.status.toUpperCase()} tone={statusToneForRow(entry.status)} />
            ),
          },
          {
            key: 'size',
            label: 'Size',
            className: 'num',
            render: (entry) => formatBytes(entry.sizeBytes),
          },
          {
            key: 'updated',
            label: 'Updated',
            className: 'num',
            render: (entry) => new Date(entry.updatedAt).toLocaleTimeString(),
          },
          {
            key: 'actions',
            label: 'Actions',
            render: (entry) =>
              entry.status === 'failed' ? (
                <Button
                  size="sm"
                  variant="outline"
                  className="rounded-full border-[color:var(--stroke-soft)] bg-[color:var(--surface-3)] text-tier-1 hover:bg-[color:var(--surface-4)] hover:text-tier-1"
                  onClick={() => onRetryRow(entry.id)}
                  disabled={retryingRowId === entry.id || retryingBulk}
                >
                  {retryingRowId === entry.id ? 'Retrying...' : 'Retry'}
                </Button>
              ) : (
                <span className="text-xs text-tier-3">—</span>
              ),
          },
        ]}
      />
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
    <div
      className={`rounded-2xl border px-4 py-3 ${
        submitMessage.type === 'success'
          ? 'border-emerald-300/18 bg-emerald-400/10 text-emerald-100'
          : 'border-rose-300/18 bg-rose-400/10 text-rose-100'
      }`}
    >
      <div className="flex items-center gap-2.5 text-sm">
        {submitMessage.type === 'success' ? <CheckCircle2 className="size-4" /> : <CircleAlert className="size-4" />}
        <span>{submitMessage.text}</span>
      </div>
    </div>
  );
}
