'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { OcrRuntimeProfile } from '@/lib/ocr/profiles';
import { useWorkspaceSession } from '@/lib/workspace-session';
import { InlineError, SessionGate } from '@/components/app/session-gate';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
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
  CompactControlDrawer,
  CompactControlRow,
  EmptyState,
  KpiCard,
  PageHero,
  Panel,
  SkeletonSet,
  StatusPill,
} from '@/components/ui/primitives';

const ALL_STATUS = '__all_status__';
const ALL_RANKING_TYPE = '__all_ranking_type__';
const ALL_METRIC = '__all_metric__';

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

  const statusSelectValue = useMemo(
    () =>
      statusFilter === RANKING_REVIEW_STATUS_OPTIONS.join(',')
        ? ALL_STATUS
        : statusFilter || ALL_STATUS,
    [statusFilter]
  );

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
      const diagnosticsMetadata =
        diagnostics && typeof diagnostics.metadata === 'object' && diagnostics.metadata
          ? (diagnostics.metadata as Record<string, unknown>)
          : {};
      const hintGuardFailures = Array.isArray(diagnostics.guardFailures)
        ? diagnostics.guardFailures.filter((entry: unknown): entry is string => typeof entry === 'string')
        : Array.isArray(diagnosticsMetadata.guardFailures)
          ? diagnosticsMetadata.guardFailures.filter(
              (entry: unknown): entry is string => typeof entry === 'string'
            )
          : [];
      const hintDetectedTokens = Array.isArray(diagnostics.detectedBoardTokens)
        ? diagnostics.detectedBoardTokens.filter((entry: unknown): entry is string => typeof entry === 'string')
        : Array.isArray(diagnosticsMetadata.detectedBoardTokens)
          ? diagnosticsMetadata.detectedBoardTokens.filter(
              (entry: unknown): entry is string => typeof entry === 'string'
            )
          : [];
      const hintClassificationConfidence =
        typeof diagnosticsMetadata.classificationConfidence === 'number' &&
        Number.isFinite(diagnosticsMetadata.classificationConfidence)
          ? diagnosticsMetadata.classificationConfidence
          : result.metadata?.classificationConfidence ?? null;
      const hintDroppedRowCount =
        typeof diagnosticsMetadata.droppedRowCount === 'number' &&
        Number.isFinite(diagnosticsMetadata.droppedRowCount)
          ? diagnosticsMetadata.droppedRowCount
          : result.metadata?.droppedRowCount ?? null;

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
          classificationConfidence: hintClassificationConfidence,
          droppedRowCount: hintDroppedRowCount,
          guardFailures: hintGuardFailures.slice(0, 8),
          detectedBoardTokens: hintDetectedTokens.slice(0, 8),
        },
      }));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to rerun ranking OCR.';
      const normalized = message.trim().toLowerCase();
      const parsedGuardFailures =
        normalized.includes('ranking-guard-failure:')
          ? normalized
              .split('ranking-guard-failure:')[1]
              ?.split(',')
              .map((entry) => entry.trim())
              .filter(Boolean) || []
          : [];

      setRerunHints((prev) => ({
        ...prev,
        [row.id]: {
          profileId: null,
          templateId: null,
          detectedRankingType: row.run.rankingType,
          detectedMetricKey: row.run.metricKey,
          matchedRowIndex: null,
          matchedSourceRank: null,
          matchedConfidence: null,
          lowConfidence: true,
          failureReasons: [message],
          classificationConfidence: null,
          droppedRowCount: null,
          guardFailures: parsedGuardFailures,
          detectedBoardTokens: [],
        },
      }));
      setError(message);
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
    <div className="space-y-4 sm:space-y-5 lg:space-y-6">
      <PageHero
        title="Ranking Review Queue"
        subtitle="Resolve identity links and corrections for ranking screenshots with a mobile card-first triage board."
        badges={[`${rows.length} rows in view`, `${summaryData?.total?.toLocaleString() || 0} total in status set`]}
      />

      <SessionGate ready={workspaceReady} loading={sessionLoading} error={sessionError}>
        <CompactControlRow>
          <Select
            value={statusSelectValue}
            onValueChange={(value) =>
              setStatusFilter(value === ALL_STATUS ? RANKING_REVIEW_STATUS_OPTIONS.join(',') : value)
            }
          >
            <SelectTrigger className="w-[196px] min-w-[196px] rounded-full border-[color:var(--stroke-soft)] bg-[color:var(--surface-3)] text-tier-1">
              <SelectValue placeholder="Status Filter" />
            </SelectTrigger>
            <SelectContent className="border-[color:var(--stroke-soft)] bg-popover backdrop-blur-xl shadow-2xl text-tier-1">
              <SelectItem value="UNRESOLVED">Unresolved</SelectItem>
              <SelectItem value="AUTO_LINKED,MANUAL_LINKED">Linked (Auto + Manual)</SelectItem>
              <SelectItem value="REJECTED">Rejected</SelectItem>
              <SelectItem value={ALL_STATUS}>All Statuses</SelectItem>
            </SelectContent>
          </Select>

          <Select
            value={rankingTypeFilter || ALL_RANKING_TYPE}
            onValueChange={(value) => setRankingTypeFilter(value === ALL_RANKING_TYPE ? '' : value)}
          >
            <SelectTrigger className="w-[196px] min-w-[196px] rounded-full border-[color:var(--stroke-soft)] bg-[color:var(--surface-3)] text-tier-1">
              <SelectValue placeholder="Ranking Type" />
            </SelectTrigger>
            <SelectContent className="border-[color:var(--stroke-soft)] bg-popover backdrop-blur-xl shadow-2xl text-tier-1">
              <SelectItem value={ALL_RANKING_TYPE}>All Ranking Types</SelectItem>
              {RANKING_TYPE_FILTERS.filter((option) => option.value).map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Button
            className="rounded-full bg-[color:var(--primary)] text-primary-foreground hover:opacity-90 shadow-lg hover:opacity-95"
            onClick={() => void loadRows()}
            disabled={loading}
          >
            {loading ? 'Loading...' : 'Apply'}
          </Button>

          <CompactControlDrawer
            triggerLabel="Review Actions"
            title="Rank Review Actions"
            description="Metric filters and bulk actions are compacted inside this drawer."
          >
            <Select
              value={metricFilter || ALL_METRIC}
              onValueChange={(value) => setMetricFilter(value === ALL_METRIC ? '' : value)}
            >
              <SelectTrigger className="w-full rounded-full border-[color:var(--stroke-soft)] bg-[color:var(--surface-3)] text-tier-1">
                <SelectValue placeholder="Metric Key" />
              </SelectTrigger>
              <SelectContent className="border-[color:var(--stroke-soft)] bg-popover backdrop-blur-xl shadow-2xl text-tier-1">
                <SelectItem value={ALL_METRIC}>All Metrics</SelectItem>
                {METRIC_FILTERS.filter((option) => option.value).map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Button
              variant="outline"
              className="rounded-full border-[color:var(--stroke-soft)] bg-[color:var(--surface-3)] text-tier-1 hover:bg-[color:var(--surface-4)] hover:text-tier-1"
              onClick={() => void runBulkAction('accept_linked')}
              disabled={loading || Boolean(busyRow)}
            >
              {busyRow === 'bulk:accept_linked' ? 'Accepting...' : 'Accept Linked'}
            </Button>
            <Button
              variant="destructive"
              className="rounded-full"
              onClick={() => void runBulkAction('reject_all')}
              disabled={loading || Boolean(busyRow)}
            >
              {busyRow === 'bulk:reject_all' ? 'Rejecting...' : 'Reject All'}
            </Button>
            <StatusPill label={`${rows.length} rows`} tone="info" />
          </CompactControlDrawer>
        </CompactControlRow>

        {error ? <InlineError message={error} /> : null}

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4">
          <KpiCard label="Rows in View" value={rows.length} hint="Filtered review rows" tone="info" />
          <KpiCard label="Unresolved" value={summary.unresolved} hint="Needs manual identity action" tone="warn" />
          <KpiCard label="Linked" value={summary.linked} hint="Auto/manual links ready" tone="good" />
          <KpiCard label="Rejected" value={summary.rejected} hint="Discarded ranking rows" tone="bad" />
        </div>

        <Panel title="Screenshot Type Coverage" subtitle="Counts by supported ranking screenshot type.">
          <div className="flex flex-wrap gap-1.5">
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
            <p className="mt-3 text-sm text-tier-3">
              Total rows in selected status set: {summaryData.total.toLocaleString()}.
            </p>
          ) : null}
        </Panel>

        <Panel title="Triage Board" subtitle="Card-first review queue with drawer-assisted mobile correction.">
          {loading ? (
            <SkeletonSet rows={4} />
          ) : rows.length === 0 ? (
            <EmptyState title="Queue is clear" description="No ranking rows in the selected filters." />
          ) : (
            <div className="grid gap-4">
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
                    onRerun={() => void rerunOcr(row)}
                    onAction={(action) => void runAction(row, action)}
                  />
                );
              })}
            </div>
          )}
        </Panel>
      </SessionGate>
    </div>
  );
}
