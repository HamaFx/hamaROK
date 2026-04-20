'use client';

import { RefreshCcw } from 'lucide-react';
import type { SessionGateProps } from '@/features/shared/types';
import { EmptyState, Panel } from '@/components/ui/primitives';
import { Button } from '@/components/ui/button';

export function SessionGate({
  ready,
  loading,
  error,
  children,
  loadingLabel = 'Connecting workspace...',
  notReadyLabel = 'Workspace session is not ready yet.',
  onRetry,
  retryLabel = 'Retry Connection',
}: SessionGateProps) {
  if (!ready) {
    const message = loading ? loadingLabel : error || notReadyLabel;

    return (
      <section className="grid min-h-[42svh] place-items-center">
        <Panel
          className="w-full max-w-2xl"
          title="Workspace Session"
          subtitle="A connected workspace is required before ranking and statboard surfaces can load."
        >
          <div className="space-y-4">
            <p className="text-sm leading-6 text-muted-foreground font-medium">{message}</p>
            {!loading ? (
              <div className="flex flex-wrap gap-2.5">
                <Button
                  onClick={onRetry ?? (() => window.location.reload())}
                  className="rounded-xl bg-primary text-primary-foreground shadow-md hover:bg-primary/90 transition-all font-bold hover:opacity-90 shadow-lg hover:opacity-95"
                >
                  <RefreshCcw data-icon="inline-start" />
                  {retryLabel}
                </Button>
              </div>
            ) : null}
          </div>
        </Panel>
      </section>
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
