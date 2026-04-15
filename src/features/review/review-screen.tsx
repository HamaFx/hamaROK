'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import React from 'react';
import { ShieldCheck, XCircle } from 'lucide-react';
import type { OcrRuntimeProfile } from '@/lib/ocr/profiles';
import { useWorkspaceSession } from '@/lib/workspace-session';
import { getRankingTypeDisplayName, SUPPORTED_RANKING_BOARDS } from '@/lib/rankings/board-types';
import { ReviewItemCard } from './review-item-card';
import {
  type ExtractionStatus,
  type QueueItem,
  type RankingQueueSummary,
  type ReviewDraft,
  type ReviewUpdateResult,
  type Severity,
  REVIEW_STATUS_PRESETS,
  buildCorrectedPayload,
  defaultReviewDraft,
} from './review-model';
import {
  EmptyState,
  FilterBar,
  KpiCard,
  PageHero,
  Panel,
  SkeletonSet,
  StatusPill,
} from '@/components/ui/primitives';

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
  const [drafts, setDrafts] = useState<Record<string, ReviewDraft>>({});
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

      const nextDrafts: Record<string, ReviewDraft> = {};
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

  const updateDraft = (id: string, key: keyof ReviewDraft, value: string) => {
    setDrafts((prev) => ({
      ...prev,
      [id]: {
        ...(prev[id] || defaultReviewDraft),
        [key]: value,
      },
    }));
  };

  const requestReviewUpdate = useCallback(
    async (id: string, status: ExtractionStatus): Promise<ReviewUpdateResult> => {
      if (!workspaceId || !accessToken) return {};
      const draft = drafts[id] || defaultReviewDraft;
      const corrected = buildCorrectedPayload(draft);
      const res = await fetch(`/api/v2/review-queue/${id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'x-access-token': accessToken,
        },
        body: JSON.stringify({
          status,
          corrected,
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

      return (payload?.data || {}) as ReviewUpdateResult;
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
      const result = await requestReviewUpdate(id, status);
      await loadQueue();
      if (result?.syncMessage) {
        setActionNotice(result.syncMessage);
      } else if (result?.warning) {
        setActionNotice(result.warning);
      }
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
      let warningCount = 0;

      for (const item of items) {
        try {
          const result = await requestReviewUpdate(item.id, status);
          if (result?.syncState === 'PENDING_WEEK_LINK' || result?.warning) warningCount += 1;
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
        const warningNote =
          warningCount > 0
            ? ` ${warningCount} row${warningCount === 1 ? '' : 's'} pending week-link sync.`
            : '';
        setActionNotice(`Bulk ${verb} completed for ${successCount} row${successCount === 1 ? '' : 's'}.${warningNote}`);
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
      const draft = drafts[item.id] || defaultReviewDraft;
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

      <FilterBar className="mb-24 items-stretch sm:items-end">
        <div className="form-group w-full sm:w-auto" style={{ marginBottom: 0, minWidth: 160 }}>
          <label className="form-label">Severity</label>
          <select className="form-select" value={severity} onChange={(e) => setSeverity(e.target.value as '' | Severity)}>
            <option value="">All</option>
            <option value="HIGH">High</option>
            <option value="MEDIUM">Medium</option>
            <option value="LOW">Low</option>
          </select>
        </div>
        <div className="form-group w-full sm:w-auto" style={{ marginBottom: 0, minWidth: 180 }}>
          <label className="form-label">Status</label>
          <select className="form-select" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            {REVIEW_STATUS_PRESETS.map((preset) => (
              <option key={preset.value} value={preset.value}>
                {preset.label}
              </option>
            ))}
          </select>
        </div>
        <button className="btn btn-primary w-full sm:w-auto" onClick={loadQueue} disabled={loading}>
          {loading ? 'Loading...' : 'Apply'}
        </button>
        <button
          className="btn btn-secondary w-full sm:w-auto"
          onClick={() => submitReviewBulk('APPROVED')}
          disabled={loading || Boolean(actionBusy) || items.length === 0}
        >
          <ShieldCheck size={14} /> {actionBusy === 'bulk:APPROVED' ? 'Approving...' : 'Accept All'}
        </button>
        <button
          className="btn btn-danger w-full sm:w-auto"
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
              const draft = drafts[item.id] || defaultReviewDraft;

              return (
                <ReviewItemCard
                  key={item.id}
                  item={item}
                  draft={draft}
                  actionBusy={actionBusy}
                  profiles={profiles}
                  rerunProfileId={rerunProfileByItem[item.id] || ''}
                  onRerunProfileChange={(value) =>
                    setRerunProfileByItem((prev) => ({
                      ...prev,
                      [item.id]: value,
                    }))
                  }
                  onUpdateDraft={(field, value) => updateDraft(item.id, field, value)}
                  onRerun={() => rerunOcr(item)}
                  onSaveGolden={() => saveGoldenFixture(item)}
                  onSubmit={(status) => submitReview(item.id, status)}
                />
              );
            })}
          </div>
        )}
      </Panel>
    </div>
  );
}
