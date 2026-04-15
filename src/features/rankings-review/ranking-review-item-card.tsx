import Image from 'next/image';
import {
  AlertTriangle,
  ImageIcon,
  Link2,
  PencilLine,
  RefreshCw,
  ShieldAlert,
  Sparkles,
  UserPlus,
  XCircle,
} from 'lucide-react';
import type { OcrRuntimeProfile } from '@/lib/ocr/profiles';
import {
  getMetricDisplayName,
  getRankingTypeDisplayName,
  getSupportedBoardForPair,
} from '@/lib/rankings/board-types';
import { FilterBar, StatusPill } from '@/components/ui/primitives';
import {
  type RankingReviewDraft,
  type RerunHint,
  type ReviewAction,
  type ReviewRow,
  identityTone,
  parseCandidatePreview,
} from './ranking-review-model';

interface RankingReviewItemCardProps {
  row: ReviewRow;
  draft: RankingReviewDraft;
  rankingProfiles: OcrRuntimeProfile[];
  rerunProfileId: string;
  rerunHint: RerunHint | null;
  busyRow: string | null;
  onUpdateDraft: (field: keyof RankingReviewDraft, value: string) => void;
  onRerunProfileChange: (value: string) => void;
  onRerun: () => void;
  onAction: (action: ReviewAction) => void;
}

