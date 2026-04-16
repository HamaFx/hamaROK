'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Download,
  Search,
  Send,
  Sparkles,
  Swords,
  TrendingDown,
  TrendingUp,
  Users,
} from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { InlineError, SessionGate } from '@/components/app/session-gate';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  DataTableLite,
  EmptyState,
  FilterBar,
  KpiCard,
  MetricStrip,
  PageHero,
  Panel,
  SkeletonSet,
  StatusPill,
} from '@/components/ui/primitives';
import { formatCompactNumber, formatMetric } from '@/features/shared/formatters';
import { EVENT_TYPE_LABELS, formatDelta } from '@/lib/utils';
import { useWorkspaceSession } from '@/lib/workspace-session';

const EMPTY_VALUE = '__empty__';

type SortField = 'rank' | 'score' | 'power' | 'killPoints' | 'actualDkp' | 'kdRatio';

type WarriorTier = 'War Legend' | 'Elite Warrior' | 'Frontline Fighter' | 'Support Role' | 'Inactive';

interface Comparison {
  governor: { id: string; governorId: string; name: string };
  deltas: Record<string, string>;
  snapshotA: Record<string, string>;
  snapshotB: Record<string, string>;
  anomalies: Array<{ code: string; severity: string; message: string }>;
  warriorScore: {
    actualDkp: number;
    expectedKp: number;
    expectedDeads?: number;
    expectedDkp?: number;
    kdRatio: number;
    totalScore: number;
    isDeadweight: boolean;
    tier: WarriorTier;
    rank: number;
  } | null;
}

interface CompareResult {
  eventA: { id: string; name: string; eventType: string };
  eventB: { id: string; name: string; eventType: string };
  comparisons: Comparison[];
  missingInB: Array<{ governor: { id: string; governorId: string; name: string } }>;
  newInB: Array<{ governor: { id: string; governorId: string; name: string } }>;
  summary: {
    totalGovernors: number;
    avgWarriorScore: number;
    anomalyCount: number;
    deadweightCount: number;
    negativePowerCount: number;
    tierDistribution: Record<string, number>;
    scoreBuckets: Record<string, number>;
    topContributors: Array<{
      governorId: string;
      governorName: string;
      score: number;
      actualDkp: number;
      killPointsDelta: number;
      deadsDelta: number;
    }>;
    topByKillPoints: Array<{
      governorId: string;
      governorName: string;
      killPointsDelta: number;
      score: number;
    }>;
    topByDeads: Array<{
      governorId: string;
      governorName: string;
      deadsDelta: number;
      score: number;
    }>;
  };
}

interface EventOption {
  id: string;
  name: string;
  eventType: string;
}

function tierTone(tier: WarriorTier): 'warn' | 'info' | 'good' | 'neutral' | 'bad' {
  if (tier === 'War Legend') return 'warn';
  if (tier === 'Elite Warrior') return 'info';
  if (tier === 'Frontline Fighter') return 'good';
  if (tier === 'Inactive') return 'bad';
  return 'neutral';
}

function scoreTone(score: number): 'good' | 'warn' | 'bad' | 'neutral' {
  if (score >= 100) return 'good';
  if (score >= 75) return 'warn';
  if (score > 0) return 'neutral';
  return 'bad';
}

function tierOrderEntries(distribution: Record<string, number>) {
  return [
    'War Legend',
    'Elite Warrior',
    'Frontline Fighter',
    'Support Role',
    'Inactive',
  ].map((tier) => ({ tier: tier as WarriorTier, value: distribution[tier] || 0 }));
}

