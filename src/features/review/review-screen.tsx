'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ShieldCheck, XCircle } from 'lucide-react';
import type { OcrRuntimeProfile } from '@/lib/ocr/profiles';
import { useWorkspaceSession } from '@/lib/workspace-session';
import { getRankingTypeDisplayName, SUPPORTED_RANKING_BOARDS } from '@/lib/rankings/board-types';
import { InlineError, SessionGate } from '@/components/app/session-gate';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
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
  CompactAlert,
  CompactControlDrawer,
  CompactControlRow,
  EmptyState,
  KpiCard,
  PageHero,
  Panel,
  SkeletonSet,
  StatusPill,
} from '@/components/ui/primitives';
import { createAssistantHandoff } from '@/features/assistant/handoff';

const ALL_SEVERITY = '__all__';

export default function ReviewQueuePage() {
  const router = useRouter();
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

      const formData = new FormData();
      formData.set('workspaceId', workspaceId);
      formData.set('archetypeHint', 'governor_profile');
      formData.set('file', file);

      const diagnosticsRes = await fetch('/api/v2/ocr/run', {
        method: 'POST',
        headers: {
          'x-access-token': accessToken,
        },
        body: formData,
      });

      const diagnosticsPayload = await diagnosticsRes.json();
      if (!diagnosticsRes.ok) {
        throw new Error(diagnosticsPayload?.error?.message || 'Failed to run server OCR diagnostics.');
      }

      const diagnostics = diagnosticsPayload?.data || {};
      const normalized =
        diagnostics.normalized && typeof diagnostics.normalized === 'object'
          ? (diagnostics.normalized as Record<string, unknown>)
          : {};

      const nextDraft = {
        governorId: String(normalized.governorId || ''),
        governorName: String(normalized.governorName || ''),
        power: String(normalized.power || ''),
        killPoints: String(normalized.killPoints || ''),
        t4Kills: String(normalized.t4Kills || ''),
        t5Kills: String(normalized.t5Kills || ''),
        deads: String(normalized.deads || ''),
      };

      setDrafts((prev) => ({
        ...prev,
        [item.id]: nextDraft,
      }));

      const rerunPayload = {
        profileId: profileId || null,
        engineVersion: diagnostics.engineVersion || 'mistral-ocr-latest+mistral-large-latest',
        normalized: nextDraft,
        preprocessingTrace: diagnostics.preprocessingTrace || {},
        candidates: diagnostics.candidates || {},
        fusionDecision: diagnostics.fusionDecision || {},
        failureReasons: diagnostics.failureReasons || [],
        lowConfidence: diagnostics.lowConfidence ?? false,
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

      const concurrencyLimit = 5;
      for (let i = 0; i < items.length; i += concurrencyLimit) {
        const chunk = items.slice(i, i + concurrencyLimit);
        await Promise.all(
          chunk.map(async (item) => {
            try {
              const result = await requestReviewUpdate(item.id, status);
              if (result?.syncState === 'PENDING_WEEK_LINK' || result?.warning) warningCount += 1;
              successCount += 1;
            } catch (err) {
              const message = err instanceof Error ? err.message : 'Unknown error';
              const label = item.values.governorName.value || item.id.slice(-6);
              failures.push(`${label}: ${message}`);
            }
          })
        );
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
    <div className="space-y-4 sm:space-y-5 lg:space-y-6">
      <PageHero
        title="OCR Review Queue"
        subtitle="Validate OCR profile extractions with card-first review, then approve, reject, or rerun."
        badges={[
          `${summary.total} rows in queue`,
          `${rankingQueueSummary?.total?.toLocaleString() || 0} ranking rows pending`,
        ]}
      />

      <SessionGate ready={workspaceReady} loading={sessionLoading} error={sessionError}>
        <CompactControlRow>
          <Select
            value={severity || ALL_SEVERITY}
            onValueChange={(value) => setSeverity(value === ALL_SEVERITY ? '' : (value as Severity))}
          >
            <SelectTrigger className="w-[168px] min-w-[168px] rounded-full border-[color:var(--stroke-soft)] bg-[color:var(--surface-3)] text-tier-1">
              <SelectValue placeholder="Severity" />
            </SelectTrigger>
            <SelectContent className="border-[color:var(--stroke-soft)] bg-popover backdrop-blur-xl shadow-2xl text-tier-1">
              <SelectItem value={ALL_SEVERITY}>All Severities</SelectItem>
              <SelectItem value="HIGH">High Severity</SelectItem>
              <SelectItem value="MEDIUM">Medium Severity</SelectItem>
              <SelectItem value="LOW">Low Severity</SelectItem>
            </SelectContent>
          </Select>

          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[196px] min-w-[196px] rounded-full border-[color:var(--stroke-soft)] bg-[color:var(--surface-3)] text-tier-1">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent className="border-[color:var(--stroke-soft)] bg-popover backdrop-blur-xl shadow-2xl text-tier-1">
              {REVIEW_STATUS_PRESETS.map((preset) => (
                <SelectItem key={preset.value} value={preset.value}>
                  {preset.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Button
            className="rounded-full bg-[color:var(--primary)] text-primary-foreground hover:opacity-90 shadow-lg hover:opacity-95"
            onClick={() => void loadQueue()}
            disabled={loading}
          >
            {loading ? 'Loading...' : 'Apply'}
          </Button>

          <CompactControlDrawer
            triggerLabel="Queue Actions"
            title="Queue Actions"
            description="Bulk actions and queue visibility are compacted into this drawer."
          >
            <div className="grid gap-2.5 sm:grid-cols-2">
              <Button
                variant="outline"
                className="rounded-full border-[color:var(--stroke-soft)] bg-[color:var(--surface-3)] text-tier-1 hover:bg-[color:var(--surface-4)] hover:text-tier-1"
                onClick={() => void submitReviewBulk('APPROVED')}
                disabled={loading || Boolean(actionBusy) || items.length === 0}
              >
                <ShieldCheck data-icon="inline-start" />
                {actionBusy === 'bulk:APPROVED' ? 'Approving...' : 'Accept Visible'}
              </Button>
              <Button
                variant="destructive"
                className="rounded-full"
                onClick={() => void submitReviewBulk('REJECTED')}
                disabled={loading || Boolean(actionBusy) || items.length === 0}
              >
                <XCircle data-icon="inline-start" />
                {actionBusy === 'bulk:REJECTED' ? 'Rejecting...' : 'Reject Visible'}
              </Button>
            </div>
            <StatusPill label={`${items.length} rows`} tone="info" />
          </CompactControlDrawer>
        </CompactControlRow>

        {error ? <InlineError message={error} /> : null}
        {actionNotice ? (
          <CompactAlert title="Queue Update" description={actionNotice} tone="info" />
        ) : null}

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4">
          <KpiCard label="Queue Total" value={summary.total} hint="Rows in current queue filter" tone="info" />
          <KpiCard label="High Severity" value={summary.high} hint="Likely correction needed" tone="bad" />
          <KpiCard label="Medium Severity" value={summary.medium} hint="Validate before approve" tone="warn" />
          <KpiCard label="Low Severity" value={summary.low} hint="Usually ready" tone="good" />
        </div>

        {metricsSummary ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4">
            <KpiCard
              label="Low-Confidence Rate"
              value={`${Math.round(metricsSummary.lowConfidenceRate * 100)}%`}
              hint="Last 30 days"
              tone="warn"
              animated={false}
            />
            <KpiCard
              label="Reviewer Edit Rate"
              value={`${Math.round(metricsSummary.reviewerEditRate * 100)}%`}
              hint="Field corrections"
              tone="info"
              animated={false}
            />
            <KpiCard
              label="Review Pass Rate"
              value={`${Math.round(metricsSummary.reviewPassRate * 100)}%`}
              hint="Approved without reject"
              tone="good"
              animated={false}
            />
          </div>
        ) : null}

        <Panel
          title="Post-Upload Routing"
          subtitle="Profile screenshots stay here. Ranking screenshot rows are routed to Rank Review."
          actions={
            <Button
              asChild
              variant="outline"
              className="rounded-full border-[color:var(--stroke-soft)] bg-[color:var(--surface-3)] text-tier-1 hover:bg-[color:var(--surface-4)] hover:text-tier-1"
            >
              <Link href="/rankings/review">Open Ranking Review</Link>
            </Button>
          }
        >
          <div className="flex flex-wrap gap-1.5">
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
          <p className="mt-3 text-sm text-tier-3">
            Pending ranking rows: {rankingQueueSummary?.total?.toLocaleString() || 0}
          </p>
        </Panel>

        <Panel title="Review Board" subtitle="Card-first queue with mobile drawer editing and quick review actions.">
          {loading ? (
            <SkeletonSet rows={4} />
          ) : items.length === 0 ? (
            <EmptyState title="No entries in queue" description="Try broadening filters." />
          ) : (
            <div className="grid gap-4">
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
                    onRerun={() => void rerunOcr(item)}
                    onSaveGolden={() => void saveGoldenFixture(item)}
                    onSubmit={(status) => void submitReview(item.id, status)}
                    onAskAssistant={() => {
                      const token = createAssistantHandoff({
                        source: 'review',
                        workspaceId,
                        title: 'OCR Review Row Handoff',
                        summary: `Queue row ${item.id.slice(-8)} with severity ${item.severity.level}.`,
                        suggestedPrompt:
                          'Analyze this OCR review screenshot and propose the exact player registration/update/stat actions required.',
                        artifacts: item.artifact?.id
                          ? [
                              {
                                artifactId: item.artifact.id,
                                url: item.artifact.url,
                                fileName: `${item.values.governorName.value || 'ocr-row'}.png`,
                                mimeType: 'image/png',
                              },
                            ]
                          : [],
                        meta: {
                          reviewQueueId: item.id,
                          status: item.status,
                          severity: item.severity.level,
                        },
                      });
                      router.push(`/assistant?handoff=${encodeURIComponent(token)}`);
                    }}
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