export function RankingReviewItemCard({
  row,
  draft,
  rankingProfiles,
  rerunProfileId,
  rerunHint,
  busyRow,
  onUpdateDraft,
  onRerunProfileChange,
  onRerun,
  onAction,
}: RankingReviewItemCardProps) {
  const candidatePreview = parseCandidatePreview(row.candidates);
  const boardLabel = getRankingTypeDisplayName(row.run.rankingType);
  const metricLabel = getMetricDisplayName(row.run.metricKey);
  const supportedBoard = getSupportedBoardForPair(row.run.rankingType, row.run.metricKey);
  const rerunMismatch =
    rerunHint &&
    (rerunHint.detectedRankingType !== row.run.rankingType ||
      rerunHint.detectedMetricKey !== row.run.metricKey);

  return (
    <article className="ocr-review">
      <header className="ocr-review-header">
        <div>
          <div className="flex items-center gap-8" style={{ flexWrap: 'wrap' }}>
            <strong>{row.governorNameRaw || 'Unknown'}</strong>
            <StatusPill label={row.identityStatus} tone={identityTone(row.identityStatus)} />
            <StatusPill label={boardLabel} tone={supportedBoard ? 'info' : 'bad'} />
            <span className="text-sm text-muted">{Math.round(row.confidence)}% confidence</span>
          </div>
          <div className="mt-4 text-sm text-muted">
            {boardLabel} • {metricLabel} • source rank {row.sourceRank ?? '—'} • metric {row.metricValue}
          </div>
          {row.run.headerText ? <div className="mt-4 text-sm text-muted">Header: {row.run.headerText}</div> : null}
          {(row.allianceRaw || row.titleRaw) ? (
            <div className="mt-4 text-sm text-muted">
              {row.allianceRaw ? `Alliance ${row.allianceRaw}` : `Title ${row.titleRaw}`}
            </div>
          ) : null}
          {candidatePreview.length > 0 ? (
            <div className="mt-4 text-sm text-muted">Candidates: {candidatePreview.join(' • ')}</div>
          ) : null}
          {!supportedBoard ? (
            <div className="mt-4 text-sm delta-negative">
              Unsupported ranking type/metric pair. Validate OCR header classification before approval.
            </div>
          ) : null}
        </div>
      </header>

      <div style={{ padding: '12px 14px' }}>
        {row.run.artifact?.url ? (
          <div className="mb-12">
            <a href={row.run.artifact.url} target="_blank" rel="noreferrer" className="text-sm">
              <ImageIcon size={14} style={{ verticalAlign: 'middle', marginRight: 6 }} />
              Open screenshot
            </a>
            <div className="mt-8">
              <Image
                src={row.run.artifact.url}
                alt={`Ranking screenshot for ${row.governorNameRaw}`}
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

        <div className="grid-2">
          <div className="form-group" style={{ marginBottom: 8 }}>
            <label className="form-label">Governor Game ID</label>
            <input
              className="form-input"
              value={draft.governorGameId}
              onChange={(event) => onUpdateDraft('governorGameId', event.target.value)}
              placeholder="e.g. 222067061"
            />
          </div>
          <div className="form-group" style={{ marginBottom: 8 }}>
            <label className="form-label">Alias for Create Alias</label>
            <input
              className="form-input"
              value={draft.aliasRaw}
              onChange={(event) => onUpdateDraft('aliasRaw', event.target.value)}
            />
          </div>
        </div>

        <div className="grid-3">
          <div className="form-group" style={{ marginBottom: 8 }}>
            <label className="form-label">Corrected Rank</label>
            <input
              className="form-input"
              value={draft.sourceRank}
              onChange={(event) => onUpdateDraft('sourceRank', event.target.value)}
            />
          </div>
          <div className="form-group" style={{ marginBottom: 8 }}>
            <label className="form-label">Corrected Name</label>
            <input
              className="form-input"
              value={draft.governorNameRaw}
              onChange={(event) => onUpdateDraft('governorNameRaw', event.target.value)}
            />
          </div>
          <div className="form-group" style={{ marginBottom: 8 }}>
            <label className="form-label">Corrected Metric</label>
            <input
              className="form-input"
              value={draft.metricRaw}
              onChange={(event) => onUpdateDraft('metricRaw', event.target.value)}
            />
          </div>
        </div>

        <FilterBar>
          <select
            className="form-select"
            value={rerunProfileId}
            onChange={(event) => onRerunProfileChange(event.target.value)}
            style={{ minWidth: 220 }}
          >
            <option value="">Auto-select rankboard profile</option>
            {rankingProfiles.map((profile) => (
              <option key={profile.id} value={profile.id}>
                {profile.name} ({profile.profileKey} v{profile.version})
              </option>
            ))}
          </select>
          <button
            className="btn btn-secondary btn-sm"
            onClick={onRerun}
            disabled={busyRow != null || !row.run.artifact?.url}
          >
            <RefreshCw size={14} />
            {busyRow === `${row.id}:RERUN_OCR` ? 'Re-running...' : 'Re-run OCR'}
          </button>
          <button className="btn btn-secondary btn-sm" onClick={() => onAction('LINK_TO_GOVERNOR')} disabled={busyRow != null}>
            <Link2 size={14} /> {busyRow === `${row.id}:LINK_TO_GOVERNOR` ? 'Linking...' : 'Link Governor'}
          </button>
          <button className="btn btn-secondary btn-sm" onClick={() => onAction('CREATE_ALIAS')} disabled={busyRow != null}>
            <UserPlus size={14} /> {busyRow === `${row.id}:CREATE_ALIAS` ? 'Saving...' : 'Create Alias'}
          </button>
          <button className="btn btn-primary btn-sm" onClick={() => onAction('CORRECT_ROW')} disabled={busyRow != null}>
            <PencilLine size={14} /> {busyRow === `${row.id}:CORRECT_ROW` ? 'Applying...' : 'Correct Row'}
          </button>
          <button className="btn btn-danger btn-sm" onClick={() => onAction('REJECT_ROW')} disabled={busyRow != null}>
            <XCircle size={14} /> {busyRow === `${row.id}:REJECT_ROW` ? 'Rejecting...' : 'Reject'}
          </button>
        </FilterBar>

        {rerunHint ? (
          <div className="mt-12" style={{ borderTop: '1px solid var(--line-soft)', paddingTop: 10 }}>
            <div className="flex items-center gap-8" style={{ flexWrap: 'wrap' }}>
              <StatusPill
                label={`Detected: ${getRankingTypeDisplayName(rerunHint.detectedRankingType)} / ${getMetricDisplayName(rerunHint.detectedMetricKey)}`}
                tone={rerunMismatch ? 'bad' : 'good'}
              />
              {rerunHint.matchedSourceRank != null ? (
                <StatusPill label={`Matched Rank ${rerunHint.matchedSourceRank}`} tone="info" />
              ) : null}
              {rerunHint.matchedConfidence != null ? (
                <StatusPill
                  label={`Row Confidence ${Math.round(rerunHint.matchedConfidence)}%`}
                  tone={rerunHint.matchedConfidence < 70 ? 'warn' : 'good'}
                />
              ) : null}
            </div>
            {rerunMismatch ? (
              <div className="mt-8 text-sm delta-negative">
                Re-run OCR detected a different board type/metric than this row. Confirm screenshot header before approving.
              </div>
            ) : null}
            {rerunHint.lowConfidence ? (
              <div className="mt-8 text-sm text-gold">
                <AlertTriangle size={14} style={{ verticalAlign: 'middle', marginRight: 6 }} />
                Re-run OCR marked this result as low confidence.
              </div>
            ) : null}
            {rerunHint.failureReasons.length > 0 ? (
              <div className="mt-8 text-sm text-muted">
                <Sparkles size={14} style={{ verticalAlign: 'middle', marginRight: 6 }} />
                {rerunHint.failureReasons.join(' • ')}
              </div>
            ) : null}
          </div>
        ) : null}

        {row.identityStatus === 'UNRESOLVED' ? (
          <div className="mt-8 text-sm text-muted">
            <ShieldAlert size={14} style={{ verticalAlign: 'middle', marginRight: 6 }} />
            Ambiguous identity requires manual confirmation before canonical merge.
          </div>
        ) : null}
      </div>
    </article>
  );
}
