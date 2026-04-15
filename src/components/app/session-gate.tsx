'use client';

import type { SessionGateProps } from '@/features/shared/types';
import { EmptyState, Panel } from '@/components/ui/primitives';

export function SessionGate({
  ready,
  loading,
  error,
  children,
  loadingLabel = 'Connecting workspace...',
  notReadyLabel = 'Workspace session is not ready yet.',
}: SessionGateProps) {
  if (!ready) {
    return (
      <Panel className="mb-6" title="Workspace Session">
        <p className="text-sm leading-6 text-white/58">{loading ? loadingLabel : error || notReadyLabel}</p>
      </Panel>
    );
  }

  return <>{children}</>;
}

export function InlineError({ message }: { message: string }) {
  return (
    <div className="mb-4 rounded-2xl border border-rose-300/18 bg-rose-400/10 px-4 py-3 text-sm text-rose-100">
      {message}
    </div>
  );
}

export function NotFoundState({ title, description }: { title: string; description: string }) {
  return <EmptyState title={title} description={description} />;
}
