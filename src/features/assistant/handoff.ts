export interface AssistantHandoffArtifact {
  artifactId?: string | null;
  url?: string;
  fileName?: string;
  mimeType?: string;
  sizeBytes?: number;
}

export interface AssistantHandoffPayload {
  source: 'upload' | 'review' | 'ranking_review';
  workspaceId?: string;
  title: string;
  summary?: string;
  suggestedPrompt: string;
  artifacts: AssistantHandoffArtifact[];
  meta?: Record<string, unknown>;
  createdAt: string;
}

const STORAGE_PREFIX = 'assistant:handoff:';
const TTL_MS = 30 * 60 * 1_000;

function isBrowser(): boolean {
  return typeof window !== 'undefined' && typeof window.sessionStorage !== 'undefined';
}

function cleanupExpired() {
  if (!isBrowser()) return;
  const now = Date.now();
  const keys: string[] = [];

  for (let i = 0; i < window.sessionStorage.length; i += 1) {
    const key = window.sessionStorage.key(i);
    if (!key || !key.startsWith(STORAGE_PREFIX)) continue;
    keys.push(key);
  }

  for (const key of keys) {
    const raw = window.sessionStorage.getItem(key);
    if (!raw) {
      window.sessionStorage.removeItem(key);
      continue;
    }

    try {
      const parsed = JSON.parse(raw) as { expiresAt?: number };
      if (!parsed.expiresAt || parsed.expiresAt <= now) {
        window.sessionStorage.removeItem(key);
      }
    } catch {
      window.sessionStorage.removeItem(key);
    }
  }
}

export function createAssistantHandoff(payload: Omit<AssistantHandoffPayload, 'createdAt'>): string {
  if (!isBrowser()) return '';
  cleanupExpired();

  const token =
    globalThis.crypto?.randomUUID?.() ||
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

  const now = Date.now();
  const row = {
    payload: {
      ...payload,
      createdAt: new Date(now).toISOString(),
    } satisfies AssistantHandoffPayload,
    expiresAt: now + TTL_MS,
  };

  window.sessionStorage.setItem(`${STORAGE_PREFIX}${token}`, JSON.stringify(row));
  return token;
}

export function consumeAssistantHandoff(token: string): AssistantHandoffPayload | null {
  if (!isBrowser()) return null;
  if (!token) return null;

  const key = `${STORAGE_PREFIX}${token}`;
  const raw = window.sessionStorage.getItem(key);
  if (!raw) return null;
  window.sessionStorage.removeItem(key);

  try {
    const parsed = JSON.parse(raw) as {
      expiresAt?: number;
      payload?: AssistantHandoffPayload;
    };
    if (!parsed.expiresAt || parsed.expiresAt < Date.now()) {
      return null;
    }
    return parsed.payload || null;
  } catch {
    return null;
  }
}
