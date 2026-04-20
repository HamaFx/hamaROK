'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { consumeAssistantHandoff, type AssistantHandoffPayload } from './handoff';

export type ConversationRow = {
  id: string;
  title: string | null;
  status: 'ACTIVE' | 'ARCHIVED';
  threadConfig?: {
    threadInstructions: string;
    analyzerOverride: 'inherit' | 'hybrid' | 'ocr_pipeline' | 'vision_model';
  } | null;
  updatedAt: string;
  counts?: {
    messages: number;
    plans: number;
    pendingIdentities: number;
  };
  lastMessage?: {
    content: string;
    createdAt: string;
  } | null;
};

export type MessageRow = {
  id: string;
  role: 'SYSTEM' | 'USER' | 'ASSISTANT' | 'TOOL';
  content: string;
  attachments?: Array<{
    artifactId?: string | null;
    url?: string;
    fileName?: string;
    mimeType?: string;
    sizeBytes?: number;
  }>;
  model?: string | null;
  meta?: Record<string, unknown> | null;
  createdAt: string;
};

export type AssistantOutboxMessageState = 'sending' | 'processing' | 'failed' | 'sent';

export type PlanActionRow = {
  id: string;
  actionType: string;
  actionIndex: number;
  status: 'PENDING' | 'EXECUTED' | 'FAILED' | 'SKIPPED';
  request: Record<string, unknown>;
  result?: Record<string, unknown> | null;
  error?: string | null;
};

export type PlanRow = {
  id: string;
  summary: string;
  status: 'PENDING' | 'CONFIRMED' | 'EXECUTED' | 'DENIED' | 'FAILED';
  actionsJson?: Record<string, unknown> | null;
  actions: PlanActionRow[];
  createdAt: string;
  updatedAt: string;
};

export type PendingIdentityRow = {
  id: string;
  status: 'PENDING' | 'RESOLVED' | 'DENIED';
  reason: string | null;
  governorIdRaw: string | null;
  governorNameRaw: string;
  eventId: string | null;
  payload?: Record<string, unknown> | null;
  candidateGovernorIds?: unknown;
  createdAt: string;
  updatedAt: string;
};

export type ConversationHistory = {
  conversation?: {
    id: string;
    workspaceId: string;
    title: string | null;
    status: 'ACTIVE' | 'ARCHIVED';
    model: string | null;
    threadConfig?: {
      threadInstructions: string;
      analyzerOverride: 'inherit' | 'hybrid' | 'ocr_pipeline' | 'vision_model';
    } | null;
    createdAt: string;
    updatedAt: string;
  } | null;
  messages: MessageRow[];
  plans: PlanRow[];
  pendingIdentities: PendingIdentityRow[];
};

type PostAssistantMessageResponse = {
  conversation?: {
    id: string;
    workspaceId: string;
    title: string | null;
    status: 'ACTIVE' | 'ARCHIVED';
    model: string | null;
    createdAt: string;
    updatedAt: string;
  } | null;
  userMessage?: {
    id: string;
    role: 'USER';
    content: string;
    attachments?: Array<{
      artifactId?: string | null;
      url?: string;
      fileName?: string;
      mimeType?: string;
      sizeBytes?: number;
    }>;
    createdAt: string;
  } | null;
  assistantMessage?: {
    id: string;
    role: 'ASSISTANT';
    content: string;
    model?: string | null;
    meta?: Record<string, unknown> | null;
    createdAt: string;
  } | null;
  plan?: {
    id: string;
    summary: string;
    status: 'PENDING' | 'CONFIRMED' | 'EXECUTED' | 'DENIED' | 'FAILED';
    actions: Array<{
      id: string;
      actionType: string;
      actionIndex: number;
      status: 'PENDING' | 'EXECUTED' | 'FAILED' | 'SKIPPED';
      request: Record<string, unknown>;
    }>;
  } | null;
};

export type PendingResolutionDraft = {
  governorDbId: string;
  eventId: string;
  note: string;
};

export type AssistantBatchFlagRow = {
  artifactId: string;
  fileName: string;
  reason:
    | 'non_safe_actions'
    | 'pending_identity'
    | 'action_failed'
    | 'no_high_confidence_identity'
    | 'unexpected_error';
  planId?: string | null;
  actionTypes?: string[];
  details?: string | null;
  createdAt: string;
};

export type AssistantBatchRow = {
  id: string;
  workspaceId: string;
  conversationId: string;
  scanJobId: string;
  status: 'RUNNING' | 'COMPLETED';
  extractionMode?: 'sequential' | 'mistral_batch';
  batchThreshold?: number;
  lastBatchError?: string | null;
  totalArtifacts: number;
  processedCount: number;
  remainingCount: number;
  autoConfirmedCount: number;
  pendingManualCount: number;
  lastProcessedArtifactId: string | null;
  lastProcessedFileName: string | null;
  lease?: {
    holderId: string;
    mode: 'step' | 'run';
    stopRequested: boolean;
    expiresAt: string;
  } | null;
  nextArtifact?: {
    artifactId: string;
    fileName: string;
  } | null;
  flagged: AssistantBatchFlagRow[];
  createdAt: string;
  updatedAt: string;
};

export type ArtifactDraftRef = {
  artifactId: string;
  url?: string;
  fileName?: string;
  mimeType?: string;
  sizeBytes?: number;
};

const OUTBOX_MAX_ATTEMPTS = 4;
const OUTBOX_RETRY_BASE_MS = 900;
const OUTBOX_RETRY_JITTER_MS = 500;

