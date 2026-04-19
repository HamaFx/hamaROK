'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  Bot,
  Check,
  FileImage,
  LayoutDashboard,
  Menu,
  PanelRight,
  Plus,
  RefreshCcw,
  Send,
  Settings,
  Sparkles,
  Trophy,
  Upload,
  User,
  Users,
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
import { StatusPill } from '@/components/ui/primitives';
import {
  type PendingResolutionDraft,
  type PlanActionRow,
  type PlanRow,
  type MessageRow,
  useAssistantController,
} from './use-assistant-controller';

const NAV_LINKS = [
  { label: 'Dashboard', href: '/', icon: LayoutDashboard },
  { label: 'Governors', href: '/governors', icon: Users },
  { label: 'Activity', href: '/activity', icon: Activity },
  { label: 'Rankings', href: '/rankings', icon: Trophy },
  { label: 'Upload', href: '/upload', icon: Upload },
  { label: 'Settings', href: '/settings', icon: Settings },
];

type ContextTab = 'plans' | 'pending' | 'logs' | 'thread';

type ExecutionLogTone = 'info' | 'warn' | 'bad';

type ExecutionLogRow = {
  id: string;
  text: string;
  createdAt: string;
  tone: ExecutionLogTone;
};

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

function getSuggestions(meta: MessageRow['meta']): Array<Record<string, unknown>> {
  if (!meta || typeof meta !== 'object') return [];
  const rows = (meta as Record<string, unknown>).suggestions;
  if (!Array.isArray(rows)) return [];
  return rows.filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object');
}

function getAnalyzerMode(meta: MessageRow['meta']): string {
  if (!meta || typeof meta !== 'object') return '';
  return String((meta as Record<string, unknown>).analyzerMode || '').trim();
}

