'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { CalendarPlus, Search, Trash2, Upload } from 'lucide-react';
import { useWorkspaceSession } from '@/lib/workspace-session';
import { formatDate, EVENT_TYPE_LABELS } from '@/lib/utils';
import { InlineError, SessionGate } from '@/components/app/session-gate';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  ActionFooter,
  CompactControlDrawer,
  CompactControlRow,
  EmptyState,
  KpiCard,
  PageHero,
  Panel,
  SkeletonSet,
  StatusPill,
} from '@/components/ui/primitives';

interface EventItem {
  id: string;
  name: string;
  description: string | null;
  eventType: string;
  snapshotCount: number;
  createdAt: string;
}

export default function EventsPage() {
  const {
    workspaceId,
    accessToken,
    ready: workspaceReady,
    loading: sessionLoading,
    error: sessionError,
  } = useWorkspaceSession();

  const [events, setEvents] = useState<EventItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newType, setNewType] = useState('CUSTOM');
  const [newDesc, setNewDesc] = useState('');
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('ALL');
  const [error, setError] = useState<string | null>(null);

  const fetchEvents = useCallback(async () => {
    if (!workspaceReady) {
      setEvents([]);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const params = new URLSearchParams({
        workspaceId,
        limit: '200',
      });
      const res = await fetch(`/api/v2/events?${params.toString()}`, {
        headers: {
          'x-access-token': accessToken,
        },
      });
      const payload = await res.json();
      if (!res.ok) {
        throw new Error(payload?.error?.message || 'Failed to load events.');
      }

      setEvents(Array.isArray(payload?.data) ? payload.data : []);
    } catch (cause) {
      setEvents([]);
      setError(cause instanceof Error ? cause.message : 'Failed to load events.');
    } finally {
      setLoading(false);
    }
  }, [workspaceId, accessToken, workspaceReady]);

  useEffect(() => {
    void fetchEvents();
  }, [fetchEvents]);

  const createEvent = async () => {
    if (!newName.trim()) return;
    if (!workspaceReady) {
      setError(sessionLoading ? 'Connecting workspace session...' : 'Workspace session is not ready.');
      return;
    }

    try {
      setError(null);

      const res = await fetch('/api/v2/events', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-access-token': accessToken,
        },
        body: JSON.stringify({
          workspaceId,
          name: newName.trim(),
          eventType: newType,
          description: newDesc.trim() || null,
        }),
      });
      const payload = await res.json();
      if (!res.ok) {
        throw new Error(payload?.error?.message || 'Failed to create event.');
      }

      setNewName('');
      setNewDesc('');
      setShowCreate(false);
      await fetchEvents();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Failed to create event.');
    }
  };

  const deleteEvent = async (id: string) => {
    if (!workspaceReady) {
      setError(sessionLoading ? 'Connecting workspace session...' : 'Workspace session is not ready.');
      return;
    }
    if (!confirm('Delete this event and all its snapshots?')) return;

    try {
      setError(null);
      const params = new URLSearchParams({ workspaceId });
      const res = await fetch(`/api/v2/events/${id}?${params.toString()}`, {
        method: 'DELETE',
        headers: {
          'x-access-token': accessToken,
        },
      });
      const payload = await res.json();
      if (!res.ok) {
        throw new Error(payload?.error?.message || 'Failed to delete event.');
      }

      await fetchEvents();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Failed to delete event.');
    }
  };

  const kvkCount = events.filter((event) => event.eventType.includes('KVK')).length;

  const eventTypeOptions = useMemo(() => {
    const distinct = Array.from(new Set(events.map((event) => event.eventType))).sort();
    return ['ALL', ...distinct];
  }, [events]);

  const filteredEvents = useMemo(() => {
    return events
      .filter((event) => {
        const matchesType = typeFilter === 'ALL' ? true : event.eventType === typeFilter;
        const q = search.trim().toLowerCase();
        const matchesSearch =
          q.length === 0 ||
          event.name.toLowerCase().includes(q) ||
          String(EVENT_TYPE_LABELS[event.eventType] || event.eventType)
            .toLowerCase()
            .includes(q);
        return matchesType && matchesSearch;
      })
      .sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
  }, [events, search, typeFilter]);

  return (
    <div className="space-y-4 sm:space-y-5 lg:space-y-6">
      <PageHero
        title="Events"
        subtitle="Manage event checkpoints for compare, insights, and ranking workflows."
        actions={
          <>
            <Button
              asChild
              variant="outline"
              className="rounded-full border-[color:var(--stroke-soft)] bg-[color:var(--surface-3)] text-tier-1 hover:bg-[color:var(--surface-4)] hover:text-tier-1"
            >
              <Link href="/upload">
                <Upload data-icon="inline-start" />
                Upload
              </Link>
            </Button>
            <Button
              className="rounded-full bg-[color:var(--primary)] text-primary-foreground hover:opacity-90 shadow-lg hover:opacity-95"
              onClick={() => setShowCreate(true)}
            >
              <CalendarPlus data-icon="inline-start" />
              Create Event
            </Button>
          </>
        }
      />

      <SessionGate ready={workspaceReady} loading={sessionLoading} error={sessionError} onRetry={() => void fetchEvents()}>
        {error ? <InlineError message={error} /> : null}

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <KpiCard label="Total Events" value={events.length} hint="Tracked event checkpoints" tone="info" />
          <KpiCard label="KvK Events" value={kvkCount} hint="Events tagged with KvK type" tone="warn" />
          <KpiCard
            label="Snapshots Indexed"
            value={events.reduce((sum, event) => sum + event.snapshotCount, 0)}
            hint="Profile rows across all events"
            tone="good"
          />
        </div>

        <Panel
          title="Event Registry"
          subtitle="Search, filter, and manage event snapshots."
          actions={
            <CompactControlRow className="w-full">
              <div className="relative w-[228px] min-w-[228px]">
                <Search className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-tier-3" />
                <Input
                  placeholder="Search events..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="rounded-full border-[color:var(--stroke-soft)] bg-[color:var(--surface-3)] pl-11 text-tier-1 placeholder:text-tier-3 "
                />
              </div>
              <StatusPill label={`${filteredEvents.length} visible`} tone="info" />
              <CompactControlDrawer triggerLabel="Filters" title="Event Filters" description="Compact type filter for mobile and tablet.">
                <Select value={typeFilter} onValueChange={setTypeFilter}>
                  <SelectTrigger className="w-full rounded-full border-[color:var(--stroke-soft)] bg-[color:var(--surface-3)] text-tier-1">
                    <SelectValue placeholder="Type" />
                  </SelectTrigger>
                  <SelectContent className="border-[color:var(--stroke-soft)] bg-popover backdrop-blur-xl shadow-2xl text-tier-1">
                    {eventTypeOptions.map((option) => (
                      <SelectItem key={option} value={option}>
                        {option === 'ALL' ? 'All Types' : EVENT_TYPE_LABELS[option] || option}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </CompactControlDrawer>
            </CompactControlRow>
          }
        >
          {loading ? (
            <SkeletonSet rows={4} />
          ) : filteredEvents.length === 0 ? (
            <EmptyState
              title={events.length === 0 ? 'No events yet' : 'No matching events'}
              description={
                events.length === 0
                  ? 'Create your first event to start collecting snapshots.'
                  : 'Try a different search or type filter.'
              }
              action={
                <Button
                  className="rounded-full bg-[color:var(--primary)] text-primary-foreground hover:opacity-90 shadow-lg hover:opacity-95"
                  onClick={() => setShowCreate(true)}
                >
                  Create Event
                </Button>
              }
            />
          ) : (
            <div className="grid gap-3">
              {filteredEvents.map((event) => (
                <article
                  key={event.id}
                  className="rounded-[20px] surface-2 p-3 min-[390px]:rounded-[22px] min-[390px]:p-3.5 sm:rounded-[24px] sm:p-4"
                >
                  <div className="space-y-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusPill
                        label={EVENT_TYPE_LABELS[event.eventType] || event.eventType}
                        tone={event.eventType.includes('KVK') ? 'warn' : 'info'}
                      />
                      <StatusPill label={`${event.snapshotCount} governors`} tone="neutral" />
                      <StatusPill label={formatDate(event.createdAt)} tone="neutral" />
                    </div>
                    <div>
                      <p className="clamp-title-mobile font-heading text-base text-tier-1 min-[390px]:text-lg sm:text-xl" title={event.name}>{event.name}</p>
                      {event.description ? (
                        <p className="clamp-secondary mt-1.5 text-xs text-tier-3 min-[390px]:text-sm" title={event.description}>{event.description}</p>
                      ) : null}
                    </div>
                  </div>
                  <ActionFooter>
                    <Button
                      asChild
                      variant="outline"
                      className="h-11 rounded-full border-[color:var(--stroke-soft)] bg-[color:var(--surface-3)] text-tier-1 hover:bg-[color:var(--surface-4)] hover:text-tier-1"
                    >
                      <Link href={`/events/${event.id}`}>View</Link>
                    </Button>
                    <Button
                      asChild
                      variant="outline"
                      className="h-11 rounded-full border-[color:var(--stroke-soft)] bg-[color:var(--surface-3)] text-tier-1 hover:bg-[color:var(--surface-4)] hover:text-tier-1"
                    >
                      <Link href={`/compare?eventA=${event.id}`}>Compare</Link>
                    </Button>
                    <Button
                      variant="destructive"
                      className="h-11 rounded-full"
                      onClick={() => deleteEvent(event.id)}
                    >
                      <Trash2 data-icon="inline-start" />
                      Delete
                    </Button>
                  </ActionFooter>
                </article>
              ))}
            </div>
          )}
        </Panel>
      </SessionGate>

      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="border-[color:var(--stroke-soft)] bg-popover backdrop-blur-xl shadow-2xl text-tier-1 sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="font-heading text-xl text-tier-1">Create Event</DialogTitle>
            <DialogDescription className="text-tier-3">
              Add a new event checkpoint for rankings and compare surfaces.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="space-y-2">
              <label className="text-xs  text-tier-3">Event Name</label>
              <Input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="e.g., KvK S3 - Start"
                autoFocus
                className="rounded-2xl border-[color:var(--stroke-soft)] bg-[color:var(--surface-3)] text-tier-1 placeholder:text-tier-3"
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs  text-tier-3">Event Type</label>
              <Select value={newType} onValueChange={setNewType}>
                <SelectTrigger className="rounded-2xl border-[color:var(--stroke-soft)] bg-[color:var(--surface-3)] text-tier-1">
                  <SelectValue placeholder="Choose type" />
                </SelectTrigger>
                <SelectContent className="border-[color:var(--stroke-soft)] bg-popover backdrop-blur-xl shadow-2xl text-tier-1">
                  {Object.entries(EVENT_TYPE_LABELS).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <label className="text-xs  text-tier-3">Description</label>
              <Input
                value={newDesc}
                onChange={(e) => setNewDesc(e.target.value)}
                placeholder="Optional notes"
                className="rounded-2xl border-[color:var(--stroke-soft)] bg-[color:var(--surface-3)] text-tier-1 placeholder:text-tier-3"
              />
            </div>
          </div>
          <DialogFooter className="gap-2 sm:justify-end">
            <Button
              variant="outline"
              className="rounded-full border-[color:var(--stroke-soft)] bg-[color:var(--surface-3)] text-tier-1 hover:bg-[color:var(--surface-4)] hover:text-tier-1"
              onClick={() => setShowCreate(false)}
            >
              Cancel
            </Button>
            <Button
              className="rounded-full bg-[color:var(--primary)] text-primary-foreground hover:opacity-90 shadow-lg hover:opacity-95"
              onClick={createEvent}
            >
              Create Event
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
