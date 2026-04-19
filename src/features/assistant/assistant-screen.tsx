'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Bot,
  Check,
  Clock3,
  FileImage,
  MessageSquare,
  PanelRight,
  Plus,
  Send,
  User,
  Workflow,
  X,
} from 'lucide-react';
import { useWorkspaceSession } from '@/lib/workspace-session';
import { cn } from '@/lib/utils';
import { InlineError, SessionGate } from '@/components/app/session-gate';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { PageHero, Panel, StatusPill } from '@/components/ui/primitives';
import {
  type PendingResolutionDraft,
  type PlanActionRow,
  type PlanRow,
  type MessageRow,
  useAssistantController,
} from './use-assistant-controller';

type ContextTab = 'plans' | 'pending' | 'logs';

type ExecutionLogTone = 'info' | 'warn' | 'bad';

type ExecutionLogRow = {
  id: string;
  text: string;
  createdAt: string;
  tone: ExecutionLogTone;
};

function roleTone(role: MessageRow['role']): 'neutral' | 'info' | 'good' | 'warn' {
  if (role === 'ASSISTANT') return 'info';
  if (role === 'USER') return 'good';
  if (role === 'TOOL') return 'warn';
  return 'neutral';
}

function planTone(status: PlanRow['status']): 'neutral' | 'good' | 'warn' | 'bad' | 'info' {
  if (status === 'EXECUTED') return 'good';
  if (status === 'PENDING' || status === 'CONFIRMED') return 'warn';
  if (status === 'DENIED' || status === 'FAILED') return 'bad';
  return 'neutral';
}

