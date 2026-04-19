'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Bot,
  Check,
  Clock3,
  FileImage,
  Plus,
  Play,
  Send,
  User,
  Workflow,
  X,
} from 'lucide-react';
import { useWorkspaceSession } from '@/lib/workspace-session';
import { cn } from '@/lib/utils';
import { SessionGate } from '@/components/app/session-gate';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { Panel, StatusPill } from '@/components/ui/primitives';
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

function batchFlagReasonLabel(reason: string): string {
  switch (reason) {
    case 'non_safe_actions':
      return 'Contains non-safe actions';
    case 'pending_identity':
      return 'Needs identity resolution';
    case 'action_failed':
      return 'Auto-confirm action failed';
    case 'no_high_confidence_identity':
      return 'No >=93% identity match';
    case 'unexpected_error':
      return 'Unexpected processing error';
    default:
      return reason;
  }
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
  const isTool = message.role === 'TOOL';
  const readExecutions = getReadExecutions(message.meta);

  return (
    <article className={cn("group relative flex flex-col gap-2 w-full", isUser ? "items-end" : "items-start")}>
      <div
        className={cn(
          'flex w-full max-w-[85%] flex-col gap-2',
          isUser ? 'items-end' : 'items-start'
        )}
      >
        <div
          className={cn(
            'flex items-start gap-3',
            isUser ? 'flex-row-reverse' : 'flex-row'
          )}
        >
          {/* Avatar */}
          <div
            className={cn(
              'flex size-8 shrink-0 select-none items-center justify-center rounded-md border shadow-sm',
              isUser
                ? 'bg-background border-border'
                : isAssistant
                ? 'bg-primary text-primary-foreground border-primary'
                : 'bg-muted border-border text-muted-foreground'
            )}
          >
            {isUser ? <User className="size-4" /> : isAssistant ? <Bot className="size-4" /> : <Workflow className="size-4" />}
          </div>

          {/* Message Content */}
          <div
            className={cn(
              'flex flex-col gap-2',
              isUser ? 'items-end' : 'items-start'
            )}
          >
            <div
              className={cn(
                'relative flex flex-col gap-2 rounded-xl px-4 py-3 text-sm leading-relaxed',
                isUser
                  ? 'bg-muted text-foreground'
                  : 'bg-transparent px-0 py-1'
              )}
            >
              <div className="prose dark:prose-invert prose-sm max-w-none break-words">
                {message.content}
              </div>
              
              {message.attachments && message.attachments.length > 0 ? (
                <div className="mt-2 flex flex-wrap gap-2">
                  {message.attachments.map((attachment, index) => {
                    const label = attachment.fileName || `attachment-${index + 1}`;
                    if (!attachment.url) {
                      return (
                        <div
                          key={`${message.id}-attachment-${index}`}
                          className="flex items-center gap-2 rounded-lg border bg-background px-3 py-2 text-xs font-medium"
                        >
                          <FileImage className="size-4 text-muted-foreground" />
                          <span className="truncate max-w-[150px]">{label}</span>
                        </div>
                      );
                    }
                    return (
                      <a
                        key={`${message.id}-attachment-${index}`}
                        href={attachment.url}
                        target="_blank"
                        rel="noreferrer"
                        className="flex items-center gap-2 rounded-lg border bg-background px-3 py-2 text-xs font-medium hover:bg-muted transition-colors"
                      >
                        <FileImage className="size-4 text-muted-foreground" />
                        <span className="truncate max-w-[150px]">{label}</span>
                      </a>
                    );
                  })}
                </div>
              ) : null}

              {readExecutions.length > 0 ? (
                <div className="mt-3 rounded-lg border bg-muted/50 p-3 text-xs">
                  <div className="flex items-center gap-2 font-medium mb-2 text-muted-foreground">
                    <Workflow className="size-3.5" />
                    <span>Tool Invocations ({readExecutions.length})</span>
                  </div>
                  <div className="space-y-2">
                    {readExecutions.map((entry, index) => (
                      <div key={`${message.id}-read-${index}`} className="flex flex-col gap-1">
                        <span className="font-semibold text-foreground">{String(entry.actionType || 'read_action')}</span>
                        <span className="text-muted-foreground">{shorten(String(entry.summary || 'Completed.'), 220)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
            
            <div className={cn("text-[10px] text-muted-foreground flex items-center gap-2", isUser ? "flex-row-reverse" : "flex-row")}>
              {message.model ? <span>{message.model}</span> : null}
              <span>{new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
            </div>
          </div>
        </div>
      </div>
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
    <div className="rounded-2xl border border-amber-500/20 bg-gradient-to-b from-amber-500/5 to-transparent p-4 shadow-lg relative overflow-hidden">
      <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-amber-400/0 via-amber-400/50 to-amber-400/0" />
      
      <div className="mb-3 flex items-center justify-between gap-2">
        <StatusPill label={row.status} tone={row.status === 'RESOLVED' ? 'good' : row.status === 'DENIED' ? 'bad' : 'warn'} />
        <span className="text-[11px] text-tier-4 font-mono">{new Date(row.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
      </div>

      <div className="mb-4 space-y-1.5">
        <p className="text-[11px] uppercase tracking-wider text-amber-200/70 font-semibold">Unmapped Identity</p>
        <div className="flex flex-col gap-1 rounded-xl bg-black/20 p-3 border border-white/5">
          <p className="text-lg font-heading text-amber-100 drop-shadow-sm">{row.governorNameRaw || '(unknown)'}</p>
          {row.governorIdRaw ? <p className="text-xs font-mono text-amber-200/60">ID: {row.governorIdRaw}</p> : null}
          {row.reason ? (
            <p className="mt-1 flex items-center gap-1.5 text-xs text-rose-300 bg-rose-500/10 px-2 py-1 rounded inline-flex w-fit border border-rose-500/20">
              <AlertTriangle className="size-3" />
              {row.reason}
            </p>
          ) : null}
        </div>
      </div>

      {candidates.length > 0 ? (
        <div className="mb-4">
           <p className="text-[11px] uppercase tracking-wider text-tier-4 font-semibold mb-2">Candidate Matches</p>
           <div className="flex flex-col gap-1.5">
             {candidates.map((candidate) => (
               <button
                 key={candidate.governorDbId}
                 type="button"
                 onClick={() => setDraft({ ...draft, governorDbId: candidate.governorDbId })}
                 className={cn(
                   "text-left rounded-xl border p-2.5 text-sm transition-all flex items-center justify-between",
                   draft.governorDbId === candidate.governorDbId 
                     ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-100" 
                     : "border-white/10 bg-[color:var(--surface-3)] text-tier-2 hover:bg-[color:var(--surface-4)]"
                 )}
               >
                 <div>
                   <p className="font-semibold">{candidate.governorName}</p>
                   <p className="text-[11px] font-mono opacity-60">Game ID: {candidate.governorGameId}</p>
                 </div>
                 {draft.governorDbId === candidate.governorDbId && <Check className="size-4 text-emerald-400" />}
               </button>
             ))}
           </div>
        </div>
      ) : null}

      {row.status === 'PENDING' ? (
        <div className="space-y-3 border-t border-white/10 pt-4">
           <p className="text-[11px] uppercase tracking-wider text-tier-4 font-semibold">Resolution</p>
          <Input
            placeholder="Manual Governor DB ID"
            value={draft.governorDbId}
            onChange={(event) =>
              setDraft({
                ...draft,
                governorDbId: event.target.value,
              })
            }
            className="border-white/10 bg-[color:var(--surface-4)]"
          />
          <Textarea
            rows={2}
            placeholder="Internal note (optional)..."
            value={draft.note}
            onChange={(event) =>
              setDraft({
                ...draft,
                note: event.target.value,
              })
            }
            className="border-white/10 bg-[color:var(--surface-4)] text-sm resize-none"
          />
          <Button
            className="w-full rounded-xl bg-amber-500 text-amber-950 hover:bg-amber-400 shadow-[0_0_15px_rgba(245,158,11,0.2)] font-bold mt-2"
            onClick={() => onResolve(row.id)}
            disabled={Boolean(busyPendingId)}
          >
            <Check data-icon="inline-start" />
            {busyPendingId === row.id ? 'Resolving...' : 'Confirm Resolution'}
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
  const [showMobileConversations, setShowMobileConversations] = useState(false);
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
    <div className="flex flex-col w-full h-[calc(100dvh-120px)] lg:h-[calc(100dvh-130px)] mt-[-10px] relative overflow-hidden">
      <SessionGate ready={workspaceReady} loading={sessionLoading} error={sessionError}>
        {/* Mobile Header */}
        <div className="flex lg:hidden items-center justify-between bg-[color:var(--surface-3)] border border-[color:var(--stroke-soft)] rounded-2xl p-3 mb-2 shrink-0">
          <div className="flex items-center gap-2">
            <Bot className="size-5 text-sky-400" />
            <h1 className="font-heading text-base font-bold text-tier-1">Assistant</h1>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" className="rounded-full px-3 h-8" onClick={() => setShowMobileConversations((p) => !p)}>
               History
            </Button>
            <Button variant="outline" size="sm" className="rounded-full px-3 h-8" onClick={() => setShowMobileContext((p) => !p)}>
               Context
            </Button>
          </div>
        </div>

        <div className="flex flex-1 min-h-0 gap-4 relative overflow-hidden">
          <div className={cn(
            "absolute inset-y-0 left-0 z-40 w-full sm:w-[320px] lg:static lg:w-[300px] lg:flex lg:translate-x-0 transition-transform bg-[color:var(--surface-1)]",
            showMobileConversations ? "translate-x-0" : "-translate-x-full"
          )}>
          <Panel
            title="Conversations"
            subtitle="Workspace threads"
            className="w-full h-full border-none shadow-none flex flex-col p-4 bg-transparent overflow-y-auto"
            actions={
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
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
                  <Plus className="size-4 mr-1.5" />
                  New
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="lg:hidden size-8 rounded-full text-muted-foreground p-0"
                  onClick={() => setShowMobileConversations(false)}
                >
                  <X className="size-4" />
                </Button>
              </div>
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
                      onClick={() => {
                        controller.setSelectedConversationId(row.id);
                        setShowMobileConversations(false);
                      }}
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
          </div>

          <div className="flex-1 flex flex-col min-w-0 bg-background border-x border-border overflow-hidden relative">
            <div className="flex items-center justify-between p-4 border-b border-border bg-background/95 backdrop-blur shrink-0 z-10">
              <div className="flex items-center gap-3">
                <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary border border-primary/20">
                  <Bot className="size-4" />
                </div>
                <div className="flex flex-col">
                  <span className="font-heading text-sm font-bold text-foreground">
                    {shorten(
                      controller.conversations.find((row) => row.id === controller.selectedConversationId)?.title || 'Untitled Conversation',
                      52
                    )}
                  </span>
                  <span className="text-[11px] text-muted-foreground font-medium">{controller.history?.messages?.length || 0} messages</span>
                </div>
              </div>
            </div>

            <div
              ref={timelineRef}
              className="flex-1 overflow-y-auto px-4 py-6 relative scroll-smooth flex flex-col items-center"
            >
              <div className="w-full max-w-3xl flex flex-col gap-6">

                {/* System & Operational Banners */}
                {controller.error ? (
                  <div className="rounded-xl border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive-foreground">
                    {controller.error}
                  </div>
                ) : null}

                {controller.handoffContext ? (
                  <div className="rounded-xl border border-sky-500/20 bg-sky-500/10 px-4 py-3 text-sm text-sky-600 dark:text-sky-300">
                    <p className="font-semibold">Source: {controller.handoffContext.title}</p>
                    <p className="mt-0.5 text-muted-foreground">{controller.handoffContext.summary || 'Context imported from another workflow.'}</p>
                  </div>
                ) : null}

                {controller.notice ? (
                  <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-600 dark:text-emerald-300">
                    {controller.notice}
                  </div>
                ) : null}

                {(controller.batchRun || controller.batchScanJobId || controller.handoffContext) ? (
                  <div className="rounded-2xl border border-border bg-card p-5 shadow-sm relative overflow-hidden">
                    <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-transparent via-sky-500/50 to-transparent" />
                    <div className="mb-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                      <div>
                        <h3 className="font-heading text-lg font-bold text-foreground flex items-center gap-2">
                          <Bot className="size-5 text-sky-500" />
                          AI Batch Runner
                        </h3>
                        <p className="text-sm text-muted-foreground mt-1">Autonomous sequential OCR extraction and data entry.</p>
                      </div>
                      <div className="flex flex-wrap gap-2 items-center">
                        <Input
                          value={controller.batchScanJobId}
                          onChange={(event) => controller.setBatchScanJobId(event.target.value)}
                          placeholder="Scan Job ID"
                          className="h-9 w-[180px]"
                        />
                        <Button
                          size="sm"
                          className="bg-sky-500 text-white hover:bg-sky-600 shadow-sm"
                          onClick={() => void controller.startBatchRun()}
                          disabled={controller.startingBatch}
                        >
                          <Play className="size-3.5 mr-1.5" />
                          {controller.startingBatch ? 'Starting...' : 'Start'}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => void controller.runBatchStep()}
                          disabled={controller.steppingBatch || !controller.batchRun}
                        >
                          <Workflow className="size-3.5 mr-1.5" />
                          {controller.steppingBatch ? 'Running...' : 'Run Step'}
                        </Button>
                      </div>
                    </div>

                    {controller.batchRun ? (
                      <div className="space-y-5">
                        <div className="bg-muted/50 rounded-xl p-4 border border-border">
                          <div className="flex justify-between items-end mb-2">
                            <span className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">Progress</span>
                            <span className="text-sm font-mono text-foreground font-medium">{controller.batchRun.processedCount} / {controller.batchRun.totalArtifacts}</span>
                          </div>
                          <div className="h-2 w-full bg-muted rounded-full overflow-hidden border border-border/50">
                            <div 
                              className="h-full bg-sky-500 transition-all duration-500" 
                              style={{ width: `${controller.batchRun.totalArtifacts > 0 ? (controller.batchRun.processedCount / controller.batchRun.totalArtifacts) * 100 : 0}%` }} 
                            />
                          </div>
                          <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
                            <div className="bg-background rounded-lg p-2.5 border border-border flex flex-col items-center">
                               <span className="text-[10px] uppercase text-muted-foreground mb-1 font-semibold">Status</span>
                               <span className="text-xs font-semibold text-foreground">{controller.batchRun.status}</span>
                            </div>
                            <div className="bg-background rounded-lg p-2.5 border border-border flex flex-col items-center">
                               <span className="text-[10px] uppercase text-muted-foreground mb-1 font-semibold">Auto Confirmed</span>
                               <span className="text-sm font-mono text-emerald-500 font-bold">{controller.batchRun.autoConfirmedCount}</span>
                            </div>
                            <div className="bg-background rounded-lg p-2.5 border border-border flex flex-col items-center">
                               <span className="text-[10px] uppercase text-muted-foreground mb-1 font-semibold">Needs Manual</span>
                               <span className="text-sm font-mono text-amber-500 font-bold">{controller.batchRun.pendingManualCount}</span>
                            </div>
                            <div className="bg-background rounded-lg p-2.5 border border-border flex flex-col items-center">
                               <span className="text-[10px] uppercase text-muted-foreground mb-1 font-semibold">Remaining</span>
                               <span className="text-sm font-mono text-sky-600 font-bold">{controller.batchRun.remainingCount}</span>
                            </div>
                          </div>
                        </div>

                        {controller.batchRun.flagged.length > 0 ? (
                          <div className="space-y-2 rounded-xl border border-amber-500/20 bg-amber-500/5 p-4">
                            <p className="text-xs uppercase tracking-wider text-amber-600 dark:text-amber-400 font-semibold mb-3 flex items-center gap-2">
                               <AlertTriangle className="size-3.5" /> Action Required Queue
                            </p>
                            <div className="grid gap-2">
                              {controller.batchRun.flagged.slice(-5).reverse().map((row, index) => (
                                <div
                                  key={`${row.artifactId}-${index}`}
                                  className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 rounded-lg border border-amber-500/10 bg-background px-3 py-2 text-xs shadow-sm"
                                >
                                  <div className="flex items-center gap-2">
                                     <FileImage className="size-3.5 text-muted-foreground" />
                                     <span className="font-mono text-foreground font-medium">{row.fileName}</span>
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <span className="text-amber-700 dark:text-amber-300 font-medium">{row.reason}</span>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        ) : null}
                      </div>
                    ) : (
                      <div className="bg-muted/30 rounded-xl p-8 border border-border text-center">
                        <Workflow className="size-8 text-muted-foreground/30 mx-auto mb-3" />
                        <p className="text-sm text-muted-foreground font-medium">Start a batch with a scan job ID to process artifacts sequentially.</p>
                      </div>
                    )}
                  </div>
                ) : null}

                {pendingPlan ? (
                  <div className="mx-auto w-full rounded-2xl border border-amber-500/30 bg-background/95 backdrop-blur px-5 py-4 shadow-[0_12px_40px_rgba(245,158,11,0.08)] ring-1 ring-amber-500/10">
                    <div className="flex flex-col xl:flex-row items-center justify-between gap-4">
                      <div className="space-y-1 text-center xl:text-left">
                        <div className="flex items-center justify-center xl:justify-start gap-2">
                          <div className="size-2 rounded-full bg-amber-500 animate-pulse shadow-[0_0_8px_rgba(245,158,11,0.5)]" />
                          <p className="text-sm font-bold text-amber-600 dark:text-amber-400 uppercase tracking-widest">Action Required</p>
                        </div>
                        <p className="text-[13px] text-foreground leading-snug max-w-lg font-medium">{shorten(pendingPlan.summary, 120)}</p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2 justify-center">
                        <span className="rounded-md bg-muted px-2 py-0.5 text-xs font-semibold text-muted-foreground border border-border">{pendingPlan.actions.length} actions</span>
                        {destructiveCount(pendingPlan) > 0 ? (
                          <span className="rounded-md bg-destructive/10 px-2 py-0.5 text-xs font-bold uppercase tracking-wider text-destructive border border-destructive/20">Destructive</span>
                        ) : null}
                        <div className="flex items-center gap-1.5 ml-2">
                          <Button
                            size="sm"
                            className="rounded-xl bg-emerald-500 text-white hover:bg-emerald-600 font-bold shadow-sm"
                            onClick={() => void controller.confirmPlan(pendingPlan.id)}
                            disabled={Boolean(controller.busyPlanId)}
                          >
                            <Check className="size-4 mr-1" />
                            Confirm
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="rounded-xl border-rose-500/30 bg-rose-500/10 text-rose-600 dark:text-rose-400 hover:bg-rose-500/20 font-bold"
                            onClick={() => void controller.denyPlan(pendingPlan.id)}
                            disabled={Boolean(controller.busyPlanId)}
                          >
                            <X className="size-4 mr-1" />
                            Deny
                          </Button>
                        </div>
                      </div>
                    </div>
                  </div>
                ) : null}

                {/* Messages Timeline */}
                {controller.loadingHistory ? (
                  <div className="flex justify-center p-8">
                    <p className="text-sm text-muted-foreground animate-pulse">Loading messages...</p>
                  </div>
                ) : !controller.history?.messages?.length ? (
                  <div className="flex flex-col items-center justify-center py-20 text-center gap-3">
                     <div className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary border border-primary/20">
                        <Bot className="size-6" />
                     </div>
                     <p className="text-sm text-muted-foreground max-w-sm mt-2">No messages yet. Send a message or attach a screenshot to begin.</p>
                  </div>
                ) : (
                  controller.history.messages.map((msg) => <MessageBubble key={msg.id} message={msg} />)
                )}
              </div>
            </div>

            <div className="shrink-0 p-4 pt-0 flex justify-center w-full bg-[color:var(--surface-2)]">
              <div className="w-full max-w-3xl relative">
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

                <div className="relative flex w-full flex-col overflow-hidden rounded-2xl border border-[color:var(--stroke-soft)] bg-[color:var(--surface-3)] focus-within:border-sky-500/50 focus-within:ring-1 focus-within:ring-sky-500/50 shadow-sm transition-all duration-200">
                  <Textarea
                    placeholder="Ask for reads, register/update players, record stats..."
                    value={controller.messageText}
                    onChange={(event) => controller.setMessageText(event.target.value)}
                    rows={1}
                    className="min-h-[52px] w-full resize-none border-0 bg-transparent p-4 pb-2 text-sm focus-visible:ring-0 shadow-none text-tier-1 placeholder:text-tier-4"
                    onKeyDown={(event) => {
                      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
                        event.preventDefault();
                        void controller.submitMessage();
                      }
                    }}
                  />

                  {/* Attachments Display inside Input */}
                  {(controller.messageFiles.length > 0 || controller.artifactRefs.length > 0) ? (
                    <div className="flex flex-wrap gap-2 px-4 pb-2">
                       {controller.messageFiles.map((file, i) => (
                         <div key={i} className="flex items-center gap-1.5 rounded-lg border border-[color:var(--stroke-soft)] bg-[color:var(--surface-4)] px-2 py-1 text-xs text-tier-2">
                            <FileImage className="size-3" />
                            <span className="truncate max-w-[120px]">{file.name}</span>
                         </div>
                       ))}
                       {controller.artifactRefs.map((file, i) => (
                         <div key={i} className="flex items-center gap-1.5 rounded-lg border border-sky-400/20 bg-sky-500/10 px-2 py-1 text-xs text-sky-200">
                            <FileImage className="size-3" />
                            <span className="truncate max-w-[120px]">{file.fileName || file.artifactId}</span>
                         </div>
                       ))}
                    </div>
                  ) : null}

                  {/* Input Actions Bar */}
                  <div className="flex items-center justify-between px-2 pb-2 pt-1">
                    <div className="flex items-center gap-1">
                      <Button
                        size="icon"
                        variant="ghost"
                        className="size-8 rounded-full text-tier-3 hover:bg-[color:var(--surface-4)] hover:text-tier-1"
                        onClick={() => fileInputRef.current?.click()}
                      >
                        <Plus className="size-4" />
                      </Button>
                      {(controller.messageFiles.length > 0 || controller.artifactRefs.length > 0) ? (
                        <Button
                          size="icon"
                          variant="ghost"
                          className="size-8 rounded-full text-rose-400 hover:text-rose-300 hover:bg-rose-500/10"
                          onClick={() => {
                            controller.setMessageFiles([]);
                            controller.setArtifactRefs([]);
                            if (fileInputRef.current) fileInputRef.current.value = '';
                          }}
                        >
                          <X className="size-4" />
                        </Button>
                      ) : null}
                    </div>

                    <div className="flex items-center gap-2 pr-1">
                      <span className="text-[10px] font-mono text-tier-4 hidden sm:inline-block pr-1">Cmd+Enter</span>
                      <Button
                        size="icon"
                        className="size-8 rounded-full bg-sky-500 text-sky-950 shadow-[0_2px_10px_rgba(14,165,233,0.3)] hover:bg-sky-400 transition-opacity disabled:opacity-50"
                        onClick={() => void controller.submitMessage()}
                        disabled={controller.sendingMessage || controller.loadingHistory || (!controller.messageText.trim() && controller.messageFiles.length === 0 && controller.artifactRefs.length === 0)}
                      >
                        <Send className="size-3.5 ml-[-1px]" />
                        <span className="sr-only">Send</span>
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
          </div>
          </div>

          <div className={cn(
            "absolute inset-y-0 right-0 z-40 w-full sm:w-[400px] xl:static xl:w-[360px] xl:flex xl:translate-x-0 transition-transform bg-[color:var(--surface-1)]",
            showMobileContext ? "translate-x-0" : "translate-x-full"
          )}>
            <Panel
              title="Context"
              subtitle="Plans, resolutions, and traces."
              className="w-full h-full border-none shadow-none flex flex-col p-4 bg-transparent overflow-y-auto"
              actions={
                <Button
                  size="sm"
                  variant="ghost"
                  className="xl:hidden size-8 rounded-full text-muted-foreground p-0"
                  onClick={() => setShowMobileContext(false)}
                >
                  <X className="size-4" />
                </Button>
              }
            >
              {contextTabs}
            </Panel>
          </div>
        </div>
      </SessionGate>
    </div>
  );
}