export default function CompareScreen() {
  const searchParams = useSearchParams();
  const { workspaceId, accessToken, ready, loading: sessionLoading, error: sessionError, refreshSession } = useWorkspaceSession();
  const [events, setEvents] = useState<EventOption[]>([]);
  const [eventAId, setEventAId] = useState(searchParams.get('eventA') || '');
  const [eventBId, setEventBId] = useState(searchParams.get('eventB') || '');
  const [result, setResult] = useState<CompareResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [sortField, setSortField] = useState<SortField>('rank');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [search, setSearch] = useState('');
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [publishMessage, setPublishMessage] = useState<string | null>(null);

  const loadEvents = useCallback(async () => {
    if (!ready) {
      setEvents([]);
      return;
    }

    try {
      setError(null);
      const params = new URLSearchParams({ workspaceId, limit: '200' });
      const res = await fetch(`/api/v2/events?${params.toString()}`, {
        headers: { 'x-access-token': accessToken },
      });
      const payload = await res.json();
      if (!res.ok) {
        throw new Error(payload?.error?.message || 'Failed to load events.');
      }

      const nextEvents = Array.isArray(payload?.data) ? (payload.data as EventOption[]) : [];
      setEvents(nextEvents);
      if (!eventAId && nextEvents[1]?.id) setEventAId(nextEvents[1].id);
      if (!eventBId && nextEvents[0]?.id) setEventBId(nextEvents[0].id);
    } catch (cause) {
      setEvents([]);
      setError(cause instanceof Error ? cause.message : 'Failed to load events.');
    }
  }, [workspaceId, accessToken, ready, eventAId, eventBId]);

  const loadComparison = useCallback(async () => {
    if (!ready || !eventAId || !eventBId) {
      setResult(null);
      return;
    }

    try {
      setLoading(true);
      setError(null);
      const params = new URLSearchParams({ workspaceId, eventA: eventAId, eventB: eventBId });
      const res = await fetch(`/api/v2/compare?${params.toString()}`, {
        headers: { 'x-access-token': accessToken },
      });
      const payload = await res.json();
      if (!res.ok) {
        throw new Error(payload?.error?.message || 'Failed to compare events.');
      }
      setResult(payload?.data ? (payload.data as CompareResult) : null);
    } catch (cause) {
      setResult(null);
      setError(cause instanceof Error ? cause.message : 'Failed to compare events.');
    } finally {
      setLoading(false);
    }
  }, [workspaceId, accessToken, ready, eventAId, eventBId]);

  useEffect(() => {
    if (ready) void loadEvents();
  }, [ready, loadEvents]);

  useEffect(() => {
    if (ready && eventAId && eventBId) void loadComparison();
  }, [ready, eventAId, eventBId, loadComparison]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    if (eventAId) url.searchParams.set('eventA', eventAId);
    else url.searchParams.delete('eventA');
    if (eventBId) url.searchParams.set('eventB', eventBId);
    else url.searchParams.delete('eventB');
    window.history.replaceState({}, '', url.toString());
  }, [eventAId, eventBId]);

  const publishToDiscord = useCallback(async () => {
    if (!ready || !result) return;

    setPublishing(true);
    setPublishMessage(null);
    setError(null);
    try {
      const res = await fetch('/api/v2/integrations/discord/publish', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-access-token': accessToken,
        },
        body: JSON.stringify({
          workspaceId,
          eventA: eventAId,
          eventB: eventBId,
          topN: 10,
          idempotencyKey: `compare-publish-${eventAId}-${eventBId}`,
        }),
      });
      const payload = await res.json();
      if (!res.ok) {
        throw new Error(payload?.error?.message || 'Failed to publish to Discord.');
      }
      setPublishMessage('Leaderboard published to Discord.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Failed to publish to Discord.');
      setPublishMessage(null);
    } finally {
      setPublishing(false);
    }
  }, [ready, result, accessToken, workspaceId, eventAId, eventBId]);

  const exportCsv = useCallback(() => {
    if (!result) return;

    const headers = [
      'Rank',
      'Governor',
      'ID',
      'Start Power',
      'End Power',
      'Power Delta',
      'Kill Points Delta',
      'Actual DKP',
      'Expected DKP',
      'KD Ratio',
      'Score',
      'Tier',
      'Deadweight',
    ];
    const rows = (result.comparisons || []).map((item) => [
      item.warriorScore?.rank || '',
      item.governor.name,
      item.governor.governorId,
      item.snapshotA.power,
      item.snapshotB.power,
      item.deltas.power,
      item.deltas.killPoints,
      item.warriorScore?.actualDkp || 0,
      item.warriorScore?.expectedDkp || 0,
      item.warriorScore?.kdRatio || 0,
      item.warriorScore?.totalScore || 0,
      item.warriorScore?.tier || '',
      item.warriorScore?.isDeadweight ? 'YES' : 'NO',
    ]);

    const csv = [headers.join(','), ...rows.map((row) => row.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `compare-${result.eventA.name}-vs-${result.eventB.name}.csv`.replace(/\s+/g, '_');
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }, [result]);

  const sortedRows = useMemo(() => {
    const rows = [...(result?.comparisons || [])]
      .filter((item) => !search || item.governor.name.toLowerCase().includes(search.toLowerCase()) || item.governor.governorId.includes(search));

    rows.sort((a, b) => {
      let aValue = 0;
      let bValue = 0;
      if (sortField === 'rank') {
        aValue = a.warriorScore?.rank || Number.MAX_SAFE_INTEGER;
        bValue = b.warriorScore?.rank || Number.MAX_SAFE_INTEGER;
      } else if (sortField === 'score') {
        aValue = a.warriorScore?.totalScore || 0;
        bValue = b.warriorScore?.totalScore || 0;
      } else if (sortField === 'actualDkp') {
        aValue = a.warriorScore?.actualDkp || 0;
        bValue = b.warriorScore?.actualDkp || 0;
      } else if (sortField === 'kdRatio') {
        aValue = a.warriorScore?.kdRatio || 0;
        bValue = b.warriorScore?.kdRatio || 0;
      } else if (sortField === 'killPoints') {
        aValue = Number(a.deltas.killPoints || 0);
        bValue = Number(b.deltas.killPoints || 0);
      } else {
        aValue = Number(a.deltas.power || 0);
        bValue = Number(b.deltas.power || 0);
      }
      return sortDir === 'desc' ? bValue - aValue : aValue - bValue;
    });

    return rows;
  }, [result?.comparisons, search, sortField, sortDir]);

  const spotlight = useMemo(() => {
    const top = result?.summary.topContributors?.[0] || null;
    const topKills = result?.summary.topByKillPoints?.[0] || null;
    const topDeads = result?.summary.topByDeads?.[0] || null;
    const biggestPowerSwing = [...(result?.comparisons || [])].sort(
      (a, b) => Math.abs(Number(b.deltas.power || 0)) - Math.abs(Number(a.deltas.power || 0))
    )[0] || null;
    return { top, topKills, topDeads, biggestPowerSwing };
  }, [result]);

  const columns = useMemo(
    () => [
      {
        key: 'rank',
        label: 'Rank',
        sortable: true,
        render: (row: Comparison) => (
          <StatusPill label={row.warriorScore?.rank ? `#${row.warriorScore.rank}` : '—'} tone={row.warriorScore?.rank && row.warriorScore.rank <= 3 ? 'warn' : 'neutral'} />
        ),
      },
      {
        key: 'player',
        label: 'Player',
        render: (row: Comparison) => (
          <div className="space-y-2">
            <strong className="font-heading text-base text-white">{row.governor.name}</strong>
            <div className="flex flex-wrap gap-2">
              <StatusPill label={`ID ${row.governor.governorId}`} tone="neutral" />
              {row.warriorScore?.tier ? <StatusPill label={row.warriorScore.tier} tone={tierTone(row.warriorScore.tier)} /> : null}
            </div>
          </div>
        ),
      },
      {
        key: 'power',
        label: 'Power Delta',
        sortable: true,
        className: 'text-right',
        render: (row: Comparison) => (
          <div className="space-y-1 text-right">
            <p className={Number(row.deltas.power) >= 0 ? 'text-emerald-200' : 'text-rose-200'}>{formatDelta(row.deltas.power)}</p>
            <p className="text-xs text-white/40">{formatCompactNumber(row.snapshotA.power)} → {formatCompactNumber(row.snapshotB.power)}</p>
          </div>
        ),
      },
      {
        key: 'killPoints',
        label: 'KP Delta',
        sortable: true,
        className: 'text-right',
        render: (row: Comparison) => formatMetric(row.deltas.killPoints),
      },
      {
        key: 'actualDkp',
        label: 'Actual DKP',
        sortable: true,
        className: 'text-right',
        mobileHidden: true,
        render: (row: Comparison) => formatMetric(row.warriorScore?.actualDkp || 0),
      },
      {
        key: 'kdRatio',
        label: 'KD',
        sortable: true,
        className: 'text-right',
        mobileHidden: true,
        render: (row: Comparison) => row.warriorScore?.kdRatio || '—',
      },
      {
        key: 'score',
        label: 'Score',
        sortable: true,
        render: (row: Comparison) => (
          <div className="space-y-2">
            <StatusPill label={`${row.warriorScore?.totalScore || 0}%`} tone={scoreTone(row.warriorScore?.totalScore || 0)} />
            {row.warriorScore?.isDeadweight ? <StatusPill label="Deadweight" tone="bad" /> : null}
          </div>
        ),
      },
    ],
    []
  );

  const activeEventA = events.find((event) => event.id === eventAId) || null;
  const activeEventB = events.find((event) => event.id === eventBId) || null;
  const tierEntries = tierOrderEntries(result?.summary.tierDistribution || {});
  const tierMax = Math.max(1, ...tierEntries.map((entry) => entry.value));

  return (
    <div className="space-y-5 sm:space-y-6">
      <PageHero
        title="Compare"
        subtitle="A cleaner head-to-head matchup surface with stronger event selection, delta storytelling, and a sortable warrior-scored board."
        badges={[
          activeEventA ? `Base ${EVENT_TYPE_LABELS[activeEventA.eventType] || activeEventA.eventType}` : 'Baseline pending',
          activeEventB ? `Current ${EVENT_TYPE_LABELS[activeEventB.eventType] || activeEventB.eventType}` : 'Current pending',
          result ? `${result.summary.totalGovernors} matched players` : 'Awaiting matchup',
        ]}
        actions={
          <>
            <Button asChild variant="outline" className="rounded-full border-white/12 bg-white/4 text-white hover:bg-white/8 hover:text-white">
              <Link href="/rankings">
                <Users data-icon="inline-start" /> Rankings
              </Link>
            </Button>
            <Button variant="outline" className="rounded-full border-white/12 bg-white/4 text-white hover:bg-white/8 hover:text-white" onClick={exportCsv} disabled={!result}>
              <Download data-icon="inline-start" /> Export
            </Button>
            <Button className="rounded-full bg-[linear-gradient(135deg,#5a7fff,#7ce6ff)] text-black hover:opacity-95" onClick={publishToDiscord} disabled={!result || publishing || !ready}>
              <Send data-icon="inline-start" /> {publishing ? 'Publishing...' : 'Publish'}
            </Button>
          </>
        }
      />

      <SessionGate ready={ready} loading={sessionLoading} error={sessionError} onRetry={() => void refreshSession()}>
        {error ? <InlineError message={error} /> : null}
        {publishMessage ? <div className="rounded-2xl border border-emerald-300/18 bg-emerald-400/10 px-4 py-3 text-sm text-emerald-100">{publishMessage}</div> : null}

        <Panel title="Matchup Setup" subtitle="Pick baseline and current event snapshots, then rerun the comparison with one tap.">
          <div className="space-y-4">
            <div className="sticky top-[76px] z-20 -mx-1 rounded-[24px] border border-white/10 bg-[rgba(8,11,19,0.94)] p-3.5 shadow-[0_14px_36px_rgba(0,0,0,0.32)] backdrop-blur max-[390px]:top-[72px] max-[390px]:rounded-[20px] max-[390px]:p-2.5 xl:static xl:mx-0 xl:border-white/8 xl:bg-black/20 xl:shadow-none xl:backdrop-blur-none">
              <div className="grid gap-2.5 lg:grid-cols-[minmax(0,1fr)_84px_minmax(0,1fr)_auto] lg:items-end">
                <div className="space-y-2">
                  <p className="text-[11px] uppercase tracking-[0.18em] text-white/36">Baseline Event</p>
                  <Select value={eventAId || EMPTY_VALUE} onValueChange={(value) => setEventAId(value === EMPTY_VALUE ? '' : value)}>
                    <SelectTrigger className="rounded-[22px] border-white/10 bg-white/4 text-white"><SelectValue placeholder="Select baseline event" /></SelectTrigger>
                    <SelectContent className="border-white/10 bg-[rgba(8,10,16,0.98)] text-white">
                      <SelectItem value={EMPTY_VALUE}>Select baseline event</SelectItem>
                      {events.map((event) => (
                        <SelectItem key={event.id} value={event.id}>{event.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex h-11 items-center justify-center rounded-full border border-white/10 bg-white/4 text-xs font-medium uppercase tracking-[0.22em] text-white/46">
                  VS
                </div>
                <div className="space-y-2">
                  <p className="text-[11px] uppercase tracking-[0.18em] text-white/36">Current Event</p>
                  <Select value={eventBId || EMPTY_VALUE} onValueChange={(value) => setEventBId(value === EMPTY_VALUE ? '' : value)}>
                    <SelectTrigger className="rounded-[22px] border-white/10 bg-white/4 text-white"><SelectValue placeholder="Select current event" /></SelectTrigger>
                    <SelectContent className="border-white/10 bg-[rgba(8,10,16,0.98)] text-white">
                      <SelectItem value={EMPTY_VALUE}>Select current event</SelectItem>
                      {events.map((event) => (
                        <SelectItem key={event.id} value={event.id}>{event.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Button onClick={() => void loadComparison()} className="w-full rounded-full bg-[linear-gradient(135deg,#5a7fff,#7ce6ff)] text-black hover:opacity-95 lg:w-auto" disabled={!ready || loading || !eventAId || !eventBId}>
                  <Swords data-icon="inline-start" /> {loading ? 'Running...' : 'Run Compare'}
                </Button>
              </div>
            </div>

            {(activeEventA || activeEventB) ? (
              <MetricStrip
                items={[
                  {
                    label: 'Baseline',
                    value: activeEventA?.name || '—',
                    accent: 'slate',
                  },
                  {
                    label: 'Current',
                    value: activeEventB?.name || '—',
                    accent: 'teal',
                  },
                  {
                    label: 'Missing In Current',
                    value: `${result?.missingInB.length || 0}`,
                    accent: 'rose',
                  },
                ]}
              />
            ) : null}
          </div>
        </Panel>

        {loading ? (
          <Panel title="Loading matchup" subtitle="Computing deltas, warrior scores, and tier spread.">
            <SkeletonSet rows={5} />
          </Panel>
        ) : null}

        {!loading && result ? (
          <>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <KpiCard label="Governors Compared" value={result.summary.totalGovernors} hint="Players found in both selected snapshots" tone="info" icon={<Users className="size-5" />} />
              <KpiCard label="Average Score" value={`${result.summary.avgWarriorScore}%`} hint="Warrior score across all matched players" tone="good" icon={<Sparkles className="size-5" />} animated={false} />
              <KpiCard label="Deadweight Flags" value={result.summary.deadweightCount} hint="Players with major power loss and weak combat output" tone={result.summary.deadweightCount ? 'bad' : 'neutral'} icon={<TrendingDown className="size-5" />} />
              <KpiCard label="Anomalies" value={result.summary.anomalyCount} hint="Comparison anomalies detected between the two snapshots" tone={result.summary.anomalyCount ? 'warn' : 'neutral'} icon={<TrendingUp className="size-5" />} />
            </div>

            <div className="grid gap-6 xl:grid-cols-[minmax(0,1.05fr)_minmax(320px,0.95fr)]">
              <Panel title="Matchup Story" subtitle={`${result.eventA.name} → ${result.eventB.name}`}>
                <div className="space-y-4">
                  <div className="rounded-[28px] border border-white/10 bg-[linear-gradient(145deg,rgba(14,19,31,0.94),rgba(8,11,19,0.92))] p-4 max-[390px]:rounded-[22px] max-[390px]:p-3.5 sm:p-5">
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div>
                        <div className="flex flex-wrap gap-2">
                          <StatusPill label="Spotlight Player" tone="warn" />
                          {spotlight.top ? <StatusPill label={`${spotlight.top.score}% score`} tone={scoreTone(spotlight.top.score)} /> : null}
                        </div>
                        <h2 className="mt-3 font-heading text-2xl text-white max-[390px]:text-xl sm:mt-4 sm:text-3xl">{spotlight.top?.governorName || 'No matchup yet'}</h2>
                        <p className="mt-2.5 max-w-2xl text-[13px] leading-5 text-white/56 max-[390px]:text-xs max-[390px]:leading-5 sm:mt-3 sm:text-sm sm:leading-6">Highest overall warrior score across the selected event pair. This is the fastest read on who converted the matchup into measurable output.</p>
                      </div>
                      <div className="rounded-[24px] border border-white/10 bg-white/4 px-4 py-3 text-left max-[390px]:rounded-[18px] sm:px-5 sm:py-4 sm:text-right">
                        <p className="text-[11px] uppercase tracking-[0.22em] text-white/36">Actual DKP</p>
                        <p className="mt-1.5 font-heading text-2xl text-white max-[390px]:text-xl sm:text-3xl">{spotlight.top ? formatCompactNumber(spotlight.top.actualDkp) : '—'}</p>
                        <p className="mt-1.5 text-[13px] text-white/48 max-[390px]:text-xs sm:text-sm">Top contributor lane</p>
                      </div>
                    </div>
                  </div>

                  <div className="grid gap-3 md:grid-cols-3">
                    <Card className="border-white/10 bg-white/4">
                      <CardContent className="space-y-2.5 p-4 max-[390px]:p-3.5 sm:p-5">
                        <p className="text-[11px] uppercase tracking-[0.18em] text-white/36">Top KP Delta</p>
                        <p className="font-heading text-xl text-white">{spotlight.topKills?.governorName || '—'}</p>
                        <p className="text-sm text-white/56">{spotlight.topKills ? formatCompactNumber(spotlight.topKills.killPointsDelta) : '—'} kill points gained</p>
                      </CardContent>
                    </Card>
                    <Card className="border-white/10 bg-white/4">
                      <CardContent className="space-y-2.5 p-4 max-[390px]:p-3.5 sm:p-5">
                        <p className="text-[11px] uppercase tracking-[0.18em] text-white/36">Top Deads Delta</p>
                        <p className="font-heading text-xl text-white">{spotlight.topDeads?.governorName || '—'}</p>
                        <p className="text-sm text-white/56">{spotlight.topDeads ? formatCompactNumber(spotlight.topDeads.deadsDelta) : '—'} deads recorded</p>
                      </CardContent>
                    </Card>
                    <Card className="border-white/10 bg-white/4">
                      <CardContent className="space-y-2.5 p-4 max-[390px]:p-3.5 sm:p-5">
                        <p className="text-[11px] uppercase tracking-[0.18em] text-white/36">Largest Power Swing</p>
                        <p className="font-heading text-xl text-white">{spotlight.biggestPowerSwing?.governor.name || '—'}</p>
                        <p className="text-sm text-white/56">{spotlight.biggestPowerSwing ? formatDelta(spotlight.biggestPowerSwing.deltas.power) : '—'} from baseline to current</p>
                      </CardContent>
                    </Card>
                  </div>
                </div>
              </Panel>

              <Panel title="Tier Distribution" subtitle="How the roster spreads across the warrior ladder and score buckets.">
                <div className="space-y-5">
                  <div className="grid gap-3">
                    {tierEntries.map((entry) => (
                      <div key={entry.tier} className="space-y-2">
                        <div className="flex items-center justify-between gap-3">
                          <StatusPill label={entry.tier} tone={tierTone(entry.tier)} />
                          <span className="text-sm text-white/62">{entry.value}</span>
                        </div>
                        <div className="h-2 overflow-hidden rounded-full bg-white/8">
                          <div
                            className="h-full rounded-full bg-[linear-gradient(90deg,#5a7fff,#7ce6ff)]"
                            style={{ width: `${(entry.value / tierMax) * 100}%` }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>

                  <MetricStrip
                    items={[
                      { label: '0-24', value: `${result.summary.scoreBuckets['0-24'] || 0}`, accent: 'rose' },
                      { label: '25-49', value: `${result.summary.scoreBuckets['25-49'] || 0}`, accent: 'slate' },
                      { label: '50-74', value: `${result.summary.scoreBuckets['50-74'] || 0}`, accent: 'teal' },
                      { label: '75-99', value: `${result.summary.scoreBuckets['75-99'] || 0}`, accent: 'gold' },
                      { label: '100+', value: `${result.summary.scoreBuckets['100+'] || 0}`, accent: 'gold' },
                    ]}
                  />
                </div>
              </Panel>
            </div>

            <Panel
              title="Warrior Board"
              subtitle="Sortable combat deltas with baseline and current context preserved row by row."
              actions={
                <FilterBar className="items-start sm:items-center">
                  <div className="relative min-w-0 w-full flex-1 sm:min-w-[220px]">
                    <Search className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-white/34" />
                    <Input
                      value={search}
                      onChange={(event) => setSearch(event.target.value)}
                      placeholder="Search governor name or ID"
                      className="rounded-full border-white/10 bg-white/4 pl-11 text-white placeholder:text-white/28 max-[390px]:h-9"
                    />
                  </div>
                  <div className="flex w-full flex-wrap gap-2 sm:w-auto">
                    <StatusPill label={`${result.missingInB.length} missing`} tone={result.missingInB.length ? 'warn' : 'neutral'} />
                    <StatusPill label={`${result.newInB.length} new`} tone={result.newInB.length ? 'info' : 'neutral'} />
                    <StatusPill label={`${result.summary.negativePowerCount} power drops`} tone={result.summary.negativePowerCount ? 'bad' : 'neutral'} />
                  </div>
                </FilterBar>
              }
            >
              <DataTableLite
                stickyFirst
                rows={sortedRows}
                rowKey={(row) => row.governor.id}
                columns={columns}
                onSort={(field) => {
                  const nextField = field as SortField;
                  if (sortField === nextField) {
                    setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'));
                    return;
                  }
                  setSortField(nextField);
                  setSortDir(nextField === 'rank' ? 'asc' : 'desc');
                }}
                sortKey={sortField}
                sortDir={sortDir}
                emptyLabel="No matched players for the current search."
              />
            </Panel>
          </>
        ) : null}

        {!loading && !result && (!eventAId || !eventBId) ? (
          <EmptyState title="Select two events" description="Choose a baseline and a current event to generate the head-to-head warrior board." />
        ) : null}

        {!loading && !result && eventAId && eventBId ? (
          <EmptyState title="No comparison data found" description="One or both events may not have compatible snapshots yet. Check ingestion or choose a different pair." />
        ) : null}
      </SessionGate>
    </div>
  );
}