function shorten(value: string, max = 120): string {
  const normalized = String(value || '').trim();
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, max - 1)}...`;
}

function parseCandidates(value: unknown): Array<{ governorDbId: string; governorGameId: string; governorName: string }> {
  if (!Array.isArray(value)) return [];
  const rows: Array<{ governorDbId: string; governorGameId: string; governorName: string }> = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const governorDbId = String(row.governorDbId || '').trim();
    const governorGameId = String(row.governorGameId || '').trim();
    const governorName = String(row.governorName || '').trim();
    if (!governorDbId) continue;
    rows.push({
      governorDbId,
      governorGameId,
      governorName,
    });
  }
  return rows;
}

function describeAction(action: PlanActionRow): string {
  const request = action.request || {};
  switch (request.type) {
    case 'register_player':
      return `Register ${String(request.name || 'player')} (${String(request.governorId || 'unknown id')})`;
    case 'update_player':
      return `Update player ${String(request.governorId || request.governorName || request.governorDbId || '')}`;
    case 'delete_player':
      return `Delete player ${String(request.governorId || request.governorName || request.governorDbId || '')}`;
    case 'create_event':
      return `Create event ${String(request.name || '')}`;
    case 'delete_event':
      return `Delete event ${String(request.eventId || request.eventName || '')}`;
    case 'record_profile_stats':
      return `Record stats for ${String(request.governorId || request.governorName || request.governorDbId || '')}`;
    default:
      return String(action.actionType || 'Action');
  }
}

function destructiveCount(plan: PlanRow): number {
  return plan.actions.filter((action) => {
    const request = action.request || {};
    return request.type === 'delete_player' || request.type === 'delete_event';
  }).length;
}

function getReadExecutions(meta: MessageRow['meta']): Array<Record<string, unknown>> {
  if (!meta || typeof meta !== 'object') return [];
  const reads = (meta as Record<string, unknown>).readExecutions;
  if (!Array.isArray(reads)) return [];
  return reads.filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object');
}

function StatusChip({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-xl border border-[color:var(--stroke-soft)] bg-[color:var(--surface-3)] px-3 py-2">
      <p className="text-[11px] uppercase tracking-wide text-tier-3">{label}</p>
      <p className="mt-1 text-sm font-medium text-tier-1">{value}</p>
    </div>
  );
}

function MessageBubble({ message }: { message: MessageRow }) {
  const isUser = message.role === 'USER';
  const isAssistant = message.role === 'ASSISTANT';
  const readExecutions = getReadExecutions(message.meta);
  const isTool = message.role === 'TOOL';

  return (
    <article
      className={cn(
        'max-w-[94%] rounded-2xl border px-3 py-2.5 shadow-[0_6px_18px_rgba(0,0,0,0.24)] sm:max-w-[88%]',
        isUser
          ? 'ml-auto border-cyan-400/35 bg-cyan-400/10'
          : isAssistant
            ? 'mr-auto border-sky-300/25 bg-sky-400/10'
            : isTool
              ? 'mr-auto border-amber-300/30 bg-amber-300/10'
              : 'mr-auto border-[color:var(--stroke-soft)] bg-[color:var(--surface-3)]'
      )}
    >
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <span
            className={cn(
              'inline-flex size-5 items-center justify-center rounded-full border text-xs',
              isUser
                ? 'border-cyan-300/40 bg-cyan-300/20 text-cyan-100'
                : isAssistant
                  ? 'border-sky-300/35 bg-sky-300/20 text-sky-50'
                  : 'border-[color:var(--stroke-soft)] bg-[color:var(--surface-4)] text-tier-2'
            )}
          >
            {isUser ? <User className="size-3" /> : isAssistant ? <Bot className="size-3" /> : <Workflow className="size-3" />}
          </span>
          <StatusPill label={message.role} tone={roleTone(message.role)} />
          {message.model ? <span className="text-[11px] text-tier-3">{message.model}</span> : null}
        </div>
        <span className="text-[11px] text-tier-3">{new Date(message.createdAt).toLocaleString()}</span>
      </div>

      <p className="whitespace-pre-wrap text-sm leading-6 text-tier-1">{message.content}</p>

      {message.attachments && message.attachments.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {message.attachments.map((attachment, index) => {
            const label = attachment.fileName || `attachment-${index + 1}`;
            if (!attachment.url) {
              return (
                <span
                  key={`${message.id}-attachment-${index}`}
                  className="inline-flex items-center gap-1 rounded-lg border border-[color:var(--stroke-soft)] bg-[color:var(--surface-4)] px-2 py-1 text-xs text-tier-2"
                >
                  <FileImage className="size-3" />
                  {label}
                </span>
              );
            }
            return (
              <a
                key={`${message.id}-attachment-${index}`}
                href={attachment.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 rounded-lg border border-[color:var(--stroke-soft)] bg-[color:var(--surface-4)] px-2 py-1 text-xs text-tier-2 hover:bg-[color:var(--surface-2)]"
              >
                <FileImage className="size-3" />
                {label}
              </a>
            );
          })}
        </div>
      ) : null}

      {readExecutions.length > 0 ? (
        <details className="mt-2 rounded-xl border border-[color:var(--stroke-soft)] bg-[color:var(--surface-4)] p-2 text-xs">
          <summary className="cursor-pointer font-medium text-tier-1">Read Tool Results ({readExecutions.length})</summary>
          <div className="mt-2 space-y-1.5 text-tier-2">
            {readExecutions.map((entry, index) => (
              <div key={`${message.id}-read-${index}`} className="rounded-md border border-[color:var(--stroke-soft)] bg-black/20 px-2 py-1">
                <p className="font-medium text-tier-1">{String(entry.actionType || 'read_action')}</p>
                <p className="text-tier-3">{shorten(String(entry.summary || 'Completed.'), 220)}</p>
              </div>
            ))}
          </div>
        </details>
      ) : null}
    </article>
  );
}

function PlanCard({
  plan,
  busyPlanId,
  onConfirm,
  onDeny,
}: {
  plan: PlanRow;
  busyPlanId: string | null;
  onConfirm: (id: string) => void;
  onDeny: (id: string) => void;
}) {
  const destructive = destructiveCount(plan);

  return (
    <div className="rounded-2xl border border-[color:var(--stroke-soft)] bg-[color:var(--surface-3)] p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <StatusPill label={plan.status} tone={planTone(plan.status)} />
          {destructive > 0 ? <StatusPill label={`Destructive ${destructive}`} tone="bad" /> : null}
          <StatusPill label={`${plan.actions.length} actions`} tone="neutral" />
        </div>
        <span className="text-[11px] text-tier-3">{new Date(plan.createdAt).toLocaleString()}</span>
      </div>

      <p className="text-sm text-tier-1">{plan.summary}</p>

      <div className="mt-2 space-y-1.5">
        {plan.actions.map((action) => (
          <div key={action.id} className="rounded-lg border border-[color:var(--stroke-soft)] bg-[color:var(--surface-4)] px-2.5 py-1.5 text-xs">
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium text-tier-1">{describeAction(action)}</span>
              <StatusPill
                label={action.status}
                tone={
                  action.status === 'EXECUTED'
                    ? 'good'
                    : action.status === 'FAILED'
                      ? 'bad'
                      : action.status === 'SKIPPED'
                        ? 'warn'
                        : 'neutral'
                }
              />
            </div>
            {action.error ? <p className="mt-1 text-rose-200">{action.error}</p> : null}
          </div>
        ))}
      </div>

      {plan.status === 'PENDING' ? (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            className="rounded-full bg-emerald-500 text-emerald-950 hover:bg-emerald-400"
            onClick={() => onConfirm(plan.id)}
            disabled={Boolean(busyPlanId)}
          >
            <Check data-icon="inline-start" />
            {busyPlanId === plan.id ? 'Confirming...' : 'Confirm Plan'}
          </Button>
          <Button
            variant="outline"
            className="rounded-full border-rose-300/35 text-rose-100 hover:bg-rose-500/15"
            onClick={() => onDeny(plan.id)}
            disabled={Boolean(busyPlanId)}
          >
            <X data-icon="inline-start" />
            {busyPlanId === plan.id ? 'Denying...' : 'Deny Plan'}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function PendingIdentityCard({
  row,
  draft,
  busyPendingId,
  setDraft,
  onResolve,
}: {
  row: {
    id: string;
    status: 'PENDING' | 'RESOLVED' | 'DENIED';
    reason: string | null;
    governorIdRaw: string | null;
    governorNameRaw: string;
    eventId: string | null;
    candidateGovernorIds?: unknown;
    createdAt: string;
  };
  draft: PendingResolutionDraft;
  busyPendingId: string | null;
  setDraft: (next: PendingResolutionDraft) => void;
  onResolve: (id: string) => void;
}) {
  const candidates = parseCandidates(row.candidateGovernorIds);

  return (
    <div className="rounded-2xl border border-[color:var(--stroke-soft)] bg-[color:var(--surface-3)] p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <StatusPill label={row.status} tone={row.status === 'RESOLVED' ? 'good' : row.status === 'DENIED' ? 'bad' : 'warn'} />
        <span className="text-[11px] text-tier-3">{new Date(row.createdAt).toLocaleString()}</span>
      </div>

      <div className="space-y-1 text-sm text-tier-2">
        <p>
          <span className="text-tier-3">Governor:</span> {row.governorNameRaw || '(unknown)'}
          {row.governorIdRaw ? ` (${row.governorIdRaw})` : ''}
        </p>
        {row.reason ? (
          <p className="flex items-center gap-1 text-amber-100">
            <AlertTriangle className="size-3.5" />
            {row.reason}
          </p>
        ) : null}
      </div>

      {candidates.length > 0 ? (
        <div className="mt-2 rounded-lg border border-[color:var(--stroke-soft)] bg-[color:var(--surface-4)] p-2 text-xs text-tier-2">
          {candidates.map((candidate) => (
            <p key={candidate.governorDbId}>
              {candidate.governorName} ({candidate.governorGameId}) - db: {candidate.governorDbId}
            </p>
          ))}
        </div>
      ) : null}

      {row.status === 'PENDING' ? (
        <div className="mt-3 space-y-2">
          <Input
            placeholder="Governor DB ID"
            value={draft.governorDbId}
            onChange={(event) =>
              setDraft({
                ...draft,
                governorDbId: event.target.value,
              })
            }
          />
          <Input
            placeholder="Event ID (optional)"
            value={draft.eventId}
            onChange={(event) =>
              setDraft({
                ...draft,
                eventId: event.target.value,
              })
            }
          />
          <Textarea
            rows={2}
            placeholder="Resolution note (optional)"
            value={draft.note}
            onChange={(event) =>
              setDraft({
                ...draft,
                note: event.target.value,
              })
            }
          />
          <Button
            className="rounded-full bg-[color:var(--primary)] text-primary-foreground hover:opacity-90"
            onClick={() => onResolve(row.id)}
            disabled={Boolean(busyPendingId)}
          >
            <Check data-icon="inline-start" />
            {busyPendingId === row.id ? 'Resolving...' : 'Resolve Identity'}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function ExecutionLogList({ rows }: { rows: ExecutionLogRow[] }) {
  if (rows.length === 0) {
    return <p className="text-sm text-tier-3">No execution logs yet.</p>;
  }

  return (
    <div className="space-y-2">
      {rows.slice(0, 150).map((row) => (
        <div key={row.id} className="rounded-xl border border-[color:var(--stroke-soft)] bg-[color:var(--surface-3)] px-3 py-2 text-xs">
          <div className="mb-1 flex items-center justify-between gap-2">
            <StatusPill label={row.tone === 'bad' ? 'Error' : row.tone === 'warn' ? 'Dropped' : 'Read'} tone={row.tone} />
            <span className="text-tier-3">{new Date(row.createdAt).toLocaleString()}</span>
          </div>
          <p className="text-tier-2">{row.text}</p>
        </div>
      ))}
    </div>
  );
}

export default function AssistantScreen({ handoffToken }: { handoffToken?: string | null }) {
  const {
    workspaceId,
    accessToken,
    ready: workspaceReady,
    loading: sessionLoading,
    error: sessionError,
  } = useWorkspaceSession();

  const [showMobileContext, setShowMobileContext] = useState(false);
  const [contextTab, setContextTab] = useState<ContextTab>('plans');

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const timelineRef = useRef<HTMLDivElement | null>(null);

  const controller = useAssistantController({
    workspaceId,
    accessToken,
    workspaceReady,
    handoffToken,
  });

  const pendingRows = useMemo(
    () => controller.history?.pendingIdentities || [],
    [controller.history?.pendingIdentities]
  );

  const sortedPlans = useMemo(
    () =>
      (controller.history?.plans || [])
        .slice()
        .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)),
    [controller.history?.plans]
  );

  const executionLogs = useMemo(() => {
    const rows: ExecutionLogRow[] = [];
    for (const message of controller.history?.messages || []) {
      if (message.role !== 'ASSISTANT' || !message.meta || typeof message.meta !== 'object') continue;
      const meta = message.meta as Record<string, unknown>;
      const reads = Array.isArray(meta.readExecutions) ? meta.readExecutions : [];
      for (const read of reads) {
        if (!read || typeof read !== 'object') continue;
        const row = read as Record<string, unknown>;
        const actionType = String(row.actionType || 'read_action');
        const summary = String(row.summary || '').trim() || 'Completed';
        const error = String(row.error || '').trim();
        rows.push({
          id: `${message.id}-${actionType}-${rows.length}`,
          text: `${actionType}: ${error || summary}`,
          createdAt: message.createdAt,
          tone: error ? 'bad' : 'info',
        });
      }

      const dropped = Array.isArray(meta.droppedActions) ? meta.droppedActions : [];
      for (const item of dropped) {
        if (!item || typeof item !== 'object') continue;
        const row = item as Record<string, unknown>;
        rows.push({
          id: `${message.id}-drop-${rows.length}`,
          text: `Dropped ${String(row.type || 'action')}: ${String(row.reason || 'invalid')}`,
          createdAt: message.createdAt,
          tone: 'warn',
        });
      }
    }
    return rows.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  }, [controller.history?.messages]);

  const pendingPlan = controller.latestPendingPlan;

  const pendingIdentityCount = useMemo(
    () => pendingRows.filter((row) => row.status === 'PENDING').length,
    [pendingRows]
  );

  useEffect(() => {
    if (!timelineRef.current) return;
    timelineRef.current.scrollTop = timelineRef.current.scrollHeight;
  }, [controller.selectedConversationId, controller.history?.messages?.length]);

  const contextTabs = (
    <Tabs
      value={contextTab}
      onValueChange={(next) => setContextTab((next as ContextTab) || 'plans')}
      className="h-full"
    >
      <TabsList className="w-full justify-start rounded-xl border border-[color:var(--stroke-soft)] bg-[color:var(--surface-3)] p-1">
        <TabsTrigger value="plans" className="data-active:bg-[color:var(--surface-1)] data-active:text-tier-1">
          Plans
        </TabsTrigger>
        <TabsTrigger value="pending" className="data-active:bg-[color:var(--surface-1)] data-active:text-tier-1">
          Pending
        </TabsTrigger>
        <TabsTrigger value="logs" className="data-active:bg-[color:var(--surface-1)] data-active:text-tier-1">
          Logs
        </TabsTrigger>
      </TabsList>

      <TabsContent value="plans" className="mt-3 space-y-3">
        {sortedPlans.length === 0 ? (
          <p className="text-sm text-tier-3">No plans generated yet.</p>
        ) : (
          sortedPlans.map((plan) => (
            <PlanCard
              key={plan.id}
              plan={plan}
              busyPlanId={controller.busyPlanId}
              onConfirm={(id) => void controller.confirmPlan(id)}
              onDeny={(id) => void controller.denyPlan(id)}
            />
          ))
        )}
      </TabsContent>

      <TabsContent value="pending" className="mt-3 space-y-3">
        {pendingRows.length === 0 ? (
          <p className="text-sm text-tier-3">No pending identity resolutions.</p>
        ) : (
          pendingRows.map((row) => {
            const candidates = parseCandidates(row.candidateGovernorIds);
            const draft =
              controller.resolveDrafts[row.id] ||
              ({
                governorDbId: candidates[0]?.governorDbId || '',
                eventId: row.eventId || '',
                note: '',
              } satisfies PendingResolutionDraft);

            return (
              <PendingIdentityCard
                key={row.id}
                row={row}
                draft={draft}
                busyPendingId={controller.busyPendingId}
                setDraft={(next) =>
                  controller.setResolveDrafts((prev) => ({
                    ...prev,
                    [row.id]: next,
                  }))
                }
                onResolve={(id) => void controller.resolvePendingIdentity(id)}
              />
            );
          })
        )}
      </TabsContent>

      <TabsContent value="logs" className="mt-3">
        <ExecutionLogList rows={executionLogs} />
      </TabsContent>
    </Tabs>
  );

  return (
    <div className="space-y-4 sm:space-y-5 lg:space-y-6">
      <PageHero
        title="Assistant"
        subtitle="Operational cockpit for screenshot analysis, read-surface queries, and one-step execution of full write plans."
        badges={['Mistral OCR', 'Read Tools Auto-Run', 'Single Plan Confirmation']}
        actions={
          <Button
            variant="outline"
            className="rounded-full border-[color:var(--stroke-soft)] bg-[color:var(--surface-3)] text-tier-1 hover:bg-[color:var(--surface-4)] xl:hidden"
            onClick={() => setShowMobileContext((prev) => !prev)}
          >
            <PanelRight data-icon="inline-start" />
            {showMobileContext ? 'Hide Context' : 'Show Context'}
          </Button>
        }
      />

      <SessionGate ready={workspaceReady} loading={sessionLoading} error={sessionError}>
        {controller.error ? <InlineError message={controller.error} /> : null}

        {controller.handoffContext ? (
          <div className="rounded-2xl border border-sky-300/25 bg-sky-400/10 px-4 py-3 text-sm text-sky-100">
            <p className="font-medium">Source: {controller.handoffContext.title}</p>
            <p className="mt-1 text-sky-100/80">{controller.handoffContext.summary || 'Context imported from another workflow.'}</p>
          </div>
        ) : null}

        {controller.notice ? (
          <div className="rounded-2xl border border-emerald-300/20 bg-emerald-400/10 px-4 py-3 text-sm text-emerald-100">
            {controller.notice}
          </div>
        ) : null}

        {pendingPlan ? (
          <div className="sticky top-2 z-20 rounded-2xl border border-amber-300/20 bg-amber-300/10 px-4 py-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="space-y-1">
                <p className="text-sm font-medium text-amber-100">Pending write plan ready</p>
                <p className="text-xs text-amber-100/80">{shorten(pendingPlan.summary, 140)}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <StatusPill label={`${pendingPlan.actions.length} actions`} tone="warn" />
                {destructiveCount(pendingPlan) > 0 ? (
                  <StatusPill label={`${destructiveCount(pendingPlan)} destructive`} tone="bad" />
                ) : null}
                <Button
                  size="sm"
                  className="rounded-full bg-emerald-500 text-emerald-950 hover:bg-emerald-400"
                  onClick={() => void controller.confirmPlan(pendingPlan.id)}
                  disabled={Boolean(controller.busyPlanId)}
                >
                  <Check data-icon="inline-start" />
                  Confirm Latest Plan
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="rounded-full border-rose-300/35 text-rose-100 hover:bg-rose-500/15"
                  onClick={() => void controller.denyPlan(pendingPlan.id)}
                  disabled={Boolean(controller.busyPlanId)}
                >
                  <X data-icon="inline-start" />
                  Deny
                </Button>
              </div>
            </div>
          </div>
        ) : null}

        <div className="grid gap-4 xl:grid-cols-[300px_minmax(0,1fr)_390px]">
          <Panel
            title="Conversations"
            subtitle="Workspace threads"
            className="xl:sticky xl:top-4 xl:max-h-[calc(100dvh-164px)] xl:overflow-y-auto"
            actions={
              <Button
                variant="outline"
                className="rounded-full border-[color:var(--stroke-soft)] bg-[color:var(--surface-3)] text-tier-1 hover:bg-[color:var(--surface-4)]"
                onClick={async () => {
                  try {
                    controller.setError(null);
                    const id = await controller.createConversation();
                    await controller.refreshConversation();
                    await controller.reloadHistory(id);
                  } catch (cause) {
                    controller.setError(cause instanceof Error ? cause.message : 'Failed to create conversation.');
                  }
                }}
                disabled={controller.loadingConversations}
              >
                <Plus data-icon="inline-start" />
                New
              </Button>
            }
          >
            <div className="space-y-3">
              <div className="grid gap-2 sm:grid-cols-3 xl:grid-cols-1 2xl:grid-cols-3">
                <StatusChip label="Threads" value={controller.conversations.length} />
                <StatusChip label="Pending Plans" value={sortedPlans.filter((plan) => plan.status === 'PENDING').length} />
                <StatusChip label="Unresolved IDs" value={pendingIdentityCount} />
              </div>

              <div className="space-y-2">
                {controller.loadingConversations ? (
                  <p className="text-sm text-tier-3">Loading conversations...</p>
                ) : controller.conversations.length === 0 ? (
                  <p className="text-sm text-tier-3">No conversations yet.</p>
                ) : (
                  controller.conversations.map((row) => (
                    <button
                      key={row.id}
                      type="button"
                      onClick={() => controller.setSelectedConversationId(row.id)}
                      className={cn(
                        'w-full rounded-2xl border px-3 py-2.5 text-left transition-all duration-200',
                        row.id === controller.selectedConversationId
                          ? 'border-[color:var(--primary)] bg-[color:color-mix(in_oklab,var(--primary)_16%,transparent)] text-tier-1 shadow-[0_0_0_1px_color-mix(in_oklab,var(--primary)_26%,transparent)]'
                          : 'border-[color:var(--stroke-soft)] bg-[color:var(--surface-3)] text-tier-2 hover:bg-[color:var(--surface-4)]'
                      )}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-sm font-medium">{shorten(row.title || 'Untitled Conversation', 48)}</p>
                        {typeof row.counts?.pendingIdentities === 'number' && row.counts.pendingIdentities > 0 ? (
                          <StatusPill label={`${row.counts.pendingIdentities}`} tone="warn" className="px-2 py-0.5 text-xs" />
                        ) : null}
                      </div>
                      <p className="mt-1 text-xs text-tier-3">{shorten(row.lastMessage?.content || 'No messages yet', 68)}</p>
                      <div className="mt-2 flex items-center gap-2 text-[11px] text-tier-3">
                        <Clock3 className="size-3" />
                        <span>{new Date(row.updatedAt).toLocaleString()}</span>
                      </div>
                    </button>
                  ))
                )}
              </div>
            </div>
          </Panel>

          <Panel
            title="Chat"
            subtitle="Send instructions, screenshots, and handoff artifacts."
            className="xl:min-h-[calc(100dvh-164px)]"
          >
            <div className="flex min-h-[560px] flex-col gap-3 lg:min-h-[620px] xl:h-[calc(100dvh-250px)]">
              <div className="rounded-xl border border-[color:var(--stroke-soft)] bg-[color:var(--surface-3)] px-3 py-2 text-xs text-tier-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5">
                    <MessageSquare className="size-3.5" />
                    <span>
                      Active thread:{' '}
                      <span className="font-medium text-tier-1">
                        {shorten(
                          controller.conversations.find((row) => row.id === controller.selectedConversationId)?.title || 'Untitled Conversation',
                          52
                        )}
                      </span>
                    </span>
                  </div>
                  <span>{controller.history?.messages?.length || 0} messages</span>
                </div>
              </div>

              <div
                ref={timelineRef}
                className="flex-1 space-y-2 overflow-y-auto rounded-2xl border border-[color:var(--stroke-soft)] bg-[color:var(--surface-2)] p-3"
              >
                {controller.loadingHistory ? (
                  <p className="text-sm text-tier-3">Loading messages...</p>
                ) : !controller.history?.messages?.length ? (
                  <p className="text-sm text-tier-3">No messages in this conversation yet.</p>
                ) : (
                  controller.history.messages.map((msg) => <MessageBubble key={msg.id} message={msg} />)
                )}
              </div>

              <div className="space-y-2 rounded-2xl border border-[color:var(--stroke-soft)] bg-[color:var(--surface-2)] p-3">
                <Textarea
                  placeholder="Ask for reads, register/update players, record stats, or create/delete events..."
                  value={controller.messageText}
                  onChange={(event) => controller.setMessageText(event.target.value)}
                  rows={4}
                  onKeyDown={(event) => {
                    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
                      event.preventDefault();
                      void controller.submitMessage();
                    }
                  }}
                />

                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  multiple
                  className="hidden"
                  onChange={(event) => {
                    const files = Array.from(event.target.files || []);
                    controller.setMessageFiles(files);
                  }}
                />

                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    variant="outline"
                    className="rounded-full border-[color:var(--stroke-soft)] bg-[color:var(--surface-3)] text-tier-1 hover:bg-[color:var(--surface-4)]"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <FileImage data-icon="inline-start" />
                    Add Screenshots
                  </Button>

                  {(controller.messageFiles.length > 0 || controller.artifactRefs.length > 0) ? (
                    <Button
                      variant="outline"
                      className="rounded-full border-[color:var(--stroke-soft)] bg-[color:var(--surface-3)] text-tier-1 hover:bg-[color:var(--surface-4)]"
                      onClick={() => {
                        controller.setMessageFiles([]);
                        controller.setArtifactRefs([]);
                        if (fileInputRef.current) fileInputRef.current.value = '';
                      }}
                    >
                      <X data-icon="inline-start" />
                      Clear Attachments
                    </Button>
                  ) : null}
                </div>

                {controller.messageFiles.length > 0 ? (
                  <div className="rounded-xl border border-[color:var(--stroke-soft)] bg-[color:var(--surface-3)] px-3 py-2 text-xs text-tier-2">
                    Local files: {controller.messageFiles.map((file) => file.name).join(' • ')}
                  </div>
                ) : null}

                {controller.artifactRefs.length > 0 ? (
                  <div className="rounded-xl border border-sky-300/25 bg-sky-400/10 px-3 py-2 text-xs text-sky-100">
                    Handoff artifacts: {controller.artifactRefs.map((file) => file.fileName || file.artifactId).join(' • ')}
                  </div>
                ) : null}

                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs text-tier-3">Tip: Press Ctrl/Cmd + Enter to send.</p>
                  <Button
                    className="rounded-full bg-[color:var(--primary)] text-primary-foreground hover:opacity-90"
                    onClick={() => void controller.submitMessage()}
                    disabled={controller.sendingMessage || controller.loadingHistory}
                  >
                    <Send data-icon="inline-start" />
                    {controller.sendingMessage ? 'Sending...' : 'Send'}
                  </Button>
                </div>
              </div>
            </div>
          </Panel>

          <Panel
            title="Context"
            subtitle="Plans, pending identity resolutions, and execution traces."
            className="hidden xl:block xl:sticky xl:top-4 xl:max-h-[calc(100dvh-164px)] xl:overflow-y-auto"
          >
            {contextTabs}
          </Panel>
        </div>

        {showMobileContext ? (
          <div className="fixed inset-x-0 bottom-0 top-[12%] z-40 overflow-y-auto border-t border-[color:var(--stroke-soft)] bg-[color:var(--surface-1)] p-4 shadow-2xl xl:hidden">
            <div className="mb-3 flex items-center justify-between">
              <p className="font-heading text-sm text-tier-1">Assistant Context</p>
              <Button variant="outline" className="rounded-full" onClick={() => setShowMobileContext(false)}>
                <X data-icon="inline-start" />
                Close
              </Button>
            </div>
            {contextTabs}
          </div>
        ) : null}
      </SessionGate>
    </div>
  );
}
