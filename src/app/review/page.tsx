'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import React from 'react';
import type { OcrRuntimeProfile } from '@/lib/ocr/profiles';

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

const defaultDraft = {
  governorId: '',
  governorName: '',
  power: '',
  killPoints: '',
  t4Kills: '',
  t5Kills: '',
  deads: '',
};

function severityClass(level: Severity) {
  if (level === 'HIGH') return 'delta-negative';
  if (level === 'MEDIUM') return 'text-gold';
  return 'text-muted';
}

export default function ReviewQueuePage() {
  const [workspaceId, setWorkspaceId] = useState('');
  const [accessToken, setAccessToken] = useState('');
  const [items, setItems] = useState<QueueItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [severity, setSeverity] = useState<'' | Severity>('');
  const [statusFilter, setStatusFilter] = useState('RAW,REVIEWED');
  const [drafts, setDrafts] = useState<Record<string, typeof defaultDraft>>({});
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [profiles, setProfiles] = useState<OcrRuntimeProfile[]>([]);
  const [rerunProfileByItem, setRerunProfileByItem] = useState<Record<string, string>>({});
  const [rerunPayloadByItem, setRerunPayloadByItem] = useState<Record<string, unknown>>({});
  const [metricsSummary, setMetricsSummary] = useState<{
    lowConfidenceRate: number;
    reviewerEditRate: number;
    reviewPassRate: number;
  } | null>(null);

  useEffect(() => {
    const url = new URL(window.location.href);
    const fromQueryWorkspace = url.searchParams.get('workspaceId') || '';
    const fromQueryToken =
      url.searchParams.get('accessToken') ||
      url.searchParams.get('token') ||
      '';

    const savedWorkspace = localStorage.getItem('workspaceId') || '';
    const savedToken = localStorage.getItem('workspaceToken') || '';

    setWorkspaceId(fromQueryWorkspace || savedWorkspace);
    setAccessToken(fromQueryToken || savedToken);
  }, []);

  useEffect(() => {
    if (workspaceId) localStorage.setItem('workspaceId', workspaceId);
  }, [workspaceId]);

  useEffect(() => {
    if (accessToken) localStorage.setItem('workspaceToken', accessToken);
  }, [accessToken]);

  const loadQueue = useCallback(async () => {
    if (!workspaceId || !accessToken) {
      setError('Workspace ID and access token are required.');
      return;
    }

    setError(null);
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
        headers: {
          'x-access-token': accessToken,
        },
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
          headers: {
            'x-access-token': accessToken,
          },
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
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load review queue.');
    } finally {
      setLoading(false);
    }
  }, [workspaceId, accessToken, severity, statusFilter]);

  useEffect(() => {
    if (workspaceId && accessToken) {
      loadQueue();
    }
  }, [workspaceId, accessToken, loadQueue]);

  useEffect(() => {
    if (!workspaceId || !accessToken) {
      setProfiles([]);
      return;
    }
    let cancelled = false;
    const run = async () => {
      try {
        const params = new URLSearchParams({ workspaceId });
        const res = await fetch(`/api/v2/ocr/profiles?${params.toString()}`, {
          headers: {
            'x-access-token': accessToken,
          },
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
  }, [workspaceId, accessToken]);

  const summary = useMemo(() => {
    const high = items.filter((i) => i.severity.level === 'HIGH').length;
    const medium = items.filter((i) => i.severity.level === 'MEDIUM').length;
    const low = items.filter((i) => i.severity.level === 'LOW').length;
    return { high, medium, low, total: items.length };
  }, [items]);

  const updateDraft = (id: string, key: keyof typeof defaultDraft, value: string) => {
    setDrafts((prev) => ({
      ...prev,
      [id]: {
        ...(prev[id] || defaultDraft),
        [key]: value,
      },
    }));
  };

  const rerunOcr = async (item: QueueItem) => {
    if (!workspaceId || !accessToken) return;
    if (!item.artifact?.url) {
      setError('Cannot rerun OCR because screenshot artifact is missing.');
      return;
    }

    const profileId = rerunProfileByItem[item.id] || undefined;
    setActionBusy(item.id + ':rerun');
    setError(null);

    try {
      const imageRes = await fetch(item.artifact.url);
      if (!imageRes.ok) {
        throw new Error('Failed to download screenshot artifact for rerun.');
      }
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
        failureReasons:
          diagnosticsPayload?.data?.failureReasons || result.failureReasons || [],
        lowConfidence:
          diagnosticsPayload?.data?.lowConfidence ?? result.lowConfidence ?? false,
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

    try {
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
      await loadQueue();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update review status.');
    } finally {
      setActionBusy(null);
    }
  };

  const saveGoldenFixture = async (item: QueueItem) => {
    if (!workspaceId || !accessToken) return;
    if (!item.artifact?.id) {
      setError('Cannot save golden fixture without screenshot artifact.');
      return;
    }
    setActionBusy(item.id + ':fixture');
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
      <div className="page-header">
        <h1>🧪 OCR Review Queue</h1>
        <p>Triage low-confidence OCR entries, compare against previous values, then approve or reject.</p>
      </div>

      <div className="card card-no-hover mb-24">
        <h3 className="mb-16">Workspace Access</h3>
        <div className="grid-2">
          <div className="form-group">
            <label className="form-label">Workspace ID</label>
            <input
              className="form-input"
              value={workspaceId}
              onChange={(e) => setWorkspaceId(e.target.value)}
              placeholder="workspace_cuid"
            />
          </div>
          <div className="form-group">
            <label className="form-label">Access Token</label>
            <input
              className="form-input"
              value={accessToken}
              onChange={(e) => setAccessToken(e.target.value)}
              placeholder="paste editor/viewer link token"
            />
          </div>
        </div>

        <div className="flex gap-12 items-end" style={{ flexWrap: 'wrap' }}>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label">Severity</label>
            <select
              className="form-select"
              value={severity}
              onChange={(e) => setSeverity(e.target.value as '' | Severity)}
            >
              <option value="">All</option>
              <option value="HIGH">High</option>
              <option value="MEDIUM">Medium</option>
              <option value="LOW">Low</option>
            </select>
          </div>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label">Statuses</label>
            <select
              className="form-select"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <option value="RAW,REVIEWED">Pending (RAW + REVIEWED)</option>
              <option value="RAW">RAW only</option>
              <option value="REVIEWED">REVIEWED only</option>
              <option value="APPROVED">APPROVED</option>
              <option value="REJECTED">REJECTED</option>
            </select>
          </div>

          <button className="btn btn-primary" onClick={loadQueue} disabled={loading}>
            {loading ? 'Loading...' : 'Refresh Queue'}
          </button>
        </div>

        <div className="mt-16 text-sm text-muted">
          Queue summary: {summary.total} total • {summary.high} high • {summary.medium} medium • {summary.low} low
        </div>
        {metricsSummary && (
          <div className="mt-8 text-sm text-muted">
            OCR quality (30d): pass {Math.round(metricsSummary.reviewPassRate * 100)}% • low-confidence{' '}
            {Math.round(metricsSummary.lowConfidenceRate * 100)}% • reviewer edits{' '}
            {Math.round(metricsSummary.reviewerEditRate * 100)}%
          </div>
        )}

        {error && <div className="mt-16 delta-negative">{error}</div>}
      </div>

      {items.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">✅</div>
          <h3>No entries in queue</h3>
          <p>Try changing filters or refresh after new scan jobs are uploaded.</p>
        </div>
      ) : (
        <div className="flex" style={{ flexDirection: 'column', gap: 16 }}>
          {items.map((item) => {
            const draft = drafts[item.id] || defaultDraft;
            return (
              <div key={item.id} className="ocr-review">
                <div className="ocr-review-header">
                  <div className="flex items-center gap-12" style={{ flexWrap: 'wrap' }}>
                    <strong>{item.values.governorName.value || 'Unknown Governor'}</strong>
                    <span className="text-muted text-sm">ID: {item.values.governorId.value || '—'}</span>
                    <span className={`text-sm ${severityClass(item.severity.level)}`}>
                      {item.severity.level}
                    </span>
                    {item.profile ? (
                      <span className="text-muted text-sm">
                        Profile: {item.profile.name} v{item.profile.version}
                      </span>
                    ) : item.profileId ? (
                      <span className="text-muted text-sm">Profile: {item.profileId}</span>
                    ) : null}
                    {item.engineVersion ? (
                      <span className="text-muted text-sm">{item.engineVersion}</span>
                    ) : null}
                    <span className="text-muted text-sm">Status: {item.status}</span>
                    <span className="text-muted text-sm">Confidence: {Math.round(item.confidence * (item.confidence <= 1 ? 100 : 1))}%</span>
                    <span className="text-muted text-sm">Created: {new Date(item.createdAt).toLocaleString()}</span>
                  </div>
                </div>

                <div className="ocr-review-body" style={{ gridTemplateColumns: '180px 1fr 1fr 80px' }}>
                  {Object.entries(draft).map(([field, value]) => {
                    const source = item.values[field as keyof QueueItem['values']];
                    return (
                      <React.Fragment key={`${item.id}-${field}`}>
                        <label className="ocr-field-label" key={`${item.id}-${field}-label`}>
                          {field}
                        </label>
                        <div className="ocr-field-value" key={`${item.id}-${field}-current`}>
                          <input
                            className="ocr-field-input"
                            value={value}
                            onChange={(e) =>
                              updateDraft(item.id, field as keyof typeof defaultDraft, e.target.value)
                            }
                          />
                        </div>
                        <div className="text-muted text-sm" key={`${item.id}-${field}-previous`}>
                          Prev: {source?.previousValue ?? '—'}
                          {source?.changed ? <span className="delta-negative"> (changed)</span> : null}
                          {source?.croppedImage ? (
                            <>
                              {' '}
                              <a href={source.croppedImage} target="_blank" rel="noreferrer">
                                crop
                              </a>
                            </>
                          ) : null}
                          {Array.isArray(source?.candidates) && source.candidates.length > 0 ? (
                            <div>
                              Alt:{' '}
                              {source.candidates
                                .slice(0, 2)
                                .map((candidate) =>
                                  candidate?.normalizedValue
                                    ? `${candidate.normalizedValue} (${Math.round(
                                        Number(candidate.confidence || 0)
                                      )}%)`
                                    : null
                                )
                                .filter(Boolean)
                                .join(' • ') || '—'}
                            </div>
                          ) : null}
                        </div>
                        <div className="text-muted text-sm" key={`${item.id}-${field}-confidence`}>
                          {Math.round(source?.confidence ?? 0)}%
                        </div>
                      </React.Fragment>
                    );
                  })}
                </div>

                {item.severity.reasons.length > 0 && (
                  <div style={{ padding: '0 20px 12px' }}>
                    {item.severity.reasons.map((reason, idx) => (
                      <div key={`${item.id}-reason-${idx}`} className="text-sm text-muted">
                        • {reason}
                      </div>
                    ))}
                  </div>
                )}

                {item.failureReasons && item.failureReasons.length > 0 && (
                  <div style={{ padding: '0 20px 12px' }}>
                    {item.failureReasons.slice(0, 5).map((reason, idx) => (
                      <div key={`${item.id}-failure-${idx}`} className="text-sm text-muted">
                        • {reason}
                      </div>
                    ))}
                  </div>
                )}

                {item.validation.filter((v) => v.severity !== 'ok').length > 0 && (
                  <div style={{ padding: '0 20px 12px' }}>
                    {item.validation
                      .filter((v) => v.severity !== 'ok')
                      .map((entry, idx) => (
                        <div
                          key={`${item.id}-val-${idx}`}
                          className={`text-sm ${entry.severity === 'error' ? 'delta-negative' : 'text-gold'}`}
                        >
                          {entry.severity === 'error' ? '❌' : '⚠️'} {entry.field}: {entry.warning || 'Check value'}
                        </div>
                      ))}
                  </div>
                )}

                <div className="flex gap-8" style={{ padding: '0 20px 18px' }}>
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
                  <button
                    className="btn btn-secondary btn-sm"
                    disabled={Boolean(actionBusy)}
                    onClick={() => rerunOcr(item)}
                  >
                    {actionBusy === item.id + ':rerun' ? 'Re-running...' : 'Re-run OCR'}
                  </button>
                  <button
                    className="btn btn-secondary btn-sm"
                    disabled={Boolean(actionBusy)}
                    onClick={() => saveGoldenFixture(item)}
                  >
                    {actionBusy === item.id + ':fixture' ? 'Saving...' : 'Save Golden'}
                  </button>
                  <button
                    className="btn btn-secondary btn-sm"
                    disabled={Boolean(actionBusy)}
                    onClick={() => submitReview(item.id, 'REVIEWED')}
                  >
                    {actionBusy === item.id + 'REVIEWED' ? 'Saving...' : 'Mark Reviewed'}
                  </button>
                  <button
                    className="btn btn-primary btn-sm"
                    disabled={Boolean(actionBusy)}
                    onClick={() => submitReview(item.id, 'APPROVED')}
                  >
                    {actionBusy === item.id + 'APPROVED' ? 'Approving...' : 'Approve'}
                  </button>
                  <button
                    className="btn btn-danger btn-sm"
                    disabled={Boolean(actionBusy)}
                    onClick={() => submitReview(item.id, 'REJECTED')}
                  >
                    {actionBusy === item.id + 'REJECTED' ? 'Rejecting...' : 'Reject'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