function createAssistantMessageIdempotencyKey(): string {
  const globalCrypto =
    typeof globalThis !== 'undefined' ? (globalThis.crypto as Crypto | undefined) : undefined;
  if (globalCrypto?.randomUUID) {
    return `assistant-message-${globalCrypto.randomUUID()}`;
  }
  return `assistant-message-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

function createAssistantClientMessageId(): string {
  const globalCrypto =
    typeof globalThis !== 'undefined' ? (globalThis.crypto as Crypto | undefined) : undefined;
  if (globalCrypto?.randomUUID) {
    return `client-${globalCrypto.randomUUID()}`;
  }
  return `client-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

class AssistantApiError extends Error {
  status: number;
  retryable: boolean;
  retryAfterMs: number | null;
  requestId: string | null;

  constructor(
    message: string,
    options: {
      status: number;
      retryable?: boolean;
      retryAfterMs?: number | null;
      requestId?: string | null;
    }
  ) {
    super(message);
    this.name = 'AssistantApiError';
    this.status = options.status;
    this.retryable = Boolean(options.retryable);
    this.retryAfterMs =
      Number.isFinite(Number(options.retryAfterMs)) && Number(options.retryAfterMs) >= 0
        ? Number(options.retryAfterMs)
        : null;
    this.requestId = options.requestId ? String(options.requestId) : null;
  }
}

type OutboxMessage = {
  clientMessageId: string;
  optimisticMessageId: string;
  conversationId: string;
  text: string;
  files: File[];
  artifactRefs: ArtifactDraftRef[];
  analyzerMode: 'inherit' | 'hybrid' | 'ocr_pipeline' | 'vision_model';
  idempotencyKey: string;
  createdAt: string;
  attempts: number;
  state: AssistantOutboxMessageState;
  lastError: string | null;
  draftSignature: string;
  clearComposerOnSuccess: boolean;
};

function fingerprintDraft(args: {
  conversationId: string;
  text: string;
  files: File[];
  artifactRefs: ArtifactDraftRef[];
  analyzerMode: 'inherit' | 'hybrid' | 'ocr_pipeline' | 'vision_model';
}) {
  const filesFingerprint = args.files
    .map((file) => `${file.name}:${file.size}:${file.lastModified}:${file.type}`)
    .join('|');
  const artifactFingerprint = args.artifactRefs
    .map((ref) => `${ref.artifactId}:${ref.fileName || ''}:${ref.sizeBytes || 0}`)
    .join('|');
  return [
    args.conversationId,
    args.analyzerMode,
    args.text.trim(),
    filesFingerprint,
    artifactFingerprint,
  ].join('::');
}

function isTransientAssistantError(error: unknown): boolean {
  if (error instanceof AssistantApiError) {
    if (error.retryable) return true;
    if (error.status === 409) {
      return /already in progress|in progress|processing/i.test(error.message);
    }
    return false;
  }
  if (error instanceof Error) {
    return /timed out|timeout|network|fetch|abort|503|504|502|500|429/i.test(
      error.message
    );
  }
  return false;
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

export function useAssistantController(args: {
  workspaceId: string;
  accessToken: string;
  workspaceReady: boolean;
  handoffToken?: string | null;
}) {
  const [conversations, setConversations] = useState<ConversationRow[]>([]);
  const [selectedConversationId, setSelectedConversationId] = useState<string>('');
  const [history, setHistory] = useState<ConversationHistory | null>(null);
  const [messageText, setMessageText] = useState('');
  const [messageFiles, setMessageFiles] = useState<File[]>([]);
  const [artifactRefs, setArtifactRefs] = useState<ArtifactDraftRef[]>([]);
  const [outbox, setOutbox] = useState<OutboxMessage[]>([]);
  const [loadingConversations, setLoadingConversations] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [busyPlanId, setBusyPlanId] = useState<string | null>(null);
  const [busyPendingId, setBusyPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [resolveDrafts, setResolveDrafts] = useState<Record<string, PendingResolutionDraft>>({});
  const [handoffContext, setHandoffContext] = useState<AssistantHandoffPayload | null>(null);
  const [batchRun, setBatchRun] = useState<AssistantBatchRow | null>(null);
  const [batchScanJobId, setBatchScanJobId] = useState<string>('');
  const [startingBatch, setStartingBatch] = useState(false);
  const [steppingBatch, setSteppingBatch] = useState(false);
  const [runningBatch, setRunningBatch] = useState(false);
  const [stoppingBatch, setStoppingBatch] = useState(false);
  const [threadInstructionsDraft, setThreadInstructionsDraft] = useState('');
  const [threadAnalyzerOverride, setThreadAnalyzerOverride] = useState<
    'inherit' | 'hybrid' | 'ocr_pipeline' | 'vision_model'
  >('inherit');
  const [savingThreadConfig, setSavingThreadConfig] = useState(false);
  const [composerAnalyzerMode, setComposerAnalyzerMode] = useState<
    'inherit' | 'hybrid' | 'ocr_pipeline' | 'vision_model'
  >('inherit');
  const sendingGuardRef = useRef(false);
  const outboxProcessingRef = useRef<string | null>(null);
  const outboxRetryTimersRef = useRef<Record<string, number>>({});
  const conversationsRequestRef = useRef(0);
  const historyRequestRef = useRef(0);

  const authHeaders = useMemo(
    () => ({
      'x-access-token': args.accessToken,
    }),
    [args.accessToken]
  );
  const sendingMessage = useMemo(
    () =>
      outbox.some(
        (entry) => entry.state === 'sending' || entry.state === 'processing'
      ),
    [outbox]
  );

  useEffect(() => {
    const timers = outboxRetryTimersRef.current;
    return () => {
      for (const timerId of Object.values(timers)) {
        window.clearTimeout(timerId);
      }
    };
  }, []);

  const apiJson = useCallback(
    async <T,>(
      url: string,
      init?: RequestInit,
      options?: {
        timeoutMs?: number;
        timeoutMessage?: string;
      }
    ): Promise<T> => {
      const timeoutMs = Math.max(1000, Number(options?.timeoutMs || 45_000));
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);

      let res: Response;
      try {
        res = await fetch(url, {
          ...init,
          headers: {
            ...(init?.headers || {}),
            ...authHeaders,
          },
          signal: controller.signal,
        });
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
          throw new Error(options?.timeoutMessage || 'Assistant request timed out.');
        }
        throw error;
      } finally {
        clearTimeout(timeout);
      }

      const payloadText = await res.text();
      let payload: Record<string, unknown> | null = null;
      if (payloadText) {
        try {
          const parsed = JSON.parse(payloadText);
          if (parsed && typeof parsed === 'object') {
            payload = parsed as Record<string, unknown>;
          }
        } catch {
          payload = null;
        }
      }

      if (!res.ok) {
        const payloadError =
          payload?.error && typeof payload.error === 'object'
            ? (payload.error as Record<string, unknown>)
            : null;
        const errorMessage =
          String(payloadError?.message || '') ||
          String(payload?.message || '').trim() ||
          `Assistant request failed (${res.status}).`;
        const retryableFromPayload =
          typeof payloadError?.retryable === 'boolean' ? payloadError.retryable : null;
        const retryAfterMsFromPayload =
          Number.isFinite(Number(payloadError?.retryAfterMs)) && Number(payloadError?.retryAfterMs) >= 0
            ? Number(payloadError?.retryAfterMs)
            : null;
        const retryAfterHeader = res.headers.get('retry-after');
        const retryAfterMsFromHeader =
          retryAfterHeader && Number.isFinite(Number(retryAfterHeader))
            ? Math.max(0, Math.floor(Number(retryAfterHeader) * 1000))
            : null;
        const retryable =
          retryableFromPayload ??
          (res.status === 408 ||
            res.status === 409 ||
            res.status === 429 ||
            res.status === 500 ||
            res.status === 502 ||
            res.status === 503 ||
            res.status === 504);
        throw new AssistantApiError(errorMessage, {
          status: res.status,
          retryable,
          retryAfterMs: retryAfterMsFromPayload ?? retryAfterMsFromHeader,
          requestId:
            (typeof payloadError?.requestId === 'string' && payloadError.requestId) ||
            res.headers.get('x-request-id'),
        });
      }

      if (!payload || !('data' in payload)) {
        throw new Error('Assistant API returned an unexpected response payload.');
      }

      return payload.data as T;
    },
    [authHeaders]
  );

  const createConversation = useCallback(async (): Promise<string> => {
    if (!args.workspaceId) throw new Error('workspaceId is missing.');

    const created = await apiJson<ConversationRow>('/api/v2/assistant/conversations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        workspaceId: args.workspaceId,
        title: null,
      }),
    });

    setConversations((prev) => [created, ...prev]);
    setSelectedConversationId(created.id);
    return created.id;
  }, [apiJson, args.workspaceId]);

  const loadConversations = useCallback(async () => {
    if (!args.workspaceReady || !args.workspaceId) return;
    const requestId = ++conversationsRequestRef.current;
    setLoadingConversations(true);
    setError(null);

    try {
      const rows = await apiJson<ConversationRow[]>(
        `/api/v2/assistant/conversations?workspaceId=${encodeURIComponent(args.workspaceId)}`
      );
      if (requestId !== conversationsRequestRef.current) return;
      setConversations(rows);

      if (rows.length === 0) {
        const id = await createConversation();
        if (requestId !== conversationsRequestRef.current) return;
        setSelectedConversationId(id);
      } else if (!selectedConversationId || !rows.some((row) => row.id === selectedConversationId)) {
        setSelectedConversationId(rows[0].id);
      }
    } catch (cause) {
      if (requestId !== conversationsRequestRef.current) return;
      setError(cause instanceof Error ? cause.message : 'Failed to load assistant conversations.');
    } finally {
      if (requestId !== conversationsRequestRef.current) return;
      setLoadingConversations(false);
    }
  }, [args.workspaceReady, args.workspaceId, apiJson, createConversation, selectedConversationId]);

  const loadHistory = useCallback(
    async (conversationId: string, options?: { background?: boolean }) => {
      if (!args.workspaceReady || !args.workspaceId || !conversationId) return;
      const requestId = ++historyRequestRef.current;
      const background = Boolean(options?.background);
      if (!background) {
        setLoadingHistory(true);
      }
      setError(null);

      try {
        const nextHistory = await apiJson<ConversationHistory>(
          `/api/v2/assistant/conversations/${conversationId}/messages?workspaceId=${encodeURIComponent(
            args.workspaceId
          )}`
        );
        if (requestId !== historyRequestRef.current) return;
        setHistory(nextHistory);

        setResolveDrafts((prev) => {
          const merged: Record<string, PendingResolutionDraft> = { ...prev };
          for (const row of nextHistory.pendingIdentities || []) {
            if (merged[row.id]) continue;
            const candidates = parseCandidates(row.candidateGovernorIds);
            merged[row.id] = {
              governorDbId: candidates[0]?.governorDbId || '',
              eventId: row.eventId || '',
              note: '',
            };
          }
          return merged;
        });
      } catch (cause) {
        if (requestId !== historyRequestRef.current) return;
        setError(cause instanceof Error ? cause.message : 'Failed to load assistant history.');
      } finally {
        if (!background && requestId === historyRequestRef.current) {
          setLoadingHistory(false);
        }
      }
    },
    [args.workspaceReady, args.workspaceId, apiJson]
  );

  useEffect(() => {
    if (args.workspaceReady) {
      void loadConversations();
    }
  }, [args.workspaceReady, loadConversations]);

  useEffect(() => {
    if (args.workspaceReady && selectedConversationId) {
      void loadHistory(selectedConversationId);
    }
  }, [args.workspaceReady, selectedConversationId, loadHistory]);

  useEffect(() => {
    const threadConfig = history?.conversation?.threadConfig || null;
    setThreadInstructionsDraft(String(threadConfig?.threadInstructions || ''));
    setThreadAnalyzerOverride(
      threadConfig?.analyzerOverride === 'hybrid' ||
        threadConfig?.analyzerOverride === 'ocr_pipeline' ||
        threadConfig?.analyzerOverride === 'vision_model'
        ? threadConfig.analyzerOverride
        : 'inherit'
    );
  }, [history?.conversation?.id, history?.conversation?.threadConfig]);

  useEffect(() => {
    if (!args.workspaceReady || !args.handoffToken) return;
    const payload = consumeAssistantHandoff(args.handoffToken);
    if (!payload) return;
    if (payload.workspaceId && payload.workspaceId !== args.workspaceId) {
      setError('Handoff payload does not match the active workspace.');
      return;
    }

    setHandoffContext(payload);
    setMessageText((prev) => (prev.trim() ? prev : payload.suggestedPrompt || ''));
    const refs: ArtifactDraftRef[] = [];
    for (const artifact of payload.artifacts || []) {
      const id = String(artifact.artifactId || '').trim();
      if (!id) continue;
      refs.push({
        artifactId: id,
        ...(artifact.url ? { url: artifact.url } : {}),
        ...(artifact.fileName ? { fileName: artifact.fileName } : {}),
        ...(artifact.mimeType ? { mimeType: artifact.mimeType } : {}),
        ...(typeof artifact.sizeBytes === 'number' ? { sizeBytes: artifact.sizeBytes } : {}),
      });
    }
    setArtifactRefs(refs);
    const handoffScanJobId =
      payload.meta && typeof payload.meta === 'object'
        ? String((payload.meta as Record<string, unknown>).scanJobId || '').trim()
        : '';
    setBatchScanJobId(handoffScanJobId);
    setBatchRun(null);
    setNotice(`${payload.title}: Draft prepared. Review and send when ready.`);
  }, [args.workspaceReady, args.handoffToken, args.workspaceId]);

  useEffect(() => {
    if (!args.workspaceReady || !args.workspaceId || !selectedConversationId) return;

    let cancelled = false;
    const loadBatchForConversation = async () => {
      try {
        const row = await apiJson<AssistantBatchRow>(
          `/api/v2/assistant/batches/${selectedConversationId}?workspaceId=${encodeURIComponent(
            args.workspaceId
          )}`
        );
        if (!cancelled) {
          setBatchRun(row);
          setBatchScanJobId((prev) => prev || row.scanJobId || '');
        }
      } catch {
        if (!cancelled) {
          setBatchRun(null);
        }
      }
    };

    void loadBatchForConversation();
    const interval = window.setInterval(() => {
      void loadBatchForConversation();
    }, 3500);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [args.workspaceReady, args.workspaceId, selectedConversationId, apiJson]);

  const syncHistoryAfterTransientFailure = useCallback(
    async (conversationId: string) => {
      const delaysMs = [1200, 2200, 3500, 5000, 8000];
      for (const delayMs of delaysMs) {
        await new Promise<void>((resolve) => {
          setTimeout(resolve, delayMs);
        });
        await loadHistory(conversationId, { background: true });
      }
      await loadConversations();
    },
    [loadHistory, loadConversations]
  );

  const upsertOptimisticMessageMeta = useCallback(
    (args: {
      conversationId: string;
      optimisticMessageId: string;
      state: AssistantOutboxMessageState;
      attempts?: number;
      error?: string | null;
    }) => {
      setHistory((prev) => {
        if (!prev || prev.conversation?.id !== args.conversationId) return prev;
        return {
          ...prev,
          messages: prev.messages.map((message) => {
            if (message.id !== args.optimisticMessageId) return message;
            return {
              ...message,
              meta: {
                ...(message.meta || {}),
                optimistic: true,
                syncState: args.state,
                attempts: args.attempts ?? 0,
                error: args.error || null,
              },
            };
          }),
        };
      });
    },
    []
  );

  const applyMessageResponseToHistory = useCallback(
    (args: {
      conversationId: string;
      optimisticMessageId: string;
      response: PostAssistantMessageResponse;
    }) => {
      setHistory((prev) => {
        if (!prev || prev.conversation?.id !== args.conversationId) return prev;
        const nextMessages = prev.messages.filter(
          (message) => message.id !== args.optimisticMessageId
        );
        if (
          args.response.userMessage &&
          !nextMessages.some((message) => message.id === args.response.userMessage?.id)
        ) {
          nextMessages.push({
            id: args.response.userMessage.id,
            role: args.response.userMessage.role,
            content: args.response.userMessage.content,
            attachments: args.response.userMessage.attachments || [],
            model: null,
            meta: null,
            createdAt: args.response.userMessage.createdAt,
          });
        }
        if (
          args.response.assistantMessage &&
          !nextMessages.some(
            (message) => message.id === args.response.assistantMessage?.id
          )
        ) {
          nextMessages.push({
            id: args.response.assistantMessage.id,
            role: args.response.assistantMessage.role,
            content: args.response.assistantMessage.content,
            attachments: [],
            model: args.response.assistantMessage.model || null,
            meta: args.response.assistantMessage.meta || null,
            createdAt: args.response.assistantMessage.createdAt,
          });
        }
        nextMessages.sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));

        const nextPlans = [...(prev.plans || [])];
        if (
          args.response.plan &&
          !nextPlans.some((plan) => plan.id === args.response.plan?.id)
        ) {
          const createdAt =
            args.response.assistantMessage?.createdAt || new Date().toISOString();
          nextPlans.push({
            id: args.response.plan.id,
            summary: args.response.plan.summary,
            status: args.response.plan.status,
            actionsJson: null,
            actions: args.response.plan.actions.map((action) => ({
              id: action.id,
              actionType: action.actionType,
              actionIndex: action.actionIndex,
              status: action.status,
              request: action.request,
              result: null,
              error: null,
            })),
            createdAt,
            updatedAt: createdAt,
          });
        }

        return {
          ...prev,
          conversation: args.response.conversation
            ? {
                ...prev.conversation,
                title: args.response.conversation.title,
                model: args.response.conversation.model,
                status: args.response.conversation.status,
                updatedAt: args.response.conversation.updatedAt,
              }
            : prev.conversation,
          messages: nextMessages,
          plans: nextPlans.sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt)),
        };
      });
    },
    []
  );

  useEffect(() => {
    if (!args.workspaceReady || outboxProcessingRef.current) return;
    const next = outbox.find((entry) => entry.state === 'sending');
    if (!next) return;

    outboxProcessingRef.current = next.clientMessageId;
    let cancelled = false;

    const send = async () => {
      try {
        upsertOptimisticMessageMeta({
          conversationId: next.conversationId,
          optimisticMessageId: next.optimisticMessageId,
          state: 'sending',
          attempts: next.attempts,
          error: null,
        });

        const formData = new FormData();
        formData.set('workspaceId', args.workspaceId);
        formData.set('text', next.text);
        formData.set('idempotencyKey', next.idempotencyKey);
        formData.set('clientMessageId', next.clientMessageId);
        if (next.analyzerMode !== 'inherit') {
          formData.set('analyzerMode', next.analyzerMode);
        }
        for (const file of next.files) {
          formData.append('file', file);
        }
        for (const ref of next.artifactRefs) {
          formData.append('artifactId', ref.artifactId);
        }

        const response = await apiJson<PostAssistantMessageResponse>(
          `/api/v2/assistant/conversations/${next.conversationId}/messages`,
          {
            method: 'POST',
            body: formData,
          },
          {
            timeoutMs: 240_000,
            timeoutMessage:
              'Assistant took too long to respond. Message will retry automatically.',
          }
        );

        if (cancelled) return;
        applyMessageResponseToHistory({
          conversationId: next.conversationId,
          optimisticMessageId: next.optimisticMessageId,
          response,
        });
        if (outboxRetryTimersRef.current[next.clientMessageId]) {
          window.clearTimeout(outboxRetryTimersRef.current[next.clientMessageId]);
          delete outboxRetryTimersRef.current[next.clientMessageId];
        }
        setOutbox((prev) =>
          prev.filter((entry) => entry.clientMessageId !== next.clientMessageId)
        );

        const currentDraftSignature = fingerprintDraft({
          conversationId: selectedConversationId || next.conversationId,
          text: messageText,
          files: messageFiles,
          artifactRefs,
          analyzerMode: composerAnalyzerMode,
        });
        if (
          next.clearComposerOnSuccess &&
          selectedConversationId === next.conversationId &&
          currentDraftSignature === next.draftSignature
        ) {
          setMessageText('');
          setMessageFiles([]);
          setArtifactRefs([]);
          setHandoffContext(null);
          setComposerAnalyzerMode('inherit');
        }

        await Promise.all([
          loadConversations(),
          loadHistory(next.conversationId, { background: true }),
        ]);
        setNotice('Message processed. Review the latest plan below before confirming.');
      } catch (cause) {
        if (cancelled) return;
        const errorMessage =
          cause instanceof Error ? cause.message : 'Failed to send assistant message.';
        const transientFailure = isTransientAssistantError(cause);
        const nextAttempts = next.attempts + 1;

        if (transientFailure && nextAttempts < OUTBOX_MAX_ATTEMPTS) {
          const jitter = Math.floor(Math.random() * OUTBOX_RETRY_JITTER_MS);
          const retryDelayFromError =
            cause instanceof AssistantApiError &&
            Number.isFinite(Number(cause.retryAfterMs)) &&
            Number(cause.retryAfterMs) >= 0
              ? Number(cause.retryAfterMs)
              : null;
          const retryDelayMs = Math.max(
            retryDelayFromError ?? 0,
            OUTBOX_RETRY_BASE_MS * 2 ** (nextAttempts - 1) + jitter
          );
          setOutbox((prev) =>
            prev.map((entry) =>
              entry.clientMessageId === next.clientMessageId
                ? {
                    ...entry,
                    attempts: nextAttempts,
                    state: 'processing',
                    lastError: errorMessage,
                  }
                : entry
            )
          );
          upsertOptimisticMessageMeta({
            conversationId: next.conversationId,
            optimisticMessageId: next.optimisticMessageId,
            state: 'processing',
            attempts: nextAttempts,
            error: errorMessage,
          });
          setNotice(
            `Transient send issue. Retrying in ${(retryDelayMs / 1000).toFixed(1)}s (attempt ${nextAttempts + 1}/${OUTBOX_MAX_ATTEMPTS}).`
          );

          if (outboxRetryTimersRef.current[next.clientMessageId]) {
            window.clearTimeout(outboxRetryTimersRef.current[next.clientMessageId]);
          }
          outboxRetryTimersRef.current[next.clientMessageId] = window.setTimeout(() => {
            setOutbox((prev) =>
              prev.map((entry) =>
                entry.clientMessageId === next.clientMessageId &&
                entry.state === 'processing'
                  ? { ...entry, state: 'sending' }
                  : entry
              )
            );
            delete outboxRetryTimersRef.current[next.clientMessageId];
          }, retryDelayMs);
          void syncHistoryAfterTransientFailure(next.conversationId);
          return;
        }

        setOutbox((prev) =>
          prev.map((entry) =>
            entry.clientMessageId === next.clientMessageId
              ? {
                  ...entry,
                  attempts: nextAttempts,
                  state: 'failed',
                  lastError: errorMessage,
                }
              : entry
          )
        );
        upsertOptimisticMessageMeta({
          conversationId: next.conversationId,
          optimisticMessageId: next.optimisticMessageId,
          state: 'failed',
          attempts: nextAttempts,
          error: errorMessage,
        });
        setError(errorMessage);
        if (outboxRetryTimersRef.current[next.clientMessageId]) {
          window.clearTimeout(outboxRetryTimersRef.current[next.clientMessageId]);
          delete outboxRetryTimersRef.current[next.clientMessageId];
        }
        await loadHistory(next.conversationId, { background: true });
      } finally {
        if (outboxProcessingRef.current === next.clientMessageId) {
          outboxProcessingRef.current = null;
        }
      }
    };

    void send();
    return () => {
      cancelled = true;
    };
  }, [
    apiJson,
    applyMessageResponseToHistory,
    args.workspaceId,
    args.workspaceReady,
    artifactRefs,
    composerAnalyzerMode,
    loadConversations,
    loadHistory,
    messageFiles,
    messageText,
    outbox,
    selectedConversationId,
    syncHistoryAfterTransientFailure,
    upsertOptimisticMessageMeta,
  ]);

  const retryFailedOutboxMessage = useCallback((clientMessageId: string) => {
    if (outboxRetryTimersRef.current[clientMessageId]) {
      window.clearTimeout(outboxRetryTimersRef.current[clientMessageId]);
      delete outboxRetryTimersRef.current[clientMessageId];
    }
    setOutbox((prev) =>
      prev.map((entry) =>
        entry.clientMessageId === clientMessageId && entry.state === 'failed'
          ? { ...entry, state: 'sending', lastError: null }
          : entry
      )
    );
    setHistory((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        messages: prev.messages.map((message) => {
          const meta = message.meta && typeof message.meta === 'object'
            ? (message.meta as Record<string, unknown>)
            : null;
          if (!meta || String(meta.clientMessageId || '') !== clientMessageId) {
            return message;
          }
          return {
            ...message,
            meta: {
              ...meta,
              syncState: 'sending',
              error: null,
            },
          };
        }),
      };
    });
    setError(null);
    setNotice('Retrying failed message.');
  }, []);

  const submitMessage = useCallback(async () => {
    if (sendingGuardRef.current) return;
    if (!args.workspaceReady || !args.workspaceId) {
      setError('Workspace session is not ready.');
      return;
    }
    const trimmedText = messageText.trim();
    if (!trimmedText && messageFiles.length === 0 && artifactRefs.length === 0) {
      setError('Write a message or attach at least one screenshot.');
      return;
    }

    sendingGuardRef.current = true;
    setError(null);
    setNotice(null);

    try {
      const conversationId = selectedConversationId || (await createConversation());
      const draftSignature = fingerprintDraft({
        conversationId,
        text: trimmedText,
        files: messageFiles,
        artifactRefs,
        analyzerMode: composerAnalyzerMode,
      });
      const duplicateQueued = outbox.some(
        (entry) =>
          entry.draftSignature === draftSignature &&
          entry.state !== 'sent'
      );
      if (duplicateQueued) {
        setNotice('This draft is already queued for delivery.');
        return;
      }

      const clientMessageId = createAssistantClientMessageId();
      const optimisticMessageId = `optimistic-${clientMessageId}`;
      const createdAt = new Date().toISOString();
      const outboxMessage: OutboxMessage = {
        clientMessageId,
        optimisticMessageId,
        conversationId,
        text: trimmedText,
        files: [...messageFiles],
        artifactRefs: [...artifactRefs],
        analyzerMode: composerAnalyzerMode,
        idempotencyKey: createAssistantMessageIdempotencyKey(),
        createdAt,
        attempts: 0,
        state: 'sending',
        lastError: null,
        draftSignature,
        clearComposerOnSuccess: true,
      };

      setHistory((prev) => {
        const optimisticMessage: MessageRow = {
          id: optimisticMessageId,
          role: 'USER',
          content: trimmedText || '[image message]',
          attachments: [
            ...messageFiles.map((file) => ({
              fileName: file.name,
              mimeType: file.type || 'image/png',
              sizeBytes: file.size,
            })),
            ...artifactRefs.map((ref) => ({
              artifactId: ref.artifactId,
              url: ref.url,
              fileName: ref.fileName,
              mimeType: ref.mimeType,
              sizeBytes: ref.sizeBytes,
            })),
          ],
          model: null,
          meta: {
            optimistic: true,
            syncState: 'sending',
            clientMessageId,
            attempts: 0,
          },
          createdAt,
        };

        if (!prev || prev.conversation?.id !== conversationId) {
          return {
            conversation: {
              id: conversationId,
              workspaceId: args.workspaceId,
              title: null,
              status: 'ACTIVE',
              model: null,
              threadConfig: null,
              createdAt,
              updatedAt: createdAt,
            },
            messages: [optimisticMessage],
            plans: [],
            pendingIdentities: [],
          };
        }

        return {
          ...prev,
          messages: [...prev.messages, optimisticMessage],
        };
      });

      setOutbox((prev) => [...prev, outboxMessage]);
      setSelectedConversationId(conversationId);
      setNotice('Message queued. Sending now...');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Failed to queue assistant message.');
    } finally {
      window.setTimeout(() => {
        sendingGuardRef.current = false;
      }, 150);
    }
  }, [
    args.workspaceReady,
    args.workspaceId,
    artifactRefs,
    composerAnalyzerMode,
    createConversation,
    messageFiles,
    messageText,
    outbox,
    selectedConversationId,
  ]);

  const confirmPlan = useCallback(async (planId: string) => {
    if (!args.workspaceId) return;
    setBusyPlanId(planId);
    setError(null);
    setNotice(null);

    try {
      await apiJson<unknown>(`/api/v2/assistant/plans/${planId}/confirm`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ workspaceId: args.workspaceId }),
      });

      if (selectedConversationId) {
        await loadHistory(selectedConversationId);
      }
      await loadConversations();
      setNotice('Plan confirmation submitted.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Failed to confirm plan.');
    } finally {
      setBusyPlanId(null);
    }
  }, [apiJson, args.workspaceId, selectedConversationId, loadHistory, loadConversations]);

  const denyPlan = useCallback(async (planId: string) => {
    if (!args.workspaceId) return;
    setBusyPlanId(planId);
    setError(null);
    setNotice(null);

    try {
      await apiJson<unknown>(`/api/v2/assistant/plans/${planId}/deny`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ workspaceId: args.workspaceId }),
      });

      if (selectedConversationId) {
        await loadHistory(selectedConversationId);
      }
      await loadConversations();
      setNotice('Plan denied.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Failed to deny plan.');
    } finally {
      setBusyPlanId(null);
    }
  }, [apiJson, args.workspaceId, selectedConversationId, loadHistory, loadConversations]);

  const resolvePendingIdentity = useCallback(async (pendingId: string) => {
    if (!args.workspaceId) return;
    const draft = resolveDrafts[pendingId];
    if (!draft?.governorDbId.trim()) {
      setError('Select or enter a governor DB ID to resolve this identity.');
      return;
    }

    setBusyPendingId(pendingId);
    setError(null);
    setNotice(null);

    try {
      await apiJson<unknown>(`/api/v2/assistant/pending-identities/${pendingId}/resolve`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          workspaceId: args.workspaceId,
          governorDbId: draft.governorDbId.trim(),
          eventId: draft.eventId.trim() || null,
          note: draft.note.trim() || null,
        }),
      });

      if (selectedConversationId) {
        await loadHistory(selectedConversationId);
      }
      await loadConversations();
      setNotice('Pending identity resolved.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Failed to resolve pending identity.');
    } finally {
      setBusyPendingId(null);
    }
  }, [apiJson, args.workspaceId, resolveDrafts, selectedConversationId, loadHistory, loadConversations]);

  const saveThreadConfig = useCallback(async () => {
    if (!args.workspaceId || !selectedConversationId) {
      setError('Select a conversation first.');
      return;
    }

    setSavingThreadConfig(true);
    setError(null);
    setNotice(null);

    try {
      await apiJson<ConversationRow>(`/api/v2/assistant/conversations/${selectedConversationId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          workspaceId: args.workspaceId,
          threadConfig: {
            threadInstructions: threadInstructionsDraft,
            analyzerOverride: threadAnalyzerOverride,
          },
        }),
      });
      await loadConversations();
      await loadHistory(selectedConversationId);
      setNotice('Thread settings saved.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Failed to save thread settings.');
    } finally {
      setSavingThreadConfig(false);
    }
  }, [
    apiJson,
    args.workspaceId,
    selectedConversationId,
    threadInstructionsDraft,
    threadAnalyzerOverride,
    loadConversations,
    loadHistory,
  ]);

  const startBatchRun = useCallback(
    async (scanJobId?: string) => {
      if (!args.workspaceId || !args.workspaceReady) {
        setError('Workspace session is not ready.');
        return;
      }
      const resolvedScanJobId = String(scanJobId || batchScanJobId || '').trim();
      if (!resolvedScanJobId) {
        setError('Scan job ID is required to start AI batch mode.');
        return;
      }

      setStartingBatch(true);
      setError(null);
      setNotice(null);

      try {
        const row = await apiJson<AssistantBatchRow>('/api/v2/assistant/batches', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            workspaceId: args.workspaceId,
            scanJobId: resolvedScanJobId,
            conversationId: selectedConversationId || null,
          }),
        });
        setBatchRun(row);
        setBatchScanJobId(row.scanJobId);
        setSelectedConversationId(row.conversationId);
        await loadConversations();
        await loadHistory(row.conversationId);
        setNotice('AI batch run is ready. Start continuous run or process one step manually.');
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Failed to start AI batch run.');
      } finally {
        setStartingBatch(false);
      }
    },
    [
      apiJson,
      args.workspaceId,
      args.workspaceReady,
      batchScanJobId,
      selectedConversationId,
      loadConversations,
      loadHistory,
    ]
  );

  const runBatchContinuous = useCallback(async () => {
    if (!args.workspaceId) return;
    if (!batchRun?.id) {
      setError('No active AI batch run to start.');
      return;
    }

    setRunningBatch(true);
    setError(null);
    setNotice(null);

    try {
      const result = await apiJson<{
        batch: AssistantBatchRow;
        stepsProcessed: number;
        stopped: boolean;
      }>(`/api/v2/assistant/batches/${batchRun.id}/run`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          workspaceId: args.workspaceId,
        }),
      });

      setBatchRun(result.batch);
      if (result.stopped) {
        setNotice(`Batch run stopped after ${result.stepsProcessed} step(s).`);
      } else if (result.batch.status === 'COMPLETED') {
        setNotice(`Batch run completed (${result.stepsProcessed} step(s) in this run).`);
      } else {
        setNotice(`Batch run progressed ${result.stepsProcessed} step(s).`);
      }
      if (selectedConversationId) {
        await loadHistory(selectedConversationId, { background: true });
      }
      await loadConversations();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Failed to run continuous batch.');
    } finally {
      setRunningBatch(false);
    }
  }, [
    apiJson,
    args.workspaceId,
    batchRun?.id,
    selectedConversationId,
    loadConversations,
    loadHistory,
  ]);

  const stopBatchContinuous = useCallback(async () => {
    if (!args.workspaceId) return;
    if (!batchRun?.id) {
      setError('No active AI batch run to stop.');
      return;
    }

    setStoppingBatch(true);
    setError(null);
    setNotice(null);

    try {
      const result = await apiJson<{ batch: AssistantBatchRow }>(
        `/api/v2/assistant/batches/${batchRun.id}/stop`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            workspaceId: args.workspaceId,
          }),
        }
      );
      setBatchRun(result.batch);
      setNotice('Stop requested for batch runner.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Failed to stop batch runner.');
    } finally {
      setStoppingBatch(false);
    }
  }, [apiJson, args.workspaceId, batchRun?.id]);

  const runBatchStep = useCallback(async () => {
    if (!args.workspaceId) return;
    if (!batchRun?.id) {
      setError('No active AI batch run to step.');
      return;
    }

    setSteppingBatch(true);
    setError(null);
    setNotice(null);

    try {
      const result = await apiJson<{
        batch: AssistantBatchRow;
        step: {
          artifactId: string;
          fileName: string;
          planId: string | null;
          actionTypes: string[];
          autoConfirmed: boolean;
          flaggedReason:
            | 'non_safe_actions'
            | 'pending_identity'
            | 'action_failed'
            | 'no_high_confidence_identity'
            | 'unexpected_error'
            | null;
        } | null;
      }>(`/api/v2/assistant/batches/${batchRun.id}/step`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          workspaceId: args.workspaceId,
        }),
      });

      setBatchRun(result.batch);
      if (result.step) {
        if (result.step.autoConfirmed) {
          setNotice(`Processed ${result.step.fileName} and auto-confirmed safe actions.`);
        } else if (result.step.flaggedReason) {
          setNotice(
            `Processed ${result.step.fileName}. Flagged for manual review (${result.step.flaggedReason}).`
          );
        } else {
          setNotice(`Processed ${result.step.fileName}.`);
        }
      } else {
        setNotice('AI batch run is complete.');
      }
      if (selectedConversationId) {
        await loadHistory(selectedConversationId);
      }
      await loadConversations();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Failed to run AI batch step.');
    } finally {
      setSteppingBatch(false);
    }
  }, [
    apiJson,
    args.workspaceId,
    batchRun?.id,
    selectedConversationId,
    loadHistory,
    loadConversations,
  ]);

  const latestPendingPlan = useMemo(() => {
    const plans = history?.plans || [];
    return plans
      .filter((plan) => plan.status === 'PENDING')
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0] || null;
  }, [history?.plans]);

  return {
    conversations,
    selectedConversationId,
    setSelectedConversationId,
    history,
    messageText,
    setMessageText,
    messageFiles,
    setMessageFiles,
    artifactRefs,
    setArtifactRefs,
    outbox,
    loadingConversations,
    loadingHistory,
    sendingMessage,
    busyPlanId,
    busyPendingId,
    error,
    setError,
    notice,
    setNotice,
    resolveDrafts,
    setResolveDrafts,
    handoffContext,
    batchRun,
    batchScanJobId,
    setBatchScanJobId,
    startingBatch,
    steppingBatch,
    runningBatch,
    stoppingBatch,
    threadInstructionsDraft,
    setThreadInstructionsDraft,
    threadAnalyzerOverride,
    setThreadAnalyzerOverride,
    savingThreadConfig,
    saveThreadConfig,
    composerAnalyzerMode,
    setComposerAnalyzerMode,
    latestPendingPlan,
    createConversation,
    submitMessage,
    retryFailedOutboxMessage,
    confirmPlan,
    denyPlan,
    resolvePendingIdentity,
    startBatchRun,
    runBatchContinuous,
    stopBatchContinuous,
    runBatchStep,
    refreshConversation: loadConversations,
    reloadHistory: loadHistory,
  };
}
