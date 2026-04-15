'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import React from 'react';
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
import { useWorkspaceSession } from '@/lib/workspace-session';
import { getRankingTypeDisplayName, SUPPORTED_RANKING_BOARDS } from '@/lib/rankings/board-types';
import {
  EmptyState,
  FilterBar,
  KpiCard,
  PageHero,
  Panel,
  SkeletonSet,
  StatusPill,
} from '@/components/ui/primitives';

type Severity = 'HIGH' | 'MEDIUM' | 'LOW';
type ExtractionStatus = 'RAW' | 'REVIEWED' | 'APPROVED' | 'REJECTED';

interface QueueField {
  value: string;
  confidence: number;
  previousValue?: string | null;
  changed?: boolean;
  croppedImage?: string;
  candidates?: Array<{
    id: string;
    source?: string;
    normalizedValue?: string;
    confidence?: number;
    score?: number;
  }>;
}

interface QueueItem {
  id: string;
  scanJobId: string;
  eventId: string | null;
  scanSource?: string;
  scanStatus?: string;
  provider: string;
  status: ExtractionStatus;
  confidence: number;
  severity: { level: Severity; reasons: string[] };
  lowConfidence?: boolean;
  profileId?: string | null;
  profile?: {
    id: string;
    profileKey: string;
    name: string;
    version: number;
  } | null;
  engineVersion?: string | null;
  failureReasons?: string[];
  preprocessingTrace?: Record<string, unknown>;
  candidates?: Record<string, unknown>;
  fusionDecision?: Record<string, unknown>;
  values: {
    governorId: QueueField;
    governorName: QueueField;
    power: QueueField;
    killPoints: QueueField;
    t4Kills: QueueField;
    t5Kills: QueueField;
    deads: QueueField;
  };
  validation: Array<{
    field: string;
    severity: 'ok' | 'warning' | 'error';
    warning?: string;
  }>;
  artifact?: {
    id: string;
    url: string;
    type: string;
  } | null;
  createdAt: string;
}

interface RankingQueueSummary {
  total: number;
  statuses: string[];
  byType: Array<{
    rankingType: string;
    metricKey: string;
    count: number;
  }>;
}

const defaultDraft = {
  governorId: '',
  governorName: '',
  power: '',
  killPoints: '',
  t4Kills: '',
  t5Kills: '',
  deads: '',
};

const FIELD_ORDER: Array<keyof typeof defaultDraft> = [
  'governorId',
  'governorName',
  'power',
  'killPoints',
  't4Kills',
  't5Kills',
  'deads',
];

const FIELD_LABELS: Record<keyof typeof defaultDraft, string> = {
  governorId: 'Governor ID',
  governorName: 'Governor Name',
  power: 'Power',
  killPoints: 'Kill Points',
  t4Kills: 'T4 Kills',
  t5Kills: 'T5 Kills',
  deads: 'Deads',
};

const STATUS_PRESETS = [
  { label: 'Pending', value: 'RAW,REVIEWED' },
  { label: 'Raw', value: 'RAW' },
  { label: 'Reviewed', value: 'REVIEWED' },
  { label: 'Approved', value: 'APPROVED' },
  { label: 'Rejected', value: 'REJECTED' },
];

function statusTone(level: Severity): 'warn' | 'bad' | 'neutral' {
  if (level === 'HIGH') return 'bad';
  if (level === 'MEDIUM') return 'warn';
  return 'neutral';
}

function formatFieldConfidence(value?: number) {
  if (typeof value !== 'number') return '0%';
  const normalized = value <= 1 ? value * 100 : value;
  return `${Math.round(normalized)}%`;
}

