'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { consumeAssistantHandoff, type AssistantHandoffPayload } from './handoff';

export type ConversationRow = {
  id: string;
  title: string | null;
  status: 'ACTIVE' | 'ARCHIVED';
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
  messages: MessageRow[];
  plans: PlanRow[];
  pendingIdentities: PendingIdentityRow[];
};

export type PendingResolutionDraft = {
  governorDbId: string;
  eventId: string;
  note: string;
};

export type ArtifactDraftRef = {
  artifactId: string;
  url?: string;
  fileName?: string;
  mimeType?: string;
  sizeBytes?: number;
};

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
  const [loadingConversations, setLoadingConversations] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [sendingMessage, setSendingMessage] = useState(false);
  const [busyPlanId, setBusyPlanId] = useState<string | null>(null);
  const [busyPendingId, setBusyPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [resolveDrafts, setResolveDrafts] = useState<Record<string, PendingResolutionDraft>>({});
  const [handoffContext, setHandoffContext] = useState<AssistantHandoffPayload | null>(null);

  const authHeaders = useMemo(
    () => ({
      'x-access-token': args.accessToken,
    }),
    [args.accessToken]
  );

  const apiJson = useCallback(
    async <T,>(url: string, init?: RequestInit): Promise<T> => {
      const res = await fetch(url, {
        ...init,
        headers: {
          ...(init?.headers || {}),
          ...authHeaders,
        },
      });
      const payload = await res.json();
      if (!res.ok) {
        throw new Error(payload?.error?.message || 'Assistant request failed.');
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
    setLoadingConversations(true);
    setError(null);

    try {
      const rows = await apiJson<ConversationRow[]>(
        `/api/v2/assistant/conversations?workspaceId=${encodeURIComponent(args.workspaceId)}`
      );
      setConversations(rows);

      if (rows.length === 0) {
        const id = await createConversation();
        setSelectedConversationId(id);
      } else if (!selectedConversationId || !rows.some((row) => row.id === selectedConversationId)) {
        setSelectedConversationId(rows[0].id);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Failed to load assistant conversations.');
    } finally {
      setLoadingConversations(false);
    }
  }, [args.workspaceReady, args.workspaceId, apiJson, createConversation, selectedConversationId]);

  const loadHistory = useCallback(
    async (conversationId: string) => {
      if (!args.workspaceReady || !args.workspaceId || !conversationId) return;
      setLoadingHistory(true);
      setError(null);

      try {
        const nextHistory = await apiJson<ConversationHistory>(
          `/api/v2/assistant/conversations/${conversationId}/messages?workspaceId=${encodeURIComponent(
            args.workspaceId
          )}`
        );
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
        setError(cause instanceof Error ? cause.message : 'Failed to load assistant history.');
      } finally {
        setLoadingHistory(false);
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
    setNotice(`${payload.title}: Draft prepared. Review and send when ready.`);
  }, [args.workspaceReady, args.handoffToken, args.workspaceId]);

  const submitMessage = useCallback(async () => {
    if (!args.workspaceReady || !args.workspaceId) {
      setError('Workspace session is not ready.');
      return;
    }
    if (!messageText.trim() && messageFiles.length === 0 && artifactRefs.length === 0) {
      setError('Write a message or attach at least one screenshot.');
      return;
    }

    setSendingMessage(true);
    setError(null);
    setNotice(null);

    try {
      const conversationId = selectedConversationId || (await createConversation());
      const formData = new FormData();
      formData.set('workspaceId', args.workspaceId);
      formData.set('text', messageText.trim());
      for (const file of messageFiles) {
        formData.append('file', file);
      }
      for (const ref of artifactRefs) {
        formData.append('artifactId', ref.artifactId);
      }

      await apiJson<unknown>(
        `/api/v2/assistant/conversations/${conversationId}/messages`,
        {
          method: 'POST',
          body: formData,
        }
      );

      setMessageText('');
      setMessageFiles([]);
      setArtifactRefs([]);
      setHandoffContext(null);
      await loadConversations();
      await loadHistory(conversationId);
      setNotice('Message processed. Review the latest plan below before confirming.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Failed to send assistant message.');
    } finally {
      setSendingMessage(false);
    }
  }, [
    args.workspaceReady,
    args.workspaceId,
    artifactRefs,
    messageFiles,
    messageText,
    selectedConversationId,
    createConversation,
    apiJson,
    loadConversations,
    loadHistory,
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
    latestPendingPlan,
    createConversation,
    submitMessage,
    confirmPlan,
    denyPlan,
    resolvePendingIdentity,
    refreshConversation: loadConversations,
    reloadHistory: loadHistory,
  };
}