function MessageBubble({ message }: { message: MessageRow }) {
  const isUser = message.role === 'USER';
  const isAssistant = message.role === 'ASSISTANT';
  const readExecutions = getReadExecutions(message.meta);
  const suggestions = getSuggestions(message.meta);
  const analyzerMode = getAnalyzerMode(message.meta);

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
              'flex size-8 shrink-0 select-none items-center justify-center rounded-md border shadow-sm font-bold',
              isUser
                ? 'bg-muted border-border text-foreground'
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
                  ? 'bg-muted/50 text-foreground'
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
                          className="flex items-center gap-2 rounded-lg border bg-black/40 px-3 py-2 text-xs font-medium"
                        >
                          <FileImage className="size-4 text-muted-foreground" />
                          <span className="truncate max-w-[150px] font-mono">{label}</span>
                        </div>
                      );
                    }
                    return (
                      <a
                        key={`${message.id}-attachment-${index}`}
                        href={attachment.url}
                        target="_blank"
                        rel="noreferrer"
                        className="flex items-center gap-2 rounded-lg border bg-black/40 px-3 py-2 text-xs font-medium hover:bg-muted transition-colors shadow-sm"
                      >
                        <FileImage className="size-4 text-muted-foreground" />
                        <span className="truncate max-w-[150px] font-mono text-primary">{label}</span>
                      </a>
                    );
                  })}
                </div>
              ) : null}

              {readExecutions.length > 0 ? (
                <div className="mt-3 rounded-lg border bg-muted/20 p-3 text-xs shadow-inner border-white/5">
                  <div className="flex items-center gap-2 font-bold mb-2 text-muted-foreground uppercase tracking-widest text-[9px]">
                    <Workflow className="size-3" />
                    <span>Tool Invocations ({readExecutions.length})</span>
                  </div>
                  <div className="space-y-3">
                    {readExecutions.map((entry, index) => (
                      <div key={`${message.id}-read-${index}`} className="flex flex-col gap-1 border-l-2 border-primary/20 pl-2">
                        <span className="font-bold text-foreground uppercase tracking-tighter text-xs font-mono opacity-80">{String(entry.actionType || 'read_action')}</span>
                        <span className="text-muted-foreground leading-relaxed">{shorten(String(entry.summary || 'Completed.'), 220)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              {suggestions.length > 0 ? (
                <div className="mt-2 rounded-lg border bg-muted/20 p-3 text-xs shadow-inner border-white/5">
                  <div className="mb-2 text-xs font-bold uppercase tracking-widest text-muted-foreground">
                    Suggestions
                  </div>
                  <div className="space-y-2">
                    {suggestions.map((entry, index) => (
                      <div key={`${message.id}-suggestion-${index}`} className="rounded-lg border border-white/10 bg-black/20 p-2">
                        <p className="text-[11px] font-semibold text-foreground">
                          {String(entry.title || 'Suggestion')}
                        </p>
                        <p className="text-[11px] text-muted-foreground">
                          {shorten(String(entry.detail || ''), 220)}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
            
            <div className={cn("text-xs text-muted-foreground/60 flex items-center gap-2 font-mono uppercase tracking-widest", isUser ? "flex-row-reverse" : "flex-row")}>
              {message.model ? <span>{message.model}</span> : null}
              {analyzerMode ? <span>{analyzerMode}</span> : null}
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
    <div className="rounded-2xl border border-white/10 bg-white/5 p-4 shadow-sm backdrop-blur-sm">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <StatusPill label={plan.status} tone={planTone(plan.status)} />
          {destructive > 0 ? <StatusPill label="Destructive" tone="bad" /> : null}
          <span className="text-xs uppercase font-bold text-muted-foreground bg-white/5 px-2 py-0.5 rounded-md border border-white/5">{plan.actions.length} actions</span>
        </div>
        <span className="text-xs text-muted-foreground font-mono uppercase tracking-tighter">{new Date(plan.createdAt).toLocaleTimeString()}</span>
      </div>

      <p className="text-sm font-bold text-foreground leading-relaxed">{plan.summary}</p>

      <div className="mt-4 space-y-2 pl-2 border-l-2 border-white/10">
        {plan.actions.map((action) => (
          <div key={action.id} className="rounded-lg border border-white/5 bg-white/5 px-2.5 py-1.5 text-xs flex items-center justify-between gap-2 shadow-sm transition-all hover:bg-white/10">
            <span className="font-medium text-foreground tracking-tight">{describeAction(action)}</span>
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
        ))}
      </div>

      {plan.status === 'PENDING' ? (
        <div className="mt-5 flex flex-wrap gap-2 pt-3 border-t border-white/10">
          <Button
            className="flex-1 rounded-xl bg-emerald-500 text-white hover:bg-emerald-600 font-bold shadow-sm"
            onClick={() => onConfirm(plan.id)}
            disabled={Boolean(busyPlanId)}
          >
            <Check className="size-4 mr-2" />
            {busyPlanId === plan.id ? 'Confirming...' : 'Confirm Plan'}
          </Button>
          <Button
            variant="outline"
            className="flex-1 rounded-xl border-rose-500/20 text-rose-500 hover:bg-rose-500/5 font-bold"
            onClick={() => onDeny(plan.id)}
            disabled={Boolean(busyPlanId)}
          >
            <X className="size-4 mr-2" />
            {busyPlanId === plan.id ? 'Denying...' : 'Deny'}
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
    <div className="rounded-2xl border border-amber-500/20 bg-gradient-to-b from-amber-500/10 to-transparent p-4 shadow-lg relative overflow-hidden">
      <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-amber-400/0 via-amber-400/50 to-amber-400/0" />
      
      <div className="mb-3 flex items-center justify-between gap-2">
        <StatusPill label={row.status} tone={row.status === 'RESOLVED' ? 'good' : row.status === 'DENIED' ? 'bad' : 'warn'} />
        <span className="text-[11px] text-muted-foreground/60 font-mono tracking-tighter uppercase">{new Date(row.createdAt).toLocaleTimeString()}</span>
      </div>

      <div className="mb-4 space-y-1.5">
        <p className="text-xs uppercase tracking-widest text-amber-600 dark:text-amber-400 font-bold opacity-80">Unmapped Identity</p>
        <div className="flex flex-col gap-1 rounded-xl bg-black/40 p-3 border border-white/5 shadow-inner">
          <p className="text-lg font-bold text-foreground drop-shadow-sm">{row.governorNameRaw || '(unknown)'}</p>
          {row.governorIdRaw ? <p className="text-xs font-mono text-muted-foreground/80 tracking-widest">ID: {row.governorIdRaw}</p> : null}
          {row.reason ? (
            <p className="mt-1 flex items-center gap-1.5 text-xs text-rose-500 bg-rose-500/10 px-2 py-1 rounded inline-flex w-fit border border-rose-500/10">
              <AlertTriangle className="size-3" />
              {row.reason}
            </p>
          ) : null}
        </div>
      </div>

      {candidates.length > 0 ? (
        <div className="mb-4">
           <p className="text-xs uppercase tracking-widest text-muted-foreground font-bold mb-2 opacity-60">Candidate Matches</p>
           <div className="flex flex-col gap-1.5">
             {candidates.map((candidate) => (
               <button
                 key={candidate.governorDbId}
                 type="button"
                 onClick={() => setDraft({ ...draft, governorDbId: candidate.governorDbId })}
                 className={cn(
                   "text-left rounded-xl border p-2.5 text-sm transition-all flex items-center justify-between shadow-sm",
                   draft.governorDbId === candidate.governorDbId 
                     ? "border-emerald-500/40 bg-emerald-500/10 text-foreground font-bold" 
                     : "border-white/5 bg-white/5 text-muted-foreground hover:bg-white/10"
                 )}
               >
                 <div>
                   <p className="font-semibold">{candidate.governorName}</p>
                   <p className="text-xs font-mono opacity-60 tracking-widest">Game ID: {candidate.governorGameId}</p>
                 </div>
                 {draft.governorDbId === candidate.governorDbId && <Check className="size-4 text-emerald-500" />}
               </button>
             ))}
           </div>
        </div>
      ) : null}

      {row.status === 'PENDING' ? (
        <div className="space-y-3 border-t border-white/5 pt-4">
           <p className="text-xs uppercase tracking-widest text-muted-foreground font-bold opacity-60">Resolution</p>
          <Input
            placeholder="Manual Governor DB ID"
            value={draft.governorDbId}
            onChange={(event) =>
              setDraft({
                ...draft,
                governorDbId: event.target.value,
              })
            }
            className="bg-black/40 border-white/5"
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
            className="bg-black/40 border-white/5 text-sm resize-none"
          />
          <Button
            className="w-full rounded-xl bg-amber-500 text-white hover:bg-amber-600 font-bold mt-2 shadow-sm"
            onClick={() => onResolve(row.id)}
            disabled={Boolean(busyPendingId)}
          >
            <Check className="size-4 mr-2" />
            {busyPendingId === row.id ? 'Resolving...' : 'Confirm Resolution'}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function ExecutionLogList({ rows }: { rows: ExecutionLogRow[] }) {
  if (rows.length === 0) {
    return <p className="text-xs text-muted-foreground p-8 text-center italic opacity-60">No execution logs yet.</p>;
  }

  return (
    <div className="space-y-2">
      {rows.slice(0, 150).map((row) => (
        <div key={row.id} className="rounded-xl border border-white/5 bg-white/5 px-3 py-2 text-xs shadow-sm hover:shadow-md transition-shadow">
          <div className="mb-1 flex items-center justify-between gap-2">
            <StatusPill label={row.tone === 'bad' ? 'Error' : row.tone === 'warn' ? 'Dropped' : 'Read'} tone={row.tone} />
            <span className="text-xs text-muted-foreground font-mono uppercase tracking-tighter opacity-60">{new Date(row.createdAt).toLocaleTimeString()}</span>
          </div>
          <p className="text-foreground/90 leading-relaxed font-mono text-[11px] opacity-80">{row.text}</p>
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

  useEffect(() => {
    if (!timelineRef.current) return;
    timelineRef.current.scrollTop = timelineRef.current.scrollHeight;
  }, [controller.selectedConversationId, controller.history?.messages?.length]);

  const contextTabs = (
    <Tabs
      value={contextTab}
      onValueChange={(next) => setContextTab((next as ContextTab) || 'plans')}
      className="h-full flex flex-col"
    >
      <TabsList className="w-full justify-start rounded-xl border border-white/5 bg-white/5 p-1 mb-4 shrink-0">
        <TabsTrigger value="plans" className="flex-1 rounded-lg data-[state=active]:bg-white/10 data-[state=active]:text-foreground data-[state=active]:shadow-sm font-bold uppercase tracking-widest text-[9px]">
          Plans
        </TabsTrigger>
        <TabsTrigger value="pending" className="flex-1 rounded-lg data-[state=active]:bg-white/10 data-[state=active]:text-foreground data-[state=active]:shadow-sm font-bold uppercase tracking-widest text-[9px]">
          Pending
        </TabsTrigger>
        <TabsTrigger value="logs" className="flex-1 rounded-lg data-[state=active]:bg-white/10 data-[state=active]:text-foreground data-[state=active]:shadow-sm font-bold uppercase tracking-widest text-[9px]">
          Logs
        </TabsTrigger>
        <TabsTrigger value="thread" className="flex-1 rounded-lg data-[state=active]:bg-white/10 data-[state=active]:text-foreground data-[state=active]:shadow-sm font-bold uppercase tracking-widest text-[9px]">
          Thread
        </TabsTrigger>
      </TabsList>

      <div className="flex-1 overflow-y-auto pr-1">
        <TabsContent value="plans" className="mt-0 space-y-4 animate-in fade-in duration-300">
          {sortedPlans.length === 0 ? (
            <p className="text-xs text-muted-foreground p-8 text-center italic opacity-60">No plans generated yet.</p>
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

        <TabsContent value="pending" className="mt-0 space-y-4 animate-in fade-in duration-300">
          {pendingRows.length === 0 ? (
            <p className="text-xs text-muted-foreground p-8 text-center italic opacity-60">No pending identity resolutions.</p>
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

        <TabsContent value="logs" className="mt-0 animate-in fade-in duration-300">
          <ExecutionLogList rows={executionLogs} />
        </TabsContent>

        <TabsContent value="thread" className="mt-0 animate-in fade-in duration-300 space-y-3">
          <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
            <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-2">
              Thread Instructions
            </p>
            <Textarea
              rows={5}
              value={controller.threadInstructionsDraft}
              onChange={(event) => controller.setThreadInstructionsDraft(event.target.value)}
              placeholder="Optional per-thread instruction for this conversation."
              className="bg-black/40 border-white/10 text-sm"
            />
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/5 p-3 space-y-2">
            <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
              Analyzer Override
            </p>
            <select
              className="h-10 w-full rounded-xl border border-white/10 bg-black/40 px-3 text-sm"
              value={controller.threadAnalyzerOverride}
              onChange={(event) =>
                controller.setThreadAnalyzerOverride(
                  event.target.value as 'inherit' | 'hybrid' | 'ocr_pipeline' | 'vision_model'
                )
              }
            >
              <option value="inherit">Inherit Workspace Default</option>
              <option value="hybrid">Hybrid</option>
              <option value="ocr_pipeline">OCR Pipeline</option>
              <option value="vision_model">Vision Model</option>
            </select>
          </div>

          <Button
            className="w-full rounded-xl"
            onClick={() => void controller.saveThreadConfig()}
            disabled={controller.savingThreadConfig}
          >
            {controller.savingThreadConfig ? 'Saving...' : 'Save Thread Settings'}
          </Button>
        </TabsContent>
      </div>
    </Tabs>
  );

  return (
    <div className="fixed inset-0 flex flex-col overflow-hidden bg-black text-foreground selection:bg-primary/20 font-sans">
      <SessionGate ready={workspaceReady} loading={sessionLoading} error={sessionError}>
        
        {/* Template Header (Hard Black & Blurred) */}
        <header className="flex h-[calc(3.5rem+env(safe-area-inset-top))] shrink-0 items-center justify-between border-b border-white/10 bg-black/95 px-4 pb-1 pt-[env(safe-area-inset-top)] backdrop-blur z-20 shadow-xl">
          <div className="flex items-center gap-3">
             <Link href="/" className="mr-1">
                <Button variant="ghost" size="icon" className="size-9 text-muted-foreground hover:bg-white/10 hover:text-foreground transition-colors">
                   <LayoutDashboard className="size-5" />
                </Button>
             </Link>
             <Button
                variant="ghost"
                size="icon"
                className="lg:hidden size-9 shrink-0 text-muted-foreground hover:bg-white/10"
                onClick={() => setShowMobileConversations(true)}
              >
                <Menu className="size-5" />
              </Button>
              <div className="flex items-center gap-2.5">
                <div className="flex size-7 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-lg font-bold">
                  <Bot className="size-4" />
                </div>
                <div className="flex flex-col">
                  <span className="text-[11px] font-bold tracking-tight uppercase opacity-90 leading-none mb-0.5">HamaROK Cockpit</span>
                  <span className="text-xs text-muted-foreground font-mono leading-none tracking-tighter uppercase opacity-50 truncate max-w-[120px] sm:max-w-none">
                    {controller.conversations.find((row) => row.id === controller.selectedConversationId)?.title || 'Untitled Thread'}
                  </span>
                </div>
              </div>
          </div>
	          <div className="flex items-center gap-2">
	             <Button
	                size="sm"
	                className="h-9 gap-2 rounded-xl px-3 text-xs font-semibold tracking-wide shadow-lg"
	                onClick={async () => {
	                  const id = await controller.createConversation();
	                  await controller.refreshConversation();
	                  await controller.reloadHistory(id);
	                }}
	             >
	                <Plus className="size-3.5" />
	                <span className="hidden min-[390px]:inline">New Chat</span>
	             </Button>
	             <Button
	                variant="ghost"
	                size="icon"
                className="xl:hidden size-9 text-muted-foreground hover:bg-white/10"
                onClick={() => setShowMobileContext(true)}
              >
                <PanelRight className="size-5" />
              </Button>
              <div className="hidden sm:flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[9px] font-bold text-muted-foreground uppercase tracking-widest shadow-inner opacity-80">
                <Sparkles className="size-2.5 text-primary" />
                Mistral Large
              </div>
          </div>
        </header>

        <div className="flex flex-1 min-h-0 relative overflow-hidden">
          
          {/* Conversation History Sidebar (Desktop) */}
          <aside className="hidden lg:flex w-[280px] flex-col border-r border-white/10 bg-white/[0.02]">
             <div className="p-3 space-y-1 border-b border-white/10 bg-white/[0.01]">
                <p className="text-[9px] font-bold uppercase tracking-[0.06em] text-muted-foreground/40 px-2 mb-2">Navigation</p>
                {NAV_LINKS.map(link => {
                   const Icon = link.icon;
                   return (
                      <Link key={link.href} href={link.href}>
                         <Button variant="ghost" size="sm" className="w-full justify-start gap-2.5 text-muted-foreground hover:bg-white/5 hover:text-foreground h-9 rounded-lg transition-all">
                            <Icon className="size-4 opacity-70" />
                            <span className="text-xs font-medium tracking-tight">{link.label}</span>
                         </Button>
                      </Link>
                   );
                })}
             </div>
             <div className="p-4 border-b border-white/10 bg-white/[0.02] shadow-inner">
                <Button 
                   className="w-full justify-start gap-2 shadow-xl font-bold uppercase tracking-wider text-xs py-4 rounded-xl" 
                   size="sm"
                   onClick={async () => {
                      const id = await controller.createConversation();
                      await controller.refreshConversation();
                      await controller.reloadHistory(id);
                   }}
                >
                   <Plus className="size-3.5" /> New Chat
                </Button>
             </div>
             <div className="flex-1 overflow-y-auto p-3 space-y-1 pr-1 custom-scrollbar">
                <p className="text-[9px] font-bold uppercase tracking-[0.06em] text-muted-foreground/40 px-2 mb-2">History</p>
                {controller.conversations.map(row => (
                   <button
                      key={row.id}
                      className={cn(
                         "w-full text-left p-3 rounded-xl text-sm transition-all flex flex-col gap-1 border border-transparent mb-1",
                         row.id === controller.selectedConversationId 
                           ? "bg-white/5 border-white/10 text-foreground font-bold scale-[1.02] shadow-md" 
                           : "text-muted-foreground hover:bg-white/5 hover:text-foreground opacity-70 hover:opacity-100"
                      )}
                      onClick={() => controller.setSelectedConversationId(row.id)}
                   >
                      <span className="truncate tracking-tight">{row.title || 'Untitled'}</span>
                      <span className="text-[9px] opacity-40 uppercase font-mono tracking-tighter">
                         {new Date(row.updatedAt).toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                      </span>
                   </button>
                ))}
             </div>
          </aside>

          {/* Core Chat Viewport */}
          <main className="flex-1 min-w-0 relative flex flex-col bg-black">
             <div 
               ref={timelineRef}
               className="flex-1 overflow-y-auto px-4 py-8 scroll-smooth flex flex-col items-center"
             >
                <div className="w-full max-w-2xl flex flex-col gap-8 pb-32">
                   
                   {/* Operational Status (Pinned top of thread if active) */}
                   {(controller.batchRun || controller.handoffContext || pendingPlan) && (
                      <div className="flex flex-col gap-4 animate-in fade-in slide-in-from-top-2 duration-700">
                         {controller.handoffContext && (
                            <div className="rounded-2xl border border-sky-500/20 bg-sky-500/5 px-4 py-3 text-xs shadow-sm backdrop-blur-sm">
                               <p className="font-bold text-sky-600 dark:text-sky-400 tracking-tight uppercase mb-0.5 opacity-80">Imported Context</p>
                               <p className="font-medium text-foreground">{controller.handoffContext.title}</p>
                               <p className="mt-1 text-muted-foreground italic">{controller.handoffContext.summary}</p>
                            </div>
                         )}

                         {pendingPlan && (
                            <div className="rounded-2xl border border-amber-500/30 bg-white/5 backdrop-blur-md p-5 shadow-[0_8px_32px_rgba(245,158,11,0.15)] ring-1 ring-amber-500/10">
                               <div className="flex items-center gap-2 mb-3">
                                  <div className="size-2.5 rounded-full bg-amber-500 animate-pulse shadow-[0_0_8px_rgba(245,158,11,0.6)]" />
                                  <span className="text-xs font-bold uppercase text-amber-600 dark:text-amber-400 tracking-[0.06em]">Action Required</span>
                               </div>
                               <p className="text-sm font-bold text-foreground mb-5 leading-relaxed">{pendingPlan.summary}</p>
                               <div className="flex gap-3">
                                  <Button size="sm" className="flex-1 bg-emerald-500 hover:bg-emerald-600 text-white font-bold rounded-xl shadow-lg h-9" onClick={() => void controller.confirmPlan(pendingPlan.id)}>
                                     Confirm Plan
                                  </Button>
                                  <Button size="sm" variant="outline" className="text-rose-500 border-rose-500/20 rounded-xl h-9 hover:bg-rose-500/5 backdrop-blur-sm" onClick={() => void controller.denyPlan(pendingPlan.id)}>
                                     Deny
                                  </Button>
                               </div>
                            </div>
                         )}

                         {controller.batchRun && (
                            <div className="rounded-2xl border border-white/10 bg-white/5 p-5 shadow-sm overflow-hidden relative group transition-all hover:shadow-md backdrop-blur-sm">
                               <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-transparent via-primary/50 to-transparent" />
                               <div className="flex items-center justify-between mb-4">
                                  <h4 className="text-xs font-bold uppercase tracking-[0.06em] text-muted-foreground/80">Batch Processing</h4>
                                  <span className="text-xs font-mono text-muted-foreground bg-white/5 px-2 py-0.5 rounded-md border border-white/5">{controller.batchRun.processedCount}/{controller.batchRun.totalArtifacts}</span>
                               </div>
                               <p className="mb-3 text-xs uppercase tracking-wider text-muted-foreground">
                                 Extraction: {controller.batchRun.extractionMode || 'sequential'}
                               </p>
                               <div className="h-1.5 w-full bg-white/5 rounded-full overflow-hidden border border-white/10">
                                  <div className="h-full bg-primary transition-all duration-700 ease-out shadow-[0_0_10px_rgba(0,163,255,0.4)]" style={{ width: `${(controller.batchRun.processedCount / controller.batchRun.totalArtifacts) * 100}%` }} />
                               </div>
                               {controller.batchRun.lastBatchError ? (
                                 <p className="mt-2 text-xs text-amber-400">{controller.batchRun.lastBatchError}</p>
                               ) : null}
                               <div className="mt-4 flex gap-2">
                                  <Button size="sm" variant="outline" className="h-8 text-xs font-bold uppercase tracking-wider rounded-lg px-4 border-white/10 hover:bg-white/5" onClick={() => void controller.runBatchStep()} disabled={controller.steppingBatch}>
                                     {controller.steppingBatch ? 'Processing...' : 'Run Next Step'}
                                  </Button>
                               </div>
                            </div>
                         )}
                      </div>
                   )}

                   {/* Message Thread */}
                   {controller.loadingHistory ? (
                      <div className="flex flex-col items-center justify-center py-20 gap-3">
                         <RefreshCcw className="size-6 animate-spin text-primary/40" />
                         <p className="text-xs font-bold uppercase tracking-[0.06em] text-muted-foreground/60">Restoring thread</p>
                      </div>
                   ) : !controller.history?.messages?.length ? (
                      <div className="flex flex-col items-center justify-center py-24 text-center animate-in fade-in zoom-in duration-700">
                         <div className="flex size-20 items-center justify-center rounded-[2.5rem] bg-primary/10 text-primary border border-primary/20 shadow-xl mb-6 relative">
                            <div className="absolute inset-0 rounded-[2.5rem] bg-primary/5 animate-ping opacity-20" />
                            <Bot className="size-10" />
                         </div>
                         <h2 className="text-2xl font-bold tracking-tight mb-2 text-foreground">HamaROK Intelligence</h2>
                         <p className="text-sm text-muted-foreground max-w-sm font-medium leading-relaxed">Ask about governor progression, upload statboard screenshots, or request automated weekly reports.</p>
                      </div>
                   ) : (
                      controller.history.messages.map((msg) => <MessageBubble key={msg.id} message={msg} />)
                   )}
                </div>
             </div>

             {/* Footer Prompt Input (Fixed Bottom) */}
             <footer className="shrink-0 w-full px-4 pb-8 pt-4 bg-gradient-to-t from-black via-black/95 to-transparent flex flex-col items-center z-10">
                <div className="w-full max-w-2xl">
                   
                   {/* Suggestion Pills */}
                   {!controller.history?.messages?.length && (
                      <div className="flex flex-wrap gap-2 mb-6 justify-center animate-in fade-in slide-in-from-bottom-2 duration-1000">
                         {['Sync stats', 'Detect outliers', 'Create weekly event', 'Compare alliances'].map(s => (
                            <button 
                               key={s} 
                               className="px-4 py-2 rounded-full border border-white/10 bg-white/5 backdrop-blur-md text-[11px] font-bold uppercase tracking-wider text-muted-foreground hover:bg-primary/20 hover:text-primary hover:border-primary/40 transition-all shadow-md active:scale-95"
                               onClick={() => controller.setMessageText(s)}
                            >
                               {s}
                            </button>
                         ))}
                      </div>
                   )}

                   {/* Template Input Box */}
                   <div className="relative flex w-full flex-col overflow-hidden rounded-[1.5rem] border border-white/10 bg-white/5 focus-within:ring-2 focus-within:ring-primary/30 focus-within:border-primary/50 focus-within:bg-white/[0.07] transition-all duration-300 shadow-2xl backdrop-blur-xl">
                      
                      {/* Attachments Section */}
                      {(controller.messageFiles.length > 0 || controller.artifactRefs.length > 0) && (
                         <div className="flex flex-wrap gap-2 p-4 bg-white/5 border-b border-white/10">
                            {controller.messageFiles.map((f, i) => (
                               <div key={i} className="flex items-center gap-2 rounded-xl border border-white/10 bg-black/40 px-3 py-1.5 text-xs font-bold text-muted-foreground shadow-inner group">
                                  <FileImage className="size-3.5" />
                                  <span className="truncate max-w-[120px] font-mono tracking-tighter opacity-80">{f.name}</span>
                                  <button onClick={() => controller.setMessageFiles(prev => prev.filter((_, idx) => idx !== i))} className="ml-1 hover:text-rose-500 transition-colors">
                                     <X className="size-3" />
                                  </button>
                               </div>
                            ))}
                            {controller.artifactRefs.map((f, i) => (
                               <div key={i} className="flex items-center gap-2 rounded-xl border border-sky-500/20 bg-sky-500/20 px-3 py-1.5 text-xs font-bold text-sky-400 shadow-inner">
                                  <FileImage className="size-3.5" />
                                  <span className="truncate max-w-[120px] font-mono tracking-tighter">Artifact: {(f.fileName || f.artifactId).slice(0,12)}...</span>
                               </div>
                            ))}
                         </div>
                      )}

                      <Textarea
                        placeholder="Ask HamaROK..."
                        value={controller.messageText}
                        onChange={(event) => controller.setMessageText(event.target.value)}
                        rows={1}
                        className="min-h-[70px] w-full resize-none border-0 bg-transparent p-5 pb-2 text-sm focus-visible:ring-0 shadow-none text-foreground placeholder:text-muted-foreground/40 font-medium scrollbar-hide"
                        onKeyDown={(event) => {
                          if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
                            event.preventDefault();
                            if (
                              controller.sendingMessage ||
                              (!controller.messageText.trim() &&
                                controller.messageFiles.length === 0 &&
                                controller.artifactRefs.length === 0)
                            ) {
                              return;
                            }
                            void controller.submitMessage();
                          }
                        }}
                      />

                      <div className="flex items-center justify-between p-3 pt-0">
                        <div className="flex items-center gap-1.5 pl-1">
                          <Button
                            size="icon"
                            variant="ghost"
                            className="size-9 rounded-xl text-muted-foreground hover:bg-white/10 hover:text-foreground transition-colors"
                            onClick={() => fileInputRef.current?.click()}
                          >
                            <Plus className="size-5" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="size-9 rounded-xl text-muted-foreground hover:bg-white/10 hover:text-foreground transition-colors"
                            onClick={() => setShowMobileContext(true)}
                          >
                            <PanelRight className="size-5" />
                          </Button>
                        </div>

                        <div className="flex items-center gap-3">
                           <select
                              className="hidden md:block h-8 rounded-lg border border-white/10 bg-black/40 px-2 text-xs font-bold uppercase tracking-wider text-muted-foreground"
                              value={controller.composerAnalyzerMode}
                              onChange={(event) =>
                                controller.setComposerAnalyzerMode(
                                  event.target.value as 'inherit' | 'hybrid' | 'ocr_pipeline' | 'vision_model'
                                )
                              }
                           >
                              <option value="inherit">Analyzer: Inherit</option>
                              <option value="hybrid">Analyzer: Hybrid</option>
                              <option value="ocr_pipeline">Analyzer: OCR</option>
                              <option value="vision_model">Analyzer: Vision</option>
                           </select>
                           <span className="text-[9px] font-bold font-mono text-muted-foreground/30 hidden sm:inline-block pr-1 uppercase tracking-widest">Cmd+Enter</span>
                           <Button
                              size="icon"
                              className="size-9 rounded-2xl bg-primary text-primary-foreground shadow-[0_4px_16px_rgba(0,163,255,0.4)] hover:opacity-90 disabled:opacity-30 active:scale-95 transition-all flex items-center justify-center mr-1"
                              onClick={() => void controller.submitMessage()}
                              disabled={
                                controller.sendingMessage ||
                                (!controller.messageText.trim() &&
                                  controller.messageFiles.length === 0 &&
                                  controller.artifactRefs.length === 0)
                              }
                           >
                              {controller.sendingMessage ? <RefreshCcw className="size-4 animate-spin" /> : <Send className="size-4" />}
                           </Button>
                        </div>
                      </div>
                   </div>
                   <p className="mt-3 text-center text-[9px] font-bold uppercase tracking-[0.06em] text-muted-foreground/20">HamaROK Intelligence • Mistral Large • v2.6</p>
                </div>
             </footer>
          </main>

          {/* Desktop Sidebar: Context (XL) */}
          <aside className="hidden xl:flex w-[360px] flex-col border-l border-white/10 bg-white/[0.02]">
             <div className="p-4 border-b border-white/10 bg-white/[0.02] shadow-inner flex items-center gap-2">
                <Workflow className="size-4 text-primary opacity-70" />
                <h3 className="text-xs font-bold uppercase tracking-[0.06em] text-muted-foreground">Execution Context</h3>
             </div>
             <div className="p-4 flex-1 overflow-y-auto custom-scrollbar pr-1">
                {contextTabs}
             </div>
          </aside>
        </div>

        {/* HIDDEN INPUTS */}
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

        {/* MOBILE SIDEBAR OVERLAYS (POLISHED DRAWERS) */}
        {showMobileConversations && (
           <div className="fixed inset-0 z-[100] flex">
              <div className="fixed inset-0 bg-black/80 backdrop-blur-sm animate-in fade-in duration-300" onClick={() => setShowMobileConversations(false)} />
              <div className="relative w-[300px] h-full bg-black border-r border-white/10 shadow-2xl flex flex-col p-6 animate-in slide-in-from-left duration-500 ease-out transition-all">
                 <div className="flex items-center justify-between mb-8">
                    <h2 className="text-xl font-bold tracking-tight">History</h2>
                    <Button variant="ghost" size="icon" className="size-10 rounded-full hover:bg-white/10" onClick={() => setShowMobileConversations(false)}>
                       <X className="size-5" />
                    </Button>
                 </div>
                 <div className="flex-1 overflow-y-auto space-y-2 pr-1 custom-scrollbar">
                    <div className="space-y-1 mb-8">
                      <p className="text-[9px] font-bold uppercase tracking-[0.06em] text-muted-foreground/40 px-2 mb-3">Navigation</p>
                      {NAV_LINKS.map(link => {
                        const Icon = link.icon;
                        return (
                            <Link key={link.href} href={link.href}>
                              <button className="w-full flex items-center justify-start gap-4 text-muted-foreground hover:bg-white/10 hover:text-foreground h-12 px-4 rounded-2xl transition-all group">
                                  <Icon className="size-5 opacity-60 group-hover:opacity-100 group-hover:text-primary transition-all" />
                                  <span className="text-sm font-semibold tracking-tight">{link.label}</span>
                              </button>
                            </Link>
                        );
                      })}
                    </div>

                    <Button 
                       className="w-full justify-start gap-2 mb-6 font-bold uppercase tracking-widest text-xs rounded-xl h-12 shadow-lg" 
                       onClick={async () => {
                          const id = await controller.createConversation();
                          await controller.refreshConversation();
                          await controller.reloadHistory(id);
                          setShowMobileConversations(false);
                       }}
                    >
                       <Plus className="size-4" /> New Chat
                    </Button>
                    <div className="space-y-1">
                      <p className="text-[9px] font-bold uppercase tracking-[0.06em] text-muted-foreground/40 px-2 mb-4">Past 30 Days</p>
                      {controller.conversations.map(row => (
                        <button
                            key={row.id}
                            className={cn(
                              "w-full text-left p-4 rounded-2xl border transition-all duration-300 mb-2",
                              row.id === controller.selectedConversationId ? "bg-white/10 border-white/20 text-foreground font-bold shadow-lg" : "border-transparent text-muted-foreground hover:bg-white/5 hover:text-foreground"
                            )}
                            onClick={() => {
                              controller.setSelectedConversationId(row.id);
                              setShowMobileConversations(false);
                            }}
                        >
                            <p className="truncate tracking-tight mb-1 font-medium">{row.title || 'Untitled Thread'}</p>
                            <p className="text-[9px] opacity-40 uppercase font-mono tracking-tighter">{new Date(row.updatedAt).toLocaleDateString([], { month: 'short', day: 'numeric' })}</p>
                        </button>
                      ))}
                    </div>
                 </div>
              </div>
           </div>
        )}

        {showMobileContext && (
           <div className="fixed inset-0 z-[100] flex justify-end">
              <div className="fixed inset-0 bg-black/80 backdrop-blur-sm animate-in fade-in duration-300" onClick={() => setShowMobileContext(false)} />
              <div className="relative w-full sm:w-[420px] h-full bg-black border-l border-white/10 shadow-2xl flex flex-col animate-in slide-in-from-right duration-500 ease-out transition-all">
                 <div className="p-6 border-b border-white/10 flex items-center justify-between bg-white/[0.02]">
                    <div className="flex items-center gap-2">
                       <Workflow className="size-5 text-primary" />
                       <h2 className="text-xl font-bold tracking-tight">Context</h2>
                    </div>
                    <Button variant="ghost" size="icon" className="size-10 rounded-full hover:bg-white/10" onClick={() => setShowMobileContext(false)}>
                       <X className="size-5" />
                    </Button>
                 </div>
                 <div className="flex-1 overflow-y-auto p-6 bg-black pr-1 custom-scrollbar">
                    {contextTabs}
                 </div>
              </div>
           </div>
        )}

      </SessionGate>

      <style jsx global>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 4px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: rgba(255, 255, 255, 0.1);
          border-radius: 10px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: rgba(255, 255, 255, 0.2);
        }
        .scrollbar-hide::-webkit-scrollbar {
          display: none;
        }
        .scrollbar-hide {
          -ms-overflow-style: none;
          scrollbar-width: none;
        }
      `}</style>
    </div>
  );
}
