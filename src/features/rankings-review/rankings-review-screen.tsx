'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Image from 'next/image';
import type { OcrRuntimeProfile } from '@/lib/ocr/profiles';
import { useWorkspaceSession } from '@/lib/workspace-session';
import { InlineError, SessionGate } from '@/components/app/session-gate';
import { Button } from '@/components/ui/button';
import {
  Check,
  Pencil,
  Trash2,
  TrendingUp,
  X,
} from 'lucide-react';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { SUPPORTED_RANKING_BOARDS } from '@/lib/rankings/board-types';
import { RankingReviewItemCard } from './ranking-review-item-card';
import {
  type RankingReviewDraft,
  type RankingReviewGroup,
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
const DEFAULT_STATUS_FILTER = RANKING_REVIEW_STATUS_OPTIONS.join(',');

interface GovernorSearchResult {
  id: string;
  governorId: string;
  name: string;
  alliance?: string;
}

function summarizeGroupRows(rows: ReviewRow[]) {
  const statusCounts: RankingReviewGroup['statusCounts'] = {
    UNRESOLVED: 0,
    AUTO_LINKED: 0,
    MANUAL_LINKED: 0,
    REJECTED: 0,
  };

  for (const row of rows) {
    statusCounts[row.identityStatus] += 1;
  }

  return {
    statusCounts,
    unresolvedCount: statusCounts.UNRESOLVED,
    totalRows: rows.length,
  };
}

function groupRowsClient(rows: ReviewRow[]): RankingReviewGroup[] {
  const groups = new Map<string, RankingReviewGroup>();

  for (const row of rows) {
    const existing = groups.get(row.runId);
    if (!existing) {
      groups.set(row.runId, {
        runId: row.runId,
        rankingType: row.run.rankingType,
        metricKey: row.run.metricKey,
        createdAt: row.run.createdAt,
        status: row.run.status,
        headerText: row.run.headerText,
        diagnostics: row.run.diagnostics || null,
        artifact: row.run.artifact || null,
        rows: [row],
        ...summarizeGroupRows([row]),
      });
      continue;
    }

    existing.rows.push(row);
    const summary = summarizeGroupRows(existing.rows);
    existing.statusCounts = summary.statusCounts;
    existing.unresolvedCount = summary.unresolvedCount;
    existing.totalRows = summary.totalRows;
  }

  return [...groups.values()]
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .map((group) => ({
      ...group,
      rows: [...group.rows].sort((a, b) => {
        const rankA = a.sourceRank ?? Number.MAX_SAFE_INTEGER;
        const rankB = b.sourceRank ?? Number.MAX_SAFE_INTEGER;
        if (rankA !== rankB) return rankA - rankB;
        return a.id.localeCompare(b.id);
      }),
      ...summarizeGroupRows(group.rows),
    }));
}

export default function RankingReviewPage() {
  const {
    workspaceId,
    accessToken,
    ready: workspaceReady,
    loading: sessionLoading,
    error: sessionError,
  } = useWorkspaceSession();

  const [statusFilter, setStatusFilter] = useState(DEFAULT_STATUS_FILTER);
  const [rankingTypeFilter, setRankingTypeFilter] = useState('');
  const [metricFilter, setMetricFilter] = useState('');
  const [showUnresolvedOnly, setShowUnresolvedOnly] = useState(false);

  const [groups, setGroups] = useState<RankingReviewGroup[]>([]);
  const [summaryData, setSummaryData] = useState<RankingReviewSummary | null>(null);
  const [drafts, setDrafts] = useState<Record<string, RankingReviewDraft>>({});
  const [profiles, setProfiles] = useState<OcrRuntimeProfile[]>([]);
  const [rerunProfileByRow, setRerunProfileByRow] = useState<Record<string, string>>({});
  const [rerunHints, setRerunHints] = useState<Record<string, RerunHint>>({});
  const [governorSearchText, setGovernorSearchText] = useState<Record<string, string>>({});
  const [governorSearchResult, setGovernorSearchResult] = useState<Record<string, GovernorSearchResult[]>>({});

  const [expandedRowId, setExpandedRowId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [busyRow, setBusyRow] = useState<string | null>(null);
  const [searchBusyRow, setSearchBusyRow] = useState<string | null>(null);
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
        limit: '200',
        view: 'grouped',
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

      const payloadData = rowsPayload?.data;
      const payloadRows = Array.isArray(payloadData)
        ? (payloadData as ReviewRow[])
        : Array.isArray(payloadData?.rows)
          ? (payloadData.rows as ReviewRow[])
          : [];
      const payloadGroups =
        payloadData && typeof payloadData === 'object' && Array.isArray(payloadData.groups)
          ? (payloadData.groups as RankingReviewGroup[])
          : [];

      const grouped = payloadGroups.length > 0 ? payloadGroups : groupRowsClient(payloadRows);
      setGroups(grouped);

      const nextDrafts: Record<string, RankingReviewDraft> = {};
      const nextRerunProfiles: Record<string, string> = {};
      const nextSearchText: Record<string, string> = {};
      for (const row of payloadRows) {
        nextDrafts[row.id] = {
          governorGameId: '',
          aliasRaw: row.governorNameRaw,
          sourceRank: row.sourceRank?.toString() || '',
          governorNameRaw: row.governorNameRaw,
          metricRaw: row.metricRaw,
        };
        nextRerunProfiles[row.id] = '';
        nextSearchText[row.id] = '';
      }
      setDrafts(nextDrafts);
      setRerunProfileByRow(nextRerunProfiles);
      setRerunHints({});
      setGovernorSearchText(nextSearchText);
      setGovernorSearchResult({});
      setExpandedRowId(null);

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

  const visibleGroups = useMemo(() => {
    if (!showUnresolvedOnly) {
      return groups;
    }

    return groups
      .map((group) => {
        const unresolvedRows = group.rows.filter((row) => row.identityStatus === 'UNRESOLVED');
        if (unresolvedRows.length === 0) return null;
        return {
          ...group,
          rows: unresolvedRows,
          ...summarizeGroupRows(unresolvedRows),
        };
      })
      .filter((entry): entry is RankingReviewGroup => Boolean(entry));
  }, [groups, showUnresolvedOnly]);

  const visibleRows = useMemo(() => visibleGroups.flatMap((group) => group.rows), [visibleGroups]);

  const summary = useMemo(() => {
    const unresolved = visibleRows.filter((row) => row.identityStatus === 'UNRESOLVED').length;
    const linked = visibleRows.filter(
      (row) => row.identityStatus === 'MANUAL_LINKED' || row.identityStatus === 'AUTO_LINKED'
    ).length;
    const rejected = visibleRows.filter((row) => row.identityStatus === 'REJECTED').length;
    return { unresolved, linked, rejected };
  }, [visibleRows]);

  const summaryByType = useMemo(() => {
    const base = new Map<string, number>();
    for (const entry of summaryData?.byType || []) {
      base.set(`${entry.rankingType}::${entry.metricKey}`, entry.count);
    }
    return base;
  }, [summaryData]);

  const statusSelectValue = useMemo(
    () =>
      statusFilter === DEFAULT_STATUS_FILTER
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

  const runAction = async (
    row: ReviewRow,
    action: ReviewAction,
    overrides?: {
      governorGameId?: string;
      governorDbId?: string;
      aliasRaw?: string;
    }
  ) => {
    if (!workspaceId || !accessToken) return;

    const draft = drafts[row.id] || defaultRankingReviewDraft;
    setBusyRow(`${row.id}:${action}`);
    setError(null);

    try {
      const body: Record<string, unknown> = {
        workspaceId,
        action,
      };

      const resolvedGovernorGameId = overrides?.governorGameId || draft.governorGameId.trim();
      if (overrides?.governorDbId) {
        body.governorDbId = overrides.governorDbId;
      }

      if (action === 'LINK_TO_GOVERNOR' || action === 'CREATE_ALIAS') {
        if (!resolvedGovernorGameId && !overrides?.governorDbId) {
          throw new Error('Governor game ID is required for this action.');
        }
        if (resolvedGovernorGameId) {
          body.governorGameId = resolvedGovernorGameId;
        }
      }

      if (action === 'CREATE_ALIAS') {
        body.aliasRaw = (overrides?.aliasRaw || draft.aliasRaw.trim() || row.governorNameRaw).trim();
      }

      if (action === 'CORRECT_ROW') {
        body.corrected = {
          sourceRank: draft.sourceRank.trim() ? Number(draft.sourceRank) : null,
          governorNameRaw: draft.governorNameRaw.trim(),
          metricRaw: draft.metricRaw.trim(),
          metricValue: draft.metricRaw,
        };
        if (resolvedGovernorGameId) {
          body.governorGameId = resolvedGovernorGameId;
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
    async (mode: 'accept_linked' | 'reject_all', group?: RankingReviewGroup) => {
      if (!workspaceReady || !accessToken) return;

      if (!group) {
        // GLOBAL ACTION: Use server-side bulk endpoint for absolute reliability
        const confirmed = window.confirm(
          mode === 'accept_linked'
            ? 'Accept ALL linked and suggested rows across the entire queue? This will finalize all identifiable governors.'
            : 'Reject all currently UNRESOLVED rows? This will clear the unresolved queue for the current event/workspace.'
        );
        if (!confirmed) return;

        setBusyRow(`bulk:${mode}`);
        setError(null);

        try {
          const res = await fetch('/api/v2/rankings/review/bulk', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-access-token': accessToken,
            },
            body: JSON.stringify({
              workspaceId,
              mode: mode === 'accept_linked' ? 'ACCEPT_LINKED' : 'REJECT_ALL_UNRESOLVED',
            }),
          });

          const payload = await res.json();
          if (!res.ok) throw new Error(payload?.error?.message || 'Bulk action failed.');
          
          if (payload?.data?.count === 0) {
             alert('No rows found matching the criteria for this bulk action.');
          } else {
             alert(`Successfully processed ${payload.data.count} rows.`);
          }

          await loadRows();
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Bulk action failed.');
        } finally {
          setBusyRow(null);
        }
        return;
      }

      // GROUP ACTION: Keep parallel client-side logic for scoped triage
      const baseRows = group.rows;
      const targets =
        mode === 'accept_linked'
          ? baseRows.filter(
              (row) =>
                row.identityStatus === 'AUTO_LINKED' ||
                row.identityStatus === 'MANUAL_LINKED' ||
                (row.identityStatus === 'UNRESOLVED' &&
                  Array.isArray(row.identitySuggestions) &&
                  row.identitySuggestions.length > 0)
            )
          : baseRows.filter((row) => row.identityStatus !== 'REJECTED');

      if (targets.length === 0) {
        alert('No rows in this screenshot match the criteria for this action.');
        return;
      }

      const busyKey = `bulk:${group.runId}:${mode}`;
      setBusyRow(busyKey);
      setError(null);

      try {
        const results = await Promise.all(
          targets.map(async (row) => {
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

                if (row.governorId) {
                  body.governorDbId = row.governorId;
                } else if (row.governor?.id) {
                  body.governorDbId = row.governor.id;
                } else {
                  const bestSuggestion = row.identitySuggestions?.[0];
                  if (bestSuggestion) {
                    body.governorGameId = bestSuggestion.governorGameId;
                  }
                }

                const bestSuggestion = row.identitySuggestions?.[0];
                if (!body.governorDbId && !body.governorGameId && bestSuggestion) {
                  body.governorGameId = bestSuggestion.governorGameId;
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
              return res.ok;
            } catch {
              return false;
            }
          })
        );

        const succeeded = results.filter(Boolean).length;
        const failed = results.length - succeeded;

        await loadRows();
        if (failed > 0) {
          setError(`Group action finished: ${succeeded} succeeded, ${failed} failed.`);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Group action failed.');
      } finally {
        setBusyRow(null);
      }
    },
    [workspaceReady, accessToken, workspaceId, loadRows]
  );





  const runGovernorSearch = useCallback(
    async (rowId: string) => {
      if (!workspaceReady || !accessToken) return;
      const query = (governorSearchText[rowId] || '').trim();
      if (query.length < 2) {
        setGovernorSearchResult((prev) => ({
          ...prev,
          [rowId]: [],
        }));
        return;
      }

      setSearchBusyRow(rowId);
      try {
        const params = new URLSearchParams({
          workspaceId,
          search: query,
          limit: '8',
        });
        const res = await fetch(`/api/v2/governors?${params.toString()}`, {
          headers: {
            'x-access-token': accessToken,
          },
        });
        const payload = await res.json();
        if (!res.ok) {
          throw new Error(payload?.error?.message || 'Failed to search governors.');
        }
        const next = Array.isArray(payload?.data) ? (payload.data as GovernorSearchResult[]) : [];
        setGovernorSearchResult((prev) => ({
          ...prev,
          [rowId]: next,
        }));
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Failed to search governors.');
      } finally {
        setSearchBusyRow(null);
      }
    },
    [workspaceReady, accessToken, governorSearchText, workspaceId]
  );

  return (
    <div className="space-y-4 sm:space-y-5 lg:space-y-6">
      <PageHero
        title="Ranking Review Queue"
        subtitle="Screenshot-first triage for ranking OCR with strict linking and fast manual resolution."
        badges={[
          `${visibleGroups.length} screenshots in view`,
          `${visibleRows.length} rows in view`,
          `${summaryData?.total?.toLocaleString() || 0} total rows in status set`,
        ]}
      />

      <SessionGate ready={workspaceReady} loading={sessionLoading} error={sessionError}>
        <CompactControlRow>
          <Select
            value={statusSelectValue}
            onValueChange={(value) =>
              setStatusFilter(value === ALL_STATUS ? DEFAULT_STATUS_FILTER : value)
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
            variant={showUnresolvedOnly ? 'default' : 'outline'}
            className={
              showUnresolvedOnly
                ? 'rounded-full bg-[color:var(--primary)] text-primary-foreground hover:opacity-90 shadow-lg hover:opacity-95'
                : 'rounded-full border-[color:var(--stroke-soft)] bg-[color:var(--surface-3)] text-tier-1 hover:bg-[color:var(--surface-4)] hover:text-tier-1'
            }
            onClick={() => setShowUnresolvedOnly((prev) => !prev)}
          >
            {showUnresolvedOnly ? 'Showing Unresolved Only' : 'Show Unresolved Only'}
          </Button>

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
            <StatusPill label={`${visibleRows.length} rows`} tone="info" />
          </CompactControlDrawer>
        </CompactControlRow>

        {error ? <InlineError message={error} /> : null}

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4">
          <KpiCard label="Screenshots" value={visibleGroups.length} hint="Grouped by run" tone="info" />
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

        <Panel title="Screenshot Triage Board" subtitle="Each card represents one ranking screenshot run.">
          {loading ? (
            <SkeletonSet rows={4} />
          ) : visibleGroups.length === 0 ? (
            <EmptyState title="Queue is clear" description="No ranking rows in the selected filters." />
          ) : (
            <div className="grid gap-4">
              {visibleGroups.map((group) => (
                <article
                  key={group.runId}
                  className="rounded-[20px] surface-2 p-3 min-[390px]:rounded-[22px] min-[390px]:p-3.5 sm:rounded-[24px] sm:p-4"
                >
                  <header className="space-y-3">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h3 className="clamp-title-mobile font-heading text-base text-tier-1 min-[390px]:text-lg sm:text-xl">
                          {group.headerText || 'Ranking Screenshot'}
                        </h3>
                        <p className="mt-1 text-xs text-tier-3">
                          Run #{group.runId.slice(-8)} • {new Date(group.createdAt).toLocaleString()}
                        </p>
                      </div>
                      <div className="flex flex-wrap justify-end gap-1.5">
                        <StatusPill label={`${group.totalRows} rows`} tone="info" />
                        <StatusPill label={`${group.unresolvedCount} unresolved`} tone={group.unresolvedCount > 0 ? 'warn' : 'good'} />
                        <StatusPill label={`Run ${group.status}`} tone="neutral" />
                        {group.diagnostics?.classificationConfidence != null ? (
                          <StatusPill
                            label={`Classify ${Math.round(group.diagnostics.classificationConfidence)}%`}
                            tone={group.diagnostics.classificationConfidence >= 75 ? 'good' : 'warn'}
                          />
                        ) : null}
                        {group.diagnostics?.slotCount != null ? (
                          <StatusPill label={`Slots ${group.diagnostics.slotCount}`} tone="neutral" />
                        ) : null}
                        {group.diagnostics?.validRows != null ? (
                          <StatusPill label={`Valid ${group.diagnostics.validRows}`} tone="good" />
                        ) : null}
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/[0.05] pt-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8 rounded-lg border-emerald-500/20 bg-emerald-500/5 text-emerald-400 hover:bg-emerald-500/10 hover:text-emerald-300 font-bold text-[11px] uppercase tracking-wider"
                          onClick={() => void runBulkAction('accept_linked', group)}
                          disabled={!!busyRow}
                        >
                          <Check className="mr-1.5 size-3.5" />
                          Accept Linked
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8 rounded-lg border-rose-500/20 bg-rose-500/5 text-rose-400 hover:bg-rose-500/10 hover:text-rose-300 font-bold text-[11px] uppercase tracking-wider"
                          onClick={() => void runBulkAction('reject_all', group)}
                          disabled={!!busyRow}
                        >
                          <Trash2 className="mr-1.5 size-3.5" />
                          Reject All
                        </Button>
                      </div>

                      {group.diagnostics?.guardFailures?.length ? (
                        <p className="text-sm text-rose-200/80 font-medium">
                          Guard failures: <span className="text-rose-100">{group.diagnostics.guardFailures.join(' • ')}</span>
                        </p>
                      ) : null}
                    </div>
                  </header>


                  {group.artifact?.url ? (
                    <div className="mt-3 overflow-hidden rounded-2xl border border-[color:var(--stroke-soft)] bg-black/20">
                      <Image
                        src={group.artifact.url}
                        alt={`Ranking screenshot ${group.runId}`}
                        width={920}
                        height={520}
                        unoptimized
                        className="h-auto w-full"
                      />
                    </div>
                  ) : null}

                  {/* UNIVERSAL ROW EXTRACT LIST - PREMIUM LEDGER STYLE */}
                  <div className="mt-4 flex flex-col gap-2.5">
                    {group.rows.map((row) => {
                      const rowSuggestions = Array.isArray(row.identitySuggestions)
                        ? row.identitySuggestions.slice(0, 3)
                        : [];
                      const isExpanded = expandedRowId === row.id;

                      return (
                        <div key={`${row.id}:row`} className="flex flex-col gap-2 group/row">
                          <div className={cn(
                             "relative overflow-hidden rounded-[18px] border transition-all duration-300",
                             isExpanded 
                               ? "border-cyan-400/40 bg-cyan-400/[0.03] shadow-[0_0_25px_rgba(34,211,238,0.08)]" 
                               : "border-white/[0.06] bg-white/[0.02] hover:border-white/10 hover:bg-white/[0.04]"
                          )}>
                            <div className="flex flex-col md:flex-row gap-3 items-start md:items-center justify-between p-3.5 sm:p-4">
                              
                              {/* Left: Identity & Rank Info */}
                              <div className="flex items-center gap-4 min-w-0 flex-1">
                                <div className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-white/5 bg-black/40 font-mono text-[15px] font-bold text-tier-2 shadow-inner">
                                  <span className="opacity-40 text-[10px] absolute top-1 left-1.5 font-sans">#</span>
                                  {row.sourceRank ?? '-'}
                                </div>
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <h4 className="font-heading font-bold text-tier-1 text-[15px] tracking-tight truncate">{row.governorNameRaw}</h4>
                                    {row.allianceRaw && (
                                      <span className="inline-flex items-center rounded-md bg-cyan-400/10 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-cyan-300 border border-cyan-400/20">
                                        {row.allianceRaw}
                                      </span>
                                    )}
                                  </div>
                                  <div className="flex items-center gap-2 mt-1 text-[11px] font-medium text-tier-3">
                                    <span className="font-mono text-tier-2 bg-white/5 px-1.5 py-0.5 rounded-md">{row.metricValue}</span>
                                    <span className="opacity-60">{row.run.metricKey === "kill_points_growth" ? "KP Growth" : "Score"}</span>
                                    <span>•</span>
                                    <span className={cn(row.confidence > 90 ? "text-emerald-400/80" : "text-amber-400/80")}>
                                      {row.confidence.toFixed(0)}% Match
                                    </span>
                                  </div>
                                </div>
                              </div>

                              {/* Middle: Quick Links (Desktop Only) */}
                              <div className="hidden xl:flex flex-wrap items-center gap-1.5 max-w-[280px] justify-center">
                                {rowSuggestions.map((suggestion) => (
                                  <Button
                                    key={`${row.id}:${suggestion.governorId}`}
                                    size="sm"
                                    variant="outline"
                                    className="h-7 text-[10px] uppercase tracking-wider font-bold rounded-lg border-white/[0.08] bg-black/20 text-tier-2 hover:bg-white/5 hover:text-tier-1 transition-all"
                                    disabled={!!busyRow}
                                    onClick={() => void runAction(row, "LINK_TO_GOVERNOR", { governorGameId: suggestion.governorGameId })}
                                  >
                                    {suggestion.name}
                                  </Button>
                                ))}
                              </div>

                              {/* Right: Status & Actions */}
                              <div className="flex w-full md:w-auto shrink-0 items-center gap-2 md:pl-4 justify-between md:justify-end border-t md:border-t-0 border-white/[0.05] pt-3 md:pt-0">
                                <StatusPill 
                                  label={row.identityStatus.replace('_', ' ')} 
                                  tone={row.identityStatus === 'UNRESOLVED' ? 'warn' : row.identityStatus === 'REJECTED' ? 'bad' : 'good'} 
                                  className="scale-90"
                                />
                                <div className="flex items-center gap-1.5">
                                  <Button
                                    size="sm"
                                    className="h-8 min-w-[75px] rounded-lg bg-cyan-500/10 text-cyan-200 hover:bg-cyan-500 hover:text-white border border-cyan-500/20 transition-all font-bold text-xs"
                                    onClick={() => void runAction(row, "LINK_TO_GOVERNOR")}
                                    disabled={!!busyRow}
                                  >
                                    Link
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="h-8 px-2.5 rounded-lg border-white/[0.08] bg-white/[0.02] text-tier-2 hover:text-tier-1"
                                    onClick={() => setExpandedRowId(prev => prev === row.id ? null : row.id)}
                                  >
                                    {isExpanded ? <X className="size-3.5" /> : <Pencil className="size-3.5" />}
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="destructive"
                                    className="h-8 px-2.5 rounded-lg opacity-60 hover:opacity-100 transition-opacity"
                                    onClick={() => void runAction(row, "REJECT_ROW")}
                                    disabled={!!busyRow}
                                  >
                                    <Trash2 className="size-3.5" />
                                  </Button>
                                </div>
                              </div>
                            </div>
                          </div>

                          {/* Expanded Editor (Universal) */}
                          {isExpanded && (
                            <div className="rounded-2xl border border-white/[0.08] bg-black/40 p-4 mx-2 md:mx-6 mb-2 shadow-2xl">
                               <RankingReviewItemCard
                                  row={row}
                                  draft={drafts[row.id] || defaultRankingReviewDraft}
                                  rankingProfiles={rankingProfiles}
                                  rerunProfileId={rerunProfileByRow[row.id] || ''}
                                  rerunHint={rerunHints[row.id] || null}
                                  busyRow={busyRow}
                                  onUpdateDraft={(field, value) => updateDraft(row.id, field, value)}
                                  onRerunProfileChange={(value) =>
                                    setRerunProfileByRow((prev) => ({ ...prev, [row.id]: value }))
                                  }
                                  onRerun={() => void rerunOcr(row)}
                                  onAction={(action) => {
                                      void runAction(row, action);
                                      setExpandedRowId(null);
                                  }}
                                />
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>

                </article>
              ))}
            </div>
          )}
        </Panel>
      </SessionGate>
    </div>
  );
}
