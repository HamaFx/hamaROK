'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { OcrRuntimeProfile } from '@/lib/ocr/profiles';
import { useWorkspaceSession } from '@/lib/workspace-session';
import {
  SUPPORTED_RANKING_BOARDS,
} from '@/lib/rankings/board-types';
import { RankingReviewItemCard } from './ranking-review-item-card';
import {
  type RankingReviewDraft,
  type RankingReviewSummary,
  type RerunHint,
  type ReviewAction,
  type ReviewRow,
  METRIC_FILTERS,
  RANKING_REVIEW_STATUS_OPTIONS,
  RANKING_TYPE_FILTERS,
  defaultRankingReviewDraft,
  pickBestRerunRowMatch,
} from './ranking-review-model';
import {
  EmptyState,
  FilterBar,
  KpiCard,
  PageHero,
  Panel,
  SkeletonSet,
  StatusPill,
} from '@/components/ui/primitives';

export default function RankingReviewPage() {
  const {
    workspaceId,
    accessToken,
    ready: workspaceReady,
    loading: sessionLoading,
    error: sessionError,
  } = useWorkspaceSession();

  const [statusFilter, setStatusFilter] = useState('UNRESOLVED');
  const [rankingTypeFilter, setRankingTypeFilter] = useState('');
  const [metricFilter, setMetricFilter] = useState('');
  const [rows, setRows] = useState<ReviewRow[]>([]);
  const [summaryData, setSummaryData] = useState<RankingReviewSummary | null>(null);
  const [drafts, setDrafts] = useState<Record<string, RankingReviewDraft>>({});
  const [profiles, setProfiles] = useState<OcrRuntimeProfile[]>([]);
  const [rerunProfileByRow, setRerunProfileByRow] = useState<Record<string, string>>({});
  const [rerunHints, setRerunHints] = useState<Record<string, RerunHint>>({});
  const [loading, setLoading] = useState(false);
  const [busyRow, setBusyRow] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const rankingProfiles = useMemo(() => {
    const rankboardOnly = profiles.filter((profile) => profile.archetype === 'rankboard');
    return rankboardOnly.length > 0 ? rankboardOnly : profiles;
  }, [profiles]);

  const loadRows = useCallback(async () => {
    if (!workspaceReady) {
      setError(sessionLoading ? 'Connecting workspace session...' : 'Workspace session is not ready.');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams({
        workspaceId,
        status: statusFilter,
        limit: '120',
      });
      if (rankingTypeFilter) params.set('rankingType', rankingTypeFilter);
      if (metricFilter) params.set('metricKey', metricFilter);

      const summaryParams = new URLSearchParams({
        workspaceId,
        status: statusFilter,
      });

      const [rowsRes, summaryRes] = await Promise.all([
        fetch(`/api/v2/rankings/review?${params.toString()}`, {
          headers: { 'x-access-token': accessToken },
        }),
        fetch(`/api/v2/rankings/review/summary?${summaryParams.toString()}`, {
          headers: { 'x-access-token': accessToken },
        }),
      ]);

      const rowsPayload = await rowsRes.json();
      if (!rowsRes.ok) {
        throw new Error(rowsPayload?.error?.message || 'Failed to load ranking review queue.');
      }
      const data = Array.isArray(rowsPayload?.data) ? (rowsPayload.data as ReviewRow[]) : [];
      setRows(data);

      const nextDrafts: Record<string, RankingReviewDraft> = {};
      const nextRerunProfiles: Record<string, string> = {};
      for (const row of data) {
        nextDrafts[row.id] = {
          governorGameId: '',
          aliasRaw: row.governorNameRaw,
          sourceRank: row.sourceRank?.toString() || '',
          governorNameRaw: row.governorNameRaw,
          metricRaw: row.metricRaw,
        };
        nextRerunProfiles[row.id] = '';
      }
      setDrafts(nextDrafts);
      setRerunProfileByRow(nextRerunProfiles);
      setRerunHints({});

      const summaryPayload = await summaryRes.json();
      if (summaryRes.ok && summaryPayload?.data) {
        setSummaryData(summaryPayload.data as RankingReviewSummary);
      } else {
        setSummaryData(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load ranking review queue.');
    } finally {
      setLoading(false);
    }
  }, [
    workspaceId,
    accessToken,
    statusFilter,
    rankingTypeFilter,
    metricFilter,
    workspaceReady,
    sessionLoading,
  ]);

  useEffect(() => {
    if (workspaceReady) {
      void loadRows();
    }
  }, [workspaceReady, loadRows]);

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
    const unresolved = rows.filter((row) => row.identityStatus === 'UNRESOLVED').length;
    const linked = rows.filter(
      (row) => row.identityStatus === 'MANUAL_LINKED' || row.identityStatus === 'AUTO_LINKED'
    ).length;
    const rejected = rows.filter((row) => row.identityStatus === 'REJECTED').length;
    return { unresolved, linked, rejected };
  }, [rows]);

  const summaryByType = useMemo(() => {
    const base = new Map<string, number>();
    for (const entry of summaryData?.byType || []) {
      base.set(`${entry.rankingType}::${entry.metricKey}`, entry.count);
    }
    return base;
  }, [summaryData]);

  const updateDraft = (rowId: string, key: keyof RankingReviewDraft, value: string) => {
    setDrafts((prev) => ({
      ...prev,
      [rowId]: {
        ...(prev[rowId] || defaultRankingReviewDraft),
        [key]: value,
      },
    }));
  };

  const rerunOcr = async (row: ReviewRow) => {
    if (!workspaceReady || !accessToken) return;
    if (!row.run.artifact?.url) {
      setError('Cannot rerun OCR because screenshot artifact is missing for this ranking row.');
      return;
    }

    setBusyRow(`${row.id}:RERUN_OCR`);
    setError(null);

    try {
      const imageRes = await fetch(row.run.artifact.url);
      if (!imageRes.ok) {
        throw new Error('Failed to download ranking screenshot artifact for rerun.');
      }

      const blob = await imageRes.blob();
      const ext = blob.type.includes('png') ? 'png' : blob.type.includes('webp') ? 'webp' : 'jpg';
      const file = new File([blob], `ranking-rerun-${row.id}.${ext}`, {
        type: blob.type || 'image/png',
      });

      const preferredProfileId = rerunProfileByRow[row.id] || undefined;
      const { processRankingScreenshot } = await import('@/lib/ocr/ocr-engine');
      const result = await processRankingScreenshot(file, {
        profiles: rankingProfiles.length > 0 ? rankingProfiles : undefined,
        preferredProfileId,
      });

      const matched = pickBestRerunRowMatch(row, result.rows);
      if (!matched) {
        throw new Error('Re-run OCR completed but no usable ranking rows were detected.');
      }

      setDrafts((prev) => ({
        ...prev,
        [row.id]: {
          ...(prev[row.id] || defaultRankingReviewDraft),
          sourceRank: matched.sourceRank != null ? String(matched.sourceRank) : '',
          governorNameRaw: matched.governorNameRaw || row.governorNameRaw,
          metricRaw: matched.metricRaw || row.metricRaw,
        },
      }));

      const diagnosticsRes = await fetch('/api/v2/ocr/run', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-access-token': accessToken,
        },
        body: JSON.stringify({
          workspaceId,
          preferredProfileId: preferredProfileId || null,
          extraction: result,
        }),
      });

      const diagnosticsPayload = await diagnosticsRes.json();
      const diagnostics = diagnosticsPayload?.data || {};

      setRerunHints((prev) => ({
        ...prev,
        [row.id]: {
          profileId: diagnostics.profileId || result.profileId || null,
          templateId: diagnostics.templateId || result.templateId || null,
          detectedRankingType: diagnostics.rankingType || result.rankingType,
          detectedMetricKey: diagnostics.metricKey || result.metricKey,
          matchedRowIndex: matched.rowIndex,
          matchedSourceRank: matched.sourceRank,
          matchedConfidence: matched.confidence,
          lowConfidence: Boolean(
            diagnostics.lowConfidence ?? result.lowConfidence ?? matched.confidence < 70
          ),
          failureReasons: Array.isArray(diagnostics.failureReasons)
            ? diagnostics.failureReasons.slice(0, 6)
            : [],
        },
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to rerun ranking OCR.');
    } finally {
      setBusyRow(null);
    }
  };

  const runAction = async (row: ReviewRow, action: ReviewAction) => {
    if (!workspaceId || !accessToken) return;

    const draft = drafts[row.id] || defaultRankingReviewDraft;
    setBusyRow(`${row.id}:${action}`);
    setError(null);

    try {
      const body: Record<string, unknown> = {
        workspaceId,
        action,
      };

      if (action === 'LINK_TO_GOVERNOR' || action === 'CREATE_ALIAS') {
        if (!draft.governorGameId.trim()) {
          throw new Error('Governor game ID is required for this action.');
        }
        body.governorGameId = draft.governorGameId.trim();
      }

      if (action === 'CREATE_ALIAS') {
        body.aliasRaw = draft.aliasRaw.trim() || row.governorNameRaw;
      }

      if (action === 'CORRECT_ROW') {
        body.corrected = {
          sourceRank: draft.sourceRank.trim() ? Number(draft.sourceRank) : null,
          governorNameRaw: draft.governorNameRaw.trim(),
          metricRaw: draft.metricRaw.trim(),
          metricValue: draft.metricRaw,
        };
        if (draft.governorGameId.trim()) {
          body.governorGameId = draft.governorGameId.trim();
        }
      }

      const res = await fetch(`/api/v2/rankings/review/${row.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'x-access-token': accessToken,
        },
        body: JSON.stringify(body),
      });

      const payload = await res.json();
      if (!res.ok) {
        throw new Error(payload?.error?.message || 'Failed to apply review action.');
      }

      await loadRows();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to apply review action.');
    } finally {
      setBusyRow(null);
    }
  };

  const runBulkAction = useCallback(
    async (mode: 'accept_linked' | 'reject_all') => {
      if (!workspaceId || !accessToken) return;

      const targets =
        mode === 'accept_linked'
          ? rows.filter(
              (row) =>
                row.identityStatus === 'AUTO_LINKED' ||
                row.identityStatus === 'MANUAL_LINKED'
            )
          : rows.filter((row) => row.identityStatus !== 'REJECTED');

      if (targets.length === 0) return;
      const confirmed = window.confirm(
        mode === 'accept_linked'
          ? `Accept ${targets.length} linked row${targets.length === 1 ? '' : 's'} now?`
          : `Reject ${targets.length} visible row${targets.length === 1 ? '' : 's'} now?`
      );
      if (!confirmed) return;

      setBusyRow(`bulk:${mode}`);
      setError(null);

      let succeeded = 0;
      let failed = 0;

      for (const row of targets) {
        try {
          const action = mode === 'accept_linked' ? 'CORRECT_ROW' : 'REJECT_ROW';
          const body: Record<string, unknown> = {
            workspaceId,
            action,
          };

          if (mode === 'accept_linked') {
            body.corrected = {
              sourceRank: row.sourceRank,
              governorNameRaw: row.governorNameRaw,
              metricRaw: row.metricRaw,
              metricValue: row.metricValue,
            };
          }

          const res = await fetch(`/api/v2/rankings/review/${row.id}`, {
            method: 'PATCH',
            headers: {
              'Content-Type': 'application/json',
              'x-access-token': accessToken,
            },
            body: JSON.stringify(body),
          });
          const payload = await res.json();
          if (!res.ok) {
            throw new Error(payload?.error?.message || 'Bulk action failed.');
          }
          succeeded += 1;
        } catch {
          failed += 1;
        }
      }

      await loadRows();
      if (failed > 0) {
        setError(`Bulk action finished: ${succeeded} succeeded, ${failed} failed.`);
      }
      setBusyRow(null);
    },
    [workspaceId, accessToken, rows, loadRows]
  );

  return (
    <div className="page-container">
      <PageHero
        title="Ranking Review Queue"
        subtitle="Resolve identity matches and corrections for ranking screenshots."
      />

      {!workspaceReady ? (
        <div className="card mb-24">
          <div className="text-sm text-muted">
            {sessionLoading ? 'Connecting workspace...' : sessionError || 'Workspace session is not ready yet.'}
          </div>
        </div>
      ) : null}

      <FilterBar className="mb-24">
        <div className="form-group" style={{ marginBottom: 0, minWidth: 230 }}>
          <label className="form-label">Status Filter</label>
          <select className="form-select" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="UNRESOLVED">Unresolved</option>
            <option value="AUTO_LINKED,MANUAL_LINKED">Linked (Auto + Manual)</option>
            <option value="REJECTED">Rejected</option>
            <option value={RANKING_REVIEW_STATUS_OPTIONS.join(',')}>All</option>
          </select>
        </div>
        <div className="form-group" style={{ marginBottom: 0, minWidth: 220 }}>
          <label className="form-label">Ranking Type</label>
          <select
            className="form-select"
            value={rankingTypeFilter}
            onChange={(e) => setRankingTypeFilter(e.target.value)}
          >
            {RANKING_TYPE_FILTERS.map((option) => (
              <option key={option.value || 'all'} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        <div className="form-group" style={{ marginBottom: 0, minWidth: 220 }}>
          <label className="form-label">Metric Key</label>
          <select className="form-select" value={metricFilter} onChange={(e) => setMetricFilter(e.target.value)}>
            {METRIC_FILTERS.map((option) => (
              <option key={option.value || 'all'} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        <button className="btn btn-primary" onClick={loadRows} disabled={loading}>
          {loading ? 'Loading...' : 'Apply'}
        </button>
        <button
          className="btn btn-secondary"
          onClick={() => runBulkAction('accept_linked')}
          disabled={loading || Boolean(busyRow)}
        >
          {busyRow === 'bulk:accept_linked' ? 'Accepting...' : 'Accept Linked'}
        </button>
        <button
          className="btn btn-danger"
          onClick={() => runBulkAction('reject_all')}
          disabled={loading || Boolean(busyRow)}
        >
          {busyRow === 'bulk:reject_all' ? 'Rejecting...' : 'Reject All'}
        </button>
      </FilterBar>

      {error ? <div className="delta-negative mb-16">{error}</div> : null}

      <div className="grid-4 mb-24">
        <KpiCard label="Rows in View" value={rows.length} hint="Filtered review rows" tone="info" />
        <KpiCard label="Unresolved" value={summary.unresolved} hint="Needs manual identity action" tone="warn" />
        <KpiCard label="Linked" value={summary.linked} hint="Auto/manual links ready" tone="good" />
        <KpiCard label="Rejected" value={summary.rejected} hint="Discarded ranking rows" tone="bad" />
      </div>

      <Panel title="Screenshot Type Coverage" subtitle="Counts by supported ranking screenshot type.">
        <div className="review-candidate-row" style={{ paddingTop: 4 }}>
          {SUPPORTED_RANKING_BOARDS.map((board) => {
            const count = summaryByType.get(`${board.rankingType}::${board.metricKey}`) || 0;
            return (
              <StatusPill
                key={`${board.rankingType}:${board.metricKey}`}
                label={`${board.label}: ${count}`}
                tone={count > 0 ? 'warn' : 'good'}
              />
            );
          })}
        </div>
        {summaryData?.total != null ? (
          <p className="text-sm text-muted mt-8">
            Total rows in selected status set: {summaryData.total.toLocaleString()}.
          </p>
        ) : null}
      </Panel>

      <Panel title="Triage Board">
        {loading ? (
          <SkeletonSet rows={4} />
        ) : rows.length === 0 ? (
          <EmptyState title="Queue is clear" description="No ranking rows in the selected filters." />
        ) : (
          <div className="ocr-review-stack">
            {rows.map((row) => {
              const draft = drafts[row.id] || defaultRankingReviewDraft;

              return (
                <RankingReviewItemCard
                  key={row.id}
                  row={row}
                  draft={draft}
                  rankingProfiles={rankingProfiles}
                  rerunProfileId={rerunProfileByRow[row.id] || ''}
                  rerunHint={rerunHints[row.id] || null}
                  busyRow={busyRow}
                  onUpdateDraft={(field, value) => updateDraft(row.id, field, value)}
                  onRerunProfileChange={(value) =>
                    setRerunProfileByRow((prev) => ({
                      ...prev,
                      [row.id]: value,
                    }))
                  }
                  onRerun={() => rerunOcr(row)}
                  onAction={(action) => runAction(row, action)}
                />
              );
            })}
          </div>
        )}
      </Panel>
    </div>
  );
}
