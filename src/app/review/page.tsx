'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import React from 'react';

type Severity = 'HIGH' | 'MEDIUM' | 'LOW';
type ExtractionStatus = 'RAW' | 'REVIEWED' | 'APPROVED' | 'REJECTED';

interface QueueField {
  value: string;
  confidence: number;
  previousValue?: string | null;
  changed?: boolean;
  croppedImage?: string;
}

interface QueueItem {
  id: string;
  scanJobId: string;
  eventId: string | null;
  provider: string;
  status: ExtractionStatus;
  confidence: number;
  severity: { level: Severity; reasons: string[] };
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
      }
      setDrafts(nextDrafts);
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
