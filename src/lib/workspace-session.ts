'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

const WORKSPACE_ID_KEY = 'workspaceId';
const WORKSPACE_NAME_KEY = 'workspaceName';
const WORKSPACE_TOKEN_KEY = 'workspaceToken';
const KINGDOM_TAG_KEY = 'workspaceKingdomTag';
export const WORKSPACE_SESSION_EVENT = 'workspace-session-updated';

type StoredSession = {
  workspaceId: string;
  workspaceName: string;
  accessToken: string;
  kingdomTag: string;
};

type BootstrapResponse = {
  workspaceId: string;
  workspaceName?: string;
  accessToken: string;
  kingdomTag?: string;
};

type UseWorkspaceSessionOptions = {
  autoBootstrap?: boolean;
};

export type WorkspaceSession = {
  workspaceId: string;
  workspaceName: string;
  accessToken: string;
  kingdomTag: string;
  loading: boolean;
  ready: boolean;
  error: string | null;
  authHeaders: Record<string, string>;
  refreshSession: () => Promise<void>;
  clearSession: () => void;
};

function readStoredSession(): StoredSession {
  if (typeof window === 'undefined') {
    return { workspaceId: '', workspaceName: '', accessToken: '', kingdomTag: '' };
  }

  return {
    workspaceId: localStorage.getItem(WORKSPACE_ID_KEY) || '',
    workspaceName: localStorage.getItem(WORKSPACE_NAME_KEY) || '',
    accessToken: localStorage.getItem(WORKSPACE_TOKEN_KEY) || '',
    kingdomTag: localStorage.getItem(KINGDOM_TAG_KEY) || '',
  };
}

function persistSession(next: StoredSession) {
  if (typeof window === 'undefined') return;

  localStorage.setItem(WORKSPACE_ID_KEY, next.workspaceId || '');
  localStorage.setItem(WORKSPACE_NAME_KEY, next.workspaceName || '');
  localStorage.setItem(WORKSPACE_TOKEN_KEY, next.accessToken || '');
  localStorage.setItem(KINGDOM_TAG_KEY, next.kingdomTag || '');

  window.dispatchEvent(
    new CustomEvent(WORKSPACE_SESSION_EVENT, {
      detail: {
        workspaceId: next.workspaceId,
        workspaceName: next.workspaceName,
        kingdomTag: next.kingdomTag,
      },
    })
  );
}

function clearPersistedSession() {
  if (typeof window === 'undefined') return;

  localStorage.removeItem(WORKSPACE_ID_KEY);
  localStorage.removeItem(WORKSPACE_NAME_KEY);
  localStorage.removeItem(WORKSPACE_TOKEN_KEY);
  localStorage.removeItem(KINGDOM_TAG_KEY);
  window.dispatchEvent(new CustomEvent(WORKSPACE_SESSION_EVENT));
}

function parseSessionFromUrl(): Partial<StoredSession> {
  if (typeof window === 'undefined') return {};

  const url = new URL(window.location.href);
  return {
    workspaceId: url.searchParams.get('workspaceId')?.trim() || '',
    accessToken:
      url.searchParams.get('accessToken')?.trim() || url.searchParams.get('token')?.trim() || '',
    workspaceName: url.searchParams.get('workspaceName')?.trim() || '',
    kingdomTag: url.searchParams.get('kingdomTag')?.trim() || '',
  };
}

export function useWorkspaceSession(options: UseWorkspaceSessionOptions = {}): WorkspaceSession {
  const autoBootstrap = options.autoBootstrap !== false;
  const [workspaceId, setWorkspaceId] = useState('');
  const [workspaceName, setWorkspaceName] = useState('');
  const [accessToken, setAccessToken] = useState('');
  const [kingdomTag, setKingdomTag] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const syncFromStorage = useCallback(() => {
    const stored = readStoredSession();
    setWorkspaceId(stored.workspaceId);
    setWorkspaceName(stored.workspaceName);
    setAccessToken(stored.accessToken);
    setKingdomTag(stored.kingdomTag);
    return stored;
  }, []);

  const refreshSession = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/v2/workspaces/bootstrap', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const payload = await res.json();
      if (!res.ok || !payload?.data?.workspaceId || !payload?.data?.accessToken) {
        throw new Error(payload?.error?.message || 'Failed to connect workspace session.');
      }

      const data = payload.data as BootstrapResponse;
      const next: StoredSession = {
        workspaceId: data.workspaceId,
        workspaceName: data.workspaceName || '',
        accessToken: data.accessToken,
        kingdomTag: data.kingdomTag || '',
      };

      persistSession(next);
      setWorkspaceId(next.workspaceId);
      setWorkspaceName(next.workspaceName);
      setAccessToken(next.accessToken);
      setKingdomTag(next.kingdomTag);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Failed to initialize workspace session.');
    } finally {
      setLoading(false);
    }
  }, []);

  const clearSession = useCallback(() => {
    clearPersistedSession();
    setWorkspaceId('');
    setWorkspaceName('');
    setAccessToken('');
    setKingdomTag('');
    setError(null);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const fromUrl = parseSessionFromUrl();
    if (fromUrl.workspaceId && fromUrl.accessToken) {
      const next: StoredSession = {
        workspaceId: fromUrl.workspaceId,
        accessToken: fromUrl.accessToken,
        workspaceName: fromUrl.workspaceName || localStorage.getItem(WORKSPACE_NAME_KEY) || '',
        kingdomTag: fromUrl.kingdomTag || localStorage.getItem(KINGDOM_TAG_KEY) || '',
      };
      persistSession(next);
    }

    const stored = syncFromStorage();
    const hasReadySession = Boolean(stored.workspaceId && stored.accessToken);
    if (hasReadySession || !autoBootstrap) {
      setLoading(false);
      return;
    }

    void refreshSession();
  }, [autoBootstrap, refreshSession, syncFromStorage]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const onStorage = () => {
      syncFromStorage();
    };
    const onSessionUpdate = () => {
      syncFromStorage();
    };

    window.addEventListener('storage', onStorage);
    window.addEventListener(WORKSPACE_SESSION_EVENT, onSessionUpdate);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener(WORKSPACE_SESSION_EVENT, onSessionUpdate);
    };
  }, [syncFromStorage]);

  const authHeaders = useMemo(() => {
    if (!accessToken) return {} as Record<string, string>;
    return { 'x-access-token': accessToken };
  }, [accessToken]);

  return useMemo(
    () => ({
      workspaceId,
      workspaceName,
      accessToken,
      kingdomTag,
      loading,
      ready: Boolean(workspaceId && accessToken),
      error,
      authHeaders,
      refreshSession,
      clearSession,
    }),
    [workspaceId, workspaceName, accessToken, kingdomTag, loading, error, authHeaders, refreshSession, clearSession]
  );
}
