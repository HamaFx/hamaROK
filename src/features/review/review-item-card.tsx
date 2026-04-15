import Image from 'next/image';
import {
  AlertTriangle,
  CheckCircle2,
  ImageIcon,
  RefreshCw,
  Save,
  ShieldCheck,
  Sparkles,
  XCircle,
} from 'lucide-react';
import type { OcrRuntimeProfile } from '@/lib/ocr/profiles';
import { FilterBar, StatusPill } from '@/components/ui/primitives';
import {
  type ExtractionStatus,
  type QueueItem,
  type ReviewDraft,
  REVIEW_FIELD_LABELS,
  REVIEW_FIELD_ORDER,
  formatFieldConfidence,
  reviewStatusTone,
} from './review-model';

interface ReviewItemCardProps {
  item: QueueItem;
  draft: ReviewDraft;
  actionBusy: string | null;
  profiles: OcrRuntimeProfile[];
  rerunProfileId: string;
  onRerunProfileChange: (value: string) => void;
  onUpdateDraft: (field: keyof ReviewDraft, value: string) => void;
  onRerun: () => void;
  onSaveGolden: () => void;
  onSubmit: (status: ExtractionStatus) => void;
}

export function ReviewItemCard({
  item,
  draft,
  actionBusy,
  profiles,
  rerunProfileId,
  onRerunProfileChange,
  onUpdateDraft,
  onRerun,
  onSaveGolden,
  onSubmit,
}: ReviewItemCardProps) {
  return (
    <article className="ocr-review">
      <header className="ocr-review-header">
        <div>
          <div className="flex items-center gap-8" style={{ flexWrap: 'wrap' }}>
            <strong>{item.values.governorName.value || 'Unknown Governor'}</strong>
            <StatusPill label="Governor Profile" tone="info" />
            <StatusPill label={item.severity.level} tone={reviewStatusTone(item.severity.level)} />
            <StatusPill label={item.status} tone="info" />
            {item.syncState === 'SYNCED' ? <StatusPill label="Synced" tone="good" /> : null}
            {item.syncState === 'PENDING_WEEK_LINK' ? <StatusPill label="Pending Week Link" tone="warn" /> : null}
            {item.lowConfidence ? <StatusPill label="Low Confidence" tone="warn" /> : null}
          </div>
          <div className="mt-4 text-sm text-muted">
            ID {item.values.governorId.value || '—'} • {item.engineVersion || item.provider} •{' '}
            {new Date(item.createdAt).toLocaleString()} • Overall {formatFieldConfidence(item.confidence)}
            {item.scanSource ? ` • ${item.scanSource}` : ''}
            {item.linkedEventId ? ` • Event ${item.linkedEventId.slice(0, 8)}` : ''}
          </div>
          {item.syncState === 'PENDING_WEEK_LINK' && item.syncMessage ? (
            <div className="mt-4 text-sm text-muted">{item.syncMessage}</div>
          ) : null}
        </div>
      </header>

      {item.artifact?.url ? (
        <div style={{ padding: '12px 14px 0' }}>
          <a href={item.artifact.url} target="_blank" rel="noreferrer" className="text-sm">
            <ImageIcon size={14} style={{ verticalAlign: 'middle', marginRight: 6 }} />
            Open screenshot
          </a>
          <div className="mt-8">
            <Image
              src={item.artifact.url}
              alt={`Profile screenshot for ${item.values.governorName.value || 'governor'}`}
              width={920}
              height={520}
              unoptimized
              style={{
                width: '100%',
                height: 'auto',
                maxWidth: 460,
                borderRadius: 10,
                border: '1px solid var(--line-soft)',
                display: 'block',
              }}
            />
          </div>
        </div>
      ) : null}

      <div className="review-field-grid">
        {REVIEW_FIELD_ORDER.map((fieldKey) => {
          const source = item.values[fieldKey as keyof QueueItem['values']];
          const validationFieldKey = fieldKey === 'governorName' ? 'name' : fieldKey;
          const fieldValidation = item.validation.find((entry) => entry.field === validationFieldKey);
          const candidateList = (source?.candidates || [])
            .map((candidate) => ({
              value: candidate.normalizedValue || '',
              confidence: Number(candidate.confidence || 0),
            }))
            .filter((candidate) => candidate.value)
            .slice(0, 3);

          return (
            <div key={`${item.id}-${fieldKey}`} className="review-field-row">
              <label className="ocr-field-label">{REVIEW_FIELD_LABELS[fieldKey]}</label>
              <div className="review-field-main">
                <input
                  className={`ocr-field-input ${
                    fieldValidation?.severity === 'error'
                      ? 'has-error'
                      : fieldValidation?.severity === 'warning'
                        ? 'has-warning'
                        : ''
                  }`}
                  value={draft[fieldKey] || ''}
                  onChange={(event) => onUpdateDraft(fieldKey, event.target.value)}
                />
                <span className="text-sm text-muted">{formatFieldConfidence(source?.confidence)}</span>
              </div>
              <div className="review-field-meta text-sm text-muted">
                <span>Prev: {source?.previousValue ?? '—'}</span>
                {source?.changed ? <span className="delta-negative">changed</span> : null}
                {source?.croppedImage ? (
                  <a href={source.croppedImage} target="_blank" rel="noreferrer">
                    crop
                  </a>
                ) : null}
                {fieldValidation?.warning ? (
                  <span className={fieldValidation.severity === 'error' ? 'delta-negative' : 'text-gold'}>
                    {fieldValidation.warning}
                  </span>
                ) : null}
              </div>
              {candidateList.length > 0 ? (
                <div className="review-candidate-row">
                  {candidateList.map((candidate, index) => (
                    <button
                      type="button"
                      key={`${item.id}-${fieldKey}-candidate-${index}`}
                      className="btn btn-ghost btn-sm"
                      onClick={() => onUpdateDraft(fieldKey, candidate.value)}
                    >
                      <Sparkles size={12} />
                      {candidate.value} ({Math.round(candidate.confidence)}%)
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      {item.severity.reasons.length > 0 ? (
        <div style={{ padding: '0 14px 10px' }}>
          {item.severity.reasons.map((reason, idx) => (
            <div key={`${item.id}-reason-${idx}`} className="text-sm text-muted">
              • {reason}
            </div>
          ))}
        </div>
      ) : null}

      {item.failureReasons && item.failureReasons.length > 0 ? (
        <div style={{ padding: '0 14px 10px' }}>
          {item.failureReasons.slice(0, 5).map((reason, idx) => (
            <div key={`${item.id}-failure-${idx}`} className="text-sm text-muted">
              • {reason}
            </div>
          ))}
        </div>
      ) : null}

      <FilterBar style={{ padding: '0 14px 14px' }}>
        <select
          className="form-select"
          value={rerunProfileId}
          onChange={(event) => onRerunProfileChange(event.target.value)}
          style={{ minWidth: 220 }}
        >
          <option value="">Auto-select profile</option>
          {profiles.map((profile) => (
            <option key={profile.id} value={profile.id}>
              {profile.name} ({profile.profileKey} v{profile.version})
            </option>
          ))}
        </select>

        <button className="btn btn-secondary btn-sm" disabled={Boolean(actionBusy)} onClick={onRerun}>
          <RefreshCw size={14} /> {actionBusy === `${item.id}:rerun` ? 'Re-running...' : 'Re-run OCR'}
        </button>
        <button className="btn btn-secondary btn-sm" disabled={Boolean(actionBusy)} onClick={onSaveGolden}>
          <Save size={14} /> {actionBusy === `${item.id}:fixture` ? 'Saving...' : 'Save Golden'}
        </button>
        <button className="btn btn-secondary btn-sm" disabled={Boolean(actionBusy)} onClick={() => onSubmit('REVIEWED')}>
          <CheckCircle2 size={14} /> {actionBusy === `${item.id}REVIEWED` ? 'Saving...' : 'Mark Reviewed'}
        </button>
        <button className="btn btn-primary btn-sm" disabled={Boolean(actionBusy)} onClick={() => onSubmit('APPROVED')}>
          <ShieldCheck size={14} /> {actionBusy === `${item.id}APPROVED` ? 'Approving...' : 'Approve'}
        </button>
        <button className="btn btn-danger btn-sm" disabled={Boolean(actionBusy)} onClick={() => onSubmit('REJECTED')}>
          <XCircle size={14} /> {actionBusy === `${item.id}REJECTED` ? 'Rejecting...' : 'Reject'}
        </button>
      </FilterBar>

      {item.lowConfidence ? (
        <div style={{ padding: '0 14px 12px' }} className="text-sm text-gold">
          <AlertTriangle size={14} style={{ verticalAlign: 'middle', marginRight: 6 }} />
          Low-confidence extraction flagged by OCR pipeline.
        </div>
      ) : null}
    </article>
  );
}