export default function ReviewQueuePage() {
  const {
    workspaceId,
    accessToken,
    ready: workspaceReady,
    loading: sessionLoading,
    error: sessionError,
  } = useWorkspaceSession();

  const [items, setItems] = useState<QueueItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [severity, setSeverity] = useState<'' | Severity>('');
  const [statusFilter, setStatusFilter] = useState('RAW,REVIEWED');
  const [drafts, setDrafts] = useState<Record<string, typeof defaultDraft>>({});
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [actionNotice, setActionNotice] = useState<string | null>(null);
  const [profiles, setProfiles] = useState<OcrRuntimeProfile[]>([]);
  const [rerunProfileByItem, setRerunProfileByItem] = useState<Record<string, string>>({});
  const [rerunPayloadByItem, setRerunPayloadByItem] = useState<Record<string, unknown>>({});
  const [metricsSummary, setMetricsSummary] = useState<{
    lowConfidenceRate: number;
    reviewerEditRate: number;
    reviewPassRate: number;
  } | null>(null);
  const [rankingQueueSummary, setRankingQueueSummary] = useState<RankingQueueSummary | null>(null);

  const loadQueue = useCallback(async () => {
    if (!workspaceReady) {
      setError(sessionLoading ? 'Connecting workspace session...' : 'Workspace session is not ready.');
      return;
    }

    setError(null);
    setActionNotice(null);
    setLoading(true);

    const params = new URLSearchParams({
      workspaceId,
      status: statusFilter,
      limit: '60',
      sortBy: 'createdAt',
      sortDir: 'desc',
    });

    if (severity) params.set('severity', severity);

    try {
      const res = await fetch(`/api/v2/review-queue?${params.toString()}`, {
        headers: { 'x-access-token': accessToken },
      });
      const payload = await res.json();
      if (!res.ok) {
        throw new Error(payload?.error?.message || 'Failed to load review queue.');
      }

      const data = (payload.data || []) as QueueItem[];
      setItems(data);

      const nextDrafts: Record<string, typeof defaultDraft> = {};
      const nextRerunProfiles: Record<string, string> = {};
      for (const item of data) {
        nextDrafts[item.id] = {
          governorId: item.values.governorId.value,
          governorName: item.values.governorName.value,
          power: item.values.power.value,
          killPoints: item.values.killPoints.value,
          t4Kills: item.values.t4Kills.value,
          t5Kills: item.values.t5Kills.value,
          deads: item.values.deads.value,
        };
        nextRerunProfiles[item.id] = item.profileId || '';
      }

      setDrafts(nextDrafts);
      setRerunProfileByItem(nextRerunProfiles);
      setRerunPayloadByItem({});

      try {
        const metricParams = new URLSearchParams({ workspaceId, days: '30' });
        const metricRes = await fetch(`/api/v2/ocr/metrics?${metricParams.toString()}`, {
          headers: { 'x-access-token': accessToken },
        });
        const metricPayload = await metricRes.json();
        if (metricRes.ok && metricPayload?.data?.rates) {
          setMetricsSummary({
            lowConfidenceRate: Number(metricPayload.data.rates.lowConfidenceRate || 0),
            reviewerEditRate: Number(metricPayload.data.rates.reviewerEditRate || 0),
            reviewPassRate: Number(metricPayload.data.rates.reviewPassRate || 0),
          });
        }
      } catch {
        setMetricsSummary(null);
      }

      try {
        const rankingParams = new URLSearchParams({
          workspaceId,
          status: 'UNRESOLVED',
        });
        const rankingRes = await fetch(
          `/api/v2/rankings/review/summary?${rankingParams.toString()}`,
          {
            headers: { 'x-access-token': accessToken },
          }
        );
        const rankingPayload = await rankingRes.json();
        if (rankingRes.ok && rankingPayload?.data) {
          setRankingQueueSummary(rankingPayload.data as RankingQueueSummary);
        } else {
          setRankingQueueSummary(null);
        }
      } catch {
        setRankingQueueSummary(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load review queue.');
    } finally {
      setLoading(false);
    }
  }, [workspaceId, accessToken, severity, statusFilter, workspaceReady, sessionLoading]);

  useEffect(() => {
    if (workspaceReady) {
      void loadQueue();
    }
  }, [workspaceReady, loadQueue]);

  useEffect(() => {
    if (!workspaceReady) {
      setProfiles([]);
      return;
    }

    let cancelled = false;
    const run = async () => {
      try {
        const params = new URLSearchParams({ workspaceId });
        const res = await fetch(`/api/v2/ocr/profiles?${params.toString()}`, {
          headers: { 'x-access-token': accessToken },
        });
        const payload = await res.json();
        if (!res.ok) return;
        if (!cancelled) {
          setProfiles(Array.isArray(payload?.data) ? payload.data : []);
        }
      } catch {
        if (!cancelled) setProfiles([]);
      }
    };

    run();

    return () => {
      cancelled = true;
    };
  }, [workspaceId, accessToken, workspaceReady]);

  const summary = useMemo(() => {
    const high = items.filter((item) => item.severity.level === 'HIGH').length;
    const medium = items.filter((item) => item.severity.level === 'MEDIUM').length;
    const low = items.filter((item) => item.severity.level === 'LOW').length;
    return { high, medium, low, total: items.length };
  }, [items]);

  const rankingByType = useMemo(() => {
    const counts = new Map<string, number>();
    for (const entry of rankingQueueSummary?.byType || []) {
      counts.set(`${entry.rankingType}::${entry.metricKey}`, entry.count);
    }
    return counts;
  }, [rankingQueueSummary]);

  const updateDraft = (id: string, key: keyof typeof defaultDraft, value: string) => {
    setDrafts((prev) => ({
      ...prev,
      [id]: {
        ...(prev[id] || defaultDraft),
        [key]: value,
      },
    }));
  };

  const requestReviewUpdate = useCallback(
    async (id: string, status: ExtractionStatus) => {
      if (!workspaceId || !accessToken) return;
      const draft = drafts[id] || defaultDraft;
      const res = await fetch(`/api/v2/review-queue/${id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'x-access-token': accessToken,
        },
        body: JSON.stringify({
          status,
          corrected: draft,
          rerun: rerunPayloadByItem[id] || undefined,
          reason:
            status === 'APPROVED'
              ? 'Approved from human review queue'
              : status === 'REJECTED'
                ? 'Rejected in review queue'
                : 'Reviewed and pending final approval',
        }),
      });

      const payload = await res.json();
      if (!res.ok) {
        throw new Error(payload?.error?.message || 'Failed to update review status.');
      }
    },
    [workspaceId, accessToken, drafts, rerunPayloadByItem]
  );

  const rerunOcr = async (item: QueueItem) => {
    if (!workspaceId || !accessToken) return;
    if (!item.artifact?.url) {
      setError('Cannot rerun OCR because screenshot artifact is missing.');
      return;
    }

    const profileId = rerunProfileByItem[item.id] || undefined;
    setActionBusy(`${item.id}:rerun`);
    setError(null);

    try {
      const imageRes = await fetch(item.artifact.url);
      if (!imageRes.ok) throw new Error('Failed to download screenshot artifact for rerun.');

      const blob = await imageRes.blob();
      const ext = blob.type.includes('png') ? 'png' : blob.type.includes('webp') ? 'webp' : 'jpg';
      const file = new File([blob], `rerun-${item.id}.${ext}`, { type: blob.type || 'image/png' });

      const { processScreenshot } = await import('@/lib/ocr/ocr-engine');
      const result = await processScreenshot(file, {
        profiles: profiles.length > 0 ? profiles : undefined,
        preferredProfileId: profileId,
      });

      const nextDraft = {
        governorId: result.governorId.value,
        governorName: result.governorName.value,
        power: result.power.value,
        killPoints: result.killPoints.value,
        t4Kills: result.t4Kills.value,
        t5Kills: result.t5Kills.value,
        deads: result.deads.value,
      };

      setDrafts((prev) => ({
        ...prev,
        [item.id]: nextDraft,
      }));

      const diagnosticsRes = await fetch('/api/v2/ocr/run', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-access-token': accessToken,
        },
        body: JSON.stringify({
          workspaceId,
          preferredProfileId: profileId || null,
          extraction: result,
        }),
      });

      const diagnosticsPayload = await diagnosticsRes.json();
      const rerunPayload = {
        profileId: result.profileId,
        engineVersion: result.engineVersion,
        normalized: nextDraft,
        preprocessingTrace: result.preprocessingTrace,
        candidates: result.candidates,
        fusionDecision: result.fusionDecision,
        failureReasons: diagnosticsPayload?.data?.failureReasons || result.failureReasons || [],
        lowConfidence: diagnosticsPayload?.data?.lowConfidence ?? result.lowConfidence ?? false,
      };

      setRerunPayloadByItem((prev) => ({
        ...prev,
        [item.id]: rerunPayload,
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to rerun OCR.');
    } finally {
      setActionBusy(null);
    }
  };

  const submitReview = async (id: string, status: ExtractionStatus) => {
    if (!workspaceId || !accessToken) return;

    setActionBusy(id + status);
    setError(null);
    setActionNotice(null);

    try {
      await requestReviewUpdate(id, status);
      await loadQueue();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update review status.');
    } finally {
      setActionBusy(null);
    }
  };

  const submitReviewBulk = useCallback(
    async (status: ExtractionStatus) => {
      if (!workspaceId || !accessToken || items.length === 0) return;

      const verb = status === 'APPROVED' ? 'approve' : status === 'REJECTED' ? 'reject' : 'update';
      const confirmed = window.confirm(
        `This will ${verb} ${items.length} visible row${items.length === 1 ? '' : 's'}. Continue?`
      );
      if (!confirmed) return;

      setActionBusy(`bulk:${status}`);
      setError(null);
      setActionNotice(null);

      let successCount = 0;
      const failures: string[] = [];

      for (const item of items) {
        try {
          await requestReviewUpdate(item.id, status);
          successCount += 1;
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Unknown error';
          const label = item.values.governorName.value || item.id.slice(-6);
          failures.push(`${label}: ${message}`);
        }
      }

      await loadQueue();

      if (failures.length > 0) {
        setError(
          `Bulk ${verb} finished: ${successCount} succeeded, ${failures.length} failed. ${failures[0]}`
        );
      } else {
        setActionNotice(
          `Bulk ${verb} completed for ${successCount} row${successCount === 1 ? '' : 's'}.`
        );
      }

      setActionBusy(null);
    },
    [workspaceId, accessToken, items, requestReviewUpdate, loadQueue]
  );

  const saveGoldenFixture = async (item: QueueItem) => {
    if (!workspaceId || !accessToken) return;
    if (!item.artifact?.id) {
      setError('Cannot save golden fixture without screenshot artifact.');
      return;
    }

    setActionBusy(`${item.id}:fixture`);
    setError(null);

    try {
      const draft = drafts[item.id] || defaultDraft;
      const res = await fetch('/api/v2/ocr/golden-fixtures', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-access-token': accessToken,
        },
        body: JSON.stringify({
          workspaceId,
          artifactId: item.artifact.id,
          profileId: rerunProfileByItem[item.id] || item.profileId || null,
          label: `${draft.governorName || 'Governor'} • ${item.id.slice(-6)}`,
          expected: draft,
          metadata: {
            source: 'review-queue',
            extractionId: item.id,
            scanJobId: item.scanJobId,
          },
        }),
      });

      const payload = await res.json();
      if (!res.ok) {
        throw new Error(payload?.error?.message || 'Failed to save golden fixture.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save golden fixture.');
    } finally {
      setActionBusy(null);
    }
  };

  return (
    <div className="page-container">
      <PageHero
        title="OCR Review Queue"
        subtitle="Review and approve governor profile OCR rows."
      />

      {!workspaceReady ? (
        <div className="card mb-24">
          <div className="text-sm text-muted">{sessionLoading ? 'Connecting workspace...' : sessionError || 'Workspace session is not ready yet.'}</div>
        </div>
      ) : null}

      <FilterBar className="mb-24">
        <div className="form-group" style={{ marginBottom: 0, minWidth: 160 }}>
          <label className="form-label">Severity</label>
          <select className="form-select" value={severity} onChange={(e) => setSeverity(e.target.value as '' | Severity)}>
            <option value="">All</option>
            <option value="HIGH">High</option>
            <option value="MEDIUM">Medium</option>
            <option value="LOW">Low</option>
          </select>
        </div>
        <div className="form-group" style={{ marginBottom: 0, minWidth: 180 }}>
          <label className="form-label">Status</label>
          <select className="form-select" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            {STATUS_PRESETS.map((preset) => (
              <option key={preset.value} value={preset.value}>
                {preset.label}
              </option>
            ))}
          </select>
        </div>
        <button className="btn btn-primary" onClick={loadQueue} disabled={loading}>
          {loading ? 'Loading...' : 'Apply'}
        </button>
        <button
          className="btn btn-secondary"
          onClick={() => submitReviewBulk('APPROVED')}
          disabled={loading || Boolean(actionBusy) || items.length === 0}
        >
          <ShieldCheck size={14} /> {actionBusy === 'bulk:APPROVED' ? 'Approving...' : 'Accept All'}
        </button>
        <button
          className="btn btn-danger"
          onClick={() => submitReviewBulk('REJECTED')}
          disabled={loading || Boolean(actionBusy) || items.length === 0}
        >
          <XCircle size={14} /> {actionBusy === 'bulk:REJECTED' ? 'Rejecting...' : 'Reject All'}
        </button>
      </FilterBar>

      {error ? <div className="delta-negative mb-16">{error}</div> : null}
      {actionNotice ? <div className="text-sm text-muted mb-16">{actionNotice}</div> : null}

      <div className="grid-4 mb-24">
        <KpiCard label="Queue Total" value={summary.total} hint="Rows in current queue filter" tone="info" />
        <KpiCard label="High Severity" value={summary.high} hint="Likely correction needed" tone="bad" />
        <KpiCard label="Medium Severity" value={summary.medium} hint="Validate before approve" tone="warn" />
        <KpiCard label="Low Severity" value={summary.low} hint="Usually ready" tone="good" />
      </div>

      {metricsSummary ? (
        <div className="grid-3 mb-24">
          <KpiCard
            label="Low-Confidence Rate"
            value={`${Math.round(metricsSummary.lowConfidenceRate * 100)}%`}
            hint="Last 30 days"
            tone="warn"
          />
          <KpiCard
            label="Reviewer Edit Rate"
            value={`${Math.round(metricsSummary.reviewerEditRate * 100)}%`}
            hint="Field corrections"
            tone="info"
          />
          <KpiCard
            label="Review Pass Rate"
            value={`${Math.round(metricsSummary.reviewPassRate * 100)}%`}
            hint="Approved without reject"
            tone="good"
          />
        </div>
      ) : null}

      <Panel
        title="Post-Upload Routing"
        subtitle="Profiles are reviewed here. Ranking screenshots go to Ranking Review."
        className="mb-24"
      >
        <div className="review-candidate-row">
          <StatusPill label={`Governor Profile: ${summary.total}`} tone={summary.total > 0 ? 'warn' : 'good'} />
          {SUPPORTED_RANKING_BOARDS.map((board) => {
            const count = rankingByType.get(`${board.rankingType}::${board.metricKey}`) || 0;
            return (
              <StatusPill
                key={`${board.rankingType}:${board.metricKey}`}
                label={`${getRankingTypeDisplayName(board.rankingType)}: ${count}`}
                tone={count > 0 ? 'warn' : 'good'}
              />
            );
          })}
        </div>
        <div className="mt-12 text-sm text-muted">
          Pending ranking rows: {rankingQueueSummary?.total?.toLocaleString() || 0}
        </div>
        <div className="mt-12">
          <a className="btn btn-secondary btn-sm" href="/rankings/review">
            Open Ranking Review
          </a>
        </div>
      </Panel>

      <Panel title="Review Board">
        {loading ? (
          <SkeletonSet rows={4} />
        ) : items.length === 0 ? (
          <EmptyState title="No entries in queue" description="Try broadening filters." />
        ) : (
          <div className="ocr-review-stack">
            {items.map((item) => {
              const draft = drafts[item.id] || defaultDraft;

              return (
                <article key={item.id} className="ocr-review">
                  <header className="ocr-review-header">
                    <div>
                      <div className="flex items-center gap-8" style={{ flexWrap: 'wrap' }}>
                        <strong>{item.values.governorName.value || 'Unknown Governor'}</strong>
                        <StatusPill label="Governor Profile" tone="info" />
                        <StatusPill label={item.severity.level} tone={statusTone(item.severity.level)} />
                        <StatusPill label={item.status} tone="info" />
                        {item.lowConfidence ? <StatusPill label="Low Confidence" tone="warn" /> : null}
                      </div>
                      <div className="text-sm text-muted mt-4">
                        ID {item.values.governorId.value || '—'} • {item.engineVersion || item.provider} •{' '}
                        {new Date(item.createdAt).toLocaleString()} • Overall {formatFieldConfidence(item.confidence)}
                        {item.scanSource ? ` • ${item.scanSource}` : ''}
                      </div>
                    </div>
                  </header>

                  {item.artifact?.url ? (
                    <div style={{ padding: '12px 14px 0' }}>
                      <a href={item.artifact.url} target="_blank" rel="noreferrer" className="text-sm">
                        <ImageIcon size={14} style={{ verticalAlign: 'middle', marginRight: 6 }} />
                        Open screenshot
                      </a>
                      <div className="mt-8">
                        <img
                          src={item.artifact.url}
                          alt={`Profile screenshot for ${item.values.governorName.value || 'governor'}`}
                          loading="lazy"
                          style={{
                            width: '100%',
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
                    {FIELD_ORDER.map((fieldKey) => {
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
                          <label className="ocr-field-label">{FIELD_LABELS[fieldKey]}</label>
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
                              onChange={(e) => updateDraft(item.id, fieldKey, e.target.value)}
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
                                  onClick={() => updateDraft(item.id, fieldKey, candidate.value)}
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
                      value={rerunProfileByItem[item.id] || ''}
                      onChange={(e) =>
                        setRerunProfileByItem((prev) => ({
                          ...prev,
                          [item.id]: e.target.value,
                        }))
                      }
                      style={{ minWidth: 220 }}
                    >
                      <option value="">Auto-select profile</option>
                      {profiles.map((profile) => (
                        <option key={profile.id} value={profile.id}>
                          {profile.name} ({profile.profileKey} v{profile.version})
                        </option>
                      ))}
                    </select>

                    <button className="btn btn-secondary btn-sm" disabled={Boolean(actionBusy)} onClick={() => rerunOcr(item)}>
                      <RefreshCw size={14} /> {actionBusy === `${item.id}:rerun` ? 'Re-running...' : 'Re-run OCR'}
                    </button>
                    <button className="btn btn-secondary btn-sm" disabled={Boolean(actionBusy)} onClick={() => saveGoldenFixture(item)}>
                      <Save size={14} /> {actionBusy === `${item.id}:fixture` ? 'Saving...' : 'Save Golden'}
                    </button>
                    <button className="btn btn-secondary btn-sm" disabled={Boolean(actionBusy)} onClick={() => submitReview(item.id, 'REVIEWED')}>
                      <CheckCircle2 size={14} /> {actionBusy === item.id + 'REVIEWED' ? 'Saving...' : 'Mark Reviewed'}
                    </button>
                    <button className="btn btn-primary btn-sm" disabled={Boolean(actionBusy)} onClick={() => submitReview(item.id, 'APPROVED')}>
                      <ShieldCheck size={14} /> {actionBusy === item.id + 'APPROVED' ? 'Approving...' : 'Approve'}
                    </button>
                    <button className="btn btn-danger btn-sm" disabled={Boolean(actionBusy)} onClick={() => submitReview(item.id, 'REJECTED')}>
                      <XCircle size={14} /> {actionBusy === item.id + 'REJECTED' ? 'Rejecting...' : 'Reject'}
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
            })}
          </div>
        )}
      </Panel>
    </div>
  );
}
