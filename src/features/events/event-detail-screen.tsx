'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Download, Search, Upload } from 'lucide-react';
import { useWorkspaceSession } from '@/lib/workspace-session';
import { abbreviateNumber, EVENT_TYPE_LABELS, formatDate } from '@/lib/utils';
import { InlineError, SessionGate } from '@/components/app/session-gate';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  DataTableLite,
  EmptyState,
  FilterBar,
  KpiCard,
  PageHero,
  Panel,
  SkeletonSet,
  StatusPill,
} from '@/components/ui/primitives';

interface SnapshotRow {
  id: string;
  governor: { id: string; governorId: string; name: string };
  power: string;
  killPoints: string;
  t4Kills: string;
  t5Kills: string;
  deads: string;
  verified: boolean;
}

interface EventDetail {
  id: string;
  name: string;
  eventType: string;
  createdAt: string;
  snapshots: SnapshotRow[];
}

export default function EventDetailScreen() {
  const params = useParams();
  const {
    workspaceId,
    accessToken,
    ready,
    loading: sessionLoading,
    error: sessionError,
    refreshSession,
  } = useWorkspaceSession();
  const [event, setEvent] = useState<EventDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [sortField, setSortField] = useState('power');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);

  const loadEvent = useCallback(async () => {
    const eventId = String(params.id || '');
    if (!eventId || !ready) {
      setEvent(null);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);
      const query = new URLSearchParams({ workspaceId });
      const res = await fetch(`/api/v2/events/${eventId}?${query.toString()}`, {
        headers: { 'x-access-token': accessToken },
      });
      const payload = await res.json();
      if (!res.ok) {
        throw new Error(payload?.error?.message || 'Failed to load event.');
      }
      setEvent(payload?.data || null);
    } catch (cause) {
      setEvent(null);
      setError(cause instanceof Error ? cause.message : 'Failed to load event.');
    } finally {
      setLoading(false);
    }
  }, [params.id, ready, workspaceId, accessToken]);

  useEffect(() => {
    void loadEvent();
  }, [loadEvent]);

  const sortedSnapshots = useMemo(() => {
    const rows = event?.snapshots || [];

    return rows
      .filter((item) => {
        const q = search.trim().toLowerCase();
        if (!q) return true;
        return item.governor.name.toLowerCase().includes(q) || item.governor.governorId.includes(q);
      })
      .sort((a, b) => {
        const aValue = Number((a as unknown as Record<string, unknown>)[sortField] || 0);
        const bValue = Number((b as unknown as Record<string, unknown>)[sortField] || 0);
        return sortDir === 'desc' ? bValue - aValue : aValue - bValue;
      });
  }, [event?.snapshots, search, sortDir, sortField]);

  const toggleSort = (field: string) => {
    if (sortField === field) {
      setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'));
      return;
    }
    setSortField(field);
    setSortDir('desc');
  };

  const exportCSV = () => {
    if (!event) return;

    const headers = 'Governor,ID,Power,Kill Points,T4 Kills,T5 Kills,Deads\n';
    const rows = sortedSnapshots
      .map(
        (row) =>
          `${row.governor.name},${row.governor.governorId},${row.power},${row.killPoints},${row.t4Kills},${row.t5Kills},${row.deads}`
      )
      .join('\n');

    const blob = new Blob([headers + rows], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${event.name.replace(/\s+/g, '_')}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4 sm:space-y-5 lg:space-y-6">
      <PageHero
        title={event?.name || 'Event Details'}
        subtitle="Snapshot table with sortable export-ready fields."
        badges={
          event
            ? [EVENT_TYPE_LABELS[event.eventType] || event.eventType, `Created ${formatDate(event.createdAt)}`]
            : undefined
        }
        actions={
          event ? (
            <>
              <Button
                variant="outline"
                className="rounded-full border-[color:var(--stroke-soft)] bg-[color:var(--surface-3)] text-tier-1 hover:bg-[color:var(--surface-4)] hover:text-tier-1"
                onClick={exportCSV}
              >
                <Download data-icon="inline-start" />
                Export CSV
              </Button>
              <Button
                asChild
                className="rounded-full bg-[linear-gradient(135deg,#5a7fff,#7ce6ff)] text-black hover:opacity-95"
              >
                <Link href="/upload">
                  <Upload data-icon="inline-start" />
                  Upload More
                </Link>
              </Button>
            </>
          ) : (
            <Button
              asChild
              className="rounded-full bg-[linear-gradient(135deg,#5a7fff,#7ce6ff)] text-black hover:opacity-95"
            >
              <Link href="/events">Back to Events</Link>
            </Button>
          )
        }
      />

      <SessionGate ready={ready} loading={sessionLoading} error={sessionError} onRetry={() => void refreshSession()}>
        {error ? <InlineError message={error} /> : null}

        {loading ? (
          <Panel title="Loading event" subtitle="Fetching snapshot rows and index metadata.">
            <SkeletonSet rows={4} />
          </Panel>
        ) : !event ? (
          <EmptyState
            title="Event not found"
            description="The requested event could not be loaded."
            action={
              <Button
                asChild
                className="rounded-full bg-[linear-gradient(135deg,#5a7fff,#7ce6ff)] text-black hover:opacity-95"
              >
                <Link href="/events">Back to Events</Link>
              </Button>
            }
          />
        ) : (
          <>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              <KpiCard label="Snapshots" value={event.snapshots.length} hint="Governor rows in this event" tone="info" />
              <KpiCard
                label="Verified Rows"
                value={event.snapshots.filter((snapshot) => snapshot.verified).length}
                hint="Rows marked verified"
                tone="good"
              />
              <KpiCard
                label="Event Type"
                value={EVENT_TYPE_LABELS[event.eventType] || event.eventType}
                hint={formatDate(event.createdAt)}
                tone="warn"
              />
            </div>

            <Panel
              title="Event Snapshot Rows"
              subtitle="Sort by power and combat fields"
              actions={
                <FilterBar className="w-full items-stretch sm:items-center">
                  <div className="relative min-w-0 w-full flex-1 sm:min-w-[220px]">
                    <Search className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-tier-3" />
                    <Input
                      placeholder="Search governor..."
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      className="rounded-full border-[color:var(--stroke-soft)] bg-[color:var(--surface-3)] pl-11 text-tier-1 placeholder:text-tier-3 "
                    />
                  </div>
                  <StatusPill label={`${sortedSnapshots.length} rows`} tone="info" />
                </FilterBar>
              }
            >
              <DataTableLite
                stickyFirst
                rows={sortedSnapshots}
                rowKey={(row) => row.id}
                onSort={toggleSort}
                sortKey={sortField}
                sortDir={sortDir}
                columns={[
                  {
                    key: 'rank',
                    label: '#',
                    className: 'num',
                    render: (_row, index) => index + 1,
                  },
                  {
                    key: 'governor',
                    label: 'Governor',
                    render: (row) => (
                      <>
                        <strong>{row.governor.name}</strong>
                        <div className="text-sm text-tier-3">ID {row.governor.governorId}</div>
                      </>
                    ),
                  },
                  {
                    key: 'power',
                    label: 'Power',
                    className: 'num',
                    sortable: true,
                    render: (row) => abbreviateNumber(row.power),
                  },
                  {
                    key: 'killPoints',
                    label: 'Kill Points',
                    className: 'num',
                    sortable: true,
                    render: (row) => abbreviateNumber(row.killPoints),
                  },
                  {
                    key: 't4Kills',
                    label: 'T4 Kills',
                    className: 'num',
                    sortable: true,
                    mobileHidden: true,
                    render: (row) => abbreviateNumber(row.t4Kills),
                  },
                  {
                    key: 't5Kills',
                    label: 'T5 Kills',
                    className: 'num',
                    sortable: true,
                    mobileHidden: true,
                    render: (row) => abbreviateNumber(row.t5Kills),
                  },
                  {
                    key: 'deads',
                    label: 'Deads',
                    className: 'num',
                    sortable: true,
                    mobileHidden: true,
                    render: (row) => abbreviateNumber(row.deads),
                  },
                ]}
                emptyLabel="No snapshot rows in this event."
              />
            </Panel>
          </>
        )}
      </SessionGate>
    </div>
  );
}
